"""Compare subscription usage with the data, report every difference, and only
then (with --apply) correct what can safely be corrected.

    manage.py reconcile_usage                    report only (the default)
    manage.py reconcile_usage --apply            also fix metered counters / stale requests
    manage.py reconcile_usage --storage          also compare storage rows with the files on disk
    manage.py reconcile_usage --backfill-ai [--apply]   give pre-Phase-8 llm_usage rows their firm

What is checked:
  - metered counters (firm_usage) against SUM(usage_event) per firm, key, month
    (--apply rewrites the counter: events are the record, counters a cache);
  - metered requests still RESERVED after 2 hours (--apply releases them, as
    the scheduler's subscription_sweep does);
  - stock use over the plan's limit (after a downgrade): reported only -
    nothing is ever deleted to fit a plan;
  - --storage: documents / versions whose file is missing, files whose size on
    disk differs from the row, files in the document folder no row refers to,
    and leftover .part uploads. Reported only: files are never deleted here.

Stock usage (seats, cases, clients, storage) is always counted live from the
data, so its "counter" cannot drift; only the data itself can disagree with
the disk, which --storage shows.
"""
import datetime
import os

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Sum

from subscriptions import catalogue as C
from subscriptions import service
from subscriptions.models import FirmSubscription, FirmUsage, MeteredRequest, UsageEvent


class Command(BaseCommand):
    help = 'Report subscription usage discrepancies; --apply corrects metered counters and stale requests.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Correct what was reported (never deletes data).')
        parser.add_argument('--dry-run', action='store_true', help='Same as the default (report only).')
        parser.add_argument('--storage', action='store_true', help='Also compare document rows with files on disk.')
        parser.add_argument('--backfill-ai', action='store_true')

    def handle(self, *args, **o):
        apply = o['apply'] and not o['dry_run']
        issues = 0
        self.stdout.write('Metered counters:')
        sums = {(r['firm_id'], r['key'], r['window_start']): max(r['total'] or 0, 0) for r in
                UsageEvent.objects.filter(key__in=C.METERED).values('firm_id', 'key', 'window_start')
                .annotate(total=Sum('quantity'))}
        rows = {(r.firm_id, r.key, r.window_start): r for r in FirmUsage.objects.filter(key__in=C.METERED)}
        for k in sorted(set(sums) | set(rows), key=str):
            want, row = sums.get(k, 0), rows.get(k)
            have = row.used if row else 0
            if have != want:
                issues += 1
                self.stdout.write(f'  firm {k[0]} {k[1]} {k[2]}: counter {have}, events {want}')
                if apply:
                    with transaction.atomic():
                        r, _ = FirmUsage.objects.get_or_create(firm_id=k[0], key=k[1], window_start=k[2])
                        FirmUsage.objects.filter(id=r.id).update(used=want)

        stale = MeteredRequest.objects.filter(state=MeteredRequest.RESERVED,
                                              updated_at__lt=service.now() - datetime.timedelta(hours=2))
        n = stale.count()
        self.stdout.write(f'Requests still reserved after 2 hours: {n}')
        issues += n
        if apply and n:
            self.stdout.write(f'  released {service.release_stale()}')

        self.stdout.write('Stock use over the plan limit (reported only, nothing is deleted):')
        for sub in FirmSubscription.objects.select_related('plan'):
            ents = service.effective_entitlements(sub.firm_id, sub)
            for key in C.STOCK:
                limit = ents.get(key, {}).get('limit')
                used = service.usage(sub.firm_id, key)
                if limit is not None and used is not None and used > limit:
                    self.stdout.write(f'  firm {sub.firm_id} ({service.code_of(sub) or "no plan"}) {key}: '
                                      f'{used} used, limit {limit}')

        if o['storage']:
            issues += self._storage()

        if o['backfill_ai']:
            from core.tenant import firm_id_of_advocate
            from metering.models import LLMUsage
            n = 0
            for adv in LLMUsage.objects.filter(firm_id__isnull=True, advocate_id__isnull=False) \
                    .values_list('advocate_id', flat=True).distinct():
                fid = firm_id_of_advocate(adv)
                if fid:
                    qs = LLMUsage.objects.filter(firm_id__isnull=True, advocate_id=adv)
                    n += qs.update(firm_id=fid) if apply else qs.count()
            self.stdout.write(f"llm_usage rows {'given' if apply else 'that would be given'} their firm: {n}")

        self.stdout.write(f"{issues} discrepanc{'y' if issues == 1 else 'ies'} found"
                          f"{'; corrected where possible.' if apply else '. Re-run with --apply to correct.'}")

    def _storage(self):
        from core.models import Document
        from documents.models import DocumentVersion
        from documents.storage import documents_root, resolve_stored_file
        issues, seen = 0, set()
        self.stdout.write('Storage (rows vs files; reported only):')
        rows = [('document', d.id, d.file_path, d.stored_name, d.file_size)
                for d in Document.objects.only('id', 'file_path', 'stored_name', 'file_size')]
        rows += [('version', v.id, v.file_path, v.stored_name, v.file_size)
                 for v in DocumentVersion.objects.only('id', 'file_path', 'stored_name', 'file_size')]
        for kind, rid, path, stored, size in rows:
            real = resolve_stored_file(path, stored)
            if not real:
                issues += 1
                self.stdout.write(f'  {kind} {rid}: file missing')
                continue
            seen.add(os.path.normcase(os.path.realpath(real)))
            disk = os.path.getsize(real)
            if size is not None and disk != size:
                issues += 1
                self.stdout.write(f'  {kind} {rid}: row says {size} bytes, file has {disk}')
        root = documents_root()
        if os.path.isdir(root):
            for name in os.listdir(root):
                full = os.path.normcase(os.path.realpath(os.path.join(root, name)))
                if not os.path.isfile(full) or full in seen:
                    continue
                issues += 1
                label = 'unfinished upload (.part)' if name.endswith('.part') else 'file no row refers to'
                self.stdout.write(f'  {name}: {label}, {os.path.getsize(full)} bytes')
        return issues
