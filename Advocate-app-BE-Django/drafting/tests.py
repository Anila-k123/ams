"""Merge phase 02: drafting authenticates as the AMS advocate and records who did what
by plain advocate id, in its own database."""

import tempfile
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from core.testing import ALL_PERMISSIONS, auth, make_advocate

from .models import Client, DraftSession, Playbook, Project, Sample, Template


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix='drafting-test-'))
@mock.patch('drafting.views._dispatch')      # no parsing / LLM calls in tests
class DraftingAuthTest(TestCase):
    databases = {'default'}

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
    databases = {'default'}

    def setUp(self):
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        self.intern = make_advocate(permissions=INTERN, parent_advocate_id=self.senior.id)
        self.junior = make_advocate(permissions=JUNIOR, parent_advocate_id=self.senior.id)
        self.nobody = make_advocate(permissions=('CASE_VIEW',), parent_advocate_id=self.senior.id)
        self.template = Template.objects.create(name='Mutual NDA', document_type='nda',
                                                created_by_id=self.senior.id)

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
    databases = {'default'}

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
    databases = {'default'}

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
    databases = {'default'}

    def setUp(self):
        from core.testing import make_case, make_client as make_ams_client
        from drafting.ams_cases import link_case
        from workspace.models import CaseTask
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        self.outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.template = Template.objects.create(name='Mutual NDA', document_type='nda', status='ready',
                                                created_by_id=self.senior.id)
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
    databases = {'default'}

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
    databases = {'default'}

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


@mock.patch('drafting.views._dispatch')
class DraftVersionTest(TestCase):
    """Saved versions: frozen copies of a draft that redlines compare against."""
    databases = {'default'}

    def setUp(self):
        from .models import DraftBlock
        self.owner = make_advocate(permissions=ALL_PERMISSIONS)
        self.outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.session = DraftSession.objects.create(created_by_id=self.owner.id, facts={}, status='ready')
        self.block = DraftBlock.objects.create(session=self.session, position=0, block_type='clause',
                                               heading='Rent', text='Rent is Rs. 5,00,000.', source='generated')
        self.url = f'/api/drafting/draft-sessions/{self.session.id}/versions/'

    def save(self, who, label=''):
        return self.client.post(self.url, {'label': label}, content_type='application/json', **auth(who))

    def test_save_and_list_newest_first(self, dispatch):
        self.assertEqual(self.save(self.owner, 'Sent to client').status_code, 201)
        resp = self.save(self.owner)
        self.assertEqual([(v['number'], v['label']) for v in resp.json()], [(2, ''), (1, 'Sent to client')])
        self.assertEqual(self.client.get(self.url, **auth(self.owner)).json()[0]['number'], 2)

    def test_version_does_not_change_after_later_edits(self, dispatch):
        self.save(self.owner)
        self.block.text = 'Rent is Rs. 7,50,000.'
        self.block.save()
        version = self.session.versions.get()
        self.assertEqual(version.blocks[0]['text'], 'Rent is Rs. 5,00,000.')
        self.assertEqual(version.blocks[0]['block_id'], self.block.id)

    def test_empty_draft_refused(self, dispatch):
        self.block.delete()
        self.assertEqual(self.save(self.owner).status_code, 400)

    def test_other_advocates_cannot_see_or_save(self, dispatch):
        self.assertEqual(self.client.get(self.url, **auth(self.outsider)).status_code, 404)
        self.assertEqual(self.save(self.outsider).status_code, 404)


def _block(block_id, heading, html):
    return {'block_id': block_id, 'position': 0, 'block_type': 'clause', 'heading': heading,
            'text': '', 'content_html': html, 'style_json': {}}


def _redline_xml(before, after):
    import io
    import zipfile
    from .export.redline import render_redline_docx
    data, stats = render_redline_docx(before, after, author='A. Advocate')
    return zipfile.ZipFile(io.BytesIO(data)).read('word/document.xml').decode(), stats


class RedlineDocxTest(TestCase):
    """Word tracked changes: <w:ins> / <w:del> around exactly the words that changed."""

    def test_changed_words_only(self):
        xml, stats = _redline_xml([_block(1, 'Rent', '<p>Monthly rent is Rs. 5,00,000 payable in advance.</p>')],
                                  [_block(1, 'Rent', '<p>Monthly rent is Rs. 7,50,000 payable in advance.</p>')])
        self.assertIn('<w:delText xml:space="preserve">5</w:delText>', xml)
        self.assertIn('w:author="A. Advocate"', xml)
        self.assertRegex(xml, r'<w:ins [^>]*>.*?<w:t xml:space="preserve">7</w:t>')
        self.assertIn('payable in advance', xml)                 # unchanged text stays plain
        self.assertEqual(stats, {'inserted': 2, 'deleted': 2})   # "5","00,000" → "7","50,000" as tokens

    def test_added_and_removed_clauses(self):
        xml, stats = _redline_xml(
            [_block(1, 'Rent', '<p>Rent.</p>'), _block(2, 'Arbitration', '<p>Disputes go to arbitration.</p>')],
            [_block(1, 'Rent', '<p>Rent.</p>'), _block(3, 'Jurisdiction', '<p>Courts at Chennai.</p>')])
        self.assertIn('<w:delText xml:space="preserve">Disputes go to arbitration.</w:delText>', xml)
        self.assertRegex(xml, r'<w:ins [^>]*><w:r><w:t xml:space="preserve">Courts at Chennai.</w:t>')
        self.assertGreater(stats['deleted'], 0)

    def test_redrafted_clause_paired_by_heading(self):
        # A re-draft gives the clause a new block id; the heading still pairs it, so only
        # the changed word is marked, not the whole clause.
        _, stats = _redline_xml([_block(1, 'Term', '<p>The term is three years.</p>')],
                                [_block(9, 'Term', '<p>The term is five years.</p>')])
        self.assertEqual(stats, {'inserted': 1, 'deleted': 1})

    def test_identical_versions_have_no_marks(self):
        blocks = [_block(1, 'Rent', '<p>Rent is <strong>due</strong> monthly.</p><ul><li><p>One</p></li></ul>')]
        xml, stats = _redline_xml(blocks, blocks)
        self.assertNotIn('<w:ins', xml)
        self.assertNotIn('<w:del ', xml)
        self.assertEqual(stats, {'inserted': 0, 'deleted': 0})


@mock.patch('drafting.views._dispatch')
class RedlineExportViewTest(TestCase):
    databases = {'default'}

    def setUp(self):
        from .models import DraftBlock
        from .versions import save_version
        self.owner = make_advocate(permissions=ALL_PERMISSIONS)
        self.session = DraftSession.objects.create(created_by_id=self.owner.id, facts={}, status='ready')
        self.block = DraftBlock.objects.create(session=self.session, position=0, block_type='clause',
                                               heading='Rent', text='Rent is Rs. 5,00,000.', source='generated')
        self.url = f'/api/drafting/drafts/{self.session.id}/export/redline/'
        self.save_version = save_version

    def test_needs_a_version(self, dispatch):
        self.assertEqual(self.client.get(self.url, **auth(self.owner)).status_code, 400)

    def test_compares_last_version_with_current(self, dispatch):
        v1 = self.save_version(self.session)
        self.block.text = 'Rent is Rs. 7,50,000.'
        self.block.save()
        resp = self.client.get(self.url, **auth(self.owner))
        self.assertEqual(resp.status_code, 200)
        self.assertIn(f'redline_v{v1.number}-current', resp['Content-Disposition'])
        self.assertEqual((resp['X-Redline-Inserted'], resp['X-Redline-Deleted']), ('2', '2'))

    def test_other_sessions_versions_refused(self, dispatch):
        other = DraftSession.objects.create(created_by_id=self.owner.id, facts={}, status='ready')
        from .models import DraftBlock
        DraftBlock.objects.create(session=other, position=0, block_type='clause', text='x', source='generated')
        foreign = self.save_version(other)
        self.assertEqual(self.client.get(self.url + f'?from={foreign.id}', **auth(self.owner)).status_code, 404)

    def test_outsider_cannot_export(self, dispatch):
        self.save_version(self.session)
        outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.assertEqual(self.client.get(self.url, **auth(outsider)).status_code, 404)


