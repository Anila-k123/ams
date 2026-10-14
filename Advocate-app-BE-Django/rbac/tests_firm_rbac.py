"""Phase 3: firm-level RBAC. Three firms, each with its own copies of the
system role templates; firm mode enforced."""
import datetime
import json
from io import StringIO

from django.core.management import call_command
from django.test import TestCase, override_settings

from core.models import AdvocateRole, AuditLog, Case, Client, Permission, Role, RolePermission
from core.testing import auth, make_advocate
from firms.models import Firm, FirmMembership
from rbac import firm_roles as fr

NOW = datetime.datetime.now
ALL = ['CASE_VIEW', 'CASE_EDIT', 'CASE_CREATE', 'CLIENT_VIEW', 'INVOICE_VIEW', 'ROLE_MANAGE',
       'USER_MANAGE', 'FIRM_WIDE_SCOPE', 'BACKUP_MANAGE', 'SETTINGS_EDIT', 'AUDIT_VIEW', 'INVOICE_ISSUE']
TEMPLATES = {
    'Super Admin': ALL,
    'Senior Advocate': ['CASE_VIEW', 'CASE_EDIT', 'CASE_CREATE', 'CLIENT_VIEW', 'INVOICE_VIEW'],
    'Advocate': ['CASE_VIEW', 'CLIENT_VIEW'],
    'Accountant': ['INVOICE_VIEW', 'FIRM_WIDE_SCOPE', 'INVOICE_ISSUE'],
    'Receptionist': ['CLIENT_VIEW'],
}


def perm(code):
    return Permission.objects.get_or_create(name=code, defaults={'description': code, 'module': 'T',
                                                                 'created_at': NOW()})[0]


def make_templates():
    out = {}
    for name, codes in TEMPLATES.items():
        r = Role.objects.create(name=name, description=name, created_at=NOW(), is_template=True)
        for c in codes:
            RolePermission.objects.create(role_id=r.id, permission_id=perm(c).id)
        out[name] = r
    out['Client'] = Role.objects.create(name='Client', created_at=NOW(), is_template=True)
    return out


def codes_of(role):
    return fr.role_permission_names(role.id)


