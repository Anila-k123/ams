from django.urls import path
from . import views

urlpatterns = [
    # /api/reports/*
    path('reports/cases', views.CaseReportView.as_view()),
    path('reports/clients', views.ClientReportView.as_view()),
    path('reports/expenses', views.ExpenseReportView.as_view()),
    path('reports/invoice/<int:pk>', views.InvoicePdfView.as_view()),
    path('reports/receipt/<int:pk>', views.ReceiptPdfView.as_view()),
    path('reports/client/<int:pk>/pdf', views.ClientDetailPdfView.as_view()),
    path('reports/case/<int:pk>/pdf', views.CaseDetailPdfView.as_view()),
    path('reports/monthly/pdf', views.MonthlyPdfView.as_view()),
    path('reports/expense/pdf', views.FilteredExpensePdfView.as_view()),
    path('reports/dashboard/pdf', views.DashboardPdfView.as_view()),
    # /api/reports-center/*
    path('reports-center', views.ReportsCenterView.as_view()),
    path('reports-center/export/csv', views.ReportsCenterCsvView.as_view()),
]
