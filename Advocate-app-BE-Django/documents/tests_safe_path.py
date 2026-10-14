"""P1-3: a document's stored path is never trusted.

A row restored from a backup (or edited by hand) can point anywhere on the
server - the .env with the signing key, another firm's files. Every place that
opens, serves, zips or deletes a document file must stay inside
DOCUMENT_UPLOAD_DIR/documents.
"""
import datetime
import os
import shutil
import tempfile
import zipfile

from django.test import TestCase, TransactionTestCase, override_settings

from core.models import Document
from core.testing import ALL_PERMISSIONS, auth, make_advocate, make_case
from documents.models import DocumentVersion
from documents.storage import resolve_stored_file


def _doc(owner, case, path, stored_name, **extra):
    now = datetime.datetime.now()
    return Document.objects.create(
        document_name='Doc', original_name='doc.txt', stored_name=stored_name,
        file_path=path, file_size=5, file_type='text/plain', category='Draft',
        version=1, download_count=0, status='ACTIVE', upload_date=now, updated_at=now,
        advocate_id=owner.id, case=case, client=case.client, **extra)


class _Dirs:
    def make_dirs(self):
        self.base = tempfile.mkdtemp()
        self.upload = os.path.join(self.base, 'uploads')
        self.docs = os.path.join(self.upload, 'documents')
        os.makedirs(self.docs)
        # A file OUTSIDE the documents folder, standing in for .env / another firm.
        self.secret = os.path.join(self.base, 'secret.env')
        with open(self.secret, 'w') as fh:
            fh.write('SECRET_KEY=do-not-leak')
        self.inside = os.path.join(self.docs, 'a1b2c3.txt')
        with open(self.inside, 'w') as fh:
            fh.write('hello')
        self.settings = override_settings(DOCUMENT_UPLOAD_DIR=self.upload, SUMMARY_ENABLED=False)
        self.settings.enable()

    def drop_dirs(self):
        self.settings.disable()
        shutil.rmtree(self.base, ignore_errors=True)


class ResolveStoredFileTests(_Dirs, TestCase):
    def setUp(self):
        self.make_dirs()

    def tearDown(self):
        self.drop_dirs()

    def test_inside_path_is_returned(self):
        self.assertEqual(resolve_stored_file(self.inside), os.path.realpath(self.inside))

    def test_outside_path_is_refused(self):
        self.assertIsNone(resolve_stored_file(self.secret))
        self.assertIsNone(resolve_stored_file(os.path.join(self.docs, '..', '..', 'secret.env')))

    def test_traversal_in_stored_name_is_refused(self):
        self.assertIsNone(resolve_stored_file(None, '../secret.env'))
        self.assertIsNone(resolve_stored_file(None, '..\\secret.env'))

    def test_path_from_another_machine_found_by_stored_name(self):
        legacy = r'C:\Users\Someone\ams\uploads\documents\a1b2c3.txt'
        self.assertEqual(resolve_stored_file(legacy, 'a1b2c3.txt'), os.path.realpath(self.inside))


