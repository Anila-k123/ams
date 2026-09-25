"""The Client role's API.

- /api/client/...: for a signed-in CLIENT user (normal AMS login; clientaccess.gate
  has set request.client_id). Read-only apart from their own password, and every
  query is limited to that client_id through clientaccess/scope.py.
- /api/clients/<id>/logins...: for the FIRM (CLIENT_EDIT, practice-scoped). Create a
  client login, resend the set-password link, switch access off/on.
- /api/client-auth/set-password: public; accepts a one-time link and sets the password.
- /api/documents/<id>/client-visible: for the firm (DOCUMENT_EDIT); share a document.
"""

import datetime
import hashlib
import json
import logging
import os
import secrets
import uuid

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Sum
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from core.jwt import generate_token
from core.models import Advocate, AdvocateRole, AuditLog, CaseEvent, Client, Document, NotificationQueue, Role
from core.passwords import hash_password
from core.permissions import RequirePermission
from core.practice import practice_ids
from workspace.models import CaseParty, HearingDetail

from . import scope
from .gate import CLIENT_ROLE
from .models import ClientInvite, ClientUser

log = logging.getLogger(__name__)
INVITE_TTL = datetime.timedelta(hours=72)
MIN_PASSWORD = 8


# --- helpers ------------------------------------------------------------------

def _hash(raw):
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def _branding_url(path):
    return '/api/profile/files/branding/' + os.path.basename(path.replace('\\', '/')) if path else None


def _firm(client):
    owner = scope.firm_owner(client) if client else None
    if owner is None:
        return None
    return {'name': owner.office_name or owner.full_name, 'advocateName': owner.full_name,
            'address': owner.office_address or owner.address, 'phone': owner.office_phone or owner.phone,
            'email': owner.office_email or owner.email, 'logoUrl': _branding_url(owner.office_logo_path)}


def _audit(request, client, verb, title, entity_type=None, entity_id=None):
    """What a client did, recorded against their firm (the audit middleware skips
    client users). Never raises."""
    owner = scope.firm_owner(client) if client else None
    if owner is None:
        return
    try:
        AuditLog.objects.create(
            action_type=f'CLIENT_{verb}', title=title[:255], description=title[:255], module='CLIENT_ACCESS',
            entity_type=entity_type or 'Client', entity_id=entity_id, status='SUCCESS',
            user_name=f'{request.user.email} (client)'[:255],
            ip_address=request.META.get('REMOTE_ADDR', '')[:255], device='client',
            browser=request.META.get('HTTP_USER_AGENT', '')[:255], operating_system='',
            request_method=request.method, request_uri=request.path[:255],
            metadata=json.dumps({'origin': request.META.get('HTTP_ORIGIN', '')}),
            created_at=timezone.now(), advocate_id=owner.id)
    except Exception:
        log.exception('client audit failed')


def issue_invite(client_user):
    """A fresh one-time set-password link; older unused links stop working."""
    now = timezone.now()
    ClientInvite.objects.filter(client_user=client_user, used_at__isnull=True).update(used_at=now)
    raw = secrets.token_urlsafe(32)
    ClientInvite.objects.create(client_user=client_user, token_hash=_hash(raw), expires_at=now + INVITE_TTL)
    return f"{settings.CLIENT_APP_URL.rstrip('/')}/set-password?token={raw}"


def _send(to, subject, body):
    try:
        send_mail(subject=subject, message=body, from_email=settings.DEFAULT_FROM_EMAIL,
                  recipient_list=[to], fail_silently=False)
        return True
    except Exception as exc:
        log.warning('client invite email failed: %s', type(exc).__name__)
        return False


class IsClientUser(BasePermission):
    def has_permission(self, request, view):
        return getattr(request, 'client_id', None) is not None


class _ClientView(APIView):
    """Default AMS authentication; the gate has already confined the user to /api/client/."""
    permission_classes = [IsClientUser]

    @property
    def client_id(self):
        return self.request.client_id

    def client(self):
        return Client.objects.filter(id=self.client_id).first()


# --- client side ----------------------------------------------------------------

def _event(ev):
    d = HearingDetail.objects.filter(event_id=ev.id).first()
    return {'id': ev.id, 'title': ev.title, 'type': ev.event_type, 'date': ev.date, 'time': ev.time,
            'description': ev.description, 'court': d.court if d else None, 'bench': d.bench_hall if d else None,
            'judge': d.judge if d else None, 'purpose': d.purpose if d else None,
            'outcome': d.outcome if d else None}


def _next_hearing(case_id):
    ev = CaseEvent.objects.filter(case_id=case_id, date__gte=datetime.date.today()).order_by('date', 'time').first()
    return _event(ev) if ev else None


