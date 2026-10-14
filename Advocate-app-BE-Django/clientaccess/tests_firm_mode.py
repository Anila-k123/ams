"""Client portal logins in firm mode (found by the Phase 9 browser run): a new
login must be able to sign in, and a disabled one must not."""
import re


from django.test import TestCase, override_settings

from core.testing import auth, make_case, make_client, make_firm, make_firm_member
from firms.models import FirmMembership


@override_settings(TENANCY_MODE='firm')
class ClientLoginFirmModeTests(TestCase):
    def setUp(self):
        self.firm = make_firm('A')
        self.admin = make_firm_member(self.firm)
        self.client_row = make_client(self.admin, name='Meena', email='meena@client.test')
        make_case(self.admin, client=self.client_row)

    def _invite(self):
        r = self.client.post(f'/api/clients/{self.client_row.id}/logins', {'email': 'meena@client.test'},
                             content_type='application/json', **auth(self.admin))
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def _set_password_and_login(self, invite):
        token = re.search(r'token=([A-Za-z0-9_\-]+)', invite['inviteUrl']).group(1)
        self.assertEqual(self.client.post('/api/client-auth/set-password', {'token': token, 'password': 'Meena#Portal2026'},
                                          content_type='application/json').status_code, 200)
        return self.client.post('/api/advocates/login', {'email': 'meena@client.test', 'password': 'Meena#Portal2026'},
                                content_type='application/json')

    def test_a_new_client_login_can_sign_in_and_sees_its_cases(self):
        r = self._set_password_and_login(self._invite())
        self.assertEqual(r.status_code, 200, r.content)
        m = FirmMembership.objects.get(firm=self.firm, advocate_id=r.json().get('advocateId') or
                                       FirmMembership.objects.filter(kind='CLIENT').first().advocate_id)
        self.assertEqual((m.kind, m.status), ('CLIENT', 'ACTIVE'))
        cases = self.client.get('/api/client/cases', HTTP_AUTHORIZATION='Bearer ' + r.json()['token'])
        self.assertEqual(cases.status_code, 200)

    def test_a_disabled_login_is_signed_out_and_cannot_sign_in(self):
        invite = self._invite()
        token = self._set_password_and_login(invite).json()['token']
        r = self.client.patch(f"/api/clients/{self.client_row.id}/logins/{invite['id']}", {'isActive': False},
                              content_type='application/json', **auth(self.admin))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.client.get('/api/client/cases', HTTP_AUTHORIZATION='Bearer ' + token).status_code, 401)
        again = self.client.post('/api/advocates/login', {'email': 'meena@client.test', 'password': 'Meena#Portal2026'},
                                 content_type='application/json')
        self.assertNotEqual(again.status_code, 200)

