"""Raise the reminders that are due, for every advocate.

    manage.py scan_notifications

Run once each morning: it queues hearing reminders (for hearings in the next
two days), overdue-invoice reminders and overdue-task reminders. Sending is a
separate step - process_notifications drains the queue.

Safe to run more often than needed. Each producer checks the queue and the
delivery history first, so the same reminder is not raised twice; without that
a frequent schedule would bury an advocate in duplicates.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from notifications.events import scan_due_notifications


class Command(BaseCommand):
    help = 'Queue reminders that are due (hearings, overdue invoices, tasks).'

    def add_arguments(self, parser):
        parser.add_argument('--advocate', type=int, default=None,
                            help='Only scan this advocate id (default: all).')

    def handle(self, *args, **o):
        queued = scan_due_notifications(o['advocate'])
        self.stdout.write(self.style.SUCCESS(
            '{} reminder(s) queued.'.format(len(queued))))
