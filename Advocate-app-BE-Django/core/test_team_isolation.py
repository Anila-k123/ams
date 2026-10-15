"""A case and everything on it belong to the senior's team only.

Two seniors in ONE firm (two teams) and a senior in ANOTHER firm. The other
senior must not see or change the first team's case or anything on it: its
detail, tasks, notes, parties, documents, events, money, client - and must not
be able to attach their own records (tasks, events, expenses, invoices) to it.
"""

from __future__ import annotations

import datetime

from django.test import TestCase

from core.models import CaseEvent, Document, Expense
from core.testing import ALL_PERMISSIONS, auth, make_advocate, make_case, make_client
from firms.models import FirmTeam
from workspace.models import CaseTask


class TeamIsolationTest(TestCase):
    def setUp(self):
        # Firm: Rajesh's team and Arjun's team. Another firm: Lavanya.
        self.rajesh = make_advocate('rajesh@iso.test', ALL_PERMISSIONS)
        self.priya = make_advocate('priya@iso.test', ALL_PERMISSIONS, parent_advocate_id=self.rajesh.id)
        self.arjun = make_advocate('arjun@iso.test', ALL_PERMISSIONS)
        FirmTeam.objects.create(team_root_id=self.rajesh.id, firm_root_id=self.rajesh.id)
        FirmTeam.objects.create(team_root_id=self.arjun.id, firm_root_id=self.rajesh.id)
        self.lavanya = make_advocate('lavanya@iso.test', ALL_PERMISSIONS)

        self.client_row = make_client(self.rajesh, name='Kannan')
        self.case = make_case(self.rajesh, client=self.client_row)
        self.task = CaseTask.objects.create(advocate_id=self.rajesh.id, case_id=self.case.id, title='Brief',
                                            assigned_to_id=self.priya.id, assigned_by_id=self.rajesh.id)
        self.event = CaseEvent.objects.create(advocate_id=self.rajesh.id, case_id=self.case.id, title='Hearing',
                                              event_type='HEARING', date=datetime.date.today())
        self.expense = Expense.objects.create(advocate_id=self.rajesh.id, case_id=self.case.id,
                                              client_id=self.client_row.id, title='Court fee', amount=100)

    def _get(self, user, path):
        return self.client.get(path, **auth(user))

    def _rows(self, res):
        b = res.json()
        rows = b.get('content', b) if isinstance(b, dict) else b
        return rows if isinstance(rows, list) else None

    def test_own_team_sees_the_case(self):
        for user in (self.rajesh, self.priya):
            self.assertEqual(self._get(user, f'/api/workspace/cases/{self.case.id}/summary').status_code, 200)
            self.assertEqual(len(self._rows(self._get(user, f'/api/workspace/cases/{self.case.id}/tasks'))), 1)

    def test_other_team_and_other_firm_see_nothing(self):
        cid, clid = self.case.id, self.client_row.id
        for user in (self.arjun, self.lavanya):
            for path in (f'/api/workspace/cases/{cid}/summary', f'/api/cases/{cid}/timeline',
                         f'/api/workspace/cases/{cid}/financials', f'/api/clients/{clid}'):
                self.assertEqual(self._get(user, path).status_code, 404, (user.email, path))
            for path in (f'/api/workspace/cases/{cid}/tasks', f'/api/workspace/cases/{cid}/notes',
                         f'/api/workspace/cases/{cid}/parties', f'/api/documents/by-case/{cid}',
                         f'/api/expenses/case/{cid}', f'/api/payments/case/{cid}'):
                res = self._get(user, path)
                self.assertIn(res.status_code, (200, 404), (user.email, path))
                if res.status_code == 200:
                    self.assertEqual(self._rows(res), [], (user.email, path))
            ids = {r.get('id') for r in self._rows(self._get(user, '/api/cases/my-cases'))}
            self.assertNotIn(cid, ids, user.email)
            task_ids = {r.get('id') for r in self._rows(self._get(user, '/api/workspace/tasks/all'))}
            self.assertNotIn(self.task.id, task_ids, user.email)

    def test_other_team_cannot_change_or_attach_to_the_case(self):
        cid = self.case.id
        for user in (self.arjun, self.lavanya):
            h = auth(user)
            self.assertEqual(self.client.put(f'/api/workspace/tasks/{self.task.id}/toggle', {},
                                             content_type='application/json', **h).status_code, 404)
            self.assertEqual(self.client.put(f'/api/cases/update/{cid}', {'caseTitle': 'x'},
                                             content_type='application/json', **h).status_code, 404)
            self.assertEqual(self.client.post('/api/workspace/tasks/create', {'title': 'x', 'caseId': cid},
                                              content_type='application/json', **h).status_code, 404)
            # Expenses: refused, never saved unlinked in the caller's own practice.
            before = Expense.objects.count()
            res = self.client.post('/api/expenses/create', {'title': 'x', 'amount': 1, 'caseEntity': {'id': cid}},
                                   content_type='application/json', **h)
            self.assertEqual(res.status_code, 404, user.email)
            self.assertEqual(Expense.objects.count(), before)

    def test_editing_an_expense_cannot_unlink_its_case(self):
        """An out-of-reach case on edit used to set the expense's case to None."""
        res = self.client.put(f'/api/expenses/update/{self.expense.id}',
                              {'title': 'Court fee', 'caseEntity': {'id': 999999}},
                              content_type='application/json', **auth(self.rajesh))
        self.assertEqual(res.status_code, 404)
        self.assertEqual(Expense.objects.get(id=self.expense.id).case_id, self.case.id)
