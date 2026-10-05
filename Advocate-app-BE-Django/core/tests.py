"""Tests for who can reach what.

Two things are pinned here.

Practice scoping, because it is new and it is the difference between a junior
seeing the chambers' cases and seeing an empty application. Getting it wrong in
one direction makes the app useless; in the other it leaks one firm's cases to
another.

And the authentication gate, because it was once genuinely open: 61 endpoints
returned data to an unauthenticated caller until RequirePermission was fixed to
check authentication before permissions. That must not come back.
"""

from __future__ import annotations

from django.test import TestCase

from core import practice
from core.testing import (ALL_PERMISSIONS, auth, make_advocate, make_case,
                          make_client)


class PracticeScopeTest(TestCase):
    """A practice shares data; anyone outside it sees none of it."""

    def setUp(self):
        self.owner = make_advocate('owner@test.local', ALL_PERMISSIONS)
        self.member = make_advocate('member@test.local', ALL_PERMISSIONS,
                                    parent_advocate_id=self.owner.id)
        self.outsider = make_advocate('outsider@test.local', ALL_PERMISSIONS)

        self.owner_client = make_client(self.owner, 'Owner Client')
        self.owner_case = make_case(self.owner, self.owner_client)
        make_case(self.outsider, make_client(self.outsider, 'Outsider Client'))

    # -- the scope function itself ----------------------------------------

    def test_owner_scope_includes_members(self):
        self.assertEqual(sorted(practice.practice_ids(self.owner)),
                         sorted([self.owner.id, self.member.id]))

    def test_member_scope_includes_the_owner(self):
        self.assertEqual(sorted(practice.practice_ids(self.member)),
                         sorted([self.owner.id, self.member.id]))

    def test_solo_advocate_scope_is_only_themselves(self):
        self.assertEqual(practice.practice_ids(self.outsider),
                         [self.outsider.id])

    def test_scope_is_cached_per_user_object(self):
        first = practice.practice_ids(self.member)
        self.assertIs(first, practice.practice_ids(self.member))

    # -- through the API ---------------------------------------------------

    def test_member_sees_the_practice_cases(self):
        res = self.client.get('/api/cases', **auth(self.member))
        self.assertEqual(res.status_code, 200)
        self.assertIn(self.owner_case.case_number, res.content.decode())

    def test_outsider_cannot_see_the_practice_cases(self):
        """The important direction: permissions alone must not grant reach."""
        res = self.client.get('/api/cases', **auth(self.outsider))
        self.assertEqual(res.status_code, 200)
        self.assertNotIn(self.owner_case.case_number, res.content.decode())

    def test_outsider_cannot_fetch_a_practice_case_by_id(self):
        res = self.client.get('/api/cases/%d' % self.owner_case.id,
                              **auth(self.outsider))
        self.assertIn(res.status_code, (403, 404),
                      'guessing an id must not return another practice case')

    def test_member_sees_the_practice_clients(self):
        res = self.client.get('/api/clients', **auth(self.member))
        self.assertEqual(res.status_code, 200)
        self.assertIn('Owner Client', res.content.decode())

    def test_outsider_cannot_see_the_practice_clients(self):
        res = self.client.get('/api/clients', **auth(self.outsider))
        self.assertEqual(res.status_code, 200)
        self.assertNotIn('Owner Client', res.content.decode())

    def test_a_member_creation_is_attributed_to_the_member(self):
        """Sharing must not blur who did what - it is why created_by is not needed."""
        case = make_case(self.member, self.owner_client)
        self.assertEqual(case.advocate_id, self.member.id)
        # ...and the owner can still see it.
        self.assertIn(case.advocate_id, practice.practice_ids(self.owner))


class FirmWideAlertScopeTest(TestCase):
    """Firm-wide staff (accountants) are alerted about their own firm only."""

    def setUp(self):
        self.owner = make_advocate(permissions=('INVOICE_VIEW',))
        self.accountant = make_advocate(
            permissions=('INVOICE_VIEW', practice.FIRM_WIDE_PERMISSION),
            parent_advocate_id=self.owner.id)
        other_owner = make_advocate()
        self.outsider = make_advocate(
            permissions=('INVOICE_VIEW', practice.FIRM_WIDE_PERMISSION),
            parent_advocate_id=other_owner.id)

    def test_only_this_firms_staff_are_returned(self):
        ids = {m.id for m in practice.firm_wide_members(
            self.owner.id, permission='INVOICE_VIEW')}
        self.assertIn(self.accountant.id, ids)
        self.assertNotIn(self.outsider.id, ids)