class PlantedPathEndpointTests(_Dirs, TestCase):
    def setUp(self):
        self.make_dirs()
        self.owner = make_advocate(permissions=ALL_PERMISSIONS)
        self.case = make_case(self.owner)
        self.planted = _doc(self.owner, self.case, self.secret, 'secret.env')

    def tearDown(self):
        self.drop_dirs()

    def assertNotServed(self, response):
        self.assertEqual(response.status_code, 404)
        body = b''.join(response.streaming_content) if response.streaming else response.content
        self.assertNotIn(b'do-not-leak', body)

    def test_download_refuses_path_outside_documents(self):
        self.assertNotServed(self.client.get(f'/api/documents/download/{self.planted.id}',
                                             **auth(self.owner)))

    def test_preview_refuses_path_outside_documents(self):
        self.assertNotServed(self.client.get(f'/api/documents/preview/{self.planted.id}',
                                             **auth(self.owner)))

    def test_version_download_refuses_path_outside_documents(self):
        DocumentVersion.objects.create(document_id=self.planted.id, version=1, stored_name='secret.env',
                                       file_path=self.secret, file_size=5, file_type='text/plain',
                                       original_name='x.txt', uploaded_by_id=self.owner.id)
        self.assertNotServed(self.client.get(
            f'/api/documents/{self.planted.id}/versions/1/download', **auth(self.owner)))

    def test_missing_file_says_not_available(self):
        gone = _doc(self.owner, self.case, os.path.join(self.docs, 'gone.txt'), 'gone.txt')
        r = self.client.get(f'/api/documents/download/{gone.id}', **auth(self.owner))
        self.assertEqual(r.status_code, 404)
        self.assertIn('not available', r.json()['error'])

    def test_good_document_still_downloads(self):
        good = _doc(self.owner, self.case, self.inside, 'a1b2c3.txt')
        r = self.client.get(f'/api/documents/download/{good.id}', **auth(self.owner))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(b''.join(r.streaming_content), b'hello')

    def test_summarizer_does_not_read_outside_file(self):
        from documents.summarizer import extract_text
        self.assertIsNone(extract_text(self.planted))

    def test_backup_does_not_zip_outside_file(self):
        from backup.service import create_backup
        result = create_backup(self.owner, 'DOCUMENTS')
        path = result.get('filePath') or result.get('path') or os.path.join(
            self.upload, 'backups', result['fileName'])
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            blob = b''.join(z.read(n) for n in names if not n.endswith('/'))
        self.assertNotIn(b'do-not-leak', blob)


class DeletePlantedPathTests(_Dirs, TransactionTestCase):
    """Delete runs the file removal on commit, so it needs real transactions."""

    def setUp(self):
        self.make_dirs()
        self.owner = make_advocate(permissions=ALL_PERMISSIONS)
        self.case = make_case(self.owner)

    def tearDown(self):
        self.drop_dirs()

    def test_delete_never_removes_file_outside_documents(self):
        planted = _doc(self.owner, self.case, self.secret, 'secret.env')
        r = self.client.delete(f'/api/documents/{planted.id}', **auth(self.owner))
        self.assertEqual(r.status_code, 204)
        self.assertTrue(os.path.exists(self.secret))

    def test_delete_removes_own_file(self):
        good = _doc(self.owner, self.case, self.inside, 'a1b2c3.txt')
        r = self.client.delete(f'/api/documents/{good.id}', **auth(self.owner))
        self.assertEqual(r.status_code, 204)
        self.assertFalse(os.path.exists(self.inside))
        self.assertFalse(Document.objects.filter(id=good.id).exists())


class UploadLimitTests(_Dirs, TestCase):
    """P1-4: DOCUMENT_MAX_UPLOAD_MB is enforced (it used to be unlimited)."""

    def setUp(self):
        self.make_dirs()
        self.owner = make_advocate(permissions=ALL_PERMISSIONS)
        self.case = make_case(self.owner)

    def tearDown(self):
        self.drop_dirs()

    def _upload(self, size):
        from django.core.files.uploadedfile import SimpleUploadedFile
        f = SimpleUploadedFile('brief.pdf', b'x' * size, content_type='application/pdf')
        return self.client.post('/api/documents/upload', {'file': f, 'caseId': self.case.id},
                                **auth(self.owner))

    @override_settings(DOCUMENT_MAX_UPLOAD_MB=1)
    def test_over_limit_is_refused(self):
        r = self._upload(1024 * 1024 + 1)
        self.assertEqual(r.status_code, 400)
        self.assertIn('at most 1 MB', r.json()['error'])
        self.assertEqual(os.listdir(self.docs), ['a1b2c3.txt'])   # nothing written

    @override_settings(DOCUMENT_MAX_UPLOAD_MB=1)
    def test_at_limit_is_accepted(self):
        r = self._upload(1024 * 1024)
        self.assertEqual(r.status_code, 201, r.content)
