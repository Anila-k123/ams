from django.urls import path

from . import admin_views, views

urlpatterns = [
    path('firm/current', admin_views.CurrentFirmView.as_view()),
    path('firm/settings', admin_views.FirmSettingsView.as_view()),
    path('firm/settings/logo', admin_views.FirmLogoView.as_view()),
    path('firm/members', admin_views.FirmMembersView.as_view()),
    path('firm/invitations', views.StaffInvitationsView.as_view()),
    path('firm/invitations/<int:pk>/<str:action>', views.StaffInvitationActionView.as_view()),
    path('firm/members/<int:advocate_id>/<str:action>', views.MemberLifecycleView.as_view()),
    path('invitations/preview', views.InvitationPreviewView.as_view()),
    path('invitations/accept', views.InvitationAcceptView.as_view()),
]
