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
    # Uploaded files live in <DOCUMENT_UPLOAD_DIR>/documents (documents/storage.py).
    os.makedirs(os.path.join(directory, 'documents'), exist_ok=True)
    path = os.path.join(directory, 'documents', f'{name}-{owner.id}.docx')
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
        # A login token in the URL is no longer accepted (it leaks into logs and
        # history); a short-lived signed link is.
        token = generate_token(self.senior)
        self.assertEqual(self.client.get(f'/api/documents/preview/{self.junior_doc.id}?token={token}').status_code, 401)
        link = self.client.post(f'/api/documents/{self.junior_doc.id}/link', {'purpose': 'preview'},
                                content_type='application/json', **auth(self.senior)).json()['url']
        self.assertEqual(self.client.get(link).status_code, 200)
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


class AllowedFileTypesTest(TestCase):
    """Only document types a practice keeps can be uploaded, as a new document or
    a new version; web pages, scripts and programs are refused before saving."""

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
        self.adv = make_advocate(permissions=ALL_PERMISSIONS)
        self.case = make_case(self.adv)

    def _upload(self, name, body=b'x', url='/api/documents/upload'):
        from django.core.files.uploadedfile import SimpleUploadedFile
        return self.client.post(url, {'file': SimpleUploadedFile(name, body), 'caseId': self.case.id},
                                **auth(self.adv))

    def test_web_pages_scripts_and_programs_are_refused(self):
        for name in ('page.html', 'page.HTM', 'logo.svg', 'run.py', 'app.js', 'setup.exe', 'go.bat', 'README'):
            resp = self._upload(name, b'<html><script>alert(1)</script></html>')
            self.assertEqual(resp.status_code, 400, name)
            self.assertIn("can't be uploaded", resp.json()['error'])
        self.assertFalse(Document.objects.exists())

    def test_documents_are_accepted_and_typed_by_extension(self):
        for name in ('plaint.pdf', 'Notes.DOCX', 'ledger.xlsx', 'scan.jpg', 'mail.eml', 'bundle.zip'):
            self.assertEqual(self._upload(name, b'%PDF-1.4').status_code, 201, name)
        # The stored type comes from the extension, not from what the browser sent.
        self.assertEqual(Document.objects.get(original_name='plaint.pdf').file_type, 'application/pdf')

    def test_a_new_version_must_be_an_allowed_type_too(self):
        doc_id = self._upload('plaint.pdf', b'%PDF-1.4').json()['id']
        resp = self._upload('plaint.html', url=f'/api/documents/{doc_id}/versions')
        self.assertEqual(resp.status_code, 400)


@override_settings(ONLYOFFICE_URL='http://oo.test', ONLYOFFICE_INTERNAL_URL='http://oo.test',
                   ONLYOFFICE_JWT_SECRET='test-secret-test-secret-test-secret!', AMS_INTERNAL_URL='http://ams.test')
