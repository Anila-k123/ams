"""A case's timeline, built from the case's own records.

The Timeline tab used to read `case_timeline_event`, a table only the old Spring
backend wrote to. Nothing here ever fills it, so every case opened since the
move to Django had an empty timeline. Instead of keeping a second copy of the
history in sync, the timeline is assembled on request from what the case
already holds: the case itself, hearings, documents, invoices, payments,
expenses, tasks and notes. Legacy `case_timeline_event` rows are merged in, so
the older cases keep the history they had.

Each source is shown only to someone allowed to see it: the money lines need
INVOICE_VIEW / PAYMENT_VIEW / EXPENSE_VIEW, documents need DOCUMENT_VIEW, and
tasks follow the same own-or-assigner rule as the Tasks page.

Every entry has the shape the CaseTimeline component renders, and an event_type
from its filter groups (Payments, Expenses, Documents, Hearings, Invoices,
Status Changes), so the filters work unchanged.
"""

from __future__ import annotations

import datetime

from django.db import DatabaseError, connection, transaction

from core.models import (Advocate, CaseEvent, ClientPayment, Document, Expense,
                         Invoice)
from workspace.access import visible_tasks
from workspace.models import CaseNote, HearingDetail, TaskSubmission

# event_type -> (colour, icon), matching the palette the Spring rows used.
STYLE = {
    'CASE_CREATED': ('#3B82F6', '📁'),
    'CASE_CLOSED': ('#64748B', '🔒'),
    'HEARING_CREATED': ('#8B5CF6', '⚖️'),
    'HEARING_COMPLETED': ('#6D28D9', '✅'),
    'DOCUMENT_UPLOADED': ('#0EA5E9', '📄'),
    'INVOICE_GENERATED': ('#F59E0B', '🧾'),
    'INVOICE_PAID': ('#10B981', '💰'),
    'PAYMENT_RECEIVED': ('#10B981', '💵'),
    'EXPENSE_ADDED': ('#EF4444', '💸'),
    'TASK_ASSIGNED': ('#6366F1', '📝'),
    'TASK_SUBMITTED': ('#0891B2', '📤'),
    'TASK_APPROVED': ('#16A34A', '👍'),
    'TASK_CHANGES_REQUESTED': ('#EA580C', '↩️'),
    'NOTE_ADDED': ('#94A3B8', '🗒️'),
}


def _at(value):
    """A sortable datetime from a date or datetime (dates sort at midnight)."""
    if value is None:
        return None
    if isinstance(value, datetime.datetime):
        return value.replace(tzinfo=None)
    return datetime.datetime.combine(value, datetime.time.min)


def _money(amount):
    try:
        return '₹{:,.2f}'.format(float(amount or 0))
    except (TypeError, ValueError):
        return str(amount)


class _Builder:
    def __init__(self, case):
        self.case = case
        self.rows = []
        self._names = {}

    def name(self, advocate_id):
        if not advocate_id:
            return None
        if advocate_id not in self._names:
            adv = Advocate.objects.filter(id=advocate_id).only('full_name').first()
            self._names[advocate_id] = (adv.full_name or '').strip() if adv else None
        return self._names[advocate_id]

    def add(self, key, event_type, when, title, description='', *,
            ref_type=None, ref_id=None, by=None):
        when = _at(when)
        if when is None:
            return
        color, icon = STYLE.get(event_type, ('#94A3B8', '📌'))
        self.rows.append({
            'id': key, 'title': title, 'description': description or '',
            'createdAt': when.isoformat(), 'eventType': event_type,
            'color': color, 'icon': icon, 'referenceType': ref_type,
            'referenceId': ref_id, 'performedBy': self.name(by) if isinstance(by, int) else by,
            '_sort': when,
        })


