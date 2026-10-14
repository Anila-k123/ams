"""Firms (SaaS tenants), their members, settings and internal teams.

    AMS platform -> Firm (tenant) -> Team -> advocates / staff -> cases, clients ...

A Firm is the permanent tenant identity: it exists independently of any
person (its senior or administrator can leave without the firm, or its data,
going with them). FirmMembership says which identities (core.Advocate rows)
belong to which firm; at launch an identity has at most one ACTIVE membership,
but the table already allows several (one row per firm).

A Team is a practice root (an advocate with parent_advocate_id NULL) and its
members - see core/practice.py. A firm with several seniors has several teams;
FirmTeam says which teams belong to which firm. Teams are an internal
restriction inside a firm, never the tenant boundary.

Business rows record their owner in `firm_id` (core/tenant.py stamps it on
save); `advocate_id` keeps meaning "who created it".
"""
import uuid

from django.conf import settings
from django.db import models


class Firm(models.Model):
    PROVISIONING, ACTIVE, SUSPENDED, CLOSED = 'PROVISIONING', 'ACTIVE', 'SUSPENDED', 'CLOSED'
    STATUSES = [(PROVISIONING, 'Provisioning'), (ACTIVE, 'Active'),
                (SUSPENDED, 'Suspended'), (CLOSED, 'Closed')]

    id = models.BigAutoField(primary_key=True)
    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=80, unique=True)
    status = models.CharField(max_length=16, choices=STATUSES, default=PROVISIONING)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # Migration trace only: the practice root this firm was created from.
    legacy_root_advocate_id = models.BigIntegerField(null=True, blank=True, unique=True)
    # SaaS plan placeholder for Phase 8 (subscriptions/entitlements); not used yet.
    plan_code = models.CharField(max_length=40, blank=True, default='')

    class Meta:
        db_table = 'firm'

    def __str__(self):
        return self.name

    @property
    def is_active(self):
        return self.status == self.ACTIVE


class FirmMembership(models.Model):
    STAFF, CLIENT = 'STAFF', 'CLIENT'
    KINDS = [(STAFF, 'Staff'), (CLIENT, 'Client portal')]
    INVITED, ACTIVE, SUSPENDED, LEFT = 'INVITED', 'ACTIVE', 'SUSPENDED', 'LEFT'
    STATUSES = [(INVITED, 'Invited'), (ACTIVE, 'Active'), (SUSPENDED, 'Suspended'), (LEFT, 'Left')]

    id = models.BigAutoField(primary_key=True)
    firm = models.ForeignKey(Firm, on_delete=models.PROTECT, related_name='memberships')
    advocate_id = models.BigIntegerField(db_index=True)        # -> advocate.id (identity)
    kind = models.CharField(max_length=8, choices=KINDS, default=STAFF)
    status = models.CharField(max_length=10, choices=STATUSES, default=ACTIVE)
    # The team (practice root) this member works in, if any.
    team_root_id = models.BigIntegerField(null=True, blank=True)
    is_default = models.BooleanField(default=True)
    joined_at = models.DateTimeField(null=True, blank=True)
    left_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'firm_membership'
        constraints = [
            models.UniqueConstraint(fields=['firm', 'advocate_id'], name='firm_membership_once'),
            # Launch rule: one ACTIVE membership per identity. Drop this
            # constraint (one migration) to allow several firms per person.
            models.UniqueConstraint(fields=['advocate_id'], condition=models.Q(status='ACTIVE'),
                                    name='firm_membership_one_active'),
        ]
        indexes = [models.Index(fields=['firm', 'status'], name='firm_membership_firm_status')]


