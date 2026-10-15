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

    @override_settings(DRAFT_EDITOR='onlyoffice', ONLYOFFICE_URL='http://oo.test', ONLYOFFICE_INTERNAL_URL='http://oo.test',
                       ONLYOFFICE_JWT_SECRET='test-secret-test-secret-test-secret!', AMS_INTERNAL_URL='http://ams.test',
                       AMS_PUBLIC_URL='http://pactpro.test')
    def test_draft_submitted_and_reviewed_from_the_desktop(self, notify):
        """LibreOffice / Word add-ons on a draft: the author's Submit files it on the case and hands it in
        (like the page's Submit to task); the reviewer approves there too."""
        import json
        from workspace.models import TaskSubmission
        session = self.draft(self.intern)

        def folder(who):
            url = self.client.get(f'/api/desktop-links?kind=draft&id={session.id}', **auth(who)).json()['url']
            return url.replace('http://pactpro.test', '').rsplit('/', 1)[0]

        def post(path, body):
            return self.client.generic('POST', path, json.dumps(body), content_type='application/json')

        mine = folder(self.intern)
        tasks = self.client.get(f'{mine}/.pactpro/status').json()['tasks']
        self.assertEqual([(t['id'], t['canSubmit'], t['canReview']) for t in tasks], [(self.task.id, True, False)])
        self.assertEqual(post(f'{mine}/.pactpro/submit', {'taskId': self.task.id, 'note': ''}).status_code, 400)
        resp = post(f'{mine}/.pactpro/submit', {'taskId': self.task.id, 'note': 'Plaint ready', 'hours': 2})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self.refresh().review_status, 'SUBMITTED')
        sub = TaskSubmission.objects.filter(task_id=self.task.id).first()
        self.assertIn('Plaint ready', sub.note)
        self.assertEqual((float(sub.hours), len(sub.documents)), (2.0, 1))             # filed as one document
        session.refresh_from_db()
        self.assertEqual(sub.documents[0]['id'], session.ams_document_id)
        theirs = folder(self.senior)
        tasks = self.client.get(f'{theirs}/.pactpro/status').json()['tasks']
        self.assertEqual([(t['canSubmit'], t['canReview']) for t in tasks], [(False, True)])
        resp = post(f'{theirs}/.pactpro/review', {'taskId': self.task.id, 'action': 'approve'})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self.refresh().review_status, 'APPROVED')

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


# The editor settings are set here, not taken from the machine's .env (New document needs them).
@override_settings(ONLYOFFICE_URL='http://oo.test', ONLYOFFICE_INTERNAL_URL='http://oo.test',
                   ONLYOFFICE_JWT_SECRET='test-secret-test-secret-test-secret!', AMS_INTERNAL_URL='http://ams.test')
