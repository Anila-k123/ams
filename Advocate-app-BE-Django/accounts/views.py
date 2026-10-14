from django.conf import settings

from rest_framework.views import APIView
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from core.models import Advocate
from core.jwt import generate_token
from core.passwords import verify_password, hash_password
from core.validators import check_payload, password_error
from core import session
from core.session import revoke_all, security_event
from . import throttle
from .serializers import (
    AdvocateProfileSerializer, FullProfileSerializer, LoginSerializer, SignupSerializer,
)


class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        s = LoginSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        email = s.validated_data['email'].strip()
        password = s.validated_data['password']
        ip = throttle.client_ip(request)
        # Locked out after repeated failures (accounts/throttle.py) - checked
        # before the password, so a right guess during the lock gains nothing.
        wait = throttle.login_retry_after(email, ip)
        if wait:
            minutes = max(1, round(wait / 60))
            security_event('LOGIN_LOCKED', request, email=email, success=False)
            resp = Response({'error': f'Too many failed sign-in attempts. Try again in {minutes} '
                                      f'minute{"s" if minutes != 1 else ""}.', 'code': 'LOCKED'},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
            resp['Retry-After'] = str(wait)
            return resp
        # Exact match first (emails are unique as stored), then ignoring case,
        # as the password-reset flow already does.
        advocate = (Advocate.objects.filter(email=email).first()
                    or Advocate.objects.filter(email__iexact=email).order_by('id').first())
        if advocate is None or not verify_password(password, advocate.password):
            throttle.record_login(email, ip, success=False)
            security_event('LOGIN_FAILED', request, email=email, success=False)
            # One message for unknown email and wrong password: no account enumeration.
            return Response({'error': 'Invalid email or password!', 'code': 'INVALID_CREDENTIALS'},
                            status=status.HTTP_401_UNAUTHORIZED)
        throttle.record_login(email, ip, success=True)
        # Account / membership / firm state is only revealed after a correct
        # password, so it says nothing to someone guessing.
        refusal = _login_refusal(advocate)
        if refusal is not None:
            code, message = refusal
            security_event('LOGIN_REFUSED', request, actor=advocate, success=False, detail={'code': code})
            return Response({'error': message, 'code': code}, status=status.HTTP_403_FORBIDDEN)
        from clientaccess.gate import client_link
        link = client_link(advocate)
        if link is not None:
            from django.utils import timezone
            link.last_login_at = timezone.now()
            link.save(update_fields=['last_login_at'])
        token = generate_token(advocate)
        firm_info, membership_info = _workspace(advocate)
        security_event('LOGIN', request, actor=advocate, firm_id=(firm_info or {}).get('_id'))
        if firm_info:
            firm_info.pop('_id', None)
        return Response({
            'token': token,
            'message': 'Login Successful!',
            'role': advocate.role or 'ADVOCATE',
            'theme': advocate.theme or 'light',
            'fullName': advocate.full_name or 'Advocate',
            'firm': firm_info,
            'membership': membership_info,
            'permissions': sorted(advocate.permission_codes()),
        })


def _login_refusal(advocate):
    """(code, message) when this correct-password sign-in must be refused."""
    if advocate.left_on is not None:
        return 'ACCOUNT_DISABLED', 'This account is no longer active.'
    if settings.TENANCY_MODE != 'firm':
        return None
    from core import tenant
    from firms.models import FirmMembership
    m = tenant.active_membership(advocate.id)
    if m is None:
        if FirmMembership.objects.filter(advocate_id=advocate.id, status=FirmMembership.SUSPENDED).exists():
            return 'MEMBERSHIP_SUSPENDED', 'Your access to this firm is suspended. Contact your firm administrator.'
        return 'NO_ACTIVE_MEMBERSHIP', 'This account is not an active member of any firm.'
    if m.firm.status == m.firm.SUSPENDED:
        return 'FIRM_SUSPENDED', "Your firm's access is suspended. Contact AMS support."
    if not m.firm.is_active:
        return 'FIRM_INACTIVE', 'Your firm is not active.'
    return None


def _workspace(advocate):
    """Firm and membership facts for the frontend (display only - every request
    is re-checked on the server)."""
    if not settings.TENANCY_COLUMNS:
        return None, None
    from core import tenant
    m = tenant.active_membership(advocate.id)
    if m is None:
        return None, None
    display = getattr(getattr(m.firm, 'settings', None), 'display_name', '') if hasattr(m.firm, 'settings') else ''
    return ({'publicId': str(m.firm.public_id), 'name': display or m.firm.name, 'slug': m.firm.slug,
             'status': m.firm.status, '_id': m.firm.id},
            {'id': m.id, 'kind': m.kind, 'status': m.status})


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
        # Ends every session of this person (account-wide token version,
        # core/session.py): the token just used, and those on other devices.
        revoke_all(request.user.id, session.LOGOUT)
        security_event('LOGOUT', request, actor=request.user)
        return Response({'message': 'Logged out successfully'})


class ProfileView(APIView):
    """GET /api/advocates/profile — limited AdvocateProfileDTO."""
    def get(self, request):
        return Response(AdvocateProfileSerializer(request.user).data)


class SettingsView(APIView):
    """PUT /api/advocates/settings — update profile; optional newPassword."""
    def put(self, request):
        advocate = request.user
        data, bad = check_payload(request.data, {'email': 'email', 'phone': 'phone'})
        if bad is not None:
            return bad
        s = AdvocateProfileSerializer(advocate, data=data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        new_password = request.data.get('newPassword')
        if new_password:
            problem = password_error(new_password, advocate.email)
            if problem:
                return Response({'error': problem}, status=status.HTTP_400_BAD_REQUEST)
            advocate.password = hash_password(new_password)
            advocate.save(update_fields=['password'])
            revoke_all(advocate.id, session.PASSWORD_CHANGE)
            security_event('PASSWORD_CHANGE', request, actor=advocate)
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
        data, bad = check_payload(request.data, {
            'phone': 'phone', 'officePhone': 'landline', 'officeEmail': 'email',
            'pinCode': 'pincode', 'gstNumber': 'gstin', 'panNumber': 'pan'})
        if bad is not None:
            return bad
        s = FullProfileSerializer(request.user, data=data, partial=True,
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
        # Branding files are served from the API's own origin (logos publicly), so
        # only plain raster images: an uploaded .html/.svg could run script there.
        if (os.path.splitext(f.name or '')[1].lower() not in {'.png', '.jpg', '.jpeg', '.webp'}
                or f.size > 2 * 1024 * 1024):
            return Response({'error': 'Use a PNG, JPEG or WebP image of at most 2 MB.'},
                            status=status.HTTP_400_BAD_REQUEST)
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

    def delete(self, request, type):
        """DELETE /api/profile/branding/{type} — remove the photo/logo/signature/seal:
        clear the field (initials / no image show again) and delete the stored file."""
        import os
        from django.conf import settings
        field = BRANDING_FIELD.get(type)
        if field is None:
            return Response({'error': 'Invalid branding type'}, status=status.HTTP_400_BAD_REQUEST)
        advocate = request.user
        old = getattr(advocate, field, None)
        setattr(advocate, field, None)
        advocate.save(update_fields=[field])
        # Only a file this endpoint stored (branding/<name>); never a path outside it.
        if old and str(old).startswith('branding/') and '..' not in str(old):
            try:
                os.remove(os.path.join(settings.DOCUMENT_UPLOAD_DIR, *str(old).split('/')))
            except OSError:
                pass  # already gone: the profile is cleared either way
        return Response(FullProfileSerializer(advocate, context={'request': request}).data)


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def serve_branding_file(request, sub_dir, filename):
    """GET /api/profile/files/{subDir}/{filename}.

    Logos and profile photos are public so <img> tags and emails can load them.
    A signature or seal is served only with a valid, unexpired ?sig= issued by
    the profile serializer (accounts/branding.py): a guessed or old link gets 404."""
    import os
    import mimetypes
    from django.conf import settings
    from django.http import FileResponse, Http404
    from .branding import is_private, valid_signature
    # Path-traversal guard: only a bare filename under a known subdir.
    if sub_dir not in ('branding',) or '/' in filename or '\\' in filename or '..' in filename:
        raise Http404('Not found')
    private = is_private(filename)
    if private and not valid_signature(filename, request.query_params.get('sig')):
        raise Http404('Not found')
    path = os.path.join(settings.DOCUMENT_UPLOAD_DIR, sub_dir, filename)
    if not os.path.exists(path):
        raise Http404('File not found')
    ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    resp = FileResponse(open(path, 'rb'), content_type=ctype)
    resp['Cache-Control'] = 'private, max-age=300' if private else 'max-age=3600'
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
        problem = password_error(new, advocate.email)
        if problem:
            return Response({'error': problem}, status=status.HTTP_400_BAD_REQUEST)
        advocate.password = hash_password(new)
        advocate.save(update_fields=['password'])
        # Every existing session ends; the caller signs in again with the new password.
        revoke_all(advocate.id, session.PASSWORD_CHANGE)
        security_event('PASSWORD_CHANGE', request, actor=advocate)
        return Response({'message': 'Password changed successfully.'})
