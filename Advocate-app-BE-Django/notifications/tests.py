"""Phase 7: tenant-aware reminders and a safe queue drain.

Every reminder is raised in the firm the work belongs to, reaches only people
who may see that firm's work now, is raised once per period even when scans
overlap or retry, and the drain never sends a row twice.
"""
import datetime
import json
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from core.models import Advocate, CaseEvent, Notification, NotificationQueue
from core.testing import make_case, make_firm, make_firm_member
from firms.models import Firm, FirmMembership
from notifications import events, service
from notifications.models import JobRun, NotificationKey


def _hearing(owner, case, days=1):
    return CaseEvent.objects.create(title='Hearing', event_type='HEARING', case_id=case.id, advocate_id=owner.id,
                                    date=datetime.date.today() + datetime.timedelta(days=days))


def _queued(advocate, event='HEARING_REMINDER'):
    # One row per channel; the in-app row stands for the reminder.
    return NotificationQueue.objects.filter(advocate_id=advocate.id, type=event,
                                            payload_json__contains='"channel": "IN_APP"')


def _drain(**kw):
    call_command('process_notifications', stdout=mock.MagicMock(), stderr=mock.MagicMock(), **kw)


@override_settings(TENANCY_MODE='firm')
class ReminderTests(TestCase):
    def setUp(self):
        self.a, self.b, self.c = make_firm('A'), make_firm('B'), make_firm('C')
        self.senior = make_firm_member(self.a)
        self.junior = make_firm_member(self.a, parent=self.senior)
        self.other = make_firm_member(self.b)
        self.third = make_firm_member(self.c)
        self.case = make_case(self.senior)
        self.event = _hearing(self.senior, self.case)

    def test_a_scan_raises_each_reminder_once_even_when_repeated(self):
        events.scan_due_notifications()
        events.scan_due_notifications()
        self.assertEqual(_queued(self.senior).count(), 1)
        self.assertEqual(_queued(self.junior).count(), 1)
        # Other firms hear nothing about firm A's hearing.
        self.assertFalse(_queued(self.other).exists() or _queued(self.third).exists())

    def test_overlapping_scans_cannot_both_queue_it(self):
        # Simulate a second scan that passed the history check at the same time:
        # the unique key still lets only one through.
        with mock.patch('notifications.events._already_notified', return_value=False):
            events.upcoming_hearings(self.senior)
            events.upcoming_hearings(self.senior)
        self.assertEqual(_queued(self.junior).count(), 1)
        self.assertTrue(NotificationKey.objects.filter(firm_id=self.a.id).exists())

    def test_a_suspended_firm_raises_nothing_and_queued_rows_are_cancelled(self):
        events.scan_due_notifications()
        Firm.objects.filter(id=self.a.id).update(status=Firm.SUSPENDED)
        NotificationKey.objects.all().delete()
        NotificationQueue.objects.update(created_at=timezone.now() - datetime.timedelta(days=3))
        events.scan_due_notifications()
        self.assertEqual(_queued(self.junior).count(), 1)          # nothing new
        _drain()
        self.assertFalse(Notification.objects.filter(advocate_id=self.junior.id).exists())
        self.assertEqual(set(_queued(self.junior).values_list('status', flat=True)), {'CANCELLED'})

    def test_a_suspended_member_is_not_told(self):
        FirmMembership.objects.filter(advocate_id=self.junior.id).update(status=FirmMembership.SUSPENDED)
        events.scan_due_notifications()
        self.assertFalse(_queued(self.junior).exists())
        self.assertTrue(_queued(self.senior).exists())

    def test_work_stays_with_the_firm_when_its_creator_leaves(self):
        Advocate.objects.filter(id=self.senior.id).update(left_on=datetime.date.today())
        FirmMembership.objects.filter(advocate_id=self.senior.id).update(status=FirmMembership.LEFT)
        events.scan_due_notifications()
        self.assertFalse(_queued(self.senior).exists())            # the leaver hears nothing
        self.assertEqual(_queued(self.junior).count(), 1)          # the team still does
        self.assertTrue(CaseEvent.objects.filter(id=self.event.id).exists())

    def test_someone_who_moved_to_another_firm_is_not_told(self):
        FirmMembership.objects.filter(advocate_id=self.junior.id).update(status=FirmMembership.LEFT)
        FirmMembership.objects.create(firm=self.b, advocate_id=self.junior.id, kind=FirmMembership.STAFF,
                                      status=FirmMembership.ACTIVE, joined_at=datetime.datetime.now())
        events.scan_due_notifications()
        self.assertFalse(_queued(self.junior).exists())

    def test_scan_runs_are_recorded(self):
        events.scan_due_notifications()
        run = JobRun.objects.get(job='scan_notifications')
        self.assertEqual(run.status, JobRun.SUCCEEDED)
        self.assertGreaterEqual(run.counts['queued'], 2)

    def test_a_failing_producer_is_recorded_and_the_others_still_run(self):
        with mock.patch.object(events, 'PRODUCERS', (mock.Mock(side_effect=RuntimeError('boom'), __name__='bad'),
                                                     events.upcoming_hearings)):
            events.scan_due_notifications()
        run = JobRun.objects.get(job='scan_notifications')
        self.assertEqual(run.status, JobRun.FAILED)
        self.assertTrue(run.counts['producerFailures'] >= 1)
        self.assertTrue(_queued(self.junior).exists())


