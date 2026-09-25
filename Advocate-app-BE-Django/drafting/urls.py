from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .ams_cases import AmsCasesView, AmsLinkCaseView
from .ams_documents import AmsDocumentImportView, AmsDocumentsView
from .export.views import DraftDocxExportView
from .filing import DraftAmsTaskView, SendToAmsView
from .views import (
    TemplateViewSet, SampleViewSet,
    DraftSessionViewSet, PlaybookViewSet, PlaybookClauseViewSet,
)

# DRF router auto-generates the list/detail/CRUD routes (and any @action
# endpoints) for each registered viewset.
router = DefaultRouter()
router.register('templates', TemplateViewSet, basename='template')
router.register('samples', SampleViewSet, basename='sample')
router.register('draft-sessions', DraftSessionViewSet, basename='draft-session')
router.register('playbooks', PlaybookViewSet, basename='playbook')
router.register('playbook-clauses', PlaybookClauseViewSet, basename='playbook-clause')

# Mount all router-generated routes at this app's URL root.
urlpatterns = [
    path('', include(router.urls)),
    # Server-rendered Word export of a draft (optionally on the AMS letterhead).
    # The practice's AMS cases and documents, for the new-draft dialog and Documents page.
    path('ams-cases/', AmsCasesView.as_view(), name='drafting-ams-cases'),
    path('link-case/', AmsLinkCaseView.as_view(), name='drafting-link-case'),
    path('ams-documents/', AmsDocumentsView.as_view(), name='drafting-ams-documents'),
    path('ams-documents/<int:pk>/import/', AmsDocumentImportView.as_view(), name='drafting-ams-document-import'),
    path('drafts/<int:pk>/export/docx/', DraftDocxExportView.as_view(), name='draft-export-docx'),
    # File the draft on its AMS case / task, and read the task's review state
    # (merge phase 07, in-process: drafting/filing.py).
    path('drafts/<int:pk>/send-to-ams/', SendToAmsView.as_view(), name='draft-send-to-ams'),
    path('drafts/<int:pk>/ams-task/', DraftAmsTaskView.as_view(), name='draft-ams-task'),
]
