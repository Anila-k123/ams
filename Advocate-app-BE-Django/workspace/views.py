import datetime
import logging

from django.core.cache import cache

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import Case, CaseEvent, Expense, Invoice, ClientPayment, Document
from core.permissions import RequirePermission
from expenses.serializers import ExpenseSerializer
from invoices.serializers import InvoiceSerializer
from payments.serializers import ClientPaymentSerializer
from .models import CaseNote, CaseTag, CaseTask, CaseParty, RelatedCase, CaseTaskDocument, HearingDetail
from .serializers import (CaseNoteSerializer, CaseTagSerializer, CaseTaskSerializer,
                          CasePartySerializer)


# --- helpers -------------------------------------------------------------

def _owns_case(request, case_id):
    """Only allow workspace ops on cases the requesting advocate owns."""
    return Case.objects.filter(id=case_id, advocate_id__in=practice_ids(request.user)).exists()


def _event_payload(ev):
    return {
        'id': ev.id,
        'title': ev.title,
        'eventType': ev.event_type,
        'description': ev.description,
        'date': ev.date.isoformat() if ev.date else None,
        'time': ev.time.isoformat() if ev.time else None,
        'hearingDetail': HearingDetail.payload(ev.id),
    }


# --- Notes ---------------------------------------------------------------

class CaseNotesView(APIView):
    permission_classes = [RequirePermission()]

    def get(self, request, case_id):
        qs = CaseNote.objects.filter(advocate_id__in=practice_ids(request.user), case_id=case_id)
        return Response(CaseNoteSerializer(qs, many=True).data)

    def post(self, request, case_id):
        if not _owns_case(request, case_id):
            return Response({'error': 'Case not found'}, status=status.HTTP_404_NOT_FOUND)
        body = (request.data.get('body') or '').strip()
        if not body:
            return Response({'error': 'body is required'}, status=status.HTTP_400_BAD_REQUEST)
        note = CaseNote.objects.create(advocate_id=request.user.id, case_id=case_id, body=body)
        return Response(CaseNoteSerializer(note).data, status=status.HTTP_201_CREATED)


class DeleteCaseNoteView(APIView):
    permission_classes = [RequirePermission()]

    def delete(self, request, pk):
        note = CaseNote.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if note is None:
            return Response({'error': 'Note not found'}, status=status.HTTP_404_NOT_FOUND)
        note.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Tags ----------------------------------------------------------------

class CaseTagsView(APIView):
    permission_classes = [RequirePermission()]

    def get(self, request, case_id):
        qs = CaseTag.objects.filter(advocate_id__in=practice_ids(request.user), case_id=case_id)
        return Response(CaseTagSerializer(qs, many=True).data)

    def post(self, request, case_id):
        if not _owns_case(request, case_id):
            return Response({'error': 'Case not found'}, status=status.HTTP_404_NOT_FOUND)
        label = (request.data.get('label') or '').strip()
        if not label:
            return Response({'error': 'label is required'}, status=status.HTTP_400_BAD_REQUEST)
        tag, _created = CaseTag.objects.get_or_create(
            advocate_id=request.user.id, case_id=case_id, label=label,
            defaults={'color': request.data.get('color')},
        )
        return Response(CaseTagSerializer(tag).data, status=status.HTTP_201_CREATED)


class DeleteCaseTagView(APIView):
    permission_classes = [RequirePermission()]

    def delete(self, request, pk):
        tag = CaseTag.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if tag is None:
            return Response({'error': 'Tag not found'}, status=status.HTTP_404_NOT_FOUND)
        tag.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AllTagsView(APIView):
    """Feeds the list view: tags grouped by case + the distinct label set for filtering."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        qs = CaseTag.objects.filter(advocate_id__in=practice_ids(request.user))
        by_case = {}
        for t in qs:
            by_case.setdefault(t.case_id, []).append(
                {'id': t.id, 'label': t.label, 'color': t.color})
        labels = sorted({t.label for t in qs})
        return Response({'tagsByCase': by_case, 'allLabels': labels})


# --- Per-case tasks ------------------------------------------------------

class CaseTasksView(APIView):
    permission_classes = [RequirePermission()]

    def get(self, request, case_id):
        qs = CaseTask.objects.filter(advocate_id__in=practice_ids(request.user), case_id=case_id)
        return Response(CaseTaskSerializer(qs, many=True).data)

    def post(self, request, case_id):
        if not _owns_case(request, case_id):
            return Response({'error': 'Case not found'}, status=status.HTTP_404_NOT_FOUND)
        title = (request.data.get('title') or '').strip()
        if not title:
            return Response({'error': 'title is required'}, status=status.HTTP_400_BAD_REQUEST)
        task = CaseTask.objects.create(
            advocate_id=request.user.id, case_id=case_id, title=title,
            priority=request.data.get('priority') or 'MEDIUM',
            deadline=request.data.get('deadline') or None,
            completed=False,
        )
        return Response(CaseTaskSerializer(task).data, status=status.HTTP_201_CREATED)


class MyTasksAllView(APIView):
    """All of the advocate's tasks (case-linked or not) — powers the standalone
    Tasks page. Unified with the per-case workspace tasks (same store)."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        qs = CaseTask.objects.filter(advocate_id__in=practice_ids(request.user)).order_by('completed', 'deadline', 'id')
        return Response(CaseTaskSerializer(qs, many=True).data)


