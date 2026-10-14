"""Run by e2e/global-setup.ts with `manage.py shell` against pactpro_e2e ONLY.

Creates this run's synthetic platform operators (OWNER, READONLY, and one
disabled) with random passwords and authenticator seeds, and prints them as
one JSON line for the test run's state file (git-ignored). Refuses any
database other than pactpro_e2e.
"""
import json
import os
import secrets

from django.db import connection

from core import totp
from core.passwords import hash_password
from platform_admin.models import PlatformOperator

assert connection.settings_dict['NAME'] == 'pactpro_e2e', 'E2E seeding only runs on pactpro_e2e'

run = os.environ['E2E_RUN']
out = {}
for role, active in (('OWNER', True), ('READONLY', True), ('SUPPORT', False)):
    email = f'e2e-{role.lower()}-{run}@ops.e2e.test'
    password = secrets.token_urlsafe(18) + 'aA1!'
    seed = totp.new_secret()
    op = PlatformOperator(email=email, full_name=f'E2E {role}', role=role,
                          password_hash=hash_password(password), is_active=active)
    op.set_mfa_secret(seed)
    op.save()
    out[role] = {'email': email, 'password': password, 'seed': seed, 'active': active}
print('E2E_STATE ' + json.dumps(out))
