from django.urls import path
from . import views

urlpatterns = [
    path('clients', views.ClientListView.as_view()),
    path('clients/my-clients', views.MyClientsView.as_view()),
    path('clients/archived', views.ArchivedClientsView.as_view()),
    path('clients/search', views.SearchClientsView.as_view()),
    path('clients/create', views.CreateClientView.as_view()),
    path('clients/update/<int:pk>', views.UpdateClientView.as_view()),
    path('clients/delete/<int:pk>', views.DeleteClientView.as_view()),
    path('clients/restore/<int:pk>', views.RestoreClientView.as_view()),
    path('clients/<int:pk>', views.ClientDetailView.as_view()),
]
