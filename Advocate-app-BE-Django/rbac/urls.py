from django.urls import path
from . import views

urlpatterns = [
    path('roles', views.list_roles),
    path('roles/<int:role_id>/permissions', views.role_permissions),
    path('permissions', views.list_permissions),
    # Admin user management
    path('admin/users', views.UsersView.as_view()),
    path('admin/users/<int:pk>', views.UserDetailView.as_view()),
    path('admin/users/<int:pk>/roles', views.UserRolesView.as_view()),
    path('admin/users/<int:pk>/roles/<int:role_id>', views.UserRoleItemView.as_view()),
]
