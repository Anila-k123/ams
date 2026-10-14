from django.conf import settings
from rest_framework.decorators import api_view, permission_classes
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from core.models import Role, Permission, RolePermission, Advocate, AdvocateRole
from core.permissions import RequirePermission
from core.passwords import hash_password
from core import practice
from core.practice import practice_root
from core.validators import check_payload, password_error


def _parse_ids(data, key):
    """Accept a JSON array, a {key: [...]} object, or a bare scalar id."""
    if isinstance(data, list):
        raw = data
    elif isinstance(data, dict):
        raw = data.get(key, [])
    else:
        raw = [data]
    return [int(x) for x in raw]


def _role_map(r, scope=None):
    out = {'id': r.id, 'name': r.name, 'description': r.description}
    if scope is not None:
        out['builtIn'] = scope == BUILT_IN
        out['editable'] = scope == FIRM_ONLY
    return out


# --- Interim role lock (until firm-owned roles, SaaS Phase 3) ------------------
# Roles are global rows shared by every firm on the server: renaming "Senior
# Advocate" or changing its permissions in one firm changed it in all of them,
# and a firm could assign another firm's custom role. Until each firm owns its
# roles:
#   - built-in roles are visible and assignable, but not editable;
#   - a custom role can be seen, edited and assigned only by the firm whose
#     members are the only ones holding it;
#   - new roles cannot be created (they would belong to no firm).
BUILT_IN_ROLE_NAMES = {'super admin', 'senior advocate', 'advocate',
                       'accountant', 'receptionist', 'intern'}
BUILT_IN, FIRM_ONLY, FOREIGN = 'built-in', 'firm', 'foreign'
_LOCKED = {'error': 'Built-in roles are shared by every firm on this server and cannot be '
                    'changed yet. Firm-specific roles are coming.'}
_NO_NEW_ROLES = {'error': 'Creating new roles is paused until firm-specific roles are '
                          'available. Use one of the existing roles.'}


def _firm_rbac():
    """Firm-level RBAC (rbac/firm_views.py) replaces the interim lock in firm mode."""
    return settings.TENANCY_MODE == 'firm' and settings.TENANCY_COLUMNS


def _firm_member_ids(request):
    return set(_firm_users(request).values_list('id', flat=True))


def _role_scope(role, firm_ids):
    if role.name.strip().lower() in BUILT_IN_ROLE_NAMES:
        return BUILT_IN
    holders = set(AdvocateRole.objects.filter(role_id=role.id).values_list('advocate_id', flat=True))
    return FIRM_ONLY if holders and holders <= firm_ids else FOREIGN


def _not_assignable(role_ids, request):
    """The ids in role_ids this admin may not assign (unknown or another firm's)."""
    firm_ids = _firm_member_ids(request)
    roles = {r.id: r for r in Role.objects.filter(id__in=role_ids)}
    return [rid for rid in role_ids
            if rid not in roles or _role_scope(roles[rid], firm_ids) == FOREIGN]


# Client logins (clientaccess) are managed only from the client's "Client logins"
# dialog. User / Role Management must neither show nor change them, and the Client
# role must never be granted permissions or assigned to firm staff.
def _client_role(role_id):
    from clientaccess.gate import client_role_ids
    return int(role_id) in client_role_ids()


def _client_user(pk):
    from clientaccess.gate import is_client_id
    return is_client_id(pk)


_USER_NOT_FOUND = {'error': 'User not found'}
_NOT_HERE = {'error': 'Client logins are managed from the client\'s "Client logins".'}


# Editing roles or their permission sets is the escalation path — anyone able
# to do it can grant themselves anything, so it needs ROLE_MANAGE. Merely
# READING the role/permission catalogue is also needed by User Management (to
# render the role chips), so those two allow either admin capability.
ROLE_MANAGE = [RequirePermission('ROLE_MANAGE')]
ROLE_OR_USER_READ = [RequirePermission('ROLE_MANAGE', 'USER_MANAGE')]


