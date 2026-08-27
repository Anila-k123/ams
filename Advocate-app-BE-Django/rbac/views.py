from rest_framework.decorators import api_view, permission_classes
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from core.models import Role, Permission, RolePermission, Advocate, AdvocateRole
from core.permissions import RequirePermission
from core.passwords import hash_password
from core.practice import practice_root


def _parse_ids(data, key):
    """Accept a JSON array, a {key: [...]} object, or a bare scalar id."""
    if isinstance(data, list):
        raw = data
    elif isinstance(data, dict):
        raw = data.get(key, [])
    else:
        raw = [data]
    return [int(x) for x in raw]


def _role_map(r):
    return {'id': r.id, 'name': r.name, 'description': r.description}


# Editing roles or their permission sets is the escalation path — anyone able
# to do it can grant themselves anything, so it needs ROLE_MANAGE. Merely
# READING the role/permission catalogue is also needed by User Management (to
# render the role chips), so those two allow either admin capability.
ROLE_MANAGE = [RequirePermission('ROLE_MANAGE')]
ROLE_OR_USER_READ = [RequirePermission('ROLE_MANAGE', 'USER_MANAGE')]


@api_view(['GET', 'POST'])
@permission_classes(ROLE_OR_USER_READ)
def list_roles(request):
    if request.method == 'GET':
        return Response([_role_map(r) for r in Role.objects.all().order_by('id')])
    # POST — creating a role is an escalation path, so it needs ROLE_MANAGE
    # even though listing does not.
    if 'ROLE_MANAGE' not in request.user.permission_codes():
        return Response({'error': 'Access denied: missing required permission.'},
                        status=status.HTTP_403_FORBIDDEN)
    name = (request.data.get('name') or '').strip()
    if not name:
        return Response({'error': 'name is required.'}, status=status.HTTP_400_BAD_REQUEST)
    if Role.objects.filter(name__iexact=name).exists():
        return Response({'error': 'A role with that name already exists.'},
                        status=status.HTTP_409_CONFLICT)
    role = Role.objects.create(name=name, description=request.data.get('description') or '')
    return Response(_role_map(role), status=status.HTTP_201_CREATED)


@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes(ROLE_MANAGE)
def role_detail(request, role_id):
    role = Role.objects.filter(id=role_id).first()
    if role is None:
        return Response({'error': 'Role not found'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'GET':
        return Response(_role_map(role))
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
    data = [{'id': p.id, 'name': p.name, 'description': p.description, 'module': p.module}
            for p in Permission.objects.all().order_by('module', 'name')]
    return Response(data)


@api_view(['GET', 'PUT'])
@permission_classes(ROLE_MANAGE)
def role_permissions(request, role_id):
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


# ==================== Admin user management (/api/admin/users) ====================

def _user_map(adv):
    role_ids = AdvocateRole.objects.filter(advocate_id=adv.id).values_list('role_id', flat=True)
    role_names = list(Role.objects.filter(id__in=list(role_ids)).values_list('name', flat=True))
    return {
        'id': adv.id, 'fullName': adv.full_name, 'email': adv.email, 'phone': adv.phone,
        'barCouncilId': adv.bar_council_id, 'specialization': adv.specialization,
        'experience': adv.experience, 'role': adv.role, 'roles': role_names,
        'practiceOwnerId': adv.parent_advocate_id,
        'sharesPractice': adv.parent_advocate_id is not None,
    }

USER_MANAGE = [RequirePermission('USER_MANAGE')]


class UsersView(APIView):
    permission_classes = USER_MANAGE

    def get(self, request):
        return Response([_user_map(a) for a in Advocate.objects.all().order_by('id')])

    def post(self, request):
        d = request.data
        if Advocate.objects.filter(email=d.get('email')).exists():
            return Response({'error': 'Email already registered!'}, status=status.HTTP_409_CONFLICT)
        # No default password: falling back to a shared literal meant every
        # account created here started with the same publicly-known password.
        raw_password = d.get('password') or ''
        if len(raw_password) < 8:
            return Response({'error': 'password is required (minimum 8 characters).'},
                            status=status.HTTP_400_BAD_REQUEST)
        adv = Advocate(
            full_name=d.get('fullName') or '',
            email=d.get('email'),
            password=hash_password(raw_password),
            bar_council_id=d.get('barCouncilId') or f"TEMP-{d.get('email','')[:20]}",
            phone=d.get('phone') or None,
            specialization=d.get('specialization') or None,
            experience=d.get('experience') or 0,
            address=d.get('address') or None,
            role=d.get('role') or 'ADVOCATE',
            theme='light',
            whatsapp_enabled=False,
            email_notifications_enabled=True,
            browser_notifications_enabled=True,
            # Join the creator's practice, so the new account can see the
            # chambers' cases. Without this a user created here would log in to
            # an empty application - the account exists, the roles are granted,
            # and every query finds nothing because the data belongs to
            # somebody else. Pass sharePractice=false to create an isolated
            # account instead.
            parent_advocate_id=(None if d.get('sharePractice') is False
                                else practice_root(request.user)),
        )
        adv.save()
        return Response(_user_map(adv), status=status.HTTP_201_CREATED)


class UserDetailView(APIView):
    permission_classes = USER_MANAGE

    def get(self, request, pk):
        adv = Advocate.objects.filter(id=pk).first()
        if adv is None:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response(_user_map(adv))

    def put(self, request, pk):
        adv = Advocate.objects.filter(id=pk).first()
        if adv is None:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        d = request.data
        for attr, key in [('full_name', 'fullName'), ('phone', 'phone'), ('email', 'email'),
                          ('bar_council_id', 'barCouncilId'), ('specialization', 'specialization'),
                          ('experience', 'experience'), ('address', 'address'), ('role', 'role')]:
            if key in d and d[key] is not None:
                setattr(adv, attr, d[key])
        if d.get('password'):
            adv.password = hash_password(d['password'])
        adv.save()
        return Response(_user_map(adv))

    def delete(self, request, pk):
        adv = Advocate.objects.filter(id=pk).first()
        if adv is None:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        AdvocateRole.objects.filter(advocate_id=pk).delete()
        adv.delete()
        return Response({'message': 'User deleted successfully.'})


class UserRolesView(APIView):
    permission_classes = USER_MANAGE

    def get(self, request, pk):
        role_ids = AdvocateRole.objects.filter(advocate_id=pk).values_list('role_id', flat=True)
        roles = Role.objects.filter(id__in=list(role_ids)).order_by('id')
        return Response([{'id': r.id, 'name': r.name, 'description': r.description} for r in roles])

    def put(self, request, pk):
        new_ids = _parse_ids(request.data, 'roleIds')
        AdvocateRole.objects.filter(advocate_id=pk).delete()
        AdvocateRole.objects.bulk_create([
            AdvocateRole(advocate_id=pk, role_id=rid) for rid in new_ids
        ])
        return Response({'message': 'Roles updated.'})


class UserRoleItemView(APIView):
    permission_classes = USER_MANAGE

    def post(self, request, pk, role_id):
        if not AdvocateRole.objects.filter(advocate_id=pk, role_id=role_id).exists():
            AdvocateRole.objects.create(advocate_id=pk, role_id=role_id)
        return Response({'message': 'Role assigned.'})

    def delete(self, request, pk, role_id):
        AdvocateRole.objects.filter(advocate_id=pk, role_id=role_id).delete()
        return Response({'message': 'Role removed.'})
