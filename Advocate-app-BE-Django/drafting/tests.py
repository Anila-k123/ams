"""Merge phase 02: drafting authenticates as the AMS advocate and records who did what
by plain advocate id, in its own database."""

import tempfile
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from core.testing import ALL_PERMISSIONS, auth, make_advocate

from .models import Client, DraftSession, Project, Sample, Template


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix='drafting-test-'))
@mock.patch('drafting.views._dispatch')      # no parsing / LLM calls in tests
class DraftingAuthTest(TestCase):
    databases = {'default', 'drafting'}

    def setUp(self):
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        self.junior = make_advocate(permissions=ALL_PERMISSIONS, parent_advocate_id=self.senior.id)
        self.outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.client_row = Client.objects.create(name='Sharma Traders')
        self.project = Project.objects.create(client=self.client_row, name='OS/12/2026')

    def upload(self, advocate, name='NDA.pdf'):
        return self.client.post('/api/drafting/samples/', {
            'file': SimpleUploadedFile(name, b'%PDF-1.4 test'), 'name': name,
            'client': self.client_row.id, 'project': self.project.id}, **auth(advocate))

    def test_upload_records_the_ams_advocate(self, dispatch):
        resp = self.upload(self.junior)
        self.assertEqual(resp.status_code, 201, resp.content)
        sample = Sample.objects.get(id=resp.json()['id'])
        self.assertEqual(sample.uploaded_by_id, self.junior.id)
        dispatch.assert_called_once()

    def test_documents_shared_within_the_practice_only(self, dispatch):
        mine = Sample.objects.get(id=self.upload(self.junior).json()['id'])
        Sample.objects.create(name='Other firm.pdf', file='x.pdf', uploaded_by_id=self.outsider.id)
        for who in (self.senior, self.junior):
            ids = [s['id'] for s in self.client.get('/api/drafting/samples/', **auth(who)).json()['results']]
            self.assertEqual(ids, [mine.id])
        self.assertEqual(self.client.get('/api/drafting/samples/', **auth(self.outsider)).json()['count'], 1)
        self.assertEqual(self.client.get(f'/api/drafting/samples/{mine.id}/', **auth(self.outsider)).status_code, 404)

    def test_draft_sessions_are_the_creators(self, dispatch):
        template = Template.objects.create(name='Mutual NDA', document_type='nda')
        mine = DraftSession.objects.create(template=template, created_by_id=self.senior.id, facts={}, status='ready')
        DraftSession.objects.create(template=template, created_by_id=self.junior.id, facts={}, status='ready')
        body = self.client.get('/api/drafting/draft-sessions/', **auth(self.senior)).json()
        self.assertEqual([s['id'] for s in body['results']], [mine.id])
        self.assertEqual(set(body), {'count', 'next', 'previous', 'results'})   # InstaDraft's paging shape

    def test_login_required_and_clients_refused(self, dispatch):
        self.assertEqual(self.client.get('/api/drafting/samples/').status_code, 401)
        from clientaccess.models import ClientUser
        from core.testing import make_client
        client_login = make_advocate()
        ClientUser.objects.create(advocate_id=client_login.id, client_id=make_client(self.senior).id)
        self.assertEqual(self.client.get('/api/drafting/samples/', **auth(client_login)).status_code, 403)


