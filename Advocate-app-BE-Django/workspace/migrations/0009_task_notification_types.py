"""Allow the task notification types in the Spring-owned notification tables.

Their CHECK constraints list the allowed `type` values and never included
TASK_ASSIGNED, so every task-assignment notification was rejected (the error is
logged and swallowed in notifications.service.notify). This adds TASK_ASSIGNED
plus the review types. Reverse restores the original list.
"""

from django.db import migrations

ORIGINAL = ['HEARING_REMINDER', 'HEARING_SCHEDULED', 'HEARING_RESCHEDULED', 'CASE_CREATED',
            'CASE_UPDATED', 'CASE_STATUS_UPDATED', 'CASE_CLOSED', 'PAYMENT_RECEIVED', 'PAYMENT_DUE',
            'OVERDUE_PAYMENT_REMINDER', 'INVOICE_CREATED', 'INVOICE_GENERATED', 'DOCUMENT_UPLOADED',
            'CLIENT_REGISTERED', 'WELCOME', 'EXPENSE_UPDATED', 'TASK_DEADLINE_REMINDER',
            'PASSWORD_RESET', 'MANUAL_MESSAGE', 'CUSTOM']
ADDED = ['TASK_ASSIGNED', 'TASK_SUBMITTED', 'TASK_APPROVED', 'TASK_CHANGES_REQUESTED']


def _sql(types):
    allowed = ', '.join(f"'{t}'" for t in types)
    out = []
    for table in ('notification_queue', 'notification_history'):
        out.append(f"""
DO $$
DECLARE c text;
BEGIN
  IF to_regclass('{table}') IS NULL THEN RETURN; END IF;
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = '{table}'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%(type)%'
  LOOP
    EXECUTE format('ALTER TABLE {table} DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE {table} ADD CONSTRAINT {table}_type_check CHECK (type IN ({allowed}));
END $$;""")
    return out


class Migration(migrations.Migration):

    dependencies = [
        ('workspace', '0008_casetask_review'),
    ]

    operations = [
        migrations.RunSQL(sql=_sql(ORIGINAL + ADDED), reverse_sql=_sql(ORIGINAL)),
    ]