class NotificationsStayPersonalTest(TestCase):
    """A notification is addressed to one advocate, not to the practice."""

    def setUp(self):
        self.owner = make_advocate('n-owner@test.local', ALL_PERMISSIONS)
        self.member = make_advocate('n-member@test.local', ALL_PERMISSIONS,
                                    parent_advocate_id=self.owner.id)
        from django.utils import timezone
        from core.models import Notification
        Notification.objects.create(
            created_at=timezone.now(), message='Owner only reminder',
            read_status=False, advocate_id=self.owner.id)

    def test_member_does_not_see_the_owner_notification(self):
        res = self.client.get('/api/notifications/unread', **auth(self.member))
        self.assertEqual(res.status_code, 200)
        self.assertNotIn('Owner only reminder', res.content.decode(),
                         'a colleague must not read an alert raised for someone else')

    def test_owner_sees_their_own(self):
        res = self.client.get('/api/notifications/unread', **auth(self.owner))
        self.assertIn('Owner only reminder', res.content.decode())


class AuthenticationGateTest(TestCase):
    """No token, no data. This was once broken across 61 endpoints."""

    ENDPOINTS = [
        '/api/cases', '/api/clients', '/api/invoices', '/api/expenses',
        '/api/payments', '/api/documents', '/api/events', '/api/dashboard',
        '/api/notifications/unread', '/api/reports/cases', '/api/acts',
        '/api/audit', '/api/activities', '/api/backup/history',
        '/api/backup/stats',
        '/api/workspace/tasks/all',
    ]

    def test_every_endpoint_refuses_an_anonymous_request(self):
        for url in self.ENDPOINTS:
            with self.subTest(url=url):
                res = self.client.get(url)
                self.assertIn(res.status_code, (401, 403),
                              '%s answered %s to an anonymous caller'
                              % (url, res.status_code))

    def test_a_garbage_token_is_refused(self):
        res = self.client.get('/api/cases',
                              HTTP_AUTHORIZATION='Bearer not-a-real-token')
        self.assertIn(res.status_code, (401, 403))


class PermissionGateTest(TestCase):
    """A signed-in advocate without the right permission is still refused."""

    def setUp(self):
        # Authenticated, but granted nothing.
        self.nobody = make_advocate('nobody@test.local')
        self.reader = make_advocate('reader@test.local', ('CASE_VIEW',))

    def test_no_permission_is_refused(self):
        res = self.client.get('/api/cases', **auth(self.nobody))
        self.assertEqual(res.status_code, 403)

    def test_the_right_permission_is_allowed(self):
        res = self.client.get('/api/cases', **auth(self.reader))
        self.assertEqual(res.status_code, 200)

    def test_backup_needs_its_own_permission(self):
        """CASE_VIEW must not open the page that can delete an account."""
        res = self.client.get('/api/backup/history', **auth(self.reader))
        self.assertEqual(res.status_code, 403)
        granted = make_advocate('backup@test.local', ('BACKUP_MANAGE',))
        self.assertEqual(
            self.client.get('/api/backup/history', **auth(granted)).status_code,
            200)

    def test_audit_needs_its_own_permission(self):
        res = self.client.get('/api/audit', **auth(self.reader))
        self.assertEqual(res.status_code, 403)


