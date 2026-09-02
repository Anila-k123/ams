from django.urls import path
from . import views

urlpatterns = [
    path('cases', views.CaseListView.as_view()),
    path('cases/my-cases', views.MyCasesView.as_view()),
    path('cases/search', views.SearchCasesView.as_view()),
    path('cases/create', views.CreateCaseView.as_view()),
    path('cases/update/<int:pk>', views.UpdateCaseView.as_view()),
    path('cases/delete/<int:pk>', views.DeleteCaseView.as_view()),
    path('cases/restore/<int:pk>', views.RestoreCaseView.as_view()),
    path('cases/transfer/<int:pk>', views.TransferCaseView.as_view()),
    path('cases/<int:pk>/hearing-alert', views.HearingAlertView.as_view()),
]
