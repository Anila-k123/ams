"""Delete one client and everything that belongs to them, so a demo that
builds the matter live can be run again from a clean slate.

    manage.py reset_demo_client --name Kannan --firm rajesh@kumar-associates.demo
    manage.py reset_demo_client --name Kannan --firm rajesh@kumar-associates.demo --yes

Without --yes it only reports what it would delete. With --yes it first writes
every row it removes (and a copy of every uploaded file) to
DOCUMENT_UPLOAD_DIR/demo-resets/<timestamp>/, then deletes in one transaction.

Cases are found through the client, not by number: a live court import saves
the CNR as the case number, so "O.S. No. 900/2025" is not a stable key.

Most AMS tables point at cases and clients with plain id columns and no
foreign keys (the Spring schema), so rows are found by scanning every public
table for case_id / client_id / task_id / invoice_id / document_id columns
rather than from a hand-kept list that a new table would silently escape.
The drafting schema is ordinary Django models and is removed through the ORM,
which also takes its cascades (blocks, edits, risks).
"""

import datetime
import json
import os
import shutil

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from core.models import Advocate, Client
from core.practice import practice_ids

# id-column name -> which collected id set it refers to. Scanned in this order
# (grandchildren before children before parents) so any real FK is satisfied.
_CHILD_COLUMNS = (
    ('invoice_id', 'invoices'), ('payment_id', 'payments'), ('document_id', 'documents'),
    ('task_id', 'tasks'), ('client_user_id', 'client_users'),
    ('related_case_id', 'cases'), ('case_id', 'cases'), ('client_id', 'clients'),
)
# Rows these parents own are found by the scan above; the parents go last.
# A payment can point at its invoice, so payments go first.
_PARENTS = (('client_payments', 'payments'), ('invoices', 'invoices'), ('documents', 'documents'),
            ('case_task', 'tasks'), ('client_user', 'client_users'),
            ('cases', 'cases'), ('clients', 'clients'))
_FILE_COLUMNS = ('file_path',)


def _ids(sql, params):
    with connection.cursor() as cur:
        cur.execute(sql, params)
        return [r[0] for r in cur.fetchall()]


def _public_columns():
    """{column: [tables]} for the id columns we follow, public schema only.
    Integer columns only: a text column that happens to be called case_id
    (a court-side reference, say) isn't one of ours, and comparing it to our
    ids would abort the whole delete."""
    wanted = {c for c, _ in _CHILD_COLUMNS}
    out = {}
    with connection.cursor() as cur:
        cur.execute("select table_name, column_name from information_schema.columns "
                    "where table_schema = 'public' and column_name = any(%s) "
                    "and data_type in ('bigint', 'integer', 'smallint')", [list(wanted)])
        for table, column in cur.fetchall():
            out.setdefault(column, []).append(table)
    return out


def _rows(table, where, params):
    with connection.cursor() as cur:
        cur.execute('select * from "{}" where {}'.format(table, where), params)
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


