"""Email clients whose document review is waiting past its reply-by date (then every 3 days).

    python manage.py remind_client_reviews        # the scheduler runs this with each reminder scan
"""

from django.core.management.base import BaseCommand

from clientreview.service import send_reminders


class Command(BaseCommand):
    help = 'Remind clients of documents waiting for their review past the reply-by date.'

    def handle(self, *args, **options):
        self.stdout.write(f'Sent {send_reminders()} client review reminder(s).')
