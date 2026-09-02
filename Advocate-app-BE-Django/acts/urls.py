from django.urls import path
from . import views

urlpatterns = [
    path('acts', views.ActListView.as_view()),
    path('acts/<int:pk>', views.ActDetailView.as_view()),
    path('acts/<int:pk>/sections/<int:section_id>', views.ActSectionDetailView.as_view()),
    path('acts/<int:pk>/cases', views.ActCaseLinksView.as_view()),
    path('acts/<int:pk>/cases/<int:case_id>', views.ActCaseUnlinkView.as_view()),
    # Reverse direction — the "Acts" tab on a case.
    path('cases/<int:case_id>/acts', views.CaseActLinksView.as_view()),
    path('cases/<int:case_id>/acts/<int:act_id>', views.CaseActUnlinkView.as_view()),
    # Acts the court cited on the imported record (matched to our library).
    path('cases/<int:case_id>/cited-acts', views.CaseCitedActsView.as_view()),
]
