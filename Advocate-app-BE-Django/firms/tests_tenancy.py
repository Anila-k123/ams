"""Phase 2: firms are tenants. Three independent firms, firm mode enforced.

Access = active membership of an active firm + firm ownership of the row +
role permissions + team scope. These tests prove each part, and that legacy
mode is untouched and shadow mode only observes.
"""
import datetime
import json
import os
import shutil
import tempfile
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings

from core import tenant
from core.models import (Case, CaseEvent, Client, ClientPayment, Document, Expense, Invoice,
                         Notification)
from core.practice import practice_ids
from core.testing import ALL_PERMISSIONS, auth, grant, make_advocate
from firms.models import Firm, FirmMembership, FirmTeam
from workspace.models import CaseTask

NOW = datetime.datetime.now


def _ids(response):
    body = response.json()
    rows = body.get('content', body.get('results', body)) if isinstance(body, dict) else body
    return {r['id'] for r in rows}


class _ThreeFirms:
    """Firms A, B, C. A has two teams (seniors s1, s2), a firm-wide admin and an
    accountant who heads no team (like root 70 on the office database)."""

    def build(self):
        self.dir = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.dir, 'documents'))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self._s = override_settings(DOCUMENT_UPLOAD_DIR=self.dir, SUMMARY_ENABLED=False)
        self._s.enable()
        self.addCleanup(self._s.disable)

        self.firms = {}
        for key in 'ABC':
            self.firms[key] = Firm.objects.create(name=f'Firm {key}', slug=f'firm-{key.lower()}',
                                                  status=Firm.ACTIVE)
            from subscriptions.service import assign_legacy     # every firm has a subscription
            assign_legacy(self.firms[key], reason='test fixture')
        a = self.firms['A']
        self.admin_a = self._member(a, ALL_PERMISSIONS + ('FIRM_WIDE_SCOPE',))
        self.s1 = self._member(a, ALL_PERMISSIONS)
        self.j1 = self._member(a, ALL_PERMISSIONS, parent=self.s1)
        self.s2 = self._member(a, ALL_PERMISSIONS)
        self.accountant_a = self._member(a, ('CASE_VIEW', 'INVOICE_VIEW', 'FIRM_WIDE_SCOPE'))
        for root in (self.admin_a, self.s1, self.s2, self.accountant_a):
            FirmTeam.objects.create(team_root_id=root.id, firm_root_id=self.admin_a.id, firm_id=a.id)
        self.b = self._member(self.firms['B'], ALL_PERMISSIONS + ('FIRM_WIDE_SCOPE',))
        self.c = self._member(self.firms['C'], ALL_PERMISSIONS + ('FIRM_WIDE_SCOPE',))

        self.data = {who: self._business(who) for who in ('s1', 's2', 'b', 'c')}

    def _member(self, firm, perms, parent=None):
        adv = make_advocate(permissions=perms, parent_advocate_id=parent.id if parent else None)
        FirmMembership.objects.create(firm=firm, advocate_id=adv.id, kind=FirmMembership.STAFF,
                                      status=FirmMembership.ACTIVE, joined_at=NOW())
        # Firm-level RBAC: only roles owned by the member's firm count in firm mode.
        from core.models import AdvocateRole, Role
        Role.objects.filter(id__in=AdvocateRole.objects.filter(advocate_id=adv.id).values('role_id'))             .update(firm_id=firm.id)
        return adv

    def _business(self, who):
        owner = getattr(self, who)
        client = Client.objects.create(name=f'Client of {who}', deleted=False, advocate_id=owner.id)
        case = Case.objects.create(case_number=f'OS/{who}/{owner.id}', case_title=f'{who} v State',
                                   status='Active', deleted=False, advocate_id=owner.id, client=client)
        stored = f'doc-{who}.pdf'
        with open(os.path.join(self.dir, 'documents', stored), 'wb') as fh:
            fh.write(b'%PDF secret of ' + who.encode())
        doc = Document.objects.create(document_name='Plaint', original_name='p.pdf', stored_name=stored,
                                      file_path=os.path.join(self.dir, 'documents', stored), file_size=10,
                                      file_type='application/pdf', version=1, download_count=0,
                                      status='ACTIVE', upload_date=NOW(), updated_at=NOW(),
                                      advocate_id=owner.id, case=case, client=client)
        invoice = Invoice.objects.create(invoice_number=f'INV-{who}-{owner.id}', amount=1000,
                                         invoice_date=datetime.date.today(), due_date=datetime.date.today(), status='UNPAID',
                                         advocate_id=owner.id, case=case, client=client)
        payment = ClientPayment.objects.create(amount=100, payment_date=datetime.date.today(),
                                               advocate_id=owner.id, case=case, client=client)
        expense = Expense.objects.create(amount=50, title='Court fee', expense_type='COURT_FEE',
                                         advocate_id=owner.id, case=case, client=client)
        event = CaseEvent.objects.create(case=case, advocate_id=owner.id, title='Hearing',
                                         event_type='HEARING', date=datetime.date.today())
        task = CaseTask.objects.create(advocate_id=owner.id, case_id=case.id, title='Draft reply')
        note = Notification.objects.create(created_at=NOW(), message=f'note for {who}', read_status=False,
                                           advocate_id=owner.id, case_id=case.id)
        return dict(client=client, case=case, doc=doc, invoice=invoice, payment=payment,
                    expense=expense, event=event, task=task, notification=note)


