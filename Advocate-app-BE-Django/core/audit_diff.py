"""Field-level change capture for the audit trail.

The middleware can only see the HTTP request, so it could say "Updated a
client" but never which field changed, or from what to what. On a delete it was
worse: the row was gone and the trail held nothing about it, so "who deleted
this?" had an answer and "what did we lose?" did not.

Model signals see the values. pre_save reads the row as it stands in the
database, post_save compares it with what was written, and pre_delete takes a
snapshot while the row still exists. Each request collects its changes in a
thread-local and AuditLogMiddleware writes them into audit_log.metadata, which
is an unbounded text column already surfaced by the audit API.

Registered for every model except the exclusions below, so a new feature is
covered without anyone remembering to add it.

Two things this deliberately does not do:

  * Raw SQL is invisible to signals. In this codebase that means the backup
    service and the prune command; both already write their own audit entry.
    Anything added later that writes with a cursor will not be captured here.

  * Values are redacted and truncated (see SENSITIVE and MAX_VALUE). An audit
    trail holding plaintext passwords or whole documents would be a liability,
    not a control.
"""

from __future__ import annotations

import datetime
import decimal
import logging
import threading
import uuid

from django.apps import apps
from django.db.models.signals import post_save, pre_delete, pre_save

log = logging.getLogger(__name__)

_local = threading.local()

# Never record the value of a field whose name contains one of these. The
# trail records that a password changed, never what it changed to.
# 'signature' is deliberately absent: the only fields it matched were
# advocate.signature_path (a file path) and communication_settings.
# email_signature (the sign-off on outgoing mail). Neither is a secret, and
# hiding a settings change nobody can then explain is its own problem.
SENSITIVE = ('password', 'passwd', 'secret', 'token', 'otp', 'api_key',
             'apikey', 'private_key', 'salt', 'credential')

# Long text (document bodies, AI answers, scraped case HTML) is summarised
# rather than copied. The point is to show that it changed and roughly how.
MAX_VALUE = 300

# Cap per request so a bulk operation cannot write a megabyte of metadata.
MAX_RECORDS = 50

REDACTED = '***'

# Models excluded from capture:
#   - the audit tables themselves, or writing an entry would trigger capture
#     of that entry, forever
#   - notification plumbing, which is high-volume and already recorded as
#     delivery history plus its own audit line
#   - Django's own bookkeeping, which is not business activity
EXCLUDED = {
    'core.AuditLog', 'core.Activity',
    'core.Notification', 'core.NotificationQueue', 'core.NotificationHistory',
    'admin.LogEntry', 'sessions.Session', 'contenttypes.ContentType',
    'auth.Permission', 'auth.Group', 'auth.User',
}


# -- request scope ----------------------------------------------------------

def begin():
    """Start collecting for one request."""
    _local.records = []
    _local.active = True


def end():
    """Stop collecting and hand back what was seen."""
    records = getattr(_local, 'records', [])
    _local.records = []
    _local.active = False
    return records


def _collecting():
    return getattr(_local, 'active', False)


def _add(record):
    records = getattr(_local, 'records', None)
    if records is None or len(records) >= MAX_RECORDS:
        return
    records.append(record)


# -- value handling ---------------------------------------------------------

def _is_sensitive(name):
    low = name.lower()
    return any(s in low for s in SENSITIVE)


