"""Seed the CASE_ALERTS permission: who is alerted about a case's hearings.

Viewing a case and being alerted about it are different things. The accountant
needs CASE_VIEW to pick a case on the invoice form, but a hearing reminder or a
cause-list listing is for the people who work the matter. CASE_ALERTS decides
that, so it can be changed per role from Role Management.

Invoice alerts are not affected: they follow INVOICE_VIEW, so the accountant
keeps getting "invoice raised - to collect" and overdue reminders.

`permissions` is a Spring-owned table (core.models.Permission is managed=False),
so new codes cannot arrive via a Django migration - hence a command. Idempotent:
safe to re-run on every deploy.
"""

from django.core.management.base import BaseCommand
from core.models import Permission, Role, RolePermission

# (name, module, description)
PERMISSIONS = [
    ('CASE_ALERTS', 'NOTIFICATIONS',
     'Receive hearing, cause-list and case payment alerts'),
]

# The case workers. Accountant and Receptionist are deliberately left out.
DEFAULT_ROLES = ['Super Admin', 'Senior Advocate', 'Junior Advocate', 'Intern']


class Command(BaseCommand):
    help = 'Create the CASE_ALERTS permission and grant it to the case-working roles.'

    def handle(self, *args, **options):
        created = []
        for name, module, description in PERMISSIONS:
            perm, made = Permission.objects.get_or_create(
                name=name, defaults={'module': module, 'description': description})
            if made:
                created.append(name)
            self.stdout.write(f"  permission {name}: {'created' if made else 'already present'}")

        granted = 0
        for role_name in DEFAULT_ROLES:
            role = Role.objects.filter(name=role_name).first()
            if role is None:
                self.stdout.write(self.style.WARNING(f"  role {role_name!r} not found - skipped"))
                continue
            for name, _, _ in PERMISSIONS:
                perm = Permission.objects.get(name=name)
                _, made = RolePermission.objects.get_or_create(role_id=role.id, permission_id=perm.id)
                if made:
                    granted += 1
                    self.stdout.write(f"  granted {name} to {role_name}")

        self.stdout.write(self.style.SUCCESS(
            f"Done: {len(created)} permission(s) created, {granted} grant(s) added."))
