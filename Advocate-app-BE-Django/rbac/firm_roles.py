"""Firm-level roles (SaaS Phase 3).

Global system TEMPLATES (roles.firm_id NULL, is_template) are immutable. Each
firm gets its own copies (cloned_from_id -> the template) that it may rename,
re-permission, disable; and it may create custom roles. Names are unique per
firm. Assignments (advocate_roles) carry firm_id + membership_id, and in firm
mode only the active firm's enabled roles count (core.models.Advocate.
effective_role_ids) - permissions never combine across firms.

The firm's administrator role is the clone of the Super Admin template
(is_admin): it is needed to grant high-risk permissions, can't be disabled or
deleted, keeps its admin permissions, and the last active holder can't lose it.
"""
from __future__ import annotations

import datetime
import json

from django.db import transaction

from core.models import AdvocateRole, AuditLog, Permission, Role, RolePermission

ADMIN_TEMPLATE = 'Super Admin'
CLIENT_ROLE = 'Client'
# Permissions only a firm administrator may grant, revoke or hand out via a role:
# they control who can do what, the whole firm's data, money issuing and backups.
HIGH_RISK = {'ROLE_MANAGE', 'USER_MANAGE', 'BACKUP_MANAGE', 'FIRM_WIDE_SCOPE',
             'SETTINGS_EDIT', 'INVOICE_ISSUE', 'AUDIT_VIEW'}
# What the administrator role can never lose (else the firm locks itself out).
ADMIN_CORE = {'ROLE_MANAGE', 'USER_MANAGE'}