class DepartedMemberTest(TestCase):
    """Work done in a practice stays with the practice after someone leaves.

    Visibility is derived from who is currently in the practice, so removing a
    member used to make every row they created invisible - the rows survived in
    the database and nobody could reach them. A chambers losing its own case
    files because a junior moved on is not an acceptable outcome.
    """

    def setUp(self):
        self.owner = make_advocate('dep-owner@test.local', ALL_PERMISSIONS)
        self.member = make_advocate('dep-member@test.local', ALL_PERMISSIONS,
                                    parent_advocate_id=self.owner.id)
        self.member_case = make_case(self.member,
                                     make_client(self.member, 'Member Client'))

    def _owner_sees_member_case(self):
        from core.models import Advocate, Case
        owner = Advocate.objects.get(id=self.owner.id)   # fresh, uncached
        return Case.objects.filter(
            id=self.member_case.id,
            advocate_id__in=practice.practice_ids(owner)).exists()

    def test_owner_sees_member_work_while_they_are_there(self):
        self.assertTrue(self._owner_sees_member_case())

    def test_owner_still_sees_member_work_after_they_leave(self):
        practice.mark_left(self.member)
        self.assertTrue(
            self._owner_sees_member_case(),
            'the case must stay with the practice after the member leaves')

    def test_a_departed_member_cannot_sign_in(self):
        from core.models import Advocate
        practice.mark_left(self.member)
        res = self.client.get('/api/cases', **auth(self.member))
        self.assertIn(res.status_code, (401, 403),
                      'a departed member must lose access, not keep it')
        self.assertIsNotNone(Advocate.objects.get(id=self.member.id).left_on)


class UserDeletionTest(TestCase):
    """Removing a user must never take the practice's records with them."""

    def setUp(self):
        self.admin = make_advocate('del-admin@test.local', ALL_PERMISSIONS)
        self.member = make_advocate('del-member@test.local', ALL_PERMISSIONS,
                                    parent_advocate_id=self.admin.id)

    def test_a_user_with_records_is_closed_not_deleted(self):
        from core.models import Advocate
        make_case(self.member, make_client(self.member, 'Kept Client'))
        res = self.client.delete('/api/admin/users/%d' % self.member.id,
                                 **auth(self.admin))
        self.assertEqual(res.status_code, 200, res.content[:200])
        self.assertTrue(res.json()['closed'])
        self.assertFalse(res.json()['deleted'])
        still_there = Advocate.objects.filter(id=self.member.id).first()
        self.assertIsNotNone(still_there, 'the row must survive')
        self.assertIsNotNone(still_there.left_on)
        self.assertEqual(still_there.parent_advocate_id, self.admin.id,
                         'membership is kept so their work stays reachable')

    def test_an_empty_account_is_actually_deleted(self):
        from core.models import Advocate
        empty = make_advocate('empty@test.local')
        res = self.client.delete('/api/admin/users/%d' % empty.id,
                                 **auth(self.admin))
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()['deleted'])
        self.assertIsNone(Advocate.objects.filter(id=empty.id).first())

    def test_a_practice_owner_with_members_is_refused(self):
        res = self.client.delete('/api/admin/users/%d' % self.admin.id,
                                 **auth(self.admin))
        # Refused for owning a practice, or for being yourself - either way
        # not destroyed.
        self.assertIn(res.status_code, (400, 409))

    def test_you_cannot_remove_your_own_account(self):
        other = make_advocate('self-admin@test.local', ALL_PERMISSIONS)
        res = self.client.delete('/api/admin/users/%d' % other.id,
                                 **auth(other))
        self.assertEqual(res.status_code, 400)


