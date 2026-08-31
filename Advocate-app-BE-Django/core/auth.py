"""Custom DRF authentication: decode the Bearer JWT, load the Advocate row, and
attach it as request.user. Also stashes the permission set on the request for the
permission classes to reuse.
"""

import jwt
from rest_framework import authentication, exceptions
from .jwt import decode_token
from .models import Advocate


class AdvocateJWTAuthentication(authentication.BaseAuthentication):
    keyword = 'Bearer'

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).decode('utf-8')
        if not header or not header.startswith(self.keyword + ' '):
            return None  # no credentials -> DRF treats as unauthenticated

        token = header[len(self.keyword) + 1:].strip()
        try:
            payload = decode_token(token)
        except jwt.ExpiredSignatureError:
            raise exceptions.AuthenticationFailed('Token expired')
        except jwt.PyJWTError:
            raise exceptions.AuthenticationFailed('Invalid token')

        advocate_id = payload.get('advocateId')
        email = payload.get('sub') or payload.get('email')
        advocate = None
        if advocate_id is not None:
            advocate = Advocate.objects.filter(id=advocate_id).first()
        if advocate is None and email:
            advocate = Advocate.objects.filter(email=email).first()
        if advocate is None:
            raise exceptions.AuthenticationFailed('Advocate not found')
        # An advocate who has left a practice keeps their row - their work
        # stays with the practice and stays reachable - but must not keep
        # access. Checked here so every endpoint is covered by one gate, and
        # any token issued before they left stops working immediately.
        if getattr(advocate, 'left_on', None) is not None:
            raise exceptions.AuthenticationFailed(
                'This account is no longer active.')

        # Cache permissions/roles on the request to avoid recomputing per check.
        request._advocate_permissions = advocate.permission_codes()
        return (advocate, token)

    def authenticate_header(self, request):
        return self.keyword
