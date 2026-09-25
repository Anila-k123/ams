"""Management command that cleans up demo data: removes duplicate records and
trims the draft-session backlog to a handful of good ones.

Duplicates exist because none of the master-data models enforce uniqueness — every
re-entered client/project name and every re-upload creates a fresh row. This
command de-duplicates *in place*: for each natural-key group it keeps the oldest row
(the survivor), re-points every reference onto it, then deletes the rest. It also
keeps only the most-recent N ``Ready`` draft sessions and deletes the others.

Run a preview first, then apply::

    python manage.py demo_cleanup --dry-run
    python manage.py demo_cleanup --keep-drafts 5

It is safe to re-run — once the data is clean it does nothing.
"""

from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction

from drafting.models import (
    Client, Project, Template, Sample, DraftSession,
    LibraryClause, Playbook, PlaybookDocument,
)


def _norm(value):
    """Normalise a name for grouping: trimmed + case-folded (None -> '')."""
    return (value or '').strip().casefold()


class Command(BaseCommand):
    help = 'Remove duplicate records and trim the draft backlog for a clean demo.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report what would change without writing anything.',
        )
        parser.add_argument(
            '--keep-drafts', type=int, default=5,
            help='How many of the most-recent Ready draft sessions to keep (default 5). '
                 'Use -1 to keep all sessions.',
        )

    def handle(self, *args, **options):
        self.dry = options['dry_run']
        self.keep_drafts = options['keep_drafts']
        mode = 'DRY RUN — no changes will be saved' if self.dry else 'APPLYING changes'
        self.stdout.write(self.style.WARNING(f'demo_cleanup: {mode}'))

        # A single transaction so a mid-run error rolls everything back. In dry-run
        # we still open it but never commit (we raise at the end to roll back).
        try:
            with transaction.atomic():
                self._dedupe_clients()
                self._dedupe_projects()
                self._dedupe_templates()
                self._dedupe_samples()
                self._dedupe_playbooks()
                self._trim_draft_sessions()
                if self.dry:
                    raise _DryRunRollback()
        except _DryRunRollback:
            self.stdout.write(self.style.WARNING('Dry run complete — nothing was saved.'))
            return

        self.stdout.write(self.style.SUCCESS('demo_cleanup: done.'))

    # ── helpers ──────────────────────────────────────────────────────────────

    def _groups(self, queryset, key_fn):
        """Group rows by natural key, returning only the groups with >1 row.

        Each group is (survivor, [dupes]) where the survivor is the lowest-id row.
        """
        buckets = defaultdict(list)
        for obj in queryset.order_by('id'):
            buckets[key_fn(obj)].append(obj)
        groups = []
        for rows in buckets.values():
            if len(rows) > 1:
                groups.append((rows[0], rows[1:]))
        return groups

    def _report(self, model_name, groups):
        """Log a one-line summary per duplicate group."""
        dupe_count = sum(len(d) for _, d in groups)
        if not dupe_count:
            self.stdout.write(f'  {model_name}: no duplicates.')
            return
        verb = 'would remove' if self.dry else 'removing'
        self.stdout.write(self.style.NOTICE(
            f'  {model_name}: {verb} {dupe_count} duplicate(s) across {len(groups)} name(s).'))
        for survivor, dupes in groups:
            label = getattr(survivor, 'name', str(survivor))
            self.stdout.write(
                f'      keep #{survivor.id} "{label}"  <-  merge {[d.id for d in dupes]}')

    # ── per-model dedup ──────────────────────────────────────────────────────

    def _dedupe_clients(self):
        groups = self._groups(Client.objects.all(), lambda c: _norm(c.name))
        self._report('Client', groups)
        for survivor, dupes in groups:
            ids = [d.id for d in dupes]
            Project.objects.filter(client_id__in=ids).update(client=survivor)
            Sample.objects.filter(client_id__in=ids).update(client=survivor)
            DraftSession.objects.filter(client_id__in=ids).update(client=survivor)
            Client.objects.filter(id__in=ids).delete()

    def _dedupe_projects(self):
        groups = self._groups(Project.objects.all(), lambda p: (p.client_id, _norm(p.name)))
        self._report('Project', groups)
        for survivor, dupes in groups:
            ids = [d.id for d in dupes]
            Sample.objects.filter(project_id__in=ids).update(project=survivor)
            DraftSession.objects.filter(project_id__in=ids).update(project=survivor)
            Project.objects.filter(id__in=ids).delete()

    def _dedupe_templates(self):
        groups = self._groups(
            Template.objects.all(),
            lambda t: (_norm(t.name), _norm(t.document_type)),
        )
        self._report('Template', groups)
        for survivor, dupes in groups:
            ids = [d.id for d in dupes]
            # Template.sessions is PROTECT — repoint before deleting the dupes.
            DraftSession.objects.filter(template_id__in=ids).update(template=survivor)
            Template.objects.filter(id__in=ids).delete()

    def _dedupe_samples(self):
        groups = self._groups(
            Sample.objects.all(),
            lambda s: (_norm(s.name), _norm(s.contract_type), _norm(s.variant)),
        )
        self._report('Sample', groups)
        for survivor, dupes in groups:
            for dupe in dupes:
                # Move the dupe off every session's M2M and onto the survivor.
                for session in dupe.sessions.all():
                    session.samples.add(survivor)
                    session.samples.remove(dupe)
                LibraryClause.objects.filter(source_sample=dupe).update(source_sample=survivor)
                PlaybookDocument.objects.filter(sample=dupe).update(sample=survivor)
                dupe.delete()  # its SampleClauses cascade

    def _dedupe_playbooks(self):
        groups = self._groups(
            Playbook.objects.all(),
            lambda p: (_norm(p.name), _norm(p.category)),
        )
        self._report('Playbook', groups)
        for survivor, dupes in groups:
            ids = [d.id for d in dupes]
            DraftSession.objects.filter(playbook_id__in=ids).update(playbook=survivor)
            Playbook.objects.filter(id__in=ids).delete()  # docs/clauses/risks cascade

    # ── draft-session backlog ────────────────────────────────────────────────

    def _trim_draft_sessions(self):
        if self.keep_drafts is not None and self.keep_drafts < 0:
            self.stdout.write('  DraftSession: keeping all sessions (--keep-drafts -1).')
            return
        keep_qs = (DraftSession.objects
                   .filter(status=DraftSession.Status.READY)
                   .order_by('-created_at')[:self.keep_drafts])
        keep_ids = list(keep_qs.values_list('id', flat=True))
        stale = DraftSession.objects.exclude(id__in=keep_ids)
        n = stale.count()
        if not n:
            self.stdout.write('  DraftSession: nothing to trim.')
            return
        verb = 'would delete' if self.dry else 'deleting'
        self.stdout.write(self.style.NOTICE(
            f'  DraftSession: {verb} {n} session(s); keeping {len(keep_ids)} most-recent Ready '
            f'({keep_ids}).'))
        stale.delete()  # blocks / edits / risks cascade


class _DryRunRollback(Exception):
    """Internal sentinel to roll back the transaction after a dry run."""
