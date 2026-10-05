"""Remove the Receptionist role and the accounts that hold it.

The firm no longer has a front desk: advocates register their own clients
(Advocates are granted CLIENT_CREATE / CLIENT_EDIT here; Seniors
already have them) and book meetings on their cases.

    manage.py remove_receptionist_role          # dry run: lists what would change
    manage.py remove_receptionist_role --yes    # apply (backup first)

In one transaction:
1. Advocate gets CLIENT_CREATE and CLIENT_EDIT.
2. Work the receptionists created (clients, events, ...) is handed to each
   account's practice owner, so it stays visible to the firm. Found by
   scanning every table's advocate/creator columns, not from a fixed list.
3. The audit trail (audit_log) is kept as it is. The dashboard activity feed
   (activities), role links and queued notifications for the account are
   removed: activities has a foreign key to the account, so its rows can't
   outlive it, and moving them to the owner would misstate who did what.
   The audit trail still records everything; the backup keeps the rest.
4. The accounts are deleted, then the role and its permission links.
An account with no practice owner that still owns work rows is NOT deleted
(the rows would be orphaned); it is reported for a person to decide.
Safe to re-run: with nothing left to do it changes nothing.
"""

import datetime
import json
import os

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection, transaction

ROLE = 'Receptionist'
JUNIOR = 'Advocate'
JUNIOR_GRANTS = ('CLIENT_CREATE', 'CLIENT_EDIT')

# Columns that say "this row belongs to / was made by advocate N".
OWNER_COLUMNS = ('advocate_id', 'created_by_id', 'uploaded_by_id', 'assigned_to_id',
                 'assigned_by_id', 'reviewed_by_id', 'submitted_by_id')
# The audit trail: kept unchanged (it must survive the user's removal; it has
# no foreign key to the account).
KEEP = {'audit_log'}
# Rows that only make sense for the account itself: deleted. activities (the
# live feed) has a foreign key to the account, so it can't be kept.
DROP = {'advocate_roles', 'notification_queue', 'activities'}


def _one(sql, params=None):
    with connection.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        return row[0] if row else None


def _all(sql, params=None):
    with connection.cursor() as cur:
        cur.execute(sql, params)
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def _owner_columns():
    """[(schema, table, column)] integer owner-style columns, both schemas."""
    with connection.cursor() as cur:
        cur.execute("select table_schema, table_name, column_name from information_schema.columns "
                    "where table_schema in ('public', 'drf') and column_name = any(%s) "
                    "and data_type in ('bigint', 'integer')", [list(OWNER_COLUMNS)])
        return [r for r in cur.fetchall() if r[1] != 'advocate']


class Command(BaseCommand):
    help = 'Remove the Receptionist role and its accounts; advocates take over client intake.'

    def add_arguments(self, parser):
        parser.add_argument('--yes', action='store_true', help='apply the changes')

    def handle(self, *args, yes, **opts):
        role_id = _one('select id from roles where name = %s', [ROLE])
        junior_id = _one('select id from roles where name = %s', [JUNIOR])
        accounts = _all('select a.id, a.full_name, a.email, a.parent_advocate_id from advocate a '
                        'join advocate_roles ar on ar.advocate_id = a.id where ar.role_id = %s',
                        [role_id]) if role_id else []

        # 1. Junior grants still missing.
        missing = []
        if junior_id:
            for code in JUNIOR_GRANTS:
                has = _one('select 1 from role_permissions rp join permissions p on p.id = rp.permission_id '
                           'where rp.role_id = %s and p.name = %s', [junior_id, code])
                if not has:
                    missing.append(code)

        # 2-3. What each account owns.
        plan = []                     # (account, schema, table, column, n, action)
        blocked = set()
        for acc in accounts:
            for sch, table, col in _owner_columns():
                n = _one('select count(*) from {}."{}" where "{}" = %s'.format(sch, table, col), [acc['id']])
                if not n:
                    continue
                if table in KEEP:
                    action = 'keep'
                elif table in DROP:
                    action = 'delete'
                elif acc['parent_advocate_id']:
                    action = 'hand over'
                else:
                    action = 'BLOCKED'
                    blocked.add(acc['id'])
                plan.append((acc, sch, table, col, n, action))

        self.stdout.write('Receptionist role: {}'.format('found' if role_id else 'not found'))
        self.stdout.write('Advocate grants to add: {}'.format(', '.join(missing) or 'none'))
        for acc in accounts:
            to = acc['parent_advocate_id']
            self.stdout.write('Account {} {} <{}>{}'.format(
                acc['id'], acc['full_name'].strip(), acc['email'],
                ' - hand over to advocate {}'.format(to) if to else ' - no practice owner'))
            for a, sch, table, col, n, action in plan:
                if a is acc:
                    self.stdout.write('    {:<10} {}.{}.{} : {}'.format(action, sch, table, col, n))
        for acc_id in blocked:
            self.stdout.write(self.style.WARNING(
                '  Account {} owns work rows but has no practice owner: it will NOT be deleted. '
                'Reassign them, then run again.'.format(acc_id)))
        if not role_id and not missing:
            self.stdout.write('Nothing to do.')
            return
        if not yes:
            self.stdout.write(self.style.WARNING('Dry run. Re-run with --yes to apply.'))
            return

        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        folder = os.path.join(settings.DOCUMENT_UPLOAD_DIR, 'role-removals', stamp)
        os.makedirs(folder, exist_ok=True)
        backup = {'accounts': accounts, 'changes': []}

        with transaction.atomic(), connection.cursor() as cur:
            for code in missing:
                cur.execute('select id from permissions where name = %s', [code])
                perm = cur.fetchone()
                if perm:
                    cur.execute('insert into role_permissions (role_id, permission_id, created_at) '
                                'values (%s, %s, %s)', [junior_id, perm[0], datetime.datetime.now()])
            for acc, sch, table, col, n, action in plan:
                where = '"{}" = %s'.format(col)
                rows = _all('select * from {}."{}" where {}'.format(sch, table, where), [acc['id']])
                backup['changes'].append({'table': '{}.{}'.format(sch, table), 'column': col,
                                          'action': action, 'rows': rows})
                if action == 'hand over':
                    cur.execute('update {}."{}" set "{}" = %s where {}'.format(sch, table, col, where),
                                [acc['parent_advocate_id'], acc['id']])
                elif action == 'delete':
                    cur.execute('delete from {}."{}" where {}'.format(sch, table, where), [acc['id']])
            for acc in accounts:
                if acc['id'] in blocked:
                    continue
                backup.setdefault('advocate_rows', []).extend(
                    _all('select * from advocate where id = %s', [acc['id']]))
                cur.execute('delete from advocate where id = %s', [acc['id']])
            if role_id:
                remaining = _one('select count(*) from advocate_roles where role_id = %s', [role_id])
                if remaining:
                    self.stdout.write(self.style.WARNING(
                        'Role kept: {} account(s) still hold it (blocked above).'.format(remaining)))
                else:
                    backup['role_permissions'] = _all('select * from role_permissions where role_id = %s',
                                                      [role_id])
                    cur.execute('delete from role_permissions where role_id = %s', [role_id])
                    cur.execute('delete from roles where id = %s', [role_id])
            with open(os.path.join(folder, 'rows.json'), 'w', encoding='utf-8') as fh:
                json.dump(backup, fh, default=str, indent=1)
        self.stdout.write(self.style.SUCCESS('Done. Backup: {}'.format(folder)))
