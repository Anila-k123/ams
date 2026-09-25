"""The Client role: a client signs in to AMS but can reach only their own
matters. The gate sweep below walks every URL in the project, so an endpoint
added later that forgets about clients fails this test instead of leaking."""

import datetime
import os
import re
import shutil
import tempfile
from unittest import mock

from django.core import mail
from django.test import TestCase, override_settings
from django.urls import URLPattern, URLResolver, get_resolver
from django.utils import timezone

from core.jwt import generate_token
from core.models import Advocate, AuditLog, CaseEvent, ClientPayment, Document, Invoice
from core.testing import ALL_PERMISSIONS, auth, make_advocate, make_case, make_client
from workspace.models import CaseNote, CaseParty, CaseTask

from .gate import allowed
from .models import ClientInvite, ClientUser

PASSWORD = 'Client@2026'


def _walk(patterns, prefix=''):
    for p in patterns:
        route = prefix + str(p.pattern)
        if isinstance(p, URLResolver):
            yield from _walk(p.url_patterns, route)
        elif isinstance(p, URLPattern):
            yield route, p.callback


def _concrete(route):
    """'api/cases/<int:pk>' -> '/api/cases/1'; DRF router regex routes too:
    '^draft-sessions/(?P<pk>[^/.]+)/$' -> '/draft-sessions/1/'."""
    # Regex groups first, before the <name> rule below can rewrite '(?P<pk>'.
    path = re.sub(r'\\?\.\(\?P<format>[^)]*\)/?', '', route)    # optional .json suffix
    path = re.sub(r'\(\?P<[a-z_]+>[^)]*\)', '1', path)
    path = re.sub(r'<(?:int:)?[a-z_]+>', '1', path)
    path = re.sub(r'<str:[a-z_]+>', 'x', path)
    path = re.sub(r'<path:[a-z_]+>', 'x', path)
    path = path.replace('/?', '/').replace('^', '').replace('$', '').replace('\\', '')
    return '/' + path.lstrip('/')


def _is_public(callback):
    cls = getattr(callback, 'cls', None) or getattr(callback, 'view_class', None)
    return cls is not None and list(getattr(cls, 'authentication_classes', [None])) == []