class CreateTaskView(APIView):
    """Create a task, optionally linked to a case (caseId). Used by the Tasks page."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        title = (request.data.get('title') or '').strip()
        if not title:
            return Response({'error': 'title is required'}, status=status.HTTP_400_BAD_REQUEST)
        case_id = request.data.get('caseId') or None
        if case_id and not _owns_case(request, case_id):
            return Response({'error': 'Case not found'}, status=status.HTTP_404_NOT_FOUND)
        task = CaseTask.objects.create(
            advocate_id=request.user.id,
            case_id=case_id,
            title=title,
            priority=request.data.get('priority') or 'MEDIUM',
            deadline=request.data.get('deadline') or None,
            completed=False,
        )
        return Response(CaseTaskSerializer(task).data, status=status.HTTP_201_CREATED)


class TaskDocumentsView(APIView):
    """Attach an already-uploaded document to a task (many docs per task)."""
    permission_classes = [RequirePermission()]

    def post(self, request, task_id):
        task = CaseTask.objects.filter(id=task_id, advocate_id__in=practice_ids(request.user)).first()
        if task is None:
            return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)
        document_id = request.data.get('documentId')
        if not document_id:
            return Response({'error': 'documentId is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not Document.objects.filter(id=document_id, advocate_id__in=practice_ids(request.user)).exists():
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)
        CaseTaskDocument.objects.get_or_create(
            task_id=task_id, document_id=document_id,
            defaults={'advocate_id': request.user.id},
        )
        return Response(CaseTaskSerializer(task).data, status=status.HTTP_201_CREATED)


class DeleteTaskDocumentView(APIView):
    permission_classes = [RequirePermission()]

    def delete(self, request, task_id, document_id):
        link = CaseTaskDocument.objects.filter(
            task_id=task_id, document_id=document_id, advocate_id__in=practice_ids(request.user)).first()
        if link is None:
            return Response({'error': 'Attachment not found'}, status=status.HTTP_404_NOT_FOUND)
        link.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ToggleCaseTaskView(APIView):
    permission_classes = [RequirePermission()]

    def put(self, request, pk):
        task = CaseTask.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if task is None:
            return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)
        task.completed = not task.completed
        task.save(update_fields=['completed'])
        return Response(CaseTaskSerializer(task).data)


class DeleteCaseTaskView(APIView):
    permission_classes = [RequirePermission()]

    def delete(self, request, pk):
        task = CaseTask.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if task is None:
            return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)
        task.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Aggregations (read-only over the shared core tables) ----------------

class CaseEventsView(APIView):
    """All hearings/events for a single case, upcoming first then past."""
    permission_classes = [RequirePermission()]

    def get(self, request, case_id):
        if not _owns_case(request, case_id):
            return Response({'error': 'Case not found'}, status=status.HTTP_404_NOT_FOUND)
        qs = CaseEvent.objects.filter(advocate_id__in=practice_ids(request.user), case_id=case_id).order_by('date', 'id')
        return Response([_event_payload(e) for e in qs])


class NextHearingsView(APIView):
    """{ caseId: {date, title, eventType} } — earliest upcoming event per case.
    Powers the 'Next Hearing' column in the cases list."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        today = datetime.date.today()
        qs = (CaseEvent.objects
              .filter(advocate_id__in=practice_ids(request.user), date__gte=today)
              .order_by('case_id', 'date', 'id'))
        result = {}
        for ev in qs:
            if ev.case_id in result:
                continue  # first (earliest) per case wins
            result[ev.case_id] = {
                'date': ev.date.isoformat() if ev.date else None,
                'title': ev.title,
                'eventType': ev.event_type,
            }
        return Response(result)