class Command(BaseCommand):
    help = 'Delete a client, their cases and everything linked to them (demo reset).'

    def add_arguments(self, parser):
        parser.add_argument('--name', required=True, help='client name, exact')
        parser.add_argument('--firm', required=True,
                            help='email of any member of the practice that owns the client')
        parser.add_argument('--yes', action='store_true', help='actually delete')

    def handle(self, *args, name, firm, yes, **opts):
        member = Advocate.objects.filter(email=firm).first()
        if member is None:
            raise CommandError('No login {}.'.format(firm))
        clients = list(Client.objects.filter(name=name, advocate_id__in=practice_ids(member)))
        if not clients:
            self.stdout.write('No client named {!r} in that practice - nothing to do.'.format(name))
            return

        ids = self._collect([c.id for c in clients])
        plan = self._plan(ids)
        drafting = self._drafting(ids)

        self.stdout.write('Client {!r}: {} case(s).'.format(name, len(ids['cases'])))
        for table, where, params in plan:
            n = len(_rows(table, where, params))
            if n:
                self.stdout.write('  {:<32} {}'.format(table, n))
        for label, qs in drafting:
            n = qs.count()
            if n:
                self.stdout.write('  {:<32} {}'.format(label, n))
        if ids['logins']:
            self.stdout.write('  {:<32} {}'.format('advocate (client logins)', len(ids['logins'])))

        if not yes:
            self.stdout.write(self.style.WARNING('Dry run. Re-run with --yes to delete.'))
            return

        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        folder = os.path.join(settings.DOCUMENT_UPLOAD_DIR, 'demo-resets', '{}-{}'.format(stamp, name))
        os.makedirs(folder, exist_ok=True)
        backup, files = {}, []
        with transaction.atomic():
            for table, where, params in plan:
                rows = _rows(table, where, params)
                if not rows:
                    continue
                backup.setdefault(table, []).extend(rows)
                files += [r[c] for r in rows for c in _FILE_COLUMNS if r.get(c)]
                with connection.cursor() as cur:
                    cur.execute('delete from "{}" where {}'.format(table, where), params)
            for label, qs in drafting:
                for obj in qs:
                    for f in obj._meta.fields:
                        value = getattr(obj, f.name, None)
                        if getattr(value, 'name', None) and hasattr(value, 'path'):
                            try:
                                files.append(value.path)
                            except Exception:                    # noqa: BLE001
                                pass
                backup[label] = [{f.attname: getattr(o, f.attname) for f in o._meta.fields} for o in qs]
                qs.delete()
            if ids['logins']:
                for table, column in (('advocate_roles', 'advocate_id'), ('advocate', 'id')):
                    where = '"{}" = any(%s)'.format(column)
                    backup.setdefault(table, []).extend(_rows(table, where, [ids['logins']]))
                    with connection.cursor() as cur:
                        cur.execute('delete from "{}" where {}'.format(table, where), [ids['logins']])
            with open(os.path.join(folder, 'rows.json'), 'w', encoding='utf-8') as fh:
                json.dump(backup, fh, default=str, indent=1)

        # Files only after the rows are gone for good: a rolled-back delete must
        # not leave documents pointing at files that no longer exist.
        removed = 0
        for path in sorted(set(files)):
            if path and os.path.isfile(path):
                shutil.copy2(path, folder)
                os.remove(path)
                removed += 1
        self.stdout.write(self.style.SUCCESS(
            'Deleted. {} file(s) removed. Backup: {}'.format(removed, folder)))

    # -- discovery --------------------------------------------------------

    def _collect(self, client_ids):
        ids = {'clients': client_ids}
        ids['cases'] = _ids('select id from cases where client_id = any(%s)', [client_ids])
        ids['tasks'] = _ids('select id from case_task where case_id = any(%s)', [ids['cases']])
        ids['invoices'] = _ids('select id from invoices where case_id = any(%s) or client_id = any(%s)',
                               [ids['cases'], client_ids])
        ids['payments'] = _ids('select id from client_payments where case_id = any(%s) or client_id = any(%s)',
                               [ids['cases'], client_ids])
        ids['documents'] = _ids('select id from documents where case_id = any(%s) or client_id = any(%s)',
                                [ids['cases'], client_ids])
        ids['client_users'] = _ids('select id from client_user where client_id = any(%s)', [client_ids])
        # A portal login is an advocate row of its own; only remove it if it
        # isn't also linked to some other client.
        logins = _ids('select advocate_id from client_user where client_id = any(%s)', [client_ids])
        shared = set(_ids('select advocate_id from client_user where advocate_id = any(%s) '
                          'and not (client_id = any(%s))', [logins, client_ids]))
        ids['logins'] = [a for a in logins if a not in shared]
        return ids

    def _plan(self, ids):
        """[(table, where, params)] children first, parents last."""
        columns = _public_columns()
        parent_tables = {t for t, _ in _PARENTS}
        plan, seen = [], set()
        for column, key in _CHILD_COLUMNS:
            if not ids[key]:
                continue
            for table in sorted(columns.get(column, [])):
                if table in parent_tables:
                    continue
                if (table, column) in seen:
                    continue
                seen.add((table, column))
                plan.append((table, '"{}" = any(%s)'.format(column), [ids[key]]))
        # Parents that point at each other (a payment on an invoice, a task
        # document) go in dependency order.
        for table, key in _PARENTS:
            if ids[key]:
                plan.append((table, 'id = any(%s)', [ids[key]]))
        return plan

    def _drafting(self, ids):
        """Drafting-side querysets (ORM, cascades included)."""
        from django.db.models import Q
        from drafting.models import Client as DrfClient, DraftSession, Project, Sample
        drf_clients = DrfClient.objects.filter(ams_client_id__in=ids['clients'])
        projects = Project.objects.filter(Q(case_id__in=ids['cases']) | Q(client__in=drf_clients))
        sessions = DraftSession.objects.filter(
            Q(project__in=projects) | Q(client__in=drf_clients) | Q(ams_task_id__in=ids['tasks']))
        samples = Sample.objects.filter(Q(project__in=projects) | Q(client__in=drf_clients))
        # Sessions before projects (a project cascades its sessions anyway, but
        # client-only and task-only sessions would otherwise survive).
        return [('drf.draft_session', sessions), ('drf.sample', samples),
                ('drf.project', projects), ('drf.client', drf_clients)]
