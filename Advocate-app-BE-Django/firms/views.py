"""Firm administration of people (firm mode): staff invitations and membership
lifecycle; plus the public invitation acceptance endpoints.

Everything is limited to the caller's own firm (core.tenant.resolve_firm).
Roles offered in an invitation must be this firm's own; inviting follows the
same escalation rules as assigning a role (rbac/firm_roles.py): nobody can
hand out a permission they don't hold, and only a firm administrator can hand
out the administrator role.
"""
from django.db import transaction
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core import tenant
from core.permissions import RequirePermission
from core.models import Role
from rbac import firm_roles as fr

from . import invitations, services
from .models import FirmInvitation, FirmMembership

USER_MANAGE = [RequirePermission('USER_MANAGE')]


def _err(exc):
    return Response({'error': str(exc), 'code': getattr(exc, 'code', 'INVALID')},
                    status=getattr(exc, 'status', 400))


def _inv_map(i):
    return {'id': i.id, 'email': i.email, 'kind': i.kind, 'status': i.status, 'roleIds': i.role_ids,
            'expiresAt': i.expires_at, 'createdAt': i.created_at, 'acceptedAt': i.accepted_at,
            'revokedAt': i.revoked_at, 'sendCount': i.send_count, 'deliveryStatus': i.delivery_status,
            'deliveryError': i.delivery_error, 'lastSentAt': i.last_sent_at}


class StaffInvitationsView(APIView):
    """GET pending/past invitations of my firm; POST {email, roleIds, fullName?, teamRootId?}."""
    permission_classes = USER_MANAGE

    def get(self, request):
        firm = tenant.resolve_firm(request.user)
        rows = FirmInvitation.objects.filter(firm=firm).order_by('-created_at')
        wanted = (request.query_params.get('status') or '').upper()
        return Response([_inv_map(i) for i in rows if not wanted or i.status == wanted])

    def post(self, request):
        firm = tenant.resolve_firm(request.user)
        role_ids = [int(x) for x in (request.data.get('roleIds') or [])]
        if not role_ids:
            return Response({'error': 'Choose at least one role.'}, status=400)
        try:
            roles = invitations.validate_roles(firm, role_ids)
            for r in roles:
                fr.check_assignable(request.user, firm, r)
            team = request.data.get('teamRootId')
            if team and int(team) not in tenant.firm_member_ids(firm):
                return Response({'error': 'That team is not in this firm.'}, status=400)
            inv, _token = invitations.create_invitation(
                firm, request.data.get('email'), FirmInvitation.STAFF, role_ids,
                invited_by_type=FirmInvitation.MEMBER, invited_by_id=request.user.id,
                full_name=request.data.get('fullName') or '', team_root_id=int(team) if team else None)
        except (invitations.InvitationError, fr.RoleRuleError) as exc:
            return _err(exc)
        fr.audit(request.user, firm, 'INVITE', f'Invitation sent to {inv.email}', inv.id,
                 {'roles': role_ids})
        return Response(_inv_map(inv), status=status.HTTP_201_CREATED)


class StaffInvitationActionView(APIView):
    """POST /api/firm/invitations/<id>/resend | revoke"""
    permission_classes = USER_MANAGE

    def post(self, request, pk, action):
        firm = tenant.resolve_firm(request.user)
        inv = FirmInvitation.objects.filter(id=pk, firm=firm).first()
        if inv is None:
            return Response({'error': 'Invitation not found'}, status=404)
        try:
            if action == 'resend':
                inv, _t = invitations.resend(inv)
            elif action == 'revoke':
                inv = invitations.revoke(inv)
            else:
                return Response({'error': 'Unknown action'}, status=404)
        except invitations.InvitationError as exc:
            return _err(exc)
        fr.audit(request.user, firm, action.upper(), f'Invitation {action}: {inv.email}', inv.id)
        return Response(_inv_map(inv))


class MemberLifecycleView(APIView):
    """POST /api/firm/members/<advocate_id>/suspend | reactivate | end

    Work stays with the firm: nothing a member created is moved or deleted."""
    permission_classes = USER_MANAGE

    def post(self, request, advocate_id, action):
        firm = tenant.resolve_firm(request.user)
        m = FirmMembership.objects.filter(firm=firm, advocate_id=advocate_id, kind=FirmMembership.STAFF).first()
        if m is None:
            return Response({'error': 'Member not found'}, status=404)
        if action in ('suspend', 'end'):
            if m.advocate_id == request.user.id:
                return Response({'error': 'You cannot suspend or remove yourself.'}, status=400)
            if m.status != FirmMembership.ACTIVE:
                return Response({'error': 'This membership is not active.'}, status=409)
            if fr.active_admin_ids(firm) <= {m.advocate_id}:
                return Response({'error': 'This is the last active firm administrator.'}, status=409)
            # Suspending an administrator needs an administrator.
            admin_roles = Role.objects.filter(firm_id=firm.id, is_admin=True).values('id')
            from core.models import AdvocateRole
            if (AdvocateRole.objects.filter(advocate_id=m.advocate_id, role_id__in=admin_roles).exists()
                    and not fr.is_firm_admin(request.user, firm)):
                return Response({'error': 'Only a firm administrator can do this to an administrator.'},
                                status=403)
            (services.suspend_membership if action == 'suspend' else services.end_membership)(
                m, actor=request.user, request=request)
        elif action == 'reactivate':
            if m.status not in (FirmMembership.SUSPENDED, FirmMembership.LEFT):
                return Response({'error': 'This membership is not suspended.'}, status=409)
            if FirmMembership.objects.filter(advocate_id=m.advocate_id, status=FirmMembership.ACTIVE).exists():
                return Response({'error': 'This person is active in another firm.'}, status=409)
            with transaction.atomic():
                FirmMembership.objects.filter(id=m.id).update(status=FirmMembership.ACTIVE, left_at=None)
            from core.session import security_event
            security_event('MEMBERSHIP_REACTIVATED', request, actor=request.user, firm_id=firm.id,
                           detail={'target': m.advocate_id})
        else:
            return Response({'error': 'Unknown action'}, status=404)
        m.refresh_from_db()
        return Response({'advocateId': m.advocate_id, 'status': m.status})


# ------------------------------------------------------------- public ------
class InvitationPreviewView(APIView):
    """GET /api/invitations/preview?token=... - firm name, email, whether a
    password must be chosen. Nothing about the firm's members."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        try:
            return Response(invitations.preview(request.query_params.get('token')))
        except invitations.InvitationError as exc:
            return _err(exc)

    def post(self, request):
        # Preferred: the one-time token in the body, so it never reaches
        # access logs or proxies as part of a URL (GET kept for old links).
        try:
            return Response(invitations.preview(request.data.get('token')))
        except invitations.InvitationError as exc:
            return _err(exc)


class InvitationAcceptView(APIView):
    """POST /api/invitations/accept {token, password, fullName?}.

    Joins the firm but does not sign in: the person then signs in through the
    normal login page, so every sign-in goes through the same checks."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            adv = invitations.accept(request.data.get('token'), request.data.get('password') or '',
                                     request.data.get('fullName') or '')
        except invitations.InvitationError as exc:
            return _err(exc)
        return Response({'accepted': True, 'email': adv.email, 'fullName': adv.full_name})
