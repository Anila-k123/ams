"""A case's money totals, kept in step with its payments, expenses and invoices.

The Spring schema stores running totals on `cases` (total_paid_by_client,
total_expenses_so_far, balance_in_account, pending_from_client), and the old
Spring services updated them on every payment and expense. The Django port
never did, so every case showed Rs. 0 in the Expenses list, the case
workspace, the client portal and the dashboard's outstanding total, however
much had been recorded. recalc_case_totals() recomputes them from the real
rows; call it after anything that adds, changes or removes money on a case.
"""

from django.db.models import Sum

from core.models import Case, ClientPayment, Expense, Invoice


def _sum(qs):
    return round(float(qs.aggregate(t=Sum('amount'))['t'] or 0), 2)


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
    paid = _sum(ClientPayment.objects.filter(case_id=case_id))
    expenses = _sum(Expense.objects.filter(case_id=case_id))
    agreed = float(case.total_client_agreed_amount or 0) or float(case.amount or 0)
    owed = agreed or _sum(Invoice.objects.billable().filter(case_id=case_id))
    case.total_paid_by_client = paid
    case.total_expenses_so_far = expenses
    case.balance_in_account = round(paid - expenses, 2)
    case.pending_from_client = round(max(owed - paid, 0.0), 2)
    case.save(update_fields=['total_paid_by_client', 'total_expenses_so_far',
                             'balance_in_account', 'pending_from_client'])
    return case


# --- per-invoice settlement --------------------------------------------------

_CENT = 0.005


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
        out[links[pid]] = round(out.get(links[pid], 0.0) + float(amount or 0), 2)
    return out


def invoice_balance(invoice, paid=None):
    """What the client still owes on one invoice. A PAID invoice owes nothing
    (older ones were marked paid without linked payments) and so does a
    cancelled one."""
    status = (invoice.status or '').upper()
    if status in ('PAID', 'CANCELLED'):
        return 0.0
    if paid is None:
        paid = invoice_paid_amounts([invoice.id]).get(invoice.id, 0.0)
    return round(max(float(invoice.amount or 0) - paid, 0.0), 2)


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
    paid = invoice_paid_amounts([inv.id]).get(inv.id, 0.0)
    status = ('PAID' if paid >= float(inv.amount or 0) - _CENT
              else 'PARTIAL' if paid > _CENT else 'UNPAID')
    if status != (inv.status or '').upper():
        inv.status = status
        inv.save(update_fields=['status'])
    return inv