class ResetDemoClientTest(TestCase):
    """manage.py reset_demo_client removes one client and everything linked to
    them - AMS rows, drafting rows and the portal login - and nothing else."""

    def setUp(self):
        import datetime
        import tempfile
        from django.test import override_settings
        from clientaccess.models import ClientUser
        from core.models import Document, Expense, Invoice
        from drafting.models import Client as DrfClient, DraftBlock, DraftSession, Project
        from workspace.models import CaseNote, CaseTask

        self._tmp = tempfile.TemporaryDirectory()
        self._override = override_settings(DOCUMENT_UPLOAD_DIR=self._tmp.name)
        self._override.enable()
        today = datetime.date.today()

        self.firm = make_advocate('reset-firm@test.local', ALL_PERMISSIONS)
        self.kannan = make_client(self.firm, 'Kannan')
        self.case = make_case(self.firm, self.kannan, case_title='Kannan vs Seetharaman')
        task = CaseTask.objects.create(advocate_id=self.firm.id, case_id=self.case.id, title='Brief')
        CaseNote.objects.create(advocate_id=self.firm.id, case_id=self.case.id, body='note')
        Expense.objects.create(title='Court fee', expense_type='CLIENT_CASE', advocate=self.firm,
                               case_id=self.case.id, client_id=self.kannan.id)
        Invoice.objects.create(invoice_number='INV-T1', amount=100, invoice_date=today,
                               due_date=today, status='UNPAID', advocate=self.firm,
                               case=self.case, client=self.kannan)
        self.upload = self._tmp.name + '/receipt.pdf'
        with open(self.upload, 'wb') as fh:
            fh.write(b'%PDF-1.4 test')
        Document.objects.create(document_name='Receipt', original_name='receipt.pdf',
                                stored_name='receipt.pdf', file_path=self.upload,
                                upload_date=datetime.datetime.now(), advocate=self.firm,
                                case_id=self.case.id)
        login = make_advocate('kannan-login@test.local', role='CLIENT')
        ClientUser.objects.create(advocate_id=login.id, client_id=self.kannan.id,
                                  created_at=datetime.datetime.now())
        self.login_id = login.id
        drf_client = DrfClient.objects.create(name='Kannan', ams_client_id=self.kannan.id)
        project = Project.objects.create(client=drf_client, name='OS 900', case_id=self.case.id)
        session = DraftSession.objects.create(project=project, ams_task_id=task.id)
        DraftBlock.objects.create(session=session, position=0, block_type='paragraph',
                                  text='Background', source='user')

        # Someone else's client in the same firm: must be untouched.
        self.other = make_client(self.firm, 'Anand')
        self.other_case = make_case(self.firm, self.other)

    def tearDown(self):
        self._override.disable()
        self._tmp.cleanup()

    def _run(self, *extra):
        from django.core.management import call_command
        from io import StringIO
        out = StringIO()
        call_command('reset_demo_client', '--name', 'Kannan', '--firm', self.firm.email,
                     *extra, stdout=out)
        return out.getvalue()

    def test_a_dry_run_deletes_nothing(self):
        from core.models import Case, Client
        out = self._run()
        self.assertIn('Dry run', out)
        self.assertTrue(Client.objects.filter(id=self.kannan.id).exists())
        self.assertTrue(Case.objects.filter(id=self.case.id).exists())

    def test_yes_removes_the_client_and_everything_linked(self):
        import os
        from clientaccess.models import ClientUser
        from core.models import Advocate, Case, Client, Document, Expense, Invoice
        from drafting.models import Client as DrfClient, DraftBlock, DraftSession, Project
        from workspace.models import CaseNote, CaseTask

        self._run('--yes')
        self.assertFalse(Client.objects.filter(id=self.kannan.id).exists())
        self.assertFalse(Case.objects.filter(id=self.case.id).exists())
        for model, filt in ((CaseTask, {'case_id': self.case.id}), (CaseNote, {'case_id': self.case.id}),
                            (Expense, {'case_id': self.case.id}), (Invoice, {'client_id': self.kannan.id}),
                            (Document, {'case_id': self.case.id}), (ClientUser, {'client_id': self.kannan.id}),
                            (Project, {'case_id': self.case.id}), (DrfClient, {'ams_client_id': self.kannan.id})):
            self.assertFalse(model.objects.filter(**filt).exists(), model.__name__)
        self.assertEqual(DraftSession.objects.count(), 0)
        self.assertEqual(DraftBlock.objects.count(), 0)
        self.assertFalse(Advocate.objects.filter(id=self.login_id).exists())
        self.assertFalse(os.path.exists(self.upload), 'the uploaded file was left on disk')
        # The backup holds the rows and a copy of the file.
        resets = os.path.join(self._tmp.name, 'demo-resets')
        folder = os.path.join(resets, os.listdir(resets)[0])
        self.assertIn('receipt.pdf', os.listdir(folder))
        self.assertIn('rows.json', os.listdir(folder))
        # The firm, its other client and case, are untouched.
        self.assertTrue(Advocate.objects.filter(id=self.firm.id).exists())
        self.assertTrue(Client.objects.filter(id=self.other.id).exists())
        self.assertTrue(Case.objects.filter(id=self.other_case.id).exists())


