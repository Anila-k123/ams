from django.urls import path

from . import views

urlpatterns = [
    path('usage/summary', views.UsageSummaryView.as_view()),
]
