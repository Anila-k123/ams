"""P1-1 / P1-2: a backup archive is untrusted input.

Anyone with BACKUP_MANAGE can upload one. Before these fixes a crafted archive
could run arbitrary SQL through a JSON key (column names were pasted into the
INSERT, on a connection switched to session_replication_role - superuser only),
point a document row at any file on the server, link rows to another
practice's cases, and overwrite another firm's uploaded files.
"""
import datetime
import json
import os

from django.db import connection
from django.test import override_settings

from backup import service
from backup.tests import BackupTestCase, make_advocate, zip_with
from core.models import Case, Client, Document


def _archive(**tables):
    entries = {f'data/{t}.json': json.dumps(rows, default=str) for t, rows in tables.items()}
    entries['metadata.json'] = json.dumps({'backupType': 'FULL'})
    return zip_with(entries)


class _Base(BackupTestCase):
    def setUp(self):
        super().setUp()
        self.owner = make_advocate('owner@test.local')
        self.other = make_advocate('other@test.local', full_name='Other Firm')
        self.other_client = Client.objects.create(name='Their Client', deleted=False,
                                                  advocate_id=self.other.id)
        self.other_case = Case.objects.create(case_number='THEIRS/1', case_title='Theirs', deleted=False,
                                              advocate_id=self.other.id, client=self.other_client)


class RestoreInjectionTests(_Base):
    def test_sql_in_a_column_name_is_refused_not_run(self):
        evil = 'name) VALUES (\'x\'); CREATE TABLE pwned_marker (id int); --'
        archive = _archive(clients=[{'id': 9101, evil: 'x', 'deleted': False,
                                     'advocate_id': self.owner.id}])
        result = service.restore_backup(self.owner, archive, 'FULL')
        self.assertEqual(result['status'], 'FAILED')
        self.assertIn('fields this database does not know', result['message'])
        with connection.cursor() as cur:
            cur.execute("SELECT to_regclass('pwned_marker')")
            self.assertIsNone(cur.fetchone()[0], 'the injected statement must never run')

    def test_restore_never_switches_replication_role(self):
        seen = []

        def spy(execute, sql_text, params, many, context):
            seen.append(str(sql_text))
            return execute(sql_text, params, many, context)
        archive = _archive(clients=[{'id': 9102, 'name': 'A', 'deleted': False,
                                     'advocate_id': self.owner.id}])
        with connection.execute_wrapper(spy):
            result = service.restore_backup(self.owner, archive, 'FULL')
        self.assertEqual(result['status'], 'SUCCESS', result['message'])
        self.assertFalse([s for s in seen if 'session_replication_role' in s])

    def test_database_errors_are_not_shown_to_the_user(self):
        # Same primary key as another advocate's row: the insert fails.
        archive = _archive(clients=[{'id': self.other_client.id, 'name': 'Clash', 'deleted': False,
                                     'advocate_id': self.owner.id}])
        result = service.restore_backup(self.owner, archive, 'FULL')
        self.assertEqual(result['status'], 'FAILED')
        self.assertNotIn('duplicate key', result['message'])
        self.assertNotIn('clients_pkey', result['message'])
        self.assertEqual(Client.objects.get(id=self.other_client.id).name, 'Their Client')


