"""Court orders brought into PactPro automatically (docs/ORDER_SYNC.md).

sync_cycle() (run every 30 minutes in court hours by `manage.py run_order_sync`, the "PactPro Order Sync"
task) re-reads imported cases' court records, oldest-checked first, with today's listed cases ahead of the
rest; disposed cases only weekly. take_new_orders() compares the record's orders with the ones already known
(CaseOrderSync) and, for each new one: saves its PDF to the case's Documents (shared with the client), tells
the advocate and their team (in-app, plus email by their own preference), and emails the client, which
also shows in their portal Messages. The case page's Refresh does the same through take_new_orders().
"""
import datetime
import logging
import time

from django.db import transaction
from django.utils import timezone

from . import client
from .models import CaseOrderSync, ImportedCaseRecord
from .orders import fetch_pdf, label, order_entries

log = logging.getLogger(__name__)

EVENT = 'COURT_ORDER_NEW'
DISPOSED = ('closed', 'disposed', 'decided')
DISPOSED_EVERY = datetime.timedelta(days=7)
RECENT_KEEP = 20
# Between two cases: the court sites are slow and rate-limit; one case at a time, with a breath.
PAUSE_SECONDS = 3


def take_new_orders(rec, old_raw=None):
    """The record's orders not seen before for its case: saved, announced, and remembered. Returns them.

    The first time a case is looked at, what is already there is only recorded (from `old_raw` when the
    page's Refresh brought the change, else from the record itself), so old orders never raise alerts."""
    if not rec.case_id:
        return []
    entries = order_entries(rec.court_id, rec.raw)
    with transaction.atomic():
        state = CaseOrderSync.objects.select_for_update().filter(case_id=rec.case_id).first()
        if state is None:
            baseline = order_entries(rec.court_id, old_raw) if old_raw is not None else entries
            state = CaseOrderSync.objects.create(case_id=rec.case_id, known_keys=[e['key'] for e in baseline])
        known = set(state.known_keys or [])
        new = [e for e in entries if e['key'] not in known]
        state.known_keys = list(dict.fromkeys([*state.known_keys, *(e['key'] for e in entries)]))
        state.checked_at = timezone.now()
        state.last_error = ''
        state.save(update_fields=['known_keys', 'checked_at', 'last_error'])
    if not new:
        return []
    from core.models import Case
    case = Case.objects.select_related('advocate', 'client').filter(id=rec.case_id, deleted=False).first()
    if case is None:
        return []
    from cases.closure import STOPPED, mode
    quiet = mode(case) == STOPPED                          # closed: we no longer act / settled - tell nobody
    found = []
    for e in new:
        doc_id = _save_pdf(rec, case, e)
        found.append({'key': e['key'], 'label': label(e), 'number': e.get('number'), 'date': e.get('date'), 'documentId': doc_id,
                      'foundAt': timezone.now().isoformat()})
    if not quiet:
        _announce(case, found)
    state = CaseOrderSync.objects.get(case_id=rec.case_id)
    state.recent = (found + list(state.recent or []))[:RECENT_KEEP]
    state.last_new_at = timezone.now()
    state.save(update_fields=['recent', 'last_new_at'])
    log.info('order sync: case %s has %d new order(s)', case.id, len(found))
    return found


def _save_pdf(rec, case, entry):
    """The order's PDF in the case's Documents (once: keyed by the order), shared with the client. None when
    the court has no PDF for it yet or it can't be fetched now (the alert still goes out)."""
    from django.core.files.uploadedfile import SimpleUploadedFile
    from core.models import Document
    ref = f'court-order:{case.id}:{entry["key"]}'
    existing = Document.objects.filter(external_ref=ref).values_list('id', flat=True).first()
    if existing:
        return existing
    data = fetch_pdf(rec, entry)
    if data is None:
        return None
    from documents.storage import create_document
    name = f'{case.case_number or "Case"} - {label(entry)}'[:200]
    safe = ''.join(ch if ch.isalnum() or ch in ' -_.()' else '_' for ch in name).strip()[:120] or 'order'
    try:
        doc = create_document(case.advocate, SimpleUploadedFile(f'{safe}.pdf', data, content_type='application/pdf'),
                              document_name=name, category='Order',     # the case's Orders tab lists these
                              description='Saved automatically from the court record.',
                              case=case, client=case.client, external_ref=ref)
    except Exception as exc:                               # noqa: BLE001 - storage limit, disk: still announce
        log.warning('order sync: PDF for case %s not saved: %s', case.id, type(exc).__name__)
        return None
    Document.objects.filter(id=doc.id).update(client_visible=True)   # court orders are the client's too
    return doc.id


