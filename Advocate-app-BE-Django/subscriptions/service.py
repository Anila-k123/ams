"""Entitlements: may this firm do this now? And the subscription lifecycle.

Access to anything = (user permission + tenant access, as before)
                     AND the firm's subscription entitles it.
A plan never grants a permission: it can only take away (features, limits).

    check_entitlement(firm, key, action='use', quantity=1) -> Decision   (read-only)
    reserve(firm, key, quantity)        stock limits; call inside transaction.atomic()
    consume(firm, key, quantity, ...)   metered limits; idempotent by request_key
    settle(...), correct(...)           finish a reservation (FAILED releases it) / operator correction;
                                        both add compensating events (usage events are immutable)

Statuses (exact transitions in TRANSITIONS):
  TRIALING, ACTIVE, PAST_DUE  -> everything the plan allows.
  EXPIRED, CANCELLED, SUSPENDED -> read-only for subscription purposes: nothing
      new is created or metered (cases, clients, invitations, uploads, AI,
      drafting), but everything stays readable and downloadable and people can
      still sign in. This is NOT a security suspension (Firm.status is separate).
  A trial past trial_ends_at is EXPIRED at once (evaluated lazily here; the
  scheduler's `subscription_sweep` also writes it down).

  PENDING -> no approved plan chosen yet (a new firm): like read-only.

Every firm has an explicit subscription row: migration 0002 gave firms that
predate subscriptions LEGACY, `apply_tenancy` does the same for firms it
creates from pre-SaaS data, and provisioning starts the chosen published plan
or PENDING. A firm WITHOUT a row is refused (fail closed, reason
SUBSCRIPTION_MISSING) - never silently treated as unrestricted.

A plan that is not PUBLISHED / RETIRED / SYSTEM (an unapproved DRAFT or an
APPROVED plan not yet published) is only usable by a firm marked `test_firm`
while settings.SUBSCRIPTION_TEST_PLANS is on; otherwise the firm is refused
with PLAN_NOT_PUBLISHED - a draft is never silently treated as a customer plan.
"""
from __future__ import annotations

import datetime
import logging
from dataclasses import asdict, dataclass

from django.db import IntegrityError, transaction
from django.db.models import Count, Q, Sum

from . import catalogue as C
from .models import (EntitlementOverride, FirmSubscription, FirmUsage, MeteredRequest, Plan,
                     PlanChangeAudit, UsageEvent)

log = logging.getLogger('subscriptions')

S = FirmSubscription
USABLE = {S.TRIALING, S.ACTIVE, S.PAST_DUE}
READ_ONLY = {S.EXPIRED, S.CANCELLED, S.SUSPENDED, S.PENDING}
# Exact state machine. Plan changes keep or set the status separately.
TRANSITIONS = {
    S.TRIALING: {S.ACTIVE, S.EXPIRED, S.CANCELLED},
    S.ACTIVE: {S.PAST_DUE, S.SUSPENDED, S.CANCELLED},
    S.PAST_DUE: {S.ACTIVE, S.SUSPENDED, S.EXPIRED, S.CANCELLED},
    S.SUSPENDED: {S.ACTIVE, S.CANCELLED},
    S.EXPIRED: {S.ACTIVE, S.TRIALING, S.CANCELLED},
    S.CANCELLED: {S.ACTIVE},
    S.PENDING: set(),           # leaves PENDING only by being given a plan (change_plan)
}
STOCK_WINDOW = datetime.date(1970, 1, 1)


class SubscriptionError(ValueError):
    def __init__(self, message, status=400, code='INVALID'):
        super().__init__(message)
        self.status, self.code = status, code


