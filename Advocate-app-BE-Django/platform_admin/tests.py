"""Phase 5: platform operators, firm provisioning, invitations, firm lifecycle."""
import datetime
import json
import re
import threading
from unittest import mock

from django.core import mail
from django.db import connection
from django.test import TestCase, TransactionTestCase, override_settings

from core import totp
from core.models import Advocate, AdvocateRole, Case, Client, Role
from core.passwords import hash_password
from core.testing import auth, make_advocate
from firms import invitations
from firms.models import Firm, FirmInvitation, FirmMembership
from platform_admin.models import PlatformAudit, PlatformOperator
from rbac import firm_roles as fr
from rbac.tests_firm_rbac import make_templates

OP_PW = 'Operator#Pass12345'
PW = 'Member#Pass123'


def make_operator(role=PlatformOperator.OWNER, email='ops@ams.test', active=True):
    op = PlatformOperator(email=email, role=role, is_active=active, password_hash=hash_password(OP_PW))
    seed = totp.new_secret()
    op.set_mfa_secret(seed)          # stored encrypted
    op.save()
    op.seed = seed
    return op


def bearer(t):
    return {'HTTP_AUTHORIZATION': 'Bearer ' + t}


def jpost(client, url, body=None, **extra):
    return client.post(url, data=json.dumps(body or {}), content_type='application/json', **extra)


def invite_token(outbox):
    return re.search(r'token=([A-Za-z0-9_\-]+)', outbox[-1].body).group(1)


class _Base(TestCase):
    def setUp(self):
        make_templates()
        self.op = make_operator()
        self._step = 0

    def jpost(self, url, body=None, **extra):
        # Invitation emails are sent on commit; run those callbacks here.
        with self.captureOnCommitCallbacks(execute=True):
            return jpost(self.client, url, body, **extra)

    def op_login(self, op=None, password=OP_PW, otp=None, at=None):
        op = op or self.op
        # A fresh 30 s window per login so the replay guard doesn't refuse it.
        self._step += 1
        t = 1_900_000_000 + self._step * 31
        with mock.patch('core.totp.time.time', return_value=t):
            return jpost(self.client, '/api/platform/auth/login',
                         {'email': op.email, 'password': password,
                          'otp': otp if otp is not None else totp.code_at(op.seed, t)})

    def op_token(self, op=None):
        r = self.op_login(op)
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()['token']