def _announce(case, found):
    """The advocate and their team (once each, per order), then the client by email (and so the portal)."""
    from core.practice import case_alert_permission
    from core.tenant import firm_id_of_advocate
    from notifications import events, service
    label_case = case.case_number or case.case_title or f'Case #{case.id}'
    names = '\n'.join(f'- {f["label"]}' for f in found)
    many = len(found) > 1
    subject = f'New order{"s" if many else ""} - {label_case}'
    saved = any(f['documentId'] for f in found)
    firm_id = firm_id_of_advocate(case.advocate_id)
    team_body = (f'{"New orders were" if many else "A new order was"} found in the court record of {label_case}'
                 f'{" (" + case.case_title + ")" if case.case_title and case.case_title != label_case else ""}:\n\n'
                 f'{names}\n\n'
                 + ('Saved to the case\'s Documents and shared with the client.' if saved
                    else 'Open the case\'s court record to read it.'))
    # One alert listing them all; `period` (the orders' keys) makes it once per person for these orders.
    period = ','.join(sorted(f['key'] for f in found))
    events.fanout(case.advocate, EVENT, subject, team_body, timezone.now(), entity='CourtOrder',
                  entity_id=case.id, require_permission=case_alert_permission(),
                  period=period[:120], firm_id=firm_id, case_id=case.id)
    if case.client is not None:
        from notifications.client_events import _greet, _sign_off
        body = '\n'.join([_greet(case.client), '',
                          f'The court has issued {"new orders" if many else "a new order"} in your case {label_case}:',
                          '', names, '',
                          ('You can read and download it in your client portal (Documents).' if saved
                           else 'We will share a copy with you.'),
                          _sign_off(case.advocate)])
        service.notify_client(case.advocate_id, case.client, EVENT, subject, body,
                              case_id=case.id, entity='CourtOrder', entity_id=case.id)


# --- the cycle -------------------------------------------------------------------------------------------

def _listed_today_case_ids(today):
    """Cases in today's cause lists: their orders are the likeliest to appear today."""
    try:
        from core.models import Case
        from .matching import identities_for
        from .models import CauseListItem
        keys = {(r.court, r.case_type, r.case_no, r.case_year)
                for r in CauseListItem.objects.filter(list_date=today)}
        if not keys:
            return set()
        cases = list(Case.objects.filter(deleted=False))
        out = set()
        for cid, ident in identities_for(cases).items():
            if ident and ident.get('court') and any((ident['court'],) + k in keys for k in ident['keys']):
                out.add(cid)
        return out
    except Exception:                                      # noqa: BLE001 - only an ordering hint
        log.exception('order sync: could not read today\'s cause lists')
        return set()


# Built to grow with the number of firms: a court case is fetched once however many firms / imports track it
# (court_identity), a few are fetched at once (ORDER_SYNC_WORKERS), and only what can have news is checked
# every round: suspended firms and lapsed subscriptions are skipped, quiet cases (no hearing within two weeks
# either side, not listed today, no new order for a month) once a day, disposed ones once a week.

QUIET_WINDOW = datetime.timedelta(days=14)
QUIET_EVERY = datetime.timedelta(hours=20)                 # "once a day", whatever the round times
RECENT_ORDER = datetime.timedelta(days=30)


def court_identity(rec):
    """Which court case a record is: its CNR (eCourts) or diary number (Supreme Court), else the search it
    was imported with. Records of different firms / imports with one identity are fetched once."""
    import json
    raw = rec.raw if isinstance(rec.raw, dict) else {}
    query = rec.query if isinstance(rec.query, dict) else {}
    if rec.court_id == 'sci' and query.get('diary_no'):
        return f'sci:{query.get("diary_no")}/{query.get("diary_year")}'
    cnrs = []
    for c in raw.get('cases') or []:
        d = (c or {}).get('detail') or {}
        cnr = d.get('cnr_number')
        if not cnr and isinstance(d.get('case_details'), dict):
            cnr = (d['case_details'].get('CNR Number') or '').split(' ')[0]
        if cnr:
            cnrs.append(cnr.strip().upper())
    if cnrs:
        return f'{rec.court_id}:{",".join(sorted(cnrs))}'
    return f'{rec.court_id}:q:{json.dumps(query, sort_keys=True, default=str)}'


