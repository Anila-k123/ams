"""Add documents.client_visible (shared in the client portal). `documents` is an
unmanaged (Spring-owned) table, so the column is added with SQL."""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('documents', '0004_document_external_ref'),
    ]

    operations = [
        migrations.RunSQL(
            sql='ALTER TABLE documents ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT false',
            reverse_sql='ALTER TABLE documents DROP COLUMN IF EXISTS client_visible',
        ),
    ]