class FirmSettings(models.Model):
    """Firm-level details. Seeded from the legacy root advocate's office
    fields (those fields stay on advocate for now)."""
    firm = models.OneToOneField(Firm, on_delete=models.CASCADE, primary_key=True, related_name='settings')
    display_name = models.CharField(max_length=200, blank=True, default='')
    office_address = models.TextField(blank=True, default='')
    city = models.CharField(max_length=100, blank=True, default='')
    state = models.CharField(max_length=100, blank=True, default='')
    country = models.CharField(max_length=100, blank=True, default='India')
    pin_code = models.CharField(max_length=12, blank=True, default='')
    office_phone = models.CharField(max_length=30, blank=True, default='')
    office_email = models.CharField(max_length=254, blank=True, default='')
    website = models.CharField(max_length=200, blank=True, default='')
    gst_number = models.CharField(max_length=20, blank=True, default='')
    pan_number = models.CharField(max_length=12, blank=True, default='')
    logo_path = models.CharField(max_length=255, blank=True, default='')
    primary_brand_color = models.CharField(max_length=20, blank=True, default='')
    secondary_brand_color = models.CharField(max_length=20, blank=True, default='')
    time_zone = models.CharField(max_length=64, default='Asia/Kolkata')
    currency = models.CharField(max_length=8, default='INR')
    date_format = models.CharField(max_length=20, blank=True, default='')
    invoice_prefix = models.CharField(max_length=20, default='INV-')
    invoice_fy_reset = models.BooleanField(default=False)     # restart numbering each financial year
    preferences = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'firm_settings'


class FirmTeam(models.Model):
    id = models.BigAutoField(primary_key=True)
    team_root_id = models.BigIntegerField(unique=True)        # -> advocate.id (a practice root)
    firm_root_id = models.BigIntegerField(db_index=True)      # the firm's head team root (legacy)
    created_at = models.DateTimeField(auto_now_add=True)
    if settings.TENANCY_COLUMNS:
        # The permanent firm this team belongs to (core/tenant.py).
        firm_id = models.BigIntegerField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = 'firm_team'


class FirmInvitation(models.Model):
    """An invitation to join a firm: its first administrator (sent by a platform
    operator during provisioning) or staff (sent by the firm's own admin).
    Only a hash of the token is stored; the token itself exists in the email."""
    FIRM_ADMIN, STAFF = 'FIRM_ADMIN', 'STAFF'
    KINDS = [(FIRM_ADMIN, 'Firm administrator'), (STAFF, 'Staff')]
    PLATFORM, MEMBER = 'PLATFORM', 'MEMBER'

    id = models.BigAutoField(primary_key=True)
    firm = models.ForeignKey(Firm, on_delete=models.PROTECT, related_name='invitations')
    email = models.EmailField()
    kind = models.CharField(max_length=12, choices=KINDS, default=STAFF)
    role_ids = models.JSONField(default=list)          # the firm's own role ids
    team_root_id = models.BigIntegerField(null=True, blank=True)
    advocate_id = models.BigIntegerField(null=True, blank=True)   # the identity invited
    # True when the identity was created for this invitation (sets its password on
    # acceptance); False for someone who already had an AMS login - they must
    # prove it with their current password, so an invitation can't take over an account.
    new_identity = models.BooleanField(default=True)
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    invited_by_type = models.CharField(max_length=10, default=MEMBER)
    invited_by_id = models.BigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    send_count = models.IntegerField(default=1)
    # Delivery of the invitation email (firms/invitations.py): PENDING until the
    # send after commit, then SENT or FAILED with a short reason (never the link).
    delivery_status = models.CharField(max_length=8, default='PENDING')
    delivery_error = models.CharField(max_length=200, blank=True, default='')
    last_sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'firm_invitation'
        indexes = [models.Index(fields=['firm', 'email'], name='firm_invitation_firm_email')]

    @property
    def status(self):
        import datetime
        if self.accepted_at:
            return 'ACCEPTED'
        if self.revoked_at:
            return 'REVOKED'
        if self.expires_at <= datetime.datetime.now():
            return 'EXPIRED'
        return 'PENDING'


class ProvisioningRequest(models.Model):
    """Idempotency for firm provisioning: one key -> one firm. A retry with the
    same key and payload returns that firm; a different payload is refused."""
    key = models.CharField(max_length=100, primary_key=True)
    payload_hash = models.CharField(max_length=64)
    firm = models.ForeignKey(Firm, on_delete=models.PROTECT)
    invitation_id = models.BigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'firm_provisioning_request'
