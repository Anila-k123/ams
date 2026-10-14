"""Invoice numbers are unique per firm, not across the whole server.

`invoices` is a Spring-era table (unmanaged), so this is raw SQL:

1. add  invoices_firm_number_uniq    UNIQUE (firm_id, invoice_number)
2. add  invoices_legacy_number_uniq  UNIQUE (invoice_number) WHERE firm_id IS NULL
   (rows without a firm keep the old server-wide rule)
3. drop the Spring constraint UNIQUE (invoice_number), which made two firms'
   "INV-000001" collide.

No row is changed or renumbered. Steps 1-2 are created before 3 is dropped,
so there is no moment without a uniqueness rule. Skipped (with a notice) on a
database whose `invoices` table has no firm_id yet (TENANCY_COLUMNS off).
Reverse: restores the server-wide constraint (fails, untouched, if two firms
have meanwhile issued the same number).
"""
from django.db import migrations

FORWARD = """
DO $$
DECLARE
    con text;
BEGIN
    IF to_regclass('public.invoices') IS NULL THEN
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'firm_id') THEN
        RAISE NOTICE 'invoices.firm_id missing: per-firm invoice numbers not enabled yet';
        RETURN;
    END IF;
    CREATE UNIQUE INDEX IF NOT EXISTS invoices_firm_number_uniq ON invoices (firm_id, invoice_number);
    CREATE UNIQUE INDEX IF NOT EXISTS invoices_legacy_number_uniq ON invoices (invoice_number)
        WHERE firm_id IS NULL;
    FOR con IN
        SELECT c.conname FROM pg_constraint c
        WHERE c.conrelid = 'public.invoices'::regclass AND c.contype = 'u'
          AND pg_get_constraintdef(c.oid) = 'UNIQUE (invoice_number)'
    LOOP
        EXECUTE format('ALTER TABLE invoices DROP CONSTRAINT %I', con);
    END LOOP;
END $$;
"""

REVERSE = """
DO $$
BEGIN
    IF to_regclass('public.invoices') IS NULL THEN
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.invoices'::regclass
                   AND c.contype = 'u' AND pg_get_constraintdef(c.oid) = 'UNIQUE (invoice_number)') THEN
        ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);
    END IF;
    DROP INDEX IF EXISTS invoices_legacy_number_uniq;
    DROP INDEX IF EXISTS invoices_firm_number_uniq;
END $$;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('invoices', '0009_sequence_and_payment_keys'),
    ]

    operations = [migrations.RunSQL(FORWARD, REVERSE)]