@dataclass
class Decision:
    allowed: bool
    key: str
    reason: str                 # OK | FEATURE_NOT_IN_PLAN | LIMIT_REACHED | SUBSCRIPTION_INACTIVE
                                # | SUBSCRIPTION_MISSING | PLAN_NOT_PUBLISHED
    plan: str
    status: str
    limit: int | None = None    # None = unlimited
    used: int | None = None
    remaining: int | None = None

    def message(self):
        label = C.LABELS.get(self.key, self.key)
        if self.reason == 'FEATURE_NOT_IN_PLAN':
            return f'{label} is not included in your firm\'s plan.'
        if self.reason == 'LIMIT_REACHED':
            return f'Your firm has reached its {label.lower()} limit ({self.limit}). Ask your administrator about the plan.'
        if self.reason == 'SUBSCRIPTION_MISSING':
            return 'Your firm has no AMS subscription yet: existing work stays available, but nothing new can be added. Contact AMS support.'
        if self.reason == 'PLAN_NOT_PUBLISHED':
            return 'Your firm\'s AMS plan has not been approved for use yet: existing work stays available, but nothing new can be added. Contact AMS support.'
        if self.reason == 'SUBSCRIPTION_INACTIVE' and self.status == S.PENDING:
            return 'Your firm\'s AMS plan has not been chosen yet: existing work stays available, but nothing new can be added. Contact AMS support.'
        if self.reason == 'SUBSCRIPTION_INACTIVE':
            return f'Your firm\'s AMS subscription is {self.status.lower().replace("_", " ")}: existing work stays available, but nothing new can be added.'
        return ''

    def as_dict(self):
        return {**asdict(self), 'label': C.LABELS.get(self.key, self.key)}


class EntitlementDenied(Exception):
    def __init__(self, decision: Decision):
        super().__init__(decision.message())
        self.decision = decision

    def payload(self):
        return {'error': self.decision.message(), 'code': f'ENTITLEMENT_{self.decision.reason}',
                'entitlement': self.decision.as_dict()}


def now():
    return datetime.datetime.now()      # USE_TZ is False: naive local time throughout AMS


def month_window(at=None):
    d = (at or now()).date()
    return d.replace(day=1)


# ------------------------------------------------------------------ reading --
def subscription_of(firm):
    if firm is None:
        return None
    return FirmSubscription.objects.select_related('plan').filter(firm_id=getattr(firm, 'id', firm)).first()


def effective_status(sub):
    if sub is None:
        return S.ACTIVE
    if sub.status == S.TRIALING and sub.trial_ends_at and sub.trial_ends_at <= now():
        return S.EXPIRED
    return sub.status


def test_plans_enabled():
    from django.conf import settings
    return bool(getattr(settings, 'SUBSCRIPTION_TEST_PLANS', False))


def plan_usable_by(plan, sub):
    """May this firm be on (and use) this plan? Published, retired (kept by
    firms already on it) and Legacy plans: yes. Draft / approved-not-published:
    only a designated test firm while test plans are enabled."""
    if plan is None:
        return False
    if plan.state in (Plan.PUBLISHED, Plan.RETIRED, Plan.SYSTEM):
        return True
    return bool(sub is not None and sub.test_firm and test_plans_enabled())


def code_of(sub):
    return sub.plan.code if sub is not None and sub.plan_id else ''


def effective_entitlements(firm, sub=None):
    """{key: {'enabled', 'limit', 'overridden'}} - the plan's, then overrides."""
    sub = sub if sub is not None else subscription_of(firm)
    out = {k: {'enabled': False, 'limit': 0, 'overridden': False} for k in C.KEYS}   # unknown key = not included
    if sub is None or not sub.plan_id:
        return out                                     # no subscription / pending: nothing included
    for e in sub.plan.entitlements.all():
        out[e.key] = {'enabled': e.enabled, 'limit': e.limit, 'overridden': False}
    for o in EntitlementOverride.objects.filter(firm_id=sub.firm_id).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now())):
        cur = out.setdefault(o.key, {'enabled': False, 'limit': 0, 'overridden': False})
        if o.enabled is not None:
            cur['enabled'] = o.enabled
        if o.unlimited:
            cur['limit'] = None
        elif o.limit is not None:
            cur['limit'] = o.limit
        cur['overridden'] = True
    return out


def seats_used(firm_id):
    """Seat policy: ACTIVE staff members, plus each person with a live (not
    accepted, revoked or expired) staff/administrator invitation who isn't an
    active member yet. An invitation leaves an INVITED membership behind, but
    only a live invitation holds a seat: a withdrawn or expired one frees it.
    Suspended and former members don't use a seat (reactivating one needs a
    free seat). Client-portal logins (CLIENT memberships) never use staff seats."""
    from firms.models import FirmInvitation, FirmMembership
    active = set(FirmMembership.objects.filter(firm_id=firm_id, kind=FirmMembership.STAFF,
                                               status=FirmMembership.ACTIVE).values_list('advocate_id', flat=True))
    pending = set(FirmInvitation.objects.filter(firm_id=firm_id, accepted_at__isnull=True, revoked_at__isnull=True,
                                                expires_at__gt=now()).values_list('advocate_id', flat=True))
    return len(active) + len(pending - active)


