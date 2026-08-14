from django.urls import path
from . import views

urlpatterns = [
    path('', views.FullProfileView.as_view()),
    path('preferences', views.PreferencesView.as_view()),
    path('change-password', views.ChangePasswordView.as_view()),
]
