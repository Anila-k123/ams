"""Phase 7: documents and drafts survive failures and retries.

A failed upload leaves no file behind, filenames never pick the storage path,
a version upload is all-or-nothing, a late or duplicate draft job can't wipe
a finished draft, and a failed regeneration keeps the previous draft.
"""
import datetime
import os
import shutil
import tempfile
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from core.models import Document, NotificationHistory
from core.testing import auth, make_advocate, make_case, make_firm, make_firm_member
from documents import storage


def _pdf(name='plaint.pdf'):
    return SimpleUploadedFile(name, b'%PDF-1.4 test', content_type='application/pdf')


def _files(root):
    out = []
    for base, _, names in os.walk(root):
        out += [os.path.join(base, n) for n in names]
    return out


class UploadFailureTests(TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        s = override_settings(DOCUMENT_UPLOAD_DIR=self.dir, SUMMARY_ENABLED=False)
        s.enable()
        self.addCleanup(s.disable)
        self.user = make_advocate(permissions=('DOCUMENT_VIEW', 'DOCUMENT_UPLOAD'))

    def test_a_failed_save_leaves_no_file(self):
        with mock.patch('documents.storage.Document.objects.create', side_effect=RuntimeError('db down')):
            with self.assertRaises(RuntimeError):
                storage.create_document(self.user, _pdf())
        self.assertEqual(_files(self.dir), [])
        self.assertFalse(Document.objects.exists())

    def test_an_interrupted_write_leaves_no_partial_file(self):
        f = _pdf()
        with mock.patch.object(f, 'chunks', side_effect=OSError('connection reset')):
            with self.assertRaises(OSError):
                storage.create_document(self.user, f)
        self.assertEqual(_files(self.dir), [])

    def test_the_uploaded_name_never_chooses_the_path(self):
        doc = storage.create_document(self.user, _pdf('../../..\\evil.PDF'))
        self.assertEqual(os.path.dirname(doc.file_path), os.path.join(self.dir, 'documents'))
        self.assertRegex(doc.stored_name, r'^[0-9a-f-]{36}\.pdf$')
        self.assertNotIn('..', doc.original_name)                   # display name only, never a path

    def test_a_failed_version_upload_keeps_the_document_as_it_was(self):
        doc = storage.create_document(self.user, _pdf())
        before = (doc.version, doc.stored_name)
        with mock.patch('documents.storage.DocumentVersion.objects.update_or_create',
                        side_effect=RuntimeError('db down')):
            with self.assertRaises(RuntimeError):
                storage.add_version(doc, _pdf('v2.pdf'), self.user)
        doc.refresh_from_db()
        self.assertEqual((doc.version, doc.stored_name), before)
        self.assertEqual(len(_files(self.dir)), 1)                     # only the original file

    def test_versions_are_kept(self):
        doc = storage.create_document(self.user, _pdf())
        storage.add_version(doc, _pdf('v2.pdf'), self.user, note='signed copy')
        doc.refresh_from_db()
        self.assertEqual(doc.version, 2)
        self.assertEqual(len(_files(self.dir)), 2)                     # the first file is not deleted


class DraftJobTests(TestCase):
    def setUp(self):
        from drafting.models import DraftBlock, DraftSession, Template
        self.DraftBlock, self.DraftSession = DraftBlock, DraftSession
        self.user = make_advocate(permissions=('DRAFT_VIEW', 'DRAFT_CREATE', 'DRAFT_EDIT'))
        self.session = DraftSession.objects.create(template=Template.objects.create(name='NDA'),
                                                   created_by_id=self.user.id, facts={}, status='ready')
        DraftBlock.objects.create(session=self.session, position=0, block_type='clause',
                                  text='Edited by the advocate', source='generated', is_edited=True)

    def _run(self):
        from drafting.tasks import generate_draft
        generate_draft.apply(args=[self.session.id])

    def test_a_late_job_does_not_wipe_a_finished_draft(self):
        with mock.patch('drafting.tasks._draft_template_mode') as gen:
            self._run()
        gen.assert_not_called()
        self.assertEqual(list(self.DraftBlock.objects.values_list('text', flat=True)), ['Edited by the advocate'])

    def test_a_failed_regeneration_keeps_the_previous_draft(self):
        self.DraftSession.objects.filter(id=self.session.id).update(status='pending')
        with mock.patch('drafting.tasks._draft_template_mode', side_effect=RuntimeError('LLM down')), \
                mock.patch('drafting.providers.llm.get_llm'), mock.patch('drafting.providers.embeddings.get_embeddings'):
            self._run()
        self.session.refresh_from_db()
        self.assertEqual(self.session.status, 'failed')
        self.assertEqual(list(self.DraftBlock.objects.values_list('text', flat=True)), ['Edited by the advocate'])

    @mock.patch('drafting.views._dispatch')
    def test_two_regenerate_clicks_start_one_run(self, dispatch):
        url = f'/api/drafting/draft-sessions/{self.session.id}/regenerate/'
        first = self.client.post(url, **auth(self.user))
        second = self.client.post(url, **auth(self.user))
        self.assertEqual((first.status_code, second.status_code), (200, 409))
        dispatch.assert_called_once()
        # The current draft stays until the new one is complete.
        self.assertTrue(self.DraftBlock.objects.filter(session=self.session).exists())


@override_settings(TENANCY_MODE='firm')
class ExportIsolationTests(TestCase):
    def test_notification_export_shows_only_this_firms_rows(self):
        a, b = make_firm('A'), make_firm('B')
        mover = make_firm_member(b)
        old_case = make_case(make_firm_member(a))
        now = datetime.datetime.now()
        # A row from the mover's time at firm A, about firm A's case.
        NotificationHistory.objects.create(advocate_id=mover.id, case_id=old_case.id, type='HEARING_REMINDER', channel='EMAIL', status='SENT',
                                           event_type='HEARING_REMINDER', subject='Firm A secret hearing',
                                           sent_at=now, created_at=now)
        NotificationHistory.objects.create(advocate_id=mover.id, type='HEARING_REMINDER', channel='EMAIL', status='SENT',
                                           event_type='WELCOME', subject='Own row', sent_at=now, created_at=now)
        csv = self.client.get('/api/communication/export/csv', **auth(mover)).content.decode()
        self.assertIn('Own row', csv)
        self.assertNotIn('Firm A secret hearing', csv)