@mock.patch('drafting.views._dispatch')
class PdfExportTest(TestCase):
    """?output=pdf converts the Word export with LibreOffice; 503 when it is missing."""
    databases = {'default'}

    def setUp(self):
        from .models import DraftBlock
        self.owner = make_advocate(permissions=ALL_PERMISSIONS)
        self.session = DraftSession.objects.create(created_by_id=self.owner.id, facts={}, status='ready')
        DraftBlock.objects.create(session=self.session, position=0, block_type='clause',
                                  heading='Rent', text='Rent is due.', source='generated')
        self.base = f'/api/drafting/drafts/{self.session.id}/export/'

    @override_settings(LIBREOFFICE_PATH=r'C:\nowhere\soffice.exe')
    def test_503_without_libreoffice(self, dispatch):
        resp = self.client.get(self.base + 'docx/?output=pdf', **auth(self.owner))
        self.assertEqual(resp.status_code, 503)
        # The Word export is unaffected.
        self.assertEqual(self.client.get(self.base + 'docx/', **auth(self.owner)).status_code, 200)

    @mock.patch('drafting.export.pdf.docx_to_pdf', return_value=b'%PDF-1.7 converted')
    def test_pdf_of_draft_and_redline(self, convert, dispatch):
        from .versions import save_version
        resp = self.client.get(self.base + 'docx/?output=pdf', **auth(self.owner))
        self.assertEqual((resp.status_code, resp['Content-Type']), (200, 'application/pdf'))
        self.assertTrue(resp['Content-Disposition'].endswith('.pdf"'))
        self.assertEqual(resp.content, b'%PDF-1.7 converted')
        self.assertTrue(convert.call_args[0][0].startswith(b'PK'))   # it converted a .docx
        v = save_version(self.session)
        resp = self.client.get(self.base + f'redline/?from={v.id}&output=pdf', **auth(self.owner))
        self.assertEqual(resp['Content-Type'], 'application/pdf')
        self.assertIn('X-Redline-Inserted', resp)


class CompareEngineTest(TestCase):
    """export/compare.py: the data behind the on-screen compare view and the redline."""

    def test_changes_numbered_and_marked(self):
        from .export.compare import compare_blocks
        before = [_block(1, 'Rent', '<p>Rent is Rs. 40,000.</p><p>Paid monthly.</p>'),
                  _block(2, 'Sub-letting', '<p>The Lessee may sub-let.</p>')]
        after = [_block(1, 'Rent', '<p>Rent is Rs. 45,000.</p><p>Paid monthly.</p>'),
                 _block(3, 'Lock-in', '<p>Six months lock-in.</p>')]
        data = compare_blocks(before, after).as_json()
        self.assertEqual([c['status'] for c in data['clauses']], ['changed', 'removed', 'added'])
        rent = data['clauses'][0]['body']
        self.assertEqual(rent[0]['kind'], 'changed')
        self.assertEqual([(s['op'], s['text']) for s in rent[0]['segs'] if s['op'] != 'same'],
                         [('del', '40'), ('ins', '45')])
        self.assertEqual(rent[1]['kind'], 'same')
        self.assertIsNone(rent[1]['change_id'])
        # Every changed paragraph is numbered in order: rent, removed heading + body, added heading + body.
        ids = [p['change_id'] for c in data['clauses'] for p in c['heading'] + c['body'] if p['change_id']]
        self.assertEqual(ids, [1, 2, 3, 4, 5])
        self.assertEqual(data['changes'], 5)

    def test_screen_and_word_count_the_same(self):
        from .export.compare import compare_blocks
        before = [_block(1, 'Term', '<p>The term is three years from today.</p>')]
        after = [_block(1, 'Term', '<p>The term is five years from the start date.</p>')]
        data = compare_blocks(before, after).as_json()
        _, stats = _redline_xml(before, after)
        self.assertEqual((data['inserted'], data['deleted']), (stats['inserted'], stats['deleted']))


@mock.patch('drafting.views._dispatch')
class CompareViewTest(TestCase):
    databases = {'default'}

    def setUp(self):
        from .models import DraftBlock
        self.owner = make_advocate(permissions=ALL_PERMISSIONS)
        self.session = DraftSession.objects.create(created_by_id=self.owner.id, facts={}, status='ready')
        self.block = DraftBlock.objects.create(session=self.session, position=0, block_type='clause',
                                               heading='Rent', text='Rent is Rs. 40,000.', source='generated')
        self.url = f'/api/drafting/draft-sessions/{self.session.id}/compare/'

    def test_needs_a_version(self, dispatch):
        self.assertEqual(self.client.get(self.url, **auth(self.owner)).status_code, 400)

    def test_version_against_current(self, dispatch):
        from .versions import save_version
        v1 = save_version(self.session)
        self.block.text = 'Rent is Rs. 45,000.'
        self.block.save()
        body = self.client.get(self.url, **auth(self.owner)).json()
        self.assertEqual(body['from']['id'], v1.id)
        self.assertIsNone(body['to'])
        self.assertEqual((body['inserted'], body['deleted'], body['changes']), (1, 1, 1))   # 40 -> 45; ',000' unchanged

    def test_outsider_refused(self, dispatch):
        from .versions import save_version
        save_version(self.session)
        outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.assertEqual(self.client.get(self.url, **auth(outsider)).status_code, 404)


DRAFTER = ('DRAFT_VIEW', 'DRAFT_CREATE', 'DRAFT_EXPORT')


class AuthorityTest(TestCase):
    """drafting/authority.py: who is senior over whose drafts."""

    def test_rule(self):
        from .authority import is_senior_over
        head = make_advocate(permissions=DRAFTER)
        junior = make_advocate(permissions=DRAFTER, parent_advocate_id=head.id)
        peer = make_advocate(permissions=DRAFTER, parent_advocate_id=head.id)
        assigner = make_advocate(permissions=DRAFTER + ('TASK_ASSIGN',), parent_advocate_id=head.id)
        outsider = make_advocate(permissions=DRAFTER + ('TASK_ASSIGN',))
        self.assertTrue(is_senior_over(head, junior))          # team head
        self.assertTrue(is_senior_over(assigner, junior))      # can assign tasks in the team
        self.assertFalse(is_senior_over(peer, junior))         # a peer
        self.assertFalse(is_senior_over(junior, head))         # nobody is over the team head
        self.assertFalse(is_senior_over(assigner, head))
        self.assertFalse(is_senior_over(outsider, junior))     # another team
        self.assertFalse(is_senior_over(head, head))


class HtmlWriteTest(TestCase):
    """export/htmlwrite.py turns paragraphs back into the HTML the editor reads."""

    def test_round_trip(self):
        from .export.docx import html_to_blocks
        from .export.htmlwrite import paras_to_html
        src = ('<h2>Rent</h2><p style="text-align: justify">Rent is <strong>Rs. 40,000</strong>, <em>monthly</em>.</p>'
               '<ul><li><p>One</p><ul><li><p>One a</p></li></ul></li><li><p>Two</p></li></ul>'
               '<ol><li><p>First</p></li></ol><p>Line<br>break &amp; more</p>')
        paras = html_to_blocks(src)
        again = html_to_blocks(paras_to_html(paras))
        self.assertEqual([(p.style, p.align, p.runs) for p in again], [(p.style, p.align, p.runs) for p in paras])


