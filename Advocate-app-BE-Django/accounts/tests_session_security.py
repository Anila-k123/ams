"""Phase 4: firm-aware login, token claims, revocation, signed document links
and the security audit trail. Three independent firms, firm mode."""
import datetime
import json
import os
import shutil
import tempfile
from unittest import mock

import jwt
from django.conf import settings
from django.core import mail
from django.test import TestCase, override_settings

from core.jwt import generate_token
from core.models import AdvocateRole, AuditLog, Case, Client, Document
from core.passwords import hash_password
from core.testing import auth
from firms.models import Firm, FirmMembership
from firms.services import suspend_firm, suspend_membership
from rbac import firm_roles as fr
from rbac.tests_firm_rbac import make_templates
from core.testing import make_advocate

PW = 'Correct#Horse9'
NOW = datetime.datetime.now


def bearer(token):
    return {'HTTP_AUTHORIZATION': 'Bearer ' + token}


def forge(**claims):
    base = {'sub': claims.get('sub'), 'advocateId': claims.get('advocateId'), 'tv': 0, 'aud': 'ams',
            'iat': datetime.datetime.now(datetime.timezone.utc),
            'exp': datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)}
    base.update(claims)
    return jwt.encode({k: v for k, v in base.items() if v is not None}, settings.JWT_SIGNING_KEY, algorithm='HS256')


@override_settings(TENANCY_MODE='firm', LOGIN_LOCKOUT_ENABLED=True, LOGIN_MAX_FAILURES=5,
                   LOGIN_MAX_FAILURES_PER_IP=20, LOGIN_LOCKOUT_MINUTES=15)
