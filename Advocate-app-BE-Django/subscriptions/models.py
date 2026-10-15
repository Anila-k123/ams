"""AMS SaaS subscriptions: what each law firm may use of AMS.

This is AMS billing *firms* - entirely separate from the invoices a firm
issues to its own clients (invoices / payments apps). Nothing here touches
those tables, and nothing there reads these.

Plans and their entitlements are data (seeded by subscriptions/catalogue.py,
changeable without code). A firm has one FirmSubscription; its effective
entitlements are the plan's, adjusted by per-firm overrides an operator set.
Usage of stock resources (seats, cases, clients, storage) is counted live from
the real tables; usage of flow resources (AI requests, drafting operations)
is metered per window in FirmUsage from immutable UsageEvent rows.
"""
from django.db import models


class Plan(models.Model):
    """A plan revision. Commercial terms are a business decision, so a plan is
    only offered to customers once a platform OWNER approved and published it
    (subscriptions/plans.py). Seeded plans start as DRAFT examples. An approved
    plan's features and limits can't be edited: changes are a new revision
    (a new row), and firms on the old revision keep it until moved."""
    DRAFT, APPROVED, PUBLISHED, RETIRED, SYSTEM = 'DRAFT', 'APPROVED', 'PUBLISHED', 'RETIRED', 'SYSTEM'
    STATES = [(s, s.title()) for s in (DRAFT, APPROVED, PUBLISHED, RETIRED, SYSTEM)]

    code = models.CharField(max_length=32, unique=True)            # TRIAL / BASIC / PROFESSIONAL / ENTERPRISE / LEGACY, revisions CODE_R2...
    family = models.CharField(max_length=32, default='')          # the code of the first revision
    revision = models.PositiveIntegerField(default=1)
    # DRAFT: example / being prepared - never offered to customers.
    # APPROVED: terms signed off, not offered yet. PUBLISHED: offered to new firms.
    # RETIRED: no new subscriptions; firms already on it keep it. SYSTEM: Legacy (internal).
    state = models.CharField(max_length=10, choices=STATES, default=DRAFT)
    approved_by = models.CharField(max_length=254, blank=True, default='')
    approved_at = models.DateTimeField(null=True, blank=True)
    published_by = models.CharField(max_length=254, blank=True, default='')
    published_at = models.DateTimeField(null=True, blank=True)
    retired_by = models.CharField(max_length=254, blank=True, default='')
    retired_at = models.DateTimeField(null=True, blank=True)
    approval_note = models.CharField(max_length=300, blank=True, default='')
    name = models.CharField(max_length=80)
    description = models.TextField(blank=True, default='')
    is_public = models.BooleanField(default=True)                  # offered to new firms (Legacy is not)
    is_active = models.BooleanField(default=True)
    trial_days = models.PositiveIntegerField(default=0)            # > 0 only for trial plans
    # Commercial price: deliberately NOT set (prices are a business decision).
    # Decimal, never float, when it is.
    monthly_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, default='INR')
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'subscription_plan'
        ordering = ['sort_order', 'id']
        constraints = [models.CheckConstraint(
            condition=models.Q(state__in=['DRAFT', 'APPROVED', 'PUBLISHED', 'RETIRED', 'SYSTEM']),
            name='subscription_plan_state_valid')]

    def __str__(self):
        return self.code


class PlanEntitlement(models.Model):
    """One feature flag or limit of a plan. `limit` NULL = unlimited."""
    plan = models.ForeignKey(Plan, on_delete=models.CASCADE, related_name='entitlements')
    key = models.CharField(max_length=48)                          # see catalogue.KEYS
    enabled = models.BooleanField(default=True)
    limit = models.BigIntegerField(null=True, blank=True)

    class Meta:
        db_table = 'subscription_plan_entitlement'
        constraints = [
            models.UniqueConstraint(fields=['plan', 'key'], name='plan_entitlement_once'),
            models.CheckConstraint(condition=models.Q(limit__isnull=True) | models.Q(limit__gte=0),
                                   name='plan_entitlement_limit_not_negative'),
        ]


class FirmSubscription(models.Model):
    TRIALING, ACTIVE, PAST_DUE = 'TRIALING', 'ACTIVE', 'PAST_DUE'
    SUSPENDED, EXPIRED, CANCELLED = 'SUSPENDED', 'EXPIRED', 'CANCELLED'
    PENDING = 'PENDING'     # no approved plan chosen yet: nothing new can be added
    STATUSES = [(s, s.replace('_', ' ').title())
                for s in (PENDING, TRIALING, ACTIVE, PAST_DUE, SUSPENDED, EXPIRED, CANCELLED)]

    firm = models.OneToOneField('firms.Firm', on_delete=models.PROTECT, related_name='subscription')
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name='subscriptions', null=True, blank=True)
    # A synthetic firm for development / testing: may use DRAFT / APPROVED plans,
    # and only while settings.SUBSCRIPTION_TEST_PLANS is on (never in production).
    test_firm = models.BooleanField(default=False)
    status = models.CharField(max_length=12, choices=STATUSES, default=TRIALING)
    trial_ends_at = models.DateTimeField(null=True, blank=True)
    current_period_start = models.DateTimeField(null=True, blank=True)
    current_period_end = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'firm_subscription'
        constraints = [models.CheckConstraint(
            condition=models.Q(status__in=['PENDING', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'EXPIRED', 'CANCELLED']),
            name='firm_subscription_status_valid_v2'),
            models.CheckConstraint(condition=models.Q(plan__isnull=False) | models.Q(status='PENDING'),
                                   name='firm_subscription_plan_unless_pending')]