def _case_row(c):
    return {'id': c.id, 'caseNumber': c.case_number, 'caseTitle': c.case_title, 'caseType': c.case_type,
            'courtLevel': c.court_level, 'status': c.status, 'createdAt': c.created_at,
            'advocateName': c.advocate.full_name if c.advocate_id else None, 'nextHearing': _next_hearing(c.id),
            'fees': {'agreed': c.total_client_agreed_amount, 'paid': c.total_paid_by_client,
                     'pending': c.pending_from_client}}


def _invoice_row(i):
    return {'id': i.id, 'invoiceNumber': i.invoice_number, 'amount': i.amount, 'invoiceDate': i.invoice_date,
            'dueDate': i.due_date, 'status': i.status, 'caseId': i.case_id,
            'caseNumber': i.case.case_number if i.case_id else None}


def _document_row(d):
    return {'id': d.id, 'name': d.document_name, 'originalName': d.original_name, 'fileType': d.file_type,
            'fileSize': d.file_size, 'category': d.category, 'version': d.version, 'uploadedAt': d.upload_date,
            'caseId': d.case_id, 'caseNumber': d.case.case_number if d.case_id else None}


class ClientMeView(_ClientView):
    """GET /api/client/me -> who they are, which client, which firm"""

    def get(self, request):
        c = self.client()
        return Response({'id': request.user.id, 'email': request.user.email, 'fullName': request.user.full_name,
                         'client': {'id': c.id, 'name': c.name, 'email': c.email, 'phone': c.phone,
                                    'address': c.address},
                         'firm': _firm(c)})


class ClientOverviewView(_ClientView):
    """GET /api/client/overview"""

    def get(self, request):
        cid = self.client_id
        case_ids = list(scope.cases(cid).values_list('id', flat=True))
        upcoming = (CaseEvent.objects.filter(case_id__in=case_ids, date__gte=datetime.date.today())
                    .select_related('case').order_by('date', 'time')[:5])
        unpaid = scope.invoices(cid).exclude(status__iexact='PAID')
        return Response({
            'activeCases': scope.cases(cid).exclude(status__iexact='Closed').count(),
            'totalCases': len(case_ids),
            'upcomingHearings': [{**_event(e), 'caseId': e.case_id, 'caseNumber': e.case.case_number}
                                 for e in upcoming],
            'outstandingInvoices': unpaid.count(),
            'outstandingAmount': unpaid.aggregate(s=Sum('amount'))['s'] or 0,
            'sharedDocuments': scope.documents(cid).count(),
        })


class ClientCasesView(_ClientView):
    """GET /api/client/cases"""

    def get(self, request):
        return Response([_case_row(c) for c in scope.cases(self.client_id).order_by('-created_at', '-id')])


class ClientCaseDetailView(_ClientView):
    """GET /api/client/cases/<id>"""

    def get(self, request, pk):
        c = scope.cases(self.client_id).filter(id=pk).first()
        if c is None:
            return Response({'error': 'Case not found.'}, status=404)
        return Response({
            **_case_row(c), 'description': c.description,
            'hearings': [_event(e) for e in CaseEvent.objects.filter(case_id=c.id).order_by('-date', '-time')],
            'parties': [{'name': p.name, 'role': p.role, 'counsel': p.counsel, 'isOpponent': p.is_opponent}
                        for p in CaseParty.objects.filter(case_id=c.id).order_by('id')],
            'invoices': [_invoice_row(i) for i in scope.invoices(self.client_id).filter(case_id=c.id)
                         .order_by('-invoice_date')],
            'documents': [_document_row(d) for d in scope.documents(self.client_id).filter(case_id=c.id)
                          .order_by('-upload_date')],
        })


class ClientInvoicesView(_ClientView):
    """GET /api/client/invoices"""

    def get(self, request):
        return Response([_invoice_row(i) for i in scope.invoices(self.client_id).order_by('-invoice_date', '-id')])


class ClientInvoicePdfView(_ClientView):
    """GET /api/client/invoices/<id>/pdf -> the firm's GST tax invoice"""

    def get(self, request, pk):
        from invoices.models import FirmBillingProfile, InvoiceItem, InvoiceTaxDetail
        from reports.pdf import build_invoice_pdf, letterhead_from_advocate
        inv = scope.invoices(self.client_id).select_related('client').filter(id=pk).first()
        if inv is None:
            return Response({'error': 'Invoice not found.'}, status=404)
        client = self.client()
        owner = scope.firm_owner(client)
        pdf = build_invoice_pdf(inv, list(InvoiceItem.objects.filter(invoice_id=inv.id)),
                                InvoiceTaxDetail.objects.filter(invoice_id=inv.id).first(),
                                FirmBillingProfile.objects.filter(advocate_id=owner.id).first() if owner else None,
                                branding=letterhead_from_advocate(owner) if owner else None)
        _audit(request, client, 'DOWNLOAD', f'{request.user.email} downloaded invoice {inv.invoice_number}',
               'Invoice', inv.id)
        resp = HttpResponse(pdf, content_type='application/pdf')
        resp['Content-Disposition'] = f'attachment; filename="{inv.invoice_number}.pdf"'
        return resp