class SessionSecurityTests(TestCase):
    def setUp(self):
        make_templates()
        self.dir = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.dir, 'documents'))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self._s = override_settings(DOCUMENT_UPLOAD_DIR=self.dir, SUMMARY_ENABLED=False)
        self._s.enable()
        self.addCleanup(self._s.disable)
        self.f, self.roles = {}, {}
        for key in 'ABC':
            self.f[key] = Firm.objects.create(name=f'Firm {key}', slug=key.lower(), status=Firm.ACTIVE)
            self.roles[key] = {r.name: r for r in fr.provision_default_roles(self.f[key]).values()}
        self.admin_a = self.member('A', 'Super Admin', email='admin@a.test')
        self.senior_a = self.member('A', 'Senior Advocate', email='senior@a.test')
        self.junior_a = self.member('A', 'Advocate', email='junior@a.test', parent=self.senior_a)
        self.admin_b = self.member('B', 'Super Admin', email='admin@b.test')
        self.admin_c = self.member('C', 'Super Admin', email='admin@c.test')
        client = Client.objects.create(name='A client', deleted=False, advocate_id=self.senior_a.id)
        self.case_a = Case.objects.create(case_number='A/1', case_title='A', status='Active', deleted=False,
                                          advocate_id=self.senior_a.id, client=client)
        with open(os.path.join(self.dir, 'documents', 'a.pdf'), 'wb') as fh:
            fh.write(b'%PDF secret A')
        self.doc_a = Document.objects.create(
            document_name='Plaint', original_name='a.pdf', stored_name='a.pdf',
            file_path=os.path.join(self.dir, 'documents', 'a.pdf'), file_size=1, file_type='application/pdf',
            version=1, download_count=0, status='ACTIVE', upload_date=NOW(), updated_at=NOW(),
            advocate_id=self.senior_a.id, case=self.case_a, client=client)

    def member(self, key, *roles, email=None, parent=None):
        adv = make_advocate(email=email, password=hash_password(PW),
                            parent_advocate_id=parent.id if parent else None)
        m = FirmMembership.objects.create(firm=self.f[key], advocate_id=adv.id, status=FirmMembership.ACTIVE,
                                          joined_at=NOW())
        for r in roles:
            AdvocateRole.objects.create(advocate_id=adv.id, role_id=self.roles[key][r].id,
                                        firm_id=self.f[key].id, membership_id=m.id)
        return adv

    def login(self, email, password=PW):
        return self.client.post('/api/advocates/login', data=json.dumps({'email': email, 'password': password}),
                                content_type='application/json')

    def cases(self, headers):
        return self.client.get('/api/cases', **headers).status_code

    # ---- login ----------------------------------------------------------------
    def test_login_returns_firm_context_and_a_firm_bound_token(self):
        r = self.login('senior@a.test')
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body['firm']['publicId'], str(self.f['A'].public_id))
        self.assertEqual(body['membership']['kind'], 'STAFF')
        self.assertIn('CASE_VIEW', body['permissions'])
        claims = jwt.decode(body['token'], settings.JWT_SIGNING_KEY, algorithms=['HS256'], audience='ams')
        self.assertEqual((claims['fid'], claims['mid'], claims['aud'], claims['tv']),
                         (str(self.f['A'].public_id),
                          FirmMembership.objects.get(advocate_id=self.senior_a.id).id, 'ams', 0))
        self.assertLessEqual(claims['exp'] - claims['iat'], 8 * 3600)
        self.assertEqual(self.cases(bearer(body['token'])), 200)

    def test_invalid_credentials_do_not_reveal_whether_the_account_exists(self):
        a, b = self.login('senior@a.test', 'wrong'), self.login('nobody@a.test', 'wrong')
        self.assertEqual((a.status_code, a.json()), (b.status_code, b.json()))
        self.assertEqual(a.json()['code'], 'INVALID_CREDENTIALS')

    def test_refusals_after_a_correct_password(self):
        loner = make_advocate(email='loner@x.test', password=hash_password(PW))
        self.assertEqual(self.login('loner@x.test').json()['code'], 'NO_ACTIVE_MEMBERSHIP')
        FirmMembership.objects.filter(advocate_id=self.junior_a.id).update(status=FirmMembership.SUSPENDED)
        self.assertEqual(self.login('junior@a.test').json()['code'], 'MEMBERSHIP_SUSPENDED')
        Firm.objects.filter(id=self.f['B'].id).update(status=Firm.SUSPENDED)
        r = self.login('admin@b.test')
        self.assertEqual((r.status_code, r.json()['code']), (403, 'FIRM_SUSPENDED'))
        from core.practice import mark_left
        mark_left(self.admin_c)
        self.assertEqual(self.login('admin@c.test').json()['code'], 'ACCOUNT_DISABLED')
        self.assertNotIn('token', r.json())
        del loner

    def test_lockout_still_applies(self):
        for _ in range(5):
            self.login('senior@a.test', 'wrong')
        r = self.login('senior@a.test')
        self.assertEqual((r.status_code, r.json()['code']), (429, 'LOCKED'))

    # ---- token validation ------------------------------------------------------------
    def test_tampered_firm_or_membership_claims_are_refused(self):
        a_mid = FirmMembership.objects.get(advocate_id=self.senior_a.id).id
        b_mid = FirmMembership.objects.get(advocate_id=self.admin_b.id).id
        base = dict(sub=self.senior_a.email, advocateId=self.senior_a.id)
        wrong_firm = forge(**base, fid=str(self.f['B'].public_id), mid=a_mid)
        wrong_mid = forge(**base, fid=str(self.f['A'].public_id), mid=b_mid)
        no_claims = forge(**base)
        good = forge(**base, fid=str(self.f['A'].public_id), mid=a_mid)
        self.assertEqual(self.cases(bearer(wrong_firm)), 401)
        self.assertEqual(self.cases(bearer(wrong_mid)), 401)
        self.assertEqual(self.cases(bearer(no_claims)), 401)
        self.assertEqual(self.cases(bearer(good)), 200)

    def test_wrong_audience_expired_and_legacy_tokens_are_refused(self):
        a_mid = FirmMembership.objects.get(advocate_id=self.senior_a.id).id
        base = dict(sub=self.senior_a.email, advocateId=self.senior_a.id, fid=str(self.f['A'].public_id), mid=a_mid)
        self.assertEqual(self.cases(bearer(forge(**base, aud='platform'))), 401)
        old = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=9)
        self.assertEqual(self.cases(bearer(forge(**base, iat=old, exp=old + datetime.timedelta(hours=8)))), 401)
        legacy = jwt.encode({'sub': self.senior_a.email, 'advocateId': self.senior_a.id,
                             'exp': datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)},
                            settings.JWT_SIGNING_KEY, algorithm='HS256')
        self.assertEqual(self.cases(bearer(legacy)), 401)
        with override_settings(JWT_ACCEPT_LEGACY_UNTIL=datetime.datetime.now() + datetime.timedelta(hours=1)):
            self.assertEqual(self.cases(bearer(legacy)), 200)      # grace window, still fully checked
            FirmMembership.objects.filter(advocate_id=self.senior_a.id).update(status=FirmMembership.LEFT)
            self.assertEqual(self.cases(bearer(legacy)), 401)

    def test_junior_cannot_gain_access_by_crafting_claims(self):
        # Claiming the senior's identity needs the senior's signature-valid token;
        # claiming the admin's membership with the junior's id is refused.
        admin_mid = FirmMembership.objects.get(advocate_id=self.admin_a.id).id
        crafted = forge(sub=self.junior_a.email, advocateId=self.junior_a.id,
                        fid=str(self.f['A'].public_id), mid=admin_mid)
        self.assertEqual(self.client.get('/api/roles', **bearer(crafted)).status_code, 401)
        forged_sig = jwt.encode({'advocateId': self.admin_a.id, 'aud': 'ams'}, 'not-the-key', algorithm='HS256')
        self.assertEqual(self.cases(bearer(forged_sig)), 401)

    def test_firm_admin_cannot_act_as_another_firm(self):
        token = self.login('admin@a.test').json()['token']
        b_mid = FirmMembership.objects.get(advocate_id=self.admin_b.id).id
        spoof = forge(sub=self.admin_a.email, advocateId=self.admin_a.id,
                      fid=str(self.f['B'].public_id), mid=b_mid)
        self.assertEqual(self.client.get('/api/roles', **bearer(spoof)).status_code, 401)
        ids = {r['id'] for r in self.client.get('/api/roles', **bearer(token)).json()}
        self.assertFalse(ids & {r.id for r in self.roles['B'].values()})

    # ---- revocation -----------------------------------------------------------------------
    def test_logout_ends_existing_tokens(self):
        token = self.login('senior@a.test').json()['token']
        other_device = self.login('senior@a.test').json()['token']
        self.assertEqual(self.client.post('/api/advocates/logout', **bearer(token)).status_code, 200)
        self.assertEqual(self.cases(bearer(token)), 401)
        self.assertEqual(self.cases(bearer(other_device)), 401)       # account-wide by design
        self.assertEqual(self.cases(bearer(self.login('senior@a.test').json()['token'])), 200)

    def test_password_change_ends_old_tokens(self):
        token = self.login('senior@a.test').json()['token']
        r = self.client.put('/api/profile/change-password', data=json.dumps({
            'currentPassword': PW, 'newPassword': 'New#Pass1234', 'confirmNewPassword': 'New#Pass1234'}),
            content_type='application/json', **bearer(token))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.cases(bearer(token)), 401)
        self.assertEqual(self.login('senior@a.test', 'New#Pass1234').status_code, 200)

    @override_settings(OTP_MAX_FAILURES=5, OTP_RATE_LIMIT=10, OTP_EXPIRY_MINUTES=10)
    def test_password_reset_ends_old_tokens(self):
        import re
        token = self.login('senior@a.test').json()['token']
        self.client.post('/api/auth/forgot-password', data=json.dumps({'email': 'senior@a.test'}),
                         content_type='application/json')
        code = re.search(r'\b(\d{6})\b', mail.outbox[-1].body).group(1)
        r = self.client.post('/api/auth/reset-password', data=json.dumps(
            {'email': 'senior@a.test', 'otp': code, 'newPassword': 'Reset#Pass123'}), content_type='application/json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.cases(bearer(token)), 401)

    def test_deactivation_closure_and_admin_revoke_end_tokens(self):
        t_junior = self.login('junior@a.test').json()['token']
        t_admin = self.login('admin@a.test').json()['token']
        r = self.client.post(f'/api/admin/users/{self.junior_a.id}/revoke-sessions', **bearer(t_admin))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.cases(bearer(t_junior)), 401)
        t_senior = self.login('senior@a.test').json()['token']
        from core.practice import mark_left
        mark_left(self.senior_a)
        self.assertEqual(self.cases(bearer(t_senior)), 401)
        # Another firm's admin can't revoke A's member.
        t_b = self.login('admin@b.test').json()['token']
        self.assertEqual(self.client.post(f'/api/admin/users/{self.admin_a.id}/revoke-sessions',
                                          **bearer(t_b)).status_code, 404)

    def test_suspension_denies_immediately(self):
        t_senior = self.login('senior@a.test').json()['token']
        t_b = self.login('admin@b.test').json()['token']
        suspend_membership(FirmMembership.objects.get(advocate_id=self.senior_a.id))
        suspend_firm(self.f['B'])
        self.assertEqual(self.cases(bearer(t_senior)), 401)
        self.assertEqual(self.cases(bearer(t_b)), 401)
        self.assertEqual(self.cases(bearer(self.login('admin@c.test').json()['token'])), 200)

    def test_role_removal_applies_to_the_next_request(self):
        token = self.login('senior@a.test').json()['token']
        self.assertEqual(self.cases(bearer(token)), 200)
        AdvocateRole.objects.filter(advocate_id=self.senior_a.id).delete()
        self.assertEqual(self.cases(bearer(token)), 403)

    # ---- document links ------------------------------------------------------------------------
    def test_query_string_token_is_refused(self):
        token = self.login('senior@a.test').json()['token']
        self.assertEqual(self.client.get(f'/api/documents/download/{self.doc_a.id}?token={token}').status_code, 401)

    def test_signed_links_are_bound_to_document_purpose_user_and_time(self):
        token = self.login('senior@a.test').json()['token']
        link = lambda purpose: self.client.post(f'/api/documents/{self.doc_a.id}/link', data=json.dumps(  # noqa: E731
            {'purpose': purpose}), content_type='application/json', **bearer(token)).json()['url']
        url = link('download')
        self.assertNotIn(token, url)
        self.assertEqual(self.client.get(url).status_code, 200)
        sig = url.split('sig=')[1]
        self.assertEqual(self.client.get(f'/api/documents/preview/{self.doc_a.id}?sig={sig}').status_code, 401)
        self.assertEqual(self.client.get(f'/api/documents/download/{self.doc_a.id + 1}?sig={sig}').status_code, 401)
        self.assertEqual(self.client.get(f'/api/documents/download/{self.doc_a.id}?sig={sig}x').status_code, 401)
        import time
        later = time.time() + settings.DOCUMENT_LINK_SECONDS + 5
        with mock.patch('time.time', return_value=later):
            self.assertEqual(self.client.get(url).status_code, 401)
        # Signing out kills unused links too.
        url2 = link('preview')
        self.client.post('/api/advocates/logout', **bearer(token))
        self.assertEqual(self.client.get(url2).status_code, 401)

    def test_another_firm_cannot_get_a_link(self):
        t_b = self.login('admin@b.test').json()['token']
        r = self.client.post(f'/api/documents/{self.doc_a.id}/link', data=json.dumps({'purpose': 'download'}),
                             content_type='application/json', **bearer(t_b))
        self.assertEqual(r.status_code, 404)

    # ---- audit ---------------------------------------------------------------------------------------
    def test_security_events_are_recorded_without_secrets(self):
        token = self.login('senior@a.test').json()['token']
        self.login('senior@a.test', 'Wrong#Guess99')
        self.client.post('/api/advocates/logout', **bearer(token))
        rows = list(AuditLog.objects.filter(module='AUTH').values('action_type', 'firm_id', 'user_name',
                                                                   'metadata', 'description', 'title'))
        kinds = {r['action_type'] for r in rows}
        self.assertTrue({'LOGIN', 'LOGIN_FAILED', 'LOGOUT'} <= kinds)
        login = next(r for r in rows if r['action_type'] == 'LOGIN')
        self.assertEqual(login['firm_id'], self.f['A'].id)
        blob = json.dumps(rows, default=str)
        for secret in (PW, 'Wrong#Guess99', token, settings.JWT_SIGNING_KEY):
            self.assertNotIn(secret, blob)