@override_settings(TENANCY_MODE='firm')
class PlatformAuthTests(_Base):
    def test_login_requires_password_and_a_fresh_mfa_code(self):
        self.assertEqual(self.op_login().status_code, 200)
        self.assertEqual(self.op_login(password='wrong').status_code, 401)
        self.assertEqual(self.op_login(otp='000000').status_code, 401)
        no_mfa = make_operator(email='nomfa@ams.test')
        PlatformOperator.objects.filter(id=no_mfa.id).update(mfa_secret='')
        no_mfa.refresh_from_db()
        self.assertEqual(self.op_login(no_mfa, otp='123456').status_code, 401)

    def test_a_code_cannot_be_replayed(self):
        t = 1_950_000_000
        with mock.patch('core.totp.time.time', return_value=t):
            code = totp.code_at(self.op.seed, t)
            body = {'email': self.op.email, 'password': OP_PW, 'otp': code}
            self.assertEqual(self.jpost('/api/platform/auth/login', body).status_code, 200)
            self.assertEqual(self.jpost('/api/platform/auth/login', body).status_code, 401)

    def test_disabled_operator_cannot_sign_in_or_use_old_tokens(self):
        token = self.op_token()
        PlatformOperator.objects.filter(id=self.op.id).update(is_active=False)
        self.assertEqual(self.client.get('/api/platform/firms', **bearer(token)).status_code, 401)
        self.assertEqual(self.op_login().status_code, 401)

    def test_logout_and_expiry_end_the_session(self):
        token = self.op_token()
        self.assertEqual(self.jpost('/api/platform/auth/logout', **bearer(token)).status_code, 200)
        self.assertEqual(self.client.get('/api/platform/firms', **bearer(token)).status_code, 401)
        token = self.op_token()
        import time
        with mock.patch('time.time', return_value=time.time() + 61 * 60):
            with mock.patch('jwt.api_jwt.datetime') as dt:
                dt.now.return_value = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=61)
                dt.side_effect = lambda *a, **k: datetime.datetime(*a, **k)
                self.assertEqual(self.client.get('/api/platform/firms', **bearer(token)).status_code, 401)

    def test_platform_and_firm_tokens_do_not_cross(self):
        firm = Firm.objects.create(name='A', slug='aa', status=Firm.ACTIVE)
        fr.provision_default_roles(firm)
        adv = make_advocate()
        FirmMembership.objects.create(firm=firm, advocate_id=adv.id, status=FirmMembership.ACTIVE)
        AdvocateRole.objects.create(advocate_id=adv.id, role_id=fr.firm_roles(firm).get(is_admin=True).id,
                                    firm_id=firm.id)
        op_token = self.op_token()
        self.assertEqual(self.client.get('/api/cases', **bearer(op_token)).status_code, 401)
        self.assertEqual(self.client.get('/api/roles', **bearer(op_token)).status_code, 401)
        self.assertEqual(self.client.get('/api/platform/firms', **auth(adv)).status_code, 401)

    def test_readonly_operator_cannot_change_anything(self):
        ro = make_operator(PlatformOperator.READONLY, email='ro@ams.test')
        t = self.op_token(ro)
        self.assertEqual(self.client.get('/api/platform/firms', **bearer(t)).status_code, 200)
        r = self.jpost('/api/platform/firms', {'name': 'X', 'slug': 'xx-firm', 'adminEmail': 'a@x.test'},
                  **bearer(t))
        self.assertEqual(r.status_code, 403)


@override_settings(TENANCY_MODE='firm')
class ProvisioningTests(_Base):
    def create(self, slug='kumar-law', key=None, email='head@kumar.test', name='Kumar Law'):
        headers = bearer(self.token)
        if key:
            headers['HTTP_IDEMPOTENCY_KEY'] = key
        return self.jpost('/api/platform/firms', {'name': name, 'slug': slug, 'adminEmail': email,
                                                          'adminName': 'R Kumar'}, **headers)

    def setUp(self):
        super().setUp()
        self.token = self.op_token()

    def test_create_firm_provisions_roles_admin_and_invitation(self):
        r = self.create()
        self.assertEqual(r.status_code, 201, r.content)
        firm = Firm.objects.get(slug='kumar-law')
        self.assertEqual(firm.status, Firm.PROVISIONING)                   # not active yet
        names = set(fr.firm_roles(firm).values_list('name', flat=True))
        self.assertTrue({'Super Admin', 'Senior Advocate', 'Advocate', 'Receptionist'} <= names)
        inv = FirmInvitation.objects.get(firm=firm)
        self.assertEqual(inv.kind, FirmInvitation.FIRM_ADMIN)
        self.assertEqual(inv.role_ids, [fr.firm_roles(firm).get(is_admin=True).id])
        m = FirmMembership.objects.get(firm=firm)
        self.assertEqual(m.status, FirmMembership.INVITED)
        self.assertEqual(len(mail.outbox), 1)
        token = invite_token(mail.outbox)
        self.assertNotIn(token, json.dumps(r.json()))                     # never returned by the API
        self.assertNotEqual(inv.token_hash, token)
        self.assertTrue(PlatformAudit.objects.filter(action='FIRM_CREATE', firm_id=firm.id).exists())

    def test_duplicate_slug_and_bad_input_are_refused(self):
        self.assertEqual(self.create().status_code, 201)
        self.assertEqual(self.create(email='other@x.test').status_code, 409)
        self.assertEqual(self.create(slug='Bad Slug!').status_code, 400)

    def test_idempotency(self):
        a = self.create(key='k-1')
        b = self.create(key='k-1')
        self.assertEqual((a.status_code, b.status_code), (201, 200))
        self.assertEqual(a.json()['firm']['publicId'], b.json()['firm']['publicId'])
        self.assertEqual(Firm.objects.count(), 1)
        self.assertEqual(FirmInvitation.objects.count(), 1)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(self.create(key='k-1', name='Something Else').status_code, 409)

    def test_failure_rolls_everything_back(self):
        with mock.patch('firms.invitations.FirmInvitation.objects.create', side_effect=RuntimeError('boom')):
            with self.assertRaises(RuntimeError):
                self.create()
        self.assertFalse(Firm.objects.filter(slug='kumar-law').exists())
        self.assertFalse(Role.objects.filter(firm_id__isnull=False).exists())
        self.assertEqual(len(mail.outbox), 0)

    def test_firm_cannot_be_activated_before_its_admin_accepts(self):
        pid = self.create().json()['firm']['publicId']
        r = self.jpost(f'/api/platform/firms/{pid}/activate', **bearer(self.token))
        self.assertEqual((r.status_code, r.json()['code']), (409, 'NO_ADMIN'))