def _storage_used(firm_id):
    """Bytes of the firm's documents: each current file, plus every kept earlier
    version (a version row for the current number is the current file itself)."""
    from core.models import Document
    from documents.models import DocumentVersion
    docs = Document.objects.filter(firm_id=firm_id)
    current = docs.aggregate(n=Sum('file_size'))['n'] or 0
    latest = dict(docs.values_list('id', 'version'))
    kept = sum(size or 0 for doc_id, version, size in DocumentVersion.objects
               .filter(document_id__in=list(latest)).values_list('document_id', 'version', 'file_size')
               if version != (latest.get(doc_id) or 1))
    return int(current + kept)


def usage(firm_id, key, at=None):
    """Current use of one key (stock: live count; metered: this window)."""
    from core.models import Case, Client
    if key == C.SEATS:
        return seats_used(firm_id)
    if key == C.CASES:
        return Case.objects.filter(firm_id=firm_id, deleted=False).count()
    if key == C.CLIENTS:
        return Client.objects.filter(firm_id=firm_id, deleted=False).count()
    if key == C.STORAGE:
        return _storage_used(firm_id)
    if key in C.METERED:
        row = FirmUsage.objects.filter(firm_id=firm_id, key=key, window_start=month_window(at)).first()
        return row.used if row else 0
    return None


def check_entitlement(firm, key, action='use', quantity=1, *, sub=None, ents=None) -> Decision:
    """May `firm` `action` `quantity` of `key` now? Pure read: reserves nothing.
    action: 'read' (always allowed: existing data stays available) or 'use'."""
    if firm is None:
        return Decision(True, key, 'OK', '', '')
    sub = sub if sub is not None else subscription_of(firm)
    if sub is None:
        allowed = action == 'read'
        return Decision(allowed, key, 'OK' if allowed else 'SUBSCRIPTION_MISSING', '', 'NONE')
    status = effective_status(sub)
    plan = code_of(sub)
    ents = ents or effective_entitlements(firm, sub)
    ent = ents.get(key, {'enabled': False, 'limit': 0})
    limit = ent['limit'] if key in C.STOCK + C.METERED else None
    used = usage(sub.firm_id, key) if key in C.STOCK + C.METERED else None
    remaining = None if limit is None or used is None else max(limit - used, 0)
    d = Decision(True, key, 'OK', plan, status, limit, used, remaining)
    if action == 'read':
        return d
    if status in READ_ONLY:
        d.allowed, d.reason = False, 'SUBSCRIPTION_INACTIVE'
        return d
    if not plan_usable_by(sub.plan, sub):
        d.allowed, d.reason = False, 'PLAN_NOT_PUBLISHED'
        return d
    feature = C.FEATURE_OF.get(key, key if key in C.FEATURES else None)
    if feature and not ents.get(feature, {}).get('enabled', False):
        d.allowed, d.reason, d.key = False, 'FEATURE_NOT_IN_PLAN', feature
        return d
    if key in C.STOCK + C.METERED and not ent.get('enabled', True):
        d.allowed, d.reason = False, 'FEATURE_NOT_IN_PLAN'
        return d
    if limit is not None and used is not None and used + max(quantity, 0) > limit:
        d.allowed, d.reason = False, 'LIMIT_REACHED'
    return d


# ---------------------------------------------------------------- enforcing --
def _lock(firm_id, key, window):
    """Lock (creating if needed) the counter row: serialises every reservation of
    this firm/key, so two requests at once can't both take the last unit."""
    try:
        with transaction.atomic():
            FirmUsage.objects.get_or_create(firm_id=firm_id, key=key, window_start=window)
    except IntegrityError:
        pass
    return FirmUsage.objects.select_for_update().get(firm_id=firm_id, key=key, window_start=window)


def reserve(firm, key, quantity=1):
    """Stock limits. Must run inside transaction.atomic() together with the
    insert it guards: the lock is held until that transaction commits, so the
    next request counts the new row. Raises EntitlementDenied."""
    if firm is None:
        return Decision(True, key, 'OK', '', '')
    sub = subscription_of(firm)
    if sub is None:
        raise EntitlementDenied(check_entitlement(firm, key, 'use', quantity, sub=None))
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError('reserve() must run inside transaction.atomic()')
    _lock(sub.firm_id, key, STOCK_WINDOW)
    d = check_entitlement(firm, key, 'use', quantity, sub=sub)
    if not d.allowed:
        raise EntitlementDenied(d)
    return d


