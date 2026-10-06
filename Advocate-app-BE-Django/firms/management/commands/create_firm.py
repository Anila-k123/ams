"""Create a new, separate firm: its Super Admin, and optionally its seniors.

The screens can't do the first step: Users -> Add User always puts the new
person into the creating admin's own firm (rbac.views._join_firm). This makes
the new firm's head, a Super Admin who heads their own practice and belongs
to no other firm, so they and everything they create are invisible to every
other firm. From then on the new admin can add people from Users -> Add User,
and they join *this* firm.

Seniors given here are created the same way Add User would with "Head of own
practice": each is a team of the new firm (firms.FirmTeam), so the firm's
Super Admin sees them all, but one senior never sees another's cases.

    manage.py create_firm --name "Sandbox Law Chambers" \
        --admin-name "Anitha R" --admin-email anitha@example.com \
        --senior "Ravi K <ravi@example.com>" --senior "Divya S <divya@example.com>" \
        --password Explore@2026

Safe to re-run: existing emails are skipped, not changed. Dry run without --yes.
"""

import datetime
import re

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import Advocate, AdvocateRole, Role
from core.passwords import hash_password
from firms.models import FirmTeam

_PERSON = re.compile(r'^\s*(.+?)\s*<\s*([^>\s]+@[^>\s]+)\s*>\s*$')


class Command(BaseCommand):
    help = 'Create a separate firm with its own Super Admin (and optional Senior Advocates).'

    def add_arguments(self, parser):
        parser.add_argument('--name', required=True, help='Firm name (shown on letterheads and invoices).')
        parser.add_argument('--admin-name', required=True)
        parser.add_argument('--admin-email', required=True)
        parser.add_argument('--senior', action='append', default=[],
                            help='"Full Name <email>"; repeat for each senior.')
        parser.add_argument('--password', required=True, help='Starting password for every new login (8+ chars).')
        parser.add_argument('--yes', action='store_true', help='Create them (default is a dry run).')

    def handle(self, *args, **o):
        if len(o['password']) < 8:
            raise CommandError('--password must be at least 8 characters.')
        seniors = []
        for s in o['senior']:
            m = _PERSON.match(s)
            if not m:
                raise CommandError(f'--senior must look like "Full Name <email>": {s!r}')
            seniors.append((m.group(1), m.group(2).lower()))
        roles = {n: Role.objects.filter(name=n).first() for n in ('Super Admin', 'Senior Advocate')}
        for n, r in roles.items():
            if r is None:
                raise CommandError(f'Role {n!r} not found; run the RBAC seed first.')

        admin_email = o['admin_email'].strip().lower()
        self.stdout.write(f"Firm: {o['name']}")
        self.stdout.write(f"  Super Admin    : {o['admin_name']} <{admin_email}>")
        for name, email in seniors:
            self.stdout.write(f'  Senior Advocate: {name} <{email}>')
        if not o['yes']:
            self.stdout.write(self.style.WARNING('Dry run. Re-run with --yes to create.'))
            return

        with transaction.atomic():
            admin, made = self._advocate(o['admin_name'], admin_email, o['password'],
                                         parent=None, office_name=o['name'])
            if made:
                # A head with no FirmTeam row is a firm of its own.
                FirmTeam.objects.filter(team_root_id=admin.id).delete()
            elif admin.parent_advocate_id is not None or self._in_other_firm(admin):
                raise CommandError(f'{admin_email} already belongs to another firm; use a new email.')
            self._grant(admin, roles['Super Admin'])
            self._line('Super Admin', admin, made)

            for name, email in seniors:
                adv, made = self._advocate(name, email, o['password'], parent=None, office_name=o['name'])
                if not made:
                    self.stdout.write(f'  {email}: already exists - left as it is')
                    continue
                # A team of the new firm, as Add User's "Head of own practice" does.
                FirmTeam.objects.get_or_create(team_root_id=admin.id, defaults={'firm_root_id': admin.id})
                FirmTeam.objects.update_or_create(team_root_id=adv.id, defaults={'firm_root_id': admin.id})
                self._grant(adv, roles['Senior Advocate'])
                self._line('Senior Advocate', adv, made)

        self.stdout.write(self.style.SUCCESS(
            'Done. Sign in at the usual link with these emails and the password given; '
            'ask everyone to change it under Profile -> Security.'))

    def _advocate(self, name, email, password, parent, office_name):
        existing = Advocate.objects.filter(email__iexact=email).first()
        if existing:
            return existing, False
        adv = Advocate.objects.create(
            full_name=name, email=email, password=hash_password(password),
            bar_council_id=f'TEMP-{email[:40]}', role='ADVOCATE', theme='light',
            whatsapp_enabled=False, email_notifications_enabled=True,
            browser_notifications_enabled=True, parent_advocate_id=parent,
            office_name=office_name)
        return adv, True

    @staticmethod
    def _in_other_firm(adv):
        row = FirmTeam.objects.filter(team_root_id=adv.id).first()
        return bool(row and row.firm_root_id != adv.id)

    @staticmethod
    def _grant(adv, role):
        AdvocateRole.objects.get_or_create(advocate_id=adv.id, role_id=role.id,
                                           defaults={'created_at': datetime.datetime.now()})

    def _line(self, label, adv, made):
        self.stdout.write(f"  {label:<16} {adv.full_name} <{adv.email}>: {'created' if made else 'already there'}")