class WorkspaceStatsView(APIView):
    """Dashboard cards for the workspace."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        today = datetime.date.today()
        base = Case.objects.filter(advocate_id__in=practice_ids(request.user), deleted=False)

        def _count(value):
            return base.filter(status__iexact=value).count()

        outstanding = sum(
            (c.pending_from_client or 0)
            for c in base.only('pending_from_client')
        )
        upcoming = (CaseEvent.objects
                    .filter(advocate_id__in=practice_ids(request.user), date__gte=today)
                    .count())

        return Response({
            'totalCases': base.count(),
            'activeCases': _count('Active'),
            'pendingCases': _count('Pending'),
            'closedCases': _count('Closed'),
            'upcomingHearings': upcoming,
            'outstandingDues': round(outstanding, 2),
        })


class CaseFinancialsView(APIView):
    """Live expenses + invoices for a case, with computed totals. Reads the shared
    (Spring-owned) expense/invoice tables, so anything added on the Expenses or
    Invoices pages appears here automatically."""
    permission_classes = [RequirePermission()]

    def get(self, request, case_id):
        if not _owns_case(request, case_id):
            return Response({'error': 'Case not found'}, status=status.HTTP_404_NOT_FOUND)

        expenses = (Expense.objects.select_related('case')
                    .filter(advocate_id__in=practice_ids(request.user), case_id=case_id)
                    .order_by('-payment_date', '-id'))
        invoices = (Invoice.objects.select_related('case', 'client')
                    .filter(advocate_id__in=practice_ids(request.user), case_id=case_id)
                    .order_by('-invoice_date', '-id'))
        payments = (ClientPayment.objects.select_related('case', 'client')
                    .filter(advocate_id__in=practice_ids(request.user), case_id=case_id)
                    .order_by('-payment_date', '-id'))

        total_expenses = sum((e.amount or 0) for e in expenses)
        total_invoiced = sum((i.amount or 0) for i in invoices)
        total_paid = sum((i.amount or 0) for i in invoices if (i.status or '').upper() == 'PAID')
        total_unpaid = round(total_invoiced - total_paid, 2)
        total_payments = sum((p.amount or 0) for p in payments)

        return Response({
            'expenses': ExpenseSerializer(expenses, many=True).data,
            'invoices': InvoiceSerializer(invoices, many=True).data,
            'payments': ClientPaymentSerializer(payments, many=True).data,
            'totals': {
                'totalExpenses': round(total_expenses, 2),
                'totalInvoiced': round(total_invoiced, 2),
                'totalPaid': round(total_paid, 2),
                'totalUnpaid': total_unpaid,
                'totalPaymentsReceived': round(total_payments, 2),
                'expenseCount': len(expenses),
                'invoiceCount': len(invoices),
                'paymentCount': len(payments),
            },
        })


class CaseSummaryView(APIView):
    """Overview payload for the case detail page: next hearing, tags, and counts."""
    permission_classes = [RequirePermission()]

    def get(self, request, case_id):
        case = Case.objects.select_related('client').filter(
            id=case_id, advocate_id__in=practice_ids(request.user)).first()
        if case is None:
            return Response({'error': 'Case not found'}, status=status.HTTP_404_NOT_FOUND)
        today = datetime.date.today()
        next_ev = (CaseEvent.objects
                   .filter(advocate_id__in=practice_ids(request.user), case_id=case_id, date__gte=today)
                   .order_by('date', 'id').first())
        tasks = CaseTask.objects.filter(advocate_id__in=practice_ids(request.user), case_id=case_id)
        open_tasks = tasks.filter(completed=False).count()
        done_tasks = tasks.filter(completed=True).count()
        tags = CaseTag.objects.filter(advocate_id__in=practice_ids(request.user), case_id=case_id)
        return Response({
            'id': case.id,
            'caseNumber': case.case_number,
            'caseTitle': case.case_title,
            'caseType': case.case_type,
            'courtLevel': case.court_level,
            'status': case.status,
            'description': case.description,
            'clientId': case.client_id,
            'clientName': case.client.name if case.client_id and case.client else None,
            'amount': case.amount,
            'financials': {
                'totalClientAgreedAmount': case.total_client_agreed_amount,
                'totalPaidByClient': case.total_paid_by_client,
                'totalExpensesSoFar': case.total_expenses_so_far,
                'balanceInAccount': case.balance_in_account,
                'pendingFromClient': case.pending_from_client,
                'estimatedAmount': case.estimated_amount,
            },
            'nextHearing': _event_payload(next_ev) if next_ev else None,
            'taskCounts': {'open': open_tasks, 'done': done_tasks},
            'noteCount': CaseNote.objects.filter(advocate_id__in=practice_ids(request.user), case_id=case_id).count(),
            'tags': CaseTagSerializer(tags, many=True).data,
        })


# --- Parties / opponents ------------------------------------------------

class CasePartiesView(APIView):
    permission_classes = [RequirePermission()]

    def get(self, request, case_id):
        qs = CaseParty.objects.filter(advocate_id__in=practice_ids(request.user), case_id=case_id)
        return Response(CasePartySerializer(qs, many=True).data)

    def post(self, request, case_id):
        if not _owns_case(request, case_id):
            return Response({'error': 'Case not found'}, status=status.HTTP_404_NOT_FOUND)
        name = (request.data.get('name') or '').strip()
        if not name:
            return Response({'error': 'name is required'}, status=status.HTTP_400_BAD_REQUEST)
        party = CaseParty.objects.create(
            advocate_id=request.user.id, case_id=case_id, name=name,
            role=request.data.get('role') or None,
            counsel=request.data.get('counsel') or None,
            contact=request.data.get('contact') or None,
            is_opponent=bool(request.data.get('isOpponent', False)),
        )
        return Response(CasePartySerializer(party).data, status=status.HTTP_201_CREATED)


class DeleteCasePartyView(APIView):
    permission_classes = [RequirePermission()]

    def delete(self, request, pk):
        party = CaseParty.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if party is None:
            return Response({'error': 'Party not found'}, status=status.HTTP_404_NOT_FOUND)
        party.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Related cases ------------------------------------------------------

class RelatedCasesView(APIView):
    """Lists outgoing + incoming links for a case, each enriched with the linked
    case's number/title so the frontend can render and navigate."""
    permission_classes = [RequirePermission()]

    def _case_map(self, request, ids):
        cases = Case.objects.filter(id__in=ids, advocate_id__in=practice_ids(request.user))
        return {c.id: c for c in cases}

    def get(self, request, case_id):
        outgoing = list(RelatedCase.objects.filter(advocate_id__in=practice_ids(request.user), case_id=case_id))
        incoming = list(RelatedCase.objects.filter(advocate_id__in=practice_ids(request.user), related_case_id=case_id))
        other_ids = ([r.related_case_id for r in outgoing] + [r.case_id for r in incoming])
        cmap = self._case_map(request, other_ids)
        result = []
        for r in outgoing:
            c = cmap.get(r.related_case_id)
            result.append({'id': r.id, 'linkedCaseId': r.related_case_id,
                           'caseNumber': c.case_number if c else None,
                           'caseTitle': c.case_title if c else None,
                           'relation': r.relation, 'note': r.note, 'direction': 'outgoing'})
        for r in incoming:
            c = cmap.get(r.case_id)
            result.append({'id': r.id, 'linkedCaseId': r.case_id,
                           'caseNumber': c.case_number if c else None,
                           'caseTitle': c.case_title if c else None,
                           'relation': r.relation, 'note': r.note, 'direction': 'incoming'})
        return Response(result)

    def post(self, request, case_id):
        if not _owns_case(request, case_id):
            return Response({'error': 'Case not found'}, status=status.HTTP_404_NOT_FOUND)
        related_id = request.data.get('relatedCaseId')
        if not related_id:
            return Response({'error': 'relatedCaseId is required'}, status=status.HTTP_400_BAD_REQUEST)
        if int(related_id) == int(case_id):
            return Response({'error': 'A case cannot be linked to itself'}, status=status.HTTP_400_BAD_REQUEST)
        if not _owns_case(request, related_id):
            return Response({'error': 'Related case not found'}, status=status.HTTP_404_NOT_FOUND)
        link, _created = RelatedCase.objects.get_or_create(
            advocate_id=request.user.id, case_id=case_id, related_case_id=related_id,
            defaults={'relation': request.data.get('relation') or None,
                      'note': request.data.get('note') or None},
        )
        return Response({'id': link.id, 'linkedCaseId': link.related_case_id,
                         'relation': link.relation, 'note': link.note},
                        status=status.HTTP_201_CREATED)


