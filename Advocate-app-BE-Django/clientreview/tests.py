"""Client review (docs/CLIENT_REVIEW.md): the firm sends a Word document to its client, the client marks up a
copy in the portal (or uploads one) and sends it back or approves; every round is on record."""

import datetime
import io
import json
import shutil
import tempfile
import zipfile
from unittest import mock

from django.test import TestCase, override_settings

from core.models import Advocate
from core.testing import ALL_PERMISSIONS, auth, make_advocate, make_case, make_client

from .models import ClientReview, ClientReviewRound
from .reviewcopy import review_copy

PASSWORD = 'Client@2026'
EDITOR = dict(ONLYOFFICE_URL='http://oo.test', ONLYOFFICE_INTERNAL_URL='http://oo.test',
              ONLYOFFICE_JWT_SECRET='test-secret-test-secret-test-secret!', AMS_INTERNAL_URL='http://ams.test',
              CLIENT_APP_URL='http://portal.test')


def _docx_with_comment_and_changes():
    """A Word file with an internal comment and an open tracked change (insertion + deletion)."""
    from docx import Document
    buf = io.BytesIO()
    Document().save(buf)
    zin = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
    W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    body = (f'<w:body><w:p><w:commentRangeStart w:id="1"/><w:r><w:t>Rent is Rs. </w:t></w:r>'
            f'<w:del w:id="2" w:author="Priya"><w:r><w:delText>40,000</w:delText></w:r></w:del>'
            f'<w:ins w:id="3" w:author="Priya"><w:r><w:t>45,000</w:t></w:r></w:ins>'
            f'<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p></w:body>')
    doc_xml = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{W}">{body}</w:document>'
    comments = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="{W}">'
                f'<w:comment w:id="1" w:author="Rajesh"><w:p><w:r><w:t>Internal: check with senior</w:t></w:r></w:p>'
                f'</w:comment></w:comments>')
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as z:
        for item in zin.infolist():
            z.writestr(item, doc_xml if item.filename == 'word/document.xml' else zin.read(item.filename))
        z.writestr('word/comments.xml', comments)
    return out.getvalue()


class ReviewCopyTest(TestCase):
    def test_internal_comments_removed_and_changes_accepted(self):
        data, editable = review_copy(_docx_with_comment_and_changes(), 'Lease.docx')
        self.assertTrue(editable)
        z = zipfile.ZipFile(io.BytesIO(data))
        doc, comments = z.read('word/document.xml').decode(), z.read('word/comments.xml').decode()
        self.assertNotIn('commentReference', doc)
        self.assertNotIn('Internal: check with senior', comments)
        self.assertNotIn('40,000', doc)                 # deletion accepted
        self.assertIn('45,000', doc)                    # insertion kept
        self.assertNotIn('<w:ins', doc)
        self.assertEqual(review_copy(b'%PDF', 'Order.pdf'), (b'%PDF', False))


