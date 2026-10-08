from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .ams_cases import AmsCasesView, AmsLinkCaseView
from .ams_documents import AmsDocumentImportView, AmsDocumentsView
from .export.views import DraftDocxExportView, DraftRedlineExportView
from .filing import DraftAmsTaskView, SendToAmsView
from .comments import CommentDeleteView, CommentReplyView, CommentResolveView, CommentsView
from .casefile import CaseFileView
from .incoming import ImportChangesView
from .review_requests import (
    ForMyReviewView, MyReviewStatusView, ReviewersView, ReviewRequestCancelView, ReviewRequestDoneView, ReviewRequestsView,
)
from .review_views import (
    RoundCancelView, RoundDecideView, RoundFinishView, RoundListView, RoundView, SuggestView,
)
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
    # Word tracked changes between two saved versions (docs/DRAFT_EXPORT.md).
    path('drafts/<int:pk>/export/redline/', DraftRedlineExportView.as_view(), name='draft-export-redline'),
    # Review rounds: suggestions and accept / reject (drafting/review.py, docs/DRAFT_REVIEW.md).
    path('draft-sessions/<int:pk>/suggest/', SuggestView.as_view(), name='draft-suggest'),
    path('draft-sessions/<int:pk>/rounds/', RoundListView.as_view(), name='draft-rounds'),
    path('rounds/<int:pk>/', RoundView.as_view(), name='draft-round'),
    path('rounds/<int:pk>/decide/', RoundDecideView.as_view(), name='draft-round-decide'),
    path('rounds/<int:pk>/finish/', RoundFinishView.as_view(), name='draft-round-finish'),
    path('rounds/<int:pk>/cancel/', RoundCancelView.as_view(), name='draft-round-cancel'),
    # Comments on passages (drafting/comments.py).
    path('draft-sessions/<int:pk>/case-file/', CaseFileView.as_view(), name='draft-case-file'),
    path('draft-sessions/<int:pk>/import-changes/', ImportChangesView.as_view(), name='draft-import-changes'),
    path('draft-sessions/<int:pk>/comments/', CommentsView.as_view(), name='draft-comments'),
    path('comments/<int:pk>/reply/', CommentReplyView.as_view(), name='draft-comment-reply'),
    path('comments/<int:pk>/resolve/', CommentResolveView.as_view(), name='draft-comment-resolve'),
    path('comments/<int:pk>/reopen/', CommentResolveView.as_view(reopen=True), name='draft-comment-reopen'),
    path('comments/<int:pk>/', CommentDeleteView.as_view(), name='draft-comment'),
    # Request review for drafts without a task (drafting/review_requests.py).
    path('draft-sessions/<int:pk>/reviewers/', ReviewersView.as_view(), name='draft-reviewers'),
    path('draft-sessions/<int:pk>/review-requests/', ReviewRequestsView.as_view(), name='draft-review-requests'),
    path('review-requests/<int:pk>/done/', ReviewRequestDoneView.as_view(), name='draft-review-request-done'),
    path('review-requests/<int:pk>/cancel/', ReviewRequestCancelView.as_view(), name='draft-review-request-cancel'),
    path('drafts/for-review/', ForMyReviewView.as_view(), name='drafts-for-review'),
    path('drafts/review-status/', MyReviewStatusView.as_view(), name='drafts-review-status'),
    # File the draft on its AMS case / task, and read the task's review state
    # (merge phase 07, in-process: drafting/filing.py).
    path('drafts/<int:pk>/send-to-ams/', SendToAmsView.as_view(), name='draft-send-to-ams'),
    path('drafts/<int:pk>/ams-task/', DraftAmsTaskView.as_view(), name='draft-ams-task'),
]
