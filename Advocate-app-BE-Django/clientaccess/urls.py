from django.urls import path
from . import views

urlpatterns = [
    # The client's own API (Client role; clientaccess.gate allows only /api/client/ for them).
    path('client/me', views.ClientMeView.as_view()),
    path('client/overview', views.ClientOverviewView.as_view()),
    path('client/cases', views.ClientCasesView.as_view()),
    path('client/cases/<int:pk>', views.ClientCaseDetailView.as_view()),
    path('client/invoices', views.ClientInvoicesView.as_view()),
    path('client/invoices/<int:pk>/pdf', views.ClientInvoicePdfView.as_view()),
    path('client/payments', views.ClientPaymentsView.as_view()),
    path('client/documents', views.ClientDocumentsView.as_view()),
    path('client/documents/<int:pk>/file', views.ClientDocumentFileView.as_view()),
    path('client/messages', views.ClientMessagesView.as_view()),
    # Public: set a password from the emailed one-time link.
    path('client-auth/set-password', views.SetPasswordView.as_view()),
    # Firm side.
    path('clients/<int:client_id>/logins', views.ClientLoginsView.as_view()),
    path('clients/<int:client_id>/logins/<int:login_id>', views.ClientLoginDetailView.as_view()),
    path('documents/<int:pk>/client-visible', views.DocumentClientVisibleView.as_view()),
]
