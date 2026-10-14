from django.urls import path

from . import views

urlpatterns = [
    path('platform/auth/login', views.LoginView.as_view()),
    path('platform/auth/logout', views.LogoutView.as_view()),
    path('platform/auth/me', views.MeView.as_view()),
    path('platform/firms', views.FirmsView.as_view()),
    path('platform/firms/<uuid:public_id>', views.FirmDetailView.as_view()),
    path('platform/firms/<uuid:public_id>/usage', views.FirmUsageView.as_view()),
    path('platform/firms/<uuid:public_id>/invitations', views.FirmInvitationsView.as_view()),
    path('platform/firms/<uuid:public_id>/invitations/<int:invitation_id>/<str:action>',
         views.FirmInvitationActionView.as_view()),
    path('platform/firms/<uuid:public_id>/<str:action>', views.FirmLifecycleView.as_view()),
    path('platform/audit', views.AuditView.as_view()),
    path('platform/stats', views.StatsView.as_view()),
]