class Reservation:
    """A counted metered request. Settle it when the work is over:
    succeed(); fail() - nothing usable came back, the count is given back;
    cancel() - the caller went away after the work started, it stays counted.
    A no-op handle when nothing is enforced (legacy/shadow mode)."""

    def __init__(self, request_id=None, decision=None):
        self.id, self.decision = request_id, decision

    def succeed(self):
        return settle(self.id, MeteredRequest.SUCCEEDED)

    def fail(self):
        return settle(self.id, MeteredRequest.FAILED)

    def cancel(self):
        return settle(self.id, MeteredRequest.CANCELLED)

    def attach(self, ref):
        """Hand the request to a background job, which settles it by ref (settle_ref)."""
        if self.id is not None:
            MeteredRequest.objects.filter(id=self.id).update(ref=ref[:60])


def consume(firm, key, quantity=1, *, advocate_id=None, request_key=None, source='', detail=None, ref=''):
    """Metered limits: reserve `quantity` against this month's window and return
    a Reservation. With a request_key (the client's Idempotency-Key, scoped to
    the user by meter()):
      - a request still running with that key -> 409 REQUEST_IN_PROGRESS;
      - one that succeeded or was cancelled  -> 409 IDEMPOTENCY_KEY_USED (there
        is no stored reply to replay, and a reused key must never be free use);
      - one that failed (and was released)   -> counted again as a new attempt.
    Raises EntitlementDenied (nothing recorded) when over the limit or not included."""
    import uuid
    if firm is None:
        return Reservation()
    sub = subscription_of(firm)
    if sub is None:
        raise EntitlementDenied(check_entitlement(firm, key, 'use', quantity, sub=None))
    firm_id, window = sub.firm_id, month_window()
    rk = (request_key or f'auto:{uuid.uuid4().hex}')[:140]
    with transaction.atomic():
        row = _lock(firm_id, key, window)          # serialises this firm's key: guards the request row too
        req = MeteredRequest.objects.select_for_update().filter(firm_id=firm_id, key=key, request_key=rk).first()
        if req is not None and req.state == MeteredRequest.RESERVED:
            raise SubscriptionError('This request is already running.', 409, 'REQUEST_IN_PROGRESS')
        if req is not None and req.state in (MeteredRequest.SUCCEEDED, MeteredRequest.CANCELLED):
            raise SubscriptionError('This request key was already used. Send a new Idempotency-Key.', 409,
                                    'IDEMPOTENCY_KEY_USED')
        d = check_entitlement(firm, key, 'use', quantity, sub=sub)
        if not d.allowed:
            raise EntitlementDenied(d)
        if req is None:
            req = MeteredRequest.objects.create(firm_id=firm_id, key=key, request_key=rk, ref=ref[:60],
                                                quantity=quantity, window_start=window, advocate_id=advocate_id,
                                                source=source[:40])
        else:                                       # a failed attempt retried with the same key
            req.state, req.attempts, req.quantity, req.window_start = (
                MeteredRequest.RESERVED, req.attempts + 1, quantity, window)
            req.ref = ref[:60] or req.ref
            req.save()
        UsageEvent.objects.create(firm_id=firm_id, key=key, quantity=quantity, window_start=window,
                                  advocate_id=advocate_id, request_key=f'{rk}#{req.attempts}'[:100],
                                  source=source[:40], ok=True, detail=detail or {})
        FirmUsage.objects.filter(id=row.id).update(used=row.used + quantity)
        d.used = row.used + quantity
        d.remaining = None if d.limit is None else max(d.limit - d.used, 0)
        return Reservation(req.id, d)


def settle(request_id, state):
    """Finish a reserved request. FAILED gives the count back with a compensating
    event in the request's own window (a failure just after a month boundary
    doesn't reduce the new month). Settling twice does nothing."""
    if request_id is None:
        return False
    with transaction.atomic():
        req = MeteredRequest.objects.select_for_update().filter(id=request_id).first()
        if req is None or req.state != MeteredRequest.RESERVED:
            return False
        req.state = state
        req.save(update_fields=['state', 'updated_at'])
        if state == MeteredRequest.FAILED:
            _adjust(req.firm_id, req.key, -abs(req.quantity), window=req.window_start,
                    request_key=f'{req.request_key}#{req.attempts}:release'[:100], source='release',
                    advocate_id=req.advocate_id, ok=False)
        return True


