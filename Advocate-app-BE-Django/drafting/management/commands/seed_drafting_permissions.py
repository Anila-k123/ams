"""Create the drafting permission codes and grant them to roles (merge phase 03).

AMS's RBAC is table-driven (core.models Permission / RolePermission, both
managed=False), so this inserts rows; there is no schema change. Idempotent: codes
and grants that already exist are left alone, and nothing is revoked.

Grants (agreed chamber split):
  Super Admin, Senior Advocate : DRAFT_VIEW, DRAFT_CREATE, DRAFT_MANAGE, DRAFT_EXPORT
  Junior Advocate              : DRAFT_VIEW, DRAFT_CREATE, DRAFT_EXPORT
  Intern                       : DRAFT_VIEW, DRAFT_CREATE   (drafts on tasks; seniors approve)
  Accountant, Receptionist     : none
"""

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import Permission, Role, RolePermission

CODES = {
    'DRAFT_VIEW': 'See drafts, reference documents, templates and playbooks',
    'DRAFT_CREATE': 'Upload reference documents, create and edit drafts, run risk analysis',
    'DRAFT_MANAGE': 'Manage drafting templates and playbooks',
    'DRAFT_EXPORT': 'Download drafts as Word documents',
}
GRANTS = {
    'Super Admin': ['DRAFT_VIEW', 'DRAFT_CREATE', 'DRAFT_MANAGE', 'DRAFT_EXPORT'],
    'Senior Advocate': ['DRAFT_VIEW', 'DRAFT_CREATE', 'DRAFT_MANAGE', 'DRAFT_EXPORT'],
    'Junior Advocate': ['DRAFT_VIEW', 'DRAFT_CREATE', 'DRAFT_EXPORT'],
    'Intern': ['DRAFT_VIEW', 'DRAFT_CREATE'],
}


class Command(BaseCommand):
    help = 'Create the DRAFT_* permission codes and grant them to the chamber roles.'

    def handle(self, *args, **opts):
        now = timezone.now()
        perms = {}
        for code, description in CODES.items():
            perm, created = Permission.objects.get_or_create(
                name=code, defaults={'description': description, 'module': 'DRAFTING', 'created_at': now})
            perms[code] = perm
            self.stdout.write(f'{"created" if created else "exists "} {code}')
        for role_name, codes in GRANTS.items():
            role = Role.objects.filter(name=role_name).first()
            if role is None:
                self.stdout.write(self.style.WARNING(f'role {role_name!r} not found, skipped'))
                continue
            for code in codes:
                _, created = RolePermission.objects.get_or_create(
                    role_id=role.id, permission_id=perms[code].id, defaults={'created_at': now})
                if created:
                    self.stdout.write(f'  granted {code} -> {role_name}')
        self.stdout.write(self.style.SUCCESS('Drafting permissions in place.'))
