"""Backup/restore engine.

Produces a ZIP with the same layout the Spring backend used:
  metadata.json, data/<table>.json, database/database.sql, documents/, settings/settings.json
Data is scoped to the current advocate. Restore is transactional (all-or-nothing)
and creates a rollback FULL backup first.

NOT practice-wide, deliberately. Since shared practices were introduced
(core/practice.py) an advocate can SEE rows created by colleagues, but a backup
still exports only the rows they created themselves. Widening the export would
mean widening the DELETE in restore to the whole practice, which turns one
person's mis-drop into a chambers-wide loss - so each member backs up their own
work from their own account instead, and the page says so. Making this
practice-wide needs restore reworked first, not just the export.
"""

import os
import io
import json
import time
import hashlib
import datetime
import zipfile

from django.conf import settings
from django.db import connection, transaction

# Data tables to export/restore (all carry advocate_id). Parents first, so the
# insert order reads sensibly even though restore disables FK triggers.
#
# This list used to include 'tasks' - the legacy Spring table that the dead
# core.Task app mapped onto. It holds 0 rows; real tasks live in `case_task`.
# So every "Full" backup exported an empty table and silently omitted the
# advocate's actual tasks, along with case parties, timeline events and the
# fetched court records: 190+ rows of real case data on this database alone.
# A backup that quietly leaves things out is worse than one that fails.
DATA_TABLES = [
    'clients',
    'cases',
    # Case children
    'case_events',
    'case_note',
    'case_tag',
    'case_party',
    'case_related',
    'case_timeline_event',
    'case_task',
    'case_task_document',        # references case_task, so after it
    'documents',
    # Money
    'expenses',
    'invoices',
    'client_payments',
    # Court records fetched for this advocate's cases
    'courtsearch_imported_record',
    # The advocate's own feed
    'notifications',
    'activities',
]

# Deliberately NOT backed up, each for its own reason. Listed rather than simply
# absent, so the next person does not have to guess whether it was an oversight.
EXCLUDED_TABLES = {
    # Restoring an audit trail would let someone rewrite the record of what
    # they did. It is also the one thing that must survive a bad restore.
    'audit_log',
    # Permissions. A restore silently changing who can do what is not a
    # restore, it is a privilege escalation with a friendly button.
    'advocate_roles',
    # Holds SMTP credentials and the WhatsApp token. The SETTINGS section
    # already covers the advocate profile without the secrets.
    'communication_settings',
    # Short-lived secrets; meaningless once restored.
    'password_reset_otp',
    # Delivery operations, not records. Re-inserting a queue would re-send.
    'notification_queue', 'notification_history', 'notification_logs',
    'notification_templates',
    # Self-referential: the list of backups is not part of a backup.
    'backup_history',
    # Derived - the nightly sweep regenerates it from the cases.
    'appeal_detection',
    # References the shared acts catalogue, which is imported separately and
    # is not advocate-owned, so the links would dangle on another database.
    'acts_actcaselink',
    # Demo scaffolding.
    'demo_workspace',
}

TYPE_SECTIONS = {
    'QUICK': {'DATABASE', 'JSON', 'DOCUMENTS'},
    'FULL': {'DATABASE', 'JSON', 'DOCUMENTS', 'REPORTS', 'SETTINGS'},
    'DATABASE': {'DATABASE', 'JSON'},
    'DOCUMENTS': {'DOCUMENTS'},
    'REPORTS': {'REPORTS'},
    'SETTINGS': {'SETTINGS'},
}


def _backup_dir():
    d = os.path.join(settings.DOCUMENT_UPLOAD_DIR, 'backups')
    os.makedirs(d, exist_ok=True)
    return d


def _unique_name(directory, file_name):
    """file_name, or file_name with a -2/-3 suffix if it is already taken."""
    if not os.path.exists(os.path.join(directory, file_name)):
        return file_name
    stem, ext = os.path.splitext(file_name)
    n = 2
    while os.path.exists(os.path.join(directory, '{}-{}{}'.format(stem, n, ext))):
        n += 1
    return '{}-{}{}'.format(stem, n, ext)


def _table_exists(table):
    with connection.cursor() as cur:
        cur.execute("SELECT 1 FROM information_schema.tables "
                    "WHERE table_schema = 'public' AND table_name = %s", [table])
        return cur.fetchone() is not None


