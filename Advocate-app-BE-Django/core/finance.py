"""A case's money totals, kept in step with its payments, expenses and invoices.

The Spring schema stores running totals on `cases` (total_paid_by_client,
total_expenses_so_far, balance_in_account, pending_from_client), and the old
Spring services updated them on every payment and expense. The Django port
never did, so every case showed Rs. 0 in the Expenses list, the case
workspace, the client portal and the dashboard's outstanding total, however
much had been recorded. recalc_case_totals() recomputes them from the real
rows; call it after anything that adds, changes or removes money on a case.

All arithmetic is Decimal (core/money.py); the legacy columns are double
precision, so results are rounded to paise before they are stored or returned.
"""

from core.models import Case, ClientPayment, Expense, Invoice
from core.money import ZERO, to_decimal, total


def _sum(qs) -> float:
    return float(total(qs.values_list('amount', flat=True)))


def recalc_case_totals(case_id):
    """Recompute and save one case's totals. Returns the case, or None.

    - paid     = sum of the client's payments on the case
    - expenses = sum of expenses on the case
    - balance  = paid - expenses
    - pending  = what is owed - paid, never below zero. What is owed is the
                 agreed fee when one was set on the case, otherwise the total
                 of the case's invoices, cancelled ones left out (the fee is
                 often never typed in, but the invoices say what was billed).
    The agreed fee itself is the user's figure and is never overwritten.
    """
    if not case_id:
        return None
    case = Case.objects.filter(id=case_id).first()
    if case is None:
        return None
    paid = total(ClientPayment.objects.filter(case_id=case_id).values_list('amount', flat=True))
    expenses = total(Expense.objects.filter(case_id=case_id).values_list('amount', flat=True))
    agreed = to_decimal(case.total_client_agreed_amount) or to_decimal(case.amount)
    owed = agreed or total(Invoice.objects.billable().filter(case_id=case_id).values_list('amount', flat=True))
    case.total_paid_by_client = float(paid)
    case.total_expenses_so_far = float(expenses)
    case.balance_in_account = float(paid - expenses)
    case.pending_from_client = float(max(owed - paid, ZERO))
    case.save(update_fields=['total_paid_by_client', 'total_expenses_so_far',
                             'balance_in_account', 'pending_from_client'])
    return case


# --- invoice status ----------------------------------------------------------
# UNPAID -> PARTIAL -> PAID follow from linked payments (recalc_invoice_status);
# PAID by hand is for money recorded before payments were linked; CANCELLED
# only while nothing has been received. Nothing leaves PAID or CANCELLED: a
# finalised invoice is corrected by cancelling it and raising a new one.
INVOICE_TRANSITIONS = {
    'UNPAID': {'PARTIAL', 'PAID', 'CANCELLED'},
    'PARTIAL': {'PAID'},
    'PAID': set(),
    'CANCELLED': set(),
}


class TransitionError(ValueError):
    pass


def check_invoice_transition(current, new):
    cur, new = (current or 'UNPAID').upper(), (new or '').upper()
    if cur == new:
        return
    if new not in INVOICE_TRANSITIONS.get(cur, set()):
        raise TransitionError('An invoice that is {} cannot become {}.'.format(cur.lower(), new.lower()))


# --- per-invoice settlement --------------------------------------------------

def invoice_paid_amounts(invoice_ids):
    """{invoice id: amount received} from the payments linked to each invoice
    (invoices.PaymentInvoice). Invoices with no linked payment are absent."""
    from invoices.models import PaymentInvoice
    ids = [i for i in invoice_ids if i]
    if not ids:
        return {}
    links = dict(PaymentInvoice.objects.filter(invoice_id__in=ids)
                 .values_list('payment_id', 'invoice_id'))
    out = {}
    for pid, amount in ClientPayment.objects.filter(id__in=list(links)).values_list('id', 'amount'):
        out[links[pid]] = out.get(links[pid], ZERO) + to_decimal(amount)
    return {k: float(v) for k, v in out.items()}


def invoice_balance(invoice, paid=None):
    """What the client still owes on one invoice. A PAID invoice owes nothing
    (older ones were marked paid without linked payments) and so does a
    cancelled one."""
    status = (invoice.status or '').upper()
    if status in ('PAID', 'CANCELLED'):
        return 0.0
    if paid is None:
        paid = invoice_paid_amounts([invoice.id]).get(invoice.id, 0.0)
    return float(max(to_decimal(invoice.amount) - to_decimal(paid), ZERO))


def recalc_invoice_status(invoice_id):
    """Set an invoice's status from its linked payments: UNPAID, PARTIAL or PAID.

    Cancelled invoices are left alone, and so is one already PAID: older
    invoices were marked paid by hand with the money recorded unlinked, and
    must not drop back to UNPAID because no payment points at them.
    Returns the invoice, or None.
    """
    inv = Invoice.objects.filter(id=invoice_id).first()
    if inv is None or (inv.status or '').upper() in ('PAID', 'CANCELLED'):
        return inv
    paid = to_decimal(invoice_paid_amounts([inv.id]).get(inv.id, 0))
    amount = to_decimal(inv.amount)
    status = 'PAID' if paid >= amount else 'PARTIAL' if paid > ZERO else 'UNPAID'
    if status != (inv.status or '').upper():
        check_invoice_transition(inv.status, status)
        inv.status = status
        inv.save(update_fields=['status'])
    return inv
