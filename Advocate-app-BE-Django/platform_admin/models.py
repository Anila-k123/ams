"""Platform operators and their audit trail.

A PlatformOperator works for the company that runs AMS. It is NOT an advocate:
separate table, separate login (/api/platform/auth/), separate token audience
('ams-platform'), mandatory MFA. Operators see tenant METADATA (name, status,
counts) and never a firm's cases, clients, documents or drafts.
"""
from django.db import models


class PlatformOperator(models.Model):
    OWNER, SUPPORT, READONLY = 'OWNER', 'SUPPORT', 'READONLY'
    ROLES = [(OWNER, 'Owner'), (SUPPORT, 'Support'), (READONLY, 'Read-only')]

    id = models.BigAutoField(primary_key=True)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=200, blank=True, default='')
    password_hash = models.CharField(max_length=255)
    role = models.CharField(max_length=10, choices=ROLES, default=READONLY)
    is_active = models.BooleanField(default=True)
    # The TOTP seed, ENCRYPTED (core/crypto.py, PLATFORM_MFA_KEY). Use
    # get_mfa_secret() / set_mfa_secret(); never read or log this column directly.
    mfa_secret = models.CharField(max_length=255, blank=True, default='')
    mfa_last_step = models.BigIntegerField(default=0)        # refuses a TOTP code used twice
    token_version = models.IntegerField(default=0)          # bump = end every session
    created_at = models.DateTimeField(auto_now_add=True)
    last_login_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'platform_operator'

    # DRF treats request.user as authenticated when this is True.
    is_authenticated = True
    is_anonymous = False

    def get_mfa_secret(self):
        from core.crypto import decrypt
        return decrypt(self.mfa_secret)

    def set_mfa_secret(self, plaintext):
        from core.crypto import encrypt
        self.mfa_secret = encrypt(plaintext)

    def can(self, action):
        return action in PERMISSIONS.get(self.role, set())


# What each operator role may do. Data access is never on this list: no role
# can read a firm's business records.
PERMISSIONS = {
    PlatformOperator.OWNER: {'firm.read', 'firm.create', 'firm.update', 'firm.lifecycle',
                             'invite.manage', 'audit.read'},
    PlatformOperator.SUPPORT: {'firm.read', 'firm.update', 'firm.lifecycle', 'invite.manage', 'audit.read'},
    PlatformOperator.READONLY: {'firm.read', 'audit.read'},
}


class PlatformAudit(models.Model):
    """What operators did (and failed platform logins). Ids and short facts only:
    never passwords, MFA codes, tokens or invitation tokens."""
    id = models.BigAutoField(primary_key=True)
    operator_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    operator_email = models.CharField(max_length=254, blank=True, default='')
    action = models.CharField(max_length=60)
    firm_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    success = models.BooleanField(default=True)
    detail = models.JSONField(default=dict, blank=True)
    ip = models.CharField(max_length=45, blank=True, default='')
    at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'platform_audit'
        ordering = ['-at']
