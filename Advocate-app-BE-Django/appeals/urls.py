from django.urls import path
from . import views

urlpatterns = [
    path('appeal-alerts', views.AppealAlertListView.as_view()),
    path('appeal-alerts/create', views.CreateAppealAlertView.as_view()),
    path('appeal-alerts/delete/<int:pk>', views.DeleteAppealAlertView.as_view()),
]
