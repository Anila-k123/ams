"""Create firms and memberships from an approved mapping and backfill firm_id.

    manage.py apply_tenancy --mapping <approved.json> --yes

Safety:
- Refuses a database named PactPro_db unless that exact name is passed with
  --allow-database (an approved, deliberate step on that developer's own local
  copy), and any database without TENANCY_COLUMNS.
- Refuses a mapping with problems (see plan_tenancy).
- Without --yes it only prints the plan.
- One transaction. Re-running is safe: firms, memberships and settings are
  matched (get_or_create), and only rows with firm_id NULL are filled - existing
  ownership is never overwritten, nothing is deleted.
"""
import datetime

from django.apps import apps
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from firms.tenancy import DERIVED, OWNED, USED_BY, MappingError, build_plan, load_mapping

PROTECTED_DATABASES = {'pactpro_db'}


class Command(BaseCommand):
    help = 'Apply an approved firm mapping (not on the live database).'

    def add_arguments(self, parser):
        parser.add_argument('--mapping', required=True)
        parser.add_argument('--yes', action='store_true')
        parser.add_argument('--allow-database', default='',
                            help='Exact name of a protected database you have approved this run for.')

    def handle(self, *args, **opts):
        db = settings.DATABASES['default']['NAME'].lower()
        if db in PROTECTED_DATABASES and opts['allow_database'] != settings.DATABASES['default']['NAME']:
            raise CommandError(f'Refusing to run on {settings.DATABASES["default"]["NAME"]} '
                               'without --allow-database with its exact name (needs approval and a verified backup).')
        if not settings.TENANCY_COLUMNS:
            raise CommandError('TENANCY_COLUMNS is off: apply the tenancy migrations first.')
        try:
            mapping = load_mapping(opts['mapping'])
        except (OSError, MappingError, ValueError) as exc:
            raise CommandError(f'Mapping: {exc}')
        plan = build_plan(mapping)
        if plan['problems']:
            raise CommandError('Mapping has problems: ' + '; '.join(plan['problems']))
        if not opts['yes']:
            call_command('plan_tenancy', mapping=opts['mapping'], stdout=self.stdout)
            self.stdout.write('Nothing changed. Re-run with --yes to apply.')
            return
        with transaction.atomic():
            firm_ids = self._firms(plan)
            self._memberships(plan, firm_ids)
            filled = self._backfill(plan, firm_ids)
        self.stdout.write(self.style.SUCCESS(f'Applied: {len(firm_ids)} firm(s); rows given a firm: {filled}'))

    # ---------------------------------------------------------------------
    def _firms(self, plan):
        Firm = apps.get_model('firms', 'Firm')
        FirmSettings = apps.get_model('firms', 'FirmSettings')
        FirmTeam = apps.get_model('firms', 'FirmTeam')
        Advocate = apps.get_model('core', 'Advocate')
        out = {}
        for f in plan['firms']:
            head = f['roots'][0]
            firm, _ = Firm.objects.get_or_create(
                legacy_root_advocate_id=head,
                defaults={'name': f['name'], 'slug': f['slug'], 'status': Firm.ACTIVE})
            out[f['key']] = firm.id
            # The documented migration path for pre-SaaS data: these practices
            # already used AMS, so they keep everything (Legacy), recorded
            # explicitly - never an implicit "no subscription" fallback.
            from subscriptions.service import assign_legacy
            assign_legacy(firm.id, reason='apply_tenancy: existing practice, Legacy policy')
            root = Advocate.objects.filter(id=head).first()
            if root is not None:
                FirmSettings.objects.get_or_create(firm=firm, defaults={
                    'display_name': root.office_name or f['name'],
                    'office_address': root.office_address or '', 'city': root.city or '',
                    'state': root.state or '', 'country': root.country or 'India',
                    'pin_code': root.pin_code or '', 'office_phone': root.office_phone or '',
                    'office_email': root.office_email or '', 'website': root.website or '',
                    'gst_number': root.gst_number or '', 'pan_number': root.pan_number or '',
                    'logo_path': root.office_logo_path or '',
                    'primary_brand_color': root.primary_brand_color or '',
                    'secondary_brand_color': root.secondary_brand_color or '',
                    'time_zone': root.time_zone or 'Asia/Kolkata', 'currency': root.currency or 'INR',
                    'date_format': root.date_format or ''})
            for r in f['roots']:
                team, _ = FirmTeam.objects.get_or_create(team_root_id=r, defaults={'firm_root_id': head})
                if team.firm_id is None:
                    team.firm_id = firm.id
                    team.save(update_fields=['firm_id'])
        return out

    def _memberships(self, plan, firm_ids):
        FirmMembership = apps.get_model('firms', 'FirmMembership')
        now = datetime.datetime.now()
        people = plan['people']
        rows = [(a, k, FirmMembership.STAFF) for a, k in plan['staff_firm'].items()]
        rows += [(a, k, FirmMembership.CLIENT) for a, k in plan['client_firm'].items()]
        for adv_id, key, kind in rows:
            p = people.get(adv_id, {})
            left = p.get('left_on') is not None
            FirmMembership.objects.get_or_create(
                firm_id=firm_ids[key], advocate_id=adv_id,
                defaults={'kind': kind, 'status': FirmMembership.LEFT if left else FirmMembership.ACTIVE,
                          'team_root_id': (p.get('parent_advocate_id') or adv_id) if kind == FirmMembership.STAFF else None,
                          'joined_at': now, 'left_at': now if left else None})

    def _backfill(self, plan, firm_ids):
        filled = 0
        owner_firm = {a: firm_ids[k] for a, k in plan['staff_firm'].items()}
        owner_firm.update({a: firm_ids[k] for a, k in plan['client_firm'].items()})
        by_firm = {}
        for owner, fid in owner_firm.items():
            by_firm.setdefault(fid, []).append(owner)
        for label, column in OWNED:
            model = apps.get_model(label)
            for fid, owners in by_firm.items():
                filled += model.objects.filter(firm_id__isnull=True, **{f'{column}__in': owners}).update(firm_id=fid)
        for label, column, parent_label in DERIVED:
            model, parent = apps.get_model(label), apps.get_model(parent_label)
            for fid in set(firm_ids.values()):
                parents = parent.objects.filter(firm_id=fid).values('id')
                filled += model.objects.filter(firm_id__isnull=True, **{f'{column}__in': parents}).update(firm_id=fid)
        for label, users in USED_BY:
            model = apps.get_model(label)
            for pk in model.objects.filter(firm_id__isnull=True).values_list('id', flat=True):
                firms = set()
                for user_label, column in users:
                    firms |= set(apps.get_model(user_label).objects.filter(**{column: pk})
                                 .exclude(firm_id__isnull=True).values_list('firm_id', flat=True))
                if len(firms) == 1:
                    filled += model.objects.filter(id=pk, firm_id__isnull=True).update(firm_id=firms.pop())
        return filled
