"""Firm-level RBAC columns on the Spring-era roles / advocate_roles tables.

roles: firm_id (NULL = global template), is_template, cloned_from_id, is_admin,
disabled. advocate_roles: firm_id, membership_id. All additive and nullable /
defaulted; no existing row is rewritten except marking the existing roles as
templates (is_template = true), which is what they are.

Role names stop being globally unique (each firm has its own "Senior
Advocate"): the global UNIQUE(name) constraint is replaced by a unique index on
(COALESCE(firm_id, 0), lower(name)) - unique per firm, and among templates.
Reverse puts UNIQUE(name) back; it fails if firm copies with duplicate names
exist, so remove those first (that is deliberate: it never deletes roles).

Cloning templates into firms and re-pointing assignments is data, done by
`manage.py apply_firm_roles`, not by this migration.
"""
from django.db import migrations

FORWARD = [
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS firm_id bigint NULL",
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false",
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS cloned_from_id bigint NULL",
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false",
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false",
    "CREATE INDEX IF NOT EXISTS roles_firm_id_idx ON roles (firm_id)",
    "UPDATE roles SET is_template = true WHERE firm_id IS NULL",
    # Replace the global UNIQUE(name), whatever Spring named it.
    """DO $$ DECLARE c text; BEGIN
         FOR c IN SELECT conname FROM pg_constraint
                  WHERE conrelid = 'roles'::regclass AND contype = 'u'
                    AND pg_get_constraintdef(oid) = 'UNIQUE (name)' LOOP
           EXECUTE format('ALTER TABLE roles DROP CONSTRAINT %I', c);
         END LOOP; END $$""",
    "CREATE UNIQUE INDEX IF NOT EXISTS roles_firm_name_uniq ON roles ((COALESCE(firm_id, 0)), lower(name))",
    "ALTER TABLE advocate_roles ADD COLUMN IF NOT EXISTS firm_id bigint NULL",
    "ALTER TABLE advocate_roles ADD COLUMN IF NOT EXISTS membership_id bigint NULL",
    "CREATE INDEX IF NOT EXISTS advocate_roles_firm_id_idx ON advocate_roles (firm_id)",
]
REVERSE = [
    "DROP INDEX IF EXISTS advocate_roles_firm_id_idx",
    "ALTER TABLE advocate_roles DROP COLUMN IF EXISTS membership_id",
    "ALTER TABLE advocate_roles DROP COLUMN IF EXISTS firm_id",
    "DROP INDEX IF EXISTS roles_firm_name_uniq",
    "ALTER TABLE roles ADD CONSTRAINT roles_name_key UNIQUE (name)",
    "DROP INDEX IF EXISTS roles_firm_id_idx",
    "ALTER TABLE roles DROP COLUMN IF EXISTS disabled",
    "ALTER TABLE roles DROP COLUMN IF EXISTS is_admin",
    "ALTER TABLE roles DROP COLUMN IF EXISTS cloned_from_id",
    "ALTER TABLE roles DROP COLUMN IF EXISTS is_template",
    "ALTER TABLE roles DROP COLUMN IF EXISTS firm_id",
]


class Migration(migrations.Migration):
    dependencies = [('firms', '0003_core_tenant_columns')]
    operations = [migrations.RunSQL(sql=FORWARD, reverse_sql=REVERSE)]