class CaseMoneyTotalsTest(TestCase):
    """The case's running totals follow its payments, expenses and invoices.
    They used to stay at 0 whatever was recorded (core/finance.py)."""

    def setUp(self):
        import json as _json
        self.json = _json
        self.adv = make_advocate('money@test.local', ALL_PERMISSIONS)
        self.client_row = make_client(self.adv, 'Kannan')
        self.case = make_case(self.adv, self.client_row)
        self.other_case = make_case(self.adv, self.client_row)

    def _post(self, url, body):
        return self.client.post(url, data=self.json.dumps(body),
                                content_type='application/json', **auth(self.adv))

    def _totals(self, case=None):
        from core.models import Case
        c = Case.objects.get(id=(case or self.case).id)
        return (c.total_paid_by_client, c.total_expenses_so_far,
                c.balance_in_account, c.pending_from_client)

    def _expense(self, amount, case=None):
        resp = self._post('/api/expenses/create', {
            'title': 'Court fee stamps', 'amount': amount, 'category': 'Court Fees',
            'expenseType': 'CLIENT_CASE', 'caseEntity': {'id': (case or self.case).id}})
        self.assertEqual(resp.status_code, 201, resp.content[:300])
        return resp.json()['id']

    def test_payment_and_expense_update_the_case(self):
        resp = self._post('/api/payments/create', {
            'amount': 10000, 'paymentMode': 'UPI', 'caseEntity': {'id': self.case.id}})
        self.assertEqual(resp.status_code, 201, resp.content[:300])
        self._expense(4850)
        paid, spent, balance, _pending = self._totals()
        self.assertEqual((paid, spent, balance), (10000.0, 4850.0, 5150.0))

    def test_an_invoice_sets_what_is_pending_when_no_fee_was_agreed(self):
        resp = self._post('/api/invoices/create', {
            'caseEntity': {'id': self.case.id}, 'taxMode': 'rcm',
            'particulars': [{'description': 'Professional fee', 'amount': 25000}]})
        self.assertIn(resp.status_code, (200, 201), resp.content[:300])
        self._post('/api/payments/create', {'amount': 10000, 'caseEntity': {'id': self.case.id}})
        self.assertEqual(self._totals()[3], 15000.0)

    def test_an_agreed_fee_wins_over_invoices(self):
        self.client.put(f'/api/cases/update/{self.case.id}', data=self.json.dumps({'amount': 50000}),
                        content_type='application/json', **auth(self.adv))
        self._post('/api/payments/create', {'amount': 10000, 'caseEntity': {'id': self.case.id}})
        self.assertEqual(self._totals()[3], 40000.0)

    def test_editing_moving_and_deleting_an_expense(self):
        eid = self._expense(1000)
        self.client.put(f'/api/expenses/update/{eid}', data=self.json.dumps({
            'title': 'Court fee stamps', 'amount': 1500, 'expenseType': 'CLIENT_CASE',
            'caseEntity': {'id': self.other_case.id}}),
            content_type='application/json', **auth(self.adv))
        self.assertEqual(self._totals()[1], 0.0)                 # moved away
        self.assertEqual(self._totals(self.other_case)[1], 1500.0)
        self.client.delete(f'/api/expenses/delete/{eid}', **auth(self.adv))
        self.assertEqual(self._totals(self.other_case)[1], 0.0)

    def test_the_backfill_command_fixes_existing_cases(self):
        from core.models import Case, ClientPayment
        from django.core.management import call_command
        from io import StringIO
        # A payment written without going through the API (as before the fix).
        ClientPayment.objects.create(amount=7000, advocate_id=self.adv.id, case=self.case,
                                     client=self.client_row)
        Case.objects.filter(id=self.case.id).update(total_paid_by_client=0)
        call_command('recalc_case_totals', stdout=StringIO())
        self.assertEqual(self._totals()[0], 7000.0)


