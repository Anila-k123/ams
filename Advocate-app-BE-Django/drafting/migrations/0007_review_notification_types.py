"""Allow the draft-review notification types in the Spring-owned notification tables.

Their CHECK constraints list the allowed `type` values (see workspace/0009), so a new type is
rejected there (and the error is swallowed in notifications.service.notify). Tests don't
reproduce these constraints (core/test_runner.py), so this only shows on a real database.

Unlike workspace/0009 this reads the types each constraint allows NOW and adds ours, so types
added since by other apps are kept. Reverse removes ours again.
"""

import re

from django.db import migrations

ADDED = ['DRAFT_REVIEW_REQUESTED', 'DRAFT_REVIEW_DONE']
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
        ('drafting', '0006_version_kind_returned'),
        ('workspace', '0009_task_notification_types'),
    ]

    operations = [migrations.RunPython(forward, backward)]
