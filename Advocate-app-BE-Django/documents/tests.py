"""Who can read which documents.

Documents belong to the matter, not the uploader: everyone in a practice with
DOCUMENT_VIEW reads the practice's documents, the same as cases and tasks. Before
this, reads were own-uploads-only while edits/deletes were practice-wide, so a
senior could delete a junior's draft but not see it.
"""

import datetime
import os
import shutil
import tempfile

from django.test import TestCase, override_settings

from core.jwt import generate_token
from core.models import Document
from core.testing import ALL_PERMISSIONS, auth, make_advocate, make_case


def make_document(owner, case, directory, name='Plaint'):
    path = os.path.join(directory, f'{name}-{owner.id}.docx')
    with open(path, 'wb') as fh:
        fh.write(b'PK ' + name.encode())
    now = datetime.datetime.now()
    return Document.objects.create(
        document_name=name, original_name=f'{name}.docx', stored_name=os.path.basename(path),
        file_path=path, file_size=10, file_type='application/octet-stream', category='Draft',
        version=1, download_count=0, status='ACTIVE', upload_date=now, updated_at=now,
        advocate_id=owner.id, case=case, client=case.client)


class DocumentReadScopeTest(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.dir = tempfile.mkdtemp()
        cls._settings = override_settings(SUMMARY_ENABLED=False, DOCUMENT_UPLOAD_DIR=cls.dir)
        cls._settings.enable()

    @classmethod
    def tearDownClass(cls):
        cls._settings.disable()
        shutil.rmtree(cls.dir, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        self.junior = make_advocate(permissions=ALL_PERMISSIONS, parent_advocate_id=self.senior.id)
        self.outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.case = make_case(self.senior)
        self.junior_doc = make_document(self.junior, self.case, self.dir, 'JuniorDraft')
        self.senior_doc = make_document(self.senior, self.case, self.dir, 'SeniorNote')

    def ids(self, url, advocate):
        body = self.client.get(url, **auth(advocate)).json()
        rows = body['content'] if isinstance(body, dict) else body
        return sorted(r['id'] for r in rows)

    def test_practice_members_see_each_others_documents(self):
        both = sorted([self.junior_doc.id, self.senior_doc.id])
        for who in (self.senior, self.junior):
            self.assertEqual(self.ids('/api/documents', who), both)
            self.assertEqual(self.ids(f'/api/documents/by-case/{self.case.id}', who), both)
            self.assertEqual(self.ids('/api/documents/list', who), both)
        detail = self.client.get(f'/api/documents/{self.junior_doc.id}', **auth(self.senior))
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(self.client.get('/api/documents/stats', **auth(self.senior)).json()['totalDocuments'], 2)

    def test_senior_downloads_junior_document(self):
        resp = self.client.get(f'/api/documents/download/{self.junior_doc.id}', **auth(self.senior))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(b''.join(resp.streaming_content), b'PK JuniorDraft')
        token = generate_token(self.senior)
        self.assertEqual(self.client.get(f'/api/documents/preview/{self.junior_doc.id}?token={token}').status_code, 200)
        self.assertEqual(self.client.get(f'/api/documents/{self.junior_doc.id}/versions/1/download',
                                         **auth(self.senior)).status_code, 200)

    def test_outsider_sees_nothing(self):
        self.assertEqual(self.ids('/api/documents', self.outsider), [])
        self.assertEqual(self.ids(f'/api/documents/by-case/{self.case.id}', self.outsider), [])
        self.assertEqual(self.client.get(f'/api/documents/{self.junior_doc.id}', **auth(self.outsider)).status_code, 404)
        self.assertEqual(self.client.get(f'/api/documents/download/{self.junior_doc.id}',
                                         **auth(self.outsider)).status_code, 404)

    def test_download_needs_document_view_for_colleagues_files(self):
        clerk = make_advocate(permissions=('CASE_VIEW',), parent_advocate_id=self.senior.id)
        own = make_document(clerk, self.case, self.dir, 'ClerkOwn')
        self.assertEqual(self.client.get(f'/api/documents/download/{self.junior_doc.id}',
                                         **auth(clerk)).status_code, 404)
        self.assertEqual(self.client.get(f'/api/documents/download/{own.id}', **auth(clerk)).status_code, 200)
        self.assertEqual(self.client.get('/api/documents', **auth(clerk)).status_code, 403)

    def test_departed_advocate_token_rejected_for_download(self):
        token = generate_token(self.junior)
        self.junior.left_on = datetime.date.today()
        self.junior.save()
        self.assertEqual(self.client.get(f'/api/documents/download/{self.senior_doc.id}?token={token}').status_code, 401)
