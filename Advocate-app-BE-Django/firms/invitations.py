"""Invitations to a firm (first administrator, or staff) - create, resend,
revoke, accept.

- The token is 32 random bytes (secrets.token_urlsafe); only its SHA-256 is
  stored, and it never appears in logs or audit rows.
- Single use, expires after INVITATION_TTL_HOURS (72), revocable.
- Acceptance is one transaction with the invitation row locked
  (select_for_update), so two simultaneous clicks create one membership; the
  firm, the roles (still the firm's, still enabled) and the one-active-
  membership rule are checked again at that moment.
- Someone who already has an AMS login must prove it with their CURRENT
  password; only an identity created for this invitation sets a password here.
  An invitation can therefore never take over an existing account.
- The firm's first administrator accepting activates a PROVISIONING firm.
"""
from __future__ import annotations

import datetime
import hashlib
import secrets

from django.conf import settings
from django.core.mail import send_mail
from django.db import IntegrityError, transaction

from core.models import Advocate, AdvocateRole, Role
from core.passwords import hash_password, verify_password
from core.validators import password_error

from .models import Firm, FirmInvitation, FirmMembership


class InvitationError(ValueError):
    def __init__(self, message, status=400, code='INVALID'):
        super().__init__(message)
        self.status = status
        self.code = code


