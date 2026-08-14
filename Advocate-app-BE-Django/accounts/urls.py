from django.urls import path
from . import views
from . import otp_views

urlpatterns = [
    # /api/advocates/*
    path('advocates/login', views.LoginView.as_view()),
    path('advocates/signup', views.SignupView.as_view()),
    path('advocates/logout', views.LogoutView.as_view()),
    path('advocates/profile', views.ProfileView.as_view()),
    path('advocates/settings', views.SettingsView.as_view()),
    path('advocates/notification-settings', views.NotificationSettingsView.as_view()),
    path('advocates/my-permissions', views.my_permissions),
    path('advocates/my-roles', views.my_roles),
    # /api/auth/* (password-reset OTP flow)
    path('auth/forgot-password', otp_views.forgot_password),
    path('auth/verify-otp', otp_views.verify_otp),
    path('auth/reset-password', otp_views.reset_password),
    # /api/profile/*
    path('profile', views.FullProfileView.as_view()),
    path('profile/preferences', views.PreferencesView.as_view()),
    path('profile/change-password', views.ChangePasswordView.as_view()),
    path('profile/branding/<str:type>', views.BrandingUploadView.as_view()),
    path('profile/files/<str:sub_dir>/<str:filename>', views.serve_branding_file),
]
