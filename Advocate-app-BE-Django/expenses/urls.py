from django.urls import path
from . import views

urlpatterns = [
    path('expenses', views.ExpenseListView.as_view()),
    path('expenses/my-expenses', views.MyExpensesView.as_view()),
    path('expenses/case/<int:case_id>', views.ExpensesByCaseView.as_view()),
    path('expenses/search', views.SearchExpensesView.as_view()),
    path('expenses/today', views.TodayExpensesView.as_view()),
    path('expenses/monthly', views.MonthlyExpensesView.as_view()),
    path('expenses/create', views.CreateExpenseView.as_view()),
    path('expenses/update/<int:pk>', views.UpdateExpenseView.as_view()),
    path('expenses/delete/<int:pk>', views.DeleteExpenseView.as_view()),
]
