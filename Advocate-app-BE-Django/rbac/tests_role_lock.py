"""P1-10: one firm can no longer change or borrow the role rows every firm shares.

Roles are global rows (`roles`, `role_permissions`). Before this lock, a firm
admin with ROLE_MANAGE could rename "Senior Advocate" or rewrite its
permissions for every firm on the server, and assign another firm's custom
role to their own staff.
"""
import datetime

from django.test import TestCase, override_settings

from core.models import AdvocateRole, Permission, Role, RolePermission
from core.testing import auth, make_advocate


def _role(name, *codes):
    now = datetime.datetime.now()
    role = Role.objects.create(name=name, description='', created_at=now)
    for code in codes:
        perm, _ = Permission.objects.get_or_create(
            name=code, defaults={'description': code, 'module': 'TEST', 'created_at': now})
        RolePermission.objects.create(role_id=role.id, permission_id=perm.id)
    return role


def _give(advocate, role):
    AdvocateRole.objects.create(advocate_id=advocate.id, role_id=role.id,
                                created_at=datetime.datetime.now())


class RoleLockTests(TestCase):
    def setUp(self):
        admin_codes = ('ROLE_MANAGE', 'USER_MANAGE')
        self.senior = _role('Senior Advocate', 'CASE_VIEW', 'CASE_EDIT')
        # Two separate firms (two practice roots, no FirmTeam link).
        self.admin_a = make_advocate(permissions=admin_codes)
        self.staff_a = make_advocate(parent_advocate_id=self.admin_a.id)
        self.admin_b = make_advocate(permissions=admin_codes)
        self.staff_b = make_advocate(parent_advocate_id=self.admin_b.id)
        _give(self.staff_a, self.senior)
        # A custom role only firm A uses.
        self.custom_a = _role('Paralegal A', 'CASE_VIEW')
        _give(self.staff_a, self.custom_a)

    def perms(self, role):
        return sorted(RolePermission.objects.filter(role_id=role.id).values_list('permission_id', flat=True))

    def test_built_in_role_permissions_cannot_be_rewritten(self):
        before = self.perms(self.senior)
        r = self.client.put(f'/api/roles/{self.senior.id}/permissions', {'permissionIds': []},
                            content_type='application/json', **auth(self.admin_b))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.perms(self.senior), before)

    def test_built_in_role_cannot_be_renamed_or_deleted(self):
        r = self.client.put(f'/api/roles/{self.senior.id}', {'name': 'Hijacked'},
                            content_type='application/json', **auth(self.admin_b))
        self.assertEqual(r.status_code, 403)
        r = self.client.delete(f'/api/roles/{self.senior.id}', **auth(self.admin_b))
        self.assertEqual(r.status_code, 403)
        self.senior.refresh_from_db()
        self.assertEqual(self.senior.name, 'Senior Advocate')

    def test_new_roles_cannot_be_created_while_locked(self):
        r = self.client.post('/api/roles', {'name': 'Fresh role'},
                             content_type='application/json', **auth(self.admin_a))
        self.assertEqual(r.status_code, 403)
        self.assertFalse(Role.objects.filter(name='Fresh role').exists())

    def test_other_firms_custom_role_is_invisible_and_unassignable(self):
        names = [r['name'] for r in self.client.get('/api/roles', **auth(self.admin_b)).json()]
        self.assertIn('Senior Advocate', names)
        self.assertNotIn('Paralegal A', names)
        self.assertEqual(self.client.get(f'/api/roles/{self.custom_a.id}', **auth(self.admin_b)).status_code, 404)
        self.assertEqual(self.client.put(f'/api/roles/{self.custom_a.id}/permissions', {'permissionIds': []},
                                         content_type='application/json',
                                         **auth(self.admin_b)).status_code, 404)
        r = self.client.post(f'/api/admin/users/{self.staff_b.id}/roles/{self.custom_a.id}', **auth(self.admin_b))
        self.assertEqual(r.status_code, 400)
        r = self.client.put(f'/api/admin/users/{self.staff_b.id}/roles', {'roleIds': [self.custom_a.id]},
                            content_type='application/json', **auth(self.admin_b))
        self.assertEqual(r.status_code, 400)
        self.assertFalse(AdvocateRole.objects.filter(advocate_id=self.staff_b.id, role_id=self.custom_a.id).exists())

    def test_own_custom_role_stays_editable(self):
        roles = {r['name']: r for r in self.client.get('/api/roles', **auth(self.admin_a)).json()}
        self.assertTrue(roles['Paralegal A']['editable'])
        self.assertFalse(roles['Senior Advocate']['editable'])
        r = self.client.put(f'/api/roles/{self.custom_a.id}', {'description': 'Clerks'},
                            content_type='application/json', **auth(self.admin_a))
        self.assertEqual(r.status_code, 200)

    def test_built_in_roles_remain_assignable(self):
        r = self.client.post(f'/api/admin/users/{self.staff_b.id}/roles/{self.senior.id}', **auth(self.admin_b))
        self.assertEqual(r.status_code, 200)

    def test_existing_assignments_survive_a_role_list_update(self):
        r = self.client.put(f'/api/admin/users/{self.staff_a.id}/roles',
                            {'roleIds': [self.senior.id, self.custom_a.id]},
                            content_type='application/json', **auth(self.admin_a))
        self.assertEqual(r.status_code, 200)

    @override_settings(ROLE_EDITING_LOCKED=False)
    def test_lock_can_be_lifted_on_single_firm_installs(self):
        r = self.client.put(f'/api/roles/{self.senior.id}', {'description': 'ok'},
                            content_type='application/json', **auth(self.admin_a))
        self.assertEqual(r.status_code, 200)
