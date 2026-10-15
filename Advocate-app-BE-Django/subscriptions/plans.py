"""Commercial plan configuration: review, approval, publication, retirement.

Plans are commercial terms, which are a business decision. The seeded plans
are unapproved examples (state DRAFT) and can't be given to customers. A
platform OWNER (operator permission `plan.publish`) moves a plan through:

    DRAFT --approve--> APPROVED --publish--> PUBLISHED --retire--> RETIRED
      ^ edit (features / limits / name / description / trial days: DRAFT only)
    revise: a new DRAFT revision copied from any non-system plan

An approved or published plan is never edited: a change is a new revision
(its own row and code, e.g. PROFESSIONAL_R2). Publishing a revision retires
the family's earlier published revision for NEW subscriptions only - firms on
it keep it until an operator moves them (never automatically). Prices are not
set here at all. Each step is recorded on the plan (who, when) and in the
platform audit log by the view.
"""
from __future__ import annotations

from django.db import transaction

from . import catalogue as C
from .models import Plan, PlanEntitlement
from .service import SubscriptionError, now

EDITABLE = ('name', 'description', 'trial_days')


def _locked(code):
    plan = Plan.objects.select_for_update().filter(code=code).first()
    if plan is None:
        raise SubscriptionError('Plan not found.', 404, 'NO_PLAN')
    if plan.state == Plan.SYSTEM:
        raise SubscriptionError('The Legacy plan is internal and cannot be changed here.', 409, 'SYSTEM_PLAN')
    return plan


def _need(plan, *states):
    if plan.state not in states:
        raise SubscriptionError(f'A {plan.state.lower()} plan cannot do that.', 409, 'BAD_PLAN_STATE')


def edit_draft(code, *, name=None, description=None, trial_days=None, entitlements=None):
    """Change a DRAFT plan. `entitlements`: [{key, enabled, limit}] (limit None = unlimited)."""
    with transaction.atomic():
        plan = _locked(code)
        _need(plan, Plan.DRAFT)
        if name is not None:
            if not (2 <= len(name.strip()) <= 80):
                raise SubscriptionError('Give the plan a name (2-80 characters).', 400, 'BAD_NAME')
            plan.name = name.strip()
        if description is not None:
            plan.description = description.strip()[:2000]
        if trial_days is not None:
            if not (0 <= int(trial_days) <= 365):
                raise SubscriptionError('Trial days: 0 to 365.', 400, 'BAD_TRIAL')
            plan.trial_days = int(trial_days)
        plan.save()
        for e in entitlements or []:
            key = e.get('key')
            if key not in C.KEYS:
                raise SubscriptionError(f'Unknown entitlement {key}.', 400, 'BAD_KEY')
            limit = e.get('limit')
            if limit is not None and (int(limit) < 0 or key in C.FEATURES):
                raise SubscriptionError('Limits are whole numbers of 0 or more (features take no limit).', 400,
                                        'BAD_LIMIT')
            PlanEntitlement.objects.update_or_create(plan=plan, key=key, defaults={
                'enabled': bool(e.get('enabled', True)), 'limit': None if limit is None else int(limit)})
        return plan


def approve(code, *, actor, note):
    """Sign off the plan's features and limits as they are now."""
    with transaction.atomic():
        plan = _locked(code)
        _need(plan, Plan.DRAFT)
        missing = set(C.KEYS) - set(plan.entitlements.values_list('key', flat=True))
        if missing:
            raise SubscriptionError('Set every entitlement before approving: ' + ', '.join(sorted(missing)), 409,
                                    'INCOMPLETE_PLAN')
        plan.state, plan.approved_by, plan.approved_at = Plan.APPROVED, actor, now()
        plan.approval_note = (note or '')[:300]
        plan.save()
        return plan


def publish(code, *, actor):
    """Offer an approved plan to new firms. The family's earlier published
    revision is retired for new subscriptions; firms on it keep it."""
    with transaction.atomic():
        plan = _locked(code)
        _need(plan, Plan.APPROVED)
        retired = []
        for old in Plan.objects.select_for_update().filter(family=plan.family, state=Plan.PUBLISHED).exclude(id=plan.id):
            old.state, old.retired_by, old.retired_at, old.is_public = Plan.RETIRED, actor, now(), False
            old.save()
            retired.append(old.code)
        plan.state, plan.published_by, plan.published_at, plan.is_public = Plan.PUBLISHED, actor, now(), True
        plan.save()
        return plan, retired


def retire(code, *, actor):
    with transaction.atomic():
        plan = _locked(code)
        _need(plan, Plan.PUBLISHED, Plan.APPROVED, Plan.DRAFT)
        plan.state, plan.retired_by, plan.retired_at, plan.is_public = Plan.RETIRED, actor, now(), False
        plan.save()
        return plan


def revise(code, *, actor):
    """A new DRAFT revision of a plan, copying its features and limits."""
    with transaction.atomic():
        src = _locked(code)
        family = src.family or src.code
        rev = (Plan.objects.filter(family=family).order_by('-revision').values_list('revision', flat=True).first() or 1) + 1
        new_code = f'{family}_R{rev}'[:32]
        if Plan.objects.filter(code=new_code).exists():
            raise SubscriptionError('That revision already exists.', 409, 'REVISION_EXISTS')
        plan = Plan.objects.create(code=new_code, family=family, revision=rev, name=src.name,
                                   description=src.description, trial_days=src.trial_days, state=Plan.DRAFT,
                                   is_public=False, sort_order=src.sort_order, currency=src.currency)
        PlanEntitlement.objects.bulk_create([PlanEntitlement(plan=plan, key=e.key, enabled=e.enabled, limit=e.limit)
                                             for e in src.entitlements.all()])
        return plan
