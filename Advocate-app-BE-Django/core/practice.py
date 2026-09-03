"""Who shares data with whom.

Until now every query was scoped to `advocate_id = request.user.id`, so each
login saw only rows it had created itself. That made the RBAC work meaningless
in practice: a junior account could be granted CASE_READ and still see an empty
application, because none of the firm's cases were its own.

A practice is modelled with one nullable column on `advocate`:

    parent_advocate_id NULL  ->  this advocate owns a practice (or works alone)
    parent_advocate_id = N   ->  this advocate is a member of N's practice

Deliberately one level deep. A member cannot have members of their own; a
practice is a flat list of people around one owner, which is what a chambers
actually looks like and avoids recursive scope resolution on every request.

Why a column on `advocate` rather than practice_id on every business table:
adding it to clients, cases, invoices and the rest would mean a DDL change and
a backfill on ten Spring-owned tables, and every existing row would need a
value. This way the existing data is untouched - rows keep the advocate_id they
already have, and membership decides who can reach them.

`advocate_id` therefore keeps meaning "who created this", which is why no
created_by column is needed: it would have held the same value.
"""

from __future__ import annotations

from core.models import Advocate

# Cached on the user object, which the JWT auth builds per request, so a
# request with 30 queries resolves membership once.
_CACHE_ATTR = '_practice_ids_cache'

# Firm-wide scope: some roles are not team-bound. FIRM_WIDE_SCOPE (seeded by
# `manage.py seed_firm_wide_scope`) widens visibility to the whole firm; a
# user's OTHER permissions still decide what they may open. The role-name set is
# a fallback for before the permission is seeded.
FIRM_WIDE_PERMISSION = 'FIRM_WIDE_SCOPE'
FIRM_WIDE_ROLES = {'Super Admin', 'Accountant', 'Receptionist'}
SUPER_ADMIN_ROLE = 'Super Admin'


def _perm_codes(advocate, cache=None):
    """This advocate's permission code set, optionally memoised in `cache`
    (a dict keyed by advocate id) so a fan-out over many cases resolves each
    person's permissions once."""
    if cache is not None and advocate.id in cache:
        return cache[advocate.id]
    try:
        codes = advocate.permission_codes()
    except Exception:                                        # noqa: BLE001
        codes = set()
    if cache is not None:
        cache[advocate.id] = codes
    return codes


def has_firm_wide_scope(user):
    """True when this user sees across every team (Super Admin / Accountant /
    Receptionist), by the FIRM_WIDE_SCOPE permission or the role-name fallback."""
    try:
        if FIRM_WIDE_PERMISSION in user.permission_codes():
            return True
    except Exception:                                        # noqa: BLE001
        pass
    try:
        return bool(set(user.role_names()) & FIRM_WIDE_ROLES)
    except Exception:                                        # noqa: BLE001
        return False


def practice_root(user):
    """The id of the advocate who owns this user's practice."""
    return getattr(user, 'parent_advocate_id', None) or user.id


def practice_ids(user):
    """Every advocate id whose rows this user may reach.

    A solo advocate gets [their own id], so behaviour is unchanged for anyone
    not part of a practice.
    """
    if user is None or getattr(user, 'id', None) is None:
        return []
    cached = getattr(user, _CACHE_ATTR, None)
    if cached is not None:
        return cached

    root = practice_root(user)
    ids = {root, user.id}
    try:
        if has_firm_wide_scope(user):
            # Firm-wide roles (Super Admin, and the common Accountant/
            # Receptionist) span every team; their other permissions still gate
            # what they can actually open.
            ids = set(Advocate.objects.values_list('id', flat=True))
        else:
            # Deliberately NOT filtered on left_on: a former member's work
            # belongs to the practice, so their id stays in scope after they
            # leave. They lose access at authentication, not by having their
            # rows hidden.
            ids.update(
                Advocate.objects.filter(parent_advocate_id=root)
                .values_list('id', flat=True))
    except Exception:                                        # noqa: BLE001
        # If the column is missing (the DDL command has not been run yet) fall
        # back to the old single-advocate scope rather than failing the request.
        ids = {user.id}

    out = sorted(ids)
    try:
        setattr(user, _CACHE_ATTR, out)
    except Exception:                                        # noqa: BLE001
        pass
    return out