class ClientPaymentsView(_ClientView):
    """GET /api/client/payments"""

    def get(self, request):
        return Response([{'id': p.id, 'amount': p.amount, 'date': p.payment_date, 'mode': p.payment_mode,
                          'reference': p.reference_number, 'description': p.description,
                          'caseNumber': p.case.case_number if p.case_id else None}
                         for p in scope.payments(self.client_id).select_related('case')
                         .order_by('-payment_date', '-id')])


class ClientDocumentsView(_ClientView):
    """GET /api/client/documents -> documents the firm has shared"""

    def get(self, request):
        return Response([_document_row(d) for d in scope.documents(self.client_id).order_by('-upload_date', '-id')])


class ClientDocumentFileView(_ClientView):
    """GET /api/client/documents/<id>/file[?inline=1]"""

    def get(self, request, pk):
        d = scope.documents(self.client_id).filter(id=pk).first()
        if d is None or not d.file_path or not os.path.isfile(d.file_path):
            return Response({'error': 'Document not found.'}, status=404)
        _audit(request, self.client(), 'DOWNLOAD', f'{request.user.email} opened document "{d.document_name}"',
               'Document', d.id)
        resp = FileResponse(open(d.file_path, 'rb'), content_type=d.file_type or 'application/octet-stream')
        disposition = 'inline' if request.query_params.get('inline') == '1' else 'attachment'
        resp['Content-Disposition'] = f'{disposition}; filename="{d.original_name}"'
        return resp


class ClientMessagesView(_ClientView):
    """GET /api/client/messages -> the emails the firm sent this client (client_events.py)"""

    def get(self, request):
        cid = self.client_id
        rows = (NotificationQueue.objects.filter(payload_json__contains=f'"clientId": {cid}')
                .order_by('-created_at')[:100])
        out = []
        for r in rows:
            try:
                p = json.loads(r.payload_json or '{}')
            except ValueError:
                continue
            if p.get('clientId') == cid and p.get('channel') == 'EMAIL':
                out.append({'id': r.id, 'type': r.type, 'subject': p.get('subject'), 'body': p.get('body'),
                            'caseId': p.get('caseId'), 'createdAt': r.created_at})
        return Response(out[:50])


# --- public: set password from a one-time link -----------------------------------

