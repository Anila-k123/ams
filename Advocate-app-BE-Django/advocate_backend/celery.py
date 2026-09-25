"""Celery app for drafting's background jobs (drafting/tasks.py).

Until a broker and a worker are run (docs/OPERATIONS.md), CELERY_TASK_ALWAYS_EAGER
is True and drafting/views.py::_dispatch runs each job in a thread of the web
process. With a worker:  celery -A advocate_backend worker -l info
"""

import os

from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'advocate_backend.settings')

app = Celery('advocate_backend')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