@api_view(['GET', 'POST'])
@permission_classes(ROLE_OR_USER_READ)
def list_roles(request):
    if _firm_rbac():
        from . import firm_views
        return firm_views.list_roles(request)
    if request.method == 'GET':
        from clientaccess.gate import client_role_ids
        firm_ids = _firm_member_ids(request)
        out = []
        for r in Role.objects.exclude(id__in=client_role_ids()).order_by('id'):
            scope = _role_scope(r, firm_ids)
            if scope != FOREIGN:            # another firm's custom role stays out of sight
                out.append(_role_map(r, scope))
        return Response(out)
    # POST — creating a role is an escalation path, so it needs ROLE_MANAGE
    # even though listing does not.
    if 'ROLE_MANAGE' not in request.user.permission_codes():
        return Response({'error': 'Access denied: missing required permission.'},
                        status=status.HTTP_403_FORBIDDEN)
    if settings.ROLE_EDITING_LOCKED:
        return Response(_NO_NEW_ROLES, status=status.HTTP_403_FORBIDDEN)
    name = (request.data.get('name') or '').strip()
    if not name:
        return Response({'error': 'name is required.'}, status=status.HTTP_400_BAD_REQUEST)
    from clientaccess.gate import CLIENT_ROLE
    if name.lower() == CLIENT_ROLE.lower() or Role.objects.filter(name__iexact=name).exists():
        return Response({'error': 'A role with that name already exists.'},
                        status=status.HTTP_409_CONFLICT)
    role = Role.objects.create(name=name, description=request.data.get('description') or '')
    return Response(_role_map(role), status=status.HTTP_201_CREATED)


