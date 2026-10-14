"""Deploy-time permission seeds reach every firm's copy of a system role.

They used to look roles up by name with .first(): with firm-level RBAC every
firm has its own "Super Admin", so only one arbitrary row got INVOICE_ISSUE and
no firm administrator could issue an invoice (found by the Phase 9 browser run).
"""
import io

from django.core.management import call_command
from django.test import TestCase

from core.models import Permission, Role, RolePermission
from firms.models import Firm


def _codes(role):
    return set(Permission.objects.filter(
        id__in=RolePermission.objects.filter(role_id=role.id).values('permission_id')).values_list('name', flat=True))


class SeedTests(TestCase):
    def setUp(self):
        self.a = Firm.objects.create(name='A', slug='seed-a', status=Firm.ACTIVE)
        self.b = Firm.objects.create(name='B', slug='seed-b', status=Firm.ACTIVE)
        self.tpl_admin = Role.objects.create(name='Super Admin', is_template=True)
        self.tpl_senior = Role.objects.create(name='Senior Advocate', is_template=True)
        self.admin_a = Role.objects.create(name='Super Admin', firm_id=self.a.id, cloned_from_id=self.tpl_admin.id,
                                           is_admin=True)
        # Firm B renamed its copy; it is still the administrator role.
        self.admin_b = Role.objects.create(name='Managing Partner', firm_id=self.b.id,
                                           cloned_from_id=self.tpl_admin.id, is_admin=True)
        self.senior_a = Role.objects.create(name='Senior Advocate', firm_id=self.a.id,
                                            cloned_from_id=self.tpl_senior.id)
        pay = Permission.objects.create(name='PAYMENT_CREATE', module='PAYMENTS', description='x')
        RolePermission.objects.create(role_id=self.senior_a.id, permission_id=pay.id)
        RolePermission.objects.create(role_id=self.tpl_senior.id, permission_id=pay.id)

    def test_every_firms_copy_is_granted_and_firm_copies_keep_their_choices(self):
        call_command('seed_invoice_permissions', stdout=io.StringIO())
        for role in (self.tpl_admin, self.admin_a, self.admin_b):
            self.assertIn('INVOICE_ISSUE', _codes(role), role.name)
        # Revocations change the system template (new firms) only; firm A's own
        # Senior Advocate role is the firm's decision and is left alone.
        self.assertNotIn('PAYMENT_CREATE', _codes(self.tpl_senior))
        self.assertIn('PAYMENT_CREATE', _codes(self.senior_a))

    def test_seeding_twice_changes_nothing_more(self):
        call_command('seed_invoice_permissions', stdout=io.StringIO())
        before = RolePermission.objects.count()
        call_command('seed_invoice_permissions', stdout=io.StringIO())
        self.assertEqual(RolePermission.objects.count(), before)


class AlertSeedTests(TestCase):
    def test_junior_advocates_keep_hearing_alerts(self):
        from core.practice import case_alert_permission
        firm = Firm.objects.create(name='J', slug='seed-j', status=Firm.ACTIVE)
        tpl = Role.objects.create(name='Advocate', is_template=True)
        mine = Role.objects.create(name='Advocate', firm_id=firm.id, cloned_from_id=tpl.id)
        acct = Role.objects.create(name='Accountant', is_template=True)
        call_command('seed_alert_permissions', stdout=io.StringIO())
        self.assertEqual(case_alert_permission(), 'CASE_ALERTS')
        self.assertIn('CASE_ALERTS', _codes(tpl))
        self.assertIn('CASE_ALERTS', _codes(mine))
        self.assertNotIn('CASE_ALERTS', _codes(acct))      # accountants: invoices, not hearings


class RenameJuniorRoleTests(TestCase):
    def test_template_and_firm_copies_are_renamed_custom_names_kept(self):
        a = Firm.objects.create(name='RA', slug='rename-a', status=Firm.ACTIVE)
        b = Firm.objects.create(name='RB', slug='rename-b', status=Firm.ACTIVE)
        c = Firm.objects.create(name='RC', slug='rename-c', status=Firm.ACTIVE)
        tpl = Role.objects.create(name='Junior Advocate', is_template=True)
        copy_a = Role.objects.create(name='Junior Advocate', firm_id=a.id, cloned_from_id=tpl.id)
        custom_b = Role.objects.create(name='Associate', firm_id=b.id, cloned_from_id=tpl.id)
        clash_c = Role.objects.create(name='Junior Advocate', firm_id=c.id, cloned_from_id=tpl.id)
        Role.objects.create(name='Advocate', firm_id=c.id)               # firm C already has its own
        call_command('rename_junior_role', '--dry-run', stdout=io.StringIO())
        self.assertEqual(Role.objects.get(id=tpl.id).name, 'Junior Advocate')   # dry run changes nothing
        call_command('rename_junior_role', stdout=io.StringIO())
        names = {r.id: r.name for r in Role.objects.filter(id__in=[tpl.id, copy_a.id, custom_b.id, clash_c.id])}
        self.assertEqual(names, {tpl.id: 'Advocate', copy_a.id: 'Advocate', custom_b.id: 'Associate',
                                 clash_c.id: 'Junior Advocate'})
        call_command('rename_junior_role', stdout=io.StringIO())              # idempotent
        self.assertEqual(Role.objects.filter(name='Advocate', firm_id__isnull=True).count(), 1)
