"""What a client user may see. Every client view reads through these, the same
way core/practice.py scopes advocates. Everything is limited to the client's
own client_id; nothing internal (notes, tasks, expenses, unshared documents) is
reachable from here (client_id = request.client_id, set by clientaccess.gate).
"""

from django.db.models import Q

from core.models import Advocate, Case, ClientPayment, Document, Invoice
from core.practice import practice_root


def cases(client_id):
    return (Case.objects.select_related('advocate')
            .filter(client_id=client_id, deleted=False))


def invoices(client_id):
    return (Invoice.objects.select_related('case')
            .filter(client_id=client_id, case__deleted=False))


def payments(client_id):
    return ClientPayment.objects.filter(client_id=client_id)


def documents(client_id):
    """Only documents the firm chose to share (Document.client_visible), on this
    client or one of their cases."""
    case_ids = cases(client_id).values_list('id', flat=True)
    return (Document.objects.select_related('case')
            .filter(client_visible=True)
            .filter(Q(client_id=client_id) | Q(case_id__in=case_ids)))


def firm_owner(client):
    """The advocate who owns the practice the client belongs to (for branding/audit)."""
    advocate = Advocate.objects.filter(id=client.advocate_id).first() if client.advocate_id else None
    if advocate is None:
        return None
    return Advocate.objects.filter(id=practice_root(advocate)).first() or advocate
