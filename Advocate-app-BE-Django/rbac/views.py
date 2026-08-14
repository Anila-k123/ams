from rest_framework.decorators import api_view
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from core.models import Role, Permission, RolePermission, Advocate, AdvocateRole
from core.permissions import RequirePermission
from core.passwords import hash_password


def _parse_ids(data, key):
    """Accept a JSON array, a {key: [...]} object, or a bare scalar id."""
    if isinstance(data, list):
        raw = data
    elif isinstance(data, dict):
        raw = data.get(key, [])
    else:
        raw = [data]
    return [int(x) for x in raw]


@api_view(['GET'])
def list_roles(request):
    data = [{'id': r.id, 'name': r.name, 'description': r.description}
            for r in Role.objects.all().order_by('id')]
    return Response(data)


@api_view(['GET'])
def list_permissions(request):
    data = [{'id': p.id, 'name': p.name, 'description': p.description, 'module': p.module}
            for p in Permission.objects.all().order_by('module', 'name')]
    return Response(data)


@api_view(['GET', 'PUT'])
def role_permissions(request, role_id):
    if request.method == 'GET':
        perm_ids = RolePermission.objects.filter(role_id=role_id).values_list('permission_id', flat=True)
        perms = Permission.objects.filter(id__in=list(perm_ids)).order_by('module', 'name')
        return Response([{'id': p.id, 'name': p.name, 'description': p.description, 'module': p.module}
                         for p in perms])
    # PUT: replace the role's permission set with the provided list of permission IDs.
    new_ids = _parse_ids(request.data, 'permissionIds')
    RolePermission.objects.filter(role_id=role_id).delete()
    RolePermission.objects.bulk_create([
        RolePermission(role_id=role_id, permission_id=pid) for pid in new_ids
    ])
    return Response({'message': 'Permissions updated.'})


# ==================== Admin user management (/api/admin/users) ====================

def _user_map(adv):
    role_ids = AdvocateRole.objects.filter(advocate_id=adv.id).values_list('role_id', flat=True)
    role_names = list(Role.objects.filter(id__in=list(role_ids)).values_list('name', flat=True))
    return {
        'id': adv.id, 'fullName': adv.full_name, 'email': adv.email, 'phone': adv.phone,
        'barCouncilId': adv.bar_council_id, 'specialization': adv.specialization,
        'experience': adv.experience, 'role': adv.role, 'roles': role_names,
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
        adv = Advocate(
            full_name=d.get('fullName') or '',
            email=d.get('email'),
            password=hash_password(d.get('password') or 'changeme123'),
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