@override_settings(TENANCY_MODE='firm')
class FirmIsolationTests(_ThreeFirms, TestCase):
    def setUp(self):
        self.build()

    # ---- ownership ---------------------------------------------------------
    def test_new_records_are_stamped_with_the_creators_firm(self):
        for who, firm in (('s1', 'A'), ('b', 'B'), ('c', 'C')):
            for name, row in self.data[who].items():
                row.refresh_from_db()
                self.assertEqual(row.firm_id, self.firms[firm].id, f'{who} {name}')

    def test_record_created_through_the_api_gets_the_firm(self):
        r = self.client.post('/api/cases/create', data=json.dumps({
            'caseNumber': 'OS/NEW/1', 'caseTitle': 'New', 'courtLevel': 'District', 'status': 'Active',
            'clientId': self.data['s1']['client'].id}), content_type='application/json', **auth(self.s1))
        self.assertIn(r.status_code, (200, 201), r.content[:300])
        self.assertEqual(Case.objects.get(case_number='OS/NEW/1').firm_id, self.firms['A'].id)

    def test_tenant_cannot_be_spoofed_through_the_request(self):
        b_firm = self.firms['B'].id
        r = self.client.post(f'/api/cases/create?firm_id={b_firm}', data=json.dumps({
            'caseNumber': 'OS/SPOOF/1', 'caseTitle': 'x', 'courtLevel': 'District', 'status': 'Active',
            'clientId': self.data['s1']['client'].id, 'firmId': b_firm, 'firm_id': b_firm}),
            content_type='application/json', **auth(self.s1))
        self.assertIn(r.status_code, (200, 201))
        self.assertEqual(Case.objects.get(case_number='OS/SPOOF/1').firm_id, self.firms['A'].id)
        r = self.client.get(f'/api/cases?firmId={b_firm}&firm_id={b_firm}', **auth(self.s1))
        self.assertNotIn(self.data['b']['case'].id, _ids(r))

    def test_cross_firm_references_are_refused(self):
        with self.assertRaises(tenant.TenantAccessDenied):
            Case.objects.create(case_number='OS/X/1', case_title='x', status='Active', deleted=False,
                                advocate_id=self.s1.id, client=self.data['b']['client'])
        with self.assertRaises(tenant.TenantAccessDenied):
            CaseEvent.objects.create(case=self.data['c']['case'], advocate_id=self.s1.id, title='x',
                                     event_type='HEARING', date=datetime.date.today())
        with self.assertRaises(tenant.TenantAccessDenied):
            CaseTask.objects.create(advocate_id=self.b.id, case_id=self.data['s1']['case'].id, title='x')

    def test_cross_firm_reference_through_the_api_is_refused(self):
        r = self.client.post('/api/cases/create', data=json.dumps({
            'caseNumber': 'OS/X/2', 'caseTitle': 'x', 'courtLevel': 'District', 'status': 'Active',
            'clientId': self.data['b']['client'].id}), content_type='application/json', **auth(self.s1))
        self.assertFalse(Case.objects.filter(case_number='OS/X/2', client_id=self.data['b']['client'].id).exists())

    # ---- reads ---------------------------------------------------------------
    def test_lists_never_show_another_firms_rows(self):
        checks = [('/api/cases', 'case'), ('/api/clients', 'client'), ('/api/invoices', 'invoice'),
                  ('/api/payments', 'payment'), ('/api/expenses', 'expense'), ('/api/events', 'event')]
        for url, key in checks:
            seen = _ids(self.client.get(url, **auth(self.admin_a)))
            self.assertIn(self.data['s1'][key].id, seen, url)
            self.assertNotIn(self.data['b'][key].id, seen, url)
            self.assertNotIn(self.data['c'][key].id, seen, url)

    def test_another_firms_records_cannot_be_opened_or_changed(self):
        b = self.data['b']
        self.assertEqual(self.client.get(f'/api/clients/{b["client"].id}', **auth(self.admin_a)).status_code, 404)
        self.assertEqual(self.client.get(f'/api/cases/{b["case"].id}/timeline', **auth(self.admin_a)).status_code, 404)
        r = self.client.put(f'/api/cases/update/{b["case"].id}', data=json.dumps({'caseTitle': 'hacked'}),
                            content_type='application/json', **auth(self.admin_a))
        self.assertEqual(r.status_code, 404)
        b['case'].refresh_from_db()
        self.assertNotEqual(b['case'].case_title, 'hacked')

    def test_another_firms_document_cannot_be_downloaded(self):
        r = self.client.get(f'/api/documents/download/{self.data["b"]["doc"].id}', **auth(self.admin_a))
        self.assertEqual(r.status_code, 404)
        r = self.client.get(f'/api/documents/download/{self.data["s1"]["doc"].id}', **auth(self.admin_a))
        self.assertEqual(r.status_code, 200)

    def test_another_firms_drafting_data_is_invisible(self):
        from drafting.models import DraftSession, Template
        t = Template.objects.create(name='NDA', document_type='NDA', created_by_id=self.b.id)
        s = DraftSession.objects.create(template=t, created_by_id=self.b.id, facts={}, status='ready')
        self.assertEqual(t.firm_id, self.firms['B'].id)
        self.assertEqual(self.client.get(f'/api/drafting/draft-sessions/{s.id}/', **auth(self.admin_a)).status_code, 404)
        ids = {x['id'] for x in self.client.get('/api/drafting/templates/', **auth(self.admin_a)).json()['results']}
        self.assertNotIn(t.id, ids)

    def test_notifications_stay_in_their_firm(self):
        seen = {n['id'] for n in self.client.get('/api/notifications', **auth(self.b)).json()}
        self.assertIn(self.data['b']['notification'].id, seen)
        self.assertNotIn(self.data['s1']['notification'].id, seen)

    def test_ai_context_sees_only_the_firm(self):
        from assistant import tools
        scope = set(tools._scope(self.admin_a.id))
        self.assertNotIn(self.b.id, scope)
        self.assertNotIn(self.c.id, scope)
        from assistant.privacy import Masker
        masker = Masker.for_user(self.admin_a.id)
        known = {surface.lower() for surface, _ in masker._names}
        self.assertIn(self.data['s1']['client'].name.lower(), known)
        self.assertNotIn(self.data['b']['client'].name.lower(), known)   # B's client is unknown to A

    # ---- team restrictions inside a firm ---------------------------------------
    def test_teams_still_restrict_inside_a_firm(self):
        seen = _ids(self.client.get('/api/cases', **auth(self.j1)))
        self.assertIn(self.data['s1']['case'].id, seen)
        self.assertNotIn(self.data['s2']['case'].id, seen)

    def test_firm_wide_roles_see_every_team_of_their_firm_only(self):
        for who in (self.admin_a, self.accountant_a):
            ids = set(practice_ids(who))
            self.assertTrue({self.s1.id, self.s2.id, self.j1.id} <= ids)
            self.assertFalse({self.b.id, self.c.id} & ids)

    def test_existing_users_keep_legitimate_access(self):
        self.assertIn(self.data['s1']['case'].id, _ids(self.client.get('/api/cases', **auth(self.s1))))
        self.assertIn(self.data['b']['case'].id, _ids(self.client.get('/api/cases', **auth(self.b))))

    # ---- membership / firm status ---------------------------------------------------
    def test_suspended_firm_loses_access_immediately(self):
        Firm.objects.filter(id=self.firms['B'].id).update(status=Firm.SUSPENDED)
        r = self.client.get('/api/cases', **auth(self.b))
        self.assertEqual(r.status_code, 401)
        self.assertIn('suspended', r.json()['detail'])

    def test_left_or_suspended_membership_loses_access(self):
        FirmMembership.objects.filter(advocate_id=self.s2.id).update(status=FirmMembership.LEFT)
        self.assertEqual(self.client.get('/api/cases', **auth(self.s2)).status_code, 401)
        FirmMembership.objects.filter(advocate_id=self.c.id).update(status=FirmMembership.SUSPENDED)
        self.assertEqual(self.client.get('/api/cases', **auth(self.c)).status_code, 401)

    def test_former_members_work_stays_with_the_firm(self):
        FirmMembership.objects.filter(advocate_id=self.s2.id).update(status=FirmMembership.LEFT)
        self.assertIn(self.data['s2']['case'].id, _ids(self.client.get('/api/cases', **auth(self.admin_a))))

    def test_no_membership_means_no_access(self):
        loner = make_advocate(permissions=ALL_PERMISSIONS)
        self.assertEqual(self.client.get('/api/cases', **auth(loner)).status_code, 401)

    def test_user_management_lists_only_the_firm(self):
        ids = {u['id'] for u in self.client.get('/api/admin/users', **auth(self.admin_a)).json()}
        self.assertTrue({self.s1.id, self.s2.id, self.accountant_a.id} <= ids)
        self.assertFalse({self.b.id, self.c.id} & ids)