# Merge phase 03: drafting uses AMS's permission codes (seed_drafting_permissions).
INTERN = ('DRAFT_VIEW', 'DRAFT_CREATE')
JUNIOR = INTERN + ('DRAFT_EXPORT',)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix='drafting-test-'))
class DraftingPermissionTest(TestCase):
    databases = {'default', 'drafting'}

    def setUp(self):
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        self.intern = make_advocate(permissions=INTERN, parent_advocate_id=self.senior.id)
        self.junior = make_advocate(permissions=JUNIOR, parent_advocate_id=self.senior.id)
        self.nobody = make_advocate(permissions=('CASE_VIEW',), parent_advocate_id=self.senior.id)
        self.template = Template.objects.create(name='Mutual NDA', document_type='nda')

    def test_no_drafting_codes_means_no_drafting(self):
        for url in ('/api/drafting/samples/', '/api/drafting/templates/', '/api/drafting/draft-sessions/',
                    '/api/drafting/playbooks/', '/api/drafting/playbook-clauses/'):
            self.assertEqual(self.client.get(url, **auth(self.nobody)).status_code, 403, url)

    def test_view_code_reads_but_shared_setup_needs_manage(self):
        self.assertEqual(self.client.get('/api/drafting/templates/', **auth(self.intern)).status_code, 200)
        self.assertEqual(self.client.get('/api/drafting/playbooks/', **auth(self.intern)).status_code, 200)
        for who in (self.intern, self.junior):
            self.assertEqual(self.client.delete(f'/api/drafting/templates/{self.template.id}/',
                                                **auth(who)).status_code, 403)
        self.assertEqual(self.client.delete(f'/api/drafting/templates/{self.template.id}/',
                                            **auth(self.senior)).status_code, 204)

    def test_playbooks_no_longer_open(self):
        # InstaDraft had permission_classes = [] on these; inside AMS that would be public.
        self.assertEqual(self.client.get('/api/drafting/playbooks/').status_code, 401)
        self.assertEqual(self.client.get('/api/drafting/playbook-clauses/').status_code, 401)

    def test_export_needs_export_code(self):
        from django.urls import reverse
        for who, expected in ((self.intern, 403), (self.junior, 200)):
            session = DraftSession.objects.create(template=self.template, created_by_id=who.id,
                                                  facts={}, status='ready')
            url = f'/api/drafting/drafts/{session.id}/export/docx/'
            resp = self.client.get(url, **auth(who))
            self.assertEqual(resp.status_code, expected, (url, resp.content[:200]))
        self.assertIn('attachment', resp['Content-Disposition'])


    def test_client_project_member_endpoints_are_gone(self):
        # Merge phase 08: drafting clients/projects are mirrors of AMS clients/cases
        # (link-case, uploads with case_id); they had no practice scope as endpoints.
        for url in ('/api/drafting/clients/', '/api/drafting/projects/', '/api/drafting/members/'):
            self.assertEqual(self.client.get(url, **auth(self.senior)).status_code, 404, url)


