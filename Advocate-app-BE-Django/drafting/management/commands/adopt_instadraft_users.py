"""Hand InstaDraft's drafting data over to AMS advocates (merge phase 02).

In InstaDraft's database (the `drafting` connection) the owner columns
(sample.uploaded_by_id, draft_session / draft_edit / playbook.created_by_id) hold
*InstaDraft* user ids, with foreign keys to its accounts_user table. The merged app
stores AMS advocate ids there instead (drafting/models.py). This command:

  1. maps each InstaDraft user to their AMS advocate (accounts_user.ams_advocate_id,
     set when they first signed in from AMS); users with no AMS link go to
     --fallback-advocate;
  2. checks every target advocate exists in AMS;
  3. writes a JSON backup of every value it will change;
  4. in one transaction, drops the foreign keys to accounts_user and rewrites the ids.

The foreign keys being gone is also the "already done" marker, so a second run cannot
remap the ids again. Use --dry-run first.
"""

import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction

from core.models import Advocate

OWNER_COLUMNS = [('sample', 'uploaded_by_id'), ('draft_session', 'created_by_id'),
                 ('draft_edit', 'created_by_id'), ('playbook', 'created_by_id')]


class Command(BaseCommand):
    help = "Remap InstaDraft user ids in the drafting database to AMS advocate ids."

    def add_arguments(self, parser):
        parser.add_argument('--fallback-advocate', type=int, required=True,
                            help='AMS advocate id that takes over rows of InstaDraft users with no AMS link.')
        parser.add_argument('--backup', default=str(Path(settings.BASE_DIR) / 'adopt_instadraft_backup.json'))
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, fallback_advocate, backup, dry_run, **opts):
        conn = connections['drafting']
        with conn.cursor() as c:
            c.execute("""
                select tc.table_name, tc.constraint_name
                from information_schema.table_constraints tc
                join information_schema.constraint_column_usage ccu on tc.constraint_name = ccu.constraint_name
                where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'drf'
                  and ccu.table_name = 'accounts_user'""")
            fks = c.fetchall()
            if not fks:
                self.stdout.write('Already adopted (no foreign keys to accounts_user left). Nothing to do.')
                return
            c.execute('select id, email, ams_advocate_id from accounts_user')
            users = c.fetchall()

        mapping = {uid: (aid or fallback_advocate) for uid, _, aid in users}
        wanted = set(mapping.values())
        found = set(Advocate.objects.filter(id__in=wanted).values_list('id', flat=True))
        if wanted - found:
            raise CommandError(f'AMS advocate(s) not found: {sorted(wanted - found)}')
        for uid, email, aid in users:
            how = 'AMS link' if aid else 'fallback'
            self.stdout.write(f'  InstaDraft user {uid} ({email}) -> AMS advocate {mapping[uid]} [{how}]')

        changes = []
        with conn.cursor() as c:
            for table, col in OWNER_COLUMNS:
                c.execute(f'select id, {col} from drf.{table} where {col} is not null')
                for row_id, old in c.fetchall():
                    new = mapping.get(old, fallback_advocate)
                    changes.append({'table': table, 'column': col, 'id': row_id, 'old': old, 'new': new})
        by_table = {}
        for ch in changes:
            by_table[ch['table']] = by_table.get(ch['table'], 0) + 1
        self.stdout.write(f'Rows to update: {by_table}; foreign keys to drop: {[n for _, n in fks]}')
        if dry_run:
            self.stdout.write('Dry run: nothing changed.')
            return

        Path(backup).write_text(json.dumps({'users': users, 'changes': changes, 'dropped_fks': fks}, indent=1))
        self.stdout.write(f'Backup written to {backup}')
        with transaction.atomic(using='drafting'), conn.cursor() as c:
            for table, name in fks:
                c.execute(f'ALTER TABLE drf.{table} DROP CONSTRAINT {name}')
            for ch in changes:
                c.execute(f'UPDATE drf.{ch["table"]} SET {ch["column"]} = %s WHERE id = %s', [ch['new'], ch['id']])
        self.stdout.write(self.style.SUCCESS(f'Adopted: {len(changes)} rows now point at AMS advocates.'))