def _firm_running(advocate_id, cache):
    """The case's firm is active and, in firm mode, its subscription isn't read-only (lapsed, suspended,
    pending): nobody there could act on a new order, so it isn't fetched for them."""
    if advocate_id in cache:
        return cache[advocate_id]
    from django.conf import settings
    from core.tenant import firm_active, firm_id_of_advocate
    firm_id = firm_id_of_advocate(advocate_id)
    ok = firm_active(firm_id)
    if ok and firm_id and getattr(settings, 'TENANCY_MODE', 'legacy') == 'firm':
        from subscriptions.service import READ_ONLY, effective_status, subscription_of
        ok = effective_status(subscription_of(firm_id)) not in READ_ONLY
    cache[advocate_id] = ok
    return ok


def due_groups(now=None):
    """What this round fetches: [{identity, records}], one per court case, in the order to check them (a
    case listed today first, then the longest unchecked)."""
    from core.models import Case, CaseEvent
    now = now or datetime.datetime.now()
    today = now.date()
    latest = {}
    for rec in ImportedCaseRecord.objects.exclude(case_id=None).order_by('id'):
        latest[rec.case_id] = rec                          # a later import of a case replaces the earlier one
    if not latest:
        return []
    cases = {c.id: c for c in Case.objects.filter(id__in=latest, deleted=False).only('id', 'status', 'advocate_id')}
    states = {s.case_id: s for s in CaseOrderSync.objects.filter(case_id__in=latest)}
    from cases.closure import stopped_case_ids
    stopped = stopped_case_ids(latest)                     # closed: no longer acting / settled - not watched
    hearing_soon = set(CaseEvent.objects.filter(case_id__in=latest, date__gte=today - QUIET_WINDOW,
                                                date__lte=today + QUIET_WINDOW).values_list('case_id', flat=True))
    listed = _listed_today_case_ids(today)
    firms, groups = {}, {}
    for case_id, rec in latest.items():
        case = cases.get(case_id)
        if case is None or case_id in stopped or not _firm_running(case.advocate_id, firms):
            continue                                       # deleted case, closed for us, stopped firm
        state = states.get(case_id)
        last = state.checked_at if state else None
        if last is not None:
            age = now - last
            if (case.status or '').lower() in DISPOSED:
                if age < DISPOSED_EVERY:
                    continue
            elif (case_id not in listed and case_id not in hearing_soon and age < QUIET_EVERY
                  and not (state.last_new_at and now - state.last_new_at < RECENT_ORDER)):
                continue                                   # quiet: once a day is enough
        g = groups.setdefault(court_identity(rec), {'records': [], 'listed': False, 'last': last})
        g['records'].append(rec)
        g['listed'] = g['listed'] or case_id in listed
        if last is None or (g['last'] is not None and last < g['last']):
            g['last'] = last
    order = sorted(groups.items(), key=lambda kv: (not kv[1]['listed'], kv[1]['last'] or datetime.datetime.min))
    return [{'identity': ident, 'records': g['records']} for ident, g in order]


def _sync_group(group, timeout, pause, own_connection=True):
    """Fetch one court case once and bring every record tracking it up to date. Returns (records checked,
    new orders); (-1, 0) when the court failed for it. Raises ScraperUnavailable (the round stops)."""
    from django.db import close_old_connections
    from .refresh import NotRefreshable, fetch_fresh, store_fresh
    if own_connection:                                     # a worker thread: its own database connection
        close_old_connections()
    try:
        try:
            new_raw = fetch_fresh(group['records'][0], timeout=timeout)
        except NotRefreshable:
            return 0, 0
        except client.ScraperUnavailable:
            raise
        except Exception as exc:                           # noqa: BLE001 - one case must not stop the round
            for rec in group['records']:
                CaseOrderSync.objects.update_or_create(case_id=rec.case_id, defaults={
                    'checked_at': timezone.now(), 'last_error': f'{type(exc).__name__}: {exc}'[:200]})
            log.warning('order sync: %s failed: %s', group['identity'], type(exc).__name__)
            return -1, 0
        new = 0
        for rec in group['records']:
            old_raw = rec.raw or {}
            store_fresh(rec, old_raw, new_raw)
            # The first look at a case knows nothing yet: what is there now is its baseline.
            known = CaseOrderSync.objects.filter(case_id=rec.case_id).exists()
            new += len(take_new_orders(rec, old_raw if known else None))
            note_decision(rec)
        if pause:
            time.sleep(pause)
        return len(group['records']), new
    finally:
        if own_connection:
            from django.db import connection
            connection.close()


def note_decision(rec):
    """A case the court has now decided goes to Appeal Alerts (appeals/decisions.py). Never breaks a sync."""
    try:
        from appeals.decisions import record_decision
        record_decision(rec)
    except Exception:                                      # noqa: BLE001
        log.exception('order sync: could not record the decision of case %s', rec.case_id)


