"""Tests for account creation.

/api/advocates/signup was AllowAny with no authentication, so anyone could
create a working account. It received no roles, so cases and clients stayed
closed - but 66 endpoints are gated on "any signed-in advocate", and those
include the Acts corpus and the court-search proxy, which drives the scraper
against eCourts under this server's IP. It also accepted a `role` from the
request body and stored it verbatim.
"""

from __future__ import annotations

import json

from django.test import TestCase, override_settings

from core.models import Advocate

PAYLOAD = {
    'fullName': 'Walk In', 'email': 'walkin@test.local',
    'password': 'notarealpassword', 'barCouncilId': 'WALK-1',
    'role': 'Super Admin',
}


def post_signup(client, payload=None):
    return client.post('/api/advocates/signup',
                       data=json.dumps(payload or PAYLOAD),
                       content_type='application/json')


class SignupClosedTest(TestCase):
    def test_signup_is_refused_by_default(self):
        res = post_signup(self.client)
        self.assertEqual(res.status_code, 403)
        self.assertFalse(Advocate.objects.filter(email=PAYLOAD['email']).exists(),
                         'no account may be created while signup is closed')

    def test_the_refusal_says_what_to_do(self):
        res = post_signup(self.client)
        self.assertIn('administrator', res.json()['error'].lower())


@override_settings(ALLOW_PUBLIC_SIGNUP=True)
class SignupEnabledTest(TestCase):
    """Even when open, a caller may not choose their own role."""

    def test_signup_works_when_enabled(self):
        self.assertEqual(post_signup(self.client).status_code, 201)

    def test_role_from_the_request_body_is_ignored(self):
        post_signup(self.client)
        advocate = Advocate.objects.get(email=PAYLOAD['email'])
        self.assertEqual(advocate.role, 'ADVOCATE',
                         'a client asking for Super Admin must not receive it')

    def test_a_new_account_gets_no_permissions(self):
        post_signup(self.client)
        advocate = Advocate.objects.get(email=PAYLOAD['email'])
        self.assertEqual(advocate.permission_codes(), set())
        self.assertEqual(advocate.role_names(), [])

    def test_a_new_account_is_its_own_practice(self):
        post_signup(self.client)
        advocate = Advocate.objects.get(email=PAYLOAD['email'])
        self.assertIsNone(advocate.parent_advocate_id,
                          'a stranger must not land inside an existing practice')

    def test_a_duplicate_email_is_refused(self):
        self.assertEqual(post_signup(self.client).status_code, 201)
        self.assertEqual(post_signup(self.client).status_code, 409)


class PasswordResetFlowTest(TestCase):
    """Forgot password: an unregistered email is told so; a registered one gets a
    code, and resetting with it changes the password used to sign in."""

    def setUp(self):
        from core.passwords import hash_password
        self.adv = Advocate.objects.create(email='priya@firm.test', password=hash_password('Old@12345'),
                                           full_name='Priya', role='ADVOCATE')

    def _post(self, url, body):
        return self.client.post(url, data=json.dumps(body), content_type='application/json')

    def test_an_unregistered_email_is_told_to_contact_the_admin(self):
        from core.models import PasswordResetOtp
        resp = self._post('/api/auth/forgot-password', {'email': 'nobody@nowhere.test'})
        self.assertEqual(resp.status_code, 404)
        self.assertIn('not registered', resp.json()['error'])
        self.assertFalse(PasswordResetOtp.objects.exists())       # nothing created, nothing sent

    def test_reset_changes_the_sign_in_password(self):
        from unittest import mock
        from accounts import otp_views
        with mock.patch.object(otp_views.secrets, 'randbelow', return_value=123456 - 100000):
            resp = self._post('/api/auth/forgot-password', {'email': '  Priya@FIRM.test '})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self._post('/api/auth/verify-otp', {'email': 'priya@firm.test', 'otp': '123456'}).status_code, 200)
        resp = self._post('/api/auth/reset-password',
                          {'email': 'priya@firm.test', 'otp': '123456', 'newPassword': 'New@12345'})
        self.assertTrue(resp.json()['success'])
        login = lambda pw: self._post('/api/advocates/login', {'email': 'priya@firm.test', 'password': pw})  # noqa: E731
        self.assertEqual(login('New@12345').status_code, 200)
        self.assertNotEqual(login('Old@12345').status_code, 200)
        # A used code can't reset again.
        again = self._post('/api/auth/reset-password',
                           {'email': 'priya@firm.test', 'otp': '123456', 'newPassword': 'Other@12345'})
        self.assertEqual(again.status_code, 400)