def settle_ref(ref, ok):
    """Settle the running request of a background job (e.g. ref 'draft:12')."""
    req = MeteredRequest.objects.filter(ref=ref, state=MeteredRequest.RESERVED).order_by('-id').first()
    return settle(req.id, MeteredRequest.SUCCEEDED if ok else MeteredRequest.FAILED) if req else False


def release_stale(minutes=120):
    """Requests still RESERVED long after they started (the process died
    mid-way): nothing was confirmed to the user, so they are released."""
    cut = now() - datetime.timedelta(minutes=minutes)
    n = 0
    for rid in MeteredRequest.objects.filter(state=MeteredRequest.RESERVED,
                                             updated_at__lt=cut).values_list('id', flat=True):
        n += settle(rid, MeteredRequest.FAILED)
    return n


def _adjust(firm_id, key, quantity, *, request_key, source, advocate_id=None, detail=None, ok=True, window=None):
    window = window or month_window()
    with transaction.atomic():
        if request_key and UsageEvent.objects.filter(firm_id=firm_id, key=key, request_key=request_key).exists():
            return False
        row = _lock(firm_id, key, window)
        UsageEvent.objects.create(firm_id=firm_id, key=key, quantity=quantity, window_start=window,
                                  advocate_id=advocate_id, request_key=request_key, source=source[:40],
                                  ok=ok, detail=detail or {})
        FirmUsage.objects.filter(id=row.id).update(used=max(row.used + quantity, 0))
        return True


def correct(firm, key, quantity, *, actor, reason):
    """Operator correction of a metered counter (+/-), recorded as an event and in the history."""
    sub = subscription_of(firm)
    if sub is None:
        raise SubscriptionError('This firm has no subscription.', 409, 'NO_SUBSCRIPTION')
    if key not in C.METERED:
        raise SubscriptionError('Only metered usage can be corrected; stock usage is counted from the data.', 400, 'NOT_METERED')
    import uuid
    _adjust(sub.firm_id, key, int(quantity), request_key=f'correction:{uuid.uuid4().hex}', source='correction',
            detail={'reason': reason[:200]})
    _audit(sub, 'USAGE_CORRECTED', actor, reason, detail={'key': key, 'quantity': int(quantity)})


# ---- view helpers: firm of the acting user, then the checks above ------------
def firm_for(user):
    """The firm to check, or None when tenancy isn't enforced (legacy/shadow mode)."""
    from django.conf import settings
    if getattr(settings, 'TENANCY_MODE', 'legacy') != 'firm':
        return None
    from core.tenant import firm_of
    return firm_of(user)


def require(user, key, quantity=1):
    """reserve() for the acting user's firm (inside the caller's atomic block)."""
    return reserve(firm_for(user), key, quantity)


def require_feature(user, feature):
    d = check_entitlement(firm_for(user), feature, 'use')
    if not d.allowed:
        raise EntitlementDenied(d)
    return d


def meter(user, key, quantity=1, *, request_key=None, source='', detail=None, ref=''):
    """consume() for the acting user's firm. A client Idempotency-Key is scoped
    to the user, so one person's key can never collide with (or reuse) another's."""
    uid = getattr(user, 'id', None)
    rk = f'u{uid}:{request_key}' if request_key else None
    return consume(firm_for(user), key, quantity, advocate_id=uid, request_key=rk, source=source,
                   detail=detail, ref=ref)


# ---------------------------------------------------------------- lifecycle --
def _audit(sub, action, actor, reason='', *, from_plan='', from_status='', detail=None):
    PlanChangeAudit.objects.create(firm_id=sub.firm_id, action=action, from_plan=from_plan,
                                   to_plan=code_of(sub), from_status=from_status, to_status=sub.status,
                                   actor=actor or 'SYSTEM', reason=(reason or '')[:300], detail=detail or {})


def _sync_firm_plan_code(sub):
    from firms.models import Firm
    Firm.objects.filter(id=sub.firm_id).update(plan_code=code_of(sub))


def _plan(code):
    plan = Plan.objects.filter(code=code, is_active=True).first()
    if plan is None:
        raise SubscriptionError(f'There is no active plan "{code}".', 404, 'NO_PLAN')
    return plan