def _hash(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def _now():
    return datetime.datetime.now()


def _expiry():
    return _now() + datetime.timedelta(hours=settings.INVITATION_TTL_HOURS)


def _link(token):
    return f'{settings.CLIENT_APP_URL.rstrip("/")}/accept-invite?token={token}'


def _send(invitation, token):
    """Email the link once the surrounding transaction has committed."""
    firm_name = invitation.firm.name
    what = 'administer' if invitation.kind == FirmInvitation.FIRM_ADMIN else 'join'
    body = (f'You have been invited to {what} {firm_name} on AMS.\n\n'
            f'Open this link to accept (valid for {settings.INVITATION_TTL_HOURS} hours, once):\n'
            f'{_link(token)}\n\nIf you did not expect this, ignore this email.')

    inv_id = invitation.id

    def go():
        # Delivery is recorded, never silently lost: the platform and firm
        # screens show SENT / FAILED and offer "Resend". The reason is the
        # exception's class and a short message - the link is never stored.
        try:
            send_mail(f'Invitation to {firm_name} on AMS', body, settings.DEFAULT_FROM_EMAIL,
                      [invitation.email], fail_silently=False)
            # With the console / file mail backend (local testing) nothing is
            # emailed: say so, rather than claim it was sent.
            backend = settings.EMAIL_BACKEND or ''
            state = 'CONSOLE' if ('console' in backend or 'filebased' in backend) else 'SENT'
            FirmInvitation.objects.filter(id=inv_id).update(delivery_status=state, delivery_error='',
                                                            last_sent_at=_now())
        except Exception as exc:                               # noqa: BLE001
            reason = f'{type(exc).__name__}: {exc}'.replace(token, '[link]')[:200]
            FirmInvitation.objects.filter(id=inv_id).update(delivery_status='FAILED', delivery_error=reason)
            import logging
            logging.getLogger('firms.invitations').warning('invitation %s email failed: %s', inv_id,
                                                           type(exc).__name__)
    transaction.on_commit(go)


def _identity_for(email, full_name):
    """(advocate, created). An existing login is reused, never altered here."""
    existing = Advocate.objects.filter(email__iexact=email).order_by('id').first()
    if existing is not None:
        return existing, False
    adv = Advocate.objects.create(
        full_name=(full_name or email.split('@')[0])[:255], email=email,
        # Unusable until the invitation is accepted: nobody knows this password.
        password=hash_password(secrets.token_urlsafe(32)),
        bar_council_id=f'PENDING-{secrets.token_hex(6)}', role='ADVOCATE', theme='light',
        whatsapp_enabled=False, email_notifications_enabled=True, browser_notifications_enabled=True)
    return adv, True


def validate_roles(firm, role_ids):
    roles = list(Role.objects.filter(id__in=role_ids))
    if len(roles) != len(set(role_ids)) or any(r.firm_id != firm.id or r.disabled for r in roles):
        raise InvitationError('One of those roles does not belong to this firm.', 400, 'ROLE')
    return roles


def create_invitation(firm, email, kind, role_ids, *, invited_by_type, invited_by_id,
                      full_name='', team_root_id=None):
    """Invite `email` into `firm`. Returns (invitation, token). The membership
    is created INVITED; it becomes ACTIVE only when the invitation is accepted."""
    email = (email or '').strip()
    from core.validators import check_payload
    _data, bad = check_payload({'email': email}, {'email': 'email'})
    if bad is not None or not email:
        raise InvitationError('Enter a valid email address.', 400, 'EMAIL')
    roles = validate_roles(firm, role_ids)
    with transaction.atomic():
        adv, created = _identity_for(email, full_name)
        m, _ = FirmMembership.objects.get_or_create(
            firm=firm, advocate_id=adv.id,
            defaults={'kind': FirmMembership.STAFF, 'status': FirmMembership.INVITED,
                      'team_root_id': team_root_id or adv.parent_advocate_id or adv.id})
        if m.status == FirmMembership.ACTIVE:
            raise InvitationError('That person is already a member of this firm.', 409, 'ALREADY_MEMBER')
        # Any earlier pending invitation for the same person and firm is replaced.
        FirmInvitation.objects.filter(firm=firm, advocate_id=adv.id, accepted_at__isnull=True,
                                      revoked_at__isnull=True).update(revoked_at=_now())
        token = secrets.token_urlsafe(32)
        inv = FirmInvitation.objects.create(
            firm=firm, email=adv.email, kind=kind, role_ids=[r.id for r in roles], team_root_id=team_root_id,
            advocate_id=adv.id, new_identity=created, token_hash=_hash(token), expires_at=_expiry(),
            invited_by_type=invited_by_type, invited_by_id=invited_by_id)
        _send(inv, token)
    return inv, token


def resend(invitation):
    """A fresh token and expiry for a pending (or expired) invitation."""
    if invitation.status in ('ACCEPTED', 'REVOKED'):
        raise InvitationError(f'This invitation is {invitation.status.lower()}.', 409, invitation.status)
    token = secrets.token_urlsafe(32)
    with transaction.atomic():
        FirmInvitation.objects.filter(id=invitation.id).update(
            token_hash=_hash(token), expires_at=_expiry(), send_count=invitation.send_count + 1,
            delivery_status='PENDING', delivery_error='')
        invitation.refresh_from_db()
        _send(invitation, token)
    return invitation, token


def revoke(invitation):
    if invitation.accepted_at:
        raise InvitationError('This invitation was already accepted.', 409, 'ACCEPTED')
    FirmInvitation.objects.filter(id=invitation.id, revoked_at__isnull=True).update(revoked_at=_now())
    invitation.refresh_from_db()
    return invitation


# Why a link no longer works. Only the holder of the link learns this (the
# token is the lookup key), so it reveals nothing to anyone else.
_NOT_PENDING = {
    'EXPIRED': 'This invitation has expired. Ask the firm to send a new one.',
    'REVOKED': 'This invitation was withdrawn by the firm.',
    'ACCEPTED': 'This invitation was already used. Sign in with your email and password.',
}


def _usable(inv):
    if inv is None:
        raise InvitationError('This invitation link is not valid any more.', 400, 'INVALID')
    if inv.status != 'PENDING':
        raise InvitationError(_NOT_PENDING.get(inv.status, 'This invitation link is not valid any more.'),
                              400, inv.status)


def preview(token):
    """What the acceptance page may show (firm name, email, whether a password
    must be set) - nothing about the firm's other members."""
    inv = FirmInvitation.objects.select_related('firm').filter(token_hash=_hash(token or '')).first()
    _usable(inv)
    return {'firm': inv.firm.name, 'email': inv.email, 'kind': inv.kind, 'newAccount': inv.new_identity}


def accept(token, password, full_name=''):
    """Accept an invitation. Returns the Advocate (now an ACTIVE member)."""
    with transaction.atomic():
        inv = (FirmInvitation.objects.select_for_update().select_related('firm')
               .filter(token_hash=_hash(token or '')).first())
        _usable(inv)
        firm = Firm.objects.select_for_update().get(id=inv.firm_id)
        if firm.status in (Firm.SUSPENDED, Firm.CLOSED):
            raise InvitationError('This firm is not accepting members right now.', 403, 'FIRM_UNAVAILABLE')
        adv = Advocate.objects.select_for_update().get(id=inv.advocate_id)
        if adv.left_on is not None:
            raise InvitationError('This account is no longer active.', 403, 'ACCOUNT_DISABLED')
        if inv.new_identity:
            problem = password_error(password, adv.email)
            if problem:
                raise InvitationError(problem, 400, 'PASSWORD')
            adv.password = hash_password(password)
            if full_name.strip():
                adv.full_name = full_name.strip()[:255]
            adv.save(update_fields=['password', 'full_name'])
        elif not verify_password(password or '', adv.password):
            # An existing login: only its owner can accept on its behalf.
            raise InvitationError('Enter the current password of this AMS account.', 403, 'WRONG_PASSWORD')
        other = FirmMembership.objects.filter(advocate_id=adv.id, status=FirmMembership.ACTIVE).exclude(firm=firm)
        if other.exists():
            raise InvitationError('This account is already an active member of another firm.', 409, 'OTHER_FIRM')
        roles = validate_roles(firm, inv.role_ids)        # still this firm's, still enabled
        m = FirmMembership.objects.select_for_update().get(firm=firm, advocate_id=adv.id)
        try:
            with transaction.atomic():
                FirmMembership.objects.filter(id=m.id).update(status=FirmMembership.ACTIVE, joined_at=_now(),
                                                              left_at=None)
        except IntegrityError:
            raise InvitationError('This account is already an active member of another firm.', 409, 'OTHER_FIRM')
        for r in roles:
            AdvocateRole.objects.get_or_create(advocate_id=adv.id, role_id=r.id,
                                               defaults={'firm_id': firm.id, 'membership_id': m.id})
        FirmInvitation.objects.filter(id=inv.id).update(accepted_at=_now())
        if inv.kind == FirmInvitation.FIRM_ADMIN and firm.status == Firm.PROVISIONING:
            Firm.objects.filter(id=firm.id).update(status=Firm.ACTIVE)
        from core.session import security_event
        security_event('INVITATION_ACCEPTED', None, actor=adv, firm_id=firm.id,
                       detail={'invitation': inv.id, 'kind': inv.kind})
    return adv
