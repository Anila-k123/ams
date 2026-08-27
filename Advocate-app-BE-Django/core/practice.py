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