@mock.patch('drafting.views._dispatch')
class ReviewRoundTest(TestCase):
    """drafting/review.py through the API: suggest, decide, finish (docs/DRAFT_REVIEW.md)."""
    databases = {'default'}

    def setUp(self):
        from .models import DraftBlock, DraftReviewRequest
        self.head = make_advocate(permissions=DRAFTER)
        self.junior = make_advocate(permissions=DRAFTER, parent_advocate_id=self.head.id)
        self.outsider = make_advocate(permissions=DRAFTER)
        # The senior's own draft; the junior is asked to proofread it (suggestions only).
        self.session = DraftSession.objects.create(created_by_id=self.head.id, facts={}, status='ready')
        self.block = DraftBlock.objects.create(
            session=self.session, position=0, block_type='clause', heading='Rent', text='',
            content_html='<p>Rent is Rs. 40,000.</p><p>Paid monthly.</p>', source='generated')
        self.request = DraftReviewRequest.objects.create(
            session=self.session, requested_by_id=self.head.id, reviewer_id=self.junior.id,
            authority=DraftReviewRequest.Authority.SUGGEST)
        self.base = '/api/drafting/'

    def suggest(self, who, html):
        return self.client.post(f'{self.base}draft-sessions/{self.session.id}/suggest/',
                                {'blocks': [{'id': self.block.id, 'heading': 'Rent', 'content_html': html, 'text': ''}],
                                 'note': 'Please check'}, content_type='application/json', **auth(who))

    def decide(self, rid, who, change, decision, reason=''):
        return self.client.post(f'{self.base}rounds/{rid}/decide/',
                                {'change': change, 'decision': decision, 'reason': reason},
                                content_type='application/json', **auth(who))

    def finish(self, rid, who):
        return self.client.post(f'{self.base}rounds/{rid}/finish/', **auth(who))

    def test_requested_reviewer_sees_but_cannot_edit_directly(self, dispatch):
        url = f'{self.base}draft-sessions/{self.session.id}/'
        self.assertEqual(self.client.get(url, **auth(self.junior)).status_code, 200)
        resp = self.client.post(url + 'save-blocks/', [{'id': self.block.id, 'text': 'x'}],
                                content_type='application/json', **auth(self.junior))
        self.assertEqual(resp.status_code, 403)                     # suggest-only
        self.assertEqual(self.client.get(url, **auth(self.outsider)).status_code, 404)

    def test_binding_reviewer_may_edit(self, dispatch):
        from .models import DraftReviewRequest
        junior_draft = DraftSession.objects.create(created_by_id=self.junior.id, facts={}, status='ready')
        DraftReviewRequest.objects.create(session=junior_draft, requested_by_id=self.junior.id,
                                          reviewer_id=self.head.id, authority=DraftReviewRequest.Authority.BINDING)
        resp = self.client.post(f'{self.base}draft-sessions/{junior_draft.id}/save-blocks/', [],
                                content_type='application/json', **auth(self.head))
        self.assertEqual(resp.status_code, 200)

    def test_mixed_decisions_in_one_clause(self, dispatch):
        resp = self.suggest(self.junior, '<p>Rent is Rs. 45,000.</p><p>Paid monthly in advance.</p>')
        self.assertEqual(resp.status_code, 201, resp.content)
        rnd = resp.json()
        self.assertEqual((rnd['kind'], rnd['pending'], rnd['can_decide']), ('suggestions', 2, False))
        self.block.refresh_from_db()
        self.assertIn('40,000', self.block.content_html)            # nothing applied yet
        rid = rnd['id']
        self.assertEqual(self.decide(rid, self.junior, 1, 'accepted').status_code, 400)   # not the decider
        self.assertEqual(self.decide(rid, self.head, 2, 'declined').status_code, 400)     # reason needed
        self.assertEqual(self.decide(rid, self.head, 1, 'rejected').status_code, 400)     # wrong kind
        self.assertEqual(self.decide(rid, self.head, 1, 'accepted').status_code, 200)
        self.assertEqual(self.finish(rid, self.head).status_code, 400)                    # one still pending
        self.assertEqual(self.decide(rid, self.head, 2, 'declined', 'Advance is in 2.2').status_code, 200)
        resp = self.finish(rid, self.head)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.block.refresh_from_db()
        self.assertIn('45,000', self.block.content_html)            # accepted
        self.assertNotIn('in advance', self.block.content_html)     # declined
        self.assertEqual(self.block.text, 'Rent is Rs. 45,000.\nPaid monthly.')
        version = self.session.versions.order_by('-number').first()
        self.assertEqual((version.kind, version.label), ('review', 'Review: 1 accepted, 1 declined'))

    def test_accept_all_keeps_the_html_exactly(self, dispatch):
        html = '<p>Rent is Rs. 45,000.</p><p>Paid <strong>monthly</strong>.</p>'
        rid = self.suggest(self.junior, html).json()['id']
        self.assertEqual(self.decide(rid, self.head, 'all', 'accepted').status_code, 200)
        self.finish(rid, self.head)
        self.block.refresh_from_db()
        self.assertEqual(self.block.content_html, html)

    def test_outdated_suggestion_is_not_applied(self, dispatch):
        rid = self.suggest(self.junior, '<p>Rent is Rs. 45,000.</p><p>Paid monthly.</p>').json()['id']
        self.block.content_html = '<p>Rent is Rs. 50,000.</p><p>Paid monthly.</p>'   # the owner moved on
        self.block.save()
        body = self.client.get(f'{self.base}rounds/{rid}/', **auth(self.head)).json()
        self.assertTrue(body['clauses'][0]['body'][0]['outdated'])
        resp = self.finish(rid, self.head)                         # outdated changes need no decision
        self.assertEqual(resp.json()['result']['outdated'], [1])   # change 1: its paragraph changed
        self.block.refresh_from_db()
        self.assertIn('50,000', self.block.content_html)

    def test_edit_elsewhere_in_the_clause_keeps_suggestion_valid(self, dispatch):
        # A whole deed often sits in one clause: an edit to another paragraph must not outdate it.
        rid = self.suggest(self.junior, '<p>Rent is Rs. 45,000.</p><p>Paid monthly.</p>').json()['id']
        self.block.content_html = '<p>Rent is Rs. 40,000.</p><p>Paid quarterly.</p>'   # owner edits paragraph 2
        self.block.save()
        body = self.client.get(f'{self.base}rounds/{rid}/', **auth(self.head)).json()
        self.assertFalse(body['clauses'][0]['body'][0]['outdated'])
        self.decide(rid, self.head, 1, 'accepted')
        self.assertEqual(self.finish(rid, self.head).status_code, 200)
        self.block.refresh_from_db()
        self.assertEqual(self.block.text, 'Rent is Rs. 45,000.\nPaid quarterly.')   # both edits kept

    def test_only_formatting_is_refused(self, dispatch):
        resp = self.suggest(self.junior, '<p>Rent is <strong>Rs. 40,000.</strong></p><p>Paid monthly.</p>')
        self.assertEqual(resp.status_code, 400)

    def test_owner_cannot_suggest_and_outsider_cannot_see(self, dispatch):
        self.assertEqual(self.suggest(self.head, '<p>x</p>').status_code, 403)
        rid = self.suggest(self.junior, '<p>Rent is Rs. 45,000.</p><p>Paid monthly.</p>').json()['id']
        self.assertEqual(self.client.get(f'{self.base}rounds/{rid}/', **auth(self.outsider)).status_code, 404)

    def test_author_withdraws(self, dispatch):
        rid = self.suggest(self.junior, '<p>Rent is Rs. 45,000.</p><p>Paid monthly.</p>').json()['id']
        self.assertEqual(self.client.post(f'{self.base}rounds/{rid}/cancel/', **auth(self.head)).status_code, 400)
        resp = self.client.post(f'{self.base}rounds/{rid}/cancel/', **auth(self.junior))
        self.assertEqual(resp.json()['status'], 'cancelled')

    def test_changes_round_reject_puts_old_text_back(self, dispatch):
        from . import review
        from .versions import snapshot_blocks
        base = snapshot_blocks(self.session)
        self.block.content_html = '<p>Rent is Rs. 45,000.</p><p>Paid weekly.</p>'
        self.block.save()
        rnd = review.create_changes_round(self.session, base, author_id=self.junior.id, decider_id=self.head.id)
        review.decide(rnd, self.head, 1, 'accepted')
        review.decide(rnd, self.head, 2, 'rejected')
        review.finish(rnd, self.head)
        self.block.refresh_from_db()
        self.assertEqual(self.block.text, 'Rent is Rs. 45,000.\nPaid monthly.')

    def test_binding_round_is_only_acknowledged(self, dispatch):
        from . import review
        from .versions import snapshot_blocks
        base = snapshot_blocks(self.session)
        self.block.content_html = '<p>Rent is Rs. 45,000.</p><p>Paid monthly.</p>'
        self.block.save()
        rnd = review.create_changes_round(self.session, base, author_id=self.head.id,
                                          decider_id=self.junior.id, binding=True)
        with self.assertRaises(review.ReviewError):
            review.decide(rnd, self.junior, 1, 'rejected')
        review.decide(rnd, self.junior, 1, 'queried', 'Client agreed 40,000?')
        review.finish(rnd, self.junior)
        self.block.refresh_from_db()
        self.assertIn('45,000', self.block.content_html)          # a query never undoes a correction


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix='drafting-test-'))
@mock.patch('drafting.views._dispatch')
class TaskReviewLoopTest(TestCase):
    """drafting/task_review.py: the whole task loop with review rounds (docs/DRAFT_REVIEW.md, situation 1)."""
    databases = {'default'}

    def setUp(self):
        from core.testing import make_case
        from drafting.ams_cases import link_case
        from drafting.models import DraftBlock
        from workspace.models import CaseTask
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        drafting = ('CASE_VIEW', 'DOCUMENT_VIEW', 'TASK_VIEW', 'DRAFT_VIEW', 'DRAFT_CREATE', 'DRAFT_EXPORT')
        self.junior = make_advocate(permissions=drafting, parent_advocate_id=self.senior.id)
        self.case = make_case(self.senior)
        client, project = link_case(self.case)
        self.task = CaseTask.objects.create(advocate_id=self.senior.id, case_id=self.case.id, title='Draft lease',
                                            assigned_to_id=self.junior.id, assigned_by_id=self.senior.id)
        self.session = DraftSession.objects.create(client=client, project=project, created_by_id=self.junior.id,
                                                   ams_task_id=self.task.id, facts={}, status='ready')
        self.block = DraftBlock.objects.create(
            session=self.session, position=0, block_type='clause', heading='Rent', text='',
            content_html='<p>Rent is Rs. 40,000.</p><p>Notice is one month.</p><p>Paid monthly.</p>', source='generated')
        self.s = f'/api/drafting/draft-sessions/{self.session.id}/'

    def post(self, path, who, body=None):
        return self.client.post(path, body or {}, content_type='application/json', **auth(who))

    def save(self, who, html):
        return self.post(self.s + 'save-blocks/', who, [{'id': self.block.id, 'heading': 'Rent', 'content_html': html, 'text': ''}])

    def submit(self, note=''):
        return self.post(f'/api/drafting/drafts/{self.session.id}/send-to-ams/', self.junior, {'note': note} if note else {})

    def review(self, action, note=''):
        return self.post(f'/api/workspace/tasks/{self.task.id}/review', self.senior, {'action': action, 'note': note})

    def rounds(self, who):
        return self.client.get(self.s + 'rounds/', **auth(who)).json()

    def test_full_loop(self, dispatch):
        from . import review
        from .models import DraftComment, DraftReviewRound
        self.assertEqual(self.submit().status_code, 200)

        # Senior: no suggestions in a task review (docs/DRAFT_REVIEW.md, "Revision") ...
        resp = self.post(self.s + 'suggest/', self.senior, {'blocks': [{'id': self.block.id, 'heading': 'Rent',
            'content_html': '<p>x</p>', 'text': ''}]})
        self.assertEqual(resp.status_code, 403)
        # ... he corrects directly, and asks a question as a comment.
        self.assertEqual(self.save(self.senior,
                                   '<p>Rent is Rs. 45,000.</p><p>Notice is one month.</p><p>Paid monthly.</p>').status_code, 200)
        resp = self.post(self.s + 'comments/', self.senior, {'block_id': self.block.id, 'quote': 'Paid monthly.',
                                                             'body': 'Did the client agree to rent in advance?'})
        question = resp.json()['threads'][0]['id']
        self.assertEqual(self.review('approve').status_code, 400)          # an open question
        self.assertEqual(self.review('request_changes', 'Fix the notice period.').status_code, 200)

        # Junior: the correction arrives as a binding round (OK / Query only).
        binding = DraftReviewRound.objects.get(session=self.session, binding=True)
        self.assertEqual((binding.decider_id, binding.author_id), (self.junior.id, self.senior.id))
        with self.assertRaises(review.ReviewError):
            review.decide(binding, self.junior, 1, 'rejected')
        # Her query opens a comment thread on the corrected words, for the senior.
        review.decide(binding, self.junior, 1, 'queried', 'Client agreed 40,000?')
        query = DraftComment.objects.get(session=self.session, author_id=self.junior.id, parent=None)
        self.assertEqual((query.body, query.block_id), ('Client agreed 40,000?', self.block.id))
        self.assertIn('45,000', query.quote)
        # She answers his question, fixes what was asked and resubmits (comments don't block a resubmit).
        self.post(f'/api/drafting/comments/{question}/reply/', self.junior, {'body': 'Arrears, as agreed.'})
        self.block.refresh_from_db()
        self.assertEqual(self.save(self.junior, self.block.content_html.replace('one month', 'two months')).status_code, 200)
        self.assertEqual(self.submit('Fixed notice').status_code, 200)
        binding.refresh_from_db()
        self.assertEqual(binding.status, 'finished')                       # closed, query kept

        # Senior: a Keep / Reject round of her change since "Sent back", and two open threads.
        changes = DraftReviewRound.objects.get(session=self.session, kind='changes', binding=False, status='open')
        self.assertEqual((changes.decider_id, review.comparison(changes).changes), (self.senior.id, 1))
        threads = self.client.get(self.s + 'comments/', **auth(self.senior)).json()
        self.assertEqual((threads['open'], threads['answered']), (2, 1))
        review.decide(changes, self.senior, 'all', 'accepted')
        review.finish(changes, self.senior)
        self.assertEqual(self.review('approve').status_code, 400)          # threads still open
        for t in threads['threads']:
            self.assertEqual(self.post(f'/api/drafting/comments/{t["id"]}/resolve/', self.senior).status_code, 200)
        self.assertEqual(self.review('approve').status_code, 200)
        self.task.refresh_from_db()
        self.assertEqual(self.task.review_status, 'APPROVED')
        kinds = list(self.session.versions.order_by('number').values_list('kind', flat=True))
        self.assertIn('returned', kinds)