class DocumentEditorTest(TestCase):
    """Any document in the ONLYOFFICE editor (documents/editor.py): new, open, save as a version, history."""

    def setUp(self):
        from unittest import mock
        self.dir = tempfile.mkdtemp()
        self._settings = override_settings(SUMMARY_ENABLED=False, DOCUMENT_UPLOAD_DIR=self.dir, MEDIA_ROOT=self.dir)
        self._settings.enable()
        self.owner = make_advocate(permissions=ALL_PERMISSIONS)
        self.case = make_case(self.owner)
        self.mock = mock

    def tearDown(self):
        self._settings.disable()
        shutil.rmtree(self.dir, ignore_errors=True)

    def _new(self, kind='word'):
        resp = self.client.post('/api/documents/new', {'kind': kind, 'name': 'Reply notice', 'case_id': self.case.id},
                                content_type='application/json', **auth(self.owner))
        self.assertEqual(resp.status_code, 201, resp.content)
        return Document.objects.get(id=resp.json()['id'])

    def _callback(self, doc, body):
        import json

        import jwt
        from django.conf import settings
        cfg = self.client.get(f'/api/documents/{doc.id}/editor', **auth(self.owner)).json()['config']
        link = cfg['editorConfig']['callbackUrl'].replace('http://ams.test', '')
        body = {'key': cfg['document']['key'], **body}
        signed = jwt.encode({'payload': body}, settings.ONLYOFFICE_JWT_SECRET, algorithm='HS256')
        return self.client.post(link, data=json.dumps(body), content_type='application/json',
                                HTTP_AUTHORIZATION=f'Bearer {signed}')

    def test_new_blank_documents_open_editable(self):
        for kind, ext, doc_type in (('word', 'docx', 'word'), ('cell', 'xlsx', 'cell'), ('slide', 'pptx', 'slide')):
            doc = self._new(kind)
            self.assertTrue(doc.original_name.endswith('.' + ext))
            self.assertEqual(doc.case_id, self.case.id)
            data = self.client.get(f'/api/documents/{doc.id}/editor', **auth(self.owner)).json()
            self.assertTrue(data['enabled'] and data['editable'])
            self.assertEqual((data['config']['documentType'], data['config']['editorConfig']['mode']), (doc_type, 'edit'))
            file_link = data['config']['document']['url'].replace('http://ams.test', '')
            self.assertEqual(self.client.get(file_link).content[:2], b'PK')

    def test_save_becomes_a_version_with_history(self):
        doc = self._new()
        with open(doc.file_path, 'rb') as f:
            saved = f.read()
        with self.mock.patch('documents.editor.requests.get') as get:
            get.return_value = self.mock.Mock(content=saved, ok=True, raise_for_status=lambda: None)
            # Closing the editor: only a working copy, no version.
            self._callback(doc, {'status': 2, 'url': 'http://oo.test/x', 'users': [str(self.owner.id)]})
            doc.refresh_from_db()
            self.assertEqual(doc.version, 1)
            data = self.client.get(f'/api/documents/{doc.id}/editor', **auth(self.owner)).json()
            self.assertTrue(data['editable'] and data['pendingWork'])
            self.assertIn('&work=1', data['config']['document']['url'])
            # PactPro's Save in the editor: a version.
            resp = self._callback(doc, {'status': 6, 'url': 'http://oo.test/x', 'changesurl': 'http://oo.test/c',
                                        'users': [str(self.owner.id)], 'history': {'serverVersion': '9.4.0'},
                                        'userdata': 'pactpro'})
        self.assertEqual(resp.json(), {'error': 0})
        doc.refresh_from_db()
        self.assertEqual(doc.version, 2)
        history = self.client.get(f'/api/documents/{doc.id}/editor/history', **auth(self.owner)).json()
        self.assertEqual([h['version'] for h in history['history']], [1, 2])
        one = self.client.get(f'/api/documents/{doc.id}/editor/history/2', **auth(self.owner)).json()
        self.assertIn('previous', one)
        self.assertIn('changesUrl', one)
        restored = self.client.post(f'/api/documents/{doc.id}/editor/restore', {'version': 1},
                                    content_type='application/json', **auth(self.owner))
        self.assertEqual(restored.status_code, 200)
        doc.refresh_from_db()
        self.assertEqual(doc.version, 3)

    def test_access(self):
        doc = self._new()
        reader = make_advocate(permissions=('DOCUMENT_VIEW',), parent_advocate_id=self.owner.id)
        data = self.client.get(f'/api/documents/{doc.id}/editor', **auth(reader)).json()
        self.assertFalse(data['editable'])
        self.assertEqual(data['config']['editorConfig']['mode'], 'view')
        self.assertEqual(self.client.post(f'/api/documents/{doc.id}/editor/save', **auth(reader)).status_code, 403)
        outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.assertEqual(self.client.get(f'/api/documents/{doc.id}/editor', **auth(outsider)).status_code, 404)

    def test_pdf_opens_read_only_and_unknown_types_are_refused(self):
        doc = self._new()
        Document.objects.filter(id=doc.id).update(original_name='Order.pdf')
        data = self.client.get(f'/api/documents/{doc.id}/editor', **auth(self.owner)).json()
        self.assertEqual((data['config']['documentType'], data['editable']), ('pdf', False))
        Document.objects.filter(id=doc.id).update(original_name='photo.jpg')
        self.assertFalse(self.client.get(f'/api/documents/{doc.id}/editor', **auth(self.owner)).json()['enabled'])

    @override_settings(ONLYOFFICE_URL='')
    def test_off_without_a_document_server(self):
        doc = make_document(self.owner, self.case, self.dir)
        self.assertFalse(self.client.get(f'/api/documents/{doc.id}/editor', **auth(self.owner)).json()['enabled'])


