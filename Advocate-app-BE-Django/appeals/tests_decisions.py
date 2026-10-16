"""Decided cases on Appeal Alerts (appeals/decisions.py, docs/APPEALS.md): the court's wording read as who won,
our client's side, the alert that follows (never to the client), the page's API, and old decisions kept quiet."""
import datetime
import json

from django.test import TestCase

from core.models import NotificationQueue
from core.testing import ALL_PERMISSIONS, auth, make_advocate, make_case, make_client
from courtsearch.models import ImportedCaseRecord

from .decisions import outcome_of, record_decision, watching_case_ids
from .models import CaseDecision


def decided_record(nature, days_ago=3, petitioner='Akshayam Traders', respondent='The Deputy Commissioner'):
    on = datetime.date.today() - datetime.timedelta(days=days_ago)
    return {'cases': [{'view_token': 'vt', 'detail': {
        'case_status': {'Case Status': 'Case disposed', 'Decision Date': on.strftime('%d %B %Y'),
                        'Nature of Disposal': nature},
        'petitioners': [{'name': petitioner}], 'respondents': [{'name': respondent}]}}]}


class OutcomeTest(TestCase):
    def test_the_courts_wording(self):
        cases = {
            'Contested--DISMISSED': 'respondent', 'Contested--ALLOWED': 'petitioner',
            'Contested--Decreed with cost': 'petitioner', 'Contested--PARTLY ALLOWED': 'partly',
            'Contested--WITHDRAWN DISMISSED': 'no_contest', 'Uncontested--FULL SATISFACTION OF THE DECREE': 'no_contest',
            'Contested--DISPOSED OF': 'unclear', 'Leave Granted & Disposed off': 'unclear', 'Acquitted': 'respondent',
        }
        self.assertEqual({t: outcome_of(t) for t in cases}, cases)


class DecisionTest(TestCase):
    def setUp(self):
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        self.junior = make_advocate(permissions=ALL_PERMISSIONS, parent_advocate_id=self.senior.id)
        self.client_row = make_client(self.senior, 'Akshayam Traders', email='office@akshayam.test')
        self.case = make_case(self.senior, self.client_row)

    def _record(self, nature, **kw):
        return ImportedCaseRecord.objects.create(advocate_id=self.senior.id, case_id=self.case.id,
                                                 court_id='ecourts_hc', raw=decided_record(nature, **kw))

    def _alerts(self):
        rows = list(NotificationQueue.objects.filter(type__in=('APPEAL_POSSIBLE', 'APPEAL_WATCH')))
        return rows, [json.loads(r.payload_json) for r in rows]

    def test_our_client_lost_can_appeal_and_only_the_team_hears(self):
        d = record_decision(self._record('Contested--DISMISSED'))         # our client is the petitioner (by name)
        self.assertEqual((d.outcome, d.our_side, d.side_source, d.status), ('respondent', 'petitioner', 'parties', 'open'))
        rows, payloads = self._alerts()
        self.assertEqual({r.type for r in rows}, {'APPEAL_POSSIBLE'})
        self.assertEqual({r.advocate_id for r, p in zip(rows, payloads) if p['channel'] == 'IN_APP'},
                         {self.senior.id, self.junior.id})
        self.assertFalse([p for p in payloads if p.get('clientId')])     # never the client
        self.assertEqual(record_decision(self._record('Contested--DISMISSED')).id, d.id)   # once per case
        self.assertEqual(len(self._alerts()[0]), len(rows))

    def test_our_client_won_is_watched_and_withdrawn_says_nothing(self):
        d = record_decision(self._record('Contested--ALLOWED'))
        self.assertEqual(d.status, 'watching')
        self.assertEqual({r.type for r in self._alerts()[0]}, {'APPEAL_WATCH'})
        self.assertEqual(watching_case_ids(), [self.case.id])
        other = make_case(self.senior, self.client_row)
        rec = ImportedCaseRecord.objects.create(advocate_id=self.senior.id, case_id=other.id, court_id='ecourts_hc',
                                                raw=decided_record('Contested--WITHDRAWN DISMISSED'))
        before = len(self._alerts()[0])
        self.assertEqual(record_decision(rec).outcome, 'no_contest')
        self.assertEqual(len(self._alerts()[0]), before)

    def test_side_unknown_asks_and_the_answer_is_kept(self):
        from workspace.models import CaseProfile
        rec = self._record('Contested--DISMISSED', petitioner='Somebody Else', respondent='Another Party')
        d = record_decision(rec)
        self.assertEqual((d.our_side, d.status), ('', 'open'))
        url = f'/api/appeal-decisions/{d.id}'
        listed = self.client.get('/api/appeal-decisions', **auth(self.senior)).json()
        self.assertEqual([(x['caseId'], x['position']) for x in listed], [(self.case.id, 'look')])
        resp = self.client.patch(url, {'ourSide': 'respondent'}, content_type='application/json', **auth(self.senior))
        self.assertEqual((resp.json()['position'], resp.json()['status']), ('won', 'watching'))
        self.assertEqual(CaseProfile.objects.get(case_id=self.case.id).our_side, 'Respondent')
        resp = self.client.patch(url, {'status': 'watch_stopped'}, content_type='application/json', **auth(self.senior))
        self.assertEqual(resp.json()['status'], 'watch_stopped')
        stranger = make_advocate(permissions=ALL_PERMISSIONS)
        self.assertEqual(self.client.patch(url, {'status': 'open'}, content_type='application/json',
                                           **auth(stranger)).status_code, 404)
        self.assertEqual(self.client.get('/api/appeal-decisions', **auth(stranger)).json(), [])

    def test_old_decisions_are_quiet_or_left_out(self):
        self.assertIsNone(record_decision(self._record('Contested--DISMISSED', days_ago=400)))   # past any appeal
        d = record_decision(self._record('Contested--DISMISSED', days_ago=100))
        self.assertIsNotNone(d)
        self.assertEqual(self._alerts()[0], [])                          # listed, not announced