@mock.patch('drafting.views._dispatch')
class ReviewRequestTest(TestCase):
    """drafting/review_requests.py: Request review on drafts without a task (situations 2-4)."""
    databases = {'default'}

    def setUp(self):
        from .models import DraftBlock
        self.head = make_advocate(permissions=DRAFTER)
        self.junior = make_advocate(permissions=DRAFTER, parent_advocate_id=self.head.id)
        self.peer = make_advocate(permissions=DRAFTER, parent_advocate_id=self.head.id)
        self.outsider = make_advocate(permissions=DRAFTER)
        self.session = DraftSession.objects.create(created_by_id=self.junior.id, facts={}, status='ready')
        self.block = DraftBlock.objects.create(
            session=self.session, position=0, block_type='clause', heading='Rent', text='',
            content_html='<p>Rent is Rs. 40,000.</p><p>Paid monthly.</p>', source='generated')
        self.s = f'/api/drafting/draft-sessions/{self.session.id}/'

    def post(self, path, who, body=None):
        return self.client.post(path, body or {}, content_type='application/json', **auth(who))

    def ask(self, reviewer, note='Please check the rent'):
        return self.post(self.s + 'review-requests/', self.junior, {'reviewer': reviewer.id, 'note': note})

    def test_reviewers_and_their_power(self, dispatch):
        rows = {r['id']: r['authority'] for r in self.client.get(self.s + 'reviewers/', **auth(self.junior)).json()}
        self.assertEqual(rows, {self.head.id: 'binding', self.peer.id: 'suggest'})   # never the outsider

    def test_request_rules(self, dispatch):
        self.assertEqual(self.ask(self.outsider).status_code, 400)                    # not in the team
        self.assertEqual(self.post(self.s + 'review-requests/', self.peer, {'reviewer': self.head.id}).status_code, 404)
        resp = self.ask(self.head)
        self.assertEqual((resp.status_code, resp.json()['authority']), (201, 'binding'))
        self.assertEqual(self.ask(self.head).status_code, 400)                        # already reviewing
        self.assertEqual(self.session.versions.get().label, f'Sent for review to {self.head.full_name}')
        from core.models import NotificationQueue
        self.assertTrue(NotificationQueue.objects.filter(type='DRAFT_REVIEW_REQUESTED').exists())
        task_draft = DraftSession.objects.create(created_by_id=self.junior.id, facts={}, status='ready', ams_task_id=99)
        resp = self.post(f'/api/drafting/draft-sessions/{task_draft.id}/review-requests/', self.junior, {'reviewer': self.head.id})
        self.assertEqual(resp.status_code, 400)                                        # tasks use their own review

    def test_senior_corrects_then_owner_acknowledges(self, dispatch):
        rid = self.ask(self.head).json()['id']
        self.assertEqual([r['id'] for r in self.client.get('/api/drafting/drafts/for-review/', **auth(self.head)).json()], [rid])
        session = self.client.get(self.s, **auth(self.head)).json()
        self.assertEqual((session['access']['canWrite'], session['access']['canSuggest']), (True, True))
        resp = self.post(self.s + 'save-blocks/', self.head, [{'id': self.block.id, 'heading': 'Rent',
                         'content_html': '<p>Rent is Rs. 45,000.</p><p>Paid monthly.</p>', 'text': ''}])
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.post(f'/api/drafting/review-requests/{rid}/done/', self.head).status_code, 200)
        self.assertEqual(self.client.get('/api/drafting/drafts/for-review/', **auth(self.head)).json(), [])
        rounds = self.client.get(self.s + 'rounds/', **auth(self.junior)).json()
        self.assertEqual([(r['binding'], r['changes'], r['can_decide']) for r in rounds], [(True, 1, True)])
        # After Done the senior can still read the draft but no longer edit it.
        self.assertEqual(self.client.get(self.s, **auth(self.head)).status_code, 200)
        self.assertEqual(self.post(self.s + 'save-blocks/', self.head, []).status_code, 403)

    def test_peer_suggests_owner_decides(self, dispatch):
        rid = self.ask(self.peer).json()['id']
        session = self.client.get(self.s, **auth(self.peer)).json()
        self.assertEqual((session['access']['canWrite'], session['access']['canSuggest']), (False, True))
        resp = self.post(self.s + 'suggest/', self.peer, {'blocks': [{'id': self.block.id, 'heading': 'Rent',
                         'content_html': '<p>Rent is Rs. 40,000.</p><p>Paid monthly in advance.</p>', 'text': ''}]})
        self.assertEqual(resp.status_code, 201)
        self.post(f'/api/drafting/review-requests/{rid}/done/', self.peer)
        rounds = self.client.get(self.s + 'rounds/', **auth(self.junior)).json()
        self.assertEqual([(r['kind'], r['binding'], r['can_decide']) for r in rounds], [('suggestions', False, True)])

    def test_owner_cancels(self, dispatch):
        rid = self.ask(self.peer).json()['id']
        sug = self.post(self.s + 'suggest/', self.peer, {'blocks': [{'id': self.block.id, 'heading': 'Rent',
                        'content_html': '<p>Rent is Rs. 41,000.</p><p>Paid monthly.</p>', 'text': ''}]}).json()['id']
        self.assertEqual(self.post(f'/api/drafting/review-requests/{rid}/cancel/', self.peer).status_code, 404)
        self.assertEqual(self.post(f'/api/drafting/review-requests/{rid}/cancel/', self.junior).json()['status'], 'cancelled')
        self.assertEqual(self.client.get(self.s, **auth(self.peer)).status_code, 404)      # access gone
        from .models import DraftReviewRound
        self.assertEqual(DraftReviewRound.objects.get(id=sug).status, 'cancelled')


    def test_progress_shown_to_both_sides(self, dispatch):
        from . import review
        from core.models import NotificationQueue
        from .models import DraftReviewRound
        status = lambda: self.client.get('/api/drafting/drafts/review-status/', **auth(self.junior)).json()
        progress = lambda: self.client.get('/api/drafting/drafts/for-review/', **auth(self.peer)).json()[0]['progress']
        self.assertEqual(status(), {})                                                   # never reviewed
        rid = self.ask(self.peer).json()['id']
        self.assertEqual(status()[str(self.session.id)]['state'], 'with_reviewer')
        self.post(self.s + 'suggest/', self.peer, {'blocks': [{'id': self.block.id, 'heading': 'Rent',
                  'content_html': '<p>Rent is Rs. 40,000.</p><p>Paid monthly in advance.</p>', 'text': ''}]})
        self.assertEqual(status()[str(self.session.id)], {'state': 'to_decide', 'who': self.peer.full_name})
        self.assertEqual((progress()['sent'], progress()['waiting']), (1, 1))
        rnd = DraftReviewRound.objects.get(session=self.session)
        review.decide(rnd, self.junior, 'all', 'accepted')
        review.finish(rnd, self.junior)
        self.assertEqual((progress()['waiting'], progress()['accepted']), (0, 1))
        told = NotificationQueue.objects.filter(type='DRAFT_REVIEW_DONE', advocate_id=self.peer.id)
        self.assertTrue(told.exists())
        self.assertEqual(status()[str(self.session.id)]['state'], 'with_reviewer')
        self.post(f'/api/drafting/review-requests/{rid}/done/', self.peer)
        self.assertEqual(status()[str(self.session.id)]['state'], 'reviewed')


