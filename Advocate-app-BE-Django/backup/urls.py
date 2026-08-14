from django.urls import path
from . import views

urlpatterns = [
    path('backup/quick', views.QuickBackup.as_view()),
    path('backup/full', views.FullBackup.as_view()),
    path('backup/database', views.DatabaseBackup.as_view()),
    path('backup/documents', views.DocumentsBackup.as_view()),
    path('backup/reports', views.ReportsBackup.as_view()),
    path('backup/settings', views.SettingsBackup.as_view()),
    path('backup/restore', views.RestoreView.as_view()),
    path('backup/validate', views.ValidateView.as_view()),
    path('backup/history', views.HistoryView.as_view()),
    path('backup/stats', views.StatsView.as_view()),
    path('backup/download/<int:pk>', views.DownloadView.as_view()),
    path('backup/<int:pk>', views.DeleteView.as_view()),
]
