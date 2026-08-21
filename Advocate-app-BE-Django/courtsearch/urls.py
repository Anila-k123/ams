from django.urls import path
from . import views

urlpatterns = [
    path('courtsearch/courts', views.CourtsView.as_view()),
    path('courtsearch/courts/<str:court_id>/case-types', views.CaseTypesView.as_view()),
    path('courtsearch/search', views.SearchView.as_view()),

    # Unified CNR lookup — tries District Courts and High Courts concurrently
    # and returns whichever one actually has the case (see CnrSearchView).
    path('courtsearch/cnr', views.CnrSearchView.as_view()),

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
    path('courtsearch/sci/diary-no', views.SciDiaryNoSearchView.as_view()),
    path('courtsearch/sci/cnr', views.SciCnrSearchView.as_view()),
    path('courtsearch/sci/aor-code', views.SciAorCodeSearchView.as_view()),
    path('courtsearch/sci/party-name', views.SciPartyNameSearchView.as_view()),
    path('courtsearch/sci/court-types', views.SciCourtTypesView.as_view()),
    path('courtsearch/sci/court-states', views.SciCourtStatesView.as_view()),
    path('courtsearch/sci/court-benches', views.SciCourtBenchesView.as_view()),
    path('courtsearch/sci/court-case-types', views.SciCourtCaseTypesView.as_view()),
    path('courtsearch/sci/court-search', views.SciCourtSearchView.as_view()),

    # eCourts High Court Services — cascade + case-number search
    path('courtsearch/hc/high-courts', views.HcHighCourtsView.as_view()),
    path('courtsearch/hc/benches', views.HcBenchesView.as_view()),
    path('courtsearch/hc/case-types', views.HcCaseTypesView.as_view()),
    path('courtsearch/hc/search', views.HcSearchView.as_view()),
    path('courtsearch/hc/police-stations', views.HcPoliceStationsView.as_view()),
    path('courtsearch/hc/act-types', views.HcActTypesView.as_view()),
    path('courtsearch/hc/list-search', views.HcListSearchView.as_view()),
    path('courtsearch/hc/case-detail', views.HcCaseDetailView.as_view()),
    path('courtsearch/hc/cnr', views.HcCnrView.as_view()),
    path('courtsearch/hc/order-pdf', views.HcOrderPdfView.as_view()),

    # Persisted full court-API record for an imported case
    path('courtsearch/imported-records', views.ImportedRecordView.as_view()),
]