class DecideAllTest(TestCase):
    """'all' only fills in undecided changes."""

    def test_all_keeps_earlier_decisions(self):
        from . import review
        from .models import DraftBlock
        from .versions import snapshot_blocks
        owner = make_advocate(permissions=DRAFTER)
        senior = make_advocate(permissions=DRAFTER)
        session = DraftSession.objects.create(created_by_id=owner.id, facts={}, status='ready')
        block = DraftBlock.objects.create(session=session, position=0, block_type='clause', heading='Rent', text='',
                                          content_html='<p>Rent 40.</p><p>Notice 1.</p>', source='generated')
        base = snapshot_blocks(session)
        block.content_html = '<p>Rent 45.</p><p>Notice 2.</p>'
        block.save()
        rnd = review.create_changes_round(session, base, author_id=senior.id, decider_id=owner.id, binding=True)
        review.decide(rnd, owner, 1, 'queried', 'Why 45?')
        review.decide(rnd, owner, 'all', 'acknowledged')
        self.assertEqual(dict(rnd.decisions.values_list('change_id', 'decision')), {1: 'queried', 2: 'acknowledged'})


class CompareStorageNoiseTest(TestCase):
    """The AI draft (plain text) and an edited draft (editor HTML) store the same things differently;
    comparing them must show only real edits (draft #121: 11 reported changes, 2 real)."""

    def compare(self, before, after, title='Residential Lease Deed'):
        from .export.compare import compare_blocks
        return compare_blocks(before, after, title)

    def block(self, heading, text='', html=''):
        return {'block_id': 1, 'position': 0, 'block_type': 'clause', 'heading': heading,
                'text': text, 'content_html': html, 'style_json': {}}

    def test_empty_placeholder_and_title_line_are_not_changes(self):
        ai = self.block('', text='Residential Lease Deed\nCommencing from [[Lease Start Date]].')
        edited = self.block('', html='<p>Commencing from <span data-placeholder="Lease Start Date" '
                                     'data-value="">[Lease Start Date]</span>.</p>')
        self.assertEqual(self.compare([ai], [edited]).changes, 0)

    def test_filled_placeholder_is_one_change(self):
        ai = self.block('', text='Executed on [[Date of Execution]].')
        edited = self.block('', html='<p>Executed on <span data-placeholder="Date of Execution" '
                                     'data-value="22/03/2026">22/03/2026</span>.</p>')
        comp = self.compare([ai], [edited])
        self.assertEqual(comp.changes, 1)
        segs = [(s.op, s.text) for s in comp.clauses[0].body[0].segs if s.op != 'same']
        self.assertIn(('ins', '22/03/2026'), segs)

    def test_repeated_clause_heading_line_is_not_a_change(self):
        ai = self.block('SCHEDULE OF PROPERTY', text='SCHEDULE OF PROPERTY\nAll that flat.')
        edited = self.block('SCHEDULE OF PROPERTY', html='<p>All that flat.</p>')
        self.assertEqual(self.compare([ai], [edited]).changes, 0)

    def test_double_escaped_ampersand_in_placeholder_name(self):
        ai = self.block('', text='Witness: [[Witness 2 Name & Address]]')
        edited = self.block('', html='<p>Witness: <span data-placeholder="Witness 2 Name &amp;amp; Address" '
                                     'data-value="">[Witness 2 Name &amp;amp; Address]</span></p>')
        self.assertEqual(self.compare([ai], [edited]).changes, 0)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix='drafting-test-'))
