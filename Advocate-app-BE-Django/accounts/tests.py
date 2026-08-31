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
