"""Writes the audit trail.

Nothing in the Django backend ever inserted into `audit_log` or `activities` -
both tables only held rows left behind by the old Spring app, so the audit
screen was frozen and the Activity feed was permanently empty.

Doing this as middleware rather than a call in every view means one place
covers all ~20 apps, and no mutation can be forgotten. Only state-changing
requests are recorded; GETs are ignored (an audit trail of every page view is
noise, and it would treble the row count).

Deliberately NOT recorded: request bodies. They carry passwords, OTPs and
document contents. Only who/what/when/where - method, path, status, actor, IP
and user agent.
"""

import logging
import re

from django.utils import timezone

from core.models import AuditLog, Activity

log = logging.getLogger(__name__)

TRACKED_METHODS = {'POST', 'PUT', 'PATCH', 'DELETE'}

# Auth/credential endpoints: a row saying "someone tried to log in" is fine,
# but these are high-volume and the interesting failures are already logged by
# the auth layer. Skipped to keep the trail about business actions.
SKIP_PATHS = (
    '/api/advocates/login', '/api/advocates/signup',
    '/api/auth/', '/api/password', '/api/otp',
)

# /api/<module>/... -> module name for the audit row, e.g. "CASES".
_MODULE_RE = re.compile(r'^/api/([a-z0-9\-]+)')
# trailing numeric id, so we can record which record was touched
_ENTITY_RE = re.compile(r'/(\d+)(?:/|$)')

VERB = {'POST': 'CREATE', 'PUT': 'UPDATE', 'PATCH': 'UPDATE', 'DELETE': 'DELETE'}


def _client_ip(request):
    fwd = request.META.get('HTTP_X_FORWARDED_FOR')
    if fwd:
        return fwd.split(',')[0].strip()[:255]
    return (request.META.get('REMOTE_ADDR') or '')[:255]


class AuditLogMiddleware:
    """Record every successful state change against the acting advocate."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        try:
            self._record(request, response)
        except Exception:                                    # noqa: BLE001
            # An audit failure must never break the request it is describing.
            log.exception('audit: failed to record %s %s', request.method, request.path)
        return response

    def _record(self, request, response):
        if request.method not in TRACKED_METHODS:
            return
        path = request.path or ''
        if not path.startswith('/api/') or any(path.startswith(p) for p in SKIP_PATHS):
            return
        # DRF populates request.user during view dispatch, so by now an
        # authenticated call has a real advocate; anonymous ones are skipped
        # (there is nobody to attribute the action to).
        user = getattr(request, 'user', None)
        advocate_id = getattr(user, 'id', None) if getattr(user, 'is_authenticated', False) else None
        if advocate_id is None:
            return

        code = getattr(response, 'status_code', 0)
        module = (_MODULE_RE.match(path).group(1).upper().replace('-', '_')
                  if _MODULE_RE.match(path) else 'API')
        entity = _ENTITY_RE.search(path)
        action = VERB.get(request.method, request.method)
        ok = 200 <= code < 400
        agent = (request.META.get('HTTP_USER_AGENT') or '')[:255]

        AuditLog.objects.create(
            action_type=action,
            title=f'{action.title()} in {module.title()}',
            description=f'{request.method} {path} -> {code}'[:255],
            module=module,
            entity_type=module,
            entity_id=int(entity.group(1)) if entity else None,
            status='SUCCESS' if ok else 'FAILED',
            user_name=(getattr(user, 'email', '') or '')[:255],
            ip_address=_client_ip(request),
            device=agent,
            browser=agent,
            operating_system='',
            request_method=request.method,
            request_uri=path[:255],
            metadata=None,
            created_at=timezone.now(),
            advocate_id=advocate_id,
        )

        # The Activity feed is a human-readable subset: successful changes only.
        if ok:
            Activity.objects.create(
                action_type=action,
                description=f'{action.title()} in {module.title()}'[:255],
                timestamp=timezone.now(),
                advocate_id=advocate_id,
            )
