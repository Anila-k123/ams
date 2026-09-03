"""Staff-to-staff notifications for the advocate-led billing hand-off.

Client-facing emails live in `client_events`; this is the internal loop between
the advocate who raises a bill and the accountant who collects it:

    advocate raises invoice  -> accountants (and the team's finance viewers) are
                                told to collect
    payment recorded         -> the case's advocates are told it is settled

Fires inline on the request (like client_events) and delivers immediately, so a
new invoice reaches the accountant's bell/inbox at once. Never raises - a
notification must not fail the invoice or payment it reports. Recipients are
role-relevant (INVOICE_VIEW / CASE_VIEW) via the same helpers the scheduled
reminders use, and the person who performed the action is not pinged about it.
"""

from __future__ import annotations

import logging

from core.practice import alert_members, firm_wide_members
from notifications import service
from notifications.events import _channels

log = logging.getLogger(__name__)


def _money(amount):
    try:
        return 'Rs. {:,.2f}'.format(float(amount or 0))
    except (TypeError, ValueError):
        return str(amount)


def _fanout_now(recipients, event_type, subject, body, *, actor_id=None,
                case_id=None, client_id=None, entity=None, entity_id=None):
    """Queue to each distinct recipient (never the actor) and deliver at once."""
    queued, seen = [], set()
    for member in recipients:
        if not member or member.id in seen or member.id == actor_id:
            continue
        seen.add(member.id)
        queued += service.notify(
            member.id, event_type, subject, body, channels=_channels(member),
            case_id=case_id, client_id=client_id, entity=entity,
            entity_id=entity_id, triggered_by='SYSTEM')
    service.send_now(queued)
    return queued


def invoice_raised(actor, invoice, case):
    """An advocate raised an invoice -> tell the accountants to collect.

    Reaches the firm's accountants (INVOICE_VIEW, firm-wide) plus the team's own
    finance viewers (e.g. the senior); the advocate who raised it is not pinged.
    """
    try:
        owner = case.advocate if (case and case.advocate_id) else actor
        recipients = (alert_members(owner, permission='INVOICE_VIEW')
                      + firm_wide_members(permission='INVOICE_VIEW'))
        number = getattr(invoice, 'invoice_number', None) or getattr(invoice, 'id', '')
        client = getattr(getattr(invoice, 'client', None), 'name', '') or 'client'
        subject = 'Invoice {} raised - to collect'.format(number)
        body = ('Invoice  : {}\nClient   : {}\nAmount   : {}\n'
                'Raised by: {}\nDue date : {}\n').format(
            number, client, _money(getattr(invoice, 'amount', 0)),
            getattr(actor, 'full_name', ''), getattr(invoice, 'due_date', ''))
        return _fanout_now(
            recipients, 'INVOICE_GENERATED', subject, body,
            actor_id=getattr(actor, 'id', None), case_id=getattr(case, 'id', None),
            client_id=getattr(invoice, 'client_id', None),
            entity='Invoice', entity_id=getattr(invoice, 'id', None))
    except Exception:                                        # noqa: BLE001
        log.exception('invoice_raised notification failed')
        return []


def payment_settled(actor, ref, case, amount=None):
    """A payment was recorded -> tell the case's advocates it is settled.

    `ref` is the invoice or payment row (for its number/id). Reaches the case's
    team advocates (CASE_VIEW); the person who recorded it is not pinged.
    """
    try:
        if case is None or not getattr(case, 'advocate_id', None):
            return []
        recipients = alert_members(case.advocate, permission='CASE_VIEW')
        number = getattr(ref, 'invoice_number', None) or getattr(ref, 'id', '')
        subject = 'Payment received - {}'.format(
            getattr(case, 'case_number', '') or number)
        body = ('Case       : {}\nReference  : {}\nAmount     : {}\n'
                'Recorded by: {}\n').format(
            getattr(case, 'case_number', '') or '-', number,
            _money(amount if amount is not None else getattr(ref, 'amount', 0)),
            getattr(actor, 'full_name', ''))
        return _fanout_now(
            recipients, 'PAYMENT_RECEIVED', subject, body,
            actor_id=getattr(actor, 'id', None), case_id=getattr(case, 'id', None),
            client_id=getattr(case, 'client_id', None),
            entity='Payment', entity_id=getattr(ref, 'id', None))
    except Exception:                                        # noqa: BLE001
        log.exception('payment_settled notification failed')
        return []
