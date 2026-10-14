"""Read-only baseline inventory of the AMS database (Phase 0, SaaS migration).

Collects what the multi-tenant migration has to be planned against: practice
roots and their members, a proposed firm mapping, roles and permissions, every
user's effective permissions, ownership anomalies, schema/model drift, document
path patterns and database roles/connections.

Safety:
- The session is switched to READ ONLY before the first query and the command
  stops if PostgreSQL does not confirm it, so nothing here can write.
- Output holds names and emails, so it goes to a folder OUTSIDE the repository
  (the command refuses a path inside it). Never commit it.
- The console only shows counts and file names, never personal data.
- Password hashes are never read.

    manage.py baseline_inventory --out C:\\AMS_Baseline\\2026-10-13
"""
import json
import os
import re
from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

REPO_ROOT = Path(settings.BASE_DIR).resolve().parent
PERM_SUFFIXES = ('VIEW', 'CREATE', 'EDIT', 'DELETE', 'MANAGE', 'EXPORT', 'ISSUE',
                 'ASSIGN', 'UPLOAD', 'ALERTS', 'SCOPE')
# Business tables whose children must share their case's practice root.
CASE_CHILDREN = ['core.CaseEvent', 'core.Document', 'core.Expense', 'core.Invoice',
                 'core.ClientPayment', 'workspace.CaseTask', 'workspace.CaseNote',
                 'workspace.CaseParty', 'workspace.HearingDetail', 'workspace.CaseTag']


def _json_default(o):
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (set, frozenset)):
        return sorted(o)
    return str(o)


def _table_ref(model):
    """(schema, table) for a model, understanding '"drf"."x"' table names."""
    t = model._meta.db_table
    m = re.fullmatch(r'"(\w+)"\."(\w+)"', t)
    return (m.group(1), m.group(2)) if m else ('public', t)