@mock.patch('drafting.views._dispatch')
class DraftCommentTest(TestCase):
    """drafting/comments.py: questions on a passage, replies, resolving; Approve waits for them."""
    databases = {'default'}

    def setUp(self):
        from core.testing import make_case
        from drafting.ams_cases import link_case
        from drafting.models import DraftBlock
        from workspace.models import CaseTask
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        drafting = ('CASE_VIEW', 'DOCUMENT_VIEW', 'TASK_VIEW', 'DRAFT_VIEW', 'DRAFT_CREATE', 'DRAFT_EXPORT')
        self.junior = make_advocate(permissions=drafting, parent_advocate_id=self.senior.id)
        self.peer = make_advocate(permissions=drafting, parent_advocate_id=self.senior.id)
        self.outsider = make_advocate(permissions=ALL_PERMISSIONS)
        case = make_case(self.senior)
        client, project = link_case(case)
        self.task = CaseTask.objects.create(advocate_id=self.senior.id, case_id=case.id, title='Draft lease',
                                            assigned_to_id=self.junior.id, assigned_by_id=self.senior.id)
        self.session = DraftSession.objects.create(client=client, project=project, created_by_id=self.junior.id,
                                                   ams_task_id=self.task.id, facts={}, status='ready')
        self.block = DraftBlock.objects.create(session=self.session, position=0, block_type='clause', heading='Rent',
                                               text='', content_html='<p>Rent is paid monthly.</p>', source='generated')
        self.s = f'/api/drafting/draft-sessions/{self.session.id}/'

    def post(self, path, who, body=None):
        return self.client.post(path, body or {}, content_type='application/json', **auth(who))

    def comment(self, who, body='Did the client agree to rent in advance?'):
        return self.post(self.s + 'comments/', who, {'block_id': self.block.id, 'quote': 'paid monthly', 'body': body})

    def test_task_loop_with_a_question(self, dispatch):
        self.assertEqual(self.post(f'/api/drafting/drafts/{self.session.id}/send-to-ams/', self.junior).status_code, 200)
        resp = self.comment(self.senior)
        self.assertEqual(resp.status_code, 201)
        thread = resp.json()['threads'][0]
        self.assertEqual((thread['quote'], thread['author_name'], thread['resolved']), ('paid monthly', self.senior.full_name, False))
        from core.models import NotificationQueue
        self.assertTrue(NotificationQueue.objects.filter(type='DRAFT_COMMENT', advocate_id=self.junior.id).exists())
        # The junior answers; she can't close the senior's question herself.
        body = self.post(f'/api/drafting/comments/{thread["id"]}/reply/', self.junior,
                         {'body': 'Client agreed arrears, see meeting note.'}).json()
        self.assertEqual((body['open'], body['answered']), (1, 1))
        self.assertEqual(self.post(f'/api/drafting/comments/{thread["id"]}/resolve/', self.junior).status_code, 403)
        # Approve waits for the question to be resolved.
        review = lambda: self.post(f'/api/workspace/tasks/{self.task.id}/review', self.senior, {'action': 'approve'})  # noqa: E731
        resp = review()
        self.assertEqual(resp.status_code, 400)
        self.assertIn('comment', resp.json()['error'])
        self.assertEqual(self.post(f'/api/drafting/comments/{thread["id"]}/resolve/', self.senior).json()['open'], 0)
        self.assertEqual(review().status_code, 200)

    def test_who_resolves(self, dispatch):
        from .models import DraftReviewRequest
        # A peer's question on the junior's draft: the junior (author) may resolve it.
        DraftReviewRequest.objects.create(session=self.session, requested_by_id=self.junior.id,
                                          reviewer_id=self.peer.id, authority='suggest')
        tid = self.comment(self.peer, 'Typo in clause 2?').json()['threads'][0]['id']
        rows = self.client.get(self.s + 'comments/', **auth(self.junior)).json()['threads']
        self.assertTrue(rows[0]['can_resolve'])
        self.assertEqual(self.post(f'/api/drafting/comments/{tid}/resolve/', self.junior).status_code, 200)
        self.assertEqual(self.post(f'/api/drafting/comments/{tid}/reopen/', self.peer).json()['open'], 1)

    def test_delete_and_outsider(self, dispatch):
        tid = self.comment(self.junior, 'Note to self').json()['threads'][0]['id']
        self.assertEqual(self.client.get(self.s + 'comments/', **auth(self.outsider)).status_code, 404)
        self.assertEqual(self.client.delete(f'/api/drafting/comments/{tid}/', **auth(self.outsider)).status_code, 404)
        self.assertEqual(self.client.delete(f'/api/drafting/comments/{tid}/', **auth(self.junior)).json()['threads'], [])
        tid = self.comment(self.junior, 'Check dates').json()['threads'][0]['id']
        self.post(f'/api/drafting/comments/{tid}/reply/', self.junior, {'body': 'Done'})
        self.assertEqual(self.client.delete(f'/api/drafting/comments/{tid}/', **auth(self.junior)).status_code, 400)

    def test_empty_and_foreign_passage_refused(self, dispatch):
        self.assertEqual(self.comment(self.junior, '   ').status_code, 400)
        resp = self.post(self.s + 'comments/', self.junior, {'block_id': 999999, 'body': 'x'})
        self.assertEqual(resp.status_code, 400)


class CaseFileTest(TestCase):
    """drafting/casefile.py: the linked case's summary and documents, never beyond the viewer's rights."""

    def setUp(self):
        from django.utils import timezone
        from core.models import Case, Client as AmsClient, Document
        self.owner = make_advocate(permissions=DRAFTER + ('CASE_VIEW', 'DOCUMENT_VIEW'))
        self.no_docs = make_advocate(permissions=DRAFTER + ('CASE_VIEW',), parent_advocate_id=self.owner.id)
        self.outsider = make_advocate(permissions=ALL_PERMISSIONS)
        client = AmsClient.objects.create(name='K. Kannan', address='12 Anna Salai', advocate=self.owner)
        self.case = Case.objects.create(case_number='RC 12/2026', case_title='Kannan v Arun', advocate=self.owner,
                                        client=client)
        now = timezone.now()
        for name, case in (('Lease deed.pdf', self.case), ('Aadhaar.pdf', None)):
            Document.objects.create(document_name=name, original_name=name, stored_name=name, file_path=name,
                                    upload_date=now, advocate=self.owner, case=case, client=client)
        project = Project.objects.create(name='p', client=Client.objects.create(name='c'), case_id=self.case.id)
        self.linked = DraftSession.objects.create(created_by_id=self.owner.id, facts={}, status='ready', project=project)
        self.unlinked = DraftSession.objects.create(created_by_id=self.owner.id, facts={}, status='ready')

    def get(self, session, who):
        return self.client.get(f'/api/drafting/draft-sessions/{session.id}/case-file/', **auth(who))

    def test_linked_case(self):
        data = self.get(self.linked, self.owner).json()
        self.assertEqual((data['case']['caseNumber'], data['case']['client']['address']), ('RC 12/2026', '12 Anna Salai'))
        self.assertEqual(sorted(d['name'] for d in data['documents']), ['Aadhaar.pdf', 'Lease deed.pdf'])

    def test_no_case_and_rights(self):
        self.assertIsNone(self.get(self.unlinked, self.owner).json()['case'])
        self.assertEqual(self.get(self.linked, self.outsider).status_code, 404)     # not their draft
        self.linked.created_by_id = self.no_docs.id
        self.linked.save()
        data = self.get(self.linked, self.no_docs).json()
        self.assertEqual((data['canSeeDocuments'], data['documents']), (False, []))