@override_settings(TENANCY_MODE='firm')
class InvitationAndLifecycleTests(_Base):
    def setUp(self):
        super().setUp()
        self.token = self.op_token()
        self.firms = {}
        # A firm needs an approved, published plan to add people (without one it
        # is PENDING); the seeded example plan stands in for one here.
        from subscriptions import catalogue as C
        from subscriptions.models import Plan
        C.ensure_plans()
        Plan.objects.filter(code='PROFESSIONAL').update(state=Plan.PUBLISHED)
        for key in 'ABC':
            r = self.jpost('/api/platform/firms', {'name': f'Firm {key}', 'slug': f'firm-{key.lower()}',
                                                   'adminEmail': f'admin@{key.lower()}.test', 'planCode': 'PROFESSIONAL'},
                      **bearer(self.token))
            self.firms[key] = Firm.objects.get(public_id=r.json()['firm']['publicId'])
        self.tokens = {k: re.findall(r'token=([A-Za-z0-9_\-]+)', m.body)[0]
                       for k, m in zip('ABC', mail.outbox)}

    def accept(self, token, password=PW, name='Admin'):
        return self.jpost('/api/invitations/accept', {'token': token, 'password': password, 'fullName': name})

    def admin(self, key):
        r = self.accept(self.tokens[key])
        self.assertEqual(r.status_code, 200, r.content)
        self.assertNotIn('token', r.json())                  # accepting never signs in
        email = f'admin@{key.lower()}.test'
        login = self.jpost('/api/advocates/login', {'email': email, 'password': PW})
        self.assertEqual(login.status_code, 200, login.content)
        return Advocate.objects.get(email=email), login.json()['token']

    def test_accepting_activates_the_firm_then_the_admin_signs_in(self):
        preview = self.client.get(f'/api/invitations/preview?token={self.tokens["A"]}').json()
        self.assertEqual((preview['firm'], preview['newAccount']), ('Firm A', True))
        adv, token = self.admin('A')
        self.firms['A'].refresh_from_db()
        self.assertEqual(self.firms['A'].status, Firm.ACTIVE)
        self.assertTrue(fr.is_firm_admin(adv, self.firms['A']))
        self.assertEqual(self.client.get('/api/roles', **bearer(token)).status_code, 200)

    def test_replayed_expired_and_revoked_invitations_are_refused(self):
        self.admin('A')
        self.assertEqual(self.accept(self.tokens['A']).status_code, 400)                  # replay
        self.assertEqual(self.client.get(f'/api/invitations/preview?token={self.tokens["A"]}').json()['code'],
                         'ACCEPTED')
        self.assertEqual(self.client.get('/api/invitations/preview?token=nope').json()['code'], 'INVALID')
        FirmInvitation.objects.filter(firm=self.firms['B']).update(
            expires_at=datetime.datetime.now() - datetime.timedelta(minutes=1))
        self.assertEqual(self.accept(self.tokens['B']).status_code, 400)                  # expired
        self.assertEqual(self.accept(self.tokens['B']).json()['code'], 'EXPIRED')
        inv = FirmInvitation.objects.get(firm=self.firms['C'])
        r = self.jpost(f'/api/platform/firms/{self.firms["C"].public_id}/invitations/{inv.id}/revoke',
                  **bearer(self.token))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.accept(self.tokens['C']).status_code, 400)                  # revoked
        self.assertEqual(self.accept(self.tokens['C']).json()['code'], 'REVOKED')
        r = self.jpost(f'/api/platform/firms/{self.firms["B"].public_id}/invitations/'
                               f'{FirmInvitation.objects.get(firm=self.firms["B"]).id}/resend', **bearer(self.token))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.accept(invite_token(mail.outbox)).status_code, 200)         # resent link works

    def test_existing_identity_must_prove_its_password(self):
        existing = make_advocate(email='taken@x.test', password=hash_password('Old#Pass1234'))
        r = self.jpost('/api/platform/firms', {'name': 'Firm D', 'slug': 'firm-d', 'adminEmail': 'taken@x.test'},
                  **bearer(self.token))
        token = invite_token(mail.outbox)
        self.assertFalse(self.client.get(f'/api/invitations/preview?token={token}').json()['newAccount'])
        self.assertEqual(self.accept(token, password='Attacker#Pass1').json()['code'], 'WRONG_PASSWORD')
        existing.refresh_from_db()
        from core.passwords import verify_password
        self.assertTrue(verify_password('Old#Pass1234', existing.password))           # not taken over
        self.assertEqual(self.accept(token, password='Old#Pass1234').status_code, 200)
        del r

    def test_one_active_membership_per_identity(self):
        adv, _ = self.admin('A')
        r = self.jpost('/api/platform/firms', {'name': 'Firm E', 'slug': 'firm-e', 'adminEmail': adv.email},
                  **bearer(self.token))
        self.assertEqual(r.status_code, 201)
        r = self.accept(invite_token(mail.outbox), password='Not#ThePassword1')
        self.assertEqual(r.json()['code'], 'WRONG_PASSWORD')    # existing identity...
        r = self.accept(invite_token(mail.outbox), password=PW)
        self.assertEqual(r.json()['code'], 'OTHER_FIRM')         # ...and already active in Firm A

    def test_staff_invitations_use_the_firms_own_roles_only(self):
        admin_a, t_a = self.admin('A')
        admin_b, t_b = self.admin('B')
        junior_a = fr.firm_roles(self.firms['A']).get(name='Advocate')
        junior_b = fr.firm_roles(self.firms['B']).get(name='Advocate')
        r = self.jpost('/api/firm/invitations', {'email': 'new@a.test', 'roleIds': [junior_b.id]},
                  **bearer(t_a))
        self.assertEqual(r.status_code, 400)                                  # B's role
        r = self.jpost('/api/firm/invitations', {'email': 'new@a.test', 'roleIds': [junior_a.id]},
                  **bearer(t_a))
        self.assertEqual(r.status_code, 201, r.content)
        r = self.accept(invite_token(mail.outbox), name='New Junior')
        self.assertEqual(r.status_code, 200)
        new = Advocate.objects.get(email='new@a.test')
        self.assertEqual(new.permission_codes(), fr.role_permission_names(junior_a.id))
        # B's admin sees none of A's invitations and can't act on them.
        inv_a = FirmInvitation.objects.get(email='new@a.test')
        seen_by_b = {i['id'] for i in self.client.get('/api/firm/invitations', **bearer(t_b)).json()}
        self.assertNotIn(inv_a.id, seen_by_b)
        self.assertFalse(FirmInvitation.objects.filter(id__in=seen_by_b).exclude(firm=self.firms['B']).exists())
        self.assertEqual(self.jpost(f'/api/firm/invitations/{inv_a.id}/revoke', **bearer(t_b)).status_code, 404)

    def test_non_admin_cannot_invite_an_administrator(self):
        _admin, t_a = self.admin('A')
        mgr_role = self.jpost('/api/roles', {'name': 'People', 'permissionIds': [
            Role.objects.none() or __import__('core.models', fromlist=['Permission']).Permission.objects.get(
                name='USER_MANAGE').id]}, **bearer(t_a)).json()
        self.jpost('/api/firm/invitations', {'email': 'mgr@a.test', 'roleIds': [mgr_role['id']]}, **bearer(t_a))
        _r = self.accept(invite_token(mail.outbox))
        mgr_token = self.client.post('/api/advocates/login', data=json.dumps({'email': 'mgr@a.test', 'password': PW}),
                                     content_type='application/json').json()['token']
        admin_role = fr.firm_roles(self.firms['A']).get(is_admin=True)
        r = self.jpost('/api/firm/invitations', {'email': 'evil@a.test', 'roleIds': [admin_role.id]},
                  **bearer(mgr_token))
        self.assertEqual(r.status_code, 403)

    def test_member_lifecycle_and_last_admin(self):
        admin_a, t_a = self.admin('A')
        r = self.jpost(f'/api/firm/members/{admin_a.id}/suspend', **bearer(t_a))
        self.assertEqual(r.status_code, 400)                                    # yourself
        junior = fr.firm_roles(self.firms['A']).get(name='Advocate')
        self.jpost('/api/firm/invitations', {'email': 'j@a.test', 'roleIds': [junior.id]}, **bearer(t_a))
        self.accept(invite_token(mail.outbox))
        j = Advocate.objects.get(email='j@a.test')
        j_token = self.jpost('/api/advocates/login', {'email': 'j@a.test', 'password': PW}).json()['token']
        self.assertEqual(self.jpost(f'/api/firm/members/{j.id}/suspend', **bearer(t_a)).status_code, 200)
        self.assertEqual(self.client.get('/api/cases', **bearer(j_token)).status_code, 401)
        self.assertEqual(self.jpost(f'/api/firm/members/{j.id}/reactivate', **bearer(t_a)).status_code, 200)
        self.assertEqual(self.client.get('/api/cases', **bearer(j_token)).status_code, 401)   # revoked stays dead
        j_new = self.jpost('/api/advocates/login', {'email': 'j@a.test', 'password': PW}).json()['token']
        self.assertEqual(self.client.get('/api/cases', **bearer(j_new)).status_code, 200)

    def test_firm_suspension_and_reactivation(self):
        admin_a, t_a = self.admin('A')
        client = Client.objects.create(name='Keep me', deleted=False, advocate_id=admin_a.id)
        Case.objects.create(case_number='A/9', case_title='A', status='Active', deleted=False,
                            advocate_id=admin_a.id, client=client)
        pid = self.firms['A'].public_id
        r = self.jpost(f'/api/platform/firms/{pid}/suspend', {'reason': 'non-payment'}, **bearer(self.token))
        self.assertEqual(r.json()['status'], 'SUSPENDED')
        self.assertEqual(self.client.get('/api/cases', **bearer(t_a)).status_code, 401)
        login = self.jpost('/api/advocates/login', {'email': admin_a.email, 'password': PW})
        self.assertEqual(login.json()['code'], 'FIRM_SUSPENDED')
        r = self.jpost(f'/api/platform/firms/{pid}/reactivate', **bearer(self.token))
        self.assertEqual(r.json()['status'], 'ACTIVE')
        self.assertEqual(self.client.get('/api/cases', **bearer(t_a)).status_code, 401)      # old session stays dead
        fresh = self.jpost('/api/advocates/login', {'email': admin_a.email, 'password': PW}).json()['token']
        self.assertEqual(self.client.get('/api/cases', **bearer(fresh)).status_code, 200)
        self.assertTrue(Case.objects.filter(case_number='A/9').exists())                     # data intact
        self.assertTrue(Client.objects.filter(id=client.id).exists())

    def test_operators_see_metadata_never_contents(self):
        admin_a, _t = self.admin('A')
        Client.objects.create(name='Secret Client Name', deleted=False, advocate_id=admin_a.id)
        pid = self.firms['A'].public_id
        usage = self.client.get(f'/api/platform/firms/{pid}/usage', **bearer(self.token)).json()
        self.assertEqual(usage['clients'], 1)
        blob = json.dumps([self.client.get(u, **bearer(self.token)).json() for u in (
            '/api/platform/firms', f'/api/platform/firms/{pid}', f'/api/platform/firms/{pid}/usage',
            f'/api/platform/firms/{pid}/invitations', '/api/platform/audit')], default=str)
        self.assertNotIn('Secret Client Name', blob)

    def test_platform_audit_has_no_secrets(self):
        self.admin('A')
        self.op_login(password='Wrong#Guess999')
        blob = json.dumps(list(PlatformAudit.objects.values()), default=str)
        for secret in (OP_PW, 'Wrong#Guess999', self.token, *self.tokens.values(), self.op.seed):
            self.assertNotIn(secret, blob)
        self.assertTrue(PlatformAudit.objects.filter(action='LOGIN_FAILED', success=False).exists())


