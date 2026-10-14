"""Dry run of the tenancy migration: what apply_tenancy WOULD do. Read-only.

    manage.py plan_tenancy --mapping firms/tenancy_mapping.example.json [--json out.json]

Shows, per firm, its roots and staff, which client logins follow their client,
row counts per table, identities left unresolved, cross-firm references that
need a decision, and mapping problems. Exits 1 when the mapping has problems.
Output holds ids and counts only.
"""
import json

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from firms.tenancy import MappingError, build_plan, cross_firm_references, load_mapping, owner_firm_counts


class Command(BaseCommand):
    help = 'Read-only dry run of the firm (tenant) mapping.'

    def add_arguments(self, parser):
        parser.add_argument('--mapping', help='Mapping file to check (required unless --suggest).')
        parser.add_argument('--suggest', metavar='FILE',
                            help='Write a DRAFT mapping for this database to FILE for review, and stop.')
        parser.add_argument('--json', help='Also write the plan to this file.')

    def handle(self, *args, **opts):
        with connection.cursor() as cur:
            cur.execute('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
        if opts.get('suggest'):
            from firms.tenancy import suggest_mapping
            draft = suggest_mapping()
            with open(opts['suggest'], 'w', encoding='utf-8') as fh:
                json.dump(draft, fh, indent=2)
            self.stdout.write(f'Draft mapping written to {opts["suggest"]}: {len(draft["firms"])} firm(s), '
                              f'{len(draft["unresolved"])} unresolved root(s). Review it, then run '
                              f'plan_tenancy --mapping {opts["suggest"]}.')
            return
        if not opts.get('mapping'):
            raise CommandError('Give --mapping FILE (or --suggest FILE to draft one).')
        try:
            mapping = load_mapping(opts['mapping'])
        except (OSError, MappingError, ValueError) as exc:
            raise CommandError(f'Mapping: {exc}')
        plan = build_plan(mapping)
        counts = owner_firm_counts(plan)
        cross = cross_firm_references(plan)

        w = self.stdout.write
        for f in plan['firms']:
            clients = sorted(a for a, k in plan['client_firm'].items() if k == f['key'])
            w(f'FIRM {f["key"]} ({f["slug"]}): roots {f["roots"]}, staff {f["staff"]}, client logins {clients}')
        w(f'UNRESOLVED identities (no membership, rows stay unowned): {plan["unresolved"]}')
        w('ROWS per table -> firm:')
        for label, c in counts.items():
            if c:
                w(f'  {label}: {c}')
        w(f'CROSS-FIRM references needing a decision: {len(cross)}')
        for row in cross[:20]:
            w(f'  {row}')
        for p in plan['problems']:
            w(self.style.ERROR(f'PROBLEM: {p}'))
        if opts.get('json'):
            out = {k: v for k, v in plan.items() if k != 'people'}
            out.update({'row_counts': counts, 'cross_firm': cross})
            with open(opts['json'], 'w', encoding='utf-8') as fh:
                json.dump(out, fh, indent=2, default=str)
        if plan['problems']:
            raise SystemExit(1)
        w(self.style.SUCCESS('Plan is consistent.'))