def _rows(table, advocate_id):
    """Rows this advocate owns in one table, or None if the table is absent.

    None rather than an empty list, so a missing table is distinguishable from
    an empty one. `case_timeline_event` is Spring-era and has no Django model,
    so it exists in production and not in a model-derived test database - and a
    future migration could drop any of these. Either way one absent table must
    not fail the whole backup, and must not vanish from it silently: the caller
    records it as skipped.
    """
    if not _table_exists(table):
        return None, None
    with connection.cursor() as cur:
        cur.execute(f'SELECT * FROM {table} WHERE advocate_id = %s', [advocate_id])
        cols = [c[0] for c in cur.description]
        return cols, [dict(zip(cols, r)) for r in cur.fetchall()]


def _sql_value(v):
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return 'TRUE' if v else 'FALSE'
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def _table_sql(table, cols, rows):
    if not rows:
        return f'-- {table}: no rows\n'
    out = [f'-- Data for {table} ({len(rows)} rows)']
    collist = ', '.join(cols)
    for r in rows:
        vals = ', '.join(_sql_value(r[c]) for c in cols)
        out.append(f'INSERT INTO {table} ({collist}) VALUES ({vals});')
    return '\n'.join(out) + '\n'


def create_backup(advocate, backup_type):
    start = time.time()
    sections_wanted = TYPE_SECTIONS.get(backup_type, TYPE_SECTIONS['FULL'])
    ts = datetime.datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
    file_name = f'Advocate_Backup_{ts}.zip'
    buf = io.BytesIO()
    sections = []
    counts = {}
    skipped = []

    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        # JSON + DATABASE sections
        if 'JSON' in sections_wanted or 'DATABASE' in sections_wanted:
            s = time.time()
            sql_parts = ['-- Advocate backup SQL', f'-- Generated {datetime.datetime.now().isoformat()}', '']
            try:
                for t in DATA_TABLES:
                    cols, rows = _rows(t, advocate.id)
                    if rows is None:
                        # Absent table: record it rather than passing over it.
                        skipped.append(t)
                        continue
                    counts[t] = len(rows)
                    if 'JSON' in sections_wanted:
                        z.writestr(f'data/{t}.json', json.dumps(rows, default=str, indent=2))
                    if 'DATABASE' in sections_wanted:
                        sql_parts.append(_table_sql(t, cols, rows))
                if 'DATABASE' in sections_wanted:
                    z.writestr('database/database.sql', '\n'.join(sql_parts))
                sections.append({'name': 'DATABASE', 'status': 'SUCCESS',
                                 'durationMs': int((time.time() - s) * 1000), 'error': None})
            except Exception as e:
                sections.append({'name': 'DATABASE', 'status': 'FAILED',
                                 'durationMs': int((time.time() - s) * 1000), 'error': str(e)})

        # DOCUMENTS section
        if 'DOCUMENTS' in sections_wanted:
            s = time.time()
            copied = 0
            try:
                _, docs = _rows('documents', advocate.id)
                for d in (docs or []):
                    fp = d.get('file_path')
                    if fp and os.path.exists(fp):
                        z.write(fp, arcname=f"documents/{d.get('stored_name') or os.path.basename(fp)}")
                        copied += 1
                sections.append({'name': 'DOCUMENTS', 'status': 'SUCCESS',
                                 'durationMs': int((time.time() - s) * 1000), 'error': None})
            except Exception as e:
                sections.append({'name': 'DOCUMENTS', 'status': 'FAILED',
                                 'durationMs': int((time.time() - s) * 1000), 'error': str(e)})

        # REPORTS section (no persisted reports dir; record as skipped/empty)
        if 'REPORTS' in sections_wanted:
            z.writestr('reports/.keep', '')
            sections.append({'name': 'REPORTS', 'status': 'SUCCESS', 'durationMs': 0, 'error': None})

        # SETTINGS section
        if 'SETTINGS' in sections_wanted:
            s = time.time()
            with connection.cursor() as cur:
                cur.execute('SELECT * FROM advocate WHERE id = %s', [advocate.id])
                cols = [c[0] for c in cur.description]
                row = cur.fetchone()
                adv = dict(zip(cols, row)) if row else {}
            adv.pop('password', None)
            z.writestr('settings/settings.json', json.dumps(adv, default=str, indent=2))
            sections.append({'name': 'SETTINGS', 'status': 'SUCCESS',
                             'durationMs': int((time.time() - s) * 1000), 'error': None})

        duration = int(time.time() - start)
        health = 100 if all(x['status'] == 'SUCCESS' for x in sections) else \
            int(100 * sum(1 for x in sections if x['status'] == 'SUCCESS') / max(len(sections), 1))
        metadata = {
            'applicationVersion': '1.0.0-django', 'backupVersion': '2.0',
            'backupDate': datetime.datetime.now().isoformat(), 'backupType': backup_type,
            'advocateName': advocate.full_name, 'advocateEmail': advocate.email,
            'databaseType': 'PostgreSQL', 'databaseVersion': '18',
            'numberOfClients': counts.get('clients', 0), 'numberOfCases': counts.get('cases', 0),
            'numberOfDocuments': counts.get('documents', 0), 'numberOfExpenses': counts.get('expenses', 0),
            'numberOfInvoices': counts.get('invoices', 0), 'numberOfTasks': counts.get('tasks', 0),
            'numberOfCaseEvents': counts.get('case_events', 0),
            'numberOfNotifications': counts.get('notifications', 0),
            'numberOfActivities': counts.get('activities', 0),
            'durationSeconds': duration, 'healthScore': health, 'sections': sections,
            'skippedTables': skipped,
        }
        z.writestr('metadata.json', json.dumps(metadata, indent=2))

    data = buf.getvalue()
    checksum = hashlib.sha256(data).hexdigest()
    # The name is stamped to the second, and a restore takes its rollback
    # backup immediately before writing - so two backups in the same second
    # used to collide, the second silently overwriting the first while
    # backup_history kept two rows pointing at one file. Never overwrite:
    # find a free name instead.
    file_name = _unique_name(_backup_dir(), file_name)
    path = os.path.join(_backup_dir(), file_name)
    with open(path, 'wb') as f:
        f.write(data)

    with connection.cursor() as cur:
        cur.execute(
            'INSERT INTO backup_history (backup_type, file_name, file_size, checksum, '
            'duration_seconds, metadata_json, status, created_at, advocate_id) '
            'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id',
            [backup_type, file_name, len(data), checksum, duration,
             json.dumps(metadata), 'SUCCESS', datetime.datetime.now(), advocate.id])
        new_id = cur.fetchone()[0]

    return {
        'id': new_id, 'backupType': backup_type, 'status': 'SUCCESS',
        'fileSize': len(data), 'fileName': file_name,
        'message': 'Backup created successfully.', 'progress': '100',
        'durationSeconds': duration,
        # The per-section outcome is what actually happened, section by section,
        # with real timings. The page used to animate an invented stage list
        # instead; now it has the truth to display.
        'sections': sections, 'healthScore': health,
        'recordCounts': counts, 'skippedTables': skipped,
    }