@override_settings(TENANCY_MODE='firm')
class ConcurrentAcceptanceTests(TransactionTestCase):
    def test_two_simultaneous_acceptances_create_one_membership(self):
        make_templates()
        firm = Firm.objects.create(name='Race', slug='race', status=Firm.PROVISIONING)
        fr.provision_default_roles(firm)
        inv, token = invitations.create_invitation(
            firm, 'race@x.test', FirmInvitation.FIRM_ADMIN, [fr.firm_roles(firm).get(is_admin=True).id],
            invited_by_type=FirmInvitation.PLATFORM, invited_by_id=None)
        results, barrier = [], threading.Barrier(2)

        def go():
            try:
                barrier.wait()
                invitations.accept(token, PW)
                results.append('ok')
            except invitations.InvitationError as exc:
                results.append(exc.code)
            finally:
                connection.close()
        threads = [threading.Thread(target=go) for _ in range(2)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(sorted(results), ['ACCEPTED', 'ok'])
        self.assertEqual(FirmMembership.objects.filter(firm=firm, status=FirmMembership.ACTIVE).count(), 1)
        self.assertEqual(AdvocateRole.objects.filter(firm_id=firm.id).count(), 1)


class OperatorCommandTests(TestCase):
    def test_bootstrap_requires_a_strong_password_and_shows_mfa_once(self):
        import os
        from io import StringIO
        from django.core.management import call_command
        from django.core.management.base import CommandError
        with mock.patch.dict(os.environ, {'OP_PW': 'short'}):
            with self.assertRaises(CommandError):
                call_command('platform_operator', 'create', email='a@ams.test', password_env='OP_PW', stdout=StringIO())
        out = StringIO()
        with mock.patch.dict(os.environ, {'OP_PW': OP_PW}):
            call_command('platform_operator', 'create', email='a@ams.test', role='OWNER',
                         password_env='OP_PW', stdout=out)
        op = PlatformOperator.objects.get(email='a@ams.test')
        self.assertIn(op.get_mfa_secret(), out.getvalue())
        self.assertNotIn(op.get_mfa_secret(), op.mfa_secret)            # stored encrypted
        self.assertNotIn(OP_PW, out.getvalue())
        call_command('platform_operator', 'disable', email='a@ams.test', stdout=StringIO())
        op.refresh_from_db()
        self.assertFalse(op.is_active)
        self.assertEqual(op.token_version, 1)


class CorsPreflightTests(TestCase):
    def test_browser_may_send_the_idempotency_key(self):
        r = self.client.options('/api/platform/firms', HTTP_ORIGIN='http://localhost:5173',
                                HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',
                                HTTP_ACCESS_CONTROL_REQUEST_HEADERS='authorization,content-type,idempotency-key')
        self.assertIn('idempotency-key', r.headers.get('Access-Control-Allow-Headers', ''))


class InvitationPreviewByPostTests(TestCase):
    def test_preview_accepts_the_token_in_the_body(self):
        r = self.client.post('/api/invitations/preview', {'token': 'nope'}, content_type='application/json')
        self.assertEqual((r.status_code, r.json()['code']), (400, 'INVALID'))
