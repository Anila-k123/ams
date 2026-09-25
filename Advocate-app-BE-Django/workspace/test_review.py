"""Senior review of delegated tasks (workspace/review.py), incl. interns filing
drafts on tasks assigned to them (drafting/filing.py, merge phase 07)."""

import datetime
import shutil
import tempfile
from unittest import mock

from django.test import TestCase, override_settings

from core.models import Document
from core.testing import ALL_PERMISSIONS, auth, make_advocate, make_case
from workspace.models import CaseTask, CaseTaskDocument

# The seeded Intern role (drafting codes from seed_drafting_permissions).
INTERN = ('CASE_VIEW', 'DOCUMENT_VIEW', 'TASK_VIEW', 'DRAFT_VIEW', 'DRAFT_CREATE')


@mock.patch('workspace.review._notify')
class TaskReviewTest(TestCase):
    databases = {'default'}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.dir = tempfile.mkdtemp()
        cls._settings = override_settings(SUMMARY_ENABLED=False, DOCUMENT_UPLOAD_DIR=cls.dir,
                                          MEDIA_ROOT=cls.dir)
        cls._settings.enable()

    @classmethod
    def tearDownClass(cls):
        cls._settings.disable()
        shutil.rmtree(cls.dir, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        self.intern = make_advocate(permissions=INTERN, parent_advocate_id=self.senior.id)
        self.other_junior = make_advocate(permissions=('CASE_VIEW', 'TASK_VIEW'),
                                          parent_advocate_id=self.senior.id)
        self.case = make_case(self.senior)
        self.task = CaseTask.objects.create(advocate_id=self.senior.id, case_id=self.case.id,
                                            title='Draft plaint', assigned_to_id=self.intern.id,
                                            assigned_by_id=self.senior.id)
        self._drafts = {}

    def draft(self, who, task=None, ref='s-1'):
        """One draft session per (who, task, ref); re-filing it adds a version."""
        from drafting.ams_cases import link_case
        from drafting.models import DraftBlock, DraftSession, Template
        key = (who.id, (task or self.task).id if task is not False else None, ref)
        if key not in self._drafts:
            client, project = link_case(self.case)
            template, _ = Template.objects.get_or_create(name='Plaint', document_type='plaint')
            session = DraftSession.objects.create(
                template=template, client=client, project=project, created_by_id=who.id,
                ams_task_id=key[1], facts={}, status='ready')
            DraftBlock.objects.create(session=session, position=0, block_type='clause',
                                      heading='Plaint', text='The plaintiff states as follows.')
            self._drafts[key] = session
        return self._drafts[key]

    def file_draft(self, who, task=None, ref='s-1'):
        session = self.draft(who, task, ref)
        return self.client.post(f'/api/drafting/drafts/{session.id}/send-to-ams/', {},
                                content_type='application/json', **auth(who))

    def review(self, who, action, note=''):
        return self.client.post(f'/api/workspace/tasks/{self.task.id}/review',
                                {'action': action, 'note': note},
                                content_type='application/json', **auth(who))

    def refresh(self):
        self.task.refresh_from_db()
        return self.task

    # -- 1. interns can file their own work -----------------------------------

    def test_intern_files_draft_on_own_task_and_it_is_submitted(self, notify):
        resp = self.file_draft(self.intern)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['reviewStatus'], 'SUBMITTED')
        self.assertEqual(self.refresh().review_status, 'SUBMITTED')
        self.assertFalse(self.task.completed)
        self.assertEqual(notify.call_args.args[0], self.senior.id)   # the senior is told
        self.assertEqual(notify.call_args.args[3], 'TASK_SUBMITTED')

    def test_no_upload_right_and_not_own_task_is_forbidden(self, notify):
        other = CaseTask.objects.create(advocate_id=self.senior.id, case_id=self.case.id, title='Other',
                                        assigned_to_id=self.senior.id, assigned_by_id=self.senior.id)
        self.assertEqual(self.file_draft(self.intern, task=other).status_code, 403)
        resp = self.file_draft(self.intern, task=False, ref='s-2')         # no task at all
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(Document.objects.count(), 0)

    # -- 2. review -------------------------------------------------------------

    def test_approve_completes_task_and_marks_documents(self, notify):
        doc_id = self.file_draft(self.intern).json()['documentId']
        resp = self.review(self.senior, 'approve', 'Good work')
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual((body['reviewStatus'], body['completed'], body['reviewNote']),
                         ('APPROVED', True, 'Good work'))
        self.assertEqual(Document.objects.get(id=doc_id).status, 'APPROVED')
        self.assertEqual(notify.call_args.args[0], self.intern.id)

    def test_request_changes_then_resubmit_then_approve(self, notify):
        self.file_draft(self.intern)
        self.assertEqual(self.review(self.senior, 'request_changes').status_code, 400)  # note required
        resp = self.review(self.senior, 'request_changes', 'Add the cause of action')
        self.assertEqual(resp.json()['reviewStatus'], 'CHANGES_REQUESTED')
        self.assertFalse(self.refresh().completed)
        self.assertEqual(self.review(self.senior, 'approve').status_code, 400)   # not resubmitted yet
        self.assertEqual(self.file_draft(self.intern).json()['version'], 2)
        self.assertEqual(self.refresh().review_status, 'SUBMITTED')
        self.assertEqual(self.review(self.senior, 'approve').json()['reviewStatus'], 'APPROVED')

    def test_who_may_review(self, notify):
        self.file_draft(self.intern)
        self.assertEqual(self.review(self.intern, 'approve').status_code, 403)          # own work
        self.assertEqual(self.review(self.other_junior, 'approve').status_code, 403)    # no TASK_ASSIGN
        partner = make_advocate(permissions=tuple(ALL_PERMISSIONS) + ('TASK_ASSIGN',),
                                parent_advocate_id=self.senior.id)
        self.assertEqual(self.review(partner, 'approve').status_code, 200)              # TASK_ASSIGN
        outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.assertEqual(self.review(outsider, 'approve').status_code, 404)

    def test_assignee_ticking_done_submits_instead_of_completing(self, notify):
        body = self.client.put(f'/api/workspace/tasks/{self.task.id}/toggle', **auth(self.intern)).json()
        self.assertEqual((body['completed'], body['reviewStatus']), (False, 'SUBMITTED'))
        body = self.client.put(f'/api/workspace/tasks/{self.task.id}/toggle', **auth(self.senior)).json()
        self.assertTrue(body['completed'])   # the assigner can still close it directly

    def test_attaching_a_document_in_ams_submits(self, notify):
        doc = Document.objects.create(document_name='d', original_name='d.pdf', stored_name='d',
                                      file_path='x', version=1, download_count=0, status='ACTIVE',
                                      advocate_id=self.intern.id, case=self.case,
                                      upload_date=datetime.datetime.now())
        self.client.post(f'/api/workspace/tasks/{self.task.id}/documents', {'documentId': doc.id},
                         content_type='application/json', **auth(self.intern))
        self.assertEqual(self.refresh().review_status, 'SUBMITTED')
        self.assertTrue(CaseTaskDocument.objects.filter(task_id=self.task.id, document_id=doc.id).exists())

    def test_self_assigned_tasks_skip_review(self, notify):
        own = CaseTask.objects.create(advocate_id=self.senior.id, case_id=self.case.id, title='Mine')
        body = self.client.put(f'/api/workspace/tasks/{own.id}/toggle', **auth(self.senior)).json()
        self.assertEqual((body['completed'], body['reviewStatus'], body['needsReview']), (True, None, False))
        notify.assert_not_called()