def _assignable(code, sub, *, test_firm=None):
    """The plan an operator may put this firm on. Never Legacy (only firms that
    predate subscriptions have it), never a retired plan (no new subscriptions),
    and a draft / approved-not-published plan only for a designated test firm
    while test plans are enabled - otherwise 409 PLAN_NOT_PUBLISHED."""
    plan = _plan(code)
    if plan.state == Plan.SYSTEM:
        raise SubscriptionError('Legacy is kept for firms that used AMS before subscriptions; it cannot be assigned.',
                                409, 'PLAN_NOT_ASSIGNABLE')
    if plan.state == Plan.RETIRED:
        raise SubscriptionError(f'{plan.name} is retired: no new subscriptions.', 409, 'PLAN_RETIRED')
    if plan.state != Plan.PUBLISHED:
        is_test = sub.test_firm if sub is not None else bool(test_firm)
        if not (is_test and test_plans_enabled()):
            raise SubscriptionError(f'{plan.name} is a {plan.state.lower()} plan, not approved and published for '
                                    'customers.', 409, 'PLAN_NOT_PUBLISHED')
    return plan


def _transition(sub, to, actor, reason, action):
    cur = effective_status(sub)
    if cur == to:
        return sub
    if to not in TRANSITIONS.get(cur, set()):
        raise SubscriptionError(f'A {cur.lower()} subscription cannot become {to.lower()}.', 409, 'BAD_TRANSITION')
    if to == S.TRIALING and not (sub.trial_ends_at and sub.trial_ends_at > now()):
        raise SubscriptionError('Use Extend trial to restart a trial.', 409, 'BAD_TRANSITION')
    before = sub.status
    sub.status = to
    if to == S.CANCELLED:
        sub.cancelled_at = now()
    if to == S.ACTIVE:
        sub.cancelled_at = None
        sub.current_period_start = sub.current_period_start or now()
    sub.save()
    _audit(sub, action, actor, reason, from_plan=code_of(sub), from_status=before)
    return sub


def start_subscription(firm, plan_code=None, *, actor='SYSTEM', reason='', test_firm=False):
    """A new firm's subscription, created with the firm. With a plan code: that
    plan if it may be assigned (published, or a draft for a designated test
    firm), else SubscriptionError - never a silent fallback. Without one:
    PENDING, nothing new can be added until an operator assigns an approved
    plan. Idempotent: a firm that already has a subscription keeps it."""
    existing = subscription_of(firm)
    if existing is not None:
        return existing
    if test_firm and not test_plans_enabled():
        raise SubscriptionError('Test firms are only allowed where test plans are enabled.', 409, 'TEST_PLANS_DISABLED')
    C.ensure_plans()
    plan = _assignable(plan_code.upper(), None, test_firm=test_firm) if plan_code else None
    trial = plan is not None and plan.trial_days > 0
    status = S.PENDING if plan is None else (S.TRIALING if trial else S.ACTIVE)
    with transaction.atomic():
        sub, made = FirmSubscription.objects.get_or_create(firm_id=getattr(firm, 'id', firm), defaults={
            'plan': plan, 'status': status, 'test_firm': bool(test_firm),
            'trial_ends_at': now() + datetime.timedelta(days=plan.trial_days) if trial else None,
            'current_period_start': now() if plan is not None else None})
        if made:
            _audit(sub, 'STARTED' if plan is not None else 'PENDING_PLAN', actor, reason,
                   detail={'trialDays': plan.trial_days if plan else 0, 'testFirm': bool(test_firm)})
            _sync_firm_plan_code(sub)
    return sub


def assign_legacy(firm, *, actor='SYSTEM', reason='Existing firm: Legacy policy, nothing changes'):
    """Only for firms that predate subscriptions (migration 0002, apply_tenancy
    backfill, test fixtures) - not an operator action."""
    if subscription_of(firm) is not None:
        return subscription_of(firm)
    C.ensure_plans()
    sub = FirmSubscription.objects.create(firm_id=getattr(firm, 'id', firm), plan=_plan(C.LEGACY),
                                          status=S.ACTIVE, current_period_start=now())
    _audit(sub, 'LEGACY_ASSIGNED', actor, reason)
    _sync_firm_plan_code(sub)
    return sub


def _locked_sub(firm):
    sub = FirmSubscription.objects.select_for_update(of=('self',)).select_related('plan').filter(
        firm_id=getattr(firm, 'id', firm)).first()
    if sub is None:
        raise SubscriptionError('This firm has no subscription yet.', 409, 'NO_SUBSCRIPTION')
    return sub