@override_settings(ONLYOFFICE_URL='http://oo.test', ONLYOFFICE_INTERNAL_URL='http://oo.test',
                   ONLYOFFICE_JWT_SECRET='test-secret-test-secret-test-secret!', AMS_INTERNAL_URL='http://ams.test')
class DocumentEditorMentionTest(TestCase):
    """@mentions in the document editor reach colleagues who can open the document, and no one else."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self._settings = override_settings(SUMMARY_ENABLED=False, DOCUMENT_UPLOAD_DIR=self.dir, MEDIA_ROOT=self.dir)
        self._settings.enable()
        self.owner = make_advocate(permissions=ALL_PERMISSIONS)
        self.colleague = make_advocate(permissions=('DOCUMENT_VIEW',), parent_advocate_id=self.owner.id)
        self.no_docs = make_advocate(permissions=('CASE_VIEW',), parent_advocate_id=self.owner.id)
        self.other_team = make_advocate(permissions=ALL_PERMISSIONS)
        self.doc = make_document(self.owner, make_case(self.owner), self.dir)

    def tearDown(self):
        self._settings.disable()
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_users_and_notify(self):
        from unittest import mock
        users = self.client.get(f'/api/documents/{self.doc.id}/editor/users', **auth(self.owner)).json()['users']
        self.assertEqual([u['email'] for u in users], [self.colleague.email])
        with mock.patch('notifications.service.notify') as notify:
            resp = self.client.post(f'/api/documents/{self.doc.id}/editor/notify',
                                    {'emails': [self.colleague.email, self.no_docs.email, self.other_team.email],
                                     'message': 'Please check para 4'}, content_type='application/json', **auth(self.owner))
        self.assertEqual(resp.json()['notified'], 1)
        self.assertEqual((notify.call_args[0][0], notify.call_args[0][1]), (self.colleague.id, 'DOCUMENT_COMMENT'))


# The editor settings are set here, not taken from the machine's .env (New document needs them).
@override_settings(AMS_PUBLIC_URL='http://pactpro.test', ONLYOFFICE_URL='http://oo.test', ONLYOFFICE_INTERNAL_URL='http://oo.test',
                   ONLYOFFICE_JWT_SECRET='test-secret-test-secret-test-secret!', AMS_INTERNAL_URL='http://ams.test')
class DesktopEditingTest(TestCase):
    """Word / LibreOffice open a document over WebDAV (documents/dav.py); their Save is a new version."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self._settings = override_settings(SUMMARY_ENABLED=False, DOCUMENT_UPLOAD_DIR=self.dir, MEDIA_ROOT=self.dir)
        self._settings.enable()
        self.owner = make_advocate(permissions=ALL_PERMISSIONS)
        self.case = make_case(self.owner)
        resp = self.client.post('/api/documents/new', {'kind': 'word', 'name': 'Reply', 'case_id': self.case.id},
                                content_type='application/json', **auth(self.owner))
        self.doc = Document.objects.get(id=resp.json()['id'])

    def tearDown(self):
        self._settings.disable()
        shutil.rmtree(self.dir, ignore_errors=True)

    def _links(self, user):
        return self.client.get(f'/api/desktop-links?kind=doc&id={self.doc.id}', **auth(user)).json()

    def _dav(self, method, url, body=b'', **headers):
        return self.client.generic(method, url.replace('http://pactpro.test', ''), body, **headers)

    def test_links_and_read(self):
        links = self._links(self.owner)
        self.assertTrue(links['editable'])
        self.assertTrue(links['office'].startswith('ms-word:ofe|u|http://pactpro.test/dav/'))
        self.assertEqual(links['officeApp'], 'Microsoft Word')
        self.assertEqual(self._dav('OPTIONS', links['url'])['DAV'], '1, 2')
        self.assertEqual(self._dav('PROPFIND', links['url']).status_code, 207)
        self.assertEqual(self._dav('GET', links['url']).content[:2], b'PK')
        self.assertEqual(self._dav('GET', '/dav/forged~token/x.docx').status_code, 404)

    def test_word_saves_a_working_copy_until_save_to_pactpro(self):
        url = self._links(self.owner)['url']
        locked = self._dav('LOCK', url)
        self.assertEqual(locked.status_code, 200)
        with open(self.doc.file_path, 'rb') as f:
            data = f.read()
        # Saving in Word three times: no new version, the working copy holds the latest.
        for edit in (b'1', b'2', data + b''):
            self.assertEqual(self._dav('PUT', url, data if edit == data else data[:-1] + edit).status_code, 204)
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.version, 1)
        self.assertEqual(self._dav('GET', url).content, data)          # Word reopens its own working copy
        work = self.client.get('/api/desktop-work', **auth(self.owner)).json()['items']
        self.assertEqual([(w['kind'], w['id'], w['open']) for w in work], [('doc', self.doc.id, True)])
        from .dav import desktop_lock
        self.assertTrue(desktop_lock('doc', self.doc.id)['pending'])
        other = make_advocate(permissions=ALL_PERMISSIONS + ('DOCUMENT_EDIT',), parent_advocate_id=self.owner.id)
        self.assertEqual(self._dav('LOCK', self._links(other)['url']).status_code, 423)
        self.assertEqual(self._dav('PUT', self._links(other)['url'], data).status_code, 423)
        self.assertEqual(self.client.post(f'/api/desktop-work/doc/{self.doc.id}', {'action': 'save'},
                                          content_type='application/json', **auth(other)).status_code, 404)
        self.assertEqual(self._dav('UNLOCK', url, HTTP_LOCK_TOKEN=locked['Lock-Token']).status_code, 204)
        self.assertTrue(desktop_lock('doc', self.doc.id)['pending'])   # closed, edits still to save
        copy = self.client.get(f'/api/desktop-work/doc/{self.doc.id}', **auth(self.owner))
        self.assertEqual(copy.content, data)
        saved = self.client.post(f'/api/desktop-work/doc/{self.doc.id}', {'action': 'save'},
                                 content_type='application/json', **auth(self.owner))
        self.assertEqual(saved.status_code, 200)
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.version, 2)                          # one version for all those saves
        self.assertIsNone(desktop_lock('doc', self.doc.id))

    def test_discard_drops_desktop_edits(self):
        url = self._links(self.owner)['url']
        self._dav('PUT', url, b'PK changed')
        resp = self.client.post(f'/api/desktop-work/doc/{self.doc.id}', {'action': 'discard'},
                                content_type='application/json', **auth(self.owner))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.client.get('/api/desktop-work', **auth(self.owner)).json()['items'], [])
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.version, 1)
        self.assertEqual(self._dav('GET', url).content[:2], b'PK')

    def test_read_only_users_cannot_save(self):
        reader = make_advocate(permissions=('DOCUMENT_VIEW',), parent_advocate_id=self.owner.id)
        links = self._links(reader)
        self.assertFalse(links['editable'])
        self.assertIn(':ofv|u|', links['office'])
        self.assertEqual(self._dav('LOCK', links['url']).status_code, 403)
        self.assertEqual(self._dav('PUT', links['url'], b'PK').status_code, 403)
        outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.assertEqual(self.client.get(f'/api/desktop-links?kind=doc&id={self.doc.id}',
                                         **auth(outsider)).status_code, 404)

    def test_save_to_pactpro_from_inside_the_desktop_program(self):
        """The LibreOffice / Word add-ons call <folder>/.pactpro/... with the file's own signed token."""
        url = self._links(self.owner)['url']
        folder = url.rsplit('/', 1)[0]
        status = self._dav('GET', f'{folder}/.pactpro/status').json()
        self.assertEqual((status['pending'], status['version']), (False, 1))
        self.assertEqual(self._dav('POST', f'{folder}/.pactpro/save').json()['code'], 'nothing')
        with open(self.doc.file_path, 'rb') as f:
            data = f.read()
        self._dav('PUT', url, data)
        self.assertTrue(self._dav('GET', f'{folder}/.pactpro/status').json()['pending'])
        saved = self._dav('POST', f'{folder}/.pactpro/save').json()
        self.assertEqual((saved['saved'], saved['version']), (True, 2))
        self.assertEqual(self._dav('POST', '/dav/forged~token/.pactpro/save').status_code, 404)
        reader = make_advocate(permissions=('DOCUMENT_VIEW',), parent_advocate_id=self.owner.id)
        rfolder = self._links(reader)['url'].rsplit('/', 1)[0]
        self.assertFalse(self._dav('GET', f'{rfolder}/.pactpro/status').json()['editable'])


