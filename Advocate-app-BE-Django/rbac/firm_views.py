"""Role administration in firm mode (firm-level RBAC). Same URLs as rbac/views.py,
which delegates here when TENANCY_MODE is 'firm'.

Every lookup is limited to the caller's firm (core.tenant.resolve_firm): another
firm's role is answered 404, a system template is readable but never writable.
Safety rules live in rbac/firm_roles.py.
"""
from django.db import transaction
from rest_framework import status
from rest_framework.response import Response

from core import tenant
from core.models import AdvocateRole, Permission, Role, RolePermission

from . import firm_roles as fr

NOT_FOUND = {'error': 'Role not found'}


def _error(exc):
    return Response({'error': str(exc)}, status=exc.status)


def _role_map(r, member_counts=None):
    template = r.firm_id is None
    return {'id': r.id, 'name': r.name, 'description': r.description,
            'builtIn': template, 'editable': not template, 'template': template,
            'isAdmin': bool(r.is_admin), 'disabled': bool(r.disabled),
            'clonedFromId': r.cloned_from_id,
            'memberCount': (member_counts or {}).get(r.id, 0)}


def _own_role(firm, role_id, allow_template=False):
    role = Role.objects.filter(id=role_id).first()
    if role is None or (role.firm_id is None and role.name.lower() == fr.CLIENT_ROLE.lower()):
        return None
    if role.firm_id == firm.id or (allow_template and role.firm_id is None and role.is_template):
        return role
    return None


def list_roles(request):
    firm = tenant.resolve_firm(request.user)
    if request.method == 'GET':
        if request.query_params.get('templates') in ('1', 'true'):
            return Response([_role_map(r) for r in fr.templates().order_by('id')])
        roles = list(fr.firm_roles(firm).order_by('id'))
        counts = {}
        for rid in AdvocateRole.objects.filter(role_id__in=[r.id for r in roles]).values_list('role_id', flat=True):
            counts[rid] = counts.get(rid, 0) + 1
        return Response([_role_map(r, counts) for r in roles])
    # POST: a custom role, optionally cloned from a template or one of the firm's roles.
    if 'ROLE_MANAGE' not in request.user.permission_codes():
        return Response({'error': 'Access denied: missing required permission.'}, status=status.HTTP_403_FORBIDDEN)
    try:
        source_id = request.data.get('cloneFrom')
        if source_id:
            source = _own_role(firm, source_id, allow_template=True)
            if source is None:
                return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
            with transaction.atomic():
                role = fr.clone_role(source, firm, request.data.get('name'), actor=request.user)
        else:
            name = fr.validate_name(firm, request.data.get('name'))
            with transaction.atomic():
                role = Role.objects.create(name=name, description=request.data.get('description') or '',
                                           firm_id=firm.id, is_template=False, is_admin=False, disabled=False)
                ids = request.data.get('permissionIds') or []
                if ids:
                    fr.set_role_permissions(request.user, firm, role, [int(i) for i in ids])
        fr.audit(request.user, firm, 'CREATE', f'Role "{role.name}" created', role.id,
                 {'clonedFrom': role.cloned_from_id})
    except fr.RoleRuleError as exc:
        return _error(exc)
    return Response(_role_map(role), status=status.HTTP_201_CREATED)


def clone(request, role_id):
    return list_roles(_with(request, {'cloneFrom': role_id, 'name': request.data.get('name')}))


def _with(request, data):
    request._full_data = data
    return request


def role_detail(request, role_id):
    firm = tenant.resolve_firm(request.user)
    role = _own_role(firm, role_id, allow_template=request.method == 'GET')
    if role is None:
        if request.method != 'GET' and Role.objects.filter(id=role_id, firm_id__isnull=True, is_template=True).exists():
            return Response({'error': 'System role templates can\'t be changed. Clone one for your firm.'},
                            status=status.HTTP_403_FORBIDDEN)
        return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'GET':
        return Response(_role_map(role))
    try:
        if request.method == 'PUT':
            before = {'name': role.name, 'description': role.description, 'disabled': role.disabled}
            if 'name' in request.data and request.data.get('name') is not None:
                role.name = fr.validate_name(firm, request.data.get('name'), exclude_id=role.id)
            if 'description' in request.data:
                role.description = request.data.get('description') or ''
            if 'disabled' in request.data:
                disabled = bool(request.data.get('disabled'))
                if disabled and role.is_admin:
                    raise fr.RoleRuleError('The firm administrator role can\'t be disabled.', 409)
                if disabled != role.disabled:
                    fr.check_can_grant(request.user, firm, fr.role_permission_names(role.id) & fr.HIGH_RISK)
                role.disabled = disabled
            role.save()
            fr.audit(request.user, firm, 'UPDATE', f'Role "{role.name}" updated', role.id,
                     {'before': before, 'after': {'name': role.name, 'description': role.description,
                                                  'disabled': role.disabled}})
            return Response(_role_map(role))
        # DELETE: only an unused, non-administrator firm role.
        if role.is_admin:
            raise fr.RoleRuleError('The firm administrator role can\'t be deleted.', 409)
        assigned = AdvocateRole.objects.filter(role_id=role.id).count()
        if assigned:
            raise fr.RoleRuleError(f'This role is still assigned to {assigned} user(s). '
                                   'Remove those assignments first, or disable the role.', 409)
        with transaction.atomic():
            RolePermission.objects.filter(role_id=role.id).delete()
            role.delete()
            fr.audit(request.user, firm, 'DELETE', f'Role "{role.name}" deleted', role_id)
        return Response({'message': 'Role deleted.'})
    except fr.RoleRuleError as exc:
        return _error(exc)


