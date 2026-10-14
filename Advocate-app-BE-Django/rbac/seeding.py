"""Which roles a deploy-time permission seed (seed_*_permissions) changes.

Before firm-level RBAC there was one shared row per role name, so the seeds
looked a role up by name with `.first()`. Since Phase 3 each firm has its own
copy of every system role (cloned_from_id -> the template), possibly renamed,
plus the template itself (firm_id NULL, is_template). `.first()` then updated
one arbitrary row and every other firm silently missed the permission - which
is how INVOICE_ISSUE was missing for every firm administrator.

seed_roles(name) returns the system role of that name and every firm role
cloned from it (whatever the firm renamed it to); on a database without firm
RBAC (legacy rows, no templates), every role of that name.
"""
from django.db.models import Q

from core.models import Role


def seed_roles(name):
    templates = list(Role.objects.filter(name=name, firm_id__isnull=True))
    if not templates:
        return list(Role.objects.filter(name=name))
    ids = [t.id for t in templates]
    return list(Role.objects.filter(Q(id__in=ids) | Q(cloned_from_id__in=ids)).order_by('id'))


def template_roles(name):
    """Only the system rows of `name` (for revocations: a firm's own copy is
    the firm's to change, a deploy must not take permissions away from it)."""
    rows = list(Role.objects.filter(name=name, firm_id__isnull=True))
    return rows or list(Role.objects.filter(name=name))
