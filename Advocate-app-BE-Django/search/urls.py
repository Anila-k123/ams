from django.urls import path
from . import views

urlpatterns = [
    path('search', views.search),
    path('search/global', views.search),
]