class SetPasswordView(APIView):
    """POST /api/client-auth/set-password {token, password} -> signed in (same token as /login)"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        password = request.data.get('password') or ''
        if len(password) < MIN_PASSWORD:
            return Response({'error': f'Use at least {MIN_PASSWORD} characters.'}, status=400)
        raw = request.data.get('token') or ''
        invite = (ClientInvite.objects.select_related('client_user')
                  .filter(token_hash=_hash(raw), used_at__isnull=True, expires_at__gte=timezone.now()).first()) \
            if raw else None
        link = invite.client_user if invite else None
        advocate = Advocate.objects.filter(id=link.advocate_id).first() if link else None
        client = Client.objects.filter(id=link.client_id, deleted=False).first() if link else None
        if invite is None or advocate is None or client is None or advocate.left_on is not None:
            return Response({'error': 'This link has expired or was already used. Ask your advocate for a new one.'},
                            status=400)
        with transaction.atomic():
            invite.used_at = timezone.now()
            invite.save(update_fields=['used_at'])
            advocate.password = hash_password(password)
            advocate.save(update_fields=['password'])
            link.activated_at = link.activated_at or timezone.now()
            link.last_login_at = timezone.now()
            link.save(update_fields=['activated_at', 'last_login_at'])
        return Response({'token': generate_token(advocate), 'role': 'CLIENT', 'fullName': advocate.full_name,
                         'theme': advocate.theme})


# --- firm side --------------------------------------------------------------------

def _scoped_client(user, client_id):
    return Client.objects.filter(id=client_id, advocate_id__in=practice_ids(user), deleted=False).first()


def _login_row(link):
    a = Advocate.objects.filter(id=link.advocate_id).first()
    pending = ClientInvite.objects.filter(client_user=link, used_at__isnull=True,
                                          expires_at__gte=timezone.now()).exists()
    status = ('DISABLED' if a.left_on is not None else 'ACTIVE' if link.activated_at
              else 'INVITED' if pending else 'INVITE_EXPIRED')
    return {'id': link.id, 'email': a.email, 'fullName': a.full_name, 'isActive': a.left_on is None,
            'status': status, 'invitedAt': link.created_at, 'activatedAt': link.activated_at,
            'lastLoginAt': link.last_login_at}


def client_role():
    role, _ = Role.objects.get_or_create(name=CLIENT_ROLE, defaults={
        'description': 'A firm\'s client: sees only their own cases, invoices and shared documents.',
        'created_at': timezone.now()})
    return role


class _FirmView(APIView):
    permission_classes = [RequirePermission('CLIENT_EDIT')]


class ClientLoginsView(_FirmView):
    """GET  /api/clients/<id>/logins                  -> this client's logins
    POST /api/clients/<id>/logins {email, fullName} -> create a login (or resend its link)"""

    def get(self, request, client_id):
        client = _scoped_client(request.user, client_id)
        if client is None:
            return Response({'error': 'Client not found.'}, status=404)
        return Response([_login_row(l) for l in ClientUser.objects.filter(client_id=client.id).order_by('id')])

    def post(self, request, client_id):
        client = _scoped_client(request.user, client_id)
        if client is None:
            return Response({'error': 'Client not found.'}, status=404)
        email = (request.data.get('email') or client.email or '').strip().lower()
        if '@' not in email:
            return Response({'error': 'Enter the email address for the login.'}, status=400)
        advocate = Advocate.objects.filter(email__iexact=email).first()
        link = ClientUser.objects.filter(advocate_id=advocate.id).first() if advocate else None
        if advocate is not None and (link is None or link.client_id != client.id):
            return Response({'error': 'That email already has an AMS login.'}, status=409)
        full_name = (request.data.get('fullName') or '').strip()
        with transaction.atomic():
            if advocate is None:
                advocate = Advocate.objects.create(
                    full_name=full_name or client.name or email, email=email,
                    # Unusable until the person sets a password from the emailed link.
                    password=hash_password(secrets.token_urlsafe(32)),
                    bar_council_id=f'CLIENT-{uuid.uuid4().hex[:16]}', role='CLIENT', theme='light',
                    experience=0, whatsapp_enabled=False, email_notifications_enabled=False,
                    browser_notifications_enabled=False, parent_advocate_id=None)
                AdvocateRole.objects.create(advocate_id=advocate.id, role_id=client_role().id,
                                            assigned_at=timezone.now()) if hasattr(AdvocateRole, 'assigned_at') \
                    else AdvocateRole.objects.create(advocate_id=advocate.id, role_id=client_role().id)
                link = ClientUser.objects.create(advocate_id=advocate.id, client_id=client.id,
                                                 created_by_id=request.user.id)
            else:
                if full_name:
                    advocate.full_name = full_name
                advocate.left_on = None
                advocate.save(update_fields=['full_name', 'left_on'])
        url = issue_invite(link)
        firm = _firm(client) or {}
        sent = _send(email, f'Your login for {firm.get("name") or "your advocate"}',
                     f'Hello {advocate.full_name},\n\n{firm.get("advocateName") or "Your advocate"} has created a login '
                     f'for you to follow your cases, hearings, invoices and shared documents.\n\n'
                     f'Set your password within 72 hours:\n{url}\n')
        # The link is returned so the advocate can share it another way if email is down.
        return Response({**_login_row(link), 'inviteUrl': url, 'emailSent': sent}, status=201)


class ClientLoginDetailView(_FirmView):
    """PATCH /api/clients/<id>/logins/<login_id> {isActive}"""

    def patch(self, request, client_id, login_id):
        client = _scoped_client(request.user, client_id)
        link = ClientUser.objects.filter(id=login_id, client_id=client_id).first() if client else None
        if link is None:
            return Response({'error': 'Login not found.'}, status=404)
        if 'isActive' in request.data:
            a = Advocate.objects.get(id=link.advocate_id)
            a.left_on = None if request.data['isActive'] else datetime.date.today()
            a.save(update_fields=['left_on'])
        return Response(_login_row(link))


class DocumentClientVisibleView(APIView):
    """PUT /api/documents/<id>/client-visible {visible} -> share / unshare with the client"""
    permission_classes = [RequirePermission('DOCUMENT_EDIT')]

    def put(self, request, pk):
        doc = Document.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if doc is None:
            return Response({'error': 'Document not found.'}, status=404)
        if not (doc.case_id or doc.client_id):
            return Response({'error': 'Link the document to a case or client before sharing it.'}, status=400)
        doc.client_visible = bool(request.data.get('visible'))
        doc.save(update_fields=['client_visible'])
        return Response({'id': doc.id, 'clientVisible': doc.client_visible})