class EntitlementOverride(models.Model):
    """An operator's per-firm adjustment of one entitlement (a bigger limit for a
    month, a feature switched on for a pilot...). Expired overrides are ignored."""
    firm = models.ForeignKey('firms.Firm', on_delete=models.CASCADE, related_name='entitlement_overrides')
    key = models.CharField(max_length=48)
    enabled = models.BooleanField(null=True, blank=True)           # None = keep the plan's
    limit = models.BigIntegerField(null=True, blank=True)          # None = keep the plan's (unless unlimited)
    unlimited = models.BooleanField(default=False)
    reason = models.CharField(max_length=300)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_by = models.CharField(max_length=254, blank=True, default='')   # operator email
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'subscription_override'
        constraints = [
            models.UniqueConstraint(fields=['firm', 'key'], name='subscription_override_once'),
            models.CheckConstraint(condition=models.Q(limit__isnull=True) | models.Q(limit__gte=0),
                                   name='subscription_override_limit_not_negative'),
        ]


class FirmUsage(models.Model):
    """A per-firm counter row. For metered keys it holds the window's total; for
    stock keys (window_start = STOCK_WINDOW) it only serves as the row locked
    while a reservation is checked against the live count."""
    firm_id = models.BigIntegerField()
    key = models.CharField(max_length=48)
    window_start = models.DateField()
    used = models.BigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'firm_usage'
        constraints = [models.UniqueConstraint(fields=['firm_id', 'key', 'window_start'], name='firm_usage_once')]


class UsageEvent(models.Model):
    """Immutable record of metered use (and of refunds / corrections, as
    negative quantities). `request_key` makes a retried request count once.
    Never holds prompts, document text, client data or keys."""
    firm_id = models.BigIntegerField(db_index=True)
    key = models.CharField(max_length=48)
    quantity = models.BigIntegerField()
    window_start = models.DateField()
    advocate_id = models.BigIntegerField(null=True, blank=True)
    request_key = models.CharField(max_length=100, null=True, blank=True)
    source = models.CharField(max_length=40, default='')           # e.g. assistant.chat, drafting.generate, correction
    ok = models.BooleanField(default=True)
    detail = models.JSONField(default=dict, blank=True)            # model/provider names only
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'usage_event'
        constraints = [models.UniqueConstraint(fields=['firm_id', 'key', 'request_key'], name='usage_event_request_once',
                                               condition=models.Q(request_key__isnull=False))]
        indexes = [models.Index(fields=['firm_id', 'key', 'window_start'], name='usage_event_window')]


class MeteredRequest(models.Model):
    """One metered operation and what became of it. The usage events stay
    immutable: releasing a failed request adds a compensating event.

      RESERVED  counted, running
      SUCCEEDED done (stays counted)
      FAILED    nothing usable came back: released (a retry with the same key counts again)
      CANCELLED the caller went away after the work started: stays counted

    Provider tokens are separate (metering.llm_usage) and are never given back."""
    RESERVED, SUCCEEDED, FAILED, CANCELLED = 'RESERVED', 'SUCCEEDED', 'FAILED', 'CANCELLED'
    STATES = [(s, s.title()) for s in (RESERVED, SUCCEEDED, FAILED, CANCELLED)]

    firm_id = models.BigIntegerField()
    key = models.CharField(max_length=48)
    request_key = models.CharField(max_length=140)                # client key scoped to the user, or generated
    ref = models.CharField(max_length=60, blank=True, default='', db_index=True)   # e.g. draft:12 (background settle)
    state = models.CharField(max_length=10, choices=STATES, default=RESERVED)
    quantity = models.BigIntegerField(default=1)
    attempts = models.PositiveIntegerField(default=1)
    window_start = models.DateField()
    advocate_id = models.BigIntegerField(null=True, blank=True)
    source = models.CharField(max_length=40, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'metered_request'
        constraints = [
            models.UniqueConstraint(fields=['firm_id', 'key', 'request_key'], name='metered_request_once'),
            models.CheckConstraint(condition=models.Q(state__in=['RESERVED', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
                                   name='metered_request_state_valid'),
        ]
        indexes = [models.Index(fields=['state', 'updated_at'], name='metered_request_stale')]


class PlanChangeAudit(models.Model):
    """Every subscription change: who (operator or SYSTEM), what, why."""
    firm = models.ForeignKey('firms.Firm', on_delete=models.CASCADE, related_name='subscription_history')
    action = models.CharField(max_length=40)
    from_plan = models.CharField(max_length=32, blank=True, default='')
    to_plan = models.CharField(max_length=32, blank=True, default='')
    from_status = models.CharField(max_length=12, blank=True, default='')
    to_status = models.CharField(max_length=12, blank=True, default='')
    actor = models.CharField(max_length=254, default='SYSTEM')
    reason = models.CharField(max_length=300, blank=True, default='')
    detail = models.JSONField(default=dict, blank=True)
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'subscription_history'
        ordering = ['-at', '-id']
