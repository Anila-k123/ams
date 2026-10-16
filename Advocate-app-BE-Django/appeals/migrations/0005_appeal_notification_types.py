"""Allow the APPEAL_POSSIBLE / APPEAL_WATCH notification types (a decided case: our client can appeal, or the
other side may; appeals/decisions.py)
in the Spring-owned notification tables' CHECK constraints. Reads the types each constraint allows now and
adds ours (as drafting/0007), so types added by other apps are kept. Reverse removes ours again.
"""

import re

from django.db import migrations

ADDED = ['APPEAL_POSSIBLE', 'APPEAL_WATCH']
TABLES = ('notification_queue', 'notification_history')


def _rewrite(schema_editor, add=(), remove=()):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cur:
        for table in TABLES:
            cur.execute('SELECT to_regclass(%s)', [table])
            if cur.fetchone()[0] is None:
                continue
            cur.execute("SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint "
                        "WHERE conrelid = %s::regclass AND contype = 'c' "
                        "AND pg_get_constraintdef(oid) LIKE '%%(type)%%'", [table])
            rows = cur.fetchall()
            if not rows:
                continue   # no constraint: nothing restricts the type
            allowed = []
            for name, definition in rows:
                allowed += re.findall(r"'([A-Z_]+)'", definition)
                cur.execute(f'ALTER TABLE {table} DROP CONSTRAINT "{name}"')
            types = [t for t in dict.fromkeys(allowed + list(add)) if t not in remove]
            in_list = ', '.join(f"'{t}'" for t in types)
            cur.execute(f'ALTER TABLE {table} ADD CONSTRAINT {table}_type_check CHECK (type IN ({in_list}))')


def forward(apps, schema_editor):
    _rewrite(schema_editor, add=ADDED)


def backward(apps, schema_editor):
    _rewrite(schema_editor, remove=ADDED)


class Migration(migrations.Migration):

    dependencies = [
        ('appeals', '0004_case_decision'),
        ('courtsearch', '0006_court_order_notification_type'),
    ]

    operations = [migrations.RunPython(forward, backward)]
