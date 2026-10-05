"""Staff-to-staff notifications for the advocate-led billing hand-off.

Client-facing emails live in `client_events`; this is the internal loop between
the advocate who raises a bill and the accountant who collects it:

    advocate raises invoice  -> accountants (and the team's finance viewers) are
                                told to collect
    payment recorded         -> the case's advocates are told it is settled

Fires inline on the request (like client_events) and delivers immediately, so a
new invoice reaches the accountant's bell/inbox at once. Never raises - a
notification must not fail the invoice or payment it reports. Recipients are
role-relevant (INVOICE_VIEW / CASE_ALERTS) via the same helpers the scheduled
reminders use, and the person who performed the action is not pinged about it.
"""

from __future__ import annotations

import logging

from core.practice import (alert_members, case_alert_permission,
                           firm_wide_members, practice_root)
from notifications import service
from notifications.events import _channels

log = logging.getLogger(__name__)


def _money(amount):
    try:
        return 'Rs. {:,.2f}'.format(float(amount or 0))
    except (TypeError, ValueError):
        return str(amount)


def _fanout_now(recipients, event_type, subject, body, *, actor_id=None,
                case_id=None, client_id=None, entity=None, entity_id=None, skip_ids=()):
    """Queue to each distinct recipient (never the actor, nor `skip_ids`) and
    deliver at once."""
    queued, seen = [], set(skip_ids)
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


def invoice_raised(actor, invoice, case, skip_ids=()):
    """An advocate raised an invoice -> tell the accountants to collect.

    Reaches the firm's accountants (INVOICE_VIEW, firm-wide) plus the team's own
    finance viewers (e.g. the senior); the advocate who raised it is not pinged.
    """
    try:
        owner = case.advocate if (case and case.advocate_id) else actor
        recipients = (alert_members(owner, permission='INVOICE_VIEW')
                      + firm_wide_members(practice_root(owner),
                                              permission='INVOICE_VIEW'))
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
            entity='Invoice', entity_id=getattr(invoice, 'id', None), skip_ids=skip_ids)
    except Exception:                                        # noqa: BLE001
        log.exception('invoice_raised notification failed')
        return []


def payment_settled(actor, ref, case, amount=None):
    """A payment was recorded -> tell the case's advocates it is settled.

    `ref` is the invoice or payment row (for its number/id). Reaches the case's
    team advocates (CASE_ALERTS); the person who recorded it is not pinged.
    """
    try:
        if case is None or not getattr(case, 'advocate_id', None):
            return []
        recipients = alert_members(case.advocate, permission=case_alert_permission())
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


def hearing_added_team(actor, event, case):
    """A hearing was added to a case -> tell the case's team immediately.

    Reaches the case's team advocates (CASE_ALERTS) in-app + email right away, so
    the whole team knows a date is set - not only when the scheduled look-ahead
    reminder fires near the date. The client is emailed separately (immediately)
    by client_events.hearing_scheduled. The person who added it is not pinged.
    """
    try:
        if case is None or not getattr(case, 'advocate_id', None):
            return []
        recipients = alert_members(case.advocate, permission=case_alert_permission())
        title = getattr(event, 'title', '') or (getattr(event, 'event_type', '') or 'Hearing')
        tm = getattr(event, 'time', None)
        subject = 'New hearing - {}'.format(getattr(case, 'case_number', '') or title)
        body = ('A hearing has been added to this case.\n\n'
                'Case    : {}\nWhat    : {}\nDate    : {}{}\nAdded by: {}\n').format(
            getattr(case, 'case_number', '') or '-', title,
            getattr(event, 'date', ''), (' ' + str(tm)) if tm else '',
            getattr(actor, 'full_name', ''))
        return _fanout_now(
            recipients, 'HEARING_SCHEDULED', subject, body,
            actor_id=getattr(actor, 'id', None), case_id=getattr(case, 'id', None),
            client_id=getattr(case, 'client_id', None),
            entity='CaseEvent', entity_id=getattr(event, 'id', None))
    except Exception:                                        # noqa: BLE001
        log.exception('hearing_added_team notification failed')
        return []