def _clean(value):
    """A JSON-safe, bounded representation of one field value."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return '<{} bytes>'.format(len(bytes(value)))
    text = str(value)
    if len(text) > MAX_VALUE:
        # Say how much was dropped: "changed" is more useful when you can see
        # it went from a paragraph to a page.
        return text[:MAX_VALUE] + '... [{} chars total]'.format(len(text))
    return text


def _field_names(model):
    return [f.attname for f in model._meta.concrete_fields]


def _snapshot(instance):
    """Current in-memory values of one instance, redacted and bounded."""
    out = {}
    for name in _field_names(type(instance)):
        if _is_sensitive(name):
            out[name] = REDACTED
            continue
        try:
            out[name] = _clean(getattr(instance, name, None))
        except Exception:                                    # noqa: BLE001
            # A deferred or broken descriptor must not break the save.
            continue
    return out


def _label(model):
    """'clients' rather than 'core.Client' - the table is what people mean."""
    try:
        return model._meta.db_table
    except Exception:                                        # noqa: BLE001
        return model.__name__


# -- signal handlers --------------------------------------------------------

def _pre_save(sender, instance, **kwargs):
    """Stash the row as the database currently holds it."""
    if not _collecting() or instance.pk is None:
        return
    try:
        old = sender.objects.filter(pk=instance.pk).values().first()
    except Exception:                                        # noqa: BLE001
        old = None
    # Attribute, not a dict keyed by pk: two instances of the same row being
    # saved in one request each keep their own baseline.
    instance._audit_old = old


def _post_save(sender, instance, created, **kwargs):
    if not _collecting():
        return
    try:
        if created:
            _add({
                'table': _label(sender),
                'id': instance.pk,
                'action': 'created',
                'values': _snapshot(instance),
            })
            return

        old = getattr(instance, '_audit_old', None)
        if old is None:
            # Updated a row we never saw beforehand (created and saved again in
            # the same request, or a save on an unloaded instance). Record the
            # update without inventing a baseline.
            _add({'table': _label(sender), 'id': instance.pk,
                  'action': 'updated', 'changes': {}, 'note': 'previous values unavailable'})
            return

        changes = {}
        for name in _field_names(sender):
            if name not in old:
                continue
            before = old[name]
            after = getattr(instance, name, None)
            # Compare cleaned values: the DB gives Decimal/datetime, the
            # instance may hold str/int for the same value, and a spurious
            # "changed" entry is worse than none.
            cb, ca = _clean(before), _clean(after)
            if cb == ca:
                continue
            if _is_sensitive(name):
                changes[name] = {'from': REDACTED, 'to': REDACTED}
            else:
                changes[name] = {'from': cb, 'to': ca}

        if changes:
            _add({'table': _label(sender), 'id': instance.pk,
                  'action': 'updated', 'changes': changes})
    except Exception:                                        # noqa: BLE001
        log.exception('audit_diff: post_save capture failed for %s', sender)


def _pre_delete(sender, instance, **kwargs):
    """Snapshot the row while it still exists - the only chance to."""
    if not _collecting():
        return
    try:
        _add({
            'table': _label(sender),
            'id': instance.pk,
            'action': 'deleted',
            # The whole row, because after this there is nothing left to ask.
            'values': _snapshot(instance),
        })
    except Exception:                                        # noqa: BLE001
        log.exception('audit_diff: pre_delete capture failed for %s', sender)


# -- registration -----------------------------------------------------------

def register():
    """Connect the handlers to every model that is not excluded."""
    connected = 0
    for model in apps.get_models():
        label = '{}.{}'.format(model._meta.app_label, model.__name__)
        if label in EXCLUDED:
            continue
        uid = 'audit_diff:{}'.format(label)
        pre_save.connect(_pre_save, sender=model, dispatch_uid=uid, weak=False)
        post_save.connect(_post_save, sender=model, dispatch_uid=uid, weak=False)
        pre_delete.connect(_pre_delete, sender=model, dispatch_uid=uid, weak=False)
        connected += 1
    log.info('audit_diff: capturing changes on %s model(s)', connected)
    return connected


# -- summarising for the audit row -----------------------------------------

def summarise(records):
    """A short human-readable tail for the audit title, e.g. "(phone, city)"."""
    for r in records:
        if r.get('action') == 'updated' and r.get('changes'):
            names = list(r['changes'].keys())
            shown = ', '.join(n.replace('_', ' ') for n in names[:4])
            if len(names) > 4:
                shown += ' +{} more'.format(len(names) - 4)
            return '({})'.format(shown)
    return ''


def primary_id(records):
    """The record this request was really about, for audit_log.entity_id.

    A create is the best answer when there is one: the URL for a create has no
    id in it, so this is the only way the audit row can point at the new row.
    """
    for action in ('created', 'deleted', 'updated'):
        for r in records:
            if r.get('action') == action and r.get('id') is not None:
                return r['id']
    return None
