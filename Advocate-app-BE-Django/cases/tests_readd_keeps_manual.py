"""P1-15: re-adding an archived case keeps the hearings and parties people entered.

CreateCaseView revives an archived case with the same number. It used to clear
every CaseEvent and CaseParty of that case "so a re-import starts clean" -
but hand-entered hearings and parties are the same rows (there is no source
column), so they were deleted too. Only the stored court record is cleared now,
and the re-import does not duplicate what is kept.
"""
import datetime
import json

from django.test import TestCase

from core.models import Case, CaseEvent
from core.testing import ALL_PERMISSIONS, auth, make_advocate, make_case, make_client
from courtsearch.models import ImportedCaseRecord
from workspace.models import CaseParty


class ReAddArchivedCaseTests(TestCase):
    def setUp(self):
        self.adv = make_advocate(permissions=ALL_PERMISSIONS)
        self.client_row = make_client(self.adv, 'Client A')
        self.case = make_case(self.adv, client=self.client_row, case_number='OS/77/2026')
        self.hearing = CaseEvent.objects.create(
            case=self.case, advocate_id=self.adv.id, title='Arguments (added by hand)',
            event_type='HEARING', date=datetime.date.today() + datetime.timedelta(days=10))
        self.party = CaseParty.objects.create(advocate_id=self.adv.id, case_id=self.case.id,
                                              name='Witness Lakshmi', role='Witness')
        Case.objects.filter(id=self.case.id).update(deleted=True)

    def _readd(self):
        return self.client.post(
            '/api/cases/create',
            data=json.dumps({'caseNumber': 'OS/77/2026', 'caseTitle': 'A vs B', 'courtLevel': 'District',
                             'status': 'Active', 'clientId': self.client_row.id}),
            content_type='application/json', **auth(self.adv))

    def test_manual_hearing_and_party_survive(self):
        self.assertEqual(self._readd().status_code, 200)
        self.assertTrue(CaseEvent.objects.filter(id=self.hearing.id).exists())
        self.assertTrue(CaseParty.objects.filter(id=self.party.id).exists())

    def test_stored_court_record_is_still_replaced(self):
        ImportedCaseRecord.objects.create(advocate_id=self.adv.id, case_id=self.case.id,
                                          court_id='1', query={}, raw={})
        self._readd()
        self.assertFalse(ImportedCaseRecord.objects.filter(case_id=self.case.id).exists())

    def test_reimported_party_is_not_duplicated(self):
        self._readd()
        r = self.client.post(f'/api/workspace/cases/{self.case.id}/parties',
                             data=json.dumps({'name': 'witness lakshmi', 'role': 'Witness'}),
                             content_type='application/json', **auth(self.adv))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(CaseParty.objects.filter(case_id=self.case.id).count(), 1)

    def test_reimported_hearing_is_not_duplicated(self):
        self._readd()
        r = self.client.post('/api/events/create', data=json.dumps({
            'caseId': self.case.id, 'title': self.hearing.title, 'eventType': 'HEARING',
            'date': self.hearing.date.isoformat()}), content_type='application/json', **auth(self.adv))
        self.assertEqual(r.status_code, 409)
        self.assertEqual(CaseEvent.objects.filter(case_id=self.case.id).count(), 1)