@override_settings(**EDITOR, CLIENT_REVIEW_EDITOR=True)
class ClientReviewTest(TestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.dir = tempfile.mkdtemp()
        cls._settings = override_settings(SUMMARY_ENABLED=False, DOCUMENT_UPLOAD_DIR=cls.dir, MEDIA_ROOT=cls.dir)
        cls._settings.enable()

    @classmethod
    def tearDownClass(cls):
        cls._settings.disable()
        shutil.rmtree(cls.dir, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.senior = make_advocate(permissions=tuple(ALL_PERMISSIONS) + ('DOCUMENT_EDIT', 'DOCUMENT_VIEW',
                                                                          'DOCUMENT_UPLOAD'), full_name='Rajesh Kumar')
        self.kannan = make_client(self.senior, 'Kannan', email='kannan@client.test')
        self.other = make_client(self.senior, 'Other Client', email='other@client.test')
        self.case = make_case(self.senior, self.kannan, case_title='Lease for Kannan')
        self.kannan_login = self.create_login(self.kannan, 'kannan@client.test')
        self.other_login = self.create_login(self.other, 'b@other.test')
        resp = self.client.post('/api/documents/new', {'kind': 'word', 'name': 'Lease Agreement', 'case_id': self.case.id},
                                content_type='application/json', **auth(self.senior))
        self.assertEqual(resp.status_code, 201, resp.content)
        self.doc_id = resp.json()['id']

    def create_login(self, client, email):
        resp = self.client.post(f'/api/clients/{client.id}/logins', {'email': email, 'fullName': email.split('@')[0]},
                                content_type='application/json', **auth(self.senior))
        assert resp.status_code == 201, resp.content
        token = resp.json()['inviteUrl'].split('token=')[1]
        self.client.post('/api/client-auth/set-password', {'token': token, 'password': PASSWORD},
                         content_type='application/json')
        return Advocate.objects.get(email=email)

    def send(self, **body):
        return self.client.post(f'/api/documents/{self.doc_id}/client-reviews',
                                {'message': 'Please check the rent and names.', 'questions': ['Confirm the deposit'],
                                 **body}, content_type='application/json', **auth(self.senior))

    def queued(self, kind):
        from core.models import NotificationQueue
        return NotificationQueue.objects.filter(type=kind)

    def test_round_trip(self):
        resp = self.send(replyBy=(datetime.date.today() + datetime.timedelta(days=3)).isoformat())
        self.assertEqual(resp.status_code, 201, resp.content)
        rid = resp.json()['id']
        self.assertEqual(resp.json()['waitingOn'], 'client')
        self.assertTrue(self.queued('CLIENT_REVIEW_REQUEST').filter(payload_json__contains='kannan@client.test').exists())
        self.assertEqual(self.send().status_code, 409)                  # one open review per document

        # The client: their list, the review, the editor in review mode.
        items = self.client.get('/api/client/reviews', **auth(self.kannan_login)).json()['items']
        self.assertEqual([(i['id'], i['waiting']) for i in items], [(rid, True)])
        review = self.client.get(f'/api/client/reviews/{rid}', **auth(self.kannan_login)).json()
        self.assertEqual((review['questions'], review['canEdit']), (['Confirm the deposit'], True))
        cfg = self.client.get(f'/api/client/reviews/{rid}/editor', **auth(self.kannan_login)).json()['config']
        perms = cfg['document']['permissions']
        self.assertEqual((perms['edit'], perms['review'], cfg['editorConfig']['mode']), (False, True, 'edit'))
        # Another client sees nothing of it.
        self.assertEqual(self.client.get('/api/client/reviews', **auth(self.other_login)).json()['items'], [])
        self.assertEqual(self.client.get(f'/api/client/reviews/{rid}', **auth(self.other_login)).status_code, 404)

        # The editor saves the client's copy (signed callback); then they send it back with a photo.
        rnd = ClientReviewRound.objects.get(review_id=rid)
        self._callback(rnd, {'status': 2, 'url': 'http://oo.test/x'}, content=b'PK client edits')
        rnd.refresh_from_db()
        self.assertEqual(rnd.file.open('rb').read(), b'PK client edits')
        from django.core.files.uploadedfile import SimpleUploadedFile
        resp = self.client.post(f'/api/client/reviews/{rid}/reply',
                                {'action': 'changes', 'note': 'Rent should be 45,000.',
                                 'files': [SimpleUploadedFile('notes.png', b'\x89PNG')]}, **auth(self.kannan_login))
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(self.queued('CLIENT_REVIEW_REPLIED').filter(advocate_id=self.senior.id).exists())
        rnd.refresh_from_db()
        self.assertEqual(rnd.status, 'RETURNED')
        self._callback(rnd, {'status': 2, 'url': 'http://oo.test/x'}, content=b'PK late save')
        rnd.refresh_from_db()
        self.assertEqual(rnd.file.open('rb').read(), b'PK client edits')   # sent back: later saves ignored

        # The firm: the thread, the client's file, compare their copy in the editor.
        firm = self.client.get(f'/api/documents/{self.doc_id}/client-reviews', **auth(self.senior)).json()
        thread = firm['reviews'][0]['messages']
        self.assertEqual([m['kind'] for m in thread], ['sent', 'changes'])
        fid = thread[1]['files'][0]['id']
        self.assertEqual(self.client.get(f'/api/client-review-files/{fid}', **auth(self.senior)).status_code, 200)
        compare = self.client.post(f'/api/documents/{self.doc_id}/editor/compare', {'reviewRound': rnd.id},
                                   content_type='application/json', **auth(self.senior))
        self.assertEqual(compare.status_code, 200, compare.content)
        self.assertEqual(compare.json()['c'], 'compare')

        # Round 2, then the client approves it.
        resp = self.client.post(f'/api/client-reviews/{rid}/rounds', {'message': 'Updated the rent.'},
                                content_type='application/json', **auth(self.senior))
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual([r['status'] for r in resp.json()['rounds']], ['SUPERSEDED', 'SENT'])
        resp = self.client.post(f'/api/client/reviews/{rid}/reply', {'action': 'approve', 'note': 'Go ahead.'},
                                **auth(self.kannan_login))
        self.assertEqual(resp.status_code, 200, resp.content)
        review = ClientReview.objects.get(id=rid)
        self.assertEqual((review.status, review.approved_by_name), ('APPROVED', 'kannan'))
        self.assertTrue(self.queued('CLIENT_REVIEW_APPROVED').exists())
        self.assertEqual(self.client.post(f'/api/client/reviews/{rid}/reply', {'action': 'approve'},
                                          **auth(self.kannan_login)).status_code, 400)

    def _callback(self, rnd, body, content):
        import jwt
        from django.conf import settings
        from .service import _link
        link = _link('callback', rnd.id).replace('http://ams.test', '')
        body = {'key': rnd.key, **body}
        signed = jwt.encode({'payload': body}, settings.ONLYOFFICE_JWT_SECRET, algorithm='HS256')
        with mock.patch('requests.get') as get:
            get.return_value = mock.Mock(content=content, raise_for_status=lambda: None)
            return self.client.post(link, data=json.dumps(body), content_type='application/json',
                                    HTTP_AUTHORIZATION=f'Bearer {signed}')

    def test_rules(self):
        # A client without a portal login can't be sent anything; neither can a document with no client.
        no_login = make_client(self.senior, 'No Login', email='x@x.test')
        resp = self.client.post('/api/documents/new', {'kind': 'word', 'name': 'Notice',
                                                       'case_id': make_case(self.senior, no_login).id},
                                content_type='application/json', **auth(self.senior))
        r = self.client.post(f'/api/documents/{resp.json()["id"]}/client-reviews', {'message': 'x'},
                             content_type='application/json', **auth(self.senior))
        self.assertEqual(r.status_code, 400)
        self.assertIn('portal login', r.json()['error'])
        # Past reply-by date refused; a junior without DOCUMENT_EDIT can't send.
        self.assertEqual(self.send(replyBy='2020-01-01').status_code, 400)
        reader = make_advocate(permissions=('DOCUMENT_VIEW',), parent_advocate_id=self.senior.id)
        self.assertEqual(self.client.post(f'/api/documents/{self.doc_id}/client-reviews', {'message': 'x'},
                                          content_type='application/json', **auth(reader)).status_code, 403)
        # Another firm can't see the reviews.
        outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.assertEqual(self.client.get(f'/api/documents/{self.doc_id}/client-reviews',
                                         **auth(outsider)).status_code, 404)
        # Clients can't reach the firm endpoints; cancelled reviews vanish from the portal.
        rid = self.send().json()['id']
        self.assertEqual(self.client.get(f'/api/documents/{self.doc_id}/client-reviews',
                                         **auth(self.kannan_login)).status_code, 403)
        self.client.post(f'/api/client-reviews/{rid}/cancel', **auth(self.senior))
        self.assertEqual(self.client.get('/api/client/reviews', **auth(self.kannan_login)).json()['items'], [])

    def test_the_task_assignee_may_send_their_task_document(self):
        """A junior without DOCUMENT_EDIT sends the document of the task assigned to them; not other documents."""
        from workspace.models import CaseTask
        junior = make_advocate(permissions=('CASE_VIEW', 'DOCUMENT_VIEW', 'TASK_VIEW', 'DOCUMENT_UPLOAD'),
                               parent_advocate_id=self.senior.id)
        url = f'/api/documents/{self.doc_id}/client-reviews'
        self.assertFalse(self.client.get(url, **auth(junior)).json()['canSend'])
        self.assertEqual(self.client.post(url, {'message': 'x'}, content_type='application/json',
                                          **auth(junior)).status_code, 403)
        task = CaseTask.objects.create(advocate_id=self.senior.id, case_id=self.case.id, title='Lease',
                                       assigned_to_id=junior.id, assigned_by_id=self.senior.id)
        self.client.post(f'/api/workspace/tasks/{task.id}/documents', {'documentId': self.doc_id, 'submit': False},
                         content_type='application/json', **auth(junior))
        self.assertTrue(self.client.get(url, **auth(junior)).json()['canSend'])
        resp = self.client.post(url, {'message': 'Please check.'}, content_type='application/json', **auth(junior))
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(self.client.post(f'/api/client-reviews/{resp.json()["id"]}/messages', {'text': 'Any changes?'},
                                          **auth(junior)).status_code, 200)

    def test_portal_editor_is_off_by_default(self):
        """For now clients download, edit in their own Word and upload back (CLIENT_REVIEW_EDITOR off)."""
        rid = self.send().json()['id']
        with override_settings(CLIENT_REVIEW_EDITOR=False):
            review = self.client.get(f'/api/client/reviews/{rid}', **auth(self.kannan_login)).json()
            self.assertEqual((review['canEdit'], review['editorAvailable']), (False, False))
            self.assertEqual(self.client.get(f'/api/client/reviews/{rid}/editor', **auth(self.kannan_login)).json(),
                             {'enabled': False})
            download = self.client.get(f'/api/client/reviews/{rid}/file', **auth(self.kannan_login))
            self.assertEqual(download.status_code, 200)
            empty = self.client.post(f'/api/client/reviews/{rid}/reply', {'action': 'changes'}, **auth(self.kannan_login))
            self.assertEqual(empty.status_code, 400)                    # a file or a note is needed
            from django.core.files.uploadedfile import SimpleUploadedFile
            back = self.client.post(f'/api/client/reviews/{rid}/reply',
                                    {'action': 'changes', 'files': [SimpleUploadedFile('Lease - my changes.docx', b'PK')]},
                                    **auth(self.kannan_login))
            self.assertEqual(back.status_code, 200, back.content)

    def test_reminders(self):
        from .service import send_reminders
        rid = self.send(replyBy=datetime.date.today().isoformat()).json()['id']
        self.assertEqual(send_reminders(), 1)
        self.assertEqual(send_reminders(), 0)                          # not again for 3 days
        later = ClientReview.objects.get(id=rid).last_reminded_at + datetime.timedelta(days=3, minutes=1)
        self.assertEqual(send_reminders(now=later), 1)
        self.assertEqual(self.queued('CLIENT_REVIEW_REMINDER').count(), 2)