def role_permissions(request, role_id):
    firm = tenant.resolve_firm(request.user)
    role = _own_role(firm, role_id, allow_template=request.method == 'GET')
    if role is None:
        if request.method != 'GET' and Role.objects.filter(id=role_id, firm_id__isnull=True, is_template=True).exists():
            return Response({'error': 'System role templates can\'t be changed. Clone one for your firm.'},
                            status=status.HTTP_403_FORBIDDEN)
        return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'GET':
        ids = RolePermission.objects.filter(role_id=role.id).values_list('permission_id', flat=True)
        perms = Permission.objects.filter(id__in=list(ids)).order_by('module', 'name')
        return Response([{'id': p.id, 'name': p.name, 'description': p.description, 'module': p.module}
                         for p in perms])
    from .views import _parse_ids
    try:
        ids = _parse_ids(request.data, 'permissionIds')
    except (TypeError, ValueError):
        return Response({'error': 'permissionIds must be a list of numeric permission ids.'},
                        status=status.HTTP_400_BAD_REQUEST)
    valid = set(Permission.objects.filter(id__in=ids).values_list('id', flat=True))
    unknown = [i for i in ids if i not in valid]
    if unknown:
        return Response({'error': f'Unknown permission id(s): {unknown}'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        fr.set_role_permissions(request.user, firm, role, sorted(valid))
    except fr.RoleRuleError as exc:
        return _error(exc)
    return Response({'message': 'Permissions updated.', 'count': len(valid)})


def role_members(request, role_id):
    firm = tenant.resolve_firm(request.user)
    role = _own_role(firm, role_id)
    if role is None:
        return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
    from core.models import Advocate
    ids = AdvocateRole.objects.filter(role_id=role.id).values_list('advocate_id', flat=True)
    return Response([{'id': a.id, 'fullName': a.full_name, 'email': a.email}
                     for a in Advocate.objects.filter(id__in=list(ids)).order_by('full_name')])


# ------------------------------------------------------------- assignments ----
def get_user_roles(request, pk):
    firm = tenant.resolve_firm(request.user)
    role_ids = AdvocateRole.objects.filter(advocate_id=pk).values_list('role_id', flat=True)
    roles = fr.firm_roles(firm).filter(id__in=list(role_ids)).order_by('id')
    return Response([{'id': r.id, 'name': r.name, 'description': r.description} for r in roles])


def set_user_roles(request, pk, new_ids):
    """Replace a member's roles in this firm. Roles of other firms the person may
    hold (future multi-firm membership) are left alone."""
    firm = tenant.resolve_firm(request.user)
    current = set(fr.firm_roles(firm).filter(
        id__in=AdvocateRole.objects.filter(advocate_id=pk).values('role_id')).values_list('id', flat=True))
    wanted = set(new_ids)
    roles = {r.id: r for r in Role.objects.filter(id__in=current | wanted)}
    try:
        for rid in wanted - current:
            if rid not in roles:
                raise fr.RoleRuleError('Role not found', 400)
            fr.check_assignable(request.user, firm, roles[rid])
        for rid in current - wanted:
            fr.check_removable(request.user, firm, pk, roles[rid])
    except fr.RoleRuleError as exc:
        return _error(exc)
    mid = fr.membership_id(firm, pk)
    with transaction.atomic():
        AdvocateRole.objects.filter(advocate_id=pk, role_id__in=current - wanted).delete()
        for rid in wanted - current:
            AdvocateRole.objects.create(advocate_id=pk, role_id=rid, firm_id=firm.id, membership_id=mid)
        fr.audit(request.user, firm, 'UPDATE', f'Roles of user {pk} changed', pk,
                 {'added': sorted(roles[r].name for r in wanted - current),
                  'removed': sorted(roles[r].name for r in current - wanted)})
    return Response({'message': 'Roles updated.'})


def add_user_role(request, pk, role_id):
    firm = tenant.resolve_firm(request.user)
    current = set(fr.firm_roles(firm).filter(
        id__in=AdvocateRole.objects.filter(advocate_id=pk).values('role_id')).values_list('id', flat=True))
    return set_user_roles(request, pk, sorted(current | {int(role_id)}))


def remove_user_role(request, pk, role_id):
    firm = tenant.resolve_firm(request.user)
    current = set(fr.firm_roles(firm).filter(
        id__in=AdvocateRole.objects.filter(advocate_id=pk).values('role_id')).values_list('id', flat=True))
    if int(role_id) not in current:
        return Response({'message': 'Role removed.'})
    return set_user_roles(request, pk, sorted(current - {int(role_id)}))
