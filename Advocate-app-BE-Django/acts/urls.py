from django.urls import path
from . import views

urlpatterns = [
    path('acts', views.ActListView.as_view()),
    path('acts/<int:pk>', views.ActDetailView.as_view()),
    path('acts/<int:pk>/sections/<int:section_id>', views.ActSectionDetailView.as_view()),
]