class RestoreScopeTests(_Base):
    def test_row_pointing_at_another_practices_case_is_refused(self):
        mine = Client.objects.create(name='Mine', deleted=False, advocate_id=self.owner.id)
        archive = _archive(
            clients=[{'id': mine.id, 'name': 'Mine', 'deleted': False, 'advocate_id': self.owner.id}],
            case_events=[{'id': 9201, 'case_id': self.other_case.id, 'advocate_id': self.owner.id,
                          'title': 'Planted', 'date': '2026-11-01', 'event_type': 'HEARING'}])
        result = service.restore_backup(self.owner, archive, 'FULL')
        self.assertEqual(result['status'], 'FAILED')
        self.assertIn('not in this backup or your practice', result['message'])
        self.assertTrue(Client.objects.filter(id=mine.id).exists(), 'refused restore changes nothing')

    def test_document_path_is_rebuilt_inside_the_uploads_folder(self):
        now = datetime.datetime.now().isoformat()
        archive = _archive(documents=[{
            'id': 9301, 'document_name': 'x', 'original_name': 'x.pdf', 'stored_name': 'abc123.pdf',
            'file_path': r'C:\\Users\\sybpc61\\Desktop\\AMS_Pactpro\\Advocate-app-BE-Django\\.env',
            'file_size': 1, 'file_type': 'application/pdf', 'version': 1, 'download_count': 0,
            'status': 'ACTIVE', 'upload_date': now, 'updated_at': now, 'advocate_id': self.owner.id,
            'client_visible': False}])
        result = service.restore_backup(self.owner, archive, 'FULL')
        self.assertEqual(result['status'], 'SUCCESS', result['message'])
        doc = Document.objects.get(id=9301)
        self.assertNotIn('.env', doc.file_path)
        self.assertTrue(doc.file_path.endswith(os.path.join('documents', 'abc123.pdf')))

    def test_traversal_in_stored_name_is_refused(self):
        now = datetime.datetime.now().isoformat()
        archive = _archive(documents=[{
            'id': 9302, 'document_name': 'x', 'original_name': 'x.pdf', 'stored_name': '../../.env',
            'file_path': 'x', 'file_size': 1, 'file_type': 'application/pdf', 'version': 1,
            'download_count': 0, 'status': 'ACTIVE', 'upload_date': now, 'updated_at': now,
            'advocate_id': self.owner.id, 'client_visible': False}])
        self.assertEqual(service.restore_backup(self.owner, archive, 'FULL')['status'], 'FAILED')


class RestoreFileTests(_Base):
    def _doc(self, owner, stored):
        now = datetime.datetime.now()
        return Document.objects.create(
            document_name='d', original_name='d.pdf', stored_name=stored,
            file_path=os.path.join(self._tmp, 'documents', stored), file_size=1,
            file_type='application/pdf', version=1, download_count=0, status='ACTIVE',
            upload_date=now, updated_at=now, advocate_id=owner.id)

    def test_documents_restore_cannot_overwrite_another_firms_file(self):
        os.makedirs(os.path.join(self._tmp, 'documents'))
        theirs = os.path.join(self._tmp, 'documents', 'their-file.pdf')
        with open(theirs, 'wb') as fh:
            fh.write(b'ORIGINAL')
        self._doc(self.other, 'their-file.pdf')
        self._doc(self.owner, 'my-file.pdf')
        archive = zip_with({'documents/their-file.pdf': 'REPLACED', 'documents/my-file.pdf': 'MINE',
                            'documents/evil.html': '<script>', 'metadata.json': '{}'})
        result = service.restore_backup(self.owner, archive, 'DOCUMENTS')
        self.assertEqual(result['status'], 'SUCCESS')
        with open(theirs, 'rb') as fh:
            self.assertEqual(fh.read(), b'ORIGINAL')
        self.assertTrue(os.path.exists(os.path.join(self._tmp, 'documents', 'my-file.pdf')))
        self.assertFalse(os.path.exists(os.path.join(self._tmp, 'documents', 'evil.html')))

    @override_settings(BACKUP_MAX_UPLOAD_MB=1)
    def test_oversized_archive_is_refused_before_reading(self):
        archive = zip_with({'data/clients.json': '[' + ' ' * (2 * 1024 * 1024) + ']',
                            'metadata.json': '{}'})
        result = service.restore_backup(self.owner, archive, 'FULL')
        self.assertEqual(result['status'], 'FAILED')
        self.assertIn('too large', result['message'])
        self.assertIsNone(result['rollbackFile'])
