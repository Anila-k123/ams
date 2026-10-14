"""Mapping existing practices onto firms: shared by plan_tenancy, apply_tenancy
and verify_tenancy.

A mapping file (JSON, ids only - no personal data) says which practice roots
form which firm. Nothing is guessed: an identity not covered by the mapping
stays UNRESOLVED (no membership, its rows keep firm_id NULL) until someone
decides. Example: firms/tenancy_mapping.example.json.

    {"firms": [{"key": "a", "name": "...", "slug": "...", "roots": [1]},
               {"key": "b", "name": "...", "slug": "...", "roots": [68, 70]}],
     "unresolved": [4, 28, 36, 37, 41, 42, 61]}
"""
from __future__ import annotations

import json
from collections import defaultdict

from django.apps import apps

# Tenant-owned models and the column that says who created the row. A row's
# firm is its creator's firm (FirmMembership).
OWNED = [
    ('core.Client', 'advocate_id'), ('core.Case', 'advocate_id'),
    ('core.CaseEvent', 'advocate_id'), ('core.Document', 'advocate_id'),
    ('core.Expense', 'advocate_id'), ('core.Invoice', 'advocate_id'),
    ('core.ClientPayment', 'advocate_id'), ('core.AuditLog', 'advocate_id'),
    ('core.NotificationQueue', 'advocate_id'), ('core.Notification', 'advocate_id'),
    ('workspace.CaseNote', 'advocate_id'), ('workspace.CaseTask', 'advocate_id'),
    ('invoices.FirmBillingProfile', 'advocate_id'), ('invoices.InvoiceRequest', 'requested_by_id'),
    ('drafting.Template', 'created_by_id'), ('drafting.Playbook', 'created_by_id'),
    ('drafting.Sample', 'uploaded_by_id'), ('drafting.DraftSession', 'created_by_id'),
]
# Tenant-owned models whose firm comes from a parent row instead.
DERIVED = [
    ('drafting.LibraryClause', 'source_sample_id', 'drafting.Sample'),
    ('drafting.Client', 'ams_client_id', 'core.Client'),
    ('drafting.Project', 'client_id', 'drafting.Client'),
]
# Shared drafting rows with no owner of their own and no AMS link: they take the
# firm of the rows that USE them, but only when every user is in one firm.
USED_BY = [
    ('drafting.Client', [('drafting.DraftSession', 'client_id'), ('drafting.Sample', 'client_id'),
                         ('drafting.Project', 'client_id')]),
    ('drafting.Project', [('drafting.DraftSession', 'project_id'), ('drafting.Sample', 'project_id')]),
]
# Parent/child pairs whose firms must agree (child column -> parent model).
CONSISTENCY = [
    ('core.Case', 'client_id', 'core.Client'),
    ('core.CaseEvent', 'case_id', 'core.Case'),
    ('core.Document', 'case_id', 'core.Case'), ('core.Document', 'client_id', 'core.Client'),
    ('core.Expense', 'case_id', 'core.Case'), ('core.Invoice', 'case_id', 'core.Case'),
    ('core.ClientPayment', 'case_id', 'core.Case'),
    ('workspace.CaseTask', 'case_id', 'core.Case'), ('workspace.CaseNote', 'case_id', 'core.Case'),
    ('invoices.InvoiceRequest', 'case_id', 'core.Case'),
]


class MappingError(ValueError):
    pass


def load_mapping(path):
    with open(path, encoding='utf-8') as fh:
        data = json.load(fh)
    firms = data.get('firms') or []
    if not firms:
        raise MappingError('The mapping lists no firms.')
    keys, slugs = set(), set()
    for f in firms:
        for field in ('key', 'name', 'slug', 'roots'):
            if not f.get(field):
                raise MappingError(f'Firm entry {f!r} needs {field}.')
        if f['key'] in keys or f['slug'] in slugs:
            raise MappingError(f'Duplicate firm key or slug: {f["key"]} / {f["slug"]}.')
        keys.add(f['key'])
        slugs.add(f['slug'])
    data.setdefault('unresolved', [])
    return data


def build_plan(mapping):
    """Who goes where, from the mapping and the current data. Read-only."""
    Advocate = apps.get_model('core', 'Advocate')
    ClientUser = apps.get_model('clientaccess', 'ClientUser')
    Client = apps.get_model('core', 'Client')

    people = {a['id']: a for a in Advocate.objects.values('id', 'parent_advocate_id', 'left_on')}
    client_logins = dict(ClientUser.objects.values_list('advocate_id', 'client_id'))
    client_owner = dict(Client.objects.values_list('id', 'advocate_id'))

    staff_firm, problems = {}, []
    firms = []
    for f in mapping['firms']:
        roots = [int(r) for r in f['roots']]
        members = set(roots) | {int(m) for m in f.get('extra_members', [])}
        members |= {a for a, p in people.items() if p['parent_advocate_id'] in roots}
        members -= set(client_logins)
        for r in roots:
            if r not in people:
                problems.append(f'firm {f["key"]}: root {r} does not exist')
        for m in members:
            if m in staff_firm and staff_firm[m] != f['key']:
                problems.append(f'identity {m} is mapped to two firms ({staff_firm[m]}, {f["key"]})')
            staff_firm[m] = f['key']
        firms.append({**f, 'roots': roots, 'staff': sorted(members)})

    client_firm = {}
    for adv_id, client_id in client_logins.items():
        owner = client_owner.get(client_id)
        if owner in staff_firm:
            client_firm[adv_id] = staff_firm[owner]
    declared = {int(x) for x in mapping.get('unresolved', [])}
    # Declaring a practice root unresolved covers the people in its team too.
    declared |= {a for a, p in people.items() if p['parent_advocate_id'] in declared}
    unmapped = sorted(set(people) - set(staff_firm) - set(client_firm))
    unlisted = sorted(set(unmapped) - declared)
    if unlisted:
        problems.append(f'identities neither mapped nor declared unresolved: {unlisted}')
    for d in sorted(declared & set(staff_firm)):
        problems.append(f'identity {d} is declared unresolved but also mapped')
    return {'firms': firms, 'staff_firm': staff_firm, 'client_firm': client_firm,
            'unresolved': unmapped, 'problems': problems, 'people': people}


