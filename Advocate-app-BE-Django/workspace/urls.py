from django.urls import path
from . import views

urlpatterns = [
    # Court display boards (live cause lists, proxied from the scraper service)
    path('workspace/display-board/courts', views.DisplayBoardCourtsView.as_view()),
    path('workspace/display-board', views.DisplayBoardView.as_view()),

    # Aggregations
    path('workspace/stats', views.WorkspaceStatsView.as_view()),
    path('workspace/next-hearings', views.NextHearingsView.as_view()),
    path('workspace/tags', views.AllTagsView.as_view()),
    path('workspace/cases/<int:case_id>/summary', views.CaseSummaryView.as_view()),
    path('workspace/cases/<int:case_id>/financials', views.CaseFinancialsView.as_view()),
    path('workspace/cases/<int:case_id>/events', views.CaseEventsView.as_view()),

    # Notes
    path('workspace/cases/<int:case_id>/notes', views.CaseNotesView.as_view()),
    path('workspace/notes/<int:pk>', views.DeleteCaseNoteView.as_view()),

    # Tags
    path('workspace/cases/<int:case_id>/tags', views.CaseTagsView.as_view()),
    path('workspace/tags/<int:pk>', views.DeleteCaseTagView.as_view()),

    # Tasks — unified (standalone + per-case)
    path('workspace/tasks/all', views.MyTasksAllView.as_view()),
    path('workspace/tasks/create', views.CreateTaskView.as_view()),
    path('workspace/cases/<int:case_id>/tasks', views.CaseTasksView.as_view()),
    path('workspace/tasks/<int:task_id>/documents', views.TaskDocumentsView.as_view()),
    path('workspace/tasks/<int:task_id>/documents/<int:document_id>', views.DeleteTaskDocumentView.as_view()),
    path('workspace/tasks/<int:pk>/toggle', views.ToggleCaseTaskView.as_view()),
    path('workspace/tasks/<int:pk>', views.DeleteCaseTaskView.as_view()),

    # Parties / opponents
    path('workspace/cases/<int:case_id>/parties', views.CasePartiesView.as_view()),
    path('workspace/parties/<int:pk>', views.DeleteCasePartyView.as_view()),

    # Related cases
    path('workspace/cases/<int:case_id>/related', views.RelatedCasesView.as_view()),
    path('workspace/related/<int:pk>', views.DeleteRelatedCaseView.as_view()),
]