# Merge phase 04: AMS cases/documents in-process, and files behind the login.
@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix='drafting-test-'))
@mock.patch('drafting.views._dispatch')
class DraftingAmsInProcessTest(TestCase):
    databases = {'default', 'drafting'}

    def setUp(self):
        from core.testing import make_case, make_client as make_ams_client
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        self.junior = make_advocate(permissions=ALL_PERMISSIONS, parent_advocate_id=self.senior.id)
        self.outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.ams_client = make_ams_client(self.senior, name='Sharma Traders')
        self.case = make_case(self.senior, self.ams_client, case_title='Sharma v. State')
        self.foreign_case = make_case(self.outsider, make_ams_client(self.outsider))

    def ams_document(self, owner, name='Plaint.pdf', body=b'%PDF-1.4 plaint'):
        import datetime, os
        from core.models import Document
        from django.conf import settings
        path = os.path.join(settings.MEDIA_ROOT, f'ams-{owner.id}-{name}')
        with open(path, 'wb') as fh:
            fh.write(body)
        return Document.objects.create(document_name=name.rsplit('.', 1)[0], original_name=name, stored_name=name,
                                       file_path=path, version=1, upload_date=datetime.datetime.now(),
                                       advocate_id=owner.id, case=self.case if owner == self.senior else None)

    def test_cases_are_the_practices(self, dispatch):
        body = self.client.get('/api/drafting/ams-cases/', **auth(self.junior)).json()
        self.assertEqual([c['id'] for c in body['content']], [self.case.id])

    def test_link_case_creates_project_once(self, dispatch):
        from workspace.models import CaseParty, CaseTask
        CaseParty.objects.create(advocate_id=self.senior.id, case_id=self.case.id, name='State of TN', is_opponent=True)
        task = CaseTask.objects.create(advocate_id=self.senior.id, case_id=self.case.id, title='Draft plaint')
        first = self.client.post('/api/drafting/link-case/', {'caseId': self.case.id, 'taskId': task.id},
                                 content_type='application/json', **auth(self.junior))
        self.assertEqual(first.status_code, 200, first.content)
        data = first.json()
        self.assertEqual(data['prefill']['party_a_name'], 'Sharma Traders')
        self.assertEqual(data['prefill']['party_b_name'], 'State of TN')
        self.assertEqual(data['task']['id'], task.id)
        again = self.client.post('/api/drafting/link-case/', {'caseId': self.case.id},
                                 content_type='application/json', **auth(self.senior)).json()
        self.assertEqual(again['projectId'], data['projectId'])
        self.assertEqual(Project.objects.get(id=data['projectId']).case_id, self.case.id)
        self.assertEqual(self.client.post('/api/drafting/link-case/', {'caseId': self.foreign_case.id},
                                          content_type='application/json', **auth(self.senior)).status_code, 404)

    def test_documents_list_and_import(self, dispatch):
        mine = self.ams_document(self.senior)
        self.ams_document(self.outsider, 'Theirs.pdf')
        self.ams_document(self.senior, 'photo.jpg')                  # not draftable
        rows = self.client.get('/api/drafting/ams-documents/', **auth(self.junior)).json()['content']
        self.assertEqual([r['id'] for r in rows], [mine.id])
        self.assertIsNone(rows[0]['sample'])
        resp = self.client.post(f'/api/drafting/ams-documents/{mine.id}/import/', **auth(self.junior))
        self.assertEqual(resp.status_code, 200, resp.content)
        sample = Sample.objects.get(id=resp.json()['id'])
        self.assertEqual((sample.ams_document_id, sample.uploaded_by_id), (mine.id, self.junior.id))
        Sample.objects.filter(id=sample.id).update(status='ready')     # processing finished
        sample.refresh_from_db()
        again = self.client.post(f'/api/drafting/ams-documents/{mine.id}/import/', **auth(self.senior)).json()
        self.assertEqual(again['id'], sample.id)                      # shared across the practice
        self.assertEqual(dispatch.call_count, 1)
        row = self.client.get('/api/drafting/ams-documents/', **auth(self.senior)).json()['content'][0]
        self.assertEqual(row['sample'], {'id': sample.id, 'status': sample.status, 'current': True})

    def test_stuck_pending_import_is_retried(self, dispatch):
        doc = self.ams_document(self.senior)
        first = self.client.post(f'/api/drafting/ams-documents/{doc.id}/import/', **auth(self.senior)).json()
        # Its job never ran (still pending): importing again re-dispatches it.
        again = self.client.post(f'/api/drafting/ams-documents/{doc.id}/import/', **auth(self.senior)).json()
        self.assertEqual(again['id'], first['id'])
        self.assertEqual(dispatch.call_count, 2)
        Sample.objects.filter(id=first['id']).update(status='processing')
        self.client.post(f'/api/drafting/ams-documents/{doc.id}/import/', **auth(self.senior))
        self.assertEqual(dispatch.call_count, 2)                      # in flight: left alone

    def test_files_need_login_and_practice(self, dispatch):
        resp = self.client.post('/api/drafting/samples/', {
            'file': SimpleUploadedFile('NDA.pdf', b'%PDF-1.4 secret'), 'name': 'NDA.pdf'}, **auth(self.junior))
        url = resp.json()['file']
        self.assertIn('/api/drafting/samples/', url)
        self.assertTrue(url.endswith('.pdf'))
        path = url.split('testserver', 1)[1]
        self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.client.get(path, **auth(self.outsider)).status_code, 404)
        ok = self.client.get(path, **auth(self.senior))
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(b''.join(ok.streaming_content), b'%PDF-1.4 secret')


# Merge phase 04: uploads pick an AMS case; the drafting client/project follow from it.
@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix='drafting-test-'))
@mock.patch('drafting.views._dispatch')
class DraftingUploadCaseTest(TestCase):
    databases = {'default', 'drafting'}

    def setUp(self):
        from core.testing import make_case, make_client as make_ams_client
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        self.outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.case = make_case(self.senior, make_ams_client(self.senior, name='Sharma Traders'))
        self.foreign = make_case(self.outsider, make_ams_client(self.outsider))

    def upload(self, **extra):
        return self.client.post('/api/drafting/samples/', {
            'file': SimpleUploadedFile('Plaint.pdf', b'%PDF-1.4 x'), 'name': 'Plaint.pdf', **extra},
            **auth(self.senior))

    def test_case_sets_client_and_project(self, dispatch):
        resp = self.upload(case_id=self.case.id)
        self.assertEqual(resp.status_code, 201, resp.content)
        sample = Sample.objects.get(id=resp.json()['id'])
        self.assertEqual(sample.project.case_id, self.case.id)
        self.assertEqual(sample.client.name, 'Sharma Traders')

    def test_client_and_project_cannot_be_set_directly(self, dispatch):
        from drafting.ams_cases import link_case
        foreign_client, foreign_project = link_case(self.foreign)
        resp = self.upload(client=foreign_client.id, project=foreign_project.id)
        self.assertEqual(resp.status_code, 201, resp.content)
        sample = Sample.objects.get(id=resp.json()['id'])
        self.assertEqual((sample.client_id, sample.project_id), (None, None))

    def test_no_case_is_fine(self, dispatch):
        resp = self.upload()
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertIsNone(Sample.objects.get(id=resp.json()['id']).project_id)

    def test_other_firms_case_refused(self, dispatch):
        self.assertEqual(self.upload(case_id=self.foreign.id).status_code, 400)
        self.assertFalse(Sample.objects.exists())