@override_settings(TENANCY_MODE='firm')
class FirmRbacTests(TestCase):
    def setUp(self):
        self.templates = make_templates()
        self.f, self.roles = {}, {}
        for key in 'ABC':
            self.f[key] = Firm.objects.create(name=key, slug=key.lower(), status=Firm.ACTIVE)
            self.roles[key] = {r.name: r for r in fr.provision_default_roles(self.f[key]).values()}
        self.admin_a = self.member('A', 'Super Admin')
        self.senior_a = self.member('A', 'Senior Advocate')
        self.junior_a = self.member('A', 'Advocate', parent=self.senior_a)
        self.admin_b = self.member('B', 'Super Admin')
        self.senior_b = self.member('B', 'Senior Advocate')
        self.admin_c = self.member('C', 'Super Admin')

    def member(self, key, *role_names, parent=None):
        adv = make_advocate(parent_advocate_id=parent.id if parent else None)
        m = FirmMembership.objects.create(firm=self.f[key], advocate_id=adv.id, status=FirmMembership.ACTIVE,
                                          joined_at=NOW())
        for n in role_names:
            AdvocateRole.objects.create(advocate_id=adv.id, role_id=self.roles[key][n].id,
                                        firm_id=self.f[key].id, membership_id=m.id)
        return adv

    def put(self, url, body, who):
        return self.client.put(url, data=json.dumps(body), content_type='application/json', **auth(who))

    def post(self, url, body, who):
        return self.client.post(url, data=json.dumps(body), content_type='application/json', **auth(who))

    # ---- roles per firm ----------------------------------------------------
    def test_every_firm_gets_its_own_default_roles_with_the_same_names(self):
        for key in 'ABC':
            names = {r['name'] for r in self.client.get('/api/roles', **auth(getattr(self, f'admin_{key.lower()}'))).json()}
            self.assertEqual(names, set(TEMPLATES))
        ids = {self.roles[k]['Senior Advocate'].id for k in 'ABC'}
        self.assertEqual(len(ids), 3)
        self.assertTrue(self.roles['A']['Super Admin'].is_admin)

    def test_provisioning_is_idempotent(self):
        before = Role.objects.count()
        fr.provision_default_roles(self.f['A'])
        self.assertEqual(Role.objects.count(), before)

    def test_firm_creates_edits_clones_and_deletes_its_roles(self):
        r = self.post('/api/roles', {'name': 'Paralegal', 'permissionIds': [perm('CASE_VIEW').id]}, self.admin_a)
        self.assertEqual(r.status_code, 201, r.content)
        rid = r.json()['id']
        self.assertEqual(Role.objects.get(id=rid).firm_id, self.f['A'].id)
        self.assertEqual(self.put(f'/api/roles/{rid}', {'description': 'Clerks'}, self.admin_a).status_code, 200)
        # Same name in another firm is fine; twice in one firm is not.
        self.assertEqual(self.post('/api/roles', {'name': 'Paralegal'}, self.admin_b).status_code, 201)
        self.assertEqual(self.post('/api/roles', {'name': 'paralegal'}, self.admin_a).status_code, 409)
        c = self.post(f'/api/roles/{self.templates["Advocate"].id}/clone', {'name': 'Trainee'}, self.admin_a)
        self.assertEqual(c.status_code, 201, c.content)
        self.assertEqual(codes_of(Role.objects.get(id=c.json()['id'])), set(TEMPLATES['Advocate']))
        self.assertEqual(self.client.delete(f'/api/roles/{rid}', **auth(self.admin_a)).status_code, 200)
        self.assertFalse(Role.objects.filter(id=rid).exists())

    def test_role_in_use_or_admin_role_cannot_be_deleted(self):
        self.assertEqual(self.client.delete(f'/api/roles/{self.roles["A"]["Senior Advocate"].id}',
                                            **auth(self.admin_a)).status_code, 409)
        self.assertEqual(self.client.delete(f'/api/roles/{self.roles["A"]["Super Admin"].id}',
                                            **auth(self.admin_a)).status_code, 409)
        self.assertEqual(self.put(f'/api/roles/{self.roles["A"]["Super Admin"].id}', {'disabled': True},
                                  self.admin_a).status_code, 409)

    # ---- isolation -------------------------------------------------------------
    def test_another_firms_roles_are_invisible_and_untouchable(self):
        rb = self.roles['B']['Senior Advocate']
        self.assertNotIn(rb.id, {r['id'] for r in self.client.get('/api/roles', **auth(self.admin_a)).json()})
        for method, url, body in (('get', f'/api/roles/{rb.id}', None),
                                  ('put', f'/api/roles/{rb.id}', {'name': 'x'}),
                                  ('delete', f'/api/roles/{rb.id}', None),
                                  ('get', f'/api/roles/{rb.id}/permissions', None),
                                  ('put', f'/api/roles/{rb.id}/permissions', {'permissionIds': []}),
                                  ('get', f'/api/roles/{rb.id}/members', None),
                                  ('post', f'/api/roles/{rb.id}/clone', {'name': 'Stolen'})):
            if body is None:
                r = getattr(self.client, method)(url, **auth(self.admin_a))
            else:
                r = getattr(self.client, method)(url, data=json.dumps(body), content_type='application/json',
                                                 **auth(self.admin_a))
            self.assertEqual(r.status_code, 404, f'{method} {url}')
        self.assertEqual(codes_of(rb), set(TEMPLATES['Senior Advocate']))

    def test_another_firms_role_cannot_be_assigned(self):
        rb = self.roles['B']['Advocate']
        r = self.client.post(f'/api/admin/users/{self.senior_a.id}/roles/{rb.id}', **auth(self.admin_a))
        self.assertIn(r.status_code, (400, 404))
        r = self.put(f'/api/admin/users/{self.senior_a.id}/roles', {'roleIds': [rb.id]}, self.admin_a)
        self.assertIn(r.status_code, (400, 404))
        r = self.client.post(f'/api/admin/users/{self.senior_b.id}/roles/{self.roles["A"]["Advocate"].id}',
                             **auth(self.admin_a))
        self.assertEqual(r.status_code, 404)        # B's user is not in A's firm
        self.assertFalse(AdvocateRole.objects.filter(role_id=rb.id, advocate_id=self.senior_a.id).exists())

    def test_system_templates_are_immutable(self):
        t = self.templates['Senior Advocate']
        self.assertEqual(self.put(f'/api/roles/{t.id}', {'name': 'x'}, self.admin_a).status_code, 403)
        self.assertEqual(self.put(f'/api/roles/{t.id}/permissions', {'permissionIds': []}, self.admin_a).status_code, 403)
        self.assertEqual(self.client.delete(f'/api/roles/{t.id}', **auth(self.admin_a)).status_code, 403)
        self.assertEqual(codes_of(t), set(TEMPLATES['Senior Advocate']))
        # Templates are readable, for cloning.
        self.assertEqual(self.client.get('/api/roles?templates=1', **auth(self.admin_a)).status_code, 200)

    def test_customising_one_firms_role_leaves_others_and_template_alone(self):
        ra = self.roles['A']['Senior Advocate']
        keep = [perm('CASE_VIEW').id]
        self.assertEqual(self.put(f'/api/roles/{ra.id}/permissions', {'permissionIds': keep}, self.admin_a).status_code, 200)
        self.assertEqual(codes_of(ra), {'CASE_VIEW'})
        self.assertEqual(codes_of(self.roles['B']['Senior Advocate']), set(TEMPLATES['Senior Advocate']))
        self.assertEqual(codes_of(self.templates['Senior Advocate']), set(TEMPLATES['Senior Advocate']))
        self.assertTrue(AuditLog.objects.filter(module='RBAC', firm_id=self.f['A'].id, entity_id=ra.id).exists())

    # ---- effective permissions ---------------------------------------------------
    def test_permissions_combine_only_within_the_active_firm(self):
        user = self.member('A', 'Advocate', 'Receptionist')
        self.assertEqual(user.permission_codes(), {'CASE_VIEW', 'CLIENT_VIEW'})
        # A template or another firm's role assigned directly grants nothing.
        AdvocateRole.objects.create(advocate_id=user.id, role_id=self.templates['Super Admin'].id)
        AdvocateRole.objects.create(advocate_id=user.id, role_id=self.roles['B']['Super Admin'].id)
        self.assertEqual(user.permission_codes(), {'CASE_VIEW', 'CLIENT_VIEW'})

    def test_disabled_role_grants_nothing(self):
        r = self.roles['A']['Senior Advocate']
        self.assertEqual(self.put(f'/api/roles/{r.id}', {'disabled': True}, self.admin_a).status_code, 200)
        self.assertEqual(self.senior_a.permission_codes(), set())

    def test_role_removal_takes_effect_on_the_next_request(self):
        Case.objects.create(case_number='A/1', case_title='A', status='Active', deleted=False,
                            advocate_id=self.senior_a.id,
                            client=Client.objects.create(name='c', deleted=False, advocate_id=self.senior_a.id))
        self.assertEqual(self.client.get('/api/cases', **auth(self.senior_a)).status_code, 200)
        self.assertEqual(self.client.delete(
            f'/api/admin/users/{self.senior_a.id}/roles/{self.roles["A"]["Senior Advocate"].id}',
            **auth(self.admin_a)).status_code, 200)
        self.assertEqual(self.client.get('/api/cases', **auth(self.senior_a)).status_code, 403)

    # ---- escalation ----------------------------------------------------------------
    def test_non_admin_role_manager_cannot_grant_high_risk_or_unheld_permissions(self):
        mgr_role = self.post('/api/roles', {'name': 'Role Manager', 'permissionIds': [
            perm('ROLE_MANAGE').id, perm('USER_MANAGE').id, perm('CASE_VIEW').id]}, self.admin_a).json()
        mgr = self.member('A')
        self.post(f'/api/admin/users/{mgr.id}/roles/{mgr_role["id"]}', {}, self.admin_a)
        self.assertIn('ROLE_MANAGE', mgr.permission_codes())
        junior_role = self.roles['A']['Advocate']
        r = self.put(f'/api/roles/{junior_role.id}/permissions',
                     {'permissionIds': [perm('CASE_VIEW').id, perm('FIRM_WIDE_SCOPE').id]}, mgr)
        self.assertEqual(r.status_code, 403)
        r = self.put(f'/api/roles/{junior_role.id}/permissions',
                     {'permissionIds': [perm('CASE_VIEW').id, perm('INVOICE_VIEW').id]}, mgr)
        self.assertEqual(r.status_code, 403)          # does not hold INVOICE_VIEW
        r = self.client.post(f'/api/admin/users/{mgr.id}/roles/{self.roles["A"]["Super Admin"].id}', **auth(mgr))
        self.assertEqual(r.status_code, 403)          # cannot make themselves admin
        self.assertFalse(fr.is_firm_admin(mgr, self.f['A']))

    def test_junior_cannot_change_roles_or_escalate(self):
        r = self.put(f'/api/roles/{self.roles["A"]["Advocate"].id}/permissions',
                     {'permissionIds': [perm(c).id for c in ALL]}, self.junior_a)
        self.assertEqual(r.status_code, 403)
        r = self.client.post(f'/api/admin/users/{self.junior_a.id}/roles/{self.roles["A"]["Super Admin"].id}',
                             **auth(self.junior_a))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.junior_a.permission_codes(), set(TEMPLATES['Advocate']))

    def test_admin_role_keeps_its_core_permissions(self):
        r = self.put(f'/api/roles/{self.roles["A"]["Super Admin"].id}/permissions',
                     {'permissionIds': [perm('CASE_VIEW').id]}, self.admin_a)
        self.assertEqual(r.status_code, 409)

    # ---- last administrator ------------------------------------------------------------
    def test_last_admin_cannot_be_removed_or_demote_themselves(self):
        admin_role = self.roles['A']['Super Admin']
        r = self.client.delete(f'/api/admin/users/{self.admin_a.id}/roles/{admin_role.id}', **auth(self.admin_a))
        self.assertEqual(r.status_code, 409)
        r = self.put(f'/api/admin/users/{self.admin_a.id}/roles', {'roleIds': []}, self.admin_a)
        self.assertEqual(r.status_code, 409)
        self.assertTrue(fr.is_firm_admin(self.admin_a, self.f['A']))
        # With a second administrator it is allowed.
        second = self.member('A', 'Super Admin')
        r = self.client.delete(f'/api/admin/users/{self.admin_a.id}/roles/{admin_role.id}', **auth(second))
        self.assertEqual(r.status_code, 200)

    def test_last_admin_account_cannot_be_closed(self):
        other = self.member('A', 'Senior Advocate', 'Super Admin')
        AdvocateRole.objects.filter(advocate_id=other.id, role_id=self.roles['A']['Super Admin'].id).delete()
        r = self.client.delete(f'/api/admin/users/{self.admin_a.id}', **auth(self.admin_a))
        self.assertIn(r.status_code, (400, 409))     # own account, and last admin

    # ---- firm and membership state ----------------------------------------------------------
    def test_suspended_firm_and_left_membership_have_no_permissions(self):
        Firm.objects.filter(id=self.f['B'].id).update(status=Firm.SUSPENDED)
        self.assertEqual(self.client.get('/api/roles', **auth(self.admin_b)).status_code, 401)
        FirmMembership.objects.filter(advocate_id=self.admin_c.id).update(status=FirmMembership.LEFT)
        self.assertEqual(self.client.get('/api/roles', **auth(self.admin_c)).status_code, 401)
        self.assertEqual(self.admin_c.permission_codes(), set())

    def test_firm_wide_scope_never_leaves_the_firm(self):
        from core.practice import practice_ids
        ids = set(practice_ids(self.admin_a))
        self.assertTrue({self.senior_a.id, self.junior_a.id} <= ids)
        self.assertFalse({self.admin_b.id, self.senior_b.id, self.admin_c.id} & ids)
        # A junior still sees only their team.
        self.assertNotIn(self.admin_a.id, set(practice_ids(self.junior_a)) - {self.senior_a.id, self.junior_a.id})

    def test_role_names_alone_grant_nothing(self):
        fake = Role.objects.create(name='Super Admin ', firm_id=self.f['A'].id, is_admin=False)
        u = self.member('A')
        AdvocateRole.objects.create(advocate_id=u.id, role_id=fake.id, firm_id=self.f['A'].id)
        self.assertFalse(fr.is_firm_admin(u, self.f['A']))
        from core.practice import has_firm_wide_scope
        self.assertFalse(has_firm_wide_scope(u))


