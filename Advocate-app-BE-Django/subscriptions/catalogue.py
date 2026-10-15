"""Entitlement keys and the seed plans.

The plan rows in the database are the authority (operators can change them);
SEED_PLANS only fills an empty table (`manage.py seed_plans`, migration 0002).
The limits below are ILLUSTRATIVE development values, not commercial terms,
and no prices are set: both are business decisions. Seeded commercial plans
are therefore created as DRAFT (never offered to customers) and only become
assignable once a platform OWNER approves and publishes them
(subscriptions/plans.py). Legacy is SYSTEM: kept for firms that predate
subscriptions, never assignable by an operator.
"""
from __future__ import annotations

GiB = 1024 ** 3

# --- keys ---------------------------------------------------------------------
# Features: on / off.
DRAFTING = 'feature.drafting'              # AI drafting workspace (generate, refine, risks)
ASSISTANT = 'feature.assistant'            # Lisa
CLIENT_PORTAL = 'feature.client_portal'    # client portal logins
DOC_SUMMARY = 'feature.document_summary'   # AI summaries of uploaded documents

# Stock limits: counted live from the real tables.
SEATS = 'seats.staff'                      # staff seats (see service.seats_used for the policy)
CASES = 'cases.total'                      # cases, not deleted
CLIENTS = 'clients.total'                  # clients, not deleted
STORAGE = 'storage.bytes'                  # document bytes incl. kept versions

# Metered limits: per calendar month, from usage events.
AI_REQUESTS = 'ai.requests.month'          # Lisa chat requests
DRAFTING_OPS = 'drafting.operations.month' # draft generations / regenerations / refinements
AI_SUMMARIES = 'ai.summaries.month'        # AI document summaries (counted; no limit set in any seed plan)

FEATURES = (DRAFTING, ASSISTANT, CLIENT_PORTAL, DOC_SUMMARY)
STOCK = (SEATS, CASES, CLIENTS, STORAGE)
METERED = (AI_REQUESTS, DRAFTING_OPS, AI_SUMMARIES)
KEYS = FEATURES + STOCK + METERED

LABELS = {
    DRAFTING: 'AI drafting', ASSISTANT: 'Lisa (AI assistant)', CLIENT_PORTAL: 'Client portal',
    DOC_SUMMARY: 'AI document summaries', SEATS: 'Staff seats', CASES: 'Cases', CLIENTS: 'Clients',
    STORAGE: 'Document storage', AI_REQUESTS: 'Lisa requests this month',
    DRAFTING_OPS: 'Drafting operations this month', AI_SUMMARIES: 'AI document summaries this month',
}
# A metered key's feature: no feature, no metering either.
FEATURE_OF = {AI_REQUESTS: ASSISTANT, DRAFTING_OPS: DRAFTING, AI_SUMMARIES: DOC_SUMMARY}


def _plan(code, name, order, *, public=False, trial_days=0, description='', limits=None, off=(), state='DRAFT'):
    limits = limits or {}
    ents = {k: {'enabled': k not in off, 'limit': None} for k in FEATURES}
    ents.update({k: {'enabled': True, 'limit': limits.get(k)} for k in STOCK + METERED})
    return {'code': code, 'name': name, 'sort_order': order, 'is_public': public, 'trial_days': trial_days,
            'description': description, 'state': state, 'family': code, 'entitlements': ents}


SEED_PLANS = [
    _plan('TRIAL', 'Trial', 10, trial_days=14, description='Try AMS for 14 days.',
          limits={SEATS: 3, CASES: 25, CLIENTS: 25, STORAGE: 1 * GiB, AI_REQUESTS: 100, DRAFTING_OPS: 20},
          off=(CLIENT_PORTAL,)),
    _plan('BASIC', 'Basic', 20, description='Case, client and billing management for a small practice.',
          limits={SEATS: 5, CASES: 500, CLIENTS: 500, STORAGE: 10 * GiB, AI_REQUESTS: 500, DRAFTING_OPS: 0},
          off=(DRAFTING,)),
    _plan('PROFESSIONAL', 'Professional', 30, description='Everything, including AI drafting.',
          limits={SEATS: 25, CASES: 5000, CLIENTS: 5000, STORAGE: 100 * GiB, AI_REQUESTS: 5000, DRAFTING_OPS: 500}),
    _plan('ENTERPRISE', 'Enterprise', 40, description='No limits.'),
    _plan('LEGACY', 'Legacy', 90, public=False, state='SYSTEM',
          description='Firms that used AMS before subscriptions: everything stays available, no limits.'),
]
# No default plan for new firms: without an approved plan chosen, a new firm's
# subscription is PENDING (nothing new can be added) until an operator assigns one.
LEGACY = 'LEGACY'


def ensure_plans(using=None, Plan=None, PlanEntitlement=None):
    """Create any missing seed plan / entitlement row. Never changes an existing
    one (an operator's edits win). Usable from a migration (pass the models)."""
    if Plan is None:
        from .models import Plan, PlanEntitlement                     # noqa: F811
    created = 0
    fields = {f.name for f in Plan._meta.get_fields()}
    for spec in SEED_PLANS:
        plan, made = Plan.objects.get_or_create(code=spec['code'], defaults={
            k: spec[k] for k in ('name', 'sort_order', 'is_public', 'trial_days', 'description', 'state', 'family')
            if k in fields})                    # migration 0002's model has no state / family yet
        created += made
        if getattr(plan, 'state', 'DRAFT') not in ('DRAFT', 'SYSTEM'):
            continue                       # approved terms are never changed here (a new key would need a revision)
        for key, e in spec['entitlements'].items():
            _, made = PlanEntitlement.objects.get_or_create(plan=plan, key=key,
                                                            defaults={'enabled': e['enabled'], 'limit': e['limit']})
            created += made
    return created
