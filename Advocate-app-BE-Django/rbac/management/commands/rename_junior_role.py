"""Rename the 'Junior Advocate' role to 'Advocate'.

The hierarchy is Super Admin > Senior Advocate > Advocate > Intern. Only the
name and description change; role ids, permissions and who holds them stay as
they are. Run on every deploy BEFORE the seed_*_permissions commands (their
grants name 'Advocate'). Safe to run more than once.

    manage.py rename_junior_role [--dry-run]

Firm-level RBAC: the system template and every firm's copy still called
'Junior Advocate' are renamed. A firm that renamed its copy to something else
keeps its own name. A firm that already has its own role called 'Advocate'
is skipped and reported (names are unique within a firm), never merged.
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import Role

OLD = 'Junior Advocate'
NEW = 'Advocate'
DESCRIPTION = 'Advocate with case management under a senior (no delete)'


class Command(BaseCommand):
    help = "Rename the 'Junior Advocate' role to 'Advocate' (system template and every firm's copy)."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Show what would change; change nothing.')

    def handle(self, *args, **opts):
        renamed, skipped = [], []
        with transaction.atomic():
            for role in Role.objects.select_for_update().filter(name=OLD).order_by('id'):
                clash = Role.objects.filter(name=NEW, firm_id=role.firm_id).exclude(id=role.id)
                where = f'firm {role.firm_id}' if role.firm_id else 'system template'
                if clash.exists():
                    skipped.append(f'role {role.id} ({where}): this scope already has an "{NEW}" role (id {clash.first().id})')
                    continue
                renamed.append(f'role {role.id} ({where})')
                if not opts['dry_run']:
                    Role.objects.filter(id=role.id).update(name=NEW, description=DESCRIPTION)
            if opts['dry_run']:
                transaction.set_rollback(True)
        verb = 'Would rename' if opts['dry_run'] else 'Renamed'
        for r in renamed:
            self.stdout.write(f'  {verb} {r}: "{OLD}" -> "{NEW}"')
        for s in skipped:
            self.stdout.write(self.style.WARNING(f'  Skipped {s}'))
        if not renamed and not skipped:
            self.stdout.write(f'No "{OLD}" role found - nothing to do.')
        else:
            self.stdout.write(self.style.SUCCESS(f'{verb} {len(renamed)} role(s); skipped {len(skipped)}.'))
