from django.urls import path
from . import views

urlpatterns = [
    path('events', views.EventListView.as_view()),
    path('events/my-events', views.MyEventsView.as_view()),
    path('events/today', views.TodayEventsView.as_view()),
    path('events/upcoming', views.UpcomingEventsView.as_view()),
    path('events/create', views.CreateEventView.as_view()),
    path('events/update/<int:pk>', views.UpdateEventView.as_view()),
    path('events/delete/<int:pk>', views.DeleteEventView.as_view()),
]