@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes(ROLE_MANAGE)
def role_detail(request, role_id):
    if _firm_rbac():
        from . import firm_views
        return firm_views.role_detail(request, role_id)
    role = Role.objects.filter(id=role_id).first()
    if role is None or _client_role(role_id):
        return Response({'error': 'Role not found'}, status=status.HTTP_404_NOT_FOUND)
    scope = _role_scope(role, _firm_member_ids(request))
    if scope == FOREIGN:
        return Response({'error': 'Role not found'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'GET':
        return Response(_role_map(role, scope))
    if settings.ROLE_EDITING_LOCKED and scope == BUILT_IN:
        return Response(_LOCKED, status=status.HTTP_403_FORBIDDEN)
    if request.method == 'PUT':
        name = request.data.get('name')
        if name is not None:
            name = str(name).strip()
            if not name:
                return Response({'error': 'name cannot be blank.'}, status=status.HTTP_400_BAD_REQUEST)
            if Role.objects.filter(name__iexact=name).exclude(id=role.id).exists():
                return Response({'error': 'A role with that name already exists.'},
                                status=status.HTTP_409_CONFLICT)
            role.name = name
        if 'description' in request.data:
            role.description = request.data.get('description') or ''
        role.save()
        return Response(_role_map(role))
    # DELETE — clear the join rows too, or the role's permissions and its
    # assignments to advocates are left orphaned behind a reused id.
    assigned = AdvocateRole.objects.filter(role_id=role.id).count()
    if assigned:
        return Response(
            {'error': f'This role is still assigned to {assigned} user(s). '
                      f'Remove those assignments first.'},
            status=status.HTTP_409_CONFLICT)
    RolePermission.objects.filter(role_id=role.id).delete()
    role.delete()
    return Response({'message': 'Role deleted.'})


@api_view(['GET'])
@permission_classes(ROLE_OR_USER_READ)
def list_permissions(request):
    # highRisk is the server's classification (rbac/firm_roles.HIGH_RISK): the
    # Roles page marks these and only a firm administrator may grant them. The
    # browser no longer keeps its own copy of the list.
    from .firm_roles import HIGH_RISK
    data = [{'id': p.id, 'name': p.name, 'description': p.description, 'module': p.module,
             'highRisk': p.name in HIGH_RISK}
            for p in Permission.objects.all().order_by('module', 'name')]
    return Response(data)


@api_view(['GET', 'PUT'])
@permission_classes(ROLE_MANAGE)
def role_permissions(request, role_id):
    if _firm_rbac():
        from . import firm_views
        return firm_views.role_permissions(request, role_id)
    role = Role.objects.filter(id=role_id).first()
    if role is None or _client_role(role_id):
        return Response({'error': 'Role not found'}, status=status.HTTP_404_NOT_FOUND)
    scope = _role_scope(role, _firm_member_ids(request))
    if scope == FOREIGN:
        return Response({'error': 'Role not found'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'PUT' and settings.ROLE_EDITING_LOCKED and scope == BUILT_IN:
        return Response(_LOCKED, status=status.HTTP_403_FORBIDDEN)
    if request.method == 'GET':
        perm_ids = RolePermission.objects.filter(role_id=role_id).values_list('permission_id', flat=True)
        perms = Permission.objects.filter(id__in=list(perm_ids)).order_by('module', 'name')
        return Response([{'id': p.id, 'name': p.name, 'description': p.description, 'module': p.module}
                         for p in perms])
    # PUT: replace the role's permission set with the provided list of permission IDs.
    try:
        new_ids = _parse_ids(request.data, 'permissionIds')
    except (TypeError, ValueError):
        return Response({'error': 'permissionIds must be a list of numeric permission ids.'},
                        status=status.HTTP_400_BAD_REQUEST)
    valid = set(Permission.objects.filter(id__in=new_ids).values_list('id', flat=True))
    unknown = [i for i in new_ids if i not in valid]
    if unknown:
        return Response({'error': f'Unknown permission id(s): {unknown}'},
                        status=status.HTTP_400_BAD_REQUEST)
    RolePermission.objects.filter(role_id=role_id).delete()
    RolePermission.objects.bulk_create([
        RolePermission(role_id=role_id, permission_id=pid) for pid in sorted(valid)
    ])
    return Response({'message': 'Permissions updated.', 'count': len(valid)})


@api_view(['POST'])
@permission_classes(ROLE_MANAGE)
def role_clone(request, role_id):
    """POST /api/roles/<id>/clone {name} - firm mode only."""
    if not _firm_rbac():
        return Response(_NO_NEW_ROLES, status=status.HTTP_403_FORBIDDEN)
    from . import firm_views
    return firm_views.clone(request, role_id)


@api_view(['GET'])
@permission_classes(ROLE_OR_USER_READ)
def role_members(request, role_id):
    """GET /api/roles/<id>/members - who holds a role (firm mode)."""
    if not _firm_rbac():
        return Response({'error': 'Role not found'}, status=status.HTTP_404_NOT_FOUND)
    from . import firm_views
    return firm_views.role_members(request, role_id)


# ==================== Admin user management (/api/admin/users) ====================

def _user_map(adv):
    role_ids = AdvocateRole.objects.filter(advocate_id=adv.id).values_list('role_id', flat=True)
    role_names = list(Role.objects.filter(id__in=list(role_ids)).values_list('name', flat=True))
    is_head = adv.parent_advocate_id is None
    member_count = (Advocate.objects.filter(parent_advocate_id=adv.id)
                    .exclude(id=adv.id).count()) if is_head else 0
    return {
        'id': adv.id, 'fullName': adv.full_name, 'email': adv.email, 'phone': adv.phone,
        'barCouncilId': adv.bar_council_id, 'specialization': adv.specialization,
        'experience': adv.experience, 'role': adv.role, 'roles': role_names,
        'practiceOwnerId': adv.parent_advocate_id,
        'leftOn': adv.left_on.isoformat() if adv.left_on else None,
        'active': adv.left_on is None,
        'sharesPractice': adv.parent_advocate_id is not None,
        # For the User Management tree: whether this account heads its own
        # practice (a senior, or a firm-wide staff account), how many people
        # report to it, and whether its role gives it firm-wide reach.
        'isPracticeHead': is_head,
        'memberCount': member_count,
        'firmWide': practice.FIRM_WIDE_PERMISSION in adv.permission_codes(),
    }


def _join_firm(adv, requester):
    """Keep firms.FirmTeam in step with where `adv` now sits.

    A new head (a senior heading their own team) is a team of the
    requester's firm, not a separate firm; a head that becomes a member is no
    longer a team of its own."""
    from firms.models import FirmTeam
    if adv.parent_advocate_id is not None:
        FirmTeam.objects.filter(team_root_id=adv.id).delete()
        return
    froot = practice.firm_root(requester)
    if froot == adv.id:
        return
    FirmTeam.objects.get_or_create(team_root_id=froot, defaults={'firm_root_id': froot})
    FirmTeam.objects.update_or_create(team_root_id=adv.id, defaults={'firm_root_id': froot})


def _sync_membership(adv, requester):
    """Firm mode: a user added by an admin becomes an ACTIVE member of the
    admin's firm (and a new team head's FirmTeam row points at the firm)."""
    if not _firm_rbac():
        return
    import datetime
    from core import tenant
    from firms.models import FirmMembership, FirmTeam
    firm = tenant.resolve_firm(requester)
    FirmMembership.objects.get_or_create(
        firm=firm, advocate_id=adv.id,
        defaults={'kind': FirmMembership.STAFF, 'status': FirmMembership.ACTIVE,
                  'team_root_id': adv.parent_advocate_id or adv.id, 'joined_at': datetime.datetime.now()})
    FirmTeam.objects.filter(team_root_id=adv.id, firm_id__isnull=True).update(firm_id=firm.id)


def _end_membership(adv):
    if not settings.TENANCY_COLUMNS:
        return
    import datetime
    from firms.models import FirmMembership
    FirmMembership.objects.filter(advocate_id=adv.id, status=FirmMembership.ACTIVE).update(
        status=FirmMembership.LEFT, left_at=datetime.datetime.now())


def _resolve_practice_owner(owner_value, target_id=None, requester=None):
    """Validate a requested practice owner id. Returns (parent_id, error).

    `owner_value` None / '' / 0 -> (None, None): the advocate heads their own
    practice (a senior, or firm-wide staff). Otherwise it must be an existing,
    active practice ROOT (parent_advocate_id IS NULL) - the model is one level
    deep, so you can only report to a head, not to another member.
    """
    if owner_value in (None, '', 0, '0'):
        return None, None
    try:
        oid = int(owner_value)
    except (TypeError, ValueError):
        return None, 'practiceOwnerId must be a numeric advocate id or null.'
    if target_id and oid == target_id:
        return None, 'A user cannot report to themselves.'
    owner = Advocate.objects.filter(id=oid).first()
    if owner is None or _client_user(oid):
        return None, 'Chosen practice head does not exist.'
    if owner.left_on is not None:
        return None, 'Chosen practice head has left the firm.'
    if owner.parent_advocate_id is not None:
        return None, ('Chosen practice head is itself a member of a practice. '
                      'Pick a senior who heads their own practice.')
    if requester is not None and not practice.same_firm(owner, requester):
        return None, 'Chosen practice head is not in your firm.'
    return oid, None

def _has_history(advocate):
    """Whether this advocate has created anything worth keeping.

    Checked with exists() per table rather than a count: the answer is boolean
    and the tables are indexed on advocate_id.
    """
    from core.models import (Case, Client, ClientPayment, Expense, Invoice,
                             Document)
    for model in (Client, Case, Invoice, Expense, ClientPayment, Document):
        if model.objects.filter(advocate_id=advocate.id).exists():
            return True
    return False


USER_MANAGE = [RequirePermission('USER_MANAGE')]


def _firm_users(request):
    """The accounts this admin manages: everyone in their own firm (every
    team root of the firm, and the members under them). USER_MANAGE is a
    firm's admin permission, not a server-wide one: with several firms on one
    server, an admin must not list, edit, re-role or close another firm's
    people."""
    from django.db.models import Q
    if settings.TENANCY_MODE == 'firm':
        from core import tenant
        firm = tenant.resolve_firm(request.user)
        return Advocate.objects.filter(id__in=tenant.firm_member_ids(firm))
    roots = practice.firm_team_roots(request.user)
    return Advocate.objects.filter(Q(id__in=roots) | Q(parent_advocate_id__in=roots))


def _firm_user(request, pk):
    """One account in this admin's firm, or None (answered as not found)."""
    if _client_user(pk):
        return None
    return _firm_users(request).filter(id=pk).first()


class UsersView(APIView):
    permission_classes = USER_MANAGE

    def get(self, request):
        from clientaccess.gate import client_advocate_ids
        return Response([_user_map(a) for a in
                         _firm_users(request).exclude(id__in=client_advocate_ids()).order_by('id')])

    def post(self, request):
        # Accounts are no longer created with a password chosen by an
        # administrator: people are invited (POST /api/firm/invitations) and set
        # their own password from the one-time link. Refused for every caller.
        return Response({'error': 'Add team members by invitation: they receive a link and set their own password.',
                         'code': 'USE_INVITATION'}, status=status.HTTP_410_GONE)


class UserDetailView(APIView):
    permission_classes = USER_MANAGE

    def get(self, request, pk):
        adv = _firm_user(request, pk)
        if adv is None:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response(_user_map(adv))

    def put(self, request, pk):
        adv = _firm_user(request, pk)
        if adv is None:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        d, bad = check_payload(request.data, {'email': 'email', 'phone': 'phone'})
        if bad is not None:
            return bad
        for attr, key in [('full_name', 'fullName'), ('phone', 'phone'), ('email', 'email'),
                          ('bar_council_id', 'barCouncilId'), ('specialization', 'specialization'),
                          ('experience', 'experience'), ('address', 'address'), ('role', 'role')]:
            if key in d and d[key] is not None:
                setattr(adv, attr, d[key])
        if d.get('password'):
            problem = password_error(d['password'], d.get('email') or adv.email)
            if problem:
                return Response({'error': problem}, status=status.HTTP_400_BAD_REQUEST)
            adv.password = hash_password(d['password'])
            # An administrator setting someone's password ends that person's sessions.
            from core.session import PASSWORD_RESET, revoke_all, security_event
            revoke_all(adv.id, PASSWORD_RESET)
            security_event('PASSWORD_SET_BY_ADMIN', request, actor=request.user,
                           detail={'target': adv.id})

        # Reassign which practice this user belongs to (null = make them a
        # head/senior; an id = move them under that senior).
        if 'practiceOwnerId' in d:
            parent_id, err = _resolve_practice_owner(d.get('practiceOwnerId'), target_id=adv.id,
                                                     requester=request.user)
            if err:
                return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)
            # The Super Admin account stays top-level - never tuck it under a team.
            if parent_id is not None and practice.SUPER_ADMIN_ROLE in adv.role_names():
                return Response(
                    {'error': 'The Super Admin account stays top-level and '
                              'cannot report to a senior.'},
                    status=status.HTTP_400_BAD_REQUEST)
            # A head with members can't become a member - it would orphan them.
            if parent_id is not None:
                members = (Advocate.objects.filter(parent_advocate_id=adv.id)
                           .exclude(id=adv.id).count())
                if members:
                    return Response(
                        {'error': 'This user heads a practice with {} member(s). '
                                  'Move them to another head first.'.format(members)},
                        status=status.HTTP_409_CONFLICT)
            adv.parent_advocate_id = parent_id

        adv.save()
        if 'practiceOwnerId' in d:
            _join_firm(adv, request.user)
        return Response(_user_map(adv))

    def delete(self, request, pk):
        """Close an account. Only ever hard-deletes one that owns nothing.

        This used to call adv.delete() unconditionally. Two ways that went
        wrong: an advocate with any data hit a foreign-key violation and the
        caller got an unhandled 500, and an advocate in a practice whose delete
        DID succeed took their work out of the practice's reach with them -
        every row they had created became unreachable while sitting in the
        database.

        So an account with history is marked as having left instead: the person
        loses access, the practice keeps the cases, clients and invoices.
        """
        adv = _firm_user(request, pk)
        if adv is None:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        if adv.id == request.user.id:
            return Response({'error': 'You cannot remove your own account.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # An owner with members would leave those members practice-less, and
        # their own rows unreachable. Move the people first.
        members = list(Advocate.objects.filter(parent_advocate_id=adv.id)
                       .values_list('email', flat=True))
        if members:
            return Response(
                {'error': 'This user owns a practice with {} member(s) ({}). '
                          'Move them to another practice first.'.format(
                              len(members), ', '.join(members[:3]))},
                status=status.HTTP_409_CONFLICT)

        if _firm_rbac():
            from . import firm_roles
            from core import tenant
            firm = tenant.resolve_firm(request.user)
            if firm_roles.active_admin_ids(firm) <= {adv.id}:
                return Response({'error': 'This is the last active firm administrator. Make someone '
                                          'else an administrator first.'}, status=status.HTTP_409_CONFLICT)
        from core.session import security_event
        if _has_history(adv):
            practice.mark_left(adv)                 # also ends their sessions
            _end_membership(adv)
            security_event('ACCOUNT_DEACTIVATED', request, actor=request.user, detail={'target': adv.id})
            return Response({
                'message': 'Account closed. {} can no longer sign in, and the '
                           'records they created are kept.'.format(adv.email),
                'closed': True, 'deleted': False,
            })

        AdvocateRole.objects.filter(advocate_id=pk).delete()
        _end_membership(adv)
        from core.session import CLOSED, revoke_all
        revoke_all(adv.id, CLOSED)
        security_event('ACCOUNT_CLOSED', request, actor=request.user, detail={'target': adv.id})
        adv.delete()
        return Response({'message': 'User deleted successfully.',
                         'closed': False, 'deleted': True})


class UserSessionsView(APIView):
    """POST /api/admin/users/<id>/revoke-sessions - sign this member out on
    every device (their current tokens stop working on the next request)."""
    permission_classes = USER_MANAGE

    def post(self, request, pk):
        if _client_user(pk) or _firm_user(request, pk) is None:
            return Response(_USER_NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        from core.session import ADMIN_REVOKE, revoke_all, security_event
        revoke_all(pk, ADMIN_REVOKE)
        security_event('SESSIONS_REVOKED', request, actor=request.user, detail={'target': int(pk)})
        return Response({'message': 'All sessions of this user have been ended.'})


class UserRolesView(APIView):
    permission_classes = USER_MANAGE

    def get(self, request, pk):
        if _client_user(pk):
            return Response(_NOT_HERE, status=status.HTTP_404_NOT_FOUND)
        if _firm_user(request, pk) is None:
            return Response(_USER_NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        if _firm_rbac():
            from . import firm_views
            return firm_views.get_user_roles(request, pk)
        role_ids = AdvocateRole.objects.filter(advocate_id=pk).values_list('role_id', flat=True)
        roles = Role.objects.filter(id__in=list(role_ids)).order_by('id')
        return Response([{'id': r.id, 'name': r.name, 'description': r.description} for r in roles])

    def put(self, request, pk):
        new_ids = _parse_ids(request.data, 'roleIds')
        if _client_user(pk) or any(_client_role(r) for r in new_ids):
            return Response(_NOT_HERE, status=status.HTTP_400_BAD_REQUEST)
        if _firm_user(request, pk) is None:
            return Response(_USER_NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        if _firm_rbac():
            from . import firm_views
            return firm_views.set_user_roles(request, pk, new_ids)
        # Roles the user already holds may stay; any new one must be assignable here.
        current = set(AdvocateRole.objects.filter(advocate_id=pk).values_list('role_id', flat=True))
        if _not_assignable([r for r in new_ids if r not in current], request):
            return Response({'error': 'Role not found'}, status=status.HTTP_400_BAD_REQUEST)
        AdvocateRole.objects.filter(advocate_id=pk).delete()
        AdvocateRole.objects.bulk_create([
            AdvocateRole(advocate_id=pk, role_id=rid) for rid in new_ids
        ])
        return Response({'message': 'Roles updated.'})


class UserRoleItemView(APIView):
    permission_classes = USER_MANAGE

    def post(self, request, pk, role_id):
        if _client_user(pk) or _client_role(role_id):
            return Response(_NOT_HERE, status=status.HTTP_400_BAD_REQUEST)
        if _firm_user(request, pk) is None:
            return Response(_USER_NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        if _firm_rbac():
            from . import firm_views
            return firm_views.add_user_role(request, pk, role_id)
        already = AdvocateRole.objects.filter(advocate_id=pk, role_id=role_id).exists()
        if not already and _not_assignable([int(role_id)], request):
            return Response({'error': 'Role not found'}, status=status.HTTP_400_BAD_REQUEST)
        if not already:
            AdvocateRole.objects.create(advocate_id=pk, role_id=role_id)
        return Response({'message': 'Role assigned.'})

    def delete(self, request, pk, role_id):
        if _client_user(pk):
            return Response(_NOT_HERE, status=status.HTTP_400_BAD_REQUEST)
        if _firm_user(request, pk) is None:
            return Response(_USER_NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        if _firm_rbac():
            from . import firm_views
            return firm_views.remove_user_role(request, pk, role_id)
        AdvocateRole.objects.filter(advocate_id=pk, role_id=role_id).delete()
        return Response({'message': 'Role removed.'})
