"""Provision a new firm (tenant). One transaction:

  validate name + slug -> Firm (PROVISIONING) -> FirmSettings -> the firm's own
  default roles (rbac.firm_roles.provision_default_roles) -> the first
  administrator's identity + INVITED membership + the firm's administrator role
  (through the invitation) -> invitation -> audit.  The email goes out only
  after commit.

The firm becomes ACTIVE when that administrator accepts the invitation
(firms/invitations.py) - never merely because the record exists.

Idempotency: with a key, a retry with the same payload returns the same firm;
the same key with a different payload is refused. Without a key, a duplicate
slug is refused.

`plan_code` picks the firm's AMS plan (subscriptions app). It must be a
PUBLISHED plan (a draft only for a `test_firm` where test plans are enabled);
an unknown or unpublished code refuses the whole provisioning. Without one the
subscription is PENDING: the firm can sign in but add nothing until an
operator assigns an approved plan. Never a silent trial or Legacy.
"""
from __future__ import annotations

import hashlib
import json
import re

from django.db import IntegrityError, transaction

from rbac import firm_roles as fr

from . import invitations
from .models import Firm, FirmInvitation, FirmSettings, ProvisioningRequest

SLUG = re.compile(r'^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$')


class ProvisioningError(ValueError):
    def __init__(self, message, status=400, code='INVALID'):
        super().__init__(message)
        self.status = status
        self.code = code


def _payload_hash(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def provision_firm(*, name, slug, admin_email, admin_name='', plan_code='', operator=None,
                   idempotency_key=None, test_firm=False):
    """Returns (firm, invitation, token, created). `token` is None on an
    idempotent replay (the original email already went out)."""
    name = ' '.join((name or '').split())
    slug = (slug or '').strip().lower()
    if not (2 <= len(name) <= 200):
        raise ProvisioningError('Give the firm a name (2-200 characters).', 400, 'NAME')
    if not SLUG.match(slug):
        raise ProvisioningError('The slug may use a-z, 0-9 and dashes (3-50 characters).', 400, 'SLUG')
    payload = {'name': name, 'slug': slug, 'admin_email': (admin_email or '').strip().lower(),
               'plan_code': (plan_code or '').upper(), 'test_firm': bool(test_firm)}
    digest = _payload_hash(payload)
    if idempotency_key:
        done = ProvisioningRequest.objects.filter(key=idempotency_key).select_related('firm').first()
        if done is not None:
            if done.payload_hash != digest:
                raise ProvisioningError('This idempotency key was used with different details.', 409, 'KEY_REUSED')
            return done.firm, FirmInvitation.objects.filter(id=done.invitation_id).first(), None, False
    if Firm.objects.filter(slug=slug).exists():
        raise ProvisioningError('A firm with that slug already exists.', 409, 'SLUG_TAKEN')
    try:
        with transaction.atomic():
            firm = Firm.objects.create(name=name, slug=slug, status=Firm.PROVISIONING, plan_code='')
            FirmSettings.objects.create(firm=firm, display_name=name)
            # AMS subscription, same transaction as the firm: the chosen
            # published plan, or PENDING (see the module docstring).
            from subscriptions.service import SubscriptionError, start_subscription
            try:
                start_subscription(firm, (plan_code or '').upper() or None, test_firm=test_firm,
                                   actor=getattr(operator, 'email', None) or 'SYSTEM', reason='Firm provisioned')
            except SubscriptionError as exc:
                raise ProvisioningError(str(exc), exc.status, exc.code)
            roles = fr.provision_default_roles(firm)
            admin_role = next(r for r in roles.values() if r.is_admin)
            inv, token = invitations.create_invitation(
                firm, admin_email, FirmInvitation.FIRM_ADMIN, [admin_role.id],
                invited_by_type=FirmInvitation.PLATFORM, invited_by_id=getattr(operator, 'id', None),
                full_name=admin_name)
            if idempotency_key:
                ProvisioningRequest.objects.create(key=idempotency_key, payload_hash=digest, firm=firm,
                                                   invitation_id=inv.id)
    except StopIteration:
        raise ProvisioningError('System role templates are missing (no Super Admin template).', 500, 'TEMPLATES')
    except invitations.InvitationError as exc:
        raise ProvisioningError(str(exc), exc.status, exc.code)
    except IntegrityError:
        # A concurrent request with the same slug or key won the race.
        if idempotency_key:
            return provision_firm(name=name, slug=slug, admin_email=admin_email, admin_name=admin_name,
                                  plan_code=plan_code, operator=operator, idempotency_key=idempotency_key,
                                  test_firm=test_firm)
        raise ProvisioningError('A firm with that slug already exists.', 409, 'SLUG_TAKEN')
    return firm, inv, token, True
