"""Password-reset OTP flow: forgot-password -> verify-otp -> reset-password.

The OTP is hashed (SHA-256 + salt) before storage in password_reset_otp; the raw
OTP is emailed via SMTP and never logged (whoever reads a log could otherwise
reset any account). On a development machine use the console email backend
(MAIL_BACKEND=django.core.mail.backends.console.EmailBackend) to see the code.

Guessing is stopped in accounts/throttle.py: after OTP_MAX_FAILURES wrong codes
for an email, all its live codes are burned and a new one must be requested.
"""

import hashlib
import logging
import random
import secrets
import datetime

from django.conf import settings
from django.core.mail import send_mail
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

from core.models import Advocate, PasswordResetOtp
from core.passwords import hash_password
from core.validators import password_error

from . import throttle

log = logging.getLogger(__name__)


def _hash_otp(otp: str) -> str:
    return hashlib.sha256((settings.OTP_SALT + otp).encode('utf-8')).hexdigest()


def _now():
    return datetime.datetime.now()


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def forgot_password(request):
    email = (request.data.get('email') or '').strip()
    if not email:
        return Response({'error': 'Enter your email address.'}, status=status.HTTP_400_BAD_REQUEST)
    # Capitals and spaces don't matter: Priya@Firm.com is priya@firm.com.
    advocate = Advocate.objects.filter(email__iexact=email).first()
    if advocate is None:
        # Product decision: say so plainly, so a mistyped or unregistered address
        # isn't left waiting for a code that will never come.
        return Response({'error': 'This email is not registered with PactPro. Please contact your firm admin.',
                         'notRegistered': True}, status=status.HTTP_404_NOT_FOUND)
    email = advocate.email   # the address as stored, for the code row and the mail
    generic = {'message': 'A verification code has been sent to your email.'}

    # Rate limit: max OTP_RATE_LIMIT requests per hour.
    hour_ago = _now() - datetime.timedelta(hours=1)
    recent = PasswordResetOtp.objects.filter(email=email, created_at__gte=hour_ago).count()
    if recent >= settings.OTP_RATE_LIMIT:
        return Response({'error': 'Too many OTP requests. Please try again later.'},
                        status=status.HTTP_429_TOO_MANY_REQUESTS)

    otp = f"{secrets.randbelow(900000) + 100000}"  # 6 digits
    PasswordResetOtp.objects.create(
        advocate_id=advocate.id, email=email, hashed_otp=_hash_otp(otp),
        created_at=_now(), expires_at=_now() + datetime.timedelta(minutes=settings.OTP_EXPIRY_MINUTES),
        used=False,
    )
    log.info('Password-reset code issued for advocate %s (expires in %s min)',
             advocate.id, settings.OTP_EXPIRY_MINUTES)
    from core.session import security_event
    security_event('PASSWORD_RESET_REQUESTED', request, actor=advocate)
    try:
        send_mail(
            subject='Your Password Reset OTP',
            message=f'Your OTP is {otp}. It expires in {settings.OTP_EXPIRY_MINUTES} minutes.',
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[email],
            fail_silently=True,
        )
    except Exception as e:  # never fail the request because email is down
        log.warning("OTP email send failed: %s", e)
    return Response(generic)


def _valid_otp_row(email, otp):
    h = _hash_otp(otp)
    return PasswordResetOtp.objects.filter(
        email__iexact=email, hashed_otp=h, used=False, expires_at__gte=_now()
    ).order_by('-id').first()


_TOO_MANY = {'success': False, 'error': 'Too many wrong codes. Request a new code and try again.'}
_INVALID = {'success': False, 'error': 'Invalid or expired OTP.'}


def _burn_codes(email):
    PasswordResetOtp.objects.filter(email__iexact=email, used=False).update(used=True)


def _checked_row(request, email, otp):
    """(row, error_response). Counts wrong codes; burns every live code for the
    email once OTP_MAX_FAILURES is reached, so a 6-digit code can't be guessed."""
    if throttle.otp_failures(email) >= settings.OTP_MAX_FAILURES:
        _burn_codes(email)
        return None, Response(_TOO_MANY, status=status.HTTP_429_TOO_MANY_REQUESTS)
    row = _valid_otp_row(email, otp) if otp else None
    if row is None:
        throttle.record_otp_failure(email, throttle.client_ip(request))
        if throttle.otp_failures(email) >= settings.OTP_MAX_FAILURES:
            _burn_codes(email)
            return None, Response(_TOO_MANY, status=status.HTTP_429_TOO_MANY_REQUESTS)
        return None, Response(_INVALID, status=status.HTTP_400_BAD_REQUEST)
    return row, None


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def verify_otp(request):
    email = (request.data.get('email') or '').strip()
    otp = (request.data.get('otp') or '').strip()
    row, error = _checked_row(request, email, otp)
    if error is not None:
        return error
    return Response({'success': True, 'message': 'OTP verified.'})


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def reset_password(request):
    email = (request.data.get('email') or '').strip()
    otp = (request.data.get('otp') or '').strip()
    new_password = request.data.get('newPassword') or ''
    row, error = _checked_row(request, email, otp)
    if error is not None:
        return error
    advocate = Advocate.objects.filter(id=row.advocate_id).first() or \
        Advocate.objects.filter(email__iexact=email).first()
    if advocate is None:
        return Response({'success': False, 'error': 'Account not found.'},
                        status=status.HTTP_400_BAD_REQUEST)
    problem = password_error(new_password, advocate.email)
    if problem:
        return Response({'success': False, 'error': problem}, status=status.HTTP_400_BAD_REQUEST)
    advocate.password = hash_password(new_password)
    advocate.save(update_fields=['password'])
    # Every session that existed before the reset ends (a stolen token included).
    from core.session import PASSWORD_RESET, revoke_all, security_event
    revoke_all(advocate.id, PASSWORD_RESET)
    security_event('PASSWORD_RESET', request, actor=advocate)
    # Every code for this email is spent now, not just the one used.
    _burn_codes(email)
    throttle.clear_otp_failures(email)
    return Response({'success': True, 'message': 'Password reset successful.'})
