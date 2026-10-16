"""A hearing's result and next date schedule the next hearing as a real event
(events/scheduling.py), once, without touching earlier records."""
from __future__ import annotations

import datetime
import json
import threading
from unittest import mock

from django.db import connections
from django.test import TestCase, TransactionTestCase

from core.models import CaseEvent
from core.testing import ALL_PERMISSIONS, auth, make_advocate, make_case
from workspace.models import HearingDetail


def _post(client, user, url, body, method='post'):
    return getattr(client, method)(url, data=json.dumps(body), content_type='application/json', **auth(user))


class _Hearings:
    def setUp(self):
        self.adv = make_advocate('senior@test.local', ALL_PERMISSIONS)
        self.case = make_case(self.adv, status='Active')

    def hearing(self, **extra):
        body = {'caseId': self.case.id, 'title': 'Arguments', 'eventType': 'HEARING', 'date': '2026-11-02',
                'court': 'City Civil Court', 'benchHall': '12', 'judge': 'Hon. R. Iyer', **extra}
        return _post(self.client, self.adv, '/api/events/create', body)

    def update(self, event_id, **extra):
        body = {'title': 'Arguments', 'eventType': 'HEARING', 'date': '2026-11-02', 'court': 'City Civil Court',
                'benchHall': '12', 'judge': 'Hon. R. Iyer', **extra}
        return _post(self.client, self.adv, f'/api/events/update/{event_id}', body, method='put')

    def hearings(self):
        return list(CaseEvent.objects.filter(case=self.case, event_type='HEARING').order_by('date', 'id'))