class LegacyAndShadowModeTests(_ThreeFirms, TestCase):
    def setUp(self):
        self.build()

    @override_settings(TENANCY_MODE='legacy')
    def test_legacy_mode_is_unchanged(self):
        # The accountant heads no FirmTeam row of their own in legacy terms? They do here,
        # so compare with the legacy function directly.
        from core.practice import _legacy_practice_ids
        for who in (self.s1, self.j1, self.admin_a, self.b):
            self.assertEqual(practice_ids(who), _legacy_practice_ids(who))
        loner = make_advocate(permissions=ALL_PERMISSIONS)
        self.assertEqual(self.client.get('/api/cases', **auth(loner)).status_code, 200)

    @override_settings(TENANCY_MODE='shadow')
    def test_shadow_mode_enforces_legacy_and_logs_differences(self):
        from core.practice import _legacy_practice_ids
        # An accountant who heads no team row: legacy sees only themselves,
        # firm mode sees the whole firm -> an expected, authorised difference.
        FirmTeam.objects.filter(team_root_id=self.accountant_a.id).delete()
        with self.assertLogs('core.tenant', level='WARNING') as logs:
            ids = practice_ids(self.accountant_a)
        self.assertEqual(ids, _legacy_practice_ids(self.accountant_a))
        self.assertIn('expected_authorized', '\n'.join(logs.output))
        self.assertNotIn('Client of', '\n'.join(logs.output))   # metadata only

    def test_classification(self):
        legacy = [self.s1.id]
        # A team member (not firm-wide) suddenly seeing another team: expansion.
        result = dict(tenant.classify(self.s1, legacy, [self.s1.id, self.s2.id]))
        self.assertIn(tenant.EXPANSION, result)
        # Losing ids that belong to another firm: an ownership anomaly, not a loss.
        result = dict(tenant.classify(self.s1, [self.s1.id, self.b.id], [self.s1.id]))
        self.assertIn(tenant.ANOMALY, result)
        # Losing your own team: unexpected loss.
        result = dict(tenant.classify(self.s1, [self.s1.id, self.j1.id], [self.s1.id]))
        self.assertIn(tenant.LOSS, result)


