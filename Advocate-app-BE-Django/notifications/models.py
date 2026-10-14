# Most notification models live in core.models (Spring-era tables, managed=False).
# The two below are ours (managed, notifications/migrations).
from django.db import models


class NotificationKey(models.Model):
    """One reminder, once. Before a scheduled reminder is queued its key
    (recipient, event, entity, period) is inserted here; the unique index makes
    a second insert fail, so two scans at the same moment (the scheduler and the
    "check now" button), or a retried scan, can't queue it twice."""
    key = models.CharField(max_length=200, unique=True)
    firm_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'notification_key'


class JobRun(models.Model):
    """What a background job did: one row per run (and per firm when a job runs
    firm by firm). Read with `manage.py job_status`. `error` holds the exception
    type and a short message only - never payloads, document text or secrets."""
    RUNNING, SUCCEEDED, FAILED, SKIPPED = 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'

    job = models.CharField(max_length=80)
    firm_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    status = models.CharField(max_length=16, default=RUNNING)
    started_at = models.DateTimeField()
    finished_at = models.DateTimeField(null=True, blank=True)
    counts = models.JSONField(default=dict, blank=True)
    error = models.CharField(max_length=500, blank=True, default='')

    class Meta:
        db_table = 'job_run'
        indexes = [models.Index(fields=['job', '-started_at'], name='job_run_job_started')]