class RemoveReceptionistRoleTest(TestCase):
    """manage.py remove_receptionist_role: advocates take over client intake."""

    def setUp(self):
        import datetime
        from core.models import (AdvocateRole, CaseEvent, Permission, Role, RolePermission)
        now = datetime.datetime.now()
        self.now = now
        self.owner = make_advocate('rr-owner@test.local', ALL_PERMISSIONS)
        self.desk = make_advocate('rr-desk@test.local', parent_advocate_id=self.owner.id)
        self.lone = make_advocate('rr-lone@test.local')
        self.role = Role.objects.create(name='Receptionist', description='', created_at=now)
        self.junior_role = Role.objects.create(name='Advocate', description='', created_at=now)
        for code in ('CLIENT_CREATE', 'CLIENT_EDIT', 'EVENT_CREATE'):
            perm, _ = Permission.objects.get_or_create(
                name=code, defaults={'description': code, 'module': 'TEST', 'created_at': now})
            RolePermission.objects.create(role_id=self.role.id, permission_id=perm.id, created_at=now)
        for acc in (self.desk, self.lone):
            AdvocateRole.objects.create(advocate_id=acc.id, role_id=self.role.id, created_at=now)
        self.walk_in = make_client(self.desk, 'Selvi Ramasamy')
        case = make_case(self.owner)
        self.event = CaseEvent.objects.create(title='Consultation', event_type='MEETING',
                                              date=datetime.date.today(), case=case,
                                              advocate_id=self.desk.id)

    def _run(self, *extra):
        import tempfile
        from io import StringIO
        from django.core.management import call_command
        from django.test import override_settings
        out = StringIO()
        with tempfile.TemporaryDirectory() as tmp, override_settings(DOCUMENT_UPLOAD_DIR=tmp):
            call_command('remove_receptionist_role', *extra, stdout=out)
        return out.getvalue()

    def test_a_dry_run_changes_nothing(self):
        from core.models import Advocate, Role
        self.assertIn('Dry run', self._run())
        self.assertTrue(Role.objects.filter(name='Receptionist').exists())
        self.assertTrue(Advocate.objects.filter(id=self.desk.id).exists())

    def test_apply_hands_over_work_and_removes_role_and_accounts(self):
        from core.models import Advocate, CaseEvent, Client, Role, RolePermission
        self._run('--yes')
        self.assertFalse(Role.objects.filter(name='Receptionist').exists())
        self.assertFalse(Advocate.objects.filter(id__in=[self.desk.id, self.lone.id]).exists())
        # Their work stays with the firm, owned by the practice owner.
        self.assertEqual(Client.objects.get(id=self.walk_in.id).advocate_id, self.owner.id)
        self.assertEqual(CaseEvent.objects.get(id=self.event.id).advocate_id, self.owner.id)
        granted = set(RolePermission.objects.filter(role_id=self.junior_role.id)
                      .values_list('permission_id', flat=True))
        from core.models import Permission
        self.assertEqual(granted, set(Permission.objects.filter(
            name__in=['CLIENT_CREATE', 'CLIENT_EDIT']).values_list('id', flat=True)))
        # A second run has nothing to do.
        self.assertIn('Nothing to do', self._run('--yes'))

    def test_an_owner_less_account_with_work_is_kept(self):
        from core.models import Advocate
        make_client(self.lone, 'Someone')
        out = self._run('--yes')
        self.assertIn('will NOT be deleted', out)
        self.assertTrue(Advocate.objects.filter(id=self.lone.id).exists())
        self.assertFalse(Advocate.objects.filter(id=self.desk.id).exists())


class FormatValidatorsTest(TestCase):
    """core/validators.py: the format rules every form shares."""

    def test_gstin(self):
        from core.validators import clean_gstin, gstin_state
        self.assertEqual(clean_gstin(' 33arkpk4821m1zl '), '33ARKPK4821M1ZL')   # normalised
        self.assertEqual(gstin_state('33ARKPK4821M1ZL'), 'Tamil Nadu')
        self.assertEqual(clean_gstin(''), '')                                 # optional
        for bad in ('33ARKPK4821M1ZM',      # wrong check digit
                    '33ARKPK4821M1Z',       # 14 characters
                    '00ARKPK4821M1ZL',      # not a state code
                    'GSTIN1234567890'):     # wrong pattern
            with self.assertRaises(ValueError, msg=bad):
                clean_gstin(bad)

    def test_pan_pin_phone_email_ifsc(self):
        from core import validators as v
        self.assertEqual(v.clean_pan('abcde1234f'), 'ABCDE1234F')
        self.assertEqual(v.clean_pincode('600 004'), '600004')
        self.assertEqual(v.clean_email(' Kannan@Clients.Demo '), 'kannan@clients.demo')
        self.assertEqual(v.clean_ifsc('sbin0001234'), 'SBIN0001234')
        for ok in ('+91 90030 11900', '9003011900', '044-24981234', '+1 415 555 0100'):
            v.clean_phone(ok)
        for fn, bad in ((v.clean_pan, 'ABCD1234F'), (v.clean_pincode, '060004'),
                        (v.clean_phone, '12345'), (v.clean_phone, 'call me'),
                        (v.clean_email, 'kannan@'), (v.clean_ifsc, 'SBIN1001234')):
            with self.assertRaises(ValueError, msg=bad):
                fn(bad)