class TaskDocumentWorkTest(TestCase):
    """A task keeps its document (Continue document) and the editor knows which task to submit it to."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self._settings = override_settings(SUMMARY_ENABLED=False, DOCUMENT_UPLOAD_DIR=self.dir, MEDIA_ROOT=self.dir)
        self._settings.enable()
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        self.intern = make_advocate(permissions=INTERN + ('DOCUMENT_UPLOAD', 'DOCUMENT_EDIT'),
                                    parent_advocate_id=self.senior.id)
        self.case = make_case(self.senior)
        self.task = CaseTask.objects.create(advocate_id=self.senior.id, case_id=self.case.id, title='Draft plaint',
                                            assigned_to_id=self.intern.id, assigned_by_id=self.senior.id)

    def tearDown(self):
        self._settings.disable()
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_task_document_details_and_submit_to_task(self):
        from documents.dav import put_work
        intern = self.intern
        resp = self.client.post('/api/documents/new', {'kind': 'word', 'name': 'Plaint', 'case_id': self.case.id},
                                content_type='application/json', **auth(intern))
        self.assertEqual(resp.status_code, 201, resp.content)
        doc_id = resp.json()['id']
        self.client.post(f'/api/workspace/tasks/{self.task.id}/documents', {'documentId': doc_id, 'submit': False},
                         content_type='application/json', **auth(intern))
        put_work('doc', doc_id, intern, 'Plaint.docx', b'PK edited')
        tasks = self.client.get(f'/api/workspace/cases/{self.case.id}/tasks', **auth(intern)).json()
        doc = [t for t in tasks if t['id'] == self.task.id][0]['documents'][0]
        self.assertEqual((doc['id'], doc['editable'], doc['pendingWork'], doc['version']), (doc_id, True, True, 1))
        # Someone else's view of the same task: no unsaved edits of theirs.
        tasks = self.client.get(f'/api/workspace/cases/{self.case.id}/tasks', **auth(self.senior)).json()
        self.assertFalse([t for t in tasks if t['id'] == self.task.id][0]['documents'][0]['pendingWork'])
        with override_settings(ONLYOFFICE_URL='http://oo.test', ONLYOFFICE_INTERNAL_URL='http://oo.test',
                               ONLYOFFICE_JWT_SECRET='test-secret-test-secret-test-secret!',
                               AMS_INTERNAL_URL='http://ams.test'):
            mine = self.client.get(f'/api/documents/{doc_id}/editor', **auth(intern)).json()['tasks']
            self.assertEqual([(t['id'], t['canSubmit']) for t in mine], [(self.task.id, True)])
            theirs = self.client.get(f'/api/documents/{doc_id}/editor', **auth(self.senior)).json()['tasks']
            self.assertEqual([(t['canSubmit'], t['canReview']) for t in theirs], [(False, False)])
            self.client.post(f'/api/workspace/tasks/{self.task.id}/submit', {'note': 'Done'},
                             content_type='application/json', **auth(intern))
            theirs = self.client.get(f'/api/documents/{doc_id}/editor', **auth(self.senior)).json()['tasks']
            self.assertEqual([t['canReview'] for t in theirs], [True])        # the reviewer decides there

    def test_only_the_chosen_documents_are_submitted_and_approved(self):
        from core.models import Document as Doc
        docs = []
        for name in ('Plaint', 'Client letter'):
            r = self.client.post('/api/documents/new', {'kind': 'word', 'name': name, 'case_id': self.case.id},
                                 content_type='application/json', **auth(self.intern))
            docs.append(r.json()['id'])
            self.client.post(f'/api/workspace/tasks/{self.task.id}/documents', {'documentId': docs[-1], 'submit': False},
                             content_type='application/json', **auth(self.intern))
        plaint, letter = docs
        resp = self.client.post(f'/api/workspace/tasks/{self.task.id}/submit',
                                {'note': 'Plaint ready', 'documentIds': [plaint]},
                                content_type='application/json', **auth(self.intern))
        self.assertEqual(resp.status_code, 200, resp.content)
        sub = resp.json()['submissions'][0]
        self.assertEqual([(d['id'], d['version']) for d in sub['documents']], [(plaint, 1)])
        with mock.patch('workspace.review._notify'):
            self.client.post(f'/api/workspace/tasks/{self.task.id}/review', {'action': 'approve'},
                             content_type='application/json', **auth(self.senior))
        self.assertEqual(Doc.objects.get(id=plaint).status, 'APPROVED')
        self.assertNotEqual(Doc.objects.get(id=letter).status, 'APPROVED')

    @override_settings(AMS_PUBLIC_URL='http://pactpro.test')
    def test_submit_and_review_from_the_desktop_add_ons(self):
        """Word / LibreOffice: .pactpro/status lists the task; submit (saves first), review (approve / changes)."""
        import json
        from core.models import Document as Doc

        def folder(who):
            url = self.client.get(f'/api/desktop-links?kind=doc&id={doc_id}', **auth(who)).json()['url']
            return url.replace('http://pactpro.test', '').rsplit('/', 1)[0], url.replace('http://pactpro.test', '')

        def post(path, body):
            return self.client.generic('POST', path, json.dumps(body), content_type='application/json')

        r = self.client.post('/api/documents/new', {'kind': 'word', 'name': 'Plaint', 'case_id': self.case.id},
                             content_type='application/json', **auth(self.intern))
        doc_id = r.json()['id']
        self.client.post(f'/api/workspace/tasks/{self.task.id}/documents', {'documentId': doc_id, 'submit': False},
                         content_type='application/json', **auth(self.intern))
        mine, file_url = folder(self.intern)
        tasks = self.client.get(f'{mine}/.pactpro/status').json()['tasks']
        self.assertEqual([(t['id'], t['canSubmit'], t['canReview']) for t in tasks], [(self.task.id, True, False)])
        data = self.client.get(file_url).content
        self.client.generic('PUT', file_url, data)                                   # edited, not in PactPro yet
        self.assertEqual(post(f'{mine}/.pactpro/submit', {'taskId': self.task.id, 'note': ''}).status_code, 400)
        resp = post(f'{mine}/.pactpro/submit', {'taskId': self.task.id, 'note': 'Plaint ready', 'hours': 2})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(Doc.objects.get(id=doc_id).version, 2)                     # saved first, then handed in
        theirs, _ = folder(self.senior)
        self.assertEqual(post(f'{mine}/.pactpro/review', {'taskId': self.task.id, 'action': 'approve'}).status_code, 403)
        with mock.patch('workspace.review._notify'):
            self.assertEqual(post(f'{theirs}/.pactpro/review', {'taskId': self.task.id, 'action': 'request_changes'})
                             .status_code, 400)                                     # a comment is needed
            resp = post(f'{theirs}/.pactpro/review', {'taskId': self.task.id, 'action': 'request_changes',
                                                      'note': 'Add the prayer.'})
            self.assertEqual(resp.status_code, 200)
            post(f'{mine}/.pactpro/submit', {'taskId': self.task.id, 'note': 'Prayer added'})
            resp = post(f'{theirs}/.pactpro/review', {'taskId': self.task.id, 'action': 'approve'})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.task.refresh_from_db()
        self.assertEqual(self.task.review_status, 'APPROVED')
        self.assertEqual(Doc.objects.get(id=doc_id).status, 'APPROVED')
        self.assertEqual(post(f'{mine}/.pactpro/submit', {'taskId': 999999, 'note': 'x'}).status_code, 404)

    def test_the_assignee_may_edit_and_submit_the_task_document(self):
        """A junior without DOCUMENT_EDIT still edits (and submits) their task's document in the editor."""
        from core.models import Document as Doc
        junior = make_advocate(permissions=INTERN + ('DOCUMENT_UPLOAD',), parent_advocate_id=self.senior.id)
        task = CaseTask.objects.create(advocate_id=self.senior.id, case_id=self.case.id, title='Synopsis',
                                       assigned_to_id=junior.id, assigned_by_id=self.senior.id)
        r = self.client.post('/api/documents/new', {'kind': 'word', 'name': 'Synopsis', 'case_id': self.case.id},
                             content_type='application/json', **auth(junior))
        doc_id = r.json()['id']
        Doc.objects.filter(id=doc_id).update(advocate_id=self.senior.id)     # owned by the practice root
        with override_settings(ONLYOFFICE_URL='http://oo.test', ONLYOFFICE_INTERNAL_URL='http://oo.test',
                               ONLYOFFICE_JWT_SECRET='test-secret-test-secret-test-secret!',
                               AMS_INTERNAL_URL='http://ams.test'):
            self.assertFalse(self.client.get(f'/api/documents/{doc_id}/editor', **auth(junior)).json()['editable'])
            self.client.post(f'/api/workspace/tasks/{task.id}/documents', {'documentId': doc_id, 'submit': False},
                             content_type='application/json', **auth(junior))
            data = self.client.get(f'/api/documents/{doc_id}/editor', **auth(junior)).json()
            self.assertTrue(data['editable'])
            self.assertEqual([(t['id'], t['canSubmit']) for t in data['tasks']], [(task.id, True)])
