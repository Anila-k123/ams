"""Tests for case numbering across advocates.

cases.case_number carried a global UNIQUE in the Spring schema. With more than
one advocate that means only one of them, in the entire database, can track any
given case number: add CRL.A/1234/2026 when opposing counsel already has it and
you are refused, for a case you cannot see. Court numbering makes it worse - a
district number like 123/2024 exists in hundreds of district courts, so it was
never a globally unique value in the first place.

Uniqueness is now scoped to the advocate. These tests hold that line in both
directions: two chambers may share a number, one advocate may not duplicate it.
"""

from __future__ import annotations

import json

from django.test import TestCase

from core.models import Case
from core.testing import ALL_PERMISSIONS, auth, make_advocate, make_client

SHARED_NUMBER = 'CRL.A/1234/2026'


class CaseNumberScopeTest(TestCase):
    def setUp(self):
        self.firm_a = make_advocate('firm-a@test.local', ALL_PERMISSIONS)
        self.firm_b = make_advocate('firm-b@test.local', ALL_PERMISSIONS)
        self.client_a = make_client(self.firm_a, 'Client A')
        self.client_b = make_client(self.firm_b, 'Client B')

    def _create(self, advocate, client_row, number):
        return self.client.post(
            '/api/cases/create',
            data=json.dumps({'caseNumber': number, 'caseTitle': 'A vs B',
                             'courtLevel': 'High Court', 'status': 'Active',
                             'clientId': client_row.id}),
            content_type='application/json', **auth(advocate))

    def test_two_advocates_can_track_the_same_court_case(self):
        """Opposing counsel are both entitled to the same case number."""
        first = self._create(self.firm_a, self.client_a, SHARED_NUMBER)
        self.assertEqual(first.status_code, 201, first.content[:200])

        second = self._create(self.firm_b, self.client_b, SHARED_NUMBER)
        self.assertEqual(
            second.status_code, 201,
            'the second advocate was refused a case number they are entitled '
            'to: %s' % second.content[:200])

        self.assertEqual(Case.objects.filter(case_number=SHARED_NUMBER).count(), 2)

    def test_one_advocate_cannot_add_the_same_number_twice(self):
        self.assertEqual(
            self._create(self.firm_a, self.client_a, SHARED_NUMBER).status_code, 201)
        again = self._create(self.firm_a, self.client_a, SHARED_NUMBER)
        self.assertEqual(again.status_code, 409)
        self.assertEqual(Case.objects.filter(advocate_id=self.firm_a.id,
                                             case_number=SHARED_NUMBER).count(), 1)

    def test_a_practice_colleague_cannot_duplicate_it_either(self):
        """Stricter than the DB on purpose: one chambers, one copy of a case.

        The constraint is per advocate, so the database would allow two members
        of one practice to hold the same number - and then every shared view
        would list the case twice.
        """
        member = make_advocate('firm-a-junior@test.local', ALL_PERMISSIONS,
                               parent_advocate_id=self.firm_a.id)
        self.assertEqual(
            self._create(self.firm_a, self.client_a, SHARED_NUMBER).status_code, 201)
        colleague = self._create(member, self.client_a, SHARED_NUMBER)
        self.assertEqual(colleague.status_code, 409)

    def test_another_advocate_archived_case_is_not_reused(self):
        """A number another practice archived must not be taken over.

        Reuse resets the row and reassigns it; doing that to somebody else's
        archived case would hand them its history to whoever guessed the number.
        """
        self.assertEqual(
            self._create(self.firm_a, self.client_a, SHARED_NUMBER).status_code, 201)
        theirs = Case.objects.get(advocate_id=self.firm_a.id,
                                  case_number=SHARED_NUMBER)
        Case.objects.filter(id=theirs.id).update(deleted=True)

        res = self._create(self.firm_b, self.client_b, SHARED_NUMBER)
        self.assertEqual(res.status_code, 201, 'firm B gets its own row')
        theirs.refresh_from_db()
        self.assertTrue(theirs.deleted, 'firm A archived case is untouched')
        self.assertEqual(theirs.advocate_id, self.firm_a.id,
                         'ownership must not transfer')

    def test_reusing_our_own_archived_case_keeps_the_original_creator(self):
        self.assertEqual(
            self._create(self.firm_a, self.client_a, SHARED_NUMBER).status_code, 201)
        mine = Case.objects.get(advocate_id=self.firm_a.id,
                                case_number=SHARED_NUMBER)
        Case.objects.filter(id=mine.id).update(deleted=True)

        res = self._create(self.firm_a, self.client_a, SHARED_NUMBER)
        self.assertEqual(res.status_code, 200, res.content[:200])
        mine.refresh_from_db()
        self.assertFalse(mine.deleted, 'the archived row is revived, not duplicated')
        self.assertEqual(Case.objects.filter(advocate_id=self.firm_a.id,
                                             case_number=SHARED_NUMBER).count(), 1)


