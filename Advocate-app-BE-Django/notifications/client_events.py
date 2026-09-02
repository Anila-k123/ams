"""Client-facing notifications: what the CLIENT is told, and how it reads.

Separate from events.py, which produces the advocate's own reminders. These
fire from the request that performs the action (an invoice is raised, a payment
is recorded, a hearing is listed), so the wording is a confirmation addressed to
the client rather than a to-do addressed to the practice.

Nothing here sends: every function enqueues through service.notify_client() and
the scheduled `process_notifications` drain does the SMTP. That keeps the web
request fast and means a mail outage delays a message instead of failing the
invoice that triggered it.

Money is written with a plain "Rs." rather than the rupee sign: these bodies go
out as text/plain and some mail clients still mangle the symbol.
"""

from __future__ import annotations

import logging

from notifications import service

log = logging.getLogger(__name__)


def _money(amount):
    try:
        return 'Rs. {:,.2f}'.format(float(amount or 0))
    except (TypeError, ValueError):
        return 'Rs. {}'.format(amount)


def _case_label(case):
    if case is None:
        return None
    return case.case_number or case.case_title or 'Case #{}'.format(case.id)


def _sign_off(advocate):
    return '\n'.join(['', 'Regards,',
                      getattr(advocate, 'full_name', None) or 'Your Advocate'])


def _greet(client):
    return 'Dear {},'.format(getattr(client, 'name', None) or 'Client')


def invoice_generated(advocate, client, invoice, case=None):
    """An invoice has been raised against the client."""
    label = _case_label(case)
    subject = 'Invoice {} raised'.format(invoice.invoice_number or invoice.id)
    lines = [_greet(client), '',
             'An invoice has been raised on your account.', '',
             'Invoice number : {}'.format(invoice.invoice_number or invoice.id),
             'Amount         : {}'.format(_money(invoice.amount))]
    if invoice.invoice_date:
        lines.append('Invoice date   : {}'.format(invoice.invoice_date))
    if invoice.due_date:
        lines.append('Due date       : {}'.format(invoice.due_date))
    if label:
        lines.append('Case           : {}'.format(label))
    lines.append(_sign_off(advocate))
    return service.notify_client(
        advocate.id, client, 'INVOICE_GENERATED', subject, '\n'.join(lines),
        case_id=getattr(case, 'id', None), entity='Invoice', entity_id=invoice.id,
        triggered_by='SYSTEM')


def invoice_paid(advocate, client, invoice, case=None):
    """The invoice has been marked paid - this is the client's receipt."""
    label = _case_label(case)
    subject = 'Payment received for invoice {}'.format(
        invoice.invoice_number or invoice.id)
    lines = [_greet(client), '',
             'We have recorded payment of your invoice. Thank you.', '',
             'Invoice number : {}'.format(invoice.invoice_number or invoice.id),
             'Amount         : {}'.format(_money(invoice.amount))]
    if label:
        lines.append('Case           : {}'.format(label))
    lines.append(_sign_off(advocate))
    return service.notify_client(
        advocate.id, client, 'PAYMENT_RECEIVED', subject, '\n'.join(lines),
        case_id=getattr(case, 'id', None), entity='Invoice', entity_id=invoice.id,
        triggered_by='SYSTEM')


def payment_received(advocate, client, payment, case=None):
    """A payment has been recorded against the client's account."""
    label = _case_label(case)
    subject = 'Payment of {} received'.format(_money(payment.amount))
    lines = [_greet(client), '',
             'We have recorded the following payment. Thank you.', '',
             'Amount    : {}'.format(_money(payment.amount))]
    if payment.payment_date:
        lines.append('Date      : {}'.format(payment.payment_date))
    if payment.payment_mode:
        lines.append('Mode      : {}'.format(payment.payment_mode))
    if payment.reference_number:
        lines.append('Reference : {}'.format(payment.reference_number))
    if label:
        lines.append('Case      : {}'.format(label))
    lines.append(_sign_off(advocate))
    return service.notify_client(
        advocate.id, client, 'PAYMENT_RECEIVED', subject, '\n'.join(lines),
        case_id=getattr(case, 'id', None), entity='ClientPayment',
        entity_id=payment.id, triggered_by='SYSTEM')


def hearing_scheduled(advocate, client, event, case=None):
    """A hearing (or other diary event) has been listed on the client's case."""
    label = _case_label(case)
    kind = (event.event_type or 'Hearing').replace('_', ' ').title()
    subject = '{} scheduled{}'.format(kind, ' - {}'.format(label) if label else '')
    lines = [_greet(client), '',
             'A {} has been scheduled on your case.'.format(kind.lower()), '',
             'Date    : {}'.format(event.date)]
    if event.time:
        lines.append('Time    : {}'.format(event.time))
    if event.title:
        lines.append('Details : {}'.format(event.title))
    if label:
        lines.append('Case    : {}'.format(label))
    lines.append(_sign_off(advocate))
    return service.notify_client(
        advocate.id, client, 'HEARING_SCHEDULED', subject, '\n'.join(lines),
        case_id=getattr(case, 'id', None), entity='CaseEvent', entity_id=event.id,
        triggered_by='SYSTEM')


def case_created(advocate, client, case):
    """A new case has been opened for the client."""
    label = _case_label(case)
    subject = 'Case {} registered'.format(label)
    lines = [_greet(client), '',
             'A new case has been opened on your behalf.', '',
             'Case number : {}'.format(case.case_number or '-')]
    if case.case_title:
        lines.append('Title       : {}'.format(case.case_title))
    if case.case_type:
        lines.append('Type        : {}'.format(case.case_type))
    if case.court_level:
        lines.append('Court       : {}'.format(case.court_level))
    lines.append(_sign_off(advocate))
    return service.notify_client(
        advocate.id, client, 'CASE_CREATED', subject, '\n'.join(lines),
        case_id=case.id, entity='Case', entity_id=case.id,
        triggered_by='SYSTEM')


def client_registered(advocate, client):
    """The client has been added to the practice."""
    subject = 'You have been registered as a client'
    lines = [_greet(client), '',
             'You have been added as a client of this practice. You will '
             'receive updates about your cases, hearings and invoices at this '
             'address.',
             _sign_off(advocate)]
    return service.notify_client(
        advocate.id, client, 'CLIENT_REGISTERED', subject, '\n'.join(lines),
        entity='Client', entity_id=client.id, triggered_by='SYSTEM')
