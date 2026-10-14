"""Firm-specific invoice numbers.

Each firm numbers its own invoices: `<prefix><NNNNNN>` with the firm's prefix
(FirmSettings.invoice_prefix, default "INV-"), or `<prefix><FY>/<NNNN>` when
the firm restarts numbering every financial year (FirmSettings.invoice_fy_reset).
Uniqueness is per firm and enforced by the database (invoices_firm_number_uniq).

Concurrency: the scope's InvoiceSequence row is locked with SELECT ... FOR
UPDATE inside the caller's transaction, so simultaneous invoices in one firm
are serialised on that row and get consecutive numbers. The caller must hold
a transaction (transaction.atomic) for the whole invoice creation, so a failed
creation also gives the number back.

Existing invoices keep their numbers. A scope's first use starts after the
highest number the firm already has in that format, so nothing collides with
history and nothing is renumbered.
"""
from __future__ import annotations

import datetime
import re

from django.db import transaction

from core.models import Invoice
from core.tenant import firm_id_of_advocate, has_firm_column
from core.practice import practice_root

from .models import InvoiceSequence

DEFAULT_PREFIX = 'INV-'


def financial_year(day: datetime.date) -> str:
    """Indian financial year (April-March) of a date: '2026-27'."""
    start = day.year if day.month >= 4 else day.year - 1
    return '{}-{:02d}'.format(start, (start + 1) % 100)


def _settings(firm_id):
    if not firm_id:
        return DEFAULT_PREFIX, False
    from firms.models import FirmSettings
    s = FirmSettings.objects.filter(firm_id=firm_id).only('invoice_prefix', 'invoice_fy_reset').first()
    if s is None:
        return DEFAULT_PREFIX, False
    return (s.invoice_prefix or DEFAULT_PREFIX), bool(s.invoice_fy_reset)


def scope_for(advocate, invoice_date):
    """(scope key, firm_id, number format) for an invoice raised by `advocate`."""
    firm_id = firm_id_of_advocate(advocate.id) if has_firm_column(Invoice) else None
    prefix, fy_reset = _settings(firm_id)
    owner = f'firm:{firm_id}' if firm_id else f'practice:{practice_root(advocate)}'
    if fy_reset:
        fy = financial_year(invoice_date)
        return f'{owner}:FY{fy}', firm_id, f'{prefix}{fy}/' + '{:04d}'
    return owner, firm_id, prefix + '{:06d}'


def _existing(firm_id, advocate):
    qs = Invoice.objects.all()
    if firm_id:
        return qs.filter(firm_id=firm_id)
    from core.practice import practice_ids
    return qs.filter(advocate_id__in=practice_ids(advocate))


def _highest_used(numbers, fmt):
    """Highest counter among existing numbers written in this format."""
    head, _, _ = fmt.partition('{')
    pattern = re.compile('^' + re.escape(head) + r'(\d+)$')
    best = 0
    for n in numbers:
        m = pattern.match((n or '').strip())
        if m:
            best = max(best, int(m.group(1)))
    return best


def next_number(advocate, invoice_date=None):
    """Take the next number of `advocate`'s firm. Must run inside atomic()."""
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError('next_number() must run inside transaction.atomic()')
    invoice_date = invoice_date or datetime.date.today()
    scope, firm_id, fmt = scope_for(advocate, invoice_date)
    seq = InvoiceSequence.objects.select_for_update().filter(scope=scope).first()
    if seq is None:
        # First invoice of this scope since numbering moved here: continue
        # after the firm's existing numbers. get_or_create + lock again so two
        # first invoices at once still serialise on the new row.
        existing = _existing(firm_id, advocate).values_list('invoice_number', flat=True)
        start = _highest_used(existing, fmt) + 1
        InvoiceSequence.objects.get_or_create(scope=scope, defaults={'firm_id': firm_id, 'next_value': start})
        seq = InvoiceSequence.objects.select_for_update().get(scope=scope)
    taken = set(_existing(firm_id, advocate).values_list('invoice_number', flat=True))
    value = seq.next_value
    number = fmt.format(value)
    # A number typed by hand earlier may already sit on the counter's path.
    while number in taken:
        value += 1
        number = fmt.format(value)
    seq.next_value = value + 1
    seq.save(update_fields=['next_value', 'updated_at'])
    return number


def number_taken(advocate, number):
    """Is `number` already used in this advocate's firm (a hand-typed number)?"""
    firm_id = firm_id_of_advocate(advocate.id) if has_firm_column(Invoice) else None
    return _existing(firm_id, advocate).filter(invoice_number=number).exists()
