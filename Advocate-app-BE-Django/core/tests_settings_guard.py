"""P1-5: settings fail closed, and responses carry the security headers.

Settings are evaluated at import time, so the start-up guard is checked in a
fresh interpreter with a controlled environment (no .env values leak in:
python-decouple reads os.environ before .env).
"""
import os
import subprocess
import sys
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase, TestCase

from core.jwt import decode_token, generate_token
from core.testing import make_advocate

BACKEND = Path(settings.BASE_DIR)


def _import_settings(**env):
    full = dict(os.environ, DJANGO_SETTINGS_MODULE='advocate_backend.settings', **env)
    return subprocess.run(
        [sys.executable, '-c', 'import django; django.setup(); print("started")'],
        cwd=BACKEND, env=full, capture_output=True, text=True, timeout=120)


class StartupGuardTests(SimpleTestCase):
    def test_production_mode_refuses_a_development_key(self):
        r = _import_settings(DEBUG='False', SECRET_KEY='django-insecure-advocate-dev-key-change-me')
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('SECRET_KEY is missing or is a development key', r.stderr)

    def test_production_mode_refuses_a_missing_key(self):
        r = _import_settings(DEBUG='False', SECRET_KEY='')
        self.assertNotEqual(r.returncode, 0)

    def test_production_mode_starts_with_a_real_key(self):
        r = _import_settings(DEBUG='False', SECRET_KEY='x' * 50)
        self.assertEqual(r.returncode, 0, r.stderr[-500:])
        self.assertIn('started', r.stdout)

    def test_debug_defaults_to_off(self):
        r = subprocess.run(
            [sys.executable, '-c', 'import os; os.environ.pop("DEBUG", None);'
             'from decouple import Config, RepositoryEmpty; import decouple;'
             'decouple.config = Config(RepositoryEmpty());'
             'import importlib.util, sys; sys.argv=["x"];'
             'os.environ["SECRET_KEY"]="y"*50;'
             'import django; os.environ["DJANGO_SETTINGS_MODULE"]="advocate_backend.settings";'
             'django.setup(); from django.conf import settings; print(settings.DEBUG)'],
            cwd=BACKEND, capture_output=True, text=True, timeout=120)
        self.assertEqual(r.stdout.strip().splitlines()[-1], 'False', r.stderr[-500:])


class SecurityHeaderTests(TestCase):
    def test_api_responses_cannot_be_framed_or_sniffed(self):
        r = self.client.get('/api/health')
        self.assertEqual(r['X-Frame-Options'], 'DENY')
        self.assertEqual(r['X-Content-Type-Options'], 'nosniff')


class TokenKeyTests(TestCase):
    def test_tokens_are_signed_with_the_jwt_key(self):
        adv = make_advocate()
        token = generate_token(adv)
        self.assertEqual(decode_token(token)['advocateId'], adv.id)
        with self.settings(JWT_SIGNING_KEY='a-different-key-' * 4):
            import jwt
            with self.assertRaises(jwt.PyJWTError):
                decode_token(token)
