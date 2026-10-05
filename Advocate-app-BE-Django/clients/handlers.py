"""The handling advocate named when a client is added (see ClientHandler).

Whoever adds the client (the advocate who met them, senior or junior)
picks the advocate who will take the matter. That advocate is told at once (in-app + email). The case
details reach them outside the app for now, so no case is created here.
"""

from core.models import Advocate
from core.practice import active_members, firm_team_roots, has_firm_wide_scope, practice_root
from notifications import internal_events

from .models import ClientHandler

# Only people who can open the case once the details arrive may be picked;
# an accountant or intern can't take a matter.
HANDLER_PERMISSION = 'CASE_CREATE'


def candidates(user):
    """Active people who can take a client's case: the user's own team, or for
    firm-wide staff (Super Admin) every team of the firm."""
    roots = firm_team_roots(user) if has_firm_wide_scope(user) else [practice_root(user)]
    people = []
    for root in roots:
        people += list(Advocate.objects.filter(id=root, left_on__isnull=True)) + active_members(root)
    seen, out = set(), []
    for p in people:
        if p.id in seen:
            continue
        seen.add(p.id)
        try:
            if HANDLER_PERMISSION in p.permission_codes():
                out.append(p)
        except Exception:                                    # noqa: BLE001
            continue
    return out


def resolve(user, advocate_id):
    """The chosen advocate if they're a valid pick for this user, else None."""
    try:
        aid = int(advocate_id)
    except (TypeError, ValueError):
        return None
    return next((p for p in candidates(user) if p.id == aid), None)


def assign(actor, client, advocate):
    """Record `advocate` as the client's handler and notify them.

    Returns True when the handler changed. Re-saving the same handler sends
    nothing, so editing a client's phone number doesn't re-announce them."""
    row = ClientHandler.objects.filter(client_id=client.id).first()
    if row and row.advocate_id == advocate.id:
        return False
    ClientHandler.objects.update_or_create(
        client_id=client.id,
        defaults={'advocate_id': advocate.id, 'assigned_by_id': getattr(actor, 'id', None)})
    internal_events.client_assigned(actor, client, advocate)
    return True


def clear(client):
    ClientHandler.objects.filter(client_id=client.id).delete()


def handler_map(client_ids):
    """{client_id: {'id', 'name'}} for many clients in two queries."""
    rows = list(ClientHandler.objects.filter(client_id__in=list(client_ids)))
    names = dict(Advocate.objects.filter(id__in={r.advocate_id for r in rows})
                 .values_list('id', 'full_name'))
    return {r.client_id: {'id': r.advocate_id, 'name': names.get(r.advocate_id) or ''}
            for r in rows}
