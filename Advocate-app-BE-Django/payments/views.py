import datetime
from django.db.models import Sum
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import ClientPayment, Case
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import ClientPaymentSerializer

SORT_MAP = {'paymentDate': 'payment_date', 'amount': 'amount', 'id': 'id'}


def _base(request):
    return ClientPayment.objects.select_related('case', 'client').filter(advocate_id=request.user.id)


def _case_id(data):
    if data.get('caseId') is not None:
        return data.get('caseId')
    ce = data.get('caseEntity')
    return ce.get('id') if isinstance(ce, dict) else None


class PaymentListView(APIView):
    permission_classes = [RequirePermission('PAYMENT_VIEW')]

    def get(self, request):
        sort_by = SORT_MAP.get(request.query_params.get('sortBy', 'paymentDate'), 'payment_date')
        sort_dir = request.query_params.get('sortDir', 'desc')
        qs = _base(request).order_by(sort_by if sort_dir == 'asc' else '-' + sort_by, '-id')
        paginator = SpringStylePagination()
        page = paginator.paginate_queryset(qs, request, self)
        return paginator.get_paginated_response(ClientPaymentSerializer(page, many=True).data)


class PaymentsByCaseView(APIView):
    permission_classes = [RequirePermission('PAYMENT_VIEW')]

    def get(self, request, case_id):
        qs = _base(request).filter(case_id=case_id).order_by('-payment_date', '-id')
        return Response(ClientPaymentSerializer(qs, many=True).data)


class TodayPaymentsView(APIView):
    permission_classes = [RequirePermission('PAYMENT_VIEW')]

    def get(self, request):
        today = datetime.date.today()
        qs = _base(request).filter(payment_date=today).order_by('-id')
        total = qs.aggregate(s=Sum('amount'))['s'] or 0
        return Response({'payments': ClientPaymentSerializer(qs, many=True).data,
                         'totalAmount': total, 'date': today.isoformat()})


class MonthlyPaymentsView(APIView):
    permission_classes = [RequirePermission('PAYMENT_VIEW')]

    def get(self, request):
        try:
            year = int(request.query_params.get('year'))
            month = int(request.query_params.get('month'))
        except (TypeError, ValueError):
            now = datetime.date.today()
            year, month = now.year, now.month
        qs = _base(request).filter(payment_date__year=year, payment_date__month=month)
        total = qs.aggregate(s=Sum('amount'))['s'] or 0
        return Response({'payments': ClientPaymentSerializer(qs.order_by('-payment_date'), many=True).data,
                         'totalAmount': total, 'month': month, 'year': year})


class CreatePaymentView(APIView):
    permission_classes = [RequirePermission('PAYMENT_CREATE')]

    def post(self, request):
        data = request.data
        cid = _case_id(data)
        case = Case.objects.filter(id=cid, advocate_id=request.user.id).first() if cid else None
        payment = ClientPayment.objects.create(
            amount=data.get('amount'),
            payment_mode=data.get('paymentMode'),
            reference_number=data.get('referenceNumber'),
            payment_date=data.get('paymentDate') or None,
            description=data.get('description'),
            advocate_id=request.user.id,
            case=case,
            client=case.client if case else None,
        )
        return Response(ClientPaymentSerializer(payment).data, status=status.HTTP_201_CREATED)
