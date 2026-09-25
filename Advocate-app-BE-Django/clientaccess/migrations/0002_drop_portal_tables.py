"""The separate client portal (portal app) was replaced by the Client role. Its
accounts were moved to Client users; drop its tables and migration records."""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('clientaccess', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(
            sql=[
                'DROP TABLE IF EXISTS portal_link',
                'DROP TABLE IF EXISTS portal_client_account',
                "DELETE FROM django_migrations WHERE app = 'portal'",
            ],
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
