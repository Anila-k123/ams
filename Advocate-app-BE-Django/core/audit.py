"""Audit entries for work nobody clicked.

AuditLogMiddleware covers requests: someone pressed a button, so there is a
method, a path and an actor. The scheduled jobs have none of those, and their
output only ever reached a .log file on the server. From the System Activity
screen the nightly appeal sweep and the notification queue looked like nothing
had happened - which is exactly the wrong impression when the question being
asked is "why did this case get flagged?" or "was the client actually told?".

So the jobs record here too, against the advocate whose data they touched, with
user_name = SYSTEM. One screen then tells the whole story, and the existing
module/action filters keep working because the action codes follow the same
<MODULE>_<VERB> shape the middleware uses.

Failures are swallowed on purpose: a job must not die because its audit row
could not be written.
"""

import logging

from django.utils import timezone

from core.models import AuditLog, Activity

log = logging.getLogger(__name__)

SYSTEM_USER = 'SYSTEM'


def record_system_action(advocate_id, module, verb, title, description='',
                         entity_type=None, entity_id=None, ok=True,
                         in_feed=True):
    """Log one thing a scheduled job did.

    advocate_id  whose data was touched (required - the tables are scoped)
    module       'APPEALS', 'NOTIFICATIONS', ... (becomes the module filter)
    verb         'CREATE' / 'UPDATE' / 'DELETE' / 'SEND' / 'SCAN' / 'PRUNE'
    title        the human-readable line, e.g. "Detected a possible appeal"
    in_feed      also show in the Activity feed (skip for high-volume noise)
    """
    if not advocate_id:
        return
    module = (module or 'SYSTEM').upper()
    action = '{}_{}'.format(module, (verb or 'UPDATE').upper())
    now = timezone.now()
    try:
        AuditLog.objects.create(
            action_type=action,
            title=title[:255],
            description=(description or title)[:255],
            module=module,
            entity_type=(entity_type or module)[:255],
            entity_id=entity_id,
            status='SUCCESS' if ok else 'FAILED',
            user_name=SYSTEM_USER,
            # No request behind this, so no IP or browser to record. Left blank
            # rather than filled with a plausible-looking placeholder.
            ip_address='',
            device='scheduled-task',
            browser='',
            operating_system='',
            request_method='',
            request_uri='',
            metadata=None,
            created_at=now,
            advocate_id=advocate_id,
        )
        # in_feed is the caller's decision, not a consequence of ok: a failed
        # delivery is precisely the thing an advocate should see in the feed,
        # while a routine successful send is noise there.
        if in_feed:
            Activity.objects.create(
                action_type=action,
                description=title[:255],
                timestamp=now,
                advocate_id=advocate_id,
            )
    except Exception:                                        # noqa: BLE001
        log.exception('audit: failed to record system action %s', action)
