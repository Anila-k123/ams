from django.urls import path
from . import views

urlpatterns = [
    path('acts', views.ActListView.as_view()),
    path('acts/<int:pk>', views.ActDetailView.as_view()),
    path('acts/<int:pk>/sections/<int:section_id>', views.ActSectionDetailView.as_view()),
    path('acts/<int:pk>/cases', views.ActCaseLinksView.as_view()),
    path('acts/<int:pk>/cases/<int:case_id>', views.ActCaseUnlinkView.as_view()),
]
