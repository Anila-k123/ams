"""Alert a practice when one of its matters appears in a day's cause list.

The cause list is fetched and stored by `sync_causelist`; this turns each match
between a stored listing and one of the practice's cases into a notification -
in-app for everyone, email for those who opted in - so the advocate handling the
matter (and their juniors, who often attend) learn "you are listed, Court 5,
item 40" without opening the app.

Reuses the same machinery as the other reminders: `matching` to join cases to
listings, and `events.fanout` to reach the whole practice, deduped per member.
A cause-list listing IS the court scheduling a hearing, so it rides the existing
HEARING_SCHEDULED type - no new notification type (and no DB check-constraint
change on the Spring-owned tables).
"""

from __future__ import annotations

import datetime
import logging

from django.utils import timezone

from notifications import service
from notifications.events import fanout

log = logging.getLogger(__name__)


def _when_text(on, today):
    if on == today:
        return 'today'
    if on == today + datetime.timedelta(days=1):
        return 'tomorrow'
    return 'on ' + on.strftime('%d %b %Y')


def causelist_alerts(on, court=None, labels=None):
    """Notify practices of their cases listed on `on`.

    Scoped to `court` when given (the one just synced), so a single sync only
    scans and alerts its own listings; global otherwise. `labels` maps a court
    key to its display name for the message - best-effort, falls back to the key.

    Deduped per (case, date, recipient): the entity id encodes both the case and
    the list date (case.id * 1e6 + yymmdd), so re-running a sync never re-alerts,
    yet a genuinely new listing date for the same case does.
    """
    from core.models import Case
    from courtsearch.matching import identities_for
    from courtsearch.models import CauseListItem

    rows = CauseListItem.objects.filter(list_date=on)
    if court:
        rows = rows.filter(court=court)
    rows = list(rows)
    if not rows:
        return []

    by_key = {}
    for r in rows:
        by_key.setdefault((r.court, r.case_type, r.case_no, r.case_year), []).append(r)

    labels = labels or {}
    today = timezone.now().date()
    when = _when_text(on, today)
    ymd = int(on.strftime('%y%m%d'))
    since = timezone.now() - datetime.timedelta(days=60)

    cases = list(Case.objects.filter(deleted=False).select_related('advocate'))
    identities = identities_for(cases)

    queued = []
    for case in cases:
        identity = identities.get(case.id)
        if not identity or not identity['court']:
            continue
        if court and identity['court'] != court:
            continue

        hits = {}
        for key in identity['keys']:
            for hit in by_key.get((identity['court'],) + key, ()):
                hits[hit.id] = hit
        if not hits:
            continue

        def _order(r):
            room = r.court_number
            room_key = (0, int(room)) if room.isdigit() else (1, room)
            try:
                item_key = tuple(int(p) for p in str(r.item_number).split('.'))
            except ValueError:
                item_key = (10 ** 9,)
            return (room_key, item_key)

        listed = sorted(hits.values(), key=_order)
        first = listed[0]
        title = case.case_title or case.case_number
        court_label = labels.get(identity['court'], identity['court'])
        rooms = ', '.join(sorted({r.court_number for r in listed}))
        extra = '' if len(listed) == 1 else ' (+{} more listing(s))'.format(len(listed) - 1)

        subject = 'Listed {}: {}'.format(when, title)
        body = (
            'Your matter is listed {when}.\n\n'
            'Case  : {title}\n'
            'Court : {court}\n'
            'Room  : Court {room}{extra}\n'
            'Item  : {item}\n'
            'Listed: {as_listed}\n'
            'Date  : {date}\n'
        ).format(when=when, title=title, court=court_label, room=rooms,
                 extra=extra, item=first.item_number,
                 as_listed=first.case_string, date=on.strftime('%d %b %Y'))

        # One id per (case, list date), so re-runs dedup but a new date re-alerts.
        entity_id = case.id * 1_000_000 + ymd
        # Only people who work the case (CASE_VIEW) - not the firm-wide
        # accountant/receptionist who share the team's other data.
        queued += fanout(
            case.advocate, 'HEARING_SCHEDULED', subject, body, since,
            entity='CAUSELIST', entity_id=entity_id, case_id=case.id,
            require_permission='CASE_VIEW', triggered_by='SCHEDULED')

    if queued:
        # Deliver now rather than waiting for the queue drain: this runs from the
        # sync command, and "you are listed today" is worthless an hour late.
        # send_now never raises and leaves anything it can't send PENDING for the
        # scheduled retry, so it is safe to call inline.
        service.send_now(queued)
        log.info('causelist_alerts: %s delivered for %s (court=%s)',
                 len(queued), on, court or 'all')
    return queued
