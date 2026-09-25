"""Add documents.external_ref. `documents` is an unmanaged (Spring-owned) table,
so the column is added with SQL rather than a model operation."""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('documents', '0003_documentversion_note'),
    ]

    operations = [
        migrations.RunSQL(
            sql=[
                'ALTER TABLE documents ADD COLUMN IF NOT EXISTS external_ref varchar(255) NULL',
                'CREATE INDEX IF NOT EXISTS documents_external_ref_idx ON documents (external_ref)',
            ],
            reverse_sql=[
                'DROP INDEX IF EXISTS documents_external_ref_idx',
                'ALTER TABLE documents DROP COLUMN IF EXISTS external_ref',
            ],
        ),
    ]
