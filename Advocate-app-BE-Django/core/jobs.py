"""Structured status for background jobs (notifications/models.JobRun).

    with job_run('scan_notifications', firm_id=7) as run:
        ...
        run.counts['queued'] = 12

Records RUNNING at the start and SUCCEEDED / FAILED at the end, with counts and
a short, safe error (exception type + first line, no payloads). A failure is
recorded and re-raised, so the caller still decides whether to carry on.
Recording never breaks the job itself.
"""
from __future__ import annotations

import contextlib
import logging

from django.utils import timezone

log = logging.getLogger('jobs')


def safe_error(exc) -> str:
    first = (str(exc) or '').strip().splitlines()[0] if str(exc).strip() else ''
    return '{}: {}'.format(type(exc).__name__, first)[:500]


class _Run:
    def __init__(self, row):
        self.row = row
        self.counts = {}


@contextlib.contextmanager
def job_run(job, firm_id=None):
    from notifications.models import JobRun
    row = None
    try:
        row = JobRun.objects.create(job=job, firm_id=firm_id, started_at=timezone.now())
    except Exception:                                       # noqa: BLE001
        log.exception('job_run: could not record start of %s', job)
    run = _Run(row)
    try:
        yield run
    except Exception as exc:
        _finish(row, JobRun.FAILED, run.counts, safe_error(exc))
        log.error('job %s failed (firm %s): %s', job, firm_id, safe_error(exc))
        raise
    else:
        _finish(row, run.counts.pop('_status', JobRun.SUCCEEDED), run.counts, run.counts.pop('_error', ''))


def _finish(row, status, counts, error):
    if row is None:
        return
    try:
        row.status, row.counts, row.error, row.finished_at = status, counts, error, timezone.now()
        row.save(update_fields=['status', 'counts', 'error', 'finished_at'])
    except Exception:                                       # noqa: BLE001
        log.exception('job_run: could not record end of %s', row.job)