def build_timeline(case, user):
    """Every timeline entry for `case` that `user` may see, newest first."""
    perms = user.permission_codes()
    b = _Builder(case)
    cid = case.id

    b.add('case-%d' % cid, 'CASE_CREATED', case.created_at,
          'Case opened: {}'.format(case.case_number or case.case_title or ''),
          ' · '.join(x for x in [case.case_title, case.case_type, case.court_level] if x),
          ref_type='CASE', ref_id=cid, by=case.advocate_id)
    if (case.status or '').lower() in ('closed', 'disposed', 'decided'):
        b.add('case-closed-%d' % cid, 'CASE_CLOSED',
              getattr(case, 'updated_at', None) or case.created_at,
              'Case marked {}'.format(case.status.lower()), ref_type='CASE', ref_id=cid)

    if 'EVENT_VIEW' in perms or 'CASE_VIEW' in perms:
        details = {h.event_id: h for h in HearingDetail.objects.filter(
            event_id__in=CaseEvent.objects.filter(case_id=cid).values('id'))}
        today = datetime.date.today()
        for ev in CaseEvent.objects.filter(case_id=cid).order_by('date'):
            d = details.get(ev.id)
            kind = (ev.event_type or 'Hearing').replace('_', ' ').title()
            when = datetime.datetime.combine(ev.date, ev.time or datetime.time.min)
            bits = [ev.title if ev.title and ev.title.lower() != kind.lower() else None]
            if d:
                bits += [d.purpose or None, d.bench_hall and 'Court ' + d.bench_hall,
                         d.judge or None]
            done = bool(d and d.outcome) or ev.date < today
            b.add('event-%d' % ev.id,
                  'HEARING_COMPLETED' if done and d and d.outcome else 'HEARING_CREATED', when,
                  '{} {}'.format(kind, 'held' if done else 'scheduled'),
                  ' · '.join(x for x in bits if x) + (
                      ('\nOutcome: ' + d.outcome) if d and d.outcome else ''),
                  ref_type='HEARING', ref_id=ev.id, by=ev.advocate_id)

    if 'DOCUMENT_VIEW' in perms:
        for doc in Document.objects.filter(case_id=cid):
            b.add('doc-%d' % doc.id, 'DOCUMENT_UPLOADED', doc.upload_date,
                  'Document uploaded: {}'.format(doc.document_name),
                  ' · '.join(x for x in [doc.category,
                                         'v{}'.format(doc.version) if (doc.version or 1) > 1 else None] if x),
                  ref_type='DOCUMENT', ref_id=doc.id, by=doc.advocate_id)

    if 'INVOICE_VIEW' in perms:
        for inv in Invoice.objects.filter(case_id=cid):
            b.add('inv-%d' % inv.id, 'INVOICE_GENERATED', inv.invoice_date,
                  'Invoice {} raised'.format(inv.invoice_number),
                  '{} · due {}'.format(_money(inv.amount), inv.due_date),
                  ref_type='INVOICE', ref_id=inv.id, by=inv.advocate_id)
            if (inv.status or '').upper() == 'PAID':
                # No paid-on date is stored, so this sits with the invoice itself.
                b.add('inv-paid-%d' % inv.id, 'INVOICE_PAID',
                      _at(inv.invoice_date) + datetime.timedelta(seconds=1),
                      'Invoice {} paid'.format(inv.invoice_number), _money(inv.amount),
                      ref_type='INVOICE', ref_id=inv.id)

    if 'PAYMENT_VIEW' in perms:
        for p in ClientPayment.objects.filter(case_id=cid):
            b.add('pay-%d' % p.id, 'PAYMENT_RECEIVED', p.payment_date,
                  'Payment received: {}'.format(_money(p.amount)),
                  ' · '.join(x for x in [p.payment_mode, p.reference_number, p.description] if x),
                  ref_type='PAYMENT', ref_id=p.id, by=p.advocate_id)

    if 'EXPENSE_VIEW' in perms:
        for e in Expense.objects.filter(case_id=cid):
            b.add('exp-%d' % e.id, 'EXPENSE_ADDED', e.payment_date,
                  'Expense: {}'.format(e.title),
                  ' · '.join(x for x in [_money(e.amount), e.category, e.description] if x),
                  ref_type='EXPENSE', ref_id=e.id, by=getattr(e, 'advocate_id', None))

    for t in visible_tasks(user).filter(case_id=cid):
        who = b.name(t.assigned_to_id)
        b.add('task-%d' % t.id, 'TASK_ASSIGNED', t.created_at,
              'Task: {}'.format(t.title),
              ' · '.join(x for x in ['assigned to ' + who if who else None,
                                     'due {}'.format(t.deadline) if t.deadline else None,
                                     (t.priority or '').title() or None] if x),
              ref_type='TASK', ref_id=t.id, by=t.assigned_by_id or t.advocate_id)
        subs = list(TaskSubmission.objects.filter(task_id=t.id))
        for sub in subs:
            b.add('task-sub-%d' % sub.id, 'TASK_SUBMITTED', sub.created_at,
                  'Submitted for review: {}'.format(t.title),
                  sub.note + (' · {} h'.format(sub.hours) if sub.hours else ''),
                  ref_type='TASK', ref_id=t.id, by=sub.submitted_by_id)
        if t.submitted_at and not subs:
            # Submitted before reports were recorded.
            b.add('task-sub-%d' % t.id, 'TASK_SUBMITTED', t.submitted_at,
                  'Submitted for review: {}'.format(t.title), ref_type='TASK', ref_id=t.id,
                  by=t.assigned_to_id)
        if t.reviewed_at and t.review_status in ('APPROVED', 'CHANGES_REQUESTED'):
            approved = t.review_status == 'APPROVED'
            b.add('task-rev-%d' % t.id,
                  'TASK_APPROVED' if approved else 'TASK_CHANGES_REQUESTED', t.reviewed_at,
                  '{}: {}'.format('Approved' if approved else 'Changes requested', t.title),
                  t.review_note or '', ref_type='TASK', ref_id=t.id, by=t.reviewed_by_id)

    for n in CaseNote.objects.filter(case_id=cid):
        body = (n.body or '').strip()
        b.add('note-%d' % n.id, 'NOTE_ADDED', n.created_at, 'Note added',
              body[:280] + ('…' if len(body) > 280 else ''),
              ref_type='NOTE', ref_id=n.id, by=n.advocate_id)

    # History from the Spring era, for the cases that have it - only the kinds of
    # entry not rebuilt above (e.g. status changes), so nothing appears twice.
    rebuilt = tuple(STYLE)
    try:
        # A savepoint, so a missing legacy table (fresh installs, tests) does
        # not break the surrounding transaction.
        with transaction.atomic(), connection.cursor() as cur:
            cur.execute(
                'SELECT id, title, description, created_at, event_type, color, icon, '
                'reference_type, reference_id, performed_by '
                'FROM case_timeline_event WHERE case_id = %s AND event_type NOT IN ('
                + ','.join(['%s'] * len(rebuilt)) + ')', [cid, *rebuilt])
            legacy = cur.fetchall()
    except DatabaseError:
        legacy = []
    for r in legacy:
        when = _at(r[3])
        b.rows.append({
            'id': 'legacy-%d' % r[0], 'title': r[1], 'description': r[2] or '',
            'createdAt': when.isoformat() if when else None, 'eventType': r[4],
            'color': r[5], 'icon': r[6], 'referenceType': r[7],
            'referenceId': r[8], 'performedBy': r[9], '_sort': when,
        })

    rows = [r for r in b.rows if r['_sort'] is not None]
    rows.sort(key=lambda r: r['_sort'], reverse=True)
    for r in rows:
        del r['_sort']
    return rows
