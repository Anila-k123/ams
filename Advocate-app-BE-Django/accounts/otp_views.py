"""Password-reset OTP flow: forgot-password -> verify-otp -> reset-password.

The OTP is hashed (SHA-256 + salt) before storage in password_reset_otp; the raw
OTP is emailed via SMTP. Since Django both issues and verifies the OTP, the hash
just needs to be internally consistent (the table starts empty). Email-send
failures are swallowed so the flow still works offline — the OTP is logged.
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
    advocate = Advocate.objects.filter(email=email).first()
    generic = {'message': 'If an account exists, an OTP has been sent.'}
    if advocate is None:
        return Response(generic)  # do not reveal whether the email exists

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
    log.warning("Password-reset OTP for %s: %s (expires in %s min)", email, otp, settings.OTP_EXPIRY_MINUTES)
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
        email=email, hashed_otp=h, used=False, expires_at__gte=_now()
    ).order_by('-id').first()


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def verify_otp(request):
    email = (request.data.get('email') or '').strip()
    otp = (request.data.get('otp') or '').strip()
    if _valid_otp_row(email, otp):
        return Response({'success': True, 'message': 'OTP verified.'})
    return Response({'success': False, 'error': 'Invalid or expired OTP.'},
                    status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def reset_password(request):
    email = (request.data.get('email') or '').strip()
    otp = (request.data.get('otp') or '').strip()
    new_password = request.data.get('newPassword') or ''
    row = _valid_otp_row(email, otp)
    if row is None:
        return Response({'success': False, 'error': 'Invalid or expired OTP.'},
                        status=status.HTTP_400_BAD_REQUEST)
    advocate = Advocate.objects.filter(email=email).first()
    if advocate is None:
        return Response({'success': False, 'error': 'Account not found.'},
                        status=status.HTTP_400_BAD_REQUEST)
    advocate.password = hash_password(new_password)
    advocate.save(update_fields=['password'])
    row.used = True
    row.save(update_fields=['used'])
    return Response({'success': True, 'message': 'Password reset successful.'})
