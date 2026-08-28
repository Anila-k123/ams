from django.urls import path
from . import views

urlpatterns = [
    path('notifications', views.all_notifications),
    path('notifications/unread', views.unread),
    path('notifications/<int:pk>/read', views.mark_read),
    # /notifications/read/<id> was an alias kept for the dashboard's second
    # bell. That bell is gone (NotificationBell is the only one now) and
    # nothing calls this spelling any more, so the alias goes with it.
    #   git show cb0195b~1:notifications/urls.py  -- if a caller turns up.

    # Delivery history - the Notifications Center's contract.
    path('notifications/history', views.history),
    path('notifications/history/filter', views.history_filter),
    path('notifications/history/stats', views.history_stats),
    path('notifications/trigger-check', views.trigger_check),
]
