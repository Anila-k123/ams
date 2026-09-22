from django.urls import path
from . import views

urlpatterns = [
    path('lawcodes/search', views.LawCodeSearchView.as_view()),
    path('lawcodes/convert', views.LawCodeConvertView.as_view()),
    path('lawcodes', views.LawCodeListView.as_view()),
]
