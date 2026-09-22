from django.urls import path
from . import views

urlpatterns = [
    path('documents', views.DocumentListView.as_view()),
    path('documents/list', views.DocumentSimpleListView.as_view()),
    path('documents/search', views.DocumentSimpleListView.as_view()),
    path('documents/filter', views.DocumentFilterView.as_view()),
    path('documents/stats', views.DocumentStatsView.as_view()),
    path('documents/upload', views.UploadDocumentView.as_view()),
    path('documents/download/<int:pk>', views.download_document),
    path('documents/preview/<int:pk>', views.preview_document),
    path('documents/by-case/<int:case_id>', views.DocumentsByCaseView.as_view()),
    path('documents/by-client/<int:client_id>', views.DocumentsByClientView.as_view()),
    path('documents/<int:pk>/summary', views.DocumentSummaryView.as_view()),
    path('documents/<int:pk>/summary/regenerate', views.DocumentSummaryRegenerateView.as_view()),
    path('documents/<int:pk>/versions', views.DocumentVersionsView.as_view()),
    path('documents/<int:pk>/versions/<int:version>/download', views.download_document_version),
    path('documents/<int:pk>', views.DocumentDetailView.as_view()),
]