class FormatChecksOnFormsTest(TestCase):
    """The forms' endpoints refuse malformed values, and store clean ones."""

    def setUp(self):
        import json as _json
        self.json = _json
        self.adv = make_advocate('formats@test.local', ALL_PERMISSIONS)

    def _send(self, method, url, body):
        return getattr(self.client, method)(url, data=self.json.dumps(body),
                                            content_type='application/json', **auth(self.adv))

    def test_client_form(self):
        bad = self._send('post', '/api/clients/create',
                         {'name': 'Kannan', 'phone': '9003011900', 'gstin': '33ARKPK4821M1ZM'})
        self.assertEqual(bad.status_code, 400)
        self.assertIn('gstin', bad.json()['errors'])
        self.assertIn('check digit', bad.json()['error'])
        ok = self._send('post', '/api/clients/create',
                        {'name': 'Kannan', 'phone': '9003011900', 'gstin': '33arkpk4821m1zl',
                         'pincode': '600004', 'email': 'Kannan@Clients.Demo'})
        self.assertEqual(ok.status_code, 201, ok.content[:300])
        self.assertEqual(ok.json()['gstin'], '33ARKPK4821M1ZL')

    def test_profile_and_user_forms(self):
        r = self._send('put', '/api/profile', {'panNumber': 'BADPAN', 'pinCode': '600004'})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(list(r.json()['errors']), ['panNumber'])
        r = self._send('post', '/api/admin/users',
                       {'email': 'not-an-email', 'password': 'Strong#Pass1', 'fullName': 'X'})
        self.assertEqual(r.status_code, 400)
        self.assertIn('email', r.json()['errors'])