LINK_EVERY = datetime.timedelta(hours=20)
LINK_PER_ROUND = 10


def link_pending(limit=LINK_PER_ROUND, now=None):
    """Offline cases (entered by hand) that have a CNR but no court record: try to link them, each at most
    once a day, so they are monitored without anyone pressing "Link to court record". Returns how many were
    linked. Stops at the first scraper outage (the round's own fetches will find out too)."""
    from core.models import Case
    from workspace.models import CaseProfile
    from . import linking
    now = now or datetime.datetime.now()
    linked_ids = set(ImportedCaseRecord.objects.exclude(case_id=None).values_list('case_id', flat=True))
    profiles = (CaseProfile.objects.exclude(cnr='').exclude(matter_type=CaseProfile.NON_LITIGATION)
                .exclude(case_id__in=linked_ids).order_by('case_id'))
    tried = dict(CaseOrderSync.objects.filter(case_id__in=[p.case_id for p in profiles])
                 .values_list('case_id', 'link_tried_at'))
    firms, linked, attempts = {}, 0, 0
    for profile in profiles:
        if attempts >= limit:
            break
        cnr = linking.clean_cnr(profile.cnr)
        last = tried.get(profile.case_id)
        if not cnr or (last and now - last < LINK_EVERY):
            continue
        case = Case.objects.select_related('advocate', 'client').filter(id=profile.case_id, deleted=False).first()
        if case is None or (case.status or '').lower() in DISPOSED or not _firm_running(case.advocate_id, firms):
            continue
        attempts += 1
        note = ''
        try:
            court_id, raw, query = linking.find_by_cnr(cnr)
            linking.link_case(case, court_id, query, raw)
            linked += 1
            log.info('order sync: offline case %s linked by its CNR', case.id)
        except linking.NotFound:
            note = 'Link: the courts have no case with this CNR'
        except linking.AlreadyLinked:
            continue
        except client.ScraperUnavailable:
            break
        except Exception as exc:                           # noqa: BLE001 - try again tomorrow
            note = f'Link: {type(exc).__name__}: {exc}'[:200]
        CaseOrderSync.objects.update_or_create(case_id=case.id, defaults={'link_tried_at': now, 'last_error': note})
    return linked


def _count(counts, checked, new):
    if checked < 0:
        counts['failed'] += 1
    elif checked:
        counts['court_cases'] += 1
        counts['checked'] += checked
        counts['new_orders'] += new


def sync_cycle(budget_seconds=25 * 60, pause=PAUSE_SECONDS, timeout=240, workers=None, stdout=None):
    """One round: fetch the due court cases, `workers` at a time, until `budget_seconds` runs out (the rest
    go first next round). The scraper being down ends the round. Returns counts."""
    from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
    from django.conf import settings
    from core.jobs import job_run
    workers = max(1, int(workers or getattr(settings, 'ORDER_SYNC_WORKERS', 3)))
    counts = {'court_cases': 0, 'checked': 0, 'new_orders': 0, 'failed': 0, 'linked': 0}
    started = time.monotonic()
    with job_run('order_sync') as run:
        try:
            counts['linked'] = link_pending()                  # offline cases with a CNR, then monitored too
        except Exception:                                      # noqa: BLE001 - never stops the round
            log.exception('order sync: linking offline cases failed')
        groups = iter(due_groups())
        if workers == 1:                                   # in this thread (and its database connection)
            for group in groups:
                if time.monotonic() - started > budget_seconds:
                    break
                try:
                    checked, new = _sync_group(group, timeout, pause, own_connection=False)
                except client.ScraperUnavailable:
                    counts['failed'] += 1
                    log.warning('order sync: scraper unavailable, round stopped')
                    break
                _count(counts, checked, new)
            run.counts.update(counts)
            return counts
        running, stop = set(), False
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix='order-sync') as pool:
            while True:
                while not stop and len(running) < workers and time.monotonic() - started < budget_seconds:
                    group = next(groups, None)
                    if group is None:
                        break
                    running.add(pool.submit(_sync_group, group, timeout, pause))
                if not running:
                    break
                done, running = wait(running, return_when=FIRST_COMPLETED)
                for fut in done:
                    try:
                        checked, new = fut.result()
                    except client.ScraperUnavailable:
                        counts['failed'] += 1
                        if not stop:
                            log.warning('order sync: scraper unavailable, round stopped')
                        stop = True
                        continue
                    _count(counts, checked, new)
        if stdout:
            stdout.write(f'{counts["court_cases"]} court cases fetched')
        run.counts.update(counts)
    return counts
