from django.urls import path
from . import views

urlpatterns = [
    path('invoices', views.InvoiceListView.as_view()),
    path('invoices/my-invoices', views.MyInvoicesView.as_view()),
    path('invoices/summary', views.InvoiceSummaryView.as_view()),
    path('invoices/create', views.CreateInvoiceView.as_view()),
    path('invoices/recipient-defaults', views.RecipientDefaultsView.as_view()),
    path('invoices/pay/<int:pk>', views.PayInvoiceView.as_view()),
    path('invoices/<int:pk>/cancel', views.CancelInvoiceView.as_view()),
    path('invoices/billing-profile', views.BillingProfileView.as_view()),
    # Advocate-raised invoices waiting for accounts to issue.
    path('invoices/requests', views.InvoiceRequestListView.as_view()),
    path('invoices/requests/<int:pk>', views.InvoiceRequestDetailView.as_view()),
    path('invoices/requests/<int:pk>/issue', views.InvoiceRequestIssueView.as_view()),
    path('invoices/requests/<int:pk>/return', views.InvoiceRequestReturnView.as_view()),
]
