"""Make a senior who sits inside another senior's practice the head of their
own team in the same firm, taking their matters with them.

    manage.py make_team --senior arjun@kumar-associates.demo --firm rajesh@kumar-associates.demo
    manage.py make_team ... --yes      # apply (without it: dry run)

After it, the senior's juniors and the other teams no longer see each other's
cases; the firm's Super Admin and Accountant still see every team. Idempotent:
a second run changes nothing.
"""

import datetime
import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core.models import Advocate, Case
from firms.models import FirmTeam


class Command(BaseCommand):
    help = "Give a senior their own team inside a firm (moves their cases' records)."

    def add_arguments(self, parser):
        parser.add_argument('--senior', required=True, help='Email of the senior to become a team head.')
        parser.add_argument('--firm', required=True, help="Email of the firm's head senior.")
        parser.add_argument('--yes', action='store_true', help='Apply (default is a dry run).')

    def handle(self, *args, **opts):
        senior = Advocate.objects.filter(email__iexact=opts['senior']).first()
        head = Advocate.objects.filter(email__iexact=opts['firm']).first()
        if senior is None or head is None:
            raise CommandError('Senior or firm head not found.')
        if head.parent_advocate_id is not None:
            raise CommandError('{} is not a practice head.'.format(head.email))
        if senior.id == head.id:
            raise CommandError('The senior and the firm head are the same person.')

        firm_rows = {r.team_root_id: r.firm_root_id for r in FirmTeam.objects.filter(
            team_root_id__in=[head.id, senior.id])}
        cases = list(Case.objects.filter(advocate_id=senior.id))
        already = (senior.parent_advocate_id is None
                   and firm_rows.get(senior.id) == head.id
                   and firm_rows.get(head.id) == head.id)

        self.stdout.write('{} (id {}) currently reports to: {}'.format(
            senior.full_name, senior.id, senior.parent_advocate_id or 'nobody (own team)'))
        self.stdout.write('Cases to carry into the new team: {}'.format(
            ', '.join(c.case_number for c in cases) or 'none'))
        if already:
            self.stdout.write(self.style.SUCCESS('Already a team of this firm; nothing to do.'))
            return
        if not opts['yes']:
            self.stdout.write(self.style.WARNING('Dry run. Re-run with --yes to apply.'))
            return

        # Backup of what is about to change, so it can be undone by hand.
        out_dir = Path(settings.DOCUMENT_UPLOAD_DIR) / 'demo-resets'
        out_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        path = out_dir / 'make_team-{}-{}.json'.format(senior.id, stamp)
        path.write_text(json.dumps({
            'senior_id': senior.id, 'old_parent_advocate_id': senior.parent_advocate_id,
            'firm_rows': firm_rows,
            'cases': [{'id': c.id, 'case_number': c.case_number, 'client_id': c.client_id}
                      for c in cases],
        }, indent=2), encoding='utf-8')

        from cases.views import _move_matter
        Advocate.objects.filter(id=senior.id).update(parent_advocate_id=None)
        senior.parent_advocate_id = None
        FirmTeam.objects.update_or_create(team_root_id=head.id, defaults={'firm_root_id': head.id})
        FirmTeam.objects.update_or_create(team_root_id=senior.id, defaults={'firm_root_id': head.id})
        # The case already belongs to the senior, but its hearings, bills, notes
        # and tasks may have been created by the old team; re-own them all.
        for case in cases:
            _move_matter(case, senior)

        self.stdout.write(self.style.SUCCESS(
            '{} now heads their own team in {}\'s firm; {} case(s) moved. Backup: {}'.format(
                senior.full_name, head.full_name, len(cases), path)))
