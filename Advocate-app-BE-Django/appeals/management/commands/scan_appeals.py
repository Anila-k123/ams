"""Nightly sweep: has an appeal appeared against any decided case?

Run from the OS scheduler (Windows Task Scheduler / cron), e.g. nightly:

    manage.py scan_appeals --limit 25

Why a scheduled command rather than a worker: every court search is a live
scrape behind a CAPTCHA and takes seconds to tens of seconds, so this is
inherently a batch job. There is no job runner in the project, and adding
Celery+Redis to run one nightly task would be more infrastructure than the
job deserves.

The sweep only ever READS the courts and writes candidate rows. It never
confirms an appeal by itself - the advocate does that.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import Advocate, Case, Notification
from courtsearch.models import ImportedCaseRecord
from courtsearch import client
from appeals.appeal_scan import case_parties, is_candidate, searchable_names
from appeals.detection import detect_disposal, parse_court_date
from appeals.forums import next_forum
from appeals.models import AppealDetection

log = logging.getLogger(__name__)

def _search_name(names):
    """The party name most worth searching a higher court for.

    Ranked by searchable_names(), which strips the advocate/service noise the
    High Court portal packs into its party fields - searching the raw longest
    name sends the registry a 150-character string that matches nothing.
    """
    ranked = searchable_names(names)
    return ranked[0] if ranked else None


class Command(BaseCommand):
    help = 'Detect appeals filed in higher courts against decided cases.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=25,
                            help='Max source cases to check in this run (default 25).')
        parser.add_argument('--advocate', type=int, default=None,
                            help='Only sweep this advocate id.')
        parser.add_argument('--dry-run', action='store_true',
                            help='Report what would be recorded; write nothing.')
        parser.add_argument('--no-notify', action='store_true',
                            help='Record detections without emailing or notifying.')
        parser.add_argument('--all-benches', action='store_true',
                            help='Search every bench of the High Court, not just the '
                                 'first (thorough but several times slower).')

    # -- the sweep ---------------------------------------------------------

    def handle(self, *args, **o):
        limit, dry = o['limit'], o['dry_run']
        records = ImportedCaseRecord.objects.all().order_by('-id')
        if o['advocate']:
            records = records.filter(advocate_id=o['advocate'])

        checked = found = 0
        new_rows = []
        seen_cases = set()

        for rec in records:
            if checked >= limit:
                break
            if rec.case_id in seen_cases:
                continue          # one sweep per case, newest record wins
            seen_cases.add(rec.case_id)

            disposal = detect_disposal(rec.court_id, rec.raw or {})
            if not disposal or not disposal.get('judgment_date'):
                continue          # still pending, or no date to reason from

            case = Case.objects.filter(id=rec.case_id, deleted=False).first()
            if case is None:
                continue

            forum = next_forum(rec.court_id,
                               state_code=(rec.query or {}).get('state_code'),
                               cnr=self._cnr(rec))
            if not forum:
                continue          # already at the Supreme Court

            names = case_parties(rec.court_id, rec.raw or {})
            term = _search_name(names)
            if not term:
                continue

            checked += 1
            self.stdout.write('  [{}] {} -> {} (state {}) as "{}"'.format(
                checked, case.case_number, forum['court_id'],
                forum['state_code'], term))
            try:
                rows = self._search(forum, term, o['all_benches'])
            except Exception as exc:                       # noqa: BLE001
                self.stderr.write(self.style.WARNING(
                    '      search failed: {}'.format(exc)))
                continue

            for row in rows:
                parties = row.get('parties') or ''
                filed = parse_court_date(row.get('filedOn'))
                haystack = '{} {}'.format(parties, row.get('caseNumber') or '')
                ok, score, matched = is_candidate(
                    names, haystack, filed, disposal['judgment_date'])
                if not ok:
                    continue
                found += 1
                self.stdout.write(self.style.SUCCESS(
                    '      MATCH {} score={} on [{}]'.format(
                        row.get('caseNumber'), score, matched)))
                if dry:
                    continue
                det, created = AppealDetection.objects.get_or_create(
                    advocate_id=rec.advocate_id,
                    source_case_id=case.id,
                    appeal_cnr=(row.get('cnr') or '')[:32],
                    defaults=dict(
                        source_case_number=case.case_number or '',
                        forum_court_id=forum['court_id'],
                        forum_state_code=str(forum['state_code'] or ''),
                        forum_label=row.get('forumLabel') or '',
                        appeal_case_number=(row.get('caseNumber') or '')[:255],
                        appeal_parties=parties[:500],
                        appeal_filed_on=filed,
                        matched_on=matched[:255],
                        match_score=score,
                    ))
                if created:
                    new_rows.append(det)

        if new_rows and not o['no_notify']:
            self._notify(new_rows)

        self.stdout.write(self.style.SUCCESS(
            'Swept {} decided case(s); {} candidate match(es); {} new.{}'.format(
                checked, found, len(new_rows), ' [dry run]' if dry else '')))

    # -- helpers -----------------------------------------------------------

    @staticmethod
    def _cnr(rec):
        q = rec.query or {}
        if q.get('cnr'):
            return q['cnr']
        vt = q.get('view_token') or {}
        return vt.get('cino') or ''

    def _search(self, forum, term, all_benches):
        """Party-name search in the higher forum -> list of light rows."""
        if forum['court_id'] == 'sci':
            data = client.sci_search_party_name(term)
            out = []
            for c in (data.get('cases') or []):
                token = c.get('viewToken') or {}
                out.append({
                    'caseNumber': c.get('caseNumber'),
                    'parties': '{} Vs {}'.format(c.get('petitioner', ''),
                                                 c.get('respondent', '')),
                    'cnr': token.get('diaryNo', ''),
                    'forumLabel': 'Supreme Court of India',
                })
            return out

        state = forum['state_code']
        benches = client.hc_benches(state) or {}
        items = list(benches.items())
        if not all_benches:
            items = items[:1]      # principal bench only unless asked
        out = []
        for label, court_complex in items:
            data = client.hc_list_search(state, court_complex, 'party_name',
                                         {'name': term, 'status': 'Both'})
            for r in (data.get('rows') or []):
                token = r.get('view_token') or {}
                out.append({
                    'caseNumber': r.get('case_number'),
                    'parties': r.get('parties'),
                    'cnr': token.get('cino', ''),
                    'forumLabel': label,
                })
        return out

    def _notify(self, detections):
        """In-app notification row + one email per advocate."""
        by_advocate = {}
        for d in detections:
            by_advocate.setdefault(d.advocate_id, []).append(d)

        for advocate_id, rows in by_advocate.items():
            adv = Advocate.objects.filter(id=advocate_id).first()
            summary = ('{} possible appeal(s) detected against your decided '
                       'case(s).'.format(len(rows)))
            try:
                Notification.objects.create(
                    created_at=timezone.now(), message=summary[:255],
                    read_status=False, advocate_id=advocate_id)
                AppealDetection.objects.filter(
                    id__in=[r.id for r in rows]).update(notified_in_app=True)
            except Exception:                              # noqa: BLE001
                log.exception('scan_appeals: in-app notification failed')

            if not (adv and adv.email):
                continue
            lines = [summary, '']
            for r in rows:
                lines += [
                    'Your case : {}'.format(r.source_case_number),
                    'Appeal    : {}'.format(r.appeal_case_number or '(number not listed)'),
                    'Forum     : {}'.format(r.forum_label or r.forum_court_id),
                    'Parties   : {}'.format(r.appeal_parties),
                    'Filed on  : {}'.format(r.appeal_filed_on or 'not stated'),
                    'Matched on: {}'.format(r.matched_on),
                    '',
                ]
            lines += [
                'These are candidates read from the court record, not confirmed '
                'appeals - please open the Appeal Alerts page to confirm or '
                'dismiss each one.',
                '',
                'This message does not compute any limitation or filing deadline.',
            ]
            try:
                send_mail(
                    subject='[Appeal Alert] {}'.format(summary),
                    message='\n'.join(lines),
                    from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', None),
                    recipient_list=[adv.email],
                    fail_silently=False,
                )
                AppealDetection.objects.filter(
                    id__in=[r.id for r in rows]).update(notified_email=True)
                self.stdout.write('  emailed {}'.format(adv.email))
            except Exception as exc:                       # noqa: BLE001
                # Never fail the sweep because SMTP is down - the detections
                # are already saved and visible in-app.
                self.stderr.write(self.style.WARNING(
                    '  email to {} failed: {}'.format(adv.email, exc)))
