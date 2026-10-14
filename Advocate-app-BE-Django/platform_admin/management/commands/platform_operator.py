"""Manage AMS platform operators from the server console (there is no default
operator and no built-in password).

    manage.py platform_operator create --email ops@company.com --role OWNER [--name "..."]
    manage.py platform_operator set-password --email ...
    manage.py platform_operator reset-mfa --email ...
    manage.py platform_operator disable --email ...   |  enable --email ...
    manage.py platform_operator list

The password is asked for interactively, or read from the environment variable
named by --password-env (never a command-line value: it would end up in shell
history). It must be at least 14 characters. `create` and `reset-mfa` print the
authenticator secret and otpauth:// URI ONCE - add it to an authenticator app.
Every change except `enable` ends the operator's existing sessions.
"""
import getpass
import os

from django.core.management.base import BaseCommand, CommandError
from django.db.models import F

from core import totp
from core.crypto import CryptoUnavailable
from core.passwords import hash_password
from platform_admin.models import PlatformAudit, PlatformOperator

MIN_LENGTH = 14


def _password(opts):
    if opts.get('password_env'):
        value = os.environ.get(opts['password_env'], '')
    else:
        value = getpass.getpass('Password: ')
        if value != getpass.getpass('Repeat password: '):
            raise CommandError('The passwords do not match.')
    if len(value) < MIN_LENGTH or value.strip() != value or value.isalpha() or value.isdigit():
        raise CommandError(f'Use at least {MIN_LENGTH} characters, mixing letters with digits or symbols.')
    return value


class Command(BaseCommand):
    help = 'Create and manage AMS platform operators (console only).'

    def add_arguments(self, parser):
        parser.add_argument('action', choices=['create', 'set-password', 'reset-mfa', 'disable', 'enable', 'list', 'verify-key'])
        parser.add_argument('--email')
        parser.add_argument('--name', default='')
        parser.add_argument('--role', choices=[r for r, _ in PlatformOperator.ROLES], default=PlatformOperator.READONLY)
        parser.add_argument('--password-env', help='Name of an environment variable holding the password.')

    def _audit(self, op, action):
        PlatformAudit.objects.create(operator_id=op.id, operator_email=op.email, action=action,
                                     detail={'via': 'console'})

    def _show_mfa(self, op, seed):
        # Shown once on this console; stored only encrypted (core/crypto.py).
        self.stdout.write('Add this to an authenticator app now (it is shown only once):')
        self.stdout.write(f'  secret: {seed}')
        self.stdout.write(f'  uri:    {totp.provisioning_uri(seed, op.email)}')

    def handle(self, *args, **opts):
        action = opts['action']
        if action == 'list':
            for op in PlatformOperator.objects.order_by('id'):
                self.stdout.write(f'{op.id}  {op.email}  {op.role}  active={op.is_active}  mfa={bool(op.mfa_secret)}')
            return
        if action == 'verify-key':
            # After a restore or a server move: can PLATFORM_MFA_KEY still read
            # every operator's authenticator seed? Prints nothing secret.
            bad = 0
            for op in PlatformOperator.objects.exclude(mfa_secret='').order_by('id'):
                try:
                    op.get_mfa_secret()
                except Exception as exc:                       # noqa: BLE001
                    bad += 1
                    self.stdout.write(f'{op.email}: cannot decrypt ({type(exc).__name__})')
            if bad:
                raise CommandError(f'{bad} operator seed(s) unreadable: wrong or missing PLATFORM_MFA_KEY '
                                   '(restore the key from its backup, or reset-mfa those operators).')
            self.stdout.write('PLATFORM_MFA_KEY reads every operator seed.')
            return
        email = (opts.get('email') or '').strip().lower()
        if not email:
            raise CommandError('--email is required.')
        op = PlatformOperator.objects.filter(email__iexact=email).first()
        if action == 'create':
            if op is not None:
                raise CommandError('An operator with that email already exists.')
            seed = totp.new_secret()
            op = PlatformOperator(email=email, full_name=opts['name'], role=opts['role'],
                                  password_hash=hash_password(_password(opts)))
            try:
                op.set_mfa_secret(seed)
            except CryptoUnavailable as exc:
                raise CommandError(f'{exc} Set PLATFORM_MFA_KEY first.')
            op.save()
            self._audit(op, 'OPERATOR_CREATED')
            self.stdout.write(self.style.SUCCESS(f'Operator {email} created ({op.role}).'))
            self._show_mfa(op, seed)
            return
        if op is None:
            raise CommandError('No operator with that email.')
        if action == 'set-password':
            PlatformOperator.objects.filter(id=op.id).update(password_hash=hash_password(_password(opts)),
                                                             token_version=F('token_version') + 1)
        elif action == 'reset-mfa':
            seed = totp.new_secret()
            try:
                op.set_mfa_secret(seed)
            except CryptoUnavailable as exc:
                raise CommandError(f'{exc} Set PLATFORM_MFA_KEY first.')
            op.mfa_last_step = 0
            op.save(update_fields=['mfa_secret', 'mfa_last_step'])
            PlatformOperator.objects.filter(id=op.id).update(token_version=F('token_version') + 1)
            self._show_mfa(op, seed)
        elif action == 'disable':
            PlatformOperator.objects.filter(id=op.id).update(is_active=False, token_version=F('token_version') + 1)
        elif action == 'enable':
            PlatformOperator.objects.filter(id=op.id).update(is_active=True)
        self._audit(op, f'OPERATOR_{action.upper().replace("-", "_")}')
        self.stdout.write(self.style.SUCCESS(f'{action}: done for {email}.'))
