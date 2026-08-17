from django.urls import path
from . import views

urlpatterns = [
    path('courtsearch/courts', views.CourtsView.as_view()),
    path('courtsearch/courts/<str:court_id>/case-types', views.CaseTypesView.as_view()),
    path('courtsearch/search', views.SearchView.as_view()),

    # eCourts District Courts — stateful cascade
    path('courtsearch/ecourts/search', views.EcourtsSearchView.as_view()),
    path('courtsearch/ecourts/cnr', views.EcourtsCnrView.as_view()),
    path('courtsearch/ecourts/document', views.EcourtsDocumentView.as_view()),
    path('courtsearch/ecourts/<str:step>', views.EcourtsCascadeView.as_view()),

    # Persisted full court-API record for an imported case
    path('courtsearch/imported-records', views.ImportedRecordView.as_view()),
]
