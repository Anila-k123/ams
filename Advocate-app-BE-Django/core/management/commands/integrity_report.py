"""Read-only database integrity report (Phase 9).

    manage.py integrity_report            # prints findings; exit code 1 if any ERROR

Runs in a READ ONLY transaction, so it cannot change anything. Covers what
verify_tenancy (firm ownership / cross-firm references, which it also runs)
does not: orphaned references in the Spring-era tables (which have few real
foreign keys), role assignments to roles of another firm or disabled roles,
duplicate invoice numbers within a firm, payment links to missing rows,
document rows whose file is missing, document versions, audit rows without a
firm, permissions gated in code but missing from the catalogue, and pending
migrations. It prints counts and ids only - never names or contents.
"""
import io
import re
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


def _q(sql, params=()):
    with connection.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else []


class Command(BaseCommand):
    help = 'Read-only integrity checks of this database (counts and ids only).'

    def handle(self, *args, **opts):
        _q('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
        self.errors, self.warnings, self.ok = [], [], []
        self.stdout.write(f'Database: {connection.settings_dict["NAME"]}')

        # 1. Orphaned references (column -> table that must hold the id).
        refs = [('cases', 'client_id', 'clients'), ('cases', 'advocate_id', 'advocate'),
                ('case_events', 'case_id', 'cases'), ('documents', 'case_id', 'cases'),
                ('documents', 'client_id', 'clients'), ('invoices', 'case_id', 'cases'),
                ('invoices', 'client_id', 'clients'), ('client_payments', 'case_id', 'cases'),
                ('expenses', 'case_id', 'cases'), ('advocate_roles', 'role_id', 'roles'),
                ('advocate_roles', 'advocate_id', 'advocate'), ('role_permissions', 'role_id', 'roles'),
                ('role_permissions', 'permission_id', 'permissions'), ('payment_invoice', 'invoice_id', 'invoices'),
                ('payment_invoice', 'payment_id', 'client_payments'), ('invoice_items', 'invoice_id', 'invoices'),
                ('firm_membership', 'advocate_id', 'advocate'), ('document_version', 'document_id', 'documents')]
        for table, col, target in refs:
            if not self._exists(table) or not self._exists(target):
                continue
            n = _q(f'SELECT count(*) FROM "{table}" t WHERE t."{col}" IS NOT NULL '
                   f'AND NOT EXISTS (SELECT 1 FROM "{target}" x WHERE x.id = t."{col}")')[0][0]
            (self.errors if n else self.ok).append(f'orphans {table}.{col} -> {target}: {n}')

        # 2. Role assignments: a member holding another firm's role, or a disabled one.
        if self._column('roles', 'firm_id'):
            n = _q("""SELECT count(*) FROM advocate_roles ar JOIN roles r ON r.id = ar.role_id
                      JOIN firm_membership m ON m.advocate_id = ar.advocate_id AND m.status = 'ACTIVE'
                      WHERE r.firm_id IS NOT NULL AND r.firm_id <> m.firm_id""")[0][0]
            (self.errors if n else self.ok).append(f'role assignments to another firm\'s role: {n}')
            n = _q("""SELECT count(*) FROM advocate_roles ar JOIN roles r ON r.id = ar.role_id
                      WHERE r.firm_id IS NULL AND r.is_template AND r.name <> 'Client'""")[0][0]
            (self.warnings if n else self.ok).append(f'members holding a system template role directly: {n}')
            n = _q("""SELECT count(*) FROM advocate_roles ar JOIN roles r ON r.id = ar.role_id WHERE r.disabled""")[0][0]
            self.ok.append(f'assignments to disabled roles (inactive, by design): {n}')
            n = _q("""SELECT count(*) FROM firm f WHERE f.status = 'ACTIVE' AND NOT EXISTS (
                      SELECT 1 FROM firm_membership m JOIN advocate_roles ar ON ar.advocate_id = m.advocate_id
                      JOIN roles r ON r.id = ar.role_id AND r.is_admin AND r.firm_id = f.id
                      WHERE m.firm_id = f.id AND m.status = 'ACTIVE')""" if self._exists("firm") else
                   'SELECT 0')[0][0]
            (self.errors if n else self.ok).append(f'active firms without an active administrator: {n}')

        if self._exists('firm_membership'):
            n = _q('''SELECT count(*) FROM advocate a WHERE a.left_on IS NULL AND NOT EXISTS (
                      SELECT 1 FROM firm_membership m WHERE m.advocate_id = a.id)''')[0][0]
            (self.warnings if n else self.ok).append(
                f'accounts (not left) with no firm membership - cannot sign in in firm mode: {n}')

        # 3. Invoice numbers unique within a firm; payment links.
        n = _q('SELECT count(*) FROM (SELECT 1 FROM invoices GROUP BY firm_id, invoice_number HAVING count(*) > 1) d'
               if self._column('invoices', 'firm_id') else
               'SELECT count(*) FROM (SELECT 1 FROM invoices GROUP BY invoice_number HAVING count(*) > 1) d')[0][0]
        (self.errors if n else self.ok).append(f'duplicate invoice numbers within a firm: {n}')
        idx = [r[0] for r in _q("SELECT indexname FROM pg_indexes WHERE tablename = 'invoices'")]
        has = 'invoices_firm_number_uniq' in idx
        (self.ok if has else self.warnings).append(f'per-firm invoice number index present: {has}')
        n = _q("""SELECT count(*) FROM invoices i WHERE upper(i.status) = 'PAID' AND EXISTS (
                  SELECT 1 FROM payment_invoice pi WHERE pi.invoice_id = i.id) AND (
                  SELECT coalesce(sum(p.amount), 0) FROM payment_invoice pi JOIN client_payments p ON p.id = pi.payment_id
                  WHERE pi.invoice_id = i.id) + 0.005 < i.amount""")[0][0]
        (self.warnings if n else self.ok).append(f'PAID invoices whose linked payments are less than the amount: {n}')
        n = _q("""SELECT count(*) FROM invoices i WHERE (SELECT coalesce(sum(p.amount), 0) FROM payment_invoice pi
                  JOIN client_payments p ON p.id = pi.payment_id WHERE pi.invoice_id = i.id) > i.amount + 0.005""")[0][0]
        (self.errors if n else self.ok).append(f'invoices paid more than their amount: {n}')
        # Stored firm GSTINs that are set but invalid: forward-charge invoices for
        # that firm are refused until corrected (invoices/gst.py, no state fallback).
        from core.models import Advocate
        from core.validators import clean_gstin
        from firms.models import FirmSettings

        def _invalid(value):
            try:
                clean_gstin(value)
                return False
            except ValueError:
                return True
        bad = [f'advocate {a.id}' for a in Advocate.objects.exclude(gst_number__isnull=True).exclude(gst_number='')
               .only('id', 'gst_number') if _invalid(a.gst_number)]
        bad += [f'firm {s.firm_id} settings' for s in FirmSettings.objects.exclude(gst_number='')
                .only('firm_id', 'gst_number') if _invalid(s.gst_number)]
        (self.warnings if bad else self.ok).append(
            f'stored firm GSTINs that are not valid (fix in Profile / Firm Settings): {len(bad)}'
            + (f' ({", ".join(bad[:10])})' if bad else ''))

        # 4. Document files on disk; versions.
        from documents.storage import resolve_stored_file
        Document = apps.get_model('core', 'Document')
        missing = [d.id for d in Document.objects.exclude(status__iexact='DELETED').only('id', 'file_path', 'stored_name')
                   if not resolve_stored_file(d.file_path, d.stored_name)]
        (self.warnings if missing else self.ok).append(
            f'document rows whose file is not on this machine: {len(missing)}' + (f' (ids {missing[:20]})' if missing else ''))
        n = _q("""SELECT count(*) FROM documents d WHERE d.version > 1 AND NOT EXISTS (
                  SELECT 1 FROM document_version v WHERE v.document_id = d.id AND v.version = d.version - 1)"""
               if self._exists('document_version') else 'SELECT 0')[0][0]
        (self.warnings if n else self.ok).append(f'documents missing their previous version row: {n}')

        # 5. Audit rows without a firm (written before tenancy, or by system jobs).
        if self._column('audit_log', 'firm_id'):
            n = _q('SELECT count(*) FROM audit_log WHERE firm_id IS NULL')[0][0]
            (self.warnings if n else self.ok).append(f'audit rows without a firm (not shown to any firm): {n}')

        # 6. Permissions gated in code but missing from the catalogue (nobody can hold them).
        names = {r[0] for r in _q('SELECT name FROM permissions')}
        gated = set()
        for p in Path(settings.BASE_DIR).rglob('*.py'):
            if 'venv' in p.parts or p.name.startswith('test'):
                continue
            gated |= set(re.findall(r"RequirePermission\('([A-Z][A-Z_]+)'\)", p.read_text(encoding='utf-8', errors='ignore')))
        absent = sorted(gated - names - {'CODE'})          # 'CODE' is a docstring example
        (self.errors if absent else self.ok).append(
            f'permissions checked in code but missing from the catalogue: {absent or "none"}'
            + (' -> run the seed_*_permissions commands' if absent else ''))

        # 7. Pending migrations (the files this checkout has, not applied here).
        pending = [f'{m.app_label}.{m.name}' for m, _ in
                   MigrationExecutor(connection).migration_plan(MigrationExecutor(connection).loader.graph.leaf_nodes())]
        (self.warnings if pending else self.ok).append(f'pending migrations: {pending or "none"}')

        # 8. Firm ownership and cross-firm references.
        if getattr(settings, 'TENANCY_COLUMNS', False):
            buf = io.StringIO()
            try:
                call_command('verify_tenancy', stdout=buf, stderr=buf)
                self.ok.append('verify_tenancy: ' + (buf.getvalue().strip().splitlines() or ['ok'])[-1])
            except Exception as exc:                            # noqa: BLE001
                self.errors.append(f'verify_tenancy: {exc}; {buf.getvalue().strip().splitlines()[-3:]}')

        for label, rows in (('ERROR', self.errors), ('WARN', self.warnings), ('OK', self.ok)):
            for r in rows:
                self.stdout.write(f'{label:5} {r}')
        self.stdout.write(f'\n{len(self.errors)} error(s), {len(self.warnings)} warning(s).')
        if self.errors:
            raise SystemExit(1)

    @staticmethod
    def _exists(table):
        return bool(_q('SELECT to_regclass(%s)', [table])[0][0])

    @staticmethod
    def _column(table, col):
        return bool(_q('SELECT 1 FROM information_schema.columns WHERE table_name = %s AND column_name = %s', [table, col]))