@override_settings(ONLYOFFICE_URL='http://oo.test', ONLYOFFICE_INTERNAL_URL='http://oo.test',
                   ONLYOFFICE_JWT_SECRET='test-secret-test-secret-test-secret!', AMS_INTERNAL_URL='http://ams.test',
                   AMS_PUBLIC_URL='http://pactpro.test')
class BlankDocumentTest(DocumentEditorTest):
    """A new document nobody wrote in is removed when closed (documents/blank.py), not left in Documents."""

    def _exists(self, doc):
        return Document.objects.filter(id=doc.id).exists()

    def test_closed_unchanged_in_the_editor_is_removed(self):
        doc = self._new()
        self._callback(doc, {'status': 1, 'users': [str(self.owner.id)]})
        self._callback(doc, {'status': 4})
        self.assertFalse(self._exists(doc))

    def test_kept_once_anything_is_saved(self):
        doc = self._new()
        with open(doc.file_path, 'rb') as f:
            saved = f.read()
        with self.mock.patch('documents.editor.requests.get') as get:
            get.return_value = self.mock.Mock(content=saved, ok=True, raise_for_status=lambda: None)
            self._callback(doc, {'status': 2, 'url': 'http://oo.test/x', 'users': [str(self.owner.id)]})
        self.assertTrue(self._exists(doc))                     # closed with edits: a working copy waits
        other = self._new()
        with self.mock.patch('documents.editor.requests.get') as get:
            get.return_value = self.mock.Mock(content=saved, ok=True, raise_for_status=lambda: None)
            self._callback(other, {'status': 6, 'url': 'http://oo.test/x', 'users': [str(self.owner.id)],
                                   'userdata': 'pactpro'})
        self._callback(other, {'status': 4})
        self.assertTrue(self._exists(other))                   # saved to PactPro once: v2, kept

    def test_closed_unsaved_on_the_desktop_is_removed(self):
        doc = self._new()
        url = self.client.get(f'/api/desktop-links?kind=doc&id={doc.id}', **auth(self.owner)).json()['url']
        path = url.replace('http://pactpro.test', '')
        self.assertEqual(self.client.generic('LOCK', path).status_code, 200)
        self.client.generic('UNLOCK', path)
        self.assertFalse(self._exists(doc))

    def test_uploads_are_never_removed_and_the_sweep_waits_a_day(self):
        import datetime
        from .blank import sweep
        uploaded = make_document(self.owner, self.case, self.dir)
        new = self._new()
        self.assertEqual(sweep(), 0)                           # less than a day old
        self.assertEqual(sweep(datetime.timedelta(0)), 1)
        self.assertFalse(self._exists(new))
        self.assertTrue(self._exists(uploaded))
