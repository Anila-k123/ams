"""Who sees which tasks, and who is alerted about a case."""

from __future__ import annotations

import datetime

from django.test import TestCase

from core import practice
from core.models import NotificationQueue
from core.testing import auth, make_advocate, make_case
from notifications import events
from workspace.models import CaseTask


class TaskVisibilityTest(TestCase):
    def setUp(self):
        self.senior = make_advocate(permissions=('TASK_VIEW', 'TASK_ASSIGN', 'CASE_VIEW'))
        self.intern = make_advocate(permissions=('TASK_VIEW', 'CASE_VIEW'),
                                    parent_advocate_id=self.senior.id)
        self.junior = make_advocate(permissions=('TASK_VIEW', 'CASE_VIEW'),
                                    parent_advocate_id=self.senior.id)
        case = make_case(self.senior)
        self.intern_task = CaseTask.objects.create(
            advocate_id=self.senior.id, case_id=case.id, title='Intern research',
            assigned_to_id=self.intern.id, assigned_by_id=self.senior.id)
        self.junior_task = CaseTask.objects.create(
            advocate_id=self.senior.id, case_id=case.id, title='Junior draft',
            assigned_to_id=self.junior.id, assigned_by_id=self.senior.id)
        self.own_task = CaseTask.objects.create(
            advocate_id=self.intern.id, title='Intern note to self')

    def _titles(self, user):
        r = self.client.get('/api/workspace/tasks/all', **auth(user))
        self.assertEqual(r.status_code, 200)
        return {t['title'] for t in r.json()}

    def test_intern_sees_only_assigned_and_own_tasks(self):
        self.assertEqual(self._titles(self.intern), {'Intern research', 'Intern note to self'})

    def test_senior_sees_every_task(self):
        self.assertEqual(self._titles(self.senior),
                         {'Intern research', 'Junior draft', 'Intern note to self'})

    def test_hidden_task_cannot_be_changed_by_id(self):
        r = self.client.put('/api/workspace/tasks/{}/priority'.format(self.junior_task.id),
                            {'priority': 'HIGH'}, content_type='application/json',
                            **auth(self.intern))
        self.assertEqual(r.status_code, 404)

    def test_deadline_reminder_goes_to_assignee_and_assigner_only(self):
        CaseTask.objects.filter(id=self.junior_task.id).update(
            deadline=datetime.date.today())
        events.task_deadlines(self.senior)
        told = set(NotificationQueue.objects.filter(
            type='TASK_DEADLINE_REMINDER').values_list('advocate_id', flat=True))
        self.assertEqual(told, {self.junior.id, self.senior.id})


class CaseAlertRecipientsTest(TestCase):
    def setUp(self):
        self.senior = make_advocate(permissions=('CASE_VIEW', 'CASE_ALERTS', 'INVOICE_VIEW'))
        self.intern = make_advocate(permissions=('CASE_VIEW', 'CASE_ALERTS'),
                                    parent_advocate_id=self.senior.id)
        self.accountant = make_advocate(
            permissions=('CASE_VIEW', 'INVOICE_VIEW', practice.FIRM_WIDE_PERMISSION),
            parent_advocate_id=self.senior.id)

    def test_case_alerts_skip_the_accountant(self):
        self.assertEqual(practice.case_alert_permission(), 'CASE_ALERTS')
        ids = {m.id for m in practice.alert_members(
            self.senior, permission=practice.case_alert_permission())}
        self.assertEqual(ids, {self.senior.id, self.intern.id})

    def test_invoice_alerts_still_reach_the_accountant(self):
        ids = {m.id for m in practice.firm_wide_members(
            self.senior.id, permission='INVOICE_VIEW')}
        self.assertIn(self.accountant.id, ids)