class DeleteRelatedCaseView(APIView):
    permission_classes = [RequirePermission()]

    def delete(self, request, pk):
        link = RelatedCase.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if link is None:
            return Response({'error': 'Link not found'}, status=status.HTTP_404_NOT_FOUND)
        link.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Court display boards (live cause lists) ----------------------------
# All scraping lives in the standalone FastAPI scraper service (scrap_court);
# this view is a thin, server-side-cached proxy to its /display-board endpoint.
# The frontend contract (bench / benches / rows[...]) is preserved by mapping
# the scraper's envelope (court / courts / rows[...]) onto it.

log = logging.getLogger(__name__)

from courtsearch import client as court_client
from courtsearch import matching
from core.practice import practice_ids

# Cached once an hour per court so page loads are fast and the courts' servers
# (and the scraper) are never hammered regardless of how many advocates view.
BOARD_CACHE_TTL = 3600  # 1 hour


class DisplayBoardCourtsView(APIView):
    """List of courts whose boards can be shown (feeds the accordion), proxied and
    cached from the scraper microservice. Cheap — no scraping involved."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        courts = cache.get('court_display_courts')
        if courts is None:
            try:
                courts = court_client.get_display_courts()
            except (court_client.ScraperUnavailable, court_client.ScraperError):
                return Response({'courts': []}, status=status.HTTP_502_BAD_GATEWAY)
            cache.set('court_display_courts', courts, BOARD_CACHE_TTL)
        return Response({'courts': courts})


class DisplayBoardView(APIView):
    """Live court display board for a selected court, proxied and cached from the
    scraper microservice's /display-board endpoint."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        court = (request.query_params.get('bench') or 'chennai').strip().lower()

        cache_key = f'court_display_board:{court}'
        payload = cache.get(cache_key)
        if payload is None:
            try:
                data = court_client.get_display_board(court)
            except court_client.ScraperUnavailable:
                return Response(
                    {'error': 'Could not reach the court display board service. Please try again shortly.',
                     'bench': court, 'benches': []},
                    status=status.HTTP_502_BAD_GATEWAY,
                )
            except court_client.ScraperError as exc:
                if exc.status == 404:
                    return Response({'error': f'Unknown court {court!r}', 'bench': court, 'benches': []},
                                    status=status.HTTP_400_BAD_REQUEST)
                log.warning('display board proxy failed for %s: %s', court, exc)
                return Response(
                    {'error': 'Could not load the court display board. Please try again shortly.',
                     'bench': court, 'benches': []},
                    status=status.HTTP_502_BAD_GATEWAY,
                )
            # Map the scraper envelope onto the frontend contract.
            payload = {
                'bench': data.get('court', court),
                'boardDate': data.get('boardDate', ''),
                'fetchedAt': data.get('fetchedAt', ''),
                'count': data.get('count', 0),
                'rows': data.get('rows', []),
                'benches': data.get('courts', []),
            }
            cache.set(cache_key, payload, BOARD_CACHE_TTL)

        return Response(_with_your_items(request.user, court, payload))


def _with_your_items(advocate, court, payload):
    """Add each row's `yourItem` - where THIS advocate's case sits in that
    courtroom's list today.

    The board itself is public and cached per court, shared by every user. This
    overlay is per practice, so it is applied AFTER the cache is read and the
    merged result is never written back - caching it would show one practice
    another practice's listings. The payload is copied for the same reason: the
    cached dict and its row dicts must not be mutated in place.

    A board says only what a courtroom is calling right now; `yourItem` comes
    from the stored cause list, which is the day's full order. Together they
    answer "the court is on item 29, you are item 40".
    """
    import datetime

    rows = payload.get('rows') or []
    try:
        mine = matching.your_items_by_courtroom(
            advocate, court, datetime.date.today())
    except Exception:                                   # noqa: BLE001
        # An overlay problem must not take the board down with it.
        log.exception('display board: could not resolve your-items for %s', court)
        return payload
    if not mine:
        return payload

    merged = dict(payload)
    merged['rows'] = [
        dict(r, yourItem=mine.get(r.get('courtNumber'), '')) for r in rows
    ]
    return merged