def change_plan(firm, plan_code, *, actor, reason, status=S.ACTIVE):
    """Upgrade / downgrade / plan change (also how a PENDING firm gets its plan).
    Data is never touched: on a downgrade anything over the new limits stays,
    only new additions are refused. Stock usage is counted live and metered
    counters are per month, so no quota state goes stale."""
    if status not in (S.ACTIVE, S.TRIALING):
        raise SubscriptionError('A plan change sets the status to Active or Trial.', 400, 'BAD_STATUS')
    with transaction.atomic():
        sub = _locked_sub(firm)
        before_plan, before_status = code_of(sub), effective_status(sub)
        if plan_code == before_plan and status == before_status:
            return sub
        plan = sub.plan if plan_code == before_plan else _assignable(plan_code, sub)
        if status == S.TRIALING and plan.trial_days <= 0:
            raise SubscriptionError(f'{plan.name} has no trial period.', 409, 'NOT_A_TRIAL')
        sub.plan = plan
        if status == S.TRIALING:
            sub.trial_ends_at = now() + datetime.timedelta(days=plan.trial_days)
        sub.status = status
        if status == S.ACTIVE:
            sub.cancelled_at, sub.current_period_start = None, now()
        sub.save()
        _audit(sub, 'PLAN_CHANGED', actor, reason, from_plan=before_plan, from_status=before_status)
        _sync_firm_plan_code(sub)
        return sub


def set_test_firm(firm, flag, *, actor, reason):
    """Designate a synthetic firm (development / testing only)."""
    if flag and not test_plans_enabled():
        raise SubscriptionError('Test firms are only allowed where test plans are enabled.', 409, 'TEST_PLANS_DISABLED')
    with transaction.atomic():
        sub = _locked_sub(firm)
        if not flag and sub.plan_id and sub.plan.state not in (Plan.PUBLISHED, Plan.RETIRED, Plan.SYSTEM):
            raise SubscriptionError('Move the firm to a published plan first.', 409, 'ON_TEST_PLAN')
        if sub.test_firm != bool(flag):
            sub.test_firm = bool(flag)
            sub.save(update_fields=['test_firm', 'updated_at'])
            _audit(sub, 'TEST_FIRM_SET' if flag else 'TEST_FIRM_CLEARED', actor, reason,
                   from_plan=code_of(sub), from_status=sub.status)
        return sub


def extend_trial(firm, days, *, actor, reason):
    if not (1 <= int(days) <= 365):
        raise SubscriptionError('Extend by 1 to 365 days.', 400, 'BAD_DAYS')
    with transaction.atomic():
        sub = _locked_sub(firm)
        cur = effective_status(sub)
        if cur not in (S.TRIALING, S.EXPIRED) or not sub.plan_id or sub.plan.trial_days <= 0:
            raise SubscriptionError('Only a trial (running or expired) can be extended.', 409, 'NOT_A_TRIAL')
        if not plan_usable_by(sub.plan, sub):
            raise SubscriptionError('This trial plan is not published: move the firm to a published plan.', 409,
                                    'PLAN_NOT_PUBLISHED')
        base = max(sub.trial_ends_at or now(), now())
        before = sub.status
        sub.trial_ends_at, sub.status = base + datetime.timedelta(days=int(days)), S.TRIALING
        sub.save()
        _audit(sub, 'TRIAL_EXTENDED', actor, reason, from_plan=code_of(sub), from_status=before,
               detail={'days': int(days), 'until': sub.trial_ends_at.isoformat()})
        return sub


def set_status(firm, to, *, actor, reason, action=None):
    with transaction.atomic():
        return _transition(_locked_sub(firm), to, actor, reason, action or f'STATUS_{to}')


def set_override(firm, key, *, actor, reason, enabled=None, limit=None, unlimited=False, expires_at=None):
    if key not in C.KEYS:
        raise SubscriptionError('Unknown entitlement.', 400, 'BAD_KEY')
    if not reason or len(reason.strip()) < 3:
        raise SubscriptionError('Give a reason for the override.', 400, 'REASON_REQUIRED')
    if limit is not None and int(limit) < 0:
        raise SubscriptionError('A limit cannot be negative.', 400, 'BAD_LIMIT')
    if expires_at is not None and expires_at <= now():
        raise SubscriptionError('The expiry must be in the future.', 400, 'BAD_EXPIRY')
    with transaction.atomic():
        sub = _locked_sub(firm)
        o, _ = EntitlementOverride.objects.update_or_create(firm_id=sub.firm_id, key=key, defaults={
            'enabled': enabled, 'limit': None if limit is None else int(limit), 'unlimited': bool(unlimited),
            'reason': reason.strip()[:300], 'expires_at': expires_at, 'created_by': actor})
        _audit(sub, 'OVERRIDE_SET', actor, reason, from_plan=code_of(sub), from_status=sub.status,
               detail={'key': key, 'enabled': enabled, 'limit': o.limit, 'unlimited': o.unlimited,
                       'expiresAt': expires_at.isoformat() if expires_at else None})
        return o


