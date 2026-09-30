from django.db.models import Q
from rest_framework.decorators import api_view
from rest_framework.response import Response

from core.models import Client, Case, Document, Invoice, Expense, CaseEvent, ClientPayment
from workspace.models import CaseTask
from clients.serializers import ClientSerializer
from cases.serializers import CaseSerializer
from documents.serializers import DocumentSerializer
from invoices.serializers import InvoiceSerializer
from expenses.serializers import ExpenseSerializer
from payments.serializers import ClientPaymentSerializer
from events.serializers import CaseEventSerializer
from workspace.serializers import CaseTaskSerializer

MAX = 5


def _global_search(user, q):
    # The whole practice, like every list page - not only rows this user created.
    from core.practice import practice_ids
    from workspace.access import visible_tasks
    scope = practice_ids(user)
    if not q:
        return {k: [] for k in ('clients', 'cases', 'documents', 'invoices',
                                'expenses', 'tasks', 'events', 'payments')}

    clients = Client.objects.filter(advocate_id__in=scope, deleted=False).filter(
        Q(name__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q) | Q(address__icontains=q)
    )[:MAX]

    cases = Case.objects.select_related('client').filter(advocate_id__in=scope, deleted=False).filter(
        Q(case_number__icontains=q) | Q(case_title__icontains=q) | Q(case_type__icontains=q) |
        Q(court_level__icontains=q) | Q(status__icontains=q) | Q(client__name__icontains=q)
    )[:MAX]

    documents = Document.objects.select_related('case', 'client').filter(advocate_id__in=scope).filter(
        Q(document_name__icontains=q) | Q(original_name__icontains=q) | Q(category__icontains=q)
    )[:MAX]

    invoices = Invoice.objects.select_related('case', 'client').filter(advocate_id__in=scope).filter(
        Q(invoice_number__icontains=q) | Q(status__icontains=q)
    )[:MAX]

    expenses = Expense.objects.select_related('case').filter(advocate_id__in=scope).filter(
        Q(title__icontains=q) | Q(category__icontains=q) | Q(description__icontains=q)
    )[:MAX]

    # workspace.CaseTask, not the legacy core.Task table - that one is empty,
    # so searching for a task never matched anything.
    tasks = visible_tasks(user).filter(title__icontains=q)[:MAX]

    events = CaseEvent.objects.select_related('case').filter(advocate_id__in=scope).filter(
        Q(title__icontains=q) | Q(description__icontains=q) | Q(event_type__icontains=q)
    )[:MAX]

    payments = ClientPayment.objects.select_related('case', 'client').filter(advocate_id__in=scope).filter(
        Q(description__icontains=q) | Q(payment_mode__icontains=q) | Q(reference_number__icontains=q)
    )[:MAX]

    return {
        'clients': ClientSerializer(clients, many=True).data,
        'cases': CaseSerializer(cases, many=True).data,
        'documents': DocumentSerializer(documents, many=True).data,
        'invoices': InvoiceSerializer(invoices, many=True).data,
        'expenses': ExpenseSerializer(expenses, many=True).data,
        'tasks': CaseTaskSerializer(tasks, many=True).data,
        'events': CaseEventSerializer(events, many=True).data,
        'payments': ClientPaymentSerializer(payments, many=True).data,
    }


# Each result group needs the permission its own page needs, so search can't
# show a junior the invoices, or the accountant the documents.
GROUP_PERMS = {
    'clients': 'CLIENT_VIEW', 'cases': 'CASE_VIEW', 'documents': 'DOCUMENT_VIEW',
    'invoices': 'INVOICE_VIEW', 'expenses': 'EXPENSE_VIEW', 'tasks': 'TASK_VIEW',
    'events': 'EVENT_VIEW', 'payments': 'PAYMENT_VIEW',
}


@api_view(['GET'])
def search(request):
    q = request.query_params.get('q') or request.query_params.get('keyword') or ''
    results = _global_search(request.user, q)
    perms = request.user.permission_codes()
    for group, perm in GROUP_PERMS.items():
        if perm not in perms:
            results[group] = []
    return Response(results)
