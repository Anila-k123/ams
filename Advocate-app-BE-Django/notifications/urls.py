from django.urls import path
from . import views

urlpatterns = [
    path('notifications', views.all_notifications),
    path('notifications/unread', views.unread),
    path('notifications/<int:pk>/read', views.mark_read),
    # The dashboard bell PUTs /notifications/read/<id>; keep both spellings
    # rather than breaking a caller over path order.
    path('notifications/read/<int:pk>', views.mark_read),

    # Delivery history - the Notifications Center's contract.
    path('notifications/history', views.history),
    path('notifications/history/filter', views.history_filter),
    path('notifications/history/stats', views.history_stats),
    path('notifications/trigger-check', views.trigger_check),
]
