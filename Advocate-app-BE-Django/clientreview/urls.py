from django.urls import path

from . import client_views, views

urlpatterns = [
    # Firm
    path('documents/<int:pk>/client-reviews', views.DocumentReviewsView.as_view()),
    path('client-reviews/<int:rid>/messages', views.ReviewMessagesView.as_view()),
    path('client-reviews/<int:rid>/rounds', views.ReviewRoundsView.as_view()),
    path('client-reviews/<int:rid>/cancel', views.ReviewCancelView.as_view()),
    path('client-reviews/<int:rid>/rounds/<int:number>/file', views.RoundFileView.as_view()),
    path('client-review-files/<int:fid>', views.ReviewFileView.as_view()),
    # The document server (signed links, no login)
    path('editor/clientcopy/file/<int:round_id>', views.CopyFileView.as_view()),
    path('editor/clientcopy/callback/<int:round_id>', views.CopyCallbackView.as_view()),
    # Client portal (only /api/client/ is open to client logins)
    path('client/reviews', client_views.ClientReviewsView.as_view()),
    path('client/reviews/files/<int:fid>', client_views.ClientReviewAttachmentView.as_view()),
    path('client/reviews/<int:rid>', client_views.ClientReviewView.as_view()),
    path('client/reviews/<int:rid>/editor', client_views.ClientReviewEditorView.as_view()),
    path('client/reviews/<int:rid>/file', client_views.ClientReviewCopyView.as_view()),
    path('client/reviews/<int:rid>/reply', client_views.ClientReviewReplyView.as_view()),
]
