from django.urls import path
from . import views

urlpatterns = [
    path('notifications', views.all_notifications),
    path('notifications/unread', views.unread),
    path('notifications/<int:pk>/read', views.mark_read),
]