def clear_override(firm, key, *, actor, reason):
    with transaction.atomic():
        sub = _locked_sub(firm)
        n, _ = EntitlementOverride.objects.filter(firm_id=sub.firm_id, key=key).delete()
        if n:
            _audit(sub, 'OVERRIDE_CLEARED', actor, reason, from_plan=code_of(sub), from_status=sub.status,
                   detail={'key': key})
        return bool(n)


def expire_due_trials():
    """Write down trials that ended (check_entitlement already treats them as
    expired). Data is untouched. Returns the number expired."""
    n = 0
    for sub in FirmSubscription.objects.select_related('plan').filter(status=S.TRIALING, trial_ends_at__lte=now()):
        with transaction.atomic():
            locked = _locked_sub(sub.firm_id)
            if locked.status == S.TRIALING and locked.trial_ends_at and locked.trial_ends_at <= now():
                locked.status = S.EXPIRED
                locked.save(update_fields=['status', 'updated_at'])
                _audit(locked, 'TRIAL_EXPIRED', 'SYSTEM', 'Trial period ended', from_plan=code_of(locked),
                       from_status=S.TRIALING)
                n += 1
    return n


# ----------------------------------------------------------------- summary --
def summary(firm):
    """Plan, status and every entitlement with its use - for the firm and operator screens."""
    sub = subscription_of(firm)
    ents = effective_entitlements(firm, sub)
    firm_id = getattr(firm, 'id', firm)
    rows = []
    for key in C.KEYS:
        d = check_entitlement(firm, key, 'read', sub=sub, ents=ents)
        e = ents.get(key, {})
        rows.append({'key': key, 'label': C.LABELS[key],
                     'kind': 'feature' if key in C.FEATURES else ('metered' if key in C.METERED else 'stock'),
                     'enabled': e.get('enabled', False), 'limit': e.get('limit'), 'overridden': e.get('overridden', False),
                     'used': d.used if sub else usage(firm_id, key), 'remaining': d.remaining})
    status = effective_status(sub) if sub else 'NONE'
    plan = sub.plan if sub is not None and sub.plan_id else None
    return {
        'plan': ({'code': plan.code, 'name': plan.name, 'state': plan.state, 'revision': plan.revision}
                 if plan else {'code': '', 'name': 'No plan yet' if sub else 'No subscription', 'state': '', 'revision': 0}),
        'status': status, 'storedStatus': sub.status if sub else None,
        'readOnly': status in READ_ONLY or sub is None,
        'planUsable': bool(sub and plan_usable_by(plan, sub)),
        'testFirm': bool(sub and sub.test_firm),
        'trialEndsAt': sub.trial_ends_at if sub else None,
        'currentPeriodStart': sub.current_period_start if sub else None,
        'cancelledAt': sub.cancelled_at if sub else None,
        'window': month_window().isoformat(),
        'entitlements': rows,
        'ai': ai_usage(firm_id),
    }


def ai_usage(firm_id, at=None):
    """This month's AI token use from metering.llm_usage (provider-reported where
    available; `estimatedCalls` counts calls whose tokens were estimated from text)."""
    from metering.models import LLMUsage
    start = month_window(at)
    qs = LLMUsage.objects.filter(firm_id=firm_id, created_at__date__gte=start)
    agg = qs.aggregate(t=Sum('total_tokens'), i=Sum('input_tokens'), o=Sum('output_tokens'))
    return {'calls': qs.count(), 'estimatedCalls': qs.filter(estimated=True).count(),
            'failedCalls': qs.filter(ok=False).count(),
            'inputTokens': agg['i'] or 0, 'outputTokens': agg['o'] or 0, 'totalTokens': agg['t'] or 0,
            'byFeature': {r['feature']: r['n'] for r in qs.values('feature').annotate(n=Sum('total_tokens'))},
            # Request quota (what the plan counts) by outcome - separate from provider tokens above.
            'requests': {r['state']: r['n'] for r in MeteredRequest.objects.filter(firm_id=firm_id, window_start=start)
                         .values('state').annotate(n=Count('id'))},
            'cost': None}   # no price data: never invented
