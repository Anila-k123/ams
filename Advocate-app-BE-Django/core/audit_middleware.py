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

import json
import logging
import re

from django.utils import timezone

from core import audit_diff
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
# Past tense for the human-readable feed line.
PAST = {'CREATE': 'Created', 'UPDATE': 'Updated', 'DELETE': 'Deleted'}

# Path segments that are actions rather than nouns, so they never name the
# thing that changed ("/api/cases/create" is a Case, not a "Create").
_NOT_A_NOUN = {
    'create', 'update', 'delete', 'pay', 'restore', 'validate', 'download',
    'upload', 'read', 'send', 'test', 'resend', 'search', 'my-cases',
    'my-invoices', 'my-activities', 'bulk', 'export', 'import', 'api',
}


def _entity_label(path):
    """The noun a request acted on - the last path segment that names a thing.

    /api/workspace/cases/25/tags -> "tags"   (a tag, not "workspace")
    /api/cases/create            -> "cases"
    """
    parts = [p for p in path.strip('/').split('/') if p]
    for seg in reversed(parts):
        if seg.isdigit() or seg.lower() in _NOT_A_NOUN:
            continue
        return seg.replace('-', ' ').replace('_', ' ')
    return ''


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
        # Collect field-level changes for the duration of this request, but
        # only for the methods that can produce any - no point paying for a
        # pre_save read on a GET.
        collecting = self._in_scope(request)
        if collecting:
            audit_diff.begin()
        try:
            response = self.get_response(request)
        finally:
            changes = audit_diff.end() if collecting else []
        try:
            self._record(request, response, changes)
        except Exception:                                    # noqa: BLE001
            # An audit failure must never break the request it is describing.
            log.exception('audit: failed to record %s %s', request.method, request.path)
        return response

    @staticmethod
    def _in_scope(request):
        path = request.path or ''
        return (request.method in TRACKED_METHODS
                and path.startswith('/api/')
                and not any(path.startswith(p) for p in SKIP_PATHS))

    def _record(self, request, response, changes=()):
        if not self._in_scope(request):
            return
        path = request.path or ''
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
        verb = VERB.get(request.method, request.method)
        # "<MODULE>_<VERB>" rather than a bare verb: it makes the audit
        # screen's actionType filter useful, and the activity feed derives its
        # icon from the module prefix (CASE.../CLIENT.../INVOICE...).
        action = f'{module}_{verb}'
        noun = _entity_label(path)
        past = PAST.get(verb, verb.title())
        # "Created a tag" reads better than "Created in Workspace", which is
        # all the URL prefix alone can tell you.
        summary = f'{past} a {noun[:-1] if noun.endswith("s") else noun}' if noun             else f'{past} in {module.title().replace("_", " ")}'
        ok = 200 <= code < 400
        agent = (request.META.get('HTTP_USER_AGENT') or '')[:255]

        # Name the fields that changed, so the trail reads "Updated a client
        # (phone, city)" instead of leaving you to guess.
        changed_note = audit_diff.summarise(changes) if changes else ''
        if changed_note:
            summary = f'{summary} {changed_note}'

        # A create has no id in its URL, so the only way this row can point at
        # the record is the pk the save signal saw.
        entity_id = int(entity.group(1)) if entity else None
        if entity_id is None:
            entity_id = audit_diff.primary_id(changes)

        AuditLog.objects.create(
            action_type=action,
            title=summary[:255],
            # description is varchar(2000), so the request line fits easily and
            # a count of what was touched is worth carrying alongside it.
            description=self._description(request, path, code, changes),
            module=module,
            entity_type=module[:50],
            entity_id=entity_id,
            status='SUCCESS' if ok else 'FAILED',
            user_name=(getattr(user, 'email', '') or '')[:255],
            ip_address=_client_ip(request),
            device=agent,
            browser=agent,
            operating_system='',
            request_method=request.method,
            request_uri=path[:500],
            # The before/after values. metadata is an unbounded text column and
            # the audit API already returns it, so this is where the detail
            # lives rather than in a truncated description.
            metadata=json.dumps({'changes': list(changes)}, default=str) if changes else None,
            created_at=timezone.now(),
            advocate_id=advocate_id,
        )

        # The Activity feed is a human-readable subset: successful changes only.
        if ok:
            Activity.objects.create(
                action_type=action,
                description=summary[:255],
                timestamp=timezone.now(),
                advocate_id=advocate_id,
            )

    @staticmethod
    def _description(request, path, code, changes):
        line = f'{request.method} {path} -> {code}'
        if not changes:
            return line[:2000]
        counts = {}
        for r in changes:
            counts[r.get('action', '?')] = counts.get(r.get('action', '?'), 0) + 1
        tail = ', '.join(f'{n} {a}' for a, n in sorted(counts.items()))
        return f'{line} | {tail}'[:2000]