class CaseTimelineTest(TestCase):
    """The timeline is built from the case's records, filtered by permission."""

    def setUp(self):
        import datetime
        from core.models import CaseEvent, Invoice
        from core.testing import make_advocate, make_case
        self.senior = make_advocate(permissions=('CASE_VIEW', 'EVENT_VIEW', 'INVOICE_VIEW'))
        self.junior = make_advocate(permissions=('CASE_VIEW', 'EVENT_VIEW'),
                                    parent_advocate_id=self.senior.id)
        self.case = make_case(self.senior, created_at=datetime.date(2026, 9, 1))
        CaseEvent.objects.create(case_id=self.case.id, advocate_id=self.senior.id,
                                 title='Hearing', event_type='HEARING',
                                 date=datetime.date(2026, 10, 5))
        Invoice.objects.create(invoice_number='TL-INV-1', amount=1000.0,
                               invoice_date=datetime.date(2026, 9, 10),
                               due_date=datetime.date(2026, 9, 20), status='UNPAID',
                               advocate_id=self.senior.id, case_id=self.case.id,
                               client_id=self.case.client_id)

    def _types(self, user):
        from core.testing import auth
        r = self.client.get('/api/cases/{}/timeline'.format(self.case.id), **auth(user))
        self.assertEqual(r.status_code, 200)
        return [row['eventType'] for row in r.json()['content']]

    def test_built_newest_first(self):
        self.assertEqual(self._types(self.senior),
                         ['HEARING_CREATED', 'INVOICE_GENERATED', 'CASE_CREATED'])

    def test_money_hidden_without_invoice_view(self):
        self.assertNotIn('INVOICE_GENERATED', self._types(self.junior))


class ManualCaseEntryTest(TestCase):
    """Manual entry: matters with no court number, the extra details, and the
    guard against importing a case already linked by its CNR."""

    def setUp(self):
        self.adv = make_advocate('manual@test.local', ALL_PERMISSIONS)
        self.cl = make_client(self.adv, 'Manual Client')

    def _create(self, **body):
        body.setdefault('clientId', self.cl.id)
        body.setdefault('caseTitle', 'A vs B')
        return self.client.post('/api/cases/create', data=json.dumps(body),
                                content_type='application/json', **auth(self.adv))

    def test_unfiled_and_non_litigation_matters_get_a_number(self):
        a = self._create(matterType='pre_filing', caseNumber='')
        b = self._create(matterType='pre_filing', caseNumber='')
        c = self._create(matterType='non_litigation', caseNumber='')
        self.assertEqual(a.status_code, 201, a.content[:200])
        self.assertRegex(a.json()['caseNumber'], r'^PRE/\d{4}/0001$')
        self.assertRegex(b.json()['caseNumber'], r'^PRE/\d{4}/0002$')
        self.assertRegex(c.json()['caseNumber'], r'^MAT/\d{4}/0001$')
        # Litigation still needs its number.
        self.assertEqual(self._create(matterType='litigation', caseNumber='').status_code, 400)

    def test_details_are_saved_and_read_back(self):
        r = self._create(caseNumber='CC 45/2026', matterType='litigation', courtName='DRT-II, Chennai',
                         courtHall='Hall 3', ourSide='Applicant', filingDate='2026-02-10',
                         caseYear=2026, actsSections='SARFAESI Act s.17')
        self.assertEqual(r.status_code, 201, r.content[:200])
        got = self.client.get(f"/api/workspace/cases/{r.json()['id']}/profile", **auth(self.adv)).json()
        self.assertEqual((got['courtName'], got['ourSide'], got['filingDate'], got['caseYear']),
                         ('DRT-II, Chennai', 'Applicant', '2026-02-10', 2026))

    def test_bad_values_are_refused(self):
        self.assertEqual(self._create(caseNumber='X 1/2026', caseYear=1700).status_code, 400)
        self.assertEqual(self._create(caseNumber='X 2/2026', cnr='NOTACNR').status_code, 400)

    def test_a_linked_cnr_cannot_be_imported_again(self):
        r = self._create(caseNumber='O.S. 900/2025')
        cid = r.json()['id']
        put = self.client.put(f'/api/workspace/cases/{cid}/profile',
                              data=json.dumps({'cnr': 'tnch010015532025'}),
                              content_type='application/json', **auth(self.adv))
        self.assertEqual(put.json()['cnr'], 'TNCH010015532025')
        dup = self._create(caseNumber='TNCH010015532025')
        self.assertEqual(dup.status_code, 409)
        self.assertIn('O.S. 900/2025', dup.json()['error'])