class Command(BaseCommand):
    help = 'Read-only inventory for the SaaS migration baseline (writes files outside the repo).'

    def add_arguments(self, parser):
        parser.add_argument('--out', required=True, help='Output folder outside the repository.')

    # ------------------------------------------------------------------ setup
    def handle(self, *args, **opts):
        out = Path(opts['out']).resolve()
        if out == REPO_ROOT or REPO_ROOT in out.parents:
            raise CommandError('Output folder must be outside the repository (it holds personal data).')
        out.mkdir(parents=True, exist_ok=True)

        with connection.cursor() as cur:
            cur.execute('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
            cur.execute('SHOW default_transaction_read_only')
            if cur.fetchone()[0] != 'on':
                raise CommandError('Could not make the session read-only; stopping.')
        self.out = out
        self.summary = {}

        self._server()
        self._schema()
        self._drift()
        roots = self._firm_mapping()
        self._roles(roots)
        self._missing_permissions()
        self._anomalies()
        self._documents()
        self._uniqueness()
        self._write('summary.json', self.summary)
        self._write_markdown()
        self.stdout.write(self.style.SUCCESS(f'Inventory written to {out}'))
        for k, v in self.summary.items():
            if isinstance(v, (int, float, str)):
                self.stdout.write(f'  {k}: {v}')

    def _q(self, sql, params=None):
        with connection.cursor() as cur:
            cur.execute(sql, params or [])
            cols = [c[0] for c in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]

    def _write(self, name, data):
        with open(self.out / name, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, default=_json_default, ensure_ascii=False)

    # ----------------------------------------------------------------- server
    def _server(self):
        data = {
            'version': self._q('SELECT version()')[0]['version'],
            'databases': self._q("SELECT datname, pg_database_size(datname) AS bytes "
                                 "FROM pg_database WHERE NOT datistemplate ORDER BY 1"),
            'login_roles': self._q('SELECT rolname, rolsuper, rolcreatedb, rolcreaterole '
                                   'FROM pg_roles WHERE rolcanlogin ORDER BY 1'),
            'current_user': self._q('SELECT current_user AS u')[0]['u'],
            'connections': self._q(
                "SELECT usename, application_name, client_addr::text, state, backend_start "
                "FROM pg_stat_activity WHERE datname = current_database()"),
            'table_activity': self._q(
                'SELECT schemaname, relname, n_tup_ins, n_tup_upd, n_tup_del, n_live_tup '
                'FROM pg_stat_user_tables ORDER BY n_tup_ins + n_tup_upd + n_tup_del DESC'),
        }
        self._write('server.json', data)
        self.summary['postgres_version'] = data['version'].split(',')[0]
        self.summary['databases_on_server'] = len(data['databases'])
        self.summary['superuser_login_roles'] = sum(1 for r in data['login_roles'] if r['rolsuper'])

    # ----------------------------------------------------------------- schema
    def _schema(self):
        data = {
            'tables': self._q("SELECT table_schema, table_name FROM information_schema.tables "
                              "WHERE table_schema IN ('public','drf') AND table_type='BASE TABLE' "
                              "ORDER BY 1,2"),
            'constraints': self._q(
                "SELECT n.nspname AS schema, c.conrelid::regclass::text AS tbl, c.conname, "
                "c.contype, pg_get_constraintdef(c.oid) AS definition "
                "FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace "
                "WHERE n.nspname IN ('public','drf') ORDER BY 2, 3"),
            'indexes': self._q("SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes "
                               "WHERE schemaname IN ('public','drf') ORDER BY 1,2,3"),
            'triggers': self._q('SELECT trigger_schema, event_object_table, trigger_name '
                                'FROM information_schema.triggers ORDER BY 1,2,3'),
            'migrations': self._q('SELECT app, name, applied FROM django_migrations ORDER BY app, id'),
        }
        self._write('schema.json', data)
        kinds = Counter(c['contype'] for c in data['constraints'])
        self.summary['tables'] = len(data['tables'])
        self.summary['constraints_fk'] = kinds.get('f', 0)
        self.summary['constraints_unique'] = kinds.get('u', 0)
        self.summary['constraints_check'] = kinds.get('c', 0)
        self.summary['indexes'] = len(data['indexes'])

    def _drift(self):
        """Compare every model with the live columns."""
        live = defaultdict(dict)
        for r in self._q("SELECT table_schema, table_name, column_name, data_type, is_nullable "
                         "FROM information_schema.columns WHERE table_schema IN ('public','drf')"):
            live[(r['table_schema'], r['table_name'])][r['column_name']] = r
        drift = []
        for model in apps.get_models():
            if model._meta.proxy:
                continue
            ref = _table_ref(model)
            cols = live.get(ref)
            entry = {'model': model._meta.label, 'table': '.'.join(ref),
                     'managed': model._meta.managed}
            if cols is None:
                entry['problem'] = 'table missing in database'
                drift.append(entry)
                continue
            fields = {f.column for f in model._meta.concrete_fields}
            missing = sorted(fields - set(cols))
            extra = sorted(set(cols) - fields)
            if missing or extra:
                entry.update({'columns_missing_in_db': missing, 'columns_not_in_model': extra})
                drift.append(entry)
        self.missing_tables = {d['model'] for d in drift if d.get('problem')}
        self._write('drift.json', drift)
        self.summary['models_with_drift'] = len(drift)
        self.summary['models_missing_table'] = sum(1 for d in drift if d.get('problem'))

    # ---------------------------------------------------------- firm mapping
    def _firm_mapping(self):
        Advocate = apps.get_model('core', 'Advocate')
        ClientUser = apps.get_model('clientaccess', 'ClientUser')
        AdvocateRole = apps.get_model('core', 'AdvocateRole')
        Role = apps.get_model('core', 'Role')
        FirmTeam = apps.get_model('firms', 'FirmTeam')

        people = list(Advocate.objects.values(
            'id', 'full_name', 'email', 'office_name', 'gst_number', 'parent_advocate_id',
            'left_on', 'role'))
        by_id = {p['id']: p for p in people}
        client_logins = set(ClientUser.objects.values_list('advocate_id', flat=True))
        role_name = dict(Role.objects.values_list('id', 'name'))
        roles_of = defaultdict(list)
        for a, r in AdvocateRole.objects.values_list('advocate_id', 'role_id'):
            roles_of[a].append(role_name.get(r, f'role#{r}'))
        firm_team = list(FirmTeam.objects.values('team_root_id', 'firm_root_id'))
        team_firm = {t['team_root_id']: t['firm_root_id'] for t in firm_team}

        def root_of(aid):
            p = by_id.get(aid)
            return (p['parent_advocate_id'] or aid) if p else None
        self.root_of = root_of
        self.client_logins = client_logins

        groups = defaultdict(set)
        for p in people:
            groups[root_of(p['id'])].add(p['id'])

        counts = self._counts_by_root(root_of)
        last_activity = self._last_activity(root_of)
        signals = self._shared_signals(people, root_of)

        rows = []
        for root, members in sorted(groups.items()):
            rp = by_id.get(root, {})
            is_client = root in client_logins or 'Client' in roles_of.get(root, [])
            c = counts.get(root, {})
            business = sum(c.get(k, 0) for k in ('cases', 'clients', 'documents', 'invoices'))
            if is_client:
                proposal = 'CLIENT LOGIN (not a firm)'
            elif root in team_firm and team_firm[root] != root:
                proposal = f'JOIN firm of root {team_firm[root]}'
            elif business == 0 and len(members) == 1:
                proposal = 'UNUSED - decide (archive or firm)'
            else:
                proposal = 'NEW FIRM (confirm)'
            rows.append({
                'root_id': root, 'root_name': rp.get('full_name'), 'root_email': rp.get('email'),
                'office_name': rp.get('office_name'), 'gst_number': rp.get('gst_number'),
                'root_left_on': rp.get('left_on'), 'root_roles': roles_of.get(root, []),
                'kind': 'CLIENT' if is_client else 'STAFF',
                'members': [{'id': m, 'name': by_id[m]['full_name'], 'roles': roles_of.get(m, []),
                             'left_on': by_id[m]['left_on']}
                            for m in sorted(members) if m != root],
                'firm_team_firm_root': team_firm.get(root),
                'counts': c, 'last_activity': last_activity.get(root),
                'shared_signals': signals.get(root, []),
                'proposed_mapping': proposal,
            })
        self._write('firm_mapping.json', rows)
        with open(self.out / 'firm_mapping_proposal.csv', 'w', encoding='utf-8') as f:
            f.write('root_id,kind,root_name,office_name,members,cases,clients,documents,'
                    'invoices,last_activity,shared_signals,proposed_mapping\n')
            for r in rows:
                c = r['counts']
                vals = [r['root_id'], r['kind'], r['root_name'] or '', r['office_name'] or '',
                        len(r['members']), c.get('cases', 0), c.get('clients', 0),
                        c.get('documents', 0), c.get('invoices', 0), r['last_activity'] or '',
                        '; '.join(r['shared_signals']), r['proposed_mapping']]
                f.write(','.join('"%s"' % str(v).replace('"', "'") for v in vals) + '\n')
        self.summary['advocate_rows'] = len(people)
        self.summary['practice_roots'] = len(groups)
        self.summary['client_login_roots'] = sum(1 for r in rows if r['kind'] == 'CLIENT')
        self.summary['firm_team_rows'] = len(firm_team)
        self.summary['proposed_new_firms'] = sum(1 for r in rows if r['proposed_mapping'].startswith('NEW'))
        self.summary['proposed_unused'] = sum(1 for r in rows if r['proposed_mapping'].startswith('UNUSED'))
        return rows

    def _counts_by_root(self, root_of):
        spec = {
            'clients': ('core.Client', 'advocate_id'), 'cases': ('core.Case', 'advocate_id'),
            'documents': ('core.Document', 'advocate_id'), 'invoices': ('core.Invoice', 'advocate_id'),
            'payments': ('core.ClientPayment', 'advocate_id'), 'expenses': ('core.Expense', 'advocate_id'),
            'hearings': ('core.CaseEvent', 'advocate_id'), 'tasks': ('workspace.CaseTask', 'advocate_id'),
            'drafts': ('drafting.DraftSession', 'created_by_id'),
            'templates': ('drafting.Template', 'created_by_id'),
            'playbooks': ('drafting.Playbook', 'created_by_id'),
            'samples': ('drafting.Sample', 'uploaded_by_id'),
        }
        out = defaultdict(lambda: defaultdict(int))
        for key, (label, col) in spec.items():
            model = apps.get_model(label)
            for owner in model.objects.values_list(col, flat=True):
                out[root_of(owner) if owner else None][key] += 1
        return {k: dict(v) for k, v in out.items()}

    def _last_activity(self, root_of):
        last = {}
        for row in self._q('SELECT advocate_id, max(created_at) AS ts FROM audit_log '
                           'GROUP BY advocate_id'):
            r = root_of(row['advocate_id']) if row['advocate_id'] else None
            if r is not None and row['ts'] and (r not in last or row['ts'] > last[r]):
                last[r] = row['ts']
        return last

    def _shared_signals(self, people, root_of):
        """Hints that two roots may be one real firm: same office name / GSTIN,
        same client phone or email."""
        Client = apps.get_model('core', 'Client')
        signals = defaultdict(set)

        def link(key_fn, label, items):
            seen = defaultdict(set)
            for it in items:
                k = key_fn(it)
                if k:
                    seen[k].add(it['_root'])
            for roots in seen.values():
                if len(roots) > 1:
                    for r in roots:
                        signals[r].add(f'{label} shared with roots {sorted(roots - {r})}')

        staff = [dict(p, _root=root_of(p['id'])) for p in people
                 if p['parent_advocate_id'] is None and p['id'] not in self.client_logins]
        link(lambda p: (p['office_name'] or '').strip().lower(), 'office name', staff)
        link(lambda p: (p['gst_number'] or '').strip().upper(), 'GSTIN', staff)
        clients = [dict(c, _root=root_of(c['advocate_id']))
                   for c in Client.objects.values('advocate_id', 'phone', 'email')]
        link(lambda c: re.sub(r'\D', '', c['phone'] or '')[-10:], 'client phone', clients)
        link(lambda c: (c['email'] or '').strip().lower(), 'client email', clients)
        return {k: sorted(v) for k, v in signals.items()}

    # ------------------------------------------------------------------ roles
    def _roles(self, roots):
        Role = apps.get_model('core', 'Role')
        Permission = apps.get_model('core', 'Permission')
        RolePermission = apps.get_model('core', 'RolePermission')
        AdvocateRole = apps.get_model('core', 'AdvocateRole')
        Advocate = apps.get_model('core', 'Advocate')

        perms = dict(Permission.objects.values_list('id', 'name'))
        roles = list(Role.objects.values('id', 'name', 'description', 'created_at'))
        matrix = defaultdict(set)
        for rid, pid in RolePermission.objects.values_list('role_id', 'permission_id'):
            matrix[rid].add(perms.get(pid, f'perm#{pid}'))
        holders = defaultdict(list)
        for aid, rid in AdvocateRole.objects.values_list('advocate_id', 'role_id'):
            holders[rid].append(aid)
        people = {p['id']: p for p in Advocate.objects.values('id', 'left_on', 'parent_advocate_id')}

        role_rows = []
        for r in roles:
            h = holders.get(r['id'], [])
            role_rows.append({
                **r, 'permissions': sorted(matrix.get(r['id'], set())),
                'holders_total': len(h),
                'holders_active': sum(1 for a in h if a in people and not people[a]['left_on']),
                'roots_using': sorted({self.root_of(a) for a in h if a in people}),
            })
        all_codes = sorted(perms.values())
        matrix_rows = [{'permission': code,
                        **{r['name']: (code in matrix.get(r['id'], set())) for r in roles}}
                       for code in all_codes]

        assigned = defaultdict(set)
        for aid, rid in AdvocateRole.objects.values_list('advocate_id', 'role_id'):
            assigned[aid].add(rid)
        effective = {}
        for aid in sorted(people):
            codes = set()
            for rid in assigned.get(aid, ()):
                codes |= matrix.get(rid, set())
            effective[aid] = sorted(codes)
        no_role = [a for a in people if not assigned.get(a) and a not in self.client_logins]
        firm_wide = [a for a, c in effective.items() if 'FIRM_WIDE_SCOPE' in c]

        self._write('roles.json', role_rows)
        self._write('role_permission_matrix.json', matrix_rows)
        self._write('effective_permissions_snapshot.json',
                    {'taken_at': datetime.now().isoformat(), 'by_advocate_id': effective})
        receptionist = next((r for r in role_rows if r['name'].lower() == 'receptionist'), None)
        self._write('role_findings.json', {
            'users_without_role': no_role, 'users_with_firm_wide_scope': firm_wide,
            'receptionist': receptionist,
        })
        self.summary['roles'] = len(roles)
        self.summary['permissions'] = len(perms)
        self.summary['users_without_role'] = len(no_role)
        self.summary['receptionist_holders'] = receptionist['holders_total'] if receptionist else 0

    def _missing_permissions(self):
        Permission = apps.get_model('core', 'Permission')
        in_db = set(Permission.objects.values_list('name', flat=True))
        token = re.compile(r"""['"]([A-Z]+(?:_[A-Z]+)+)['"]""")
        found = defaultdict(set)
        backend = Path(settings.BASE_DIR)
        for path in backend.rglob('*.py'):
            parts = set(path.parts)
            if 'venv' in parts or 'migrations' in parts or path.name.startswith('test'):
                continue
            try:
                text = path.read_text(encoding='utf-8')
            except (UnicodeDecodeError, OSError):
                continue
            for code in token.findall(text):
                if code.endswith(PERM_SUFFIXES):
                    found[code].add(str(path.relative_to(backend)))
        frontend = REPO_ROOT / 'Advocate-app-FE-main' / 'src'
        fe_found = defaultdict(set)
        if frontend.is_dir():
            for path in list(frontend.rglob('*.ts')) + list(frontend.rglob('*.tsx')):
                try:
                    text = path.read_text(encoding='utf-8')
                except (UnicodeDecodeError, OSError):
                    continue
                for code in token.findall(text):
                    if code.endswith(PERM_SUFFIXES):
                        fe_found[code].add(str(path.relative_to(REPO_ROOT)))
        referenced = set(found) | set(fe_found)
        data = {
            'referenced_in_code_missing_in_db': {
                c: sorted(found.get(c, set()) | fe_found.get(c, set()))
                for c in sorted(referenced - in_db)},
            'in_db_not_referenced_in_code': sorted(in_db - referenced),
        }
        self._write('missing_permissions.json', data)
        self.summary['permissions_missing_in_db'] = len(data['referenced_in_code_missing_in_db'])

    # -------------------------------------------------------------- anomalies
    def _anomalies(self):
        Advocate = apps.get_model('core', 'Advocate')
        Case = apps.get_model('core', 'Case')
        Client = apps.get_model('core', 'Client')
        adv_ids = set(Advocate.objects.values_list('id', flat=True))
        found = {}

        # 1. advocate_id pointing at no advocate, in every table that has one.
        dangling = {}
        for model in apps.get_models():
            if model._meta.label in self.missing_tables:
                continue
            names = {f.attname for f in model._meta.concrete_fields}
            for col in ('advocate_id', 'created_by_id', 'uploaded_by_id'):
                if col in names:
                    ids = set(model.objects.exclude(**{f'{col}__isnull': True})
                              .values_list(col, flat=True))
                    bad = ids - adv_ids
                    if bad:
                        dangling[f'{model._meta.label}.{col}'] = sorted(bad)
        found['owner_id_without_advocate'] = dangling

        # 2. team structure.
        parents = dict(Advocate.objects.values_list('id', 'parent_advocate_id'))
        found['parent_missing'] = sorted(a for a, p in parents.items() if p and p not in parents)
        found['parent_not_root'] = sorted(a for a, p in parents.items() if p and parents.get(p))

        # 3. children whose owner is in another practice root than their case.
        case_root = {c: self.root_of(a) for c, a in Case.objects.values_list('id', 'advocate_id')}
        cross = {}
        for label in CASE_CHILDREN:
            try:
                model = apps.get_model(label)
            except LookupError:
                continue
            if label in self.missing_tables:
                continue
            names = {f.attname for f in model._meta.concrete_fields}
            if not {'case_id', 'advocate_id'} <= names:
                continue
            rows = []
            for pk, case_id, owner in model.objects.values_list('id', 'case_id', 'advocate_id'):
                if case_id is None:
                    continue
                if case_id not in case_root:
                    rows.append({'id': pk, 'case_id': case_id, 'problem': 'case missing'})
                elif self.root_of(owner) != case_root[case_id]:
                    rows.append({'id': pk, 'case_id': case_id, 'owner_root': self.root_of(owner),
                                 'case_root': case_root[case_id]})
            if rows:
                cross[label] = rows
        found['child_root_differs_from_case_root'] = cross

        # 4. cases whose client belongs to another root.
        client_root = {c: self.root_of(a) for c, a in Client.objects.values_list('id', 'advocate_id')}
        found['case_client_root_mismatch'] = [
            {'case_id': cid, 'case_root': case_root[cid], 'client_root': client_root.get(cl)}
            for cid, cl in Case.objects.values_list('id', 'client_id')
            if cl and client_root.get(cl) != case_root.get(cid)]

        # 5. client portal logins linked to a client of a different root.
        ClientUser = apps.get_model('clientaccess', 'ClientUser')
        found['client_user_root_mismatch'] = [
            {'client_user_id': pk, 'client_id': cl, 'client_root': client_root.get(cl),
             'created_by_root': self.root_of(cb) if cb else None}
            for pk, cl, cb in ClientUser.objects.values_list('id', 'client_id', 'created_by_id')
            if cb and client_root.get(cl) != self.root_of(cb)]

        # 6. drafting set-up without an owner, and the shared clause library.
        Template = apps.get_model('drafting', 'Template')
        Playbook = apps.get_model('drafting', 'Playbook')
        LibraryClause = apps.get_model('drafting', 'LibraryClause')
        Sample = apps.get_model('drafting', 'Sample')
        sample_owner = dict(Sample.objects.values_list('id', 'uploaded_by_id'))
        lib = list(LibraryClause.objects.values('id', 'contract_type', 'source_sample_id', 'is_active'))
        found['templates_without_owner'] = list(
            Template.objects.filter(created_by_id__isnull=True).values_list('id', flat=True))
        found['playbooks_without_owner'] = list(
            Playbook.objects.filter(created_by_id__isnull=True).values_list('id', flat=True))
        found['library_clauses'] = {
            'total': len(lib),
            'active': sum(1 for c in lib if c['is_active']),
            'without_source_sample': sum(1 for c in lib if not c['source_sample_id']),
            'by_source_root': dict(Counter(
                str(self.root_of(sample_owner.get(c['source_sample_id'])))
                if c['source_sample_id'] else 'none' for c in lib)),
            'contract_types': dict(Counter(c['contract_type'] for c in lib)),
        }

        # 7. firm-level settings rows not owned by a practice root.
        for label in ('invoices.FirmBillingProfile', 'core.CommunicationSettings'):
            model = apps.get_model(label)
            found[f'{label}_owner_not_root'] = [
                a for a in model.objects.values_list('advocate_id', flat=True)
                if a in parents and parents[a]]

        self._write('anomalies.json', found)
        self.summary['anomaly_owner_without_advocate_tables'] = len(dangling)
        self.summary['anomaly_child_root_mismatch_rows'] = sum(len(v) for v in cross.values())
        self.summary['anomaly_case_client_root_mismatch'] = len(found['case_client_root_mismatch'])
        self.summary['anomaly_client_user_root_mismatch'] = len(found['client_user_root_mismatch'])
        self.summary['library_clauses_total'] = len(lib)
        self.summary['templates_without_owner'] = len(found['templates_without_owner'])

    # -------------------------------------------------------------- documents
    def _documents(self):
        Document = apps.get_model('core', 'Document')
        DocumentVersion = apps.get_model('documents', 'DocumentVersion')
        Advocate = apps.get_model('core', 'Advocate')
        upload_root = Path(settings.DOCUMENT_UPLOAD_DIR).resolve()
        docs_root = upload_root / 'documents'

        def prefix(p):
            if not p:
                return '(empty)'
            parent = str(Path(p).parent)
            return parent[:80]

        def inside(p):
            try:
                rp = Path(p).resolve()
            except (OSError, ValueError):
                return False
            return rp == docs_root or docs_root in rp.parents

        rows = list(Document.objects.values('id', 'file_path', 'advocate_id'))
        vrows = list(DocumentVersion.objects.values('id', 'file_path'))
        referenced = set()
        result = {'upload_root': str(upload_root), 'document_rows': len(rows),
                  'version_rows': len(vrows)}
        for label, items in (('documents', rows), ('versions', vrows)):
            result[f'{label}_path_prefixes'] = dict(Counter(prefix(r['file_path']) for r in items))
            result[f'{label}_missing_file'] = [r['id'] for r in items
                                              if r['file_path'] and not os.path.isfile(r['file_path'])]
            result[f'{label}_outside_upload_root'] = [r['id'] for r in items
                                                     if r['file_path'] and not inside(r['file_path'])]
            for r in items:
                if r['file_path']:
                    referenced.add(os.path.normcase(os.path.abspath(r['file_path'])))
        on_disk = []
        if docs_root.is_dir():
            on_disk = [os.path.normcase(str(p.resolve())) for p in docs_root.iterdir() if p.is_file()]
        result['files_on_disk'] = len(on_disk)
        result['orphan_files_on_disk'] = sum(1 for p in on_disk if p not in referenced)

        branding = {'logo': 0, 'photo': 0, 'signature': 0, 'seal': 0}
        for p in Advocate.objects.values('office_logo_path', 'profile_photo_path',
                                         'signature_path', 'office_seal_path'):
            branding['logo'] += bool(p['office_logo_path'])
            branding['photo'] += bool(p['profile_photo_path'])
            branding['signature'] += bool(p['signature_path'])
            branding['seal'] += bool(p['office_seal_path'])
        result['branding_files_referenced'] = branding
        result['branding_note'] = ('served without authentication by '
                                   'accounts/views.py::serve_branding_file (incl. signature/seal)')
        self._write('documents.json', result)
        self.summary['documents_missing_file'] = len(result['documents_missing_file'])
        self.summary['documents_outside_upload_root'] = len(result['documents_outside_upload_root'])
        self.summary['orphan_files_on_disk'] = result['orphan_files_on_disk']
        self.summary['public_signature_or_seal_files'] = branding['signature'] + branding['seal']

    # ------------------------------------------------------------- uniqueness
    def _uniqueness(self):
        Invoice = apps.get_model('core', 'Invoice')
        Advocate = apps.get_model('core', 'Advocate')
        inv = list(Invoice.objects.values('id', 'invoice_number', 'invoice_date', 'advocate_id'))
        fmt = Counter(re.sub(r'\d', '9', (i['invoice_number'] or '')) for i in inv)

        def fy(d):
            if not d:
                return 'unknown'
            y = d.year if d.month >= 4 else d.year - 1
            return f'{y}-{str(y + 1)[-2:]}'
        per_root = defaultdict(list)
        for i in inv:
            per_root[str(self.root_of(i['advocate_id']))].append(i['invoice_number'])
        staff_emails = Counter((a or '').lower() for a in Advocate.objects.exclude(
            id__in=self.client_logins).values_list('email', flat=True))
        client_emails = Counter((a or '').lower() for a in Advocate.objects.filter(
            id__in=self.client_logins).values_list('email', flat=True))
        data = {
            'invoice_count': len(inv),
            'invoice_number_formats': dict(fmt),
            'invoices_by_financial_year': dict(Counter(fy(i['invoice_date']) for i in inv)),
            'invoices_per_root': {k: len(v) for k, v in per_root.items()},
            'duplicate_numbers_within_a_root': {
                k: [n for n, c in Counter(v).items() if c > 1] for k, v in per_root.items()
                if any(c > 1 for c in Counter(v).values())},
            'emails_shared_staff_and_client': len(set(staff_emails) & set(client_emails) - {''}),
        }
        self._write('uniqueness.json', data)
        self.summary['invoice_number_formats'] = len(fmt)

    # --------------------------------------------------------------- markdown
    def _write_markdown(self):
        lines = ['# AMS baseline inventory', '',
                 f'Taken: {datetime.now():%Y-%m-%d %H:%M}', '',
                 'Contains personal data. Keep outside the repository.', '',
                 '| Item | Value |', '|---|---|']
        lines += [f'| {k} | {v} |' for k, v in self.summary.items()]
        lines += ['', 'Files: server.json, schema.json, drift.json, firm_mapping.json, '
                  'firm_mapping_proposal.csv, roles.json, role_permission_matrix.json, '
                  'effective_permissions_snapshot.json, role_findings.json, '
                  'missing_permissions.json, anomalies.json, documents.json, uniqueness.json']
        (self.out / 'SUMMARY.md').write_text('\n'.join(lines), encoding='utf-8')