class TenancyCommandTests(TestCase):
    """plan / apply / verify on a practice-shaped database (no memberships yet)."""

    def setUp(self):
        self.root_a = make_advocate(permissions=ALL_PERMISSIONS)
        self.junior_a = make_advocate(permissions=ALL_PERMISSIONS, parent_advocate_id=self.root_a.id)
        self.root_b = make_advocate(permissions=ALL_PERMISSIONS)
        self.accountant_b = make_advocate(permissions=('FIRM_WIDE_SCOPE', 'INVOICE_VIEW'))
        self.unknown = make_advocate(permissions=ALL_PERMISSIONS)
        self.client_a = Client.objects.create(name='A client', deleted=False, advocate_id=self.junior_a.id)
        self.case_a = Case.objects.create(case_number='A/1', case_title='A', status='Active', deleted=False,
                                          advocate_id=self.junior_a.id, client=self.client_a)
        self.case_b = Case.objects.create(case_number='B/1', case_title='B', status='Active', deleted=False,
                                          advocate_id=self.root_b.id,
                                          client=Client.objects.create(name='B client', deleted=False,
                                                                       advocate_id=self.root_b.id))
        self.case_u = Case.objects.create(case_number='U/1', case_title='U', status='Active', deleted=False,
                                          advocate_id=self.unknown.id,
                                          client=Client.objects.create(name='U client', deleted=False,
                                                                       advocate_id=self.unknown.id))
        fd, self.mapping = tempfile.mkstemp(suffix='.json')
        os.close(fd)
        self.addCleanup(os.remove, self.mapping)
        with open(self.mapping, 'w') as fh:
            json.dump({'firms': [
                {'key': 'a', 'name': 'Firm A', 'slug': 'firm-a', 'roots': [self.root_a.id]},
                {'key': 'b', 'name': 'Firm B', 'slug': 'firm-b', 'roots': [self.root_b.id, self.accountant_b.id]}],
                'unresolved': [self.unknown.id]}, fh)

    def run_cmd(self, *args, **kw):
        from io import StringIO
        out = StringIO()
        try:
            call_command(*args, stdout=out, **kw)
            return 0, out.getvalue()
        except SystemExit as exc:
            return exc.code, out.getvalue()

    def test_plan_is_read_only_and_reports_unresolved(self):
        code, out = self.run_cmd('plan_tenancy', mapping=self.mapping)
        self.assertEqual(code, 0, out)
        self.assertIn(str(self.unknown.id), out)
        self.assertEqual(Firm.objects.count(), 0)
        self.assertEqual(FirmMembership.objects.count(), 0)

    def test_unlisted_identity_is_a_problem_not_a_guess(self):
        make_advocate()                                # not in the mapping at all
        code, out = self.run_cmd('plan_tenancy', mapping=self.mapping)
        self.assertEqual(code, 1)
        self.assertIn('neither mapped nor declared', out)

    def test_apply_then_verify(self):
        self.run_cmd('apply_tenancy', mapping=self.mapping, yes=True)
        a, b = Firm.objects.get(slug='firm-a'), Firm.objects.get(slug='firm-b')
        # Pre-SaaS practices get an explicit Legacy subscription (documented backfill path).
        from subscriptions.models import FirmSubscription
        self.assertEqual(sorted(FirmSubscription.objects.filter(firm__in=[a, b]).values_list('plan__code', 'status')),
                         [('LEGACY', 'ACTIVE'), ('LEGACY', 'ACTIVE')])
        self.case_a.refresh_from_db()
        self.case_b.refresh_from_db()
        self.case_u.refresh_from_db()
        self.assertEqual(self.case_a.firm_id, a.id)            # junior's row -> their root's firm
        self.assertEqual(self.case_b.firm_id, b.id)
        self.assertIsNone(self.case_u.firm_id)                 # unresolved stays unowned
        self.assertTrue(FirmMembership.objects.filter(firm=b, advocate_id=self.accountant_b.id).exists())
        self.assertFalse(FirmMembership.objects.filter(advocate_id=self.unknown.id).exists())
        code, out = self.run_cmd('verify_tenancy')
        self.assertEqual(code, 0, out)
        # Re-running changes nothing.
        self.run_cmd('apply_tenancy', mapping=self.mapping, yes=True)
        self.assertEqual(Firm.objects.count(), 2)

    def test_verify_catches_a_misattributed_row(self):
        self.run_cmd('apply_tenancy', mapping=self.mapping, yes=True)
        Case.objects.filter(id=self.case_a.id).update(firm_id=Firm.objects.get(slug='firm-b').id)
        code, out = self.run_cmd('verify_tenancy')
        self.assertEqual(code, 1)
        self.assertIn("differs from their creator's firm", out)

    def test_apply_refuses_the_live_database(self):
        from django.core.management.base import CommandError
        from django.conf import settings
        db = dict(settings.DATABASES['default'], NAME='PactPro_db')
        with mock.patch.dict(settings.DATABASES, {'default': db}):
            with self.assertRaises(CommandError):
                call_command('apply_tenancy', mapping=self.mapping, yes=True)


class SuggestMappingTests(TestCase):
    def test_draft_groups_shared_gstin_and_leaves_empty_practices_unresolved(self):
        from firms.tenancy import suggest_mapping
        head = make_advocate(permissions=ALL_PERMISSIONS, gst_number='33ABCDE1234F1Z5', office_name='Kumar & Co')
        accountant = make_advocate(gst_number='33ABCDE1234F1Z5')
        idle = make_advocate()
        Case.objects.create(case_number='K/1', case_title='K', status='Active', deleted=False,
                            advocate_id=head.id,
                            client=Client.objects.create(name='K client', deleted=False, advocate_id=head.id))
        draft = suggest_mapping()
        firm = next(f for f in draft['firms'] if head.id in f['roots'])
        self.assertIn(accountant.id, firm['roots'])
        self.assertIn(idle.id, draft['unresolved'])
        self.assertEqual(Firm.objects.count(), 0)          # a draft only
