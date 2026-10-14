"""Firm / membership state changes that end access (used by user management now
and by the Platform Admin console in Phase 5).

Access is re-checked against the database on every request (core/auth.py), so
suspension already stops existing tokens at once; the token version is bumped
as well so those tokens stay dead even if the firm or membership is restored.
"""
import datetime

from core.session import (FIRM_SUSPENDED, MEMBERSHIP_SUSPENDED, revoke_all, security_event)

from .models import Firm, FirmMembership


def suspend_membership(membership, actor=None, request=None):
    FirmMembership.objects.filter(id=membership.id).update(status=FirmMembership.SUSPENDED)
    revoke_all(membership.advocate_id, MEMBERSHIP_SUSPENDED)
    security_event('MEMBERSHIP_SUSPENDED', request, actor=actor, firm_id=membership.firm_id,
                   detail={'membership': membership.id, 'target': membership.advocate_id})


def end_membership(membership, actor=None, request=None):
    FirmMembership.objects.filter(id=membership.id).update(status=FirmMembership.LEFT,
                                                           left_at=datetime.datetime.now())
    revoke_all(membership.advocate_id, MEMBERSHIP_SUSPENDED)
    security_event('MEMBERSHIP_ENDED', request, actor=actor, firm_id=membership.firm_id,
                   detail={'membership': membership.id, 'target': membership.advocate_id})


def suspend_firm(firm, actor=None, request=None, reason=''):
    Firm.objects.filter(id=firm.id).update(status=Firm.SUSPENDED)
    for advocate_id in FirmMembership.objects.filter(firm=firm).values_list('advocate_id', flat=True):
        revoke_all(advocate_id, FIRM_SUSPENDED)
    security_event('FIRM_SUSPENDED', request, actor=actor, firm_id=firm.id, detail={'reason': reason[:200]})


def reactivate_firm(firm, actor=None, request=None):
    Firm.objects.filter(id=firm.id).update(status=Firm.ACTIVE)
    security_event('FIRM_REACTIVATED', request, actor=actor, firm_id=firm.id)
