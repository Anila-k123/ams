"""HEARING_RESCHEDULED: when a hearing's date really changes, the case's team
and the client are told (old and new date), once - never on an unchanged save,
a retry or a parallel save. Delivery stays local (Django's test mail outbox;
WhatsApp is off), so nothing leaves the machine."""
from __future__ import annotations

import json
import threading

from django.core import mail
from django.db import connections
from django.test import TestCase, TransactionTestCase

from core.models import CaseEvent, NotificationQueue
from core.testing import ALL_PERMISSIONS, auth, make_advocate, make_case, make_client


def _put(client, user, event_id, **extra):
    body = {'title': 'Arguments', 'eventType': 'HEARING', 'date': '2026-11-02', **extra}
    return client.put(f'/api/events/update/{event_id}', data=json.dumps(body),
                      content_type='application/json', **auth(user))


class _Setup:
    def setUp(self):
        self.senior = make_advocate('senior@moved.test', ALL_PERMISSIONS)
        self.junior = make_advocate('junior@moved.test', ALL_PERMISSIONS, parent_advocate_id=self.senior.id)
        self.outsider = make_advocate('other@moved.test', ALL_PERMISSIONS)       # another practice
        self.client_rec = make_client(self.senior, name='Kannan', email='kannan@client.test')
        self.case = make_case(self.senior, client=self.client_rec, status='Active')
        self.hearing = CaseEvent.objects.create(title='Arguments', event_type='HEARING', date='2026-11-02',
                                                case=self.case, advocate=self.senior)

    def moved(self, who=None):
        """Team notices (the client's email is queued under the acting advocate's
        id too, so it is told apart by its recipient address)."""
        qs = NotificationQueue.objects.filter(type='HEARING_RESCHEDULED').exclude(
            payload_json__contains='"recipientEmail": "kannan@client.test"')
        return qs.filter(advocate_id=who.id) if who else qs

    def client_mails(self):
        return [m for m in mail.outbox if 'kannan@client.test' in m.to]


class RescheduleNoticeTests(_Setup, TestCase):
    def test_a_real_date_change_tells_the_team_and_the_client_with_both_dates(self):
        with self.captureOnCommitCallbacks(execute=True):
            r = _put(self.client, self.senior, self.hearing.id, date='2026-11-20')
        self.assertEqual(r.status_code, 200, r.content)
        team = self.moved(self.junior)
        self.assertTrue(team.exists())
        body = json.loads(team.first().payload_json)['body']
        self.assertIn('Was     : 2026-11-02', body)
        self.assertIn('Now     : 2026-11-20', body)
        self.assertFalse(self.moved(self.outsider).exists())        # another practice hears nothing
        mails = self.client_mails()
        self.assertEqual(len(mails), 1)
        self.assertIn('2026-11-02', mails[0].body)
        self.assertIn('2026-11-20', mails[0].body)
        self.assertEqual(mails[0].subject.split(' - ')[0], 'Hearing date changed')

    def test_the_person_who_moved_it_is_not_pinged(self):
        with self.captureOnCommitCallbacks(execute=True):
            _put(self.client, self.junior, self.hearing.id, date='2026-11-20')
        self.assertFalse(self.moved(self.junior).exists())
        self.assertTrue(self.moved(self.senior).exists())

    def test_an_unchanged_save_and_a_retry_send_nothing_more(self):
        with self.captureOnCommitCallbacks(execute=True):
            _put(self.client, self.senior, self.hearing.id, date='2026-11-02', outcome='Arguments heard in part')
        self.assertFalse(self.moved().exists())
        with self.captureOnCommitCallbacks(execute=True):
            _put(self.client, self.senior, self.hearing.id, date='2026-11-20')
        first = self.moved().count()
        with self.captureOnCommitCallbacks(execute=True):
            _put(self.client, self.senior, self.hearing.id, date='2026-11-20')      # a retried save
        self.assertEqual(self.moved().count(), first)
        self.assertEqual(len(self.client_mails()), 1)

    def test_moving_the_scheduled_next_hearing_is_announced_once(self):
        with self.captureOnCommitCallbacks(execute=True):
            first = _put(self.client, self.senior, self.hearing.id, result='ADJOURNED', nextDate='2026-11-20').json()
        nxt = first['nextHearing']['id']
        self.assertFalse(self.moved().exists())                      # a new hearing is "scheduled", not "moved"
        with self.captureOnCommitCallbacks(execute=True):
            _put(self.client, self.senior, self.hearing.id, result='ADJOURNED', nextDate='2026-12-04')
        rows = self.moved(self.junior)
        self.assertEqual(rows.count(), 1 * len({json.loads(r.payload_json)['channel'] for r in rows}))
        self.assertEqual(json.loads(rows.first().payload_json)['entityId'], nxt)
        self.assertIn('Was     : 2026-11-20', json.loads(rows.first().payload_json)['body'])

    def test_other_events_moving_are_not_hearing_notices(self):
        meeting = CaseEvent.objects.create(title='Client meeting', event_type='MEETING', date='2026-11-02',
                                           case=self.case, advocate=self.senior)
        with self.captureOnCommitCallbacks(execute=True):
            _put(self.client, self.senior, meeting.id, eventType='MEETING', title='Client meeting', date='2026-11-09')
        self.assertFalse(self.moved().exists())

    def test_a_refused_save_announces_nothing(self):
        self.case.status = 'Closed'
        self.case.save()
        with self.captureOnCommitCallbacks(execute=True):
            r = _put(self.client, self.senior, self.hearing.id, date='2026-11-20', nextDate='2026-12-01')
        self.assertEqual(r.status_code, 409)
        self.assertFalse(self.moved().exists())
        self.assertEqual(self.client_mails(), [])


class RescheduleConcurrencyTests(_Setup, TransactionTestCase):
    def test_parallel_saves_of_the_same_new_date_announce_once(self):
        barrier, codes = threading.Barrier(5), []

        def run():
            try:
                barrier.wait()
                codes.append(_put(self.client, self.senior, self.hearing.id, date='2026-11-20').status_code)
            finally:
                connections.close_all()
        threads = [threading.Thread(target=run) for _ in range(5)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(codes, [200] * 5)
        channels = {json.loads(r.payload_json)['channel'] for r in self.moved(self.junior)}
        self.assertEqual(self.moved(self.junior).count(), len(channels))      # one per channel, not per save
        self.assertEqual(len(self.client_mails()), 1)