@override_settings(TENANCY_MODE='firm')
class ClientPortalTests(TestCase):
    def test_client_login_and_portal_work_with_firm_tokens(self):
        make_templates()
        firm = Firm.objects.create(name='A', slug='a', status=Firm.ACTIVE)
        fr.provision_default_roles(firm)
        senior = make_advocate(password=hash_password(PW))
        FirmMembership.objects.create(firm=firm, advocate_id=senior.id, status=FirmMembership.ACTIVE)
        client = Client.objects.create(name='Anita', deleted=False, advocate_id=senior.id)
        from clientaccess.models import ClientUser
        from core.models import Role
        login = make_advocate(email='anita@client.test', password=hash_password(PW), role='CLIENT')
        ClientUser.objects.create(advocate_id=login.id, client_id=client.id, created_by_id=senior.id)
        AdvocateRole.objects.create(advocate_id=login.id, role_id=Role.objects.get(name='Client').id)
        FirmMembership.objects.create(firm=firm, advocate_id=login.id, kind=FirmMembership.CLIENT,
                                      status=FirmMembership.ACTIVE)
        r = self.client.post('/api/advocates/login', data=json.dumps({'email': 'anita@client.test', 'password': PW}),
                             content_type='application/json')
        self.assertEqual(r.status_code, 200, r.content)
        token = r.json()['token']
        self.assertEqual(self.client.get('/api/client/me', **bearer(token)).status_code, 200)
        self.assertEqual(self.client.get('/api/cases', **bearer(token)).status_code, 403)     # staff API refused
        self.assertFalse({'CASE_VIEW', 'ROLE_MANAGE'} & set(r.json()['permissions']))
