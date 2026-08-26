"""Reproduces the Spring @RequirePermission gate. Use RequirePermission('CODE')
(OR semantics across multiple codes) as a DRF permission_class.

RequirePermission() with NO codes means "any signed-in advocate" - it still
requires authentication. That matters because assigning it to
`permission_classes` REPLACES the project-wide IsAuthenticated default
(settings.REST_FRAMEWORK), so if it returned True unconditionally it would
hand out anonymous access rather than merely skipping the permission check.
Endpoints that are genuinely public use AllowAny explicitly instead (see
accounts/views.py, core/views.py).
"""

from rest_framework.permissions import BasePermission


def _is_authenticated(request):
    user = getattr(request, 'user', None)
    return user is not None and getattr(user, 'is_authenticated', False)


def _perms(request):
    cached = getattr(request, '_advocate_permissions', None)
    if cached is not None:
        return cached
    if not _is_authenticated(request):
        return set()
    perms = request.user.permission_codes()
    request._advocate_permissions = perms
    return perms


def RequirePermission(*codes, require_all=False):
    class _Perm(BasePermission):
        message = 'Access denied: missing required permission.'

        def has_permission(self, request, view):
            # Authentication first, always: a missing/invalid Authorization
            # header leaves an anonymous request, which must never pass.
            if not _is_authenticated(request):
                return False
            if not codes:
                return True
            have = _perms(request)
            if require_all:
                return all(c in have for c in codes)
            return any(c in have for c in codes)

    return _Perm
