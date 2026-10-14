from django.urls import path
from . import views

urlpatterns = [
    path('roles', views.list_roles),
    path('roles/<int:role_id>', views.role_detail),
    path('roles/<int:role_id>/permissions', views.role_permissions),
    path('roles/<int:role_id>/clone', views.role_clone),
    path('roles/<int:role_id>/members', views.role_members),
    path('permissions', views.list_permissions),
    # Admin user management
    path('admin/users', views.UsersView.as_view()),
    path('admin/users/<int:pk>', views.UserDetailView.as_view()),
    path('admin/users/<int:pk>/roles', views.UserRolesView.as_view()),
    path('admin/users/<int:pk>/revoke-sessions', views.UserSessionsView.as_view()),
    path('admin/users/<int:pk>/roles/<int:role_id>', views.UserRoleItemView.as_view()),
]
