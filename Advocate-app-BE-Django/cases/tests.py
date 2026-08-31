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