def members(root_id):
    """The advocates in one practice, owner first."""
    owner = Advocate.objects.filter(id=root_id).first()
    rest = list(Advocate.objects.filter(parent_advocate_id=root_id)
                .order_by('full_name'))
    return ([owner] if owner else []) + rest


def is_owner(user):
    return getattr(user, 'parent_advocate_id', None) is None


def has_left(user):
    """True when this advocate has left their practice and cannot sign in."""
    return getattr(user, 'left_on', None) is not None


def mark_left(advocate, on=None):
    """Record that an advocate has left, WITHOUT unlinking them.

    The membership is deliberately kept. practice_ids() is derived from who is
    in the practice, so clearing parent_advocate_id made every row the member
    had created unreachable - the practice lost its own case files while the
    rows sat in the database untouched. Keeping the link means the work stays;
    the account losing access is what actually ends their involvement.
    """
    import datetime

    from core.models import Advocate
    when = on or datetime.date.today()
    Advocate.objects.filter(id=advocate.id).update(left_on=when)
    advocate.left_on = when
    # The cached scope may have been computed while they were active.
    if hasattr(advocate, _CACHE_ATTR):
        delattr(advocate, _CACHE_ATTR)
    return when


def reinstate(advocate):
    """Undo mark_left. Their membership was never removed, so this is enough."""
    from core.models import Advocate
    Advocate.objects.filter(id=advocate.id).update(left_on=None)
    advocate.left_on = None
    if hasattr(advocate, _CACHE_ATTR):
        delattr(advocate, _CACHE_ATTR)


def active_members(root_id):
    """Members who have not left - for showing a practice's current people."""
    return list(Advocate.objects.filter(parent_advocate_id=root_id,
                                        left_on__isnull=True)
                .order_by('full_name'))


def alert_members(advocate, permission=None, perm_cache=None):
    """The people on `advocate`'s team to notify, owner first.

    This is the "same loop" rule for alerts. `advocate` is normally a case owner
    (Case.advocate); a case is created by one advocate but belongs to the whole
    team, so a reminder about it goes to everyone currently in that team. Former
    members are excluded - they can no longer sign in. A solo advocate gets just
    themselves, so single-advocate behaviour is unchanged.

    When `permission` is given, only members whose role grants it are kept, so
    an alert reaches only the people it is relevant to (a hearing alert goes to
    those with CASE_VIEW, not to a receptionist on the same team).
    """
    root = practice_root(advocate)
    owner = Advocate.objects.filter(id=root).first()
    ordered = ([owner] if owner else []) + active_members(root)
    seen, unique = set(), []
    for member in ordered:
        if not member or member.id in seen:
            continue
        seen.add(member.id)
        if permission and permission not in _perm_codes(member, perm_cache):
            continue
        unique.append(member)
    return unique


def firm_wide_members(permission=None, perm_cache=None):
    """Common staff who serve every team - for firm-wide alerts.

    These are the shared roles (Accountant, Receptionist): an overdue invoice is
    the firm's accountant's concern whichever team it belongs to, so a firm-wide
    alert reaches them across all teams. `permission` narrows to those it is
    relevant to (INVOICE_VIEW -> the accountants).

    The Super Admin is deliberately excluded: they can SEE everything but are not
    put on every team's alert loop, so their bell/inbox is not firm-wide noise.
    """
    out = []
    for advocate in Advocate.objects.filter(left_on__isnull=True):
        try:
            roles = set(advocate.role_names())
        except Exception:                                    # noqa: BLE001
            roles = set()
        if SUPER_ADMIN_ROLE in roles:
            continue
        codes = _perm_codes(advocate, perm_cache)
        if FIRM_WIDE_PERMISSION not in codes and not (roles & FIRM_WIDE_ROLES):
            continue
        if permission and permission not in codes:
            continue
        out.append(advocate)
    return out