def client_assigned(actor, client, advocate):
    """A client was added (or handed over) with a named handling advocate ->
    tell that advocate at once, in-app + email per their preference.

    The case details are passed on outside the app for now, so the notice only
    says who the client is and who took them in. Saying so in the body keeps
    the advocate from waiting for a case to appear. Not sent when the person
    who added the client is the handler.
    """
    try:
        if client is None or advocate is None:
            return []
        subject = 'New client assigned to you - {}'.format(client.name or 'client')
        body = ('A new client has been assigned to you.\n\n'
                'Client   : {}\nPhone    : {}\nEmail    : {}\nAddress  : {}\n'
                'Added by : {}\n\n'
                'The case details will be shared with you directly. Open the case in '
                'AMS once you have them.\n').format(
            client.name or '-', client.phone or '-', client.email or '-',
            client.address or '-', getattr(actor, 'full_name', '') or '-')
        return _fanout_now(
            [advocate], 'CLIENT_REGISTERED', subject, body,
            actor_id=getattr(actor, 'id', None), client_id=client.id,
            entity='Client', entity_id=client.id)
    except Exception:                                        # noqa: BLE001
        log.exception('client_assigned notification failed')
        return []


def _issuers(case, actor):
    """Who issues invoices for this case: the team's INVOICE_ISSUE holders
    (e.g. the senior) plus the firm's accountants."""
    owner = case.advocate if (case and case.advocate_id) else actor
    return (alert_members(owner, permission='INVOICE_ISSUE')
            + firm_wide_members(practice_root(owner), permission='INVOICE_ISSUE'))


def _request_lines(req, case, by_label, by_name):
    client = getattr(getattr(case, 'client', None), 'name', '') if case else ''
    return ('Case     : {}\nClient   : {}\nAmount   : {} (before GST)\n{}: {}\n').format(
        getattr(case, 'case_number', '') or '-', client or '-', _money(req.amount),
        by_label.ljust(9), by_name or '-')


def invoice_submitted(actor, req, case, resubmitted=False):
    """An advocate raised an invoice for accounts -> tell those who issue them."""
    try:
        subject = 'Invoice {} for {} - to issue'.format(
            'resubmitted' if resubmitted else 'raised', getattr(case, 'case_number', '') or 'a case')
        body = ('An advocate has raised an invoice. Check it and issue it, or return it '
                'with a note.\n\n' + _request_lines(req, case, 'Raised by', getattr(actor, 'full_name', '')))
        return _fanout_now(
            _issuers(case, actor), 'INVOICE_SUBMITTED', subject, body,
            actor_id=getattr(actor, 'id', None), case_id=getattr(case, 'id', None),
            client_id=getattr(req, 'client_id', None), entity='InvoiceRequest', entity_id=req.id)
    except Exception:                                        # noqa: BLE001
        log.exception('invoice_submitted notification failed')
        return []


def invoice_returned(actor, req):
    """Accounts sent an invoice back -> tell the advocate who raised it, and why."""
    try:
        from core.models import Advocate, Case
        advocate = Advocate.objects.filter(id=req.requested_by_id).first()
        case = Case.objects.select_related('client').filter(id=req.case_id).first()
        subject = 'Invoice returned - {}'.format(getattr(case, 'case_number', '') or 'your case')
        body = ('Your invoice was returned. Change it and send it again.\n\n'
                + _request_lines(req, case, 'Returned by', getattr(actor, 'full_name', ''))
                + '\nWhat to change:\n{}\n'.format(req.note))
        return _fanout_now(
            [advocate], 'INVOICE_RETURNED', subject, body,
            actor_id=getattr(actor, 'id', None), case_id=req.case_id,
            client_id=req.client_id, entity='InvoiceRequest', entity_id=req.id)
    except Exception:                                        # noqa: BLE001
        log.exception('invoice_returned notification failed')
        return []


def invoice_request_issued(actor, req, invoice):
    """Accounts issued an advocate's invoice -> tell that advocate its number."""
    try:
        from core.models import Advocate, Case
        advocate = Advocate.objects.filter(id=req.requested_by_id).first()
        case = Case.objects.select_related('client').filter(id=req.case_id).first()
        number = getattr(invoice, 'invoice_number', '') or invoice.id
        subject = 'Invoice {} issued - {}'.format(number, getattr(case, 'case_number', '') or '')
        body = ('Your invoice was issued to the client.\n\nInvoice  : {}\nAmount   : {}\n'
                'Issued by: {}\nDue date : {}\n').format(
            number, _money(invoice.amount), getattr(actor, 'full_name', ''), invoice.due_date)
        return _fanout_now(
            [advocate], 'INVOICE_GENERATED', subject, body,
            actor_id=getattr(actor, 'id', None), case_id=req.case_id,
            client_id=req.client_id, entity='Invoice', entity_id=invoice.id)
    except Exception:                                        # noqa: BLE001
        log.exception('invoice_request_issued notification failed')
        return []
