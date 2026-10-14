"""Show what the background jobs did recently (notifications.JobRun).

    manage.py job_status                 # last 20 runs of every job
    manage.py job_status --job process_notifications --failed --limit 50
"""
from django.core.management.base import BaseCommand

from notifications.models import JobRun


class Command(BaseCommand):
    help = 'Recent background job runs: status, counts and a short error.'

    def add_arguments(self, parser):
        parser.add_argument('--job', default='')
        parser.add_argument('--failed', action='store_true', help='Only failed runs.')
        parser.add_argument('--limit', type=int, default=20)

    def handle(self, *args, **o):
        qs = JobRun.objects.order_by('-started_at')
        if o['job']:
            qs = qs.filter(job=o['job'])
        if o['failed']:
            qs = qs.filter(status=JobRun.FAILED)
        rows = list(qs[:max(1, min(o['limit'], 500))])
        if not rows:
            self.stdout.write('No job runs recorded.')
            return
        for r in rows:
            took = (r.finished_at - r.started_at).total_seconds() if r.finished_at else None
            self.stdout.write('{:%Y-%m-%d %H:%M:%S}  {:<24} {:<9} {:>6}  firm={}  {}{}'.format(
                r.started_at, r.job, r.status, '{:.1f}s'.format(took) if took is not None else '-',
                r.firm_id or '-', r.counts or '', ('  ' + r.error) if r.error else ''))
