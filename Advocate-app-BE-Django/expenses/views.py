import datetime
from collections import defaultdict
from django.db.models import Q, Sum
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import Expense, Case
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import ExpenseSerializer
from core.practice import practice_ids

SORT_MAP = {'paymentDate': 'payment_date', 'amount': 'amount', 'title': 'title', 'id': 'id'}


def _base(request):
    return Expense.objects.select_related('case').filter(advocate_id__in=practice_ids(request.user))


def _case_id(data):
    if data.get('caseId') is not None:
        return data.get('caseId')
    ce = data.get('caseEntity')
    return ce.get('id') if isinstance(ce, dict) else None


def _apply(expense, data, request):
    expense.title = data.get('title', expense.title)
    if 'amount' in data:
        expense.amount = data.get('amount')
    expense.category = data.get('category')
    expense.description = data.get('description')
    expense.payment_mode = data.get('paymentMode')
    expense.payment_status = data.get('paymentStatus')
    expense.reference_number = data.get('referenceNumber')
    expense.payment_date = data.get('paymentDate') or None
    expense.expense_type = data.get('expenseType') or expense.expense_type or 'CLIENT_CASE'
    cid = _case_id(data)
    if cid is not None:
        case = Case.objects.filter(id=cid, advocate_id__in=practice_ids(request.user)).first()
        expense.case = case
        expense.client = case.client if case else None


class ExpenseListView(APIView):
    permission_classes = [RequirePermission('EXPENSE_VIEW')]

    def get(self, request):
        sort_by = SORT_MAP.get(request.query_params.get('sortBy', 'paymentDate'), 'payment_date')
        sort_dir = request.query_params.get('sortDir', 'desc')
        qs = _base(request).order_by(sort_by if sort_dir == 'asc' else '-' + sort_by, '-id')
        paginator = SpringStylePagination()
        page = paginator.paginate_queryset(qs, request, self)
        return paginator.get_paginated_response(ExpenseSerializer(page, many=True).data)


class MyExpensesView(APIView):
    permission_classes = [RequirePermission('EXPENSE_VIEW')]

    def get(self, request):
        qs = _base(request).order_by('-payment_date', '-id')
        return Response(ExpenseSerializer(qs, many=True).data)


class ExpensesByCaseView(APIView):
    permission_classes = [RequirePermission('EXPENSE_VIEW')]

    def get(self, request, case_id):
        qs = _base(request).filter(case_id=case_id).order_by('-payment_date', '-id')
        return Response(ExpenseSerializer(qs, many=True).data)


class SearchExpensesView(APIView):
    permission_classes = [RequirePermission('EXPENSE_VIEW')]

    def get(self, request):
        kw = request.query_params.get('keyword', '')
        qs = _base(request)
        if kw:
            qs = qs.filter(Q(title__icontains=kw) | Q(category__icontains=kw) |
                           Q(description__icontains=kw))
        return Response(ExpenseSerializer(qs.order_by('-payment_date', '-id'), many=True).data)


class TodayExpensesView(APIView):
    permission_classes = [RequirePermission('EXPENSE_VIEW')]

    def get(self, request):
        today = datetime.date.today()
        qs = _base(request).filter(payment_date=today).order_by('-id')
        total = qs.aggregate(s=Sum('amount'))['s'] or 0
        data = ExpenseSerializer(qs, many=True).data
        return Response({'expenses': data, 'totalAmount': total, 'totalExpenses': total,
                         'date': today.isoformat()})


class MonthlyExpensesView(APIView):
    permission_classes = [RequirePermission('EXPENSE_VIEW')]

    def get(self, request):
        try:
            year = int(request.query_params.get('year'))
            month = int(request.query_params.get('month'))
        except (TypeError, ValueError):
            now = datetime.date.today()
            year, month = now.year, now.month
        qs = _base(request).filter(payment_date__year=year, payment_date__month=month)
        total = qs.aggregate(s=Sum('amount'))['s'] or 0
        breakdown = defaultdict(float)
        for e in qs:
            breakdown[e.category or 'Uncategorized'] += (e.amount or 0)
        return Response({
            'expenses': ExpenseSerializer(qs.order_by('-payment_date'), many=True).data,
            'totalExpenses': total, 'totalAmount': total,
            'categoryBreakdown': dict(breakdown), 'month': month, 'year': year,
        })


class CreateExpenseView(APIView):
    permission_classes = [RequirePermission('EXPENSE_CREATE')]

    def post(self, request):
        data = request.data
        if not data.get('title'):
            return Response({'error': 'title is required'}, status=status.HTTP_400_BAD_REQUEST)
        expense = Expense(advocate_id=request.user.id)
        _apply(expense, data, request)
        expense.save()
        return Response(ExpenseSerializer(expense).data, status=status.HTTP_201_CREATED)


class UpdateExpenseView(APIView):
    permission_classes = [RequirePermission('EXPENSE_EDIT')]

    def put(self, request, pk):
        expense = _base(request).filter(id=pk).first()
        if expense is None:
            return Response({'error': 'Expense not found'}, status=status.HTTP_404_NOT_FOUND)
        _apply(expense, request.data, request)
        expense.save()
        return Response(ExpenseSerializer(expense).data)


class DeleteExpenseView(APIView):
    permission_classes = [RequirePermission('EXPENSE_DELETE')]

    def delete(self, request, pk):
        expense = Expense.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if expense is None:
            return Response({'error': 'Expense not found'}, status=status.HTTP_404_NOT_FOUND)
        expense.delete()
        return Response('Expense deleted successfully')