@override_settings(TENANCY_MODE='firm')
class DrainTests(TestCase):
    def setUp(self):
        self.firm = make_firm('A')
        self.member = make_firm_member(self.firm)

    def _row(self, **kw):
        ids = service.notify(self.member.id, 'HEARING_REMINDER', 'Hearing tomorrow', 'body', channels=kw.pop(
            'channels', (service.IN_APP,)), **kw)
        return NotificationQueue.objects.get(id=ids[0])

    def test_two_drains_send_a_row_once(self):
        row = self._row()
        real_claim = __import__('notifications.management.commands.process_notifications',
                                fromlist=['Command']).Command._claim

        def claim_after_rival(cmd, row_id, now):
            # A rival drain claims and sends it first.
            NotificationQueue.objects.filter(id=row_id).update(status='SENT')
            return real_claim(cmd, row_id, now)
        with mock.patch('notifications.management.commands.process_notifications.Command._claim',
                        claim_after_rival):
            _drain()
        self.assertFalse(Notification.objects.filter(advocate_id=self.member.id).exists())
        _drain()
        self.assertFalse(Notification.objects.filter(advocate_id=self.member.id).exists())
        row.refresh_from_db()
        self.assertEqual(row.status, 'SENT')

    def test_a_row_left_processing_by_a_dead_drain_is_retried(self):
        row = self._row()
        NotificationQueue.objects.filter(id=row.id).update(
            status='PROCESSING', processing_started_at=timezone.now() - datetime.timedelta(hours=1))
        _drain()
        row.refresh_from_db()
        self.assertEqual(row.status, 'SENT')
        self.assertEqual(Notification.objects.filter(advocate_id=self.member.id).count(), 1)

    def test_a_failed_send_is_retried_later_and_recorded(self):
        row = self._row(channels=(service.EMAIL,))
        with mock.patch('notifications.management.commands.process_notifications.send_mail',
                        side_effect=ConnectionRefusedError('smtp down')), \
                mock.patch('notifications.management.commands.process_notifications.Command._email_branding',
                           return_value=None):
            _drain()
        row.refresh_from_db()
        self.assertEqual((row.status, row.retry_count), ('PENDING', 1))
        self.assertIsNotNone(row.next_retry_at)
        run = JobRun.objects.filter(job='process_notifications').latest('started_at')
        self.assertEqual(run.counts['failed'], 1)
        # Recovery: once the backoff has passed and SMTP is back, it goes out.
        NotificationQueue.objects.filter(id=row.id).update(next_retry_at=timezone.now())
        with mock.patch('notifications.management.commands.process_notifications.Command._email_branding',
                        return_value=None):
            _drain()
        row.refresh_from_db()
        self.assertEqual(row.status, 'SENT')

    def test_left_member_is_cancelled_at_send_time(self):
        row = self._row()
        Advocate.objects.filter(id=self.member.id).update(left_on=datetime.date.today())
        _drain()
        row.refresh_from_db()
        self.assertEqual(row.status, 'CANCELLED')
        self.assertIn('no longer', row.last_error)
        self.assertNotIn('body', json.dumps(list(JobRun.objects.values('error'))))
