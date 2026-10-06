"""create_firm makes a firm that no other firm can see into."""

from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from core import practice
from core.models import Advocate, Role
from core.testing import make_advocate, make_case


class CreateFirmTest(TestCase):
    def setUp(self):
        for n in ('Super Admin', 'Senior Advocate'):
            Role.objects.create(name=n, description=n)
        self.other_senior = make_advocate(email='rajesh@other.test')
        self.other_case = make_case(self.other_senior)

    def _run(self, *extra):
        call_command('create_firm', '--name', 'Sandbox Chambers', '--admin-name', 'Anitha R',
                     '--admin-email', 'anitha@sandbox.test', '--password', 'Explore@2026',
                     '--senior', 'Ravi K <ravi@sandbox.test>', '--senior', 'Divya S <divya@sandbox.test>',
                     *extra, stdout=StringIO())

    def test_dry_run_creates_nothing(self):
        self._run()
        self.assertFalse(Advocate.objects.filter(email='anitha@sandbox.test').exists())

    def test_new_firm_is_separate(self):
        self._run('--yes')
        admin = Advocate.objects.get(email='anitha@sandbox.test')
        ravi = Advocate.objects.get(email='ravi@sandbox.test')
        divya = Advocate.objects.get(email='divya@sandbox.test')
        self.assertEqual(admin.role_names(), ['Super Admin'])
        self.assertEqual(ravi.role_names(), ['Senior Advocate'])
        # Same firm, separate teams; nothing shared with the other firm.
        self.assertEqual(practice.firm_root(ravi), admin.id)
        self.assertTrue(practice.same_firm(ravi, divya))
        self.assertFalse(practice.same_firm(admin, self.other_senior))
        self.assertNotIn(self.other_senior.id, practice.practice_ids(ravi))
        self.assertNotIn(ravi.id, practice.practice_ids(divya))

    def test_rerun_changes_nothing(self):
        self._run('--yes')
        self._run('--yes')
        self.assertEqual(Advocate.objects.filter(email__endswith='@sandbox.test').count(), 3)


class UserManagementIsPerFirmTest(TestCase):
    """An admin manages their own firm's accounts only."""

    def setUp(self):
        from core.testing import grant
        for n in ('Super Admin', 'Senior Advocate'):
            Role.objects.create(name=n, description=n)
        # Firm A: an existing practice with its admin.
        self.a_head = make_advocate(email='head@a.test')
        self.a_admin = make_advocate(email='admin@a.test', parent_advocate_id=self.a_head.id,
                                     permissions=('USER_MANAGE',))
        # Firm B: made by create_firm.
        call_command('create_firm', '--name', 'B', '--admin-name', 'B Admin', '--admin-email', 'admin@b.test',
                     '--senior', 'B Senior <senior@b.test>', '--password', 'Explore@2026', '--yes',
                     stdout=StringIO())
        self.b_admin = Advocate.objects.get(email='admin@b.test')
        grant(self.b_admin, ('USER_MANAGE',))
        self.b_senior = Advocate.objects.get(email='senior@b.test')

    def _emails(self, admin):
        from core.testing import auth
        return {u['email'] for u in self.client.get('/api/admin/users', **auth(admin)).json()}

    def test_list_is_own_firm_only(self):
        self.assertEqual(self._emails(self.b_admin), {'admin@b.test', 'senior@b.test'})
        self.assertEqual(self._emails(self.a_admin), {'head@a.test', 'admin@a.test'})

    def test_cannot_touch_another_firms_user(self):
        from core.testing import auth
        h = auth(self.b_admin)
        url = '/api/admin/users/{}'.format(self.a_head.id)
        self.assertEqual(self.client.get(url, **h).status_code, 404)
        self.assertEqual(self.client.put(url, {'fullName': 'Hacked'}, content_type='application/json',
                                         **h).status_code, 404)
        self.assertEqual(self.client.delete(url, **h).status_code, 404)
        self.assertEqual(self.client.put(url + '/roles', {'roleIds': []}, content_type='application/json',
                                         **h).status_code, 404)
        self.assertEqual(Advocate.objects.get(id=self.a_head.id).full_name != 'Hacked', True)
        # Its own senior is fine.
        self.assertEqual(self.client.get('/api/admin/users/{}'.format(self.b_senior.id), **h).status_code, 200)
