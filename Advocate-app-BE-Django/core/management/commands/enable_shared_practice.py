"""Add the practice-membership column, and manage who is in whose practice.

    manage.py enable_shared_practice                      # show the layout
    manage.py enable_shared_practice --add 4 --to 1        # 4 joins 1's practice
    manage.py enable_shared_practice --remove 4            # 4 goes solo again

`advocate` is a Spring-owned table with managed = False, so there is no Django
migration for it - the same reason seed_admin_permissions exists. The DDL here
is idempotent and additive: one NULLABLE column with no default, which older
code and any remaining Spring entities simply never mention.

Nothing is shared until somebody is added to a practice. On a database where
every advocate has parent_advocate_id NULL, every query resolves to exactly
the single-advocate scope that was there before.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from core.models import Advocate
from core import practice

COLUMN = 'parent_advocate_id'
LEFT_COLUMN = 'left_on'


def column_exists(name=COLUMN):
    with connection.cursor() as cur:
        cur.execute("""SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'advocate' AND column_name = %s""",
                    [name])
        return cur.fetchone() is not None


class Command(BaseCommand):
    help = 'Create the practice column and link advocates into practices.'

    def add_arguments(self, parser):
        parser.add_argument('--add', type=int, help='Advocate id to add to a practice.')
        parser.add_argument('--to', type=int, help='Practice owner advocate id.')
        parser.add_argument('--remove', type=int,
                            help='Advocate id who has left the practice (keeps their work).')
        parser.add_argument('--reinstate', type=int,
                            help='Advocate id to bring back into the practice.')

    def handle(self, *args, **o):
        self._ensure_column()

        if o['add'] is not None:
            if o['to'] is None:
                raise CommandError('--add needs --to <owner advocate id>')
            self._add(o['add'], o['to'])
        elif o['remove'] is not None:
            self._remove(o['remove'])
        elif o['reinstate'] is not None:
            self._reinstate(o['reinstate'])

        self._report()

    # -- schema ------------------------------------------------------------

    def _ensure_column(self):
        self._ensure_left_column()
        if column_exists():
            self.stdout.write('Column advocate.{} already present.'.format(COLUMN))
            return
        with connection.cursor() as cur:
            # Nullable, no default, plus a self-referencing FK so a practice
            # cannot point at an advocate who does not exist. ON DELETE SET
            # NULL: removing an owner must not delete their members.
            cur.execute('ALTER TABLE advocate ADD COLUMN {} BIGINT NULL'.format(COLUMN))
            cur.execute('ALTER TABLE advocate ADD CONSTRAINT advocate_parent_fk '
                        'FOREIGN KEY ({}) REFERENCES advocate(id) ON DELETE SET NULL'
                        .format(COLUMN))
            cur.execute('CREATE INDEX advocate_parent_idx ON advocate ({})'.format(COLUMN))
        self.stdout.write(self.style.SUCCESS(
            'Added advocate.{} (nullable, FK, indexed).'.format(COLUMN)))

    def _ensure_left_column(self):
        """advocate.left_on - when a member left, NULL while active."""
        if column_exists(LEFT_COLUMN):
            return
        with connection.cursor() as cur:
            cur.execute('ALTER TABLE advocate ADD COLUMN {} DATE NULL'
                        .format(LEFT_COLUMN))
        self.stdout.write(self.style.SUCCESS(
            'Added advocate.{} (nullable).'.format(LEFT_COLUMN)))

    # -- membership --------------------------------------------------------

    def _add(self, member_id, owner_id):
        member = Advocate.objects.filter(id=member_id).first()
        owner = Advocate.objects.filter(id=owner_id).first()
        if member is None:
            raise CommandError('No advocate with id {}'.format(member_id))
        if owner is None:
            raise CommandError('No advocate with id {}'.format(owner_id))
        if member_id == owner_id:
            raise CommandError('An advocate cannot be a member of their own practice.')
        # One level only: an owner with members cannot itself become a member,
        # or their members would silently lose their practice.
        if Advocate.objects.filter(parent_advocate_id=member_id).exists():
            raise CommandError(
                'Advocate {} already owns a practice with members. Practices are '
                'one level deep; move its members first.'.format(member_id))
        if owner.parent_advocate_id is not None:
            raise CommandError(
                'Advocate {} is itself a member of practice {}. Add to the owner '
                '({}) instead.'.format(owner_id, owner.parent_advocate_id,
                                       owner.parent_advocate_id))
        Advocate.objects.filter(id=member_id).update(parent_advocate_id=owner_id)
        self.stdout.write(self.style.SUCCESS(
            '{} now shares the practice owned by {}.'.format(member.email, owner.email)))

    def _remove(self, member_id):
        """Mark a member as having left, keeping their work with the practice.

        This used to clear parent_advocate_id. Visibility is derived from who is
        in the practice, so that made every row the member had created
        unreachable - the chambers lost its own case files because a junior
        moved on, while the rows sat in the database untouched.

        So the membership stays and the account is closed instead: the practice
        keeps the work, and the person keeps no access.
        """
        member = Advocate.objects.filter(id=member_id).first()
        if member is None:
            raise CommandError('No advocate with id {}'.format(member_id))
        if member.parent_advocate_id is None:
            raise CommandError(
                'Advocate {} is not a member of any practice. Nothing to leave.'
                .format(member_id))
        practice.mark_left(member)
        self.stdout.write(self.style.SUCCESS(
            '{} has left the practice. Their account can no longer sign in; the '
            'cases, clients and invoices they created stay with the practice.'
            .format(member.email)))

    def _reinstate(self, member_id):
        member = Advocate.objects.filter(id=member_id).first()
        if member is None:
            raise CommandError('No advocate with id {}'.format(member_id))
        practice.reinstate(member)
        self.stdout.write(self.style.SUCCESS(
            '{} is active again.'.format(member.email)))

    # -- reporting ---------------------------------------------------------

    def _report(self):
        from core.models import Case, Client
        self.stdout.write('')
        self.stdout.write('Practices:')
        owners = Advocate.objects.filter(parent_advocate_id__isnull=True).order_by('id')
        for owner in owners:
            team = list(Advocate.objects.filter(parent_advocate_id=owner.id).order_by('id'))
            reach = practice.practice_ids(owner)
            self.stdout.write('  {} (id {}){}'.format(
                owner.email, owner.id, '' if team else '   [solo]'))
            for m in team:
                self.stdout.write('      member: {} (id {})'.format(m.email, m.id))
            if team:
                self.stdout.write('      shared reach: {} clients, {} cases'.format(
                    Client.objects.filter(advocate_id__in=reach).count(),
                    Case.objects.filter(advocate_id__in=reach).count()))