# Merge phase 05: creating a draft session (the new-draft wizard's last call).
@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix='drafting-test-'))
@mock.patch('drafting.views._dispatch')
@mock.patch('drafting.serializers._dispatch', create=True)
class DraftSessionCreateTest(TestCase):
    databases = {'default', 'drafting'}

    def setUp(self):
        from core.testing import make_case, make_client as make_ams_client
        from drafting.ams_cases import link_case
        from workspace.models import CaseTask
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        self.outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.template = Template.objects.create(name='Mutual NDA', document_type='nda', status='ready')
        self.case = make_case(self.senior, make_ams_client(self.senior))
        self.client_row, self.project = link_case(self.case)
        self.task = CaseTask.objects.create(advocate_id=self.senior.id, case_id=self.case.id, title='Draft NDA')
        foreign_case = make_case(self.outsider, make_ams_client(self.outsider))
        _, self.foreign_project = link_case(foreign_case)

    def create(self, **body):
        data = {'template': self.template.id, 'samples': [], 'facts': {}, 'llm': 'gemini', 'mode': 'library', **body}
        return self.client.post('/api/drafting/draft-sessions/', data, content_type='application/json',
                                **auth(self.senior))

    def test_from_scratch_needs_no_member_or_case(self, *mocks):
        resp = self.create()
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(DraftSession.objects.get(id=resp.json()['id']).created_by_id, self.senior.id)

    def test_case_and_task_link(self, *mocks):
        resp = self.create(client=self.client_row.id, project=self.project.id, ams_task_id=self.task.id)
        self.assertEqual(resp.status_code, 201, resp.content)
        session = DraftSession.objects.get(id=resp.json()['id'])
        self.assertEqual((session.project.case_id, session.ams_task_id), (self.case.id, self.task.id))

    def test_other_firms_project_refused(self, *mocks):
        self.assertEqual(self.create(project=self.foreign_project.id).status_code, 400)

    def test_task_from_another_case_refused(self, *mocks):
        from workspace.models import CaseTask
        other = CaseTask.objects.create(advocate_id=self.senior.id, case_id=None, title='Unrelated')
        self.assertEqual(self.create(project=self.project.id, ams_task_id=other.id).status_code, 400)


# drafting/jobs.py: where background jobs run.
class JobDispatchTest(TestCase):
    databases = {'default', 'drafting'}

    def test_celery_when_not_eager(self):
        from drafting import jobs
        task = mock.Mock(name='task')
        with override_settings(CELERY_TASK_ALWAYS_EAGER=False):
            jobs.dispatch(task, 5)
        task.delay.assert_called_once_with(5)

    def test_worker_process_by_default(self):
        from drafting import jobs
        task = mock.Mock()
        task.name = 'drafting.tasks.process_sample'
        with override_settings(CELERY_TASK_ALWAYS_EAGER=True, DRAFTING_JOB_RUNNER='process'), \
                mock.patch.object(jobs, '_get_pool') as pool:
            jobs.dispatch(task, 7)
        pool.return_value.submit.assert_called_once_with(jobs._run_in_worker, 'drafting.tasks.process_sample', [7])
        task.apply.assert_not_called()                      # nothing ran in the web process

    def test_dead_worker_is_replaced_once(self):
        from concurrent.futures.process import BrokenProcessPool
        from drafting import jobs
        task = mock.Mock()
        task.name = 'drafting.tasks.process_sample'
        broken, healthy = mock.Mock(), mock.Mock()
        broken.submit.side_effect = BrokenProcessPool()
        with override_settings(CELERY_TASK_ALWAYS_EAGER=True, DRAFTING_JOB_RUNNER='process'), \
                mock.patch.object(jobs, '_get_pool', side_effect=[broken, healthy]), \
                mock.patch.object(jobs, '_reset_pool') as reset:
            jobs.dispatch(task, 9)
        reset.assert_called_once()
        healthy.submit.assert_called_once()