class SaveConflictAndRestoreTest(TestCase):
    """Two people saving the same draft; putting a draft back to a saved version."""

    def setUp(self):
        from .models import DraftBlock
        self.owner = make_advocate(permissions=DRAFTER)
        self.session = DraftSession.objects.create(created_by_id=self.owner.id, facts={}, status='ready')
        self.a = DraftBlock.objects.create(session=self.session, position=0, block_type='clause', heading='Rent',
                                           text='', content_html='<p>Rent 40.</p>', source='generated')
        self.b = DraftBlock.objects.create(session=self.session, position=1, block_type='clause', heading='Term',
                                           text='', content_html='<p>11 months.</p>', source='generated')
        self.url = f'/api/drafting/draft-sessions/{self.session.id}/'

    def loaded(self):
        data = self.client.get(self.url, **auth(self.owner)).json()
        return {str(b['id']): b['rev'] for b in data['blocks']}

    def save(self, base, rent, term):
        blocks = [{'id': self.a.id, 'heading': 'Rent', 'content_html': rent, 'text': ''},
                  {'id': self.b.id, 'heading': 'Term', 'content_html': term, 'text': ''}]
        return self.client.post(self.url + 'save-blocks/', {'blocks': blocks, 'base': base},
                                content_type='application/json', **auth(self.owner))

    def test_different_clauses_merge_same_clause_refused(self):
        first, second = self.loaded(), self.loaded()
        self.assertEqual(self.save(first, '<p>Rent 45.</p>', '<p>11 months.</p>').status_code, 200)
        # The second person changed only the term: both changes stay, and they're told to reload.
        resp = self.save(second, '<p>Rent 40.</p>', '<p>12 months.</p>')
        self.assertEqual((resp.status_code, resp.json()['merged']), (200, True))
        self.a.refresh_from_db(); self.b.refresh_from_db()
        self.assertEqual((self.a.content_html, self.b.content_html), ('<p>Rent 45.</p>', '<p>12 months.</p>'))
        # A third, stale copy changing the rent again is refused and nothing is saved.
        resp = self.save(second, '<p>Rent 50.</p>', '<p>12 months.</p>')
        self.assertEqual((resp.status_code, resp.json()['conflicts']), (409, ['Rent']))
        self.a.refresh_from_db()
        self.assertEqual(self.a.content_html, '<p>Rent 45.</p>')

    def test_restore_version(self):
        from .versions import save_version
        v1 = save_version(self.session, label='first', user_id=self.owner.id)
        self.save(self.loaded(), '<p>Rent 99.</p>', '<p>11 months.</p>')
        self.b.delete()
        resp = self.client.post(self.url + f'versions/{v1.id}/restore/', **auth(self.owner))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([b['content_html'] for b in resp.json()['blocks']], ['<p>Rent 40.</p>', '<p>11 months.</p>'])
        self.assertEqual(resp.json()['blocks'][0]['id'], self.a.id)                 # same clause, anchors kept
        labels = list(self.session.versions.order_by('number').values_list('label', flat=True))
        self.assertEqual(labels, ['first', 'Before restoring v1', 'Restored v1'])
        other = make_advocate(permissions=DRAFTER)
        self.assertEqual(self.client.post(self.url + f'versions/{v1.id}/restore/', **auth(other)).status_code, 404)


class ImportChangesTest(TestCase):
    """drafting/incoming.py: a Word file from outside becomes a suggestions round + comment threads."""

    def setUp(self):
        from .models import DraftBlock
        self.owner = make_advocate(permissions=DRAFTER)
        self.session = DraftSession.objects.create(created_by_id=self.owner.id, facts={'document_title': 'Notice'},
                                                   status='ready')
        DraftBlock.objects.create(session=self.session, position=0, block_type='clause', heading='Rent', text='',
                                  content_html='<p>Rent is Rs. <span data-placeholder="Rent" data-value="">[Rent]</span> a month.</p>'
                                               '<p>Paid monthly.</p>', source='generated')
        DraftBlock.objects.create(session=self.session, position=1, block_type='clause', heading='Term', text='',
                                  content_html='<p>Eleven months.</p>', source='generated')

    def upload(self, data, name='back.docx', **extra):
        from django.core.files.uploadedfile import SimpleUploadedFile
        return self.client.post(f'/api/drafting/draft-sessions/{self.session.id}/import-changes/',
                                {'file': SimpleUploadedFile(name, data), **extra}, **auth(self.owner))

    def test_our_own_export_has_nothing(self):
        from .export.docx import render_session_docx
        resp = self.upload(render_session_docx(self.session))
        self.assertEqual(resp.status_code, 400)                       # reads the same as the draft

    def test_tracked_changes_and_comments(self):
        import io
        import zipfile
        from .export.redline import render_redline_docx
        from .models import DraftComment, DraftReviewRound
        from .versions import snapshot_blocks
        base = snapshot_blocks(self.session)
        theirs = [dict(b) for b in base]
        theirs[1]['content_html'] = '<p>Twelve months.</p>'
        out = render_redline_docx(base, theirs, 'Notice', author='Arun (counsel)')
        data = out[0] if isinstance(out, tuple) else out
        # Add a Word comment on "Paid monthly."
        zin = zipfile.ZipFile(io.BytesIO(data))
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as zout:
            for item in zin.infolist():
                body = zin.read(item.filename)
                if item.filename == 'word/document.xml':
                    xml = body.decode('utf-8')
                    i = xml.index('Paid monthly.')
                    start = xml.rindex('<w:r>', 0, i) if '<w:r>' in xml[:i] else xml.rindex('<w:r ', 0, i)
                    end = xml.index('</w:r>', i) + len('</w:r>')
                    xml = (xml[:start] + '<w:commentRangeStart w:id="0"/>' + xml[start:end]
                           + '<w:commentRangeEnd w:id="0"/>' + xml[end:])
                    body = xml.encode('utf-8')
                zout.writestr(item, body)
            zout.writestr('word/comments.xml',
                          '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                          '<w:comment w:id="0" w:author="Arun (counsel)"><w:p><w:r><w:t>Paid in advance?</w:t></w:r></w:p>'
                          '</w:comment></w:comments>')
        resp = self.upload(buf.getvalue(), from_name='')
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual((body['changes'], body['comments'], body['tracked'], body['from_name']),
                         (1, 1, True, 'Arun (counsel)'))
        rnd = DraftReviewRound.objects.get(id=body['round'])
        self.assertEqual((rnd.decider_id, rnd.external_from), (self.owner.id, 'Arun (counsel)'))
        comment = DraftComment.objects.get(session=self.session)
        self.assertEqual(comment.quote, 'Paid monthly.')
        self.assertIn('Paid in advance?', comment.body)
        self.assertEqual(comment.block_id, base[0]['block_id'])

    def test_not_word(self):
        self.assertEqual(self.upload(b'%PDF-1.4', name='back.pdf').status_code, 400)
        self.assertEqual(self.upload(b'not a zip').status_code, 400)