def owner_firm_counts(plan):
    """Rows per firm per owned table, from the plan (before anything is applied)."""
    out = {}
    for label, column in OWNED:
        model = apps.get_model(label)
        counts = defaultdict(int)
        for owner in model.objects.values_list(column, flat=True):
            counts[plan['staff_firm'].get(owner) or plan['client_firm'].get(owner) or 'UNRESOLVED'] += 1
        out[label] = dict(counts)
    return out


def cross_firm_references(plan):
    """Parent/child pairs whose owners would land in different firms."""
    found = []
    firm_of = lambda owner: plan['staff_firm'].get(owner) or plan['client_firm'].get(owner)  # noqa: E731
    owner_col = dict(OWNED)
    for child_label, column, parent_label in CONSISTENCY:
        child, parent = apps.get_model(child_label), apps.get_model(parent_label)
        parent_owner = dict(parent.objects.values_list('id', owner_col[parent_label]))
        for pk, owner, ref in child.objects.values_list('id', owner_col[child_label], column):
            if ref is None or ref not in parent_owner:
                continue
            a, b = firm_of(owner), firm_of(parent_owner[ref])
            if a and b and a != b:
                found.append({'table': child_label, 'id': pk, 'column': column, 'child_firm': a, 'parent_firm': b})
    return found


def suggest_mapping():
    """A DRAFT mapping for this database, for a person to review - never applied
    automatically. Account ids differ between developers' databases, so every
    developer drafts and approves their own.

    Rules, deliberately conservative:
    - practice roots that share a GSTIN or office name are grouped into one firm;
    - a group becomes a firm only if it holds business data or a Super Admin;
    - every other identity is listed as unresolved (its root covers its team).
    """
    Advocate = apps.get_model('core', 'Advocate')
    ClientUser = apps.get_model('clientaccess', 'ClientUser')
    AdvocateRole = apps.get_model('core', 'AdvocateRole')
    Role = apps.get_model('core', 'Role')
    Case = apps.get_model('core', 'Case')
    Client = apps.get_model('core', 'Client')

    client_logins = set(ClientUser.objects.values_list('advocate_id', flat=True))
    people = {a['id']: a for a in Advocate.objects.values('id', 'parent_advocate_id', 'office_name', 'gst_number')}
    roots = sorted(a for a, p in people.items() if p['parent_advocate_id'] is None and a not in client_logins)
    admin_role = set(Role.objects.filter(name__iexact='Super Admin').values_list('id', flat=True))
    admins = set(AdvocateRole.objects.filter(role_id__in=admin_role).values_list('advocate_id', flat=True))
    team = lambda r: {r} | {a for a, p in people.items() if p['parent_advocate_id'] == r}  # noqa: E731
    with_data = set(Case.objects.values_list('advocate_id', flat=True)) | \
        set(Client.objects.values_list('advocate_id', flat=True))

    # Union roots sharing a GSTIN or office name.
    group_of = {r: {r} for r in roots}
    for key in ('gst_number', 'office_name'):
        seen = {}
        for r in roots:
            v = ' '.join((people[r][key] or '').split()).lower()
            if not v:
                continue
            if v in seen:
                merged = group_of[seen[v]] | group_of[r]
                for x in merged:
                    group_of[x] = merged
            else:
                seen[v] = r
    groups, done = [], set()
    for r in roots:
        g = frozenset(group_of[r])
        if g not in done:
            done.add(g)
            groups.append(sorted(g))

    firms, unresolved = [], []
    for g in groups:
        members = set().union(*(team(r) for r in g))
        if members & (with_data | admins):
            head = next((r for r in g if r in admins), g[0])
            firms.append({'key': f'firm-{head}', 'name': people[head]['office_name'] or f'Firm {head}',
                          'slug': f'firm-{head}', 'roots': [head] + [r for r in g if r != head],
                          '_why': ('shares GSTIN/office name' if len(g) > 1 else 'single practice')
                                  + (', has data' if members & with_data else '')
                                  + (', has Super Admin' if members & admins else '')})
        else:
            unresolved.extend(g)
    return {'_comment': 'DRAFT generated by plan_tenancy --suggest. Review every entry; names and '
                        'groupings are guesses from shared GSTIN/office name and data. Move a root '
                        'between firms or to unresolved as needed. Ids are specific to THIS database.',
            'firms': firms, 'unresolved': sorted(unresolved)}
