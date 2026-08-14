from django.urls import path
from . import views

urlpatterns = [
    path('invoices', views.InvoiceListView.as_view()),
    path('invoices/my-invoices', views.MyInvoicesView.as_view()),
    path('invoices/summary', views.InvoiceSummaryView.as_view()),
    path('invoices/create', views.CreateInvoiceView.as_view()),
    path('invoices/pay/<int:pk>', views.PayInvoiceView.as_view()),
]
