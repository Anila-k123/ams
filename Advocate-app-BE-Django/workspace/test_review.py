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
        # No TASK_ASSIGN and not on the task: they cannot even see it (workspace.access).
        self.assertEqual(self.review(self.other_junior, 'approve').status_code, 404)
        partner = make_advocate(permissions=tuple(ALL_PERMISSIONS) + ('TASK_ASSIGN',),
                                parent_advocate_id=self.senior.id)
        self.assertEqual(self.review(partner, 'approve').status_code, 200)              # TASK_ASSIGN
        outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.assertEqual(self.review(outsider, 'approve').status_code, 404)

    def submit(self, who, note='Filed the vakalat; diary no. 45/2026.', hours=None):
        return self.client.post(f'/api/workspace/tasks/{self.task.id}/submit',
                                {'note': note, 'hours': hours},
                                content_type='application/json', **auth(who))

    def test_assignee_tick_asks_for_a_report_instead_of_submitting(self, notify):
        r = self.client.put(f'/api/workspace/tasks/{self.task.id}/toggle', **auth(self.intern))
        self.assertEqual(r.status_code, 400)
        self.assertTrue(r.json()['submitRequired'])
        self.assertIsNone(self.refresh().review_status)
        body = self.client.put(f'/api/workspace/tasks/{self.task.id}/toggle', **auth(self.senior)).json()
        self.assertTrue(body['completed'])   # the assigner can still close it directly

    def test_submit_work_with_a_report(self, notify):
        body = self.submit(self.intern, hours=1.5).json()
        self.assertEqual(body['reviewStatus'], 'SUBMITTED')
        self.assertEqual(body['submissions'][0]['note'], 'Filed the vakalat; diary no. 45/2026.')
        self.assertEqual(body['submissions'][0]['hours'], 1.5)
        notify.assert_called()

    def test_submit_needs_a_report_and_the_assignee(self, notify):
        self.assertEqual(self.submit(self.intern, note='  ').status_code, 400)
        self.assertEqual(self.submit(self.senior).status_code, 403)

    def test_resubmitting_after_changes_keeps_every_round(self, notify):
        self.submit(self.intern, note='First pass')
        self.review(self.senior, 'request_changes', note='Add the diary number')
        body = self.submit(self.intern, note='Diary no. 45/2026 added').json()
        self.assertEqual([s['note'] for s in body['submissions']],
                         ['Diary no. 45/2026 added', 'First pass'])
        self.assertEqual(self.review(self.senior, 'approve').json()['completed'], True)

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


    # -- a resubmitted draft records what changed since the last submission, so
    #    the reviewer can check a revision without rereading the whole draft --

    def _latest(self):
        from workspace.models import TaskSubmission
        return TaskSubmission.objects.filter(task_id=self.task.id).first()

    def test_a_revision_records_the_changed_section_and_the_authors_note(self, notify):
        from drafting.models import DraftBlock
        self.assertEqual(self.file_draft(self.intern).status_code, 200)
        self.assertIsNone(self._latest().changes, 'a first submission has nothing to compare')

        self.review(self.senior, 'request_changes', 'State the arrears as a figure.')
        session = self.draft(self.intern)
        DraftBlock.objects.filter(session=session).update(
            text='The plaintiff states as follows. Arrears of Rs. 3,15,000 are due.')
        DraftBlock.objects.create(session=session, position=1, block_type='clause',
                                  heading='Prayer', text='Decree for possession.')
        resp = self.client.post(f'/api/drafting/drafts/{session.id}/send-to-ams/',
                                {'note': 'Added the arrears figure and a prayer.'},
                                content_type='application/json', **auth(self.intern))
        self.assertEqual(resp.status_code, 200, resp.content[:300])

        latest = self._latest()
        self.assertIn('filed as version 2', latest.note)
        self.assertIn('Added the arrears figure and a prayer.', latest.note)
        kinds = {c['heading']: c['kind'] for c in latest.changes}
        self.assertEqual(kinds, {'Plaint': 'edited', 'Prayer': 'added'})
        edited = next(c for c in latest.changes if c['heading'] == 'Plaint')
        self.assertIn('3,15,000', edited['after'])
        self.assertNotIn('3,15,000', edited['before'])

    def test_the_task_api_sends_changes_but_not_the_snapshot(self, notify):
        self.file_draft(self.intern)
        rows = self.client.get('/api/workspace/tasks/all', **auth(self.senior)).json()
        rows = rows.get('content', rows) if isinstance(rows, dict) else rows
        task = next(t for t in rows if t['id'] == self.task.id)
        sub = task['submissions'][0]
        self.assertIn('changes', sub)
        self.assertNotIn('draftSnapshot', sub)
        self.assertNotIn('draft_snapshot', sub)


class CompareDraftsTest(TestCase):
    def test_reordered_sections_pair_by_heading(self):
        from workspace.review import compare_drafts
        prev = [{'heading': 'A', 'text': 'one'}, {'heading': 'B', 'text': 'two'}]
        cur = [{'heading': 'B', 'text': 'two'}, {'heading': 'A', 'text': 'one'}]
        self.assertEqual(compare_drafts(prev, cur), [])

    def test_removed_and_whitespace_only(self):
        from workspace.review import compare_drafts
        prev = [{'heading': 'A', 'text': 'one  two'}, {'heading': 'B', 'text': 'gone'}]
        cur = [{'heading': 'a', 'text': 'one two'}]
        self.assertEqual(compare_drafts(prev, cur),
                         [{'heading': 'B', 'kind': 'removed', 'before': 'gone', 'after': ''}])
        self.assertIsNone(compare_drafts(None, cur))
