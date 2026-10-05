"""Rename the 'Junior Advocate' role to 'Advocate'.

The hierarchy is Super Admin > Senior Advocate > Advocate > Intern. Only the
name and description change; the role id, its permissions and who holds it
stay as they are. Safe to run more than once.

    manage.py rename_junior_role
"""
from django.core.management.base import BaseCommand
from django.db import connection, transaction

OLD = 'Junior Advocate'
NEW = 'Advocate'
DESCRIPTION = 'Advocate with case management under a senior (no delete)'


class Command(BaseCommand):
    help = "Rename the 'Junior Advocate' role to 'Advocate'."

    def handle(self, *args, **options):
        with transaction.atomic(), connection.cursor() as cur:
            cur.execute('select id from roles where name = %s', [NEW])
            if cur.fetchone():
                self.stdout.write("Role '{}' already exists - nothing to do.".format(NEW))
                return
            cur.execute('update roles set name = %s, description = %s where name = %s',
                        [NEW, DESCRIPTION, OLD])
            if cur.rowcount:
                self.stdout.write(self.style.SUCCESS("Renamed '{}' to '{}'.".format(OLD, NEW)))
            else:
                self.stdout.write("No '{}' role found.".format(OLD))
