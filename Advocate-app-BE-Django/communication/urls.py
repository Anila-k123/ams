from django.urls import path
from . import views, whatsapp

urlpatterns = [
    # /api/communication/*
    path('communication/settings', views.SettingsView.as_view()),
    path('communication/templates', views.TemplatesView.as_view()),
    path('communication/templates/<int:pk>', views.TemplateDetailView.as_view()),
    path('communication/history', views.HistoryView.as_view()),
    path('communication/statistics', views.StatisticsView.as_view()),
    path('communication/logs', views.LogsView.as_view()),
    path('communication/queue/status', views.QueueStatusView.as_view()),
    path('communication/test', views.TestView.as_view()),
    path('communication/export/csv', views.ExportCsvView.as_view()),
    # /api/whatsapp/*
    path('whatsapp/webhook', whatsapp.webhook),
    path('whatsapp/send-manual', whatsapp.SendManualView.as_view()),
    path('whatsapp/resend/<int:history_id>', whatsapp.ResendView.as_view()),
]
