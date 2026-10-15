"""Bring already-processed templates (and PDF samples) up to date with the template look (no AI call).

Templates processed before services/layout.py and drafting/wordform.py existed have no alignment
or no record of where each clause sits in the file. This, keeping the slot names the AI gave them:
- makes the Word version of a PDF template (services/pdf2word.py), if it has none yet;
- re-reads each slot's alignment (services/layout.py) and its place and paragraph formatting in the
  Word file (drafting/wordform.py), merged into the existing slots by position.
Drafts made after this follow the template's look; existing drafts are not changed.

    manage.py refresh_template_layout                  # every template
    manage.py refresh_template_layout --id 70          # one template
    manage.py refresh_template_layout --rebuild-word   # also remake PDF templates' Word versions
    manage.py refresh_template_layout --samples        # remake PDF samples' Word versions too

--rebuild-word / --samples are for after the PDF converter improves: the Word version (look, header,
colours) is made again from the PDF. A sample whose clauses now split differently is best uploaded
again, so its clauses match the new Word version.
"""

from django.core.management.base import BaseCommand

from drafting.models import Sample, SampleClause, Template
from drafting.services.headings import heading_kind, split_heading
from drafting.services.layout import layout_for, source_paragraphs
from drafting.services.parser import clauses_of, merge_layout
from drafting.tasks import _ensure_word_version
from drafting.wordform import clause_forms


def _rebuild(obj):
    """Drop a PDF upload's Word version so _ensure_word_version makes it again."""
    if obj.word_file and obj.word_file.name and (obj.file.name or '').lower().endswith('.pdf'):
        obj.word_file.delete(save=False)
        obj.word_file = None
        obj.save(update_fields=['word_file'])


class Command(BaseCommand):
    help = "Re-read templates' layout, clause places and formatting into their slots (no AI call)."

    def add_arguments(self, parser):
        parser.add_argument('--id', type=int, help='Only this template.')
        parser.add_argument('--rebuild-word', action='store_true',
                            help="Make PDF templates' Word versions again (after a converter update).")
        parser.add_argument('--samples', action='store_true', help="Also make PDF samples' Word versions again.")

    def handle(self, *args, **opts):
        import os
        qs = Template.objects.exclude(file='')
        if opts.get('id'):
            qs = qs.filter(id=opts['id'])
        done = skipped = 0
        for t in qs:
            path = t.file.path if t.file else ''
            slots = list(t.body_json or [])
            if not path or not os.path.exists(path) or not slots:
                skipped += 1
                self.stdout.write(f'#{t.id} {t.name}: skipped (file not on this machine, or no slots)')
                continue
            if opts.get('rebuild_word'):
                _rebuild(t)
            word = _ensure_word_version(t) or (path if path.lower().endswith('.docx') else None)
            clauses = clauses_of(path, word if word != path else None)
            if len(clauses) != len(slots):
                self.stdout.write(self.style.WARNING(
                    f'#{t.id} {t.name}: {len(clauses)} clauses now vs {len(slots)} slots; re-upload it instead.'))
                skipped += 1
                continue
            paragraphs = source_paragraphs(path)
            splits = [split_heading(c) for c in clauses]
            forms = clause_forms(word, [c['text'] for c in clauses], [h for h, _ in splits]) if word \
                else [None] * len(clauses)
            placed = 0
            for slot, clause, form, (heading, body) in zip(slots, clauses, forms, splits):
                merge_layout(slot, layout_for(clause['text'], paragraphs))
                # The clause's own heading kept apart from its body (services/headings.py).
                slot.update(heading=heading, body=body, heading_kind=heading_kind(heading))
                if form:
                    slot['form'] = form
                    placed += 1
            t.body_json = slots
            t.save(update_fields=['body_json'])
            done += 1
            self.stdout.write(f'#{t.id} {t.name}: {len(slots)} slots refreshed, {placed} placed in the Word file'
                              + (' (Word version made from the PDF)' if word and word != path else ''))
        self.stdout.write(self.style.SUCCESS(f'{done} template(s) refreshed, {skipped} skipped.'))

        if opts.get('samples'):
            remade = 0
            for s in Sample.objects.exclude(file='').exclude(word_file=''):
                if not (s.file.name or '').lower().endswith('.pdf') or not os.path.exists(s.file.path):
                    continue
                _rebuild(s)
                word = _ensure_word_version(s)
                if word:
                    remade += 1
                    self.stdout.write(f'sample #{s.id} {s.name}: Word version made again')
                # Each clause's heading, by position when the split still matches (no re-embedding).
                rows = list(s.clauses.order_by('position'))
                parsed = clauses_of(s.file.path, word)
                if len(parsed) == len(rows):
                    for row, c in zip(rows, parsed):
                        row.heading = split_heading(c)[0][:500]
                    SampleClause.objects.bulk_update(rows, ['heading'])
            self.stdout.write(self.style.SUCCESS(f'{remade} PDF sample(s) given a new Word version. If a sample\'s '
                                                 'clauses now split differently, upload it again.'))
