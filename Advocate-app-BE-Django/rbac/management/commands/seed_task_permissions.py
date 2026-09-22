"""Seed the TASK_ASSIGN permission used for delegating tasks to team members.

`permissions` is a Spring-owned table (core.models.Permission is managed=False),
so new codes cannot arrive via a Django migration - hence a command. Idempotent:
safe to re-run on every deploy.

TASK_ASSIGN is POLICY, not a data gate: a senior sees the whole team's tasks
either way; this decides who may hand a task to a specific person.
"""

from django.core.management.base import BaseCommand
from core.models import Permission, Role, RolePermission

# (name, module, description)
PERMISSIONS = [
    ('TASK_ASSIGN', 'TASKS', 'Assign tasks to team members'),
]

# Roles that should hold it out of the box. Anything else is granted through the
# Role Management screen rather than hard-coded here.
DEFAULT_ROLES = ['Super Admin', 'Senior Advocate']


class Command(BaseCommand):
    help = 'Create the TASK_ASSIGN permission and grant it to Super Admin and Senior Advocate.'

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
