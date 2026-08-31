from django.conf import settings

from rest_framework.views import APIView
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from core.models import Advocate
from core.jwt import generate_token
from core.passwords import verify_password, hash_password
from .serializers import (
    AdvocateProfileSerializer, FullProfileSerializer, LoginSerializer, SignupSerializer,
)


class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        s = LoginSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        email = s.validated_data['email']
        password = s.validated_data['password']
        advocate = Advocate.objects.filter(email=email).first()
        if advocate is None or not verify_password(password, advocate.password):
            return Response({'error': 'Invalid email or password!'},
                            status=status.HTTP_401_UNAUTHORIZED)
        token = generate_token(advocate)
        return Response({
            'token': token,
            'message': 'Login Successful!',
            'role': advocate.role or 'ADVOCATE',
            'theme': advocate.theme or 'light',
            'fullName': advocate.full_name or 'Advocate',
        })


class SignupView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        # Closed unless explicitly enabled. See ALLOW_PUBLIC_SIGNUP in settings
        # for why: an unauthenticated caller could create a working account, and
        # accounts here are meant to come from User Management.
        if not getattr(settings, 'ALLOW_PUBLIC_SIGNUP', False):
            return Response(
                {'error': 'Self-registration is closed. Ask your practice '
                          'administrator to create an account for you.'},
                status=status.HTTP_403_FORBIDDEN)
        s = SignupSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        if Advocate.objects.filter(email=d['email']).exists():
            return Response({'error': 'Email already registered!'},
                            status=status.HTTP_409_CONFLICT)
        advocate = Advocate(
            full_name=d['fullName'],
            email=d['email'],
            password=hash_password(d['password']),
            bar_council_id=d['barCouncilId'],
            phone=d.get('phone') or None,
            specialization=d.get('specialization') or None,
            experience=d.get('experience') or 0,
            address=d.get('address') or None,
            # Not from the request body. A caller supplying role='Super
            # Admin' was stored verbatim; it grants nothing (permissions come
            # from advocate_roles) but it is not a client's field to set, and it
            # displays wherever the role string is shown.
            role='ADVOCATE',
            theme='light',
            whatsapp_enabled=False,
            email_notifications_enabled=True,
            browser_notifications_enabled=True,
        )
        advocate.save()
        return Response({'message': 'User registered successfully!'},
                        status=status.HTTP_201_CREATED)


class LogoutView(APIView):
    def post(self, request):
        # Stateless JWT: nothing to invalidate server-side.
        return Response({'message': 'Logged out successfully'})


class ProfileView(APIView):
    """GET /api/advocates/profile — limited AdvocateProfileDTO."""
    def get(self, request):
        return Response(AdvocateProfileSerializer(request.user).data)


class SettingsView(APIView):
    """PUT /api/advocates/settings — update profile; optional newPassword."""
    def put(self, request):
        advocate = request.user
        s = AdvocateProfileSerializer(advocate, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        new_password = request.data.get('newPassword')
        if new_password:
            advocate.password = hash_password(new_password)
            advocate.save(update_fields=['password'])
        return Response(AdvocateProfileSerializer(advocate).data)


class NotificationSettingsView(APIView):
    """PATCH /api/advocates/notification-settings."""
    def patch(self, request):
        advocate = request.user
        mapping = {
            'whatsappEnabled': 'whatsapp_enabled',
            'emailNotificationsEnabled': 'email_notifications_enabled',
            'browserNotificationsEnabled': 'browser_notifications_enabled',
        }
        changed = []
        for k, field in mapping.items():
            if k in request.data:
                setattr(advocate, field, bool(request.data[k]))
                changed.append(field)
        if changed:
            advocate.save(update_fields=changed)
        return Response({
            'whatsappEnabled': advocate.whatsapp_enabled,
            'emailNotificationsEnabled': advocate.email_notifications_enabled,
            'browserNotificationsEnabled': advocate.browser_notifications_enabled,
        })


@api_view(['GET'])
def my_permissions(request):
    return Response(sorted(request.user.permission_codes()))


@api_view(['GET'])
def my_roles(request):
    return Response(request.user.role_names())


# ---- /api/profile/* (Profile page) ----

class FullProfileView(APIView):
    def get(self, request):
        return Response(FullProfileSerializer(request.user, context={'request': request}).data)

    def put(self, request):
        s = FullProfileSerializer(request.user, data=request.data, partial=True,
                                  context={'request': request})
        s.is_valid(raise_exception=True)
        s.save()
        return Response(FullProfileSerializer(request.user, context={'request': request}).data)


class PreferencesView(APIView):
    def put(self, request):
        advocate = request.user
        mapping = {
            'theme': 'theme', 'language': 'language', 'timeZone': 'time_zone',
            'currency': 'currency', 'dateFormat': 'date_format',
            'autoLogoutDuration': 'auto_logout_duration',
            'defaultDashboardFilter': 'default_dashboard_filter',
        }
        changed = []
        for k, field in mapping.items():
            if k in request.data:
                setattr(advocate, field, request.data[k])
                changed.append(field)
        if changed:
            advocate.save(update_fields=changed)
        return Response(FullProfileSerializer(advocate, context={'request': request}).data)


BRANDING_FIELD = {'photo': 'profile_photo_path', 'logo': 'office_logo_path',
                  'signature': 'signature_path', 'seal': 'office_seal_path'}


class BrandingUploadView(APIView):
    """POST /api/profile/branding/{type} — upload photo/logo/signature/seal."""
    def post(self, request, type):
        import os
        import uuid
        from django.conf import settings
        field = BRANDING_FIELD.get(type)
        if field is None:
            return Response({'error': 'Invalid branding type'}, status=status.HTTP_400_BAD_REQUEST)
        f = request.FILES.get('file')
        if f is None:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)
        branding_dir = os.path.join(settings.DOCUMENT_UPLOAD_DIR, 'branding')
        os.makedirs(branding_dir, exist_ok=True)
        ext = os.path.splitext(f.name)[1]
        stored = f"{uuid.uuid4()}{ext}"
        with open(os.path.join(branding_dir, stored), 'wb') as out:
            for chunk in f.chunks():
                out.write(chunk)
        advocate = request.user
        setattr(advocate, field, f"branding/{stored}")
        advocate.save(update_fields=[field])
        return Response(FullProfileSerializer(advocate, context={'request': request}).data)


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def serve_branding_file(request, sub_dir, filename):
    """GET /api/profile/files/{subDir}/{filename} — public so <img> tags can load it."""
    import os
    import mimetypes
    from django.conf import settings
    from django.http import FileResponse, Http404
    # Path-traversal guard: only a bare filename under a known subdir.
    if sub_dir not in ('branding',) or '/' in filename or '\\' in filename or '..' in filename:
        raise Http404('Not found')
    path = os.path.join(settings.DOCUMENT_UPLOAD_DIR, sub_dir, filename)
    if not os.path.exists(path):
        raise Http404('File not found')
    ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    resp = FileResponse(open(path, 'rb'), content_type=ctype)
    resp['Cache-Control'] = 'max-age=3600'
    return resp


class ChangePasswordView(APIView):
    def put(self, request):
        advocate = request.user
        current = request.data.get('currentPassword')
        new = request.data.get('newPassword')
        confirm = request.data.get('confirmNewPassword')
        if not verify_password(current or '', advocate.password):
            return Response({'error': 'Current password is incorrect.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not new or new != confirm:
            return Response({'error': 'New passwords do not match.'},
                            status=status.HTTP_400_BAD_REQUEST)
        advocate.password = hash_password(new)
        advocate.save(update_fields=['password'])
        return Response({'message': 'Password changed successfully.'})
