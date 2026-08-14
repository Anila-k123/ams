from django.urls import path
from . import views

urlpatterns = [
    path('login', views.LoginView.as_view()),
    path('signup', views.SignupView.as_view()),
    path('logout', views.LogoutView.as_view()),
    path('profile', views.ProfileView.as_view()),
    path('settings', views.SettingsView.as_view()),
    path('notification-settings', views.NotificationSettingsView.as_view()),
    path('my-permissions', views.my_permissions),
    path('my-roles', views.my_roles),
]