def validate_zip(file_bytes):
    try:
        z = zipfile.ZipFile(io.BytesIO(file_bytes))
    except zipfile.BadZipFile:
        return {'valid': False, 'error': 'Not a valid ZIP archive.'}
    names = z.namelist()
    meta = {}
    if 'metadata.json' in names:
        try:
            meta = json.loads(z.read('metadata.json'))
        except Exception:
            meta = {}
    has_db = any(n.startswith('database/') for n in names)
    has_data = any(n.startswith('data/') for n in names)
    has_docs = any(n.startswith('documents/') for n in names)
    sections = meta.get('sections', [])
    return {
        'valid': True,
        'hasMetadata': 'metadata.json' in names,
        'hasDatabase': has_db, 'hasData': has_data, 'hasDocuments': has_docs,
        'backupType': meta.get('backupType'), 'backupDate': meta.get('backupDate'),
        'healthScore': meta.get('healthScore', 100 if sections else None),
        'backupVersion': meta.get('backupVersion'),
        'successSections': [s['name'] for s in sections if s.get('status') == 'SUCCESS'],
        'failedSections': [s['name'] for s in sections if s.get('status') == 'FAILED'],
        'skippedSections': [s['name'] for s in sections if s.get('status') == 'SKIPPED'],
        'isPartial': any(s.get('status') != 'SUCCESS' for s in sections),
        'metadata': json.dumps(meta) if meta else None,
        'entries': len(names),
    }


