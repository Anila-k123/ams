"""Seed the admin permission codes that the audit and backup pages need.

`permissions` is a Spring-owned table (core.models.Permission is
managed=False), so new codes cannot arrive via a Django migration - hence a
command. It is idempotent: safe to re-run on every deploy.

Both features are already scoped to the requesting advocate, so these codes
are about POLICY (should an Intern be able to restore a backup?) rather than
about closing a data leak.
"""

from django.core.management.base import BaseCommand
from core.models import Permission, Role, RolePermission

# (name, module, description)
PERMISSIONS = [
    ('AUDIT_VIEW', 'ADMIN', 'View the audit log and activity history'),
    ('BACKUP_MANAGE', 'ADMIN', 'Create, download, restore and delete backups'),
]

# Roles that should hold them out of the box. Anything else is granted through
# the Role Management screen rather than hard-coded here.
DEFAULT_ROLES = ['Super Admin']


class Command(BaseCommand):
    help = 'Create the AUDIT_VIEW / BACKUP_MANAGE permissions and grant them to Super Admin.'

    def handle(self, *args, **options):
        created_perms = []
        for name, module, description in PERMISSIONS:
            perm, created = Permission.objects.get_or_create(
                name=name, defaults={'module': module, 'description': description})
            if created:
                created_perms.append(name)
            self.stdout.write(f"  permission {name}: {'created' if created else 'already present'}")

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
            f"Done: {len(created_perms)} permission(s) created, {granted} grant(s) added."))