# Senior review of a junior's draft in the editor (drafting/access.py).
@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix='drafting-test-'))
@mock.patch('drafting.views._dispatch')
class DraftReviewAccessTest(TestCase):
    databases = {'default', 'drafting'}

    def setUp(self):
        from core.testing import make_case
        from drafting.ams_cases import link_case
        from drafting.models import DraftBlock
        from workspace.models import CaseTask
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        drafting = ('CASE_VIEW', 'DOCUMENT_VIEW', 'TASK_VIEW', 'DRAFT_VIEW', 'DRAFT_CREATE', 'DRAFT_EXPORT')
        self.junior = make_advocate(permissions=drafting, parent_advocate_id=self.senior.id)
        self.other_junior = make_advocate(permissions=drafting, parent_advocate_id=self.senior.id)
        self.outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.case = make_case(self.senior)
        client, project = link_case(self.case)
        self.task = CaseTask.objects.create(advocate_id=self.senior.id, case_id=self.case.id, title='Draft plaint',
                                            assigned_to_id=self.junior.id, assigned_by_id=self.senior.id)
        template = Template.objects.create(name='Plaint', document_type='plaint')
        self.session = DraftSession.objects.create(template=template, client=client, project=project,
                                                   created_by_id=self.junior.id, ams_task_id=self.task.id,
                                                   facts={}, status='ready')
        self.block = DraftBlock.objects.create(session=self.session, position=0, block_type='clause',
                                               heading='Plaint', text='The plaintiff states.')
        self.url = f'/api/drafting/draft-sessions/{self.session.id}/'

    def set_status(self, value):
        self.task.review_status = value
        self.task.save(update_fields=['review_status'])

    def save_blocks(self, who):
        return self.client.post(self.url + 'save-blocks/', [{'id': self.block.id, 'text': 'Edited.'}],
                                content_type='application/json', **auth(who))

    def test_not_visible_before_submission(self, dispatch):
        self.assertEqual(self.client.get(self.url, **auth(self.senior)).status_code, 404)

    def test_reviewer_reads_exports_and_sees_review_block(self, dispatch):
        self.set_status('SUBMITTED')
        body = self.client.get(self.url, **auth(self.senior)).json()
        self.assertEqual(body['review']['taskId'], self.task.id)
        self.assertTrue(body['review']['canReview'])
        self.assertTrue(body['review']['canEdit'])
        self.assertFalse(body['review']['isOwner'])
        self.assertEqual(self.client.get(f'/api/drafting/drafts/{self.session.id}/export/docx/',
                                         **auth(self.senior)).status_code, 200)
        self.assertEqual(self.client.get(f'/api/drafting/drafts/{self.session.id}/ams-task/',
                                         **auth(self.senior)).json()['task']['id'], self.task.id)
        # The junior's own view: owner, cannot review their own work.
        own = self.client.get(self.url, **auth(self.junior)).json()['review']
        self.assertEqual((own['isOwner'], own['canReview']), (True, False))

    def test_others_cannot_see_it(self, dispatch):
        self.set_status('SUBMITTED')
        for who in (self.other_junior, self.outsider):
            self.assertEqual(self.client.get(self.url, **auth(who)).status_code, 404)
        # It is not in the reviewer's own draft list either (review is opened from the task).
        self.assertEqual(self.client.get('/api/drafting/draft-sessions/', **auth(self.senior)).json()['count'], 0)

    def test_reviewer_edits_only_while_submitted(self, dispatch):
        self.set_status('SUBMITTED')
        self.assertEqual(self.save_blocks(self.senior).status_code, 200)
        self.block.refresh_from_db()
        self.assertEqual(self.block.text, 'Edited.')
        self.set_status('APPROVED')
        self.assertEqual(self.save_blocks(self.senior).status_code, 403)
        self.assertEqual(self.save_blocks(self.junior).status_code, 200)       # the author still can

    def test_reviewer_never_files_redrafts_or_deletes(self, dispatch):
        self.set_status('SUBMITTED')
        h = auth(self.senior)
        self.assertEqual(self.client.post(f'/api/drafting/drafts/{self.session.id}/send-to-ams/', {},
                                          content_type='application/json', **h).status_code, 404)
        self.assertEqual(self.client.post(self.url + 'regenerate/', **h).status_code, 404)
        self.assertEqual(self.client.delete(self.url, **h).status_code, 404)

    def test_task_payload_links_the_draft(self, dispatch):
        tasks = self.client.get(f'/api/workspace/cases/{self.case.id}/tasks', **auth(self.senior)).json()
        self.assertEqual([t['draftSessionId'] for t in tasks if t['id'] == self.task.id], [self.session.id])
