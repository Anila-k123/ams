"""Root URL config. Every app carries its full resource segment under /api/ so the
paths match the frontend EXACTLY, including bare collection paths with no trailing
slash (e.g. GET /api/clients).
"""

from django.urls import path, include
from core.views import health

urlpatterns = [
    path('api/health', health),
    path('api/', include('accounts.urls')),
    path('api/', include('clients.urls')),
    path('api/', include('cases.urls')),
    path('api/', include('events.urls')),
    path('api/', include('documents.urls')),
    path('api/', include('dashboard.urls')),
    path('api/', include('notifications.urls')),
    path('api/', include('rbac.urls')),
    path('api/', include('expenses.urls')),
    path('api/', include('invoices.urls')),
    path('api/', include('payments.urls')),
    path('api/', include('tasks.urls')),
    path('api/', include('search.urls')),
    path('api/', include('reports.urls')),
    path('api/', include('audit.urls')),
    path('api/', include('backup.urls')),
    path('api/', include('communication.urls')),
    path('api/', include('assistant.urls')),
    path('api/', include('appeals.urls')),
    path('api/', include('workspace.urls')),
    path('api/', include('courtsearch.urls')),
]