class TemplateLayoutTest(TestCase):
    """services/layout.py: a generated draft lays out like its Word template."""

    def make_docx(self):
        import tempfile
        from docx import Document
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        doc = Document()
        doc.styles['Normal'].paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY   # inherited, not on the paragraph
        doc.add_paragraph('LEGAL NOTICE').alignment = WD_ALIGN_PARAGRAPH.CENTER
        doc.add_paragraph('From:').alignment = WD_ALIGN_PARAGRAPH.LEFT
        doc.add_paragraph('Under instructions from and on behalf of my client I serve this notice upon you.')
        doc.add_paragraph('The tenant has failed to pay the rent for two months despite repeated requests.')
        doc.add_paragraph('Yours faithfully, Advocate').alignment = WD_ALIGN_PARAGRAPH.RIGHT
        f = tempfile.NamedTemporaryFile(suffix='.docx', delete=False)
        doc.save(f.name)
        f.close()
        return f.name

    def test_layout_and_generated_html(self):
        import os
        from .services.layout import docx_paragraphs, layout_for
        from .tasks import _styled_html
        path = self.make_docx()
        try:
            paras = docx_paragraphs(path)
        finally:
            os.unlink(path)
        self.assertEqual([a for _, a in paras], ['center', 'left', 'justify', 'justify', 'right'])
        text = '\n'.join(t for t, _ in paras)
        lay = layout_for(text, paras)
        self.assertEqual(lay['align'], 'justify')          # the clause's usual alignment
        # New wording: lines that match the template keep their own alignment, the rest follow the body.
        html = _styled_html('LEGAL NOTICE\nFrom:\nUnder instructions from and on behalf of my client Kannan.\n'
                            'A brand new sentence the model wrote.\nYours faithfully, Advocate',
                            {'align': lay['align']}, lay['lines'])
        self.assertEqual(html.count('text-align:center'), 1)
        self.assertEqual(html.count('text-align:justify'), 2)
        self.assertEqual(html.count('text-align:right'), 1)
        self.assertIn('<p>From:</p>', html)                  # left = the editor default


class ImportKeepsLayoutTest(TestCase):
    """Import changes keeps tables, alignment and lists of the received Word file."""

    def test_table_and_alignment(self):
        from .export.docx import render_session_docx
        from .incoming import _Reader, their_blocks
        from .models import DraftBlock
        owner = make_advocate(permissions=DRAFTER)
        session = DraftSession.objects.create(created_by_id=owner.id, facts={'document_title': 'Lease'}, status='ready')
        DraftBlock.objects.create(
            session=session, position=0, block_type='clause', heading='Schedule', text='',
            content_html='<p style="text-align:justify">The rent is payable as below.</p>'
                         '<table><tr><td><p>Month</p></td><td><p>Rent</p></td></tr>'
                         '<tr><td><p>August</p></td><td><p>40,000</p></td></tr></table>'
                         '<ul><li><p>Paid by transfer</p></li></ul>', source='generated')
        ours = render_session_docx(session)
        self.assertEqual(their_blocks(session, _Reader(ours))[1][0]['content_html'],
                         session.blocks.get().content_html)          # nothing changed: untouched
        # Their copy: the rent cell and the opening sentence changed.
        block = session.blocks.get()
        block.content_html = block.content_html.replace('40,000', '45,000').replace('as below', 'monthly as below')
        block.save()
        theirs = render_session_docx(session)
        block.content_html = block.content_html.replace('45,000', '40,000').replace('monthly as below', 'as below')
        block.save()
        html = their_blocks(session, _Reader(theirs))[1][0]['content_html']
        self.assertIn('<table>', html)
        self.assertIn('<td><p>45,000</p></td>', html)
        self.assertIn('text-align: justify', html)
        self.assertIn('<ul><li><p>Paid by transfer</p></li></ul>', html)


class PdfTableTextTest(TestCase):
    """A PDF's tables reach the draft as Markdown rows; they must come out as a grid."""

    def test_markdown_rows_become_a_table(self):
        from types import SimpleNamespace
        from .tasks import _styled_html, _tables_to_html
        text = ('Fees are payable as below.\n| Tier | Fee |\n|------|-----|\n| Up to 10,000 | Rs. 5 |\n'
                '| Above 10,000 | Rs. 4 |\nPayment within 30 days.')
        html = _styled_html(text, {'align': 'justify'}, [])
        self.assertIn('<table><tbody><tr><th><p>Tier</p></th><th><p>Fee</p></th></tr>', html)
        self.assertIn('<td><p>Rs. 4</p></td>', html)
        self.assertNotIn('---', html)
        self.assertEqual(html.count('text-align:justify'), 2)          # the sentences around it
        block = SimpleNamespace(text=text, content_html='')
        _tables_to_html([block])                                        # unstyled block: still a grid
        self.assertIn('<table>', block.content_html)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix='drafting-test-'))
class FirmSetupOwnershipTest(TestCase):
    """Templates and playbooks are firm set-up: never visible to another firm;
    "delete" archives, allowed only to the creator or a Super Admin; restorable."""
    databases = {'default'}

    def setUp(self):
        from core.models import AdvocateRole, Role
        self.rajesh = make_advocate(permissions=ALL_PERMISSIONS)                       # creator
        self.arjun = make_advocate(permissions=ALL_PERMISSIONS, parent_advocate_id=self.rajesh.id)
        self.admin = make_advocate(permissions=ALL_PERMISSIONS, parent_advocate_id=self.rajesh.id)
        role, _ = Role.objects.get_or_create(name='Super Admin')
        AdvocateRole.objects.create(advocate_id=self.admin.id, role_id=role.id)
        self.other_firm = make_advocate(permissions=ALL_PERMISSIONS)
        self.pb = Playbook.objects.create(name='NDA Playbook', category='NDA', method='scratch',
                                          status='ready', created_by_id=self.rajesh.id)
        self.tpl = Template.objects.create(name='Mutual NDA', document_type='nda', status='ready',
                                           created_by_id=self.rajesh.id)

    def _ids(self, url, who, **params):
        body = self.client.get(url, params, **auth(who)).json()
        return [r['id'] for r in body.get('results', body)]

    def test_another_firm_cannot_see_or_delete(self):
        for url, obj in (('/api/drafting/playbooks/', self.pb), ('/api/drafting/templates/', self.tpl)):
            self.assertNotIn(obj.id, self._ids(url, self.other_firm))
            self.assertEqual(self.client.delete(f'{url}{obj.id}/', **auth(self.other_firm)).status_code, 404)

    def test_a_colleague_sees_and_edits_but_cannot_delete(self):
        self.assertIn(self.pb.id, self._ids('/api/drafting/playbooks/', self.arjun))
        resp = self.client.delete(f'/api/drafting/playbooks/{self.pb.id}/', **auth(self.arjun))
        self.assertEqual(resp.status_code, 403)
        resp = self.client.patch(f'/api/drafting/playbooks/{self.pb.id}/', {'description': 'Our NDA rules'},
                                 content_type='application/json', **auth(self.arjun))
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_the_creator_archives_and_restores(self):
        for url, obj in (('/api/drafting/playbooks/', self.pb), ('/api/drafting/templates/', self.tpl)):
            self.assertEqual(self.client.delete(f'{url}{obj.id}/', **auth(self.rajesh)).status_code, 204)
            obj.refresh_from_db()
            self.assertIsNotNone(obj.archived_at)                       # kept, not deleted
            self.assertNotIn(obj.id, self._ids(url, self.rajesh))
            self.assertIn(obj.id, self._ids(url, self.rajesh, archived='1'))
            self.assertEqual(self.client.post(f'{url}{obj.id}/restore/', **auth(self.arjun)).status_code, 403)
            self.assertEqual(self.client.post(f'{url}{obj.id}/restore/', **auth(self.rajesh)).status_code, 200)
            self.assertIn(obj.id, self._ids(url, self.rajesh))

    def test_a_super_admin_may_archive_anyones(self):
        self.assertEqual(self.client.delete(f'/api/drafting/playbooks/{self.pb.id}/', **auth(self.admin)).status_code, 204)

    def test_list_says_who_may_archive(self):
        rows = {r['id']: r for r in self.client.get('/api/drafting/playbooks/', **auth(self.arjun)).json()['results']}
        self.assertFalse(rows[self.pb.id]['can_archive'])
        rows = {r['id']: r for r in self.client.get('/api/drafting/playbooks/', **auth(self.rajesh)).json()['results']}
        self.assertTrue(rows[self.pb.id]['can_archive'])
