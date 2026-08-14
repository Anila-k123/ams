from django.urls import path
from . import views

urlpatterns = [
    path('tasks', views.TaskListView.as_view()),
    path('tasks/my-tasks', views.MyTasksView.as_view()),
    path('tasks/create', views.CreateTaskView.as_view()),
    path('tasks/toggle/<int:pk>', views.ToggleTaskView.as_view()),
    path('tasks/delete/<int:pk>', views.DeleteTaskView.as_view()),
]
