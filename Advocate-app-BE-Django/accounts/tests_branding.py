"""P1-11: signatures and seals are not public files.

serve_branding_file is AllowAny so <img> tags and emails can load a logo. A
signature or seal used to be just as public to anyone who knew (or guessed)
the file name. Now they need the short-lived ?sig= the profile serializer adds.
"""
import os
import shutil
import tempfile
from unittest import mock

from django.test import TestCase, override_settings

from accounts.branding import LINK_SECONDS, signed_query
from core.testing import auth, make_advocate


class PrivateBrandingTests(TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.dir, 'branding'))
        for name in ('logo1.png', 'sign1.png', 'seal1.png'):
            with open(os.path.join(self.dir, 'branding', name), 'wb') as fh:
                fh.write(b'\x89PNG' + name.encode())
        self.settings = override_settings(DOCUMENT_UPLOAD_DIR=self.dir)
        self.settings.enable()
        self.owner = make_advocate(office_logo_path='branding/logo1.png',
                                   signature_path='branding/sign1.png',
                                   office_seal_path='branding/seal1.png')

    def tearDown(self):
        self.settings.disable()
        shutil.rmtree(self.dir, ignore_errors=True)

    def get(self, name, query=''):
        return self.client.get(f'/api/profile/files/branding/{name}{query}')

    def test_logo_stays_public(self):
        self.assertEqual(self.get('logo1.png').status_code, 200)

    def test_signature_and_seal_need_a_signed_link(self):
        self.assertEqual(self.get('sign1.png').status_code, 404)
        self.assertEqual(self.get('seal1.png').status_code, 404)
        self.assertEqual(self.get('sign1.png', '?sig=forged').status_code, 404)
        self.assertEqual(self.get('sign1.png', '?' + signed_query('sign1.png')).status_code, 200)

    def test_signature_for_one_file_does_not_open_another(self):
        self.assertEqual(self.get('seal1.png', '?' + signed_query('sign1.png')).status_code, 404)

    def test_signed_link_expires(self):
        query = '?' + signed_query('sign1.png')
        import time
        later = time.time() + LINK_SECONDS + 5
        with mock.patch('time.time', return_value=later):
            self.assertEqual(self.get('sign1.png', query).status_code, 404)

    def test_profile_hands_out_working_links(self):
        body = self.client.get('/api/profile', **auth(self.owner)).json()
        self.assertIn('sig=', body['signatureUrl'])
        self.assertNotIn('sig=', body['officeLogoUrl'])
        path = body['signatureUrl'].split('testserver', 1)[-1]
        self.assertEqual(self.client.get(path).status_code, 200)
