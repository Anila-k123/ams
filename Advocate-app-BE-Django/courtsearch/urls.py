from django.urls import path
from . import views

urlpatterns = [
    path('courtsearch/courts', views.CourtsView.as_view()),
    path('courtsearch/courts/<str:court_id>/case-types', views.CaseTypesView.as_view()),
    path('courtsearch/search', views.SearchView.as_view()),

    # eCourts District Courts — stateful cascade
    path('courtsearch/ecourts/search', views.EcourtsSearchView.as_view()),
    path('courtsearch/ecourts/cnr', views.EcourtsCnrView.as_view()),
    path('courtsearch/ecourts/list-search', views.EcourtsListSearchView.as_view()),
    path('courtsearch/ecourts/case-detail', views.EcourtsCaseDetailView.as_view()),
    path('courtsearch/ecourts/document', views.EcourtsDocumentView.as_view()),
    path('courtsearch/ecourts/<str:step>', views.EcourtsCascadeView.as_view()),

    # Supreme Court of India — case status
    path('courtsearch/sci/case-types', views.SciCaseTypesView.as_view()),
    path('courtsearch/sci/case-no', views.SciCaseNoSearchView.as_view()),
    path('courtsearch/sci/case-detail', views.SciCaseDetailView.as_view()),

    # eCourts High Court Services — cascade + case-number search
    path('courtsearch/hc/high-courts', views.HcHighCourtsView.as_view()),
    path('courtsearch/hc/benches', views.HcBenchesView.as_view()),
    path('courtsearch/hc/case-types', views.HcCaseTypesView.as_view()),
    path('courtsearch/hc/search', views.HcSearchView.as_view()),
    path('courtsearch/hc/order-pdf', views.HcOrderPdfView.as_view()),

    # Persisted full court-API record for an imported case
    path('courtsearch/imported-records', views.ImportedRecordView.as_view()),
]
