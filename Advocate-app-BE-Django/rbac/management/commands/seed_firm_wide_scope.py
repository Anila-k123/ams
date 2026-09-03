"""Seed the FIRM_WIDE_SCOPE permission and grant it to the firm-wide roles.

Scope in this app is per-practice: a query is limited to `advocate_id IN
practice_ids(user)`. Some roles are not team-bound, though - the Super Admin
oversees everything, and the Accountant and Receptionist are COMMON services
shared across every senior's team (one accountant does the whole firm's
invoices; one receptionist handles everyone's clients/appointments). This
permission is the single lever that widens their scope to the whole firm;
their OTHER permissions still decide what they may actually open (an accountant
with no CASE_VIEW sees every invoice but no case file).

`permissions` is a Spring-owned table (managed=False), so the code cannot arrive
via a migration - hence a command. Idempotent: safe to re-run on every deploy.
"""

from django.core.management.base import BaseCommand
from core.models import Permission, Role, RolePermission

PERMISSION = ('FIRM_WIDE_SCOPE', 'ADMIN',
              'See data across every team, not just your own practice '
              '(what you can open is still limited by your other permissions)')

# Roles that serve the whole firm rather than one senior's team.
FIRM_WIDE_ROLES = ['Super Admin', 'Accountant', 'Receptionist']


class Command(BaseCommand):
    help = ('Create FIRM_WIDE_SCOPE and grant it to Super Admin, Accountant '
            'and Receptionist.')

    def handle(self, *args, **options):
        name, module, description = PERMISSION
        perm, created = Permission.objects.get_or_create(
            name=name, defaults={'module': module, 'description': description})
        self.stdout.write(
            f"  permission {name}: {'created' if created else 'already present'}")

        granted = 0
        for role_name in FIRM_WIDE_ROLES:
            role = Role.objects.filter(name=role_name).first()
            if role is None:
                self.stdout.write(self.style.WARNING(
                    f"  role {role_name!r} not found - skipped"))
                continue
            _, made = RolePermission.objects.get_or_create(
                role_id=role.id, permission_id=perm.id)
            if made:
                granted += 1
            self.stdout.write(
                f"  {role_name}: {'granted' if made else 'already had'} {name}")

        self.stdout.write(self.style.SUCCESS(
            f"Done: permission {'created' if created else 'present'}, "
            f"{granted} new grant(s)."))
