"""Helpers for building test fixtures against the Spring-owned schema.

Creating a usable advocate is more than one INSERT: permissions resolve through
advocate_roles -> role_permissions -> permissions, so an advocate with no role
gets 403 from every gated endpoint however senior their `role` string looks.
Without this, each test file would reinvent that four-table dance and they would
drift apart.

Import from tests only. Nothing here is used by the application.
"""

from __future__ import annotations

import datetime
import itertools

from core.models import (Advocate, AdvocateRole, Case, Client, Permission,
                         Role, RolePermission)

_counter = itertools.count(1)


def make_advocate(email=None, permissions=(), parent_advocate_id=None, **extra):
    """An advocate that can actually call the API.

    permissions: codes to grant, e.g. ('INVOICE_VIEW',). Pass ALL_PERMISSIONS
    for an admin-style account. An empty tuple is deliberate for tests that
    check a gate rejects.
    """
    n = next(_counter)
    email = email or 'advocate%d@test.local' % n
    advocate = Advocate.objects.create(
        full_name=extra.pop('full_name', 'Test Advocate %d' % n),
        email=email,
        password=extra.pop('password', 'hashed-not-a-real-password'),
        bar_council_id=extra.pop('bar_council_id', 'BC-TEST-%d' % n),
        role=extra.pop('role', 'ADVOCATE'),
        theme='light',
        whatsapp_enabled=False,
        email_notifications_enabled=True,
        browser_notifications_enabled=True,
        parent_advocate_id=parent_advocate_id,
        **extra)
    if permissions:
        grant(advocate, permissions)
    return advocate


def grant(advocate, codes):
    """Give one advocate these permission codes, via a role."""
    now = datetime.datetime.now()
    role = Role.objects.create(
        name='Test Role %d' % next(_counter),
        description='created by core.testing.grant', created_at=now)
    AdvocateRole.objects.create(advocate_id=advocate.id, role_id=role.id,
                                created_at=datetime.datetime.now())
    for code in codes:
        perm, _ = Permission.objects.get_or_create(
            name=code, defaults={'description': code, 'module': 'TEST',
                                 'created_at': now})
        RolePermission.objects.create(role_id=role.id, permission_id=perm.id,
                                      created_at=now)
    return role


def auth(advocate):
    """Headers for an authenticated request as this advocate."""
    from core.jwt import generate_token
    return {'HTTP_AUTHORIZATION': 'Bearer ' + generate_token(advocate)}


def make_client(advocate, name='Test Client', **extra):
    return Client.objects.create(
        name=name, deleted=False, advocate_id=advocate.id, **extra)


def make_case(advocate, client=None, case_number=None, **extra):
    """A case. case_number is globally unique in the schema, so it is generated."""
    n = next(_counter)
    return Case.objects.create(
        case_number=case_number or 'TEST/%d/2026' % n,
        case_title=extra.pop('case_title', 'Test Case %d' % n),
        status=extra.pop('status', 'Active'),
        deleted=False,
        advocate_id=advocate.id,
        client=client or make_client(advocate),
        **extra)


# Every permission code the API gates on. Used for tests that are about
# something other than permissions and just need to get through the door.
ALL_PERMISSIONS = (
    'CASE_VIEW', 'CASE_CREATE', 'CASE_EDIT', 'CASE_DELETE',
    'CLIENT_VIEW', 'CLIENT_CREATE', 'CLIENT_EDIT', 'CLIENT_DELETE',
    'INVOICE_VIEW', 'INVOICE_CREATE', 'INVOICE_EDIT', 'INVOICE_DELETE',
    'PAYMENT_VIEW', 'PAYMENT_CREATE',
    'EXPENSE_VIEW', 'EXPENSE_CREATE', 'EXPENSE_EDIT', 'EXPENSE_DELETE',
    'DOCUMENT_VIEW', 'DOCUMENT_UPLOAD', 'DOCUMENT_DELETE',
    'EVENT_VIEW', 'EVENT_CREATE', 'EVENT_EDIT', 'EVENT_DELETE',
    'REPORT_VIEW', 'AUDIT_VIEW', 'BACKUP_MANAGE',
    'USER_MANAGE', 'ROLE_MANAGE',
)
