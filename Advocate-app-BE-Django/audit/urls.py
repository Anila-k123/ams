from django.urls import path
from . import views

urlpatterns = [
    path('audit', views.AuditView.as_view()),
    path('activities', views.ActivityListView.as_view()),
    path('activities/my-activities', views.MyActivitiesView.as_view()),
]