def restore_backup(advocate, file_bytes, restore_type):
    """Restore data tables from the ZIP's data/*.json, scoped to this advocate,
    in a single transaction (FK-safe order). Creates a rollback FULL backup first."""
    # Read the archive BEFORE taking the rollback backup. A bad ZIP used to
    # cost a pointless rollback file on disk every time someone mis-dropped.
    try:
        z = zipfile.ZipFile(io.BytesIO(file_bytes))
    except zipfile.BadZipFile:
        return {'status': 'FAILED', 'message': 'Invalid ZIP archive.',
                'rollbackFile': None}

    # A data restore DELETEs every row this advocate owns before re-inserting.
    # If the archive carries no data/ section there is nothing to re-insert, so
    # the "restore" would simply erase the account - a DOCUMENTS-only backup
    # picked with type=FULL used to wipe everything and put nothing back.
    # Refuse instead, and say which sections the file actually has.
    if restore_type in ('FULL', 'DATABASE'):
        if not any(n.startswith('data/') and n.endswith('.json') for n in z.namelist()):
            present = sorted({n.split('/')[0] for n in z.namelist() if '/' in n})
            return {
                'status': 'FAILED',
                'message': ('This archive contains no database records, so a '
                            '{} restore would delete your data without '
                            'replacing it. Sections present: {}. Choose a '
                            'matching restore type instead.'.format(
                                restore_type, ', '.join(present) or 'none')),
                'rollbackFile': None,
            }

    rollback = create_backup(advocate, 'FULL')

    if restore_type in ('DOCUMENTS', 'REPORTS', 'SETTINGS'):
        # Non-data restores: extract documents back to the uploads folder.
        restored = 0
        if restore_type == 'DOCUMENTS':
            docs_dir = os.path.join(settings.DOCUMENT_UPLOAD_DIR, 'documents')
            os.makedirs(docs_dir, exist_ok=True)
            for n in z.namelist():
                if n.startswith('documents/') and not n.endswith('/'):
                    with open(os.path.join(docs_dir, os.path.basename(n)), 'wb') as f:
                        f.write(z.read(n))
                    restored += 1
        return {'status': 'SUCCESS', 'message': f'Restored {restored} document(s).',
                'rollbackFile': rollback['fileName']}

    # DATABASE / FULL: restore data tables from JSON.
    # FK triggers are disabled for the connection during the swap (postgres superuser)
    # so we can delete/insert without worrying about referencing tables like
    # notification_history; re-inserting the same-id rows keeps integrity intact.
    names = z.namelist()
    inserted = 0
    try:
        with connection.cursor() as cur:
            cur.execute("SET session_replication_role = 'replica'")
            try:
                with transaction.atomic():
                    # Children first. A table that does not exist on this
                    # database is skipped rather than failing the restore -
                    # same reason as the export side.
                    present = [t for t in DATA_TABLES if _table_exists(t)]
                    for t in reversed(present):
                        cur.execute(f'DELETE FROM {t} WHERE advocate_id = %s', [advocate.id])
                    for t in present:
                        entry = f'data/{t}.json'
                        if entry not in names:
                            continue
                        rows = json.loads(z.read(entry) or b'[]')
                        for r in rows:
                            # Force ownership to the advocate doing the restore.
                            # The archive carries whatever advocate_id it was
                            # exported with; trusting it would let an uploaded
                            # file write rows into somebody else's account,
                            # which the DELETE above would never clean up.
                            if 'advocate_id' in r:
                                r['advocate_id'] = advocate.id
                            cols = list(r.keys())
                            placeholders = ', '.join(['%s'] * len(cols))
                            cur.execute(
                                f'INSERT INTO {t} ({", ".join(cols)}) VALUES ({placeholders})',
                                [r[c] for c in cols])
                            inserted += 1
            finally:
                cur.execute("SET session_replication_role = 'origin'")
        return {'status': 'SUCCESS',
                'message': 'Restore completed successfully: {} record(s) '
                           'restored.'.format(inserted),
                'recordsRestored': inserted,
                'rollbackFile': rollback['fileName']}
    except Exception as e:
        return {'status': 'FAILED', 'message': f'Restore failed and was rolled back: {e}',
                'rollbackFile': rollback['fileName']}
