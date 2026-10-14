"""Give every firm its own roles and move its members' assignments onto them.

    manage.py apply_firm_roles --yes [--allow-database PactPro_db]

For each firm: clone every system template into firm-owned roles (idempotent),
re-point the firm's members' template assignments at the copies, stamp
firm_id / membership_id. Templates, old roles and permissions are never deleted.
Identities without a membership (unresolved) keep their assignments untouched.

Safety: one transaction; effective permissions of every member are computed
before and after (as firm mode will see them) and the run is ROLLED BACK if any
member would gain or lose a permission. Without --yes it only reports.
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import AdvocateRole, Permission, Role, RolePermission

PROTECTED_DATABASES = {'pactpro_db'}


class _Rollback(Exception):
    pass


def _perm_names(role_ids):
    ids = RolePermission.objects.filter(role_id__in=list(role_ids)).values_list('permission_id', flat=True)
    return set(Permission.objects.filter(id__in=list(ids)).values_list('name', flat=True))


def _snapshot(member_firm, firm_only):
    """advocate_id -> permission names. firm_only: count only roles owned by the
    member's firm (what firm mode will use), plus the global Client role."""
    out = {}
    for adv, fid in member_firm.items():
        role_ids = list(AdvocateRole.objects.filter(advocate_id=adv).values_list('role_id', flat=True))
        if firm_only:
            role_ids = [r.id for r in Role.objects.filter(id__in=role_ids, disabled=False)
                        if r.firm_id == fid or (r.firm_id is None and r.name.lower() == 'client')]
        out[adv] = _perm_names(role_ids)
    return out


class Command(BaseCommand):
    help = 'Clone system role templates into each firm and re-point assignments.'

    def add_arguments(self, parser):
        parser.add_argument('--yes', action='store_true')
        parser.add_argument('--allow-database', default='')

    def handle(self, *args, **opts):
        name = settings.DATABASES['default']['NAME']
        if name.lower() in PROTECTED_DATABASES and opts['allow_database'] != name:
            raise CommandError(f'Refusing to run on {name} without --allow-database {name} '
                               '(needs approval and a verified backup).')
        if not settings.TENANCY_COLUMNS:
            raise CommandError('TENANCY_COLUMNS is off: apply the tenancy migrations first.')
        from firms.models import Firm, FirmMembership
        from rbac import firm_roles

        member_firm = dict(FirmMembership.objects.values_list('advocate_id', 'firm_id'))
        before = _snapshot(member_firm, firm_only=False)
        try:
            with transaction.atomic():
                cloned = moved = 0
                for firm in Firm.objects.order_by('id'):
                    existing = firm_roles.firm_roles(firm).count()
                    clones = firm_roles.provision_default_roles(firm)
                    cloned += firm_roles.firm_roles(firm).count() - existing
                    moved += firm_roles.repoint_assignments(firm, {t: r for t, r in clones.items()})
                after = _snapshot(member_firm, firm_only=True)
                diffs = {a: (sorted(after[a] - before[a]), sorted(before[a] - after[a]))
                         for a in member_firm if after[a] != before[a]}
                for adv, (gained, lost) in sorted(diffs.items()):
                    self.stdout.write(self.style.ERROR(f'identity {adv}: would gain {gained} lose {lost}'))
                self.stdout.write(f'roles cloned: {cloned}; assignments re-pointed: {moved}; '
                                  f'members checked: {len(member_firm)}; permission differences: {len(diffs)}')
                if diffs:
                    raise _Rollback('effective permissions would change')
                if not opts['yes']:
                    raise _Rollback('dry run')
        except _Rollback as why:
            self.stdout.write(self.style.WARNING(f'Rolled back ({why}). Nothing changed.'))
            if str(why) != 'dry run':
                raise SystemExit(1)
            return
        self.stdout.write(self.style.SUCCESS('Firm roles applied; every member keeps exactly the same permissions.'))
