"""/api/platform/ - SaaS operator API. Platform tokens only (platform_admin/auth.py).

Operators manage tenants' METADATA and lifecycle. Nothing here returns a
firm's cases, clients, documents, drafts or invoices - only names, statuses and
counts.
"""
import datetime

from django.conf import settings
from django.db.models import Count, Sum
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import throttle
from accounts.models import AuthAttempt
from core import totp
from core.passwords import verify_password
from firms import invitations, provisioning, services
from firms.models import Firm, FirmInvitation, FirmMembership, FirmSettings

from .auth import PlatformJWTAuthentication, RequireOperator, audit, issue_token
from .models import PlatformAudit, PlatformOperator


class _Platform(APIView):
    authentication_classes = [PlatformJWTAuthentication]


# ------------------------------------------------------------------ auth ------
class LoginView(APIView):
    """POST {email, password, otp}. MFA is mandatory: an operator without an
    enrolled authenticator cannot sign in."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        ip = throttle.client_ip(request)
        wait = throttle.login_retry_after(email, ip, kind=AuthAttempt.PLATFORM)
        if wait:
            audit(request, 'LOGIN_LOCKED', success=False, email=email)
            resp = Response({'error': 'Too many failed sign-in attempts. Try again later.', 'code': 'LOCKED'},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
            resp['Retry-After'] = str(wait)
            return resp
        op = PlatformOperator.objects.filter(email__iexact=email).first()
        ok = (op is not None and op.is_active and op.mfa_secret
              and verify_password(request.data.get('password') or '', op.password_hash))
        step = None
        if ok:
            from core.crypto import CryptoUnavailable
            try:
                step = totp.verify(op.get_mfa_secret(), request.data.get('otp'))
            except CryptoUnavailable:
                # No key / wrong key: refuse (never compare against plaintext).
                audit(request, 'LOGIN_FAILED', success=False, email=email, detail={'reason': 'mfa_key'})
                return Response({'error': 'Platform sign-in is not configured on this server.',
                                 'code': 'MFA_UNAVAILABLE'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if not ok or step is None or step <= op.mfa_last_step:
            throttle.record_login(email, ip, success=False, kind=AuthAttempt.PLATFORM)
            audit(request, 'LOGIN_FAILED', success=False, email=email)
            # One answer for every failure (unknown email, password, code, disabled).
            return Response({'error': 'Sign-in failed. Check your email, password and authenticator code.',
                             'code': 'INVALID_CREDENTIALS'}, status=status.HTTP_401_UNAUTHORIZED)
        throttle.record_login(email, ip, success=True, kind=AuthAttempt.PLATFORM)
        PlatformOperator.objects.filter(id=op.id).update(mfa_last_step=step, last_login_at=datetime.datetime.now())
        audit(request, 'LOGIN', operator=op)
        return Response({'token': issue_token(op), 'operator': _operator_map(op),
                         'expiresInMinutes': settings.PLATFORM_TOKEN_MINUTES})


class LogoutView(_Platform):
    def post(self, request):
        PlatformOperator.objects.filter(id=request.user.id).update(token_version=request.user.token_version + 1)
        audit(request, 'LOGOUT')
        return Response({'message': 'Signed out.'})


class MeView(_Platform):
    def get(self, request):
        return Response(_operator_map(request.user))


def _operator_map(op):
    from .models import PERMISSIONS
    return {'id': op.id, 'email': op.email, 'fullName': op.full_name, 'role': op.role,
            'permissions': sorted(PERMISSIONS.get(op.role, set()))}


# ------------------------------------------------------------------ firms -----
CONTACT = {'officeEmail': 'office_email', 'officePhone': 'office_phone', 'officeAddress': 'office_address',
           'city': 'city', 'state': 'state', 'country': 'country', 'pinCode': 'pin_code', 'website': 'website'}


def _firm_map(f, counts=None, detail=False):
    s = FirmSettings.objects.filter(firm=f).first()
    out = {'publicId': str(f.public_id), 'name': f.name, 'slug': f.slug, 'status': f.status,
           'planCode': f.plan_code, 'createdAt': f.created_at, 'updatedAt': f.updated_at,
           'displayName': getattr(s, 'display_name', '') or f.name}
    if detail and s is not None:
        # Firm contact metadata (operational), never the firm's business data.
        out['contact'] = {k: getattr(s, v) for k, v in CONTACT.items()}
        out['timeZone'], out['currency'] = s.time_zone, s.currency
    if counts is not None:
        out['members'] = counts
    return out


def _member_counts(firm_ids):
    out = {}
    for row in (FirmMembership.objects.filter(firm_id__in=firm_ids)
                .values('firm_id', 'status').annotate(n=Count('id'))):
        out.setdefault(row['firm_id'], {})[row['status']] = row['n']
    return out


def _firm(public_id):
    return Firm.objects.filter(public_id=public_id).first()


class FirmsView(_Platform):
    def get_permissions(self):
        return [RequireOperator('firm.create' if self.request.method == 'POST' else 'firm.read')()]

    def get(self, request):
        qs = Firm.objects.order_by('name')
        if request.query_params.get('status'):
            qs = qs.filter(status=request.query_params['status'].upper())
        firms = list(qs)
        counts = _member_counts([f.id for f in firms])
        return Response([_firm_map(f, counts.get(f.id, {})) for f in firms])

    def post(self, request):
        d = request.data
        key = request.headers.get('Idempotency-Key') or d.get('idempotencyKey')
        try:
            firm, inv, _token, created = provisioning.provision_firm(
                name=d.get('name'), slug=d.get('slug'), admin_email=d.get('adminEmail'),
                admin_name=d.get('adminName') or '', plan_code=d.get('planCode') or '',
                operator=request.user, idempotency_key=key)
        except provisioning.ProvisioningError as exc:
            audit(request, 'FIRM_CREATE', success=False, detail={'code': exc.code, 'slug': d.get('slug')})
            return Response({'error': str(exc), 'code': exc.code}, status=exc.status)
        if created:
            contact = d.get('contact') or {}
            from core.validators import check_payload
            cleaned, bad = check_payload(contact, {'officeEmail': 'email', 'officePhone': 'landline',
                                                   'pinCode': 'pincode'})
            if bad is None and cleaned:
                s = FirmSettings.objects.get(firm=firm)
                for k, field in CONTACT.items():
                    if cleaned.get(k):
                        setattr(s, field, str(cleaned[k])[:s._meta.get_field(field).max_length or 500])
                s.save()
            audit(request, 'FIRM_CREATE', firm_id=firm.id, detail={'slug': firm.slug, 'invitation': inv.id})
        if inv is not None:
            # The email was attempted when provisioning committed: report what
            # happened (SENT / FAILED / CONSOLE), not the state before sending.
            inv.refresh_from_db()
        return Response({'firm': _firm_map(firm), 'invitation': _invitation_map(inv) if inv else None,
                         'created': created},
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class FirmDetailView(_Platform):
    def get_permissions(self):
        return [RequireOperator('firm.update' if self.request.method == 'PATCH' else 'firm.read')()]

    def get(self, request, public_id):
        f = _firm(public_id)
        if f is None:
            return Response({'error': 'Firm not found'}, status=status.HTTP_404_NOT_FOUND)
        out = _firm_map(f, _member_counts([f.id]).get(f.id, {}), detail=True)
        admin_inv = f.invitations.filter(kind=FirmInvitation.FIRM_ADMIN).order_by('-created_at').first()
        out['adminInvitation'] = _invitation_map(admin_inv) if admin_inv else None
        return Response(out)

    def patch(self, request, public_id):
        """Operational metadata only: name / display name / plan code."""
        f = _firm(public_id)
        if f is None:
            return Response({'error': 'Firm not found'}, status=status.HTTP_404_NOT_FOUND)
        changed = {}
        name = request.data.get('name')
        if name is not None:
            name = ' '.join(str(name).split())
            if not (2 <= len(name) <= 200):
                return Response({'error': 'Give the firm a name (2-200 characters).'}, status=400)
            changed['name'] = name
        if 'planCode' in request.data:
            changed['plan_code'] = str(request.data.get('planCode') or '')[:40]
        if changed:
            Firm.objects.filter(id=f.id).update(**changed)
        s, _ = FirmSettings.objects.get_or_create(firm=f, defaults={'display_name': f.name})
        if request.data.get('displayName') is not None:
            s.display_name = str(request.data['displayName'])[:200]
            changed['display_name'] = True
        contact = request.data.get('contact') or {}
        from core.validators import check_payload
        cleaned, bad = check_payload(contact, {'officeEmail': 'email', 'officePhone': 'landline', 'pinCode': 'pincode'})
        if bad is not None:
            return bad
        for k, field in CONTACT.items():
            if k in cleaned:
                setattr(s, field, str(cleaned[k] or '')[:s._meta.get_field(field).max_length or 500])
                changed[field] = True
        s.save()
        audit(request, 'FIRM_UPDATE', firm_id=f.id, detail={'fields': sorted(changed)})
        f.refresh_from_db()
        return Response(_firm_map(f, detail=True))


class FirmLifecycleView(_Platform):
    """POST .../activate | suspend | reactivate"""
    permission_classes = [RequireOperator('firm.lifecycle')]

    def post(self, request, public_id, action):
        f = _firm(public_id)
        if f is None:
            return Response({'error': 'Firm not found'}, status=status.HTTP_404_NOT_FOUND)
        if action == 'suspend':
            if f.status == Firm.SUSPENDED:
                return Response({'error': 'The firm is already suspended.'}, status=409)
            services.suspend_firm(f, reason=str(request.data.get('reason') or ''))
        elif action in ('activate', 'reactivate'):
            if f.status == Firm.ACTIVE:
                return Response({'error': 'The firm is already active.'}, status=409)
            if f.status == Firm.CLOSED:
                return Response({'error': 'A closed firm cannot be reactivated here.'}, status=409)
            # Only a firm whose administrator has accepted can run.
            from rbac.firm_roles import active_admin_ids
            if not active_admin_ids(f):
                return Response({'error': 'The firm has no active administrator yet (the invitation has '
                                          'not been accepted).', 'code': 'NO_ADMIN'}, status=409)
            services.reactivate_firm(f)
        else:
            return Response({'error': 'Unknown action'}, status=404)
        audit(request, f'FIRM_{action.upper()}', firm_id=f.id,
              detail={'reason': str(request.data.get('reason') or '')[:200]})
        f.refresh_from_db()
        return Response(_firm_map(f))


class FirmUsageView(_Platform):
    """Counts only - never contents."""
    permission_classes = [RequireOperator('firm.read')]

    def get(self, request, public_id):
        from core.models import Case, Client, Document, Invoice
        from rbac.firm_roles import firm_roles
        f = _firm(public_id)
        if f is None:
            return Response({'error': 'Firm not found'}, status=status.HTTP_404_NOT_FOUND)
        docs = Document.objects.filter(firm_id=f.id)
        return Response({
            'members': _member_counts([f.id]).get(f.id, {}),
            'roles': firm_roles(f).count(),
            'cases': Case.objects.filter(firm_id=f.id).count(),
            'clients': Client.objects.filter(firm_id=f.id).count(),
            'documents': docs.count(),
            'storageBytes': docs.aggregate(n=Sum('file_size'))['n'] or 0,
            'invoices': Invoice.objects.filter(firm_id=f.id).count(),
            'pendingInvitations': sum(1 for i in f.invitations.all() if i.status == 'PENDING'),
        })


def _invitation_map(i):
    return {'id': i.id, 'email': i.email, 'kind': i.kind, 'status': i.status, 'expiresAt': i.expires_at,
            'createdAt': i.created_at, 'acceptedAt': i.accepted_at, 'revokedAt': i.revoked_at,
            'sendCount': i.send_count, 'deliveryStatus': i.delivery_status,
            'deliveryError': i.delivery_error, 'lastSentAt': i.last_sent_at}


class FirmInvitationsView(_Platform):
    """GET: the firm's administrator invitations (operators don't see staff invitations)."""
    permission_classes = [RequireOperator('firm.read')]

    def get(self, request, public_id):
        f = _firm(public_id)
        if f is None:
            return Response({'error': 'Firm not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response([_invitation_map(i) for i in
                         f.invitations.filter(kind=FirmInvitation.FIRM_ADMIN).order_by('-created_at')])


class FirmInvitationActionView(_Platform):
    """POST .../invitations/<id>/resend | revoke (administrator invitations)."""
    permission_classes = [RequireOperator('invite.manage')]

    def post(self, request, public_id, invitation_id, action):
        f = _firm(public_id)
        inv = (FirmInvitation.objects.filter(id=invitation_id, firm=f, kind=FirmInvitation.FIRM_ADMIN).first()
               if f else None)
        if inv is None:
            return Response({'error': 'Invitation not found'}, status=status.HTTP_404_NOT_FOUND)
        try:
            if action == 'resend':
                inv, _t = invitations.resend(inv)
            elif action == 'revoke':
                inv = invitations.revoke(inv)
            else:
                return Response({'error': 'Unknown action'}, status=404)
        except invitations.InvitationError as exc:
            return Response({'error': str(exc), 'code': exc.code}, status=exc.status)
        audit(request, f'INVITATION_{action.upper()}', firm_id=f.id, detail={'invitation': inv.id})
        return Response(_invitation_map(inv))


class StatsView(_Platform):
    """Dashboard numbers, all computed from the database."""
    permission_classes = [RequireOperator('firm.read')]

    def get(self, request):
        by_status = dict(Firm.objects.values_list('status').annotate(n=Count('id')))
        week = datetime.datetime.now() - datetime.timedelta(days=7)
        pending = [i for i in FirmInvitation.objects.filter(kind=FirmInvitation.FIRM_ADMIN, accepted_at__isnull=True,
                                                            revoked_at__isnull=True) if i.status == 'PENDING']
        recent = list(Firm.objects.order_by('-created_at')[:5])
        return Response({
            'firms': {'total': sum(by_status.values()), **{k: by_status.get(k, 0) for k in
                                                           ('ACTIVE', 'PROVISIONING', 'SUSPENDED', 'CLOSED')}},
            'createdLast7Days': Firm.objects.filter(created_at__gte=week).count(),
            'pendingAdminInvitations': len(pending),
            'failedInvitationDeliveries': FirmInvitation.objects.filter(
                delivery_status='FAILED', accepted_at__isnull=True, revoked_at__isnull=True).count(),
            'recentFirms': [_firm_map(f) for f in recent],
        })


class AuditView(_Platform):
    permission_classes = [RequireOperator('audit.read')]

    def get(self, request):
        qs = PlatformAudit.objects.all()
        q = request.query_params
        if q.get('firm'):
            try:
                f = _firm(q['firm'])
            except Exception:                                  # noqa: BLE001 - not a uuid
                f = None
            qs = qs.filter(firm_id=f.id if f else -1)
        if q.get('action'):
            qs = qs.filter(action__icontains=q['action'])
        if q.get('operator'):
            qs = qs.filter(operator_email__icontains=q['operator'])
        if q.get('success') in ('true', 'false'):
            qs = qs.filter(success=q['success'] == 'true')
        # Keyset pages, newest first: ?limit= (1-200, default 50) and
        # ?before=<id of the last row seen> for the next page. `hasMore` says
        # whether older events exist, so a screen never implies that one page
        # is the whole history.
        try:
            limit = max(1, min(int(q.get('limit') or 50), 200))
        except ValueError:
            limit = 50
        if (q.get('before') or '').isdigit():
            qs = qs.filter(id__lt=int(q['before']))
        rows = list(qs.order_by('-id')[:limit + 1])
        more = len(rows) > limit
        rows = rows[:limit]
        return Response({
            'results': [{'id': r.id, 'at': r.at, 'operator': r.operator_email, 'action': r.action,
                         'firmId': r.firm_id, 'success': r.success, 'detail': r.detail} for r in rows],
            'hasMore': more,
            'nextBefore': rows[-1].id if more and rows else None,
        })
