"""Closing a case with a reason (cases/closure.py, docs/CASE_CLOSURE.md): the reason is kept, reopening clears
it, and a case we no longer act in gets nothing more from the court watch (orders, alerts, client emails,
appeal alerts), while "decided by the court" keeps the appeal side going. Closed cases get no hearing reminders."""
import datetime
from unittest import mock

from django.test import TestCase

from core.models import CaseEvent, NotificationQueue
from core.testing import ALL_PERMISSIONS, auth, make_advocate, make_case, make_client
from courtsearch.models import CaseOrderSync, ImportedCaseRecord
from workspace.models import CaseProfile

from .closure import DECIDED, OPEN, STOPPED, mode, stopped_case_ids


def hc_raw(*filenames, disposed=None):
    detail = {'orders': [{'order_number': str(i + 1), 'order_date': '01-10-2026',
                          'pdf_url': f'https://hcservices.ecourts.gov.in/x.php?filename={f}'} for i, f in enumerate(filenames)],
              'petitioners': [{'name': 'Akshayam Traders'}], 'respondents': [{'name': 'The Deputy Commissioner'}]}
    if disposed:
        on = datetime.date.today() - datetime.timedelta(days=2)
        detail['case_status'] = {'Case Status': 'Case disposed', 'Decision Date': on.strftime('%d %B %Y'),
                                 'Nature of Disposal': disposed}
    return {'cases': [{'view_token': 'vt', 'detail': detail}]}


class ClosureTest(TestCase):
    def setUp(self):
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        self.junior = make_advocate(permissions=ALL_PERMISSIONS, parent_advocate_id=self.senior.id)
        self.client_row = make_client(self.senior, 'Akshayam Traders', email='office@akshayam.test')
        self.case = make_case(self.senior, self.client_row, status='Active')
        self.url = f'/api/cases/update/{self.case.id}'

    def _put(self, user=None, **data):
        return self.client.put(self.url, data, content_type='application/json', **auth(user or self.senior))

    def test_close_with_a_reason_and_reopen_by_anyone_in_the_team(self):
        resp = self._put(self.junior, status='Closed', closedReason='no_longer_acting', closedNote='NOC given')
        self.assertEqual(resp.status_code, 200, resp.content)
        p = CaseProfile.objects.get(case_id=self.case.id)
        self.assertEqual((p.closed_reason, p.closed_note, p.closed_by_id), ('no_longer_acting', 'NOC given', self.junior.id))
        self.case.refresh_from_db()
        self.assertEqual(mode(self.case), STOPPED)
        self.assertIn(self.case.id, stopped_case_ids())
        profile = self.client.get(f'/api/workspace/cases/{self.case.id}/profile', **auth(self.senior)).json()
        self.assertEqual((profile['closedReason'], profile['closedNote']), ('no_longer_acting', 'NOC given'))
        self.assertEqual(self._put(status='Active').status_code, 200)                  # reopen
        p.refresh_from_db()
        self.assertEqual((p.closed_reason, p.closed_on), ('', None))
        self.case.refresh_from_db()
        self.assertEqual(mode(self.case), OPEN)
        self.assertEqual(self._put(status='Closed', closedReason='because').status_code, 400)

    def test_decided_by_the_court_and_legacy_closed_still_watch_for_appeals(self):
        self._put(status='Closed', closedReason='court_decided')
        self.case.refresh_from_db()
        self.assertEqual(mode(self.case), DECIDED)
        legacy = make_case(self.senior, self.client_row, status='Closed')            # closed before reasons
        self.assertEqual(mode(legacy), DECIDED)
        self.assertEqual(stopped_case_ids(), set())

    @mock.patch('courtsearch.order_sync.fetch_pdf', return_value=b'%PDF-1.4 order')
    def test_no_longer_acting_stops_the_court_watch_and_tells_nobody(self, _pdf):
        from appeals.decisions import record_decision
        from courtsearch.order_sync import due_groups, take_new_orders
        rec = ImportedCaseRecord.objects.create(advocate_id=self.senior.id, case_id=self.case.id,
                                                court_id='ecourts_hc', raw=hc_raw('A'))
        self.assertEqual([r.case_id for g in due_groups() for r in g['records']], [self.case.id])
        take_new_orders(rec)                                                          # baseline
        self._put(status='Closed', closedReason='no_longer_acting')
        self.assertEqual(due_groups(), [])                                            # not fetched any more
        rec.raw = hc_raw('A', 'B', disposed='Contested--DISMISSED')                   # a Refresh by hand still brings it
        rec.save()
        found = take_new_orders(rec)
        self.assertEqual(len(found), 1)                                               # the order is kept ...
        self.assertFalse(NotificationQueue.objects.filter(type='COURT_ORDER_NEW').exists())   # ... nobody is told
        self.assertIsNone(record_decision(rec))                                       # not an appeal question for us

    def test_closed_cases_get_no_hearing_reminders(self):
        from notifications.events import upcoming_hearings
        CaseEvent.objects.create(case_id=self.case.id, advocate_id=self.senior.id, title='Hearing', event_type='HEARING',
                                 date=datetime.date.today() + datetime.timedelta(days=1), notified=False)
        self.assertTrue(upcoming_hearings(self.senior))
        NotificationQueue.objects.all().delete()
        self._put(status='Closed', closedReason='settled')
        self.assertEqual(upcoming_hearings(self.senior), [])

    def test_closing_for_good_stops_an_appeal_watch(self):
        from appeals.models import CaseDecision
        CaseDecision.objects.create(case_id=self.case.id, advocate_id=self.senior.id, court_id='ecourts_hc',
                                    outcome='petitioner', our_side='petitioner', status='watching')
        self._put(status='Closed', closedReason='no_longer_acting')
        self.assertEqual(CaseDecision.objects.get(case_id=self.case.id).status, 'watch_stopped')
        self.assertEqual(self.client.get('/api/appeal-decisions', **auth(self.senior)).json(), [])
        self.assertFalse(CaseOrderSync.objects.filter(case_id=self.case.id).exists())