class RoleRuleError(ValueError):
    """A role change breaks a safety rule; the message is shown to the user."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


# ------------------------------------------------------------------ queries ----
def templates():
    return Role.objects.filter(firm_id__isnull=True, is_template=True).exclude(name__iexact=CLIENT_ROLE)


def firm_roles(firm):
    return Role.objects.filter(firm_id=getattr(firm, 'id', firm))


def role_permission_names(role_id):
    ids = RolePermission.objects.filter(role_id=role_id).values_list('permission_id', flat=True)
    return set(Permission.objects.filter(id__in=list(ids)).values_list('name', flat=True))


def is_firm_admin(advocate, firm):
    fid = getattr(firm, 'id', firm)
    role_ids = AdvocateRole.objects.filter(advocate_id=advocate.id).values_list('role_id', flat=True)
    return Role.objects.filter(id__in=list(role_ids), firm_id=fid, is_admin=True, disabled=False).exists()


def active_admin_ids(firm):
    """Active STAFF members of the firm holding an enabled admin role."""
    from firms.models import FirmMembership
    fid = getattr(firm, 'id', firm)
    admin_roles = Role.objects.filter(firm_id=fid, is_admin=True, disabled=False).values('id')
    holders = set(AdvocateRole.objects.filter(role_id__in=admin_roles).values_list('advocate_id', flat=True))
    active = set(FirmMembership.objects.filter(firm_id=fid, kind=FirmMembership.STAFF,
                                               status=FirmMembership.ACTIVE).values_list('advocate_id', flat=True))
    return holders & active


def audit(actor, firm, action, title, entity_id=None, detail=None):
    """A firm-scoped audit row for a role change (who, what, before/after)."""
    AuditLog.objects.create(
        action_type=action, title=title[:255], module='RBAC', entity_type='Role', entity_id=entity_id,
        status='SUCCESS', user_name=getattr(actor, 'email', None), metadata=json.dumps(detail or {}, default=str),
        created_at=datetime.datetime.now(), advocate_id=getattr(actor, 'id', None),
        firm_id=getattr(firm, 'id', firm))


# ------------------------------------------------------------- provisioning ----
def _copy_permissions(src_id, dst_id):
    perm_ids = list(RolePermission.objects.filter(role_id=src_id).values_list('permission_id', flat=True))
    RolePermission.objects.bulk_create([RolePermission(role_id=dst_id, permission_id=p,
                                                       created_at=datetime.datetime.now()) for p in perm_ids])


@transaction.atomic
def provision_default_roles(firm):
    """Give a firm its own copy of every system template. Idempotent: an
    existing copy (matched by cloned_from_id) is kept as the firm left it.
    Returns {template_id: firm_role}. Used by apply_firm_roles and, later,
    by platform onboarding."""
    out = {}
    fid = getattr(firm, 'id', firm)
    for t in templates():
        role = Role.objects.filter(firm_id=fid, cloned_from_id=t.id).first()
        if role is None:
            role = Role.objects.create(name=t.name, description=t.description, created_at=datetime.datetime.now(),
                                       firm_id=fid, is_template=False, cloned_from_id=t.id,
                                       is_admin=t.name.strip().lower() == ADMIN_TEMPLATE.lower(), disabled=False)
            _copy_permissions(t.id, role.id)
        out[t.id] = role
    return out


def clone_role(source, firm, name, actor=None):
    """A new firm role copying `source` (a template or one of the firm's roles)."""
    fid = getattr(firm, 'id', firm)
    if source.firm_id not in (None, fid):
        raise RoleRuleError('Role not found', 404)
    validate_name(firm, name)
    with transaction.atomic():
        role = Role.objects.create(name=name.strip(), description=source.description,
                                   created_at=datetime.datetime.now(), firm_id=fid, is_template=False,
                                   cloned_from_id=source.cloned_from_id or source.id, is_admin=False, disabled=False)
        _copy_permissions(source.id, role.id)
    if actor is not None:
        check_can_grant(actor, firm, role_permission_names(role.id))
    return role


def validate_name(firm, name, exclude_id=None):
    name = (name or '').strip()
    if not name:
        raise RoleRuleError('Give the role a name.')
    if name.lower() == CLIENT_ROLE.lower():
        raise RoleRuleError('A role with that name already exists.', 409)
    qs = firm_roles(firm).filter(name__iexact=name)
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    if qs.exists():
        raise RoleRuleError('A role with that name already exists.', 409)
    return name


# ------------------------------------------------------------------ guards -----
def check_can_grant(actor, firm, codes):
    """An actor may only put permissions they hold themselves into a role (no
    escalation), and only a firm administrator may grant high-risk ones."""
    held = actor.permission_codes()
    missing = set(codes) - held
    if missing:
        raise RoleRuleError(f'You can only grant permissions you hold yourself: {", ".join(sorted(missing))}.', 403)
    risky = set(codes) & HIGH_RISK
    if risky and not is_firm_admin(actor, firm):
        raise RoleRuleError(f'Only a firm administrator can grant {", ".join(sorted(risky))}.', 403)


def set_role_permissions(actor, firm, role, permission_ids):
    """Replace a firm role's permissions under the safety rules; audited."""
    if role.firm_id != getattr(firm, 'id', firm):
        raise RoleRuleError('Role not found', 404)
    new = set(Permission.objects.filter(id__in=permission_ids).values_list('name', flat=True))
    old = role_permission_names(role.id)
    changed = new ^ old
    # Adding or removing a permission both need the right to grant it.
    check_can_grant(actor, firm, changed)
    if role.is_admin and ADMIN_CORE - new:
        raise RoleRuleError('The firm administrator role must keep ROLE_MANAGE and USER_MANAGE.', 409)
    with transaction.atomic():
        RolePermission.objects.filter(role_id=role.id).delete()
        RolePermission.objects.bulk_create([RolePermission(role_id=role.id, permission_id=p,
                                                           created_at=datetime.datetime.now())
                                            for p in sorted(set(permission_ids))])
        audit(actor, firm, 'UPDATE', f'Permissions of role "{role.name}" changed', role.id,
              {'added': sorted(new - old), 'removed': sorted(old - new)})


def check_assignable(actor, firm, role):
    """May `actor` hand `role` to someone in their firm?"""
    if role.firm_id != getattr(firm, 'id', firm) or role.disabled:
        raise RoleRuleError('Role not found', 404)
    if role.is_admin and not is_firm_admin(actor, firm):
        raise RoleRuleError('Only a firm administrator can assign the administrator role.', 403)
    check_can_grant(actor, firm, role_permission_names(role.id))


def check_removable(actor, firm, advocate_id, role):
    """Removing `role` from someone must not leave the firm without an active
    administrator (this also stops the last admin demoting themselves)."""
    if role.firm_id != getattr(firm, 'id', firm):
        raise RoleRuleError('Role not found', 404)
    if role.is_admin and active_admin_ids(firm) <= {advocate_id}:
        raise RoleRuleError('This is the last active firm administrator. Make someone else an '
                            'administrator first.', 409)
    if role.is_admin and not is_firm_admin(actor, firm):
        raise RoleRuleError('Only a firm administrator can remove the administrator role.', 403)
    check_can_grant(actor, firm, role_permission_names(role.id) & HIGH_RISK)


def membership_id(firm, advocate_id):
    from firms.models import FirmMembership
    return (FirmMembership.objects.filter(firm_id=getattr(firm, 'id', firm), advocate_id=advocate_id)
            .values_list('id', flat=True).first())


# --------------------------------------------------------- data migration ----
def repoint_assignments(firm, clones):
    """Point the firm's members' template assignments at the firm's copies, and
    stamp firm_id / membership_id. The Client role stays global (portal)."""
    from firms.models import FirmMembership
    fid = getattr(firm, 'id', firm)
    members = dict(FirmMembership.objects.filter(firm_id=fid).values_list('advocate_id', 'id'))
    moved = 0
    for ar in AdvocateRole.objects.filter(advocate_id__in=list(members)):
        clone = clones.get(ar.role_id)
        changes = {'firm_id': fid, 'membership_id': members[ar.advocate_id]}
        if clone is not None:
            changes['role_id'] = clone.id
            moved += 1
        AdvocateRole.objects.filter(id=ar.id).update(**changes)
    return moved
