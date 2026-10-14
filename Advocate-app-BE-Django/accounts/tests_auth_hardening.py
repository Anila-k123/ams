"""P1-6 / P1-7: sign-in and password-reset codes can't be brute-forced,
reset codes never reach the logs, and every password meets one rule."""
import datetime
import json
import logging
import re
from unittest import mock

from django.core import mail
from django.test import TestCase, override_settings

from accounts.models import AuthAttempt
from core.models import Advocate, PasswordResetOtp
from core.passwords import hash_password, verify_password
from core.testing import auth, make_advocate
from core.validators import password_error

GOOD = 'Correct#Horse9'


def _post(client, url, body):
    return client.post(url, data=json.dumps(body), content_type='application/json')


@override_settings(LOGIN_LOCKOUT_ENABLED=True, LOGIN_MAX_FAILURES=5,
                   LOGIN_MAX_FAILURES_PER_IP=20, LOGIN_LOCKOUT_MINUTES=15)
class LoginLockoutTests(TestCase):
    def setUp(self):
        self.adv = make_advocate(email='priya@firm.test', password=hash_password(GOOD))

    def login(self, password, email='priya@firm.test'):
        return _post(self.client, '/api/advocates/login', {'email': email, 'password': password})

    def test_sixth_attempt_is_locked_even_with_the_right_password(self):
        for _ in range(5):
            self.assertEqual(self.login('wrong').status_code, 401)
        r = self.login(GOOD)
        self.assertEqual(r.status_code, 429)
        self.assertIn('Try again in', r.json()['error'])
        self.assertTrue(int(r['Retry-After']) > 0)
        self.assertNotIn('token', r.json())

    def test_lock_ends_after_the_window(self):
        for _ in range(5):
            self.login('wrong')
        AuthAttempt.objects.update(at=datetime.datetime.now() - datetime.timedelta(minutes=16))
        self.assertEqual(self.login(GOOD).status_code, 200)

    def test_success_clears_the_count(self):
        for _ in range(4):
            self.login('wrong')
        self.assertEqual(self.login(GOOD).status_code, 200)
        for _ in range(4):
            self.assertEqual(self.login('wrong').status_code, 401)
        self.assertEqual(self.login(GOOD).status_code, 200)

    def test_one_address_cannot_spray_many_accounts(self):
        for i in range(20):
            self.login('wrong', email=f'nobody{i}@firm.test')
        self.assertEqual(self.login(GOOD).status_code, 429)

    def test_email_case_does_not_matter(self):
        self.assertEqual(self.login(GOOD, email='Priya@Firm.TEST').status_code, 200)

    @override_settings(LOGIN_LOCKOUT_ENABLED=False)
    def test_lockout_can_be_switched_off(self):
        for _ in range(6):
            self.login('wrong')
        self.assertEqual(self.login(GOOD).status_code, 200)


@override_settings(OTP_MAX_FAILURES=5, OTP_RATE_LIMIT=10, OTP_EXPIRY_MINUTES=10,
                   MAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
                   EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class ResetCodeTests(TestCase):
    def setUp(self):
        self.adv = make_advocate(email='ravi@firm.test', password=hash_password('Old#Pass123'))

    def request_code(self):
        with self.assertLogs('accounts', level='DEBUG') as logs:
            r = _post(self.client, '/api/auth/forgot-password', {'email': 'ravi@firm.test'})
        self.assertEqual(r.status_code, 200, r.content)
        code = re.search(r'\b(\d{6})\b', mail.outbox[-1].body).group(1)
        return code, '\n'.join(logs.output)

    def reset(self, code, password=GOOD):
        return _post(self.client, '/api/auth/reset-password',
                     {'email': 'ravi@firm.test', 'otp': code, 'newPassword': password})

    def test_code_is_never_written_to_the_log(self):
        code, logged = self.request_code()
        self.assertNotIn(code, logged)

    def test_correct_code_refused_after_five_wrong_ones(self):
        code, _ = self.request_code()
        wrong = '000000' if code != '000000' else '111111'
        statuses = [_post(self.client, '/api/auth/verify-otp',
                          {'email': 'ravi@firm.test', 'otp': wrong}).status_code for _ in range(5)]
        self.assertEqual(statuses[-1], 429)
        self.assertEqual(self.reset(code).status_code, 429)
        self.adv.refresh_from_db()
        self.assertTrue(verify_password('Old#Pass123', self.adv.password))
        self.assertFalse(PasswordResetOtp.objects.filter(email='ravi@firm.test', used=False).exists())

    def test_reset_spends_every_live_code(self):
        first, _ = self.request_code()
        second, _ = self.request_code()
        self.assertEqual(self.reset(second).status_code, 200)
        self.assertEqual(self.reset(first, 'Another#Pass9').status_code, 400)

    def test_weak_new_password_refused(self):
        code, _ = self.request_code()
        r = self.reset(code, 'short')
        self.assertEqual(r.status_code, 400)
        self.assertIn('at least 8', r.json()['error'])
        self.adv.refresh_from_db()
        self.assertTrue(verify_password('Old#Pass123', self.adv.password))


class PasswordRuleTests(TestCase):
    def test_rule(self):
        self.assertIsNotNone(password_error('1234567'))
        self.assertIsNotNone(password_error('        '))
        self.assertIsNotNone(password_error('a' * 129))
        self.assertIsNotNone(password_error('Me@Firm.test', 'me@firm.test'))
        self.assertIsNone(password_error('eight ch'))

    def test_change_password_uses_the_rule(self):
        adv = make_advocate(password=hash_password('Old#Pass123'))
        r = self.client.put('/api/profile/change-password', data=json.dumps({
            'currentPassword': 'Old#Pass123', 'newPassword': 'short', 'confirmNewPassword': 'short'}),
            content_type='application/json', **auth(adv))
        self.assertEqual(r.status_code, 400)


class MissingTableTests(TestCase):
    """Before migration accounts.0001 is applied, sign-in must still work."""

    def test_login_works_when_the_attempt_table_is_missing(self):
        from django.db import ProgrammingError
        adv = make_advocate(email='nomig@firm.test', password=hash_password(GOOD))
        with mock.patch('accounts.models.AuthAttempt.objects') as objs:
            objs.filter.side_effect = ProgrammingError('relation "auth_attempt" does not exist')
            objs.create.side_effect = ProgrammingError('relation "auth_attempt" does not exist')
            with self.assertLogs('accounts.throttle', level='ERROR'):
                r = _post(self.client, '/api/advocates/login', {'email': adv.email, 'password': GOOD})
        self.assertEqual(r.status_code, 200)