class ClientTestBase(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.dir = tempfile.mkdtemp()
        cls._settings = override_settings(DOCUMENT_UPLOAD_DIR=cls.dir, SUMMARY_ENABLED=False,
                                          CLIENT_APP_URL='http://ams.test')
        cls._settings.enable()

    @classmethod
    def tearDownClass(cls):
        cls._settings.disable()
        shutil.rmtree(cls.dir, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.senior = make_advocate(permissions=tuple(ALL_PERMISSIONS) + ('DOCUMENT_EDIT', 'TASK_ASSIGN'),
                                    full_name='Rajesh Kumar')
        self.junior = make_advocate(permissions=ALL_PERMISSIONS, parent_advocate_id=self.senior.id)
        self.client_a = make_client(self.senior, 'Coromandel Exports', email='office@coromandel.test')
        self.client_b = make_client(self.senior, 'Other Client')
        self.case_a = make_case(self.senior, self.client_a, case_title='Coromandel vs UoI')
        self.case_b = make_case(self.senior, self.client_b, case_title='Other matter')
        self.anita = self.create_login(self.client_a, 'anita@coromandel.test')
        self.other = self.create_login(self.client_b, 'b@other.test')

    def create_login(self, client, email, password=PASSWORD):
        resp = self.client.post(f'/api/clients/{client.id}/logins', {'email': email, 'fullName': email.split('@')[0]},
                                content_type='application/json', **auth(self.senior))
        assert resp.status_code == 201, resp.content
        token = resp.json()['inviteUrl'].split('token=')[1]
        self.client.post('/api/client-auth/set-password', {'token': token, 'password': password},
                         content_type='application/json')
        return Advocate.objects.get(email=email)

    def doc(self, case, name, shared):
        path = os.path.join(self.dir, f'{name}.pdf')
        with open(path, 'wb') as fh:
            fh.write(b'%PDF ' + name.encode())
        now = datetime.datetime.now()
        return Document.objects.create(
            document_name=name, original_name=f'{name}.pdf', stored_name=name, file_path=path, file_size=5,
            file_type='application/pdf', category='Filing', version=1, download_count=0, status='ACTIVE',
            upload_date=now, updated_at=now, advocate_id=self.senior.id, case=case, client_visible=shared)


class GateSweepTest(ClientTestBase):
    def test_every_non_allowlisted_endpoint_refuses_a_client(self):
        headers = auth(self.anita)
        checked = leaks = 0
        problems = []
        for route, callback in _walk(get_resolver().url_patterns):
            if _is_public(callback):
                continue
            path = _concrete(route)
            for method in ('get', 'post', 'put', 'patch', 'delete'):
                if allowed(method.upper(), path):
                    continue
                resp = getattr(self.client, method)(path, {}, content_type='application/json', **headers) \
                    if method != 'get' else self.client.get(path, **headers)
                checked += 1
                # 403 from the gate; 401 where an endpoint does its own token check (downloads);
                # 301/404/405 only when Django never reached a view (APPEND_SLASH
                # redirect, unknown path / method).
                if resp.status_code not in (301, 401, 403, 404, 405):
                    leaks += 1
                    problems.append(f'{method.upper()} {path} -> {resp.status_code}')
        self.assertGreater(checked, 150)
        self.assertEqual(problems, [], f'{leaks} endpoint(s) answered a client')

    def test_every_drafting_endpoint_is_refused_by_the_gate(self):
        # Stricter than the sweep above: each drafting route must reach the gate and
        # get its 403 (a 404 would mean the path was never really exercised).
        headers = auth(self.anita)
        paths = sorted({_concrete(r) for r, cb in _walk(get_resolver().url_patterns)
                        if r.startswith('api/drafting/') and 'format' not in r})
        self.assertGreater(len(paths), 20)
        wrong = []
        for path in paths:
            for method in ('get', 'post', 'patch', 'delete'):
                resp = (self.client.get(path, **headers) if method == 'get' else
                        getattr(self.client, method)(path, {}, content_type='application/json', **headers))
                if resp.status_code != 403:
                    wrong.append(f'{method.upper()} {path} -> {resp.status_code}')
        self.assertEqual(wrong, [])

    def test_firm_endpoints_explicitly_forbidden(self):
        h = auth(self.anita)
        for path in ('/api/cases/my-cases', f'/api/workspace/cases/{self.case_a.id}/tasks', '/api/clients', '/api/documents',
                     '/api/invoices', '/api/admin/users'):
            self.assertEqual(self.client.get(path, **h).status_code, 403, path)
        self.assertEqual(self.client.get('/api/drafting/samples/', **h).status_code, 403)
        # Firm document downloads refuse a client token, header or ?token=.
        d = self.doc(self.case_a, 'Filed', True)
        self.assertEqual(self.client.get(f'/api/documents/download/{d.id}', **h).status_code, 401)
        self.assertEqual(self.client.get(f'/api/documents/preview/{d.id}?token={generate_token(self.anita)}')
                         .status_code, 401)

    def test_allowlisted_basics_work(self):
        h = auth(self.anita)
        self.assertEqual(self.client.get('/api/advocates/my-permissions', **h).status_code, 200)
        self.assertEqual(self.client.get('/api/client/me', **h).json()['client']['name'], 'Coromandel Exports')


class ClientScopeTest(ClientTestBase):
    def setUp(self):
        super().setUp()
        tomorrow = datetime.date.today() + datetime.timedelta(days=1)
        CaseEvent.objects.create(title='Admission hearing', event_type='HEARING', date=tomorrow, case=self.case_a,
                                 advocate=self.senior)
        CaseEvent.objects.create(title='Other hearing', event_type='HEARING', date=tomorrow, case=self.case_b,
                                 advocate=self.senior)
        CaseParty.objects.create(advocate_id=self.senior.id, case_id=self.case_a.id, name='Union of India',
                                 role='Respondent', is_opponent=True)
        CaseNote.objects.create(advocate_id=self.senior.id, case_id=self.case_a.id, body='weak on limitation')
        CaseTask.objects.create(advocate_id=self.senior.id, case_id=self.case_a.id, title='INTERNAL: draft reply')
        self.shared = self.doc(self.case_a, 'Filed petition', True)
        self.private = self.doc(self.case_a, 'Internal strategy memo', False)
        self.other_doc = self.doc(self.case_b, 'Other client filing', True)
        self.inv = Invoice.objects.create(invoice_number='INV-A', amount=11800, invoice_date=datetime.date.today(),
                                          due_date=datetime.date.today(), status='UNPAID', advocate=self.senior,
                                          case=self.case_a, client=self.client_a)
        self.inv_b = Invoice.objects.create(invoice_number='INV-B', amount=5, invoice_date=datetime.date.today(),
                                            due_date=datetime.date.today(), status='UNPAID', advocate=self.senior,
                                            case=self.case_b, client=self.client_b)
        ClientPayment.objects.create(amount=5000, payment_date=datetime.date.today(), payment_mode='UPI',
                                     reference_number='UTR1', advocate=self.senior, case=self.case_a,
                                     client=self.client_a)

    def get(self, path, who=None):
        return self.client.get('/api/client/' + path, **auth(who or self.anita))

    def test_only_own_cases_and_nothing_internal(self):
        self.assertEqual([c['id'] for c in self.get('cases').json()], [self.case_a.id])
        self.assertEqual(self.get(f'cases/{self.case_b.id}').status_code, 404)
        detail = self.get(f'cases/{self.case_a.id}').json()
        self.assertEqual([h['title'] for h in detail['hearings']], ['Admission hearing'])
        self.assertEqual(detail['parties'][0]['name'], 'Union of India')
        self.assertEqual([d['id'] for d in detail['documents']], [self.shared.id])
        text = str(detail)
        for secret in ('INTERNAL', 'weak on limitation', 'Internal strategy memo'):
            self.assertNotIn(secret, text)

    def test_documents_invoices_payments(self):
        self.assertEqual([d['id'] for d in self.get('documents').json()], [self.shared.id])
        self.assertEqual(self.get(f'documents/{self.private.id}/file').status_code, 404)
        self.assertEqual(self.get(f'documents/{self.other_doc.id}/file').status_code, 404)
        self.assertEqual(b''.join(self.get(f'documents/{self.shared.id}/file').streaming_content),
                         b'%PDF Filed petition')
        self.assertEqual([i['invoiceNumber'] for i in self.get('invoices').json()], ['INV-A'])
        self.assertEqual(self.get(f'invoices/{self.inv_b.id}/pdf').status_code, 404)
        with mock.patch('reports.pdf.build_invoice_pdf', return_value=b'%PDF inv'):
            self.assertEqual(self.get(f'invoices/{self.inv.id}/pdf').content, b'%PDF inv')
        self.assertEqual([p['reference'] for p in self.get('payments').json()], ['UTR1'])
        self.assertEqual(self.get('payments', self.other).json(), [])
        self.assertTrue(AuditLog.objects.filter(action_type='CLIENT_DOWNLOAD', advocate_id=self.senior.id).exists())

    def test_overview(self):
        body = self.get('overview').json()
        self.assertEqual((body['totalCases'], body['outstandingInvoices'], body['sharedDocuments']), (1, 1, 1))

    def test_client_api_refuses_firm_staff(self):
        self.assertEqual(self.client.get('/api/client/cases', **auth(self.senior)).status_code, 403)

    def test_share_toggle_needs_document_edit(self):
        junior = self.client.put(f'/api/documents/{self.private.id}/client-visible', {'visible': True},
                                 content_type='application/json', **auth(self.junior))
        self.assertEqual(junior.status_code, 403)
        ok = self.client.put(f'/api/documents/{self.private.id}/client-visible', {'visible': True},
                             content_type='application/json', **auth(self.senior))
        self.assertEqual(ok.json()['clientVisible'], True)
        self.assertEqual(len(self.get('documents').json()), 2)


class LoginsTest(ClientTestBase):
    def login(self, email, password=PASSWORD):
        return self.client.post('/api/advocates/login', {'email': email, 'password': password},
                                content_type='application/json')

    def test_client_signs_in_at_normal_login(self):
        resp = self.login('anita@coromandel.test')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['role'], 'CLIENT')
        self.assertIsNotNone(ClientUser.objects.get(advocate_id=self.anita.id).last_login_at)

    def test_invite_email_link_once_and_expiry(self):
        c = make_client(self.senior, 'Sundaram Finance')
        resp = self.client.post(f'/api/clients/{c.id}/logins', {'email': 'ops@sundaram.test'},
                                content_type='application/json', **auth(self.junior))
        body = resp.json()
        self.assertEqual((resp.status_code, body['status'], body['emailSent']), (201, 'INVITED', True))
        self.assertIn(body['inviteUrl'], mail.outbox[-1].body)
        self.assertEqual(self.login('ops@sundaram.test', 'anything').status_code, 401)   # no usable password yet
        token = body['inviteUrl'].split('token=')[1]
        set_pw = lambda: self.client.post('/api/client-auth/set-password', {'token': token, 'password': 'Newpass@123'},
                                          content_type='application/json')
        self.assertEqual(set_pw().status_code, 200)
        self.assertEqual(set_pw().status_code, 400)                                       # single use
        self.assertEqual(self.login('ops@sundaram.test', 'Newpass@123').status_code, 200)
        again = self.client.post(f'/api/clients/{c.id}/logins', {'email': 'ops@sundaram.test'},
                                 content_type='application/json', **auth(self.senior)).json()
        ClientInvite.objects.update(expires_at=timezone.now() - datetime.timedelta(minutes=1))
        expired = self.client.post('/api/client-auth/set-password',
                                   {'token': again['inviteUrl'].split('token=')[1], 'password': 'Other@1234'},
                                   content_type='application/json')
        self.assertEqual(expired.status_code, 400)

    def test_switch_off(self):
        link = ClientUser.objects.get(advocate_id=self.anita.id)
        resp = self.client.patch(f'/api/clients/{self.client_a.id}/logins/{link.id}', {'isActive': False},
                                 content_type='application/json', **auth(self.senior))
        self.assertEqual(resp.json()['status'], 'DISABLED')
        self.assertEqual(self.login('anita@coromandel.test').status_code, 401)
        self.assertEqual(self.client.get('/api/client/me', **auth(self.anita)).status_code, 401)

    def test_firm_rules(self):
        outsider = make_advocate(permissions=ALL_PERMISSIONS)
        self.assertEqual(self.client.get(f'/api/clients/{self.client_a.id}/logins', **auth(outsider)).status_code, 404)
        taken = self.client.post(f'/api/clients/{self.client_a.id}/logins', {'email': self.junior.email},
                                 content_type='application/json', **auth(self.senior))
        self.assertEqual(taken.status_code, 409)   # a staff email can't become a client login
        clerk = make_advocate(permissions=('CLIENT_VIEW',), parent_advocate_id=self.senior.id)
        self.assertEqual(self.client.get(f'/api/clients/{self.client_a.id}/logins', **auth(clerk)).status_code, 403)


class KeptOutOfFirmListsTest(ClientTestBase):
    def test_not_in_user_management_and_role_protected(self):
        admin = make_advocate(permissions=tuple(ALL_PERMISSIONS) + ('USER_MANAGE', 'ROLE_MANAGE'))
        emails = [u['email'] for u in self.client.get('/api/admin/users', **auth(admin)).json()]
        self.assertNotIn('anita@coromandel.test', emails)
        self.assertEqual(self.client.get(f'/api/admin/users/{self.anita.id}', **auth(admin)).status_code, 404)
        roles = self.client.get('/api/roles', **auth(admin)).json()
        self.assertNotIn('Client', [r['name'] for r in roles])
        from core.models import Role
        client_role = Role.objects.get(name='Client')
        self.assertEqual(self.client.get(f'/api/roles/{client_role.id}/permissions', **auth(admin)).status_code, 404)
        assign = self.client.put(f'/api/admin/users/{self.junior.id}/roles', {'roleIds': [client_role.id]},
                                 content_type='application/json', **auth(admin))
        self.assertEqual(assign.status_code, 400)

    def test_not_a_task_assignee_or_in_practice(self):
        from core.practice import practice_ids
        self.assertNotIn(self.anita.id, practice_ids(self.senior))
        self.assertEqual(self.anita.parent_advocate_id, None)
        self.assertEqual(set(self.anita.permission_codes()), set())
