"""Where drafting's background jobs run when there is no Celery worker.

Background jobs (drafting/tasks.py): document processing, draft generation,
summaries, translation, templates, playbooks and risk analysis. They are CPU-heavy
and load torch / transformers / docling (1-2 GB).

Run as threads inside the web server (the old eager mode), they made every AMS page
slow while they ran: Python threads in one process share one interpreter lock, and
the web process kept the AI libraries in memory until it restarted.

STOPGAP (current default, DRAFTING_JOB_RUNNER=process): one long-lived worker
process on the same machine, started on the first job.
- It runs the jobs one after another (DRAFTING_JOB_WORKERS, default 1).
- It loads the AI libraries once and keeps them.
- Page requests no longer compete with jobs for the interpreter.
- Limits:
  - jobs are lost if the web server stops;
  - each web server process gets its own worker, so do not use this with many
    web workers in production;
  - there are no retries and no monitoring.

PERMANENT SOLUTION (docs/OPERATIONS.md, "Background jobs"): run Redis and a
Celery worker (`celery -A advocate_backend worker`) and set
CELERY_TASK_ALWAYS_EAGER=False. `dispatch` then sends jobs to Celery and nothing
here is used.

DRAFTING_JOB_RUNNER=thread keeps the old in-web-process threads (debugging only).
"""

import logging
import os
import threading
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool

from django.conf import settings
from django.db import connections

log = logging.getLogger('drafting')

_pool = None
_pool_lock = threading.Lock()


def _init_worker():
    """Runs once in each worker process: a Django of its own."""
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'advocate_backend.settings')
    import django
    django.setup()


def _run_in_worker(task_name, args):
    """Runs in the worker process. Tasks are passed by name: Windows starts
    workers with 'spawn', so everything sent over must be importable."""
    from celery import current_app
    from . import tasks  # noqa: F401  (registers the drafting tasks)
    try:
        current_app.tasks[task_name].apply(args=args)
    finally:
        connections.close_all()


def _get_pool():
    global _pool
    with _pool_lock:
        if _pool is None:
            workers = int(getattr(settings, 'DRAFTING_JOB_WORKERS', 1) or 1)
            _pool = ProcessPoolExecutor(max_workers=workers, initializer=_init_worker)
        return _pool


def _reset_pool():
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.shutdown(wait=False, cancel_futures=False)
        _pool = None


def _log_failure(task_name, future):
    exc = future.exception()
    if exc is not None:
        log.error('Drafting job %s failed in the worker process: %r', task_name, exc)


def _submit(task_name, args):
    for attempt in (1, 2):
        try:
            future = _get_pool().submit(_run_in_worker, task_name, list(args))
            future.add_done_callback(lambda f: _log_failure(task_name, f))
            return
        except BrokenProcessPool:
            # The worker died (e.g. out of memory): start a fresh one once.
            log.warning('Drafting worker process died; restarting it (attempt %d).', attempt)
            _reset_pool()
    log.error('Could not start drafting job %s.', task_name)


def _run_in_thread(task, args):
    def run():
        try:
            task.apply(args=args)
        finally:
            connections.close_all()
    threading.Thread(target=run, daemon=True).start()


def dispatch(task, *args):
    """Start a drafting job without blocking the request (the client polls status)."""
    if not settings.CELERY_TASK_ALWAYS_EAGER:
        task.delay(*args)                       # the permanent path: Celery worker
    elif getattr(settings, 'DRAFTING_JOB_RUNNER', 'process') == 'thread':
        _run_in_thread(task, args)
    else:
        _submit(task.name, args)
