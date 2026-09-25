"""The deny-by-default gate for client users.

AMS permissions mean "all of this practice's X", so a client must never reach the
firm's endpoints. Every authentication path calls enforce(): for a client user it
records request.client_id and refuses (403) anything not on CLIENT_ALLOWLIST.
Endpoints added later are therefore blocked for clients automatically.
"""

import re

from rest_framework import exceptions

from .models import ClientUser

# (method, path regex). Everything under /api/client/ is the client's own, scoped API.
CLIENT_ALLOWLIST = [
    (None, r'^/api/client/'),
    ('GET', r'^/api/advocates/my-permissions/?$'),
    ('GET', r'^/api/advocates/my-roles/?$'),
    ('GET', r'^/api/advocates/profile/?$'),
    ('POST', r'^/api/advocates/logout/?$'),
    ('PUT', r'^/api/profile/change-password/?$'),
    ('PUT', r'^/api/profile/preferences/?$'),
]
_COMPILED = [(m, re.compile(p)) for m, p in CLIENT_ALLOWLIST]
CLIENT_ROLE = 'Client'


def client_link(advocate):
    """The ClientUser row if this advocate is a client login, else None (cached on the object)."""
    if advocate is None:
        return None
    if not hasattr(advocate, '_client_link'):
        advocate._client_link = ClientUser.objects.filter(advocate_id=advocate.id).first()
    return advocate._client_link


def is_client(advocate):
    return client_link(advocate) is not None


def allowed(method, path):
    return any((m is None or m == method) and rx.search(path) for m, rx in _COMPILED)


def enforce(request, advocate, allow_paths=True):
    """Call right after an advocate is authenticated. allow_paths=False refuses every
    path (used by auth paths clients must never use)."""
    link = client_link(advocate)
    if link is None:
        return
    request.client_id = link.client_id
    django_request = getattr(request, '_request', request)
    django_request.client_id = link.client_id
    if not allow_paths or not allowed(request.method, request.path):
        raise exceptions.PermissionDenied('This page is not available for client accounts.')


def client_advocate_ids():
    """Advocate ids that are client logins (a subquery-friendly queryset)."""
    return ClientUser.objects.values_list('advocate_id', flat=True)


def is_client_id(advocate_id):
    return ClientUser.objects.filter(advocate_id=advocate_id).exists()


def client_role_ids():
    from core.models import Role
    return list(Role.objects.filter(name__iexact=CLIENT_ROLE).values_list('id', flat=True))