class LegacyModeRolesTests(TestCase):
    """Legacy mode keeps the Phase 1 interim lock on shared roles."""

    def test_lock_still_applies_in_legacy_mode(self):
        make_templates()
        admin = make_advocate(permissions=('ROLE_MANAGE', 'USER_MANAGE'))
        t = Role.objects.get(name='Senior Advocate')
        r = self.client.put(f'/api/roles/{t.id}/permissions', data=json.dumps({'permissionIds': []}),
                            content_type='application/json', **auth(admin))
        self.assertEqual(r.status_code, 403)


class ApplyFirmRolesTests(TestCase):
    """The data migration keeps every member's effective permissions."""

    def setUp(self):
        self.templates = make_templates()
        self.firm = Firm.objects.create(name='A', slug='a', status=Firm.ACTIVE)
        self.firm2 = Firm.objects.create(name='B', slug='b', status=Firm.ACTIVE)
        self.people = {}
        for name, firm in (('Super Admin', self.firm), ('Senior Advocate', self.firm),
                           ('Accountant', self.firm2), ('Advocate', None)):
            adv = make_advocate()
            AdvocateRole.objects.create(advocate_id=adv.id, role_id=self.templates[name].id)
            if firm:
                FirmMembership.objects.create(firm=firm, advocate_id=adv.id, status=FirmMembership.ACTIVE)
            self.people[name] = adv

    def test_preserves_permissions_and_leaves_unresolved_alone(self):
        before = {n: set(a.permission_codes()) for n, a in self.people.items()}
        out = StringIO()
        call_command('apply_firm_roles', yes=True, stdout=out)
        self.assertIn('permission differences: 0', out.getvalue())
        with override_settings(TENANCY_MODE='firm'):
            for n in ('Super Admin', 'Senior Advocate', 'Accountant'):
                self.assertEqual(self.people[n].permission_codes(), before[n], n)
        role = Role.objects.get(id=AdvocateRole.objects.get(advocate_id=self.people['Super Admin'].id).role_id)
        self.assertEqual((role.firm_id, role.is_admin, role.cloned_from_id),
                         (self.firm.id, True, self.templates['Super Admin'].id))
        untouched = AdvocateRole.objects.get(advocate_id=self.people['Advocate'].id)
        self.assertEqual(untouched.role_id, self.templates['Advocate'].id)
        # Templates and permissions are never deleted; re-running changes nothing.
        self.assertEqual(Role.objects.filter(is_template=True).count(), len(self.templates))
        n = Role.objects.count()
        call_command('apply_firm_roles', yes=True, stdout=StringIO())
        self.assertEqual(Role.objects.count(), n)

    def test_dry_run_changes_nothing(self):
        n = Role.objects.count()
        call_command('apply_firm_roles', stdout=StringIO())
        self.assertEqual(Role.objects.count(), n)
