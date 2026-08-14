from django.urls import path
from . import views

urlpatterns = [
    path('payments', views.PaymentListView.as_view()),
    path('payments/case/<int:case_id>', views.PaymentsByCaseView.as_view()),
    path('payments/today', views.TodayPaymentsView.as_view()),
    path('payments/monthly', views.MonthlyPaymentsView.as_view()),
    path('payments/create', views.CreatePaymentView.as_view()),
]
