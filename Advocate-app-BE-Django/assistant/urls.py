from django.urls import path
from . import views

urlpatterns = [
    path('assistant/query', views.AssistantQueryView.as_view()),
    path('assistant/chat', views.AssistantChatView.as_view()),
]
