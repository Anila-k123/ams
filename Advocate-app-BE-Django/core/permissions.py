"""Reproduces the Spring @RequirePermission gate. Use RequirePermission('CODE')
(OR semantics across multiple codes) as a DRF permission_class.
"""

from rest_framework.permissions import BasePermission


def _perms(request):
    cached = getattr(request, '_advocate_permissions', None)
    if cached is not None:
        return cached
    user = getattr(request, 'user', None)
    if user is None or not getattr(user, 'is_authenticated', False):
        return set()
    perms = user.permission_codes()
    request._advocate_permissions = perms
    return perms


def RequirePermission(*codes, require_all=False):
    class _Perm(BasePermission):
        message = 'Access denied: missing required permission.'

        def has_permission(self, request, view):
            if not codes:
                return True
            have = _perms(request)
            if require_all:
                return all(c in have for c in codes)
            return any(c in have for c in codes)

    return _Perm
