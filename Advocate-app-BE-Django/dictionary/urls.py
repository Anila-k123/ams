from django.urls import path
from . import views

urlpatterns = [
    path('dictionary/search', views.LegalTermSearchView.as_view()),
    path('dictionary/term/<int:pk>', views.LegalTermView.as_view()),
]