class TeamsWithinFirmTest(TestCase):
    """A firm with two seniors: each senior's team sees only its own matters;
    the firm's Super Admin and Accountant see both; another firm sees nothing."""

    def setUp(self):
        from firms.models import FirmTeam
        fw = ALL_PERMISSIONS + (practice.FIRM_WIDE_PERMISSION,)
        self.senior_a = make_advocate(permissions=ALL_PERMISSIONS)
        self.junior_a = make_advocate(permissions=ALL_PERMISSIONS, parent_advocate_id=self.senior_a.id)
        self.senior_b = make_advocate(permissions=ALL_PERMISSIONS)
        self.intern_b = make_advocate(permissions=ALL_PERMISSIONS, parent_advocate_id=self.senior_b.id)
        self.admin = make_advocate(permissions=fw, parent_advocate_id=self.senior_a.id)
        self.accountant = make_advocate(permissions=('INVOICE_VIEW', 'CASE_VIEW', practice.FIRM_WIDE_PERMISSION),
                                        parent_advocate_id=self.senior_a.id)
        FirmTeam.objects.create(team_root_id=self.senior_a.id, firm_root_id=self.senior_a.id)
        FirmTeam.objects.create(team_root_id=self.senior_b.id, firm_root_id=self.senior_a.id)
        self.other_firm = make_advocate(permissions=ALL_PERMISSIONS)
        self.case_a = make_case(self.senior_a)
        self.case_b = make_case(self.senior_b)

    def _numbers(self, who):
        r = self.client.get('/api/cases/my-cases', **auth(who))
        self.assertEqual(r.status_code, 200)
        return {c['caseNumber'] for c in r.json()}

    def test_each_team_sees_only_its_own_cases(self):
        a, b = self.case_a.case_number, self.case_b.case_number
        for who in (self.senior_a, self.junior_a):
            self.assertEqual(self._numbers(who), {a})
        for who in (self.senior_b, self.intern_b):
            self.assertEqual(self._numbers(who), {b})
        for who in (self.admin, self.accountant):
            self.assertEqual(self._numbers(who), {a, b})
        self.assertEqual(self._numbers(self.other_firm), set())

    def test_other_team_cannot_open_the_case(self):
        r = self.client.get('/api/cases/{}/timeline'.format(self.case_a.id), **auth(self.intern_b))
        self.assertEqual(r.status_code, 404)

    def test_firm_wide_alerts_cover_every_team(self):
        ids = {m.id for m in practice.firm_wide_members(self.senior_b.id, permission='INVOICE_VIEW')}
        self.assertIn(self.accountant.id, ids)

    def test_transfer_targets_stay_in_the_firm(self):
        r = self.client.get('/api/cases/transfer-targets', **auth(self.senior_a))
        ids = {t['id'] for t in r.json()}
        self.assertIn(self.senior_b.id, ids)
        self.assertNotIn(self.other_firm.id, ids)
        r = self.client.put('/api/cases/transfer/{}'.format(self.case_a.id),
                            {'advocateId': self.other_firm.id}, content_type='application/json',
                            **auth(self.senior_a))
        self.assertEqual(r.status_code, 403)

    def test_transfer_moves_the_matter_to_the_other_team(self):
        from core.models import CaseEvent
        import datetime
        CaseEvent.objects.create(case_id=self.case_a.id, advocate_id=self.junior_a.id,
                                 title='Hearing', event_type='HEARING', date=datetime.date.today())
        r = self.client.put('/api/cases/transfer/{}'.format(self.case_a.id),
                            {'advocateId': self.senior_b.id}, content_type='application/json',
                            **auth(self.senior_a))
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIn(self.case_a.case_number, self._numbers(self.intern_b))
        self.assertNotIn(self.case_a.case_number, self._numbers(self.junior_a))
        self.assertEqual(set(CaseEvent.objects.filter(case_id=self.case_a.id)
                             .values_list('advocate_id', flat=True)), {self.senior_b.id})

    def test_admin_registers_a_client_for_the_other_team(self):
        from core.models import Client
        r = self.client.post('/api/clients/create', {'name': 'Walk In', 'phone': '9876543210',
                                                     'handlingAdvocateId': self.senior_b.id},
                             content_type='application/json', **auth(self.admin))
        self.assertEqual(r.status_code, 201, r.content)
        client = Client.objects.get(id=r.json()['id'])
        self.assertIn(client.advocate_id, practice.practice_ids(self.intern_b))
        self.assertNotIn(client.advocate_id, practice.practice_ids(self.junior_a))


class MakeTeamCommandTest(TestCase):
    def setUp(self):
        self.head = make_advocate('head@test.local', ALL_PERMISSIONS)
        self.second = make_advocate('second@test.local', ALL_PERMISSIONS, parent_advocate_id=self.head.id)
        self.junior = make_advocate(permissions=ALL_PERMISSIONS, parent_advocate_id=self.head.id)
        self.case = make_case(self.second)
        from core.models import CaseEvent
        import datetime
        CaseEvent.objects.create(case_id=self.case.id, advocate_id=self.junior.id,
                                 title='Hearing', event_type='HEARING', date=datetime.date.today())

    def _run(self, *extra):
        import io, tempfile
        from django.core.management import call_command
        from django.test import override_settings
        with tempfile.TemporaryDirectory() as tmp, override_settings(DOCUMENT_UPLOAD_DIR=tmp):
            out = io.StringIO()
            call_command('make_team', '--senior', 'second@test.local', '--firm', 'head@test.local',
                         *extra, stdout=out)
            return out.getvalue()

    def test_dry_run_then_apply_then_idempotent(self):
        from core.models import Advocate, CaseEvent
        self._run()
        self.assertEqual(Advocate.objects.get(id=self.second.id).parent_advocate_id, self.head.id)
        self._run('--yes')
        second = Advocate.objects.get(id=self.second.id)
        self.assertIsNone(second.parent_advocate_id)
        self.assertEqual(set(CaseEvent.objects.filter(case_id=self.case.id)
                             .values_list('advocate_id', flat=True)), {self.second.id})
        self.assertNotIn(self.case.advocate_id, practice.practice_ids(
            Advocate.objects.get(id=self.junior.id)))
        self.assertIn('nothing to do', self._run('--yes'))
