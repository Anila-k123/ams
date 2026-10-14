"""firm_id on the Spring-era (managed=False) business tables.

Django does not migrate unmanaged models, so the columns are added with SQL:
nullable, no default, no rewrite of existing rows - existing data and the
Spring-era constraints are untouched. Each table also gets an index on firm_id
for tenant-scoped queries. IF NOT EXISTS keeps it safe to re-run and skips a
table that is absent on a given database.

The models declare firm_id only when settings.TENANCY_COLUMNS is on, so a
database without these columns keeps working. Apply this (python manage.py
migrate firms) on a database only after a verified backup, then set
TENANCY_COLUMNS=True. Backfilling firm_id is a separate, explicit step
(manage.py apply_tenancy), never part of a migration.
"""
from django.db import migrations

TABLES = ['clients', 'cases', 'case_events', 'documents', 'expenses', 'invoices',
          'client_payments', 'audit_log', 'notification_queue', 'notifications']


def _sql(add=True):
    out = []
    for t in TABLES:
        if add:
            out.append(
                "DO $$ BEGIN IF to_regclass('public.%(t)s') IS NOT NULL THEN "
                "ALTER TABLE public.%(t)s ADD COLUMN IF NOT EXISTS firm_id bigint NULL; "
                "CREATE INDEX IF NOT EXISTS %(t)s_firm_id_idx ON public.%(t)s (firm_id); "
                "END IF; END $$;" % {'t': t})
        else:
            out.append(
                "DO $$ BEGIN IF to_regclass('public.%(t)s') IS NOT NULL THEN "
                "DROP INDEX IF EXISTS public.%(t)s_firm_id_idx; "
                "ALTER TABLE public.%(t)s DROP COLUMN IF EXISTS firm_id; "
                "END IF; END $$;" % {'t': t})
    return out


class Migration(migrations.Migration):
    dependencies = [('firms', '0002_tenancy')]

    operations = [migrations.RunSQL(sql=_sql(True), reverse_sql=_sql(False))]