class NextHearingTests(_Hearings, TestCase):
    def test_adjourned_with_a_next_date_schedules_the_next_hearing(self):
        first = self.hearing().json()
        # The mock must outlive the after-commit callbacks, so it is the outer context.
        with mock.patch('notifications.client_events.hearing_scheduled') as told, \
                self.captureOnCommitCallbacks(execute=True):
            r = self.update(first['id'], result='ADJOURNED', nextDate='2026-11-20', outcome='Adjourned at request of R2')
        self.assertEqual(r.status_code, 200, r.content)
        nxt = r.json()['nextHearing']
        self.assertTrue(nxt['created'])
        self.assertEqual((nxt['date'], nxt['eventType']), ('2026-11-20', 'HEARING'))
        self.assertEqual(len(self.hearings()), 2)
        told.assert_called_once()                                       # the client hears of the new date
        old = HearingDetail.objects.get(event_id=first['id'])
        new = HearingDetail.objects.get(event_id=nxt['id'])
        self.assertEqual((old.result, old.next_event_id, str(old.next_date)), ('ADJOURNED', nxt['id'], '2026-11-20'))
        self.assertEqual(old.outcome, 'Adjourned at request of R2')     # this hearing's record is kept
        self.assertEqual((new.previous_event_id, new.court, new.bench_hall, new.judge),
                         (first['id'], 'City Civil Court', '12', 'Hon. R. Iyer'))
        # The calendar and the case timeline see it.
        mine = self.client.get('/api/events/my-events', **auth(self.adv)).json()
        self.assertIn(nxt['id'], [e['id'] for e in mine])
        timeline = json.dumps(self.client.get(f'/api/cases/{self.case.id}/timeline', **auth(self.adv)).json())
        self.assertIn('Next date: 20 Nov 2026', timeline)
        self.assertIn('Result: Adjourned', timeline)

    def test_a_retried_save_never_adds_a_second_hearing_and_a_new_date_moves_it(self):
        first = self.hearing().json()
        a = self.update(first['id'], result='PART_HEARD', nextDate='2026-11-20').json()['nextHearing']
        b = self.update(first['id'], result='PART_HEARD', nextDate='2026-11-20').json()['nextHearing']
        self.assertEqual(a['id'], b['id'])
        self.assertFalse(b['created'])
        CaseEvent.objects.filter(id=a['id']).update(notified=True)
        c = self.update(first['id'], result='PART_HEARD', nextDate='2026-12-04').json()['nextHearing']
        self.assertEqual(c['id'], a['id'])                              # moved, not added
        moved = CaseEvent.objects.get(id=a['id'])
        self.assertEqual((str(moved.date), moved.notified), ('2026-12-04', False))   # reminder due again
        self.assertEqual(len(self.hearings()), 2)

    def test_a_hearing_already_on_that_date_is_linked_not_duplicated(self):
        first = self.hearing().json()
        manual = self.hearing(title='Arguments contd.', date='2026-11-20').json()
        r = self.update(first['id'], result='ADJOURNED', nextDate='2026-11-20').json()
        self.assertEqual(r['nextHearing']['id'], manual['id'])
        self.assertFalse(r['nextHearing']['created'])
        self.assertEqual(HearingDetail.objects.get(event_id=manual['id']).previous_event_id, first['id'])
        self.assertEqual(len(self.hearings()), 2)

    def test_recording_a_past_hearing_with_its_next_date_in_one_step(self):
        r = self.hearing(date='2026-10-01', result='ADJOURNED', nextDate='2026-10-30')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['nextHearing']['date'], '2026-10-30')
        self.assertEqual(len(self.hearings()), 2)

    def test_clearing_the_next_date_keeps_the_scheduled_hearing(self):
        first = self.hearing().json()
        nxt = self.update(first['id'], result='ADJOURNED', nextDate='2026-11-20').json()['nextHearing']
        r = self.update(first['id'], result='ADJOURNED', nextDate=None)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(CaseEvent.objects.filter(id=nxt['id']).exists())
        self.assertEqual(HearingDetail.objects.get(event_id=first['id']).next_event_id, nxt['id'])

    def test_deleting_the_next_hearing_lets_a_later_save_schedule_again(self):
        first = self.hearing().json()
        nxt = self.update(first['id'], result='ADJOURNED', nextDate='2026-11-20').json()['nextHearing']
        self.assertEqual(self.client.delete(f'/api/events/delete/{nxt["id"]}', **auth(self.adv)).status_code, 204)
        self.assertIsNone(HearingDetail.objects.get(event_id=first['id']).next_event_id)
        again = self.update(first['id'], result='ADJOURNED', nextDate='2026-11-20').json()['nextHearing']
        self.assertTrue(again['created'])
        self.assertNotEqual(again['id'], nxt['id'])

    def test_refusals_save_nothing(self):
        first = self.hearing().json()
        cases = [
            ({'nextDate': '2026-11-02'}, 400, 'NEXT_DATE_NOT_AFTER'),
            ({'nextDate': '2026-10-01'}, 400, 'NEXT_DATE_NOT_AFTER'),
            ({'nextDate': '2034-01-01'}, 400, 'NEXT_DATE_TOO_FAR'),
            ({'nextDate': 'tomorrow'}, 400, 'BAD_DATE'),
            ({'result': 'DISPOSED', 'nextDate': '2026-11-20'}, 400, 'DISPOSED_WITH_NEXT_DATE'),
            ({'result': 'WON'}, 400, 'BAD_RESULT'),
        ]
        for extra, code, err in cases:
            r = self.update(first['id'], **extra)
            self.assertEqual((r.status_code, r.json()['code']), (code, err), extra)
        self.assertEqual(len(self.hearings()), 1)
        r = self.hearing(date='2026-10-01', nextDate='2026-09-01')             # refused before the event is made
        self.assertEqual(r.json()['code'], 'NEXT_DATE_NOT_AFTER')
        self.assertEqual(len(self.hearings()), 1)

    def test_only_hearings_have_a_next_date(self):
        r = _post(self.client, self.adv, '/api/events/create', {
            'caseId': self.case.id, 'title': 'Client meeting', 'eventType': 'MEETING', 'date': '2026-11-02',
            'nextDate': '2026-11-20'})
        self.assertEqual(r.json()['code'], 'NEXT_DATE_NOT_HEARING')

    def test_disposed_result_records_without_scheduling(self):
        first = self.hearing().json()
        r = self.update(first['id'], result='DISPOSED', outcome='Suit decreed with costs')
        self.assertEqual(r.status_code, 200)
        self.assertNotIn('nextHearing', r.json())
        self.assertEqual(HearingDetail.objects.get(event_id=first['id']).result, 'DISPOSED')
        self.assertEqual(len(self.hearings()), 1)

    def test_a_closed_case_needs_reopening_first(self):
        first = self.hearing().json()
        self.case.status = 'Closed'
        self.case.save()
        r = self.update(first['id'], result='ADJOURNED', nextDate='2026-11-20')
        self.assertEqual((r.status_code, r.json()['code']), (409, 'CASE_CLOSED'))
        self.assertEqual(len(self.hearings()), 1)
        self.case.status = 'Active'                                             # reopened
        self.case.save()
        self.assertEqual(self.update(first['id'], result='ADJOURNED', nextDate='2026-11-20').status_code, 200)
        self.assertEqual(len(self.hearings()), 2)

    def test_manual_hearings_still_work_as_before(self):
        r = self.hearing(purpose='Evidence')
        self.assertEqual(r.status_code, 201)
        self.assertNotIn('nextHearing', r.json())
        ev = r.json()['id']
        self.assertEqual(self.update(ev, date='2026-11-05', outcome='').status_code, 200)
        self.assertEqual(str(CaseEvent.objects.get(id=ev).date), '2026-11-05')

    def test_another_practices_hearing_is_out_of_reach(self):
        first = self.hearing().json()
        other = make_advocate('other@test.local', ALL_PERMISSIONS)
        r = _post(self.client, other, f'/api/events/update/{first["id"]}',
                  {'title': 'x', 'eventType': 'HEARING', 'date': '2026-11-02', 'nextDate': '2026-11-20'}, 'put')
        self.assertEqual(r.status_code, 404)
        self.assertEqual(len(self.hearings()), 1)


class NextHearingConcurrencyTests(_Hearings, TransactionTestCase):
    def test_simultaneous_saves_schedule_one_hearing(self):
        first = self.hearing().json()

        def save(_):
            try:
                return self.update(first['id'], result='ADJOURNED', nextDate='2026-11-20').status_code
            finally:
                connections.close_all()
        barrier, out = threading.Barrier(5), []

        def run(i):
            barrier.wait()
            out.append(save(i))
        threads = [threading.Thread(target=run, args=(i,)) for i in range(5)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(out, [200] * 5)
        self.assertEqual(len(self.hearings()), 2)
        self.assertEqual(HearingDetail.objects.filter(previous_event_id=first['id']).count(), 1)
