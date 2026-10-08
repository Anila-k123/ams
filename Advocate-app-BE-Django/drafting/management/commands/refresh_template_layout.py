"""Re-read the layout (paragraph alignment) of already-processed templates (Word or PDF) into their slots.

Templates processed before services/layout.py existed have no alignment, or only the first body
paragraph's. This re-reads the .docx and merges the layout into each slot by position, keeping
the slot names the AI gave them (no AI call). Drafts made after this follow the template's layout;
existing drafts are not changed.

    manage.py refresh_template_layout            # every Word template
    manage.py refresh_template_layout --id 70    # one template
"""

from django.core.management.base import BaseCommand

from drafting.models import Template
from drafting.services.layout import layout_for, source_paragraphs
from drafting.services.parser import extract_clauses, merge_layout


class Command(BaseCommand):
    help = "Re-read Word templates' paragraph alignment into their slots (no AI call)."

    def add_arguments(self, parser):
        parser.add_argument('--id', type=int, help='Only this template.')

    def handle(self, *args, **opts):
        qs = Template.objects.exclude(file='')
        if opts.get('id'):
            qs = qs.filter(id=opts['id'])
        done = skipped = 0
        for t in qs:
            path = t.file.path if t.file else ''
            paragraphs = source_paragraphs(path)
            slots = list(t.body_json or [])
            if not paragraphs or not slots:
                skipped += 1
                continue
            clauses = extract_clauses(path)
            if len(clauses) != len(slots):
                self.stdout.write(self.style.WARNING(
                    f'#{t.id} {t.name}: {len(clauses)} clauses now vs {len(slots)} slots; re-upload it instead.'))
                skipped += 1
                continue
            for slot, clause in zip(slots, clauses):
                merge_layout(slot, layout_for(clause['text'], paragraphs))
            t.body_json = slots
            t.save(update_fields=['body_json'])
            done += 1
            self.stdout.write(f'#{t.id} {t.name}: layout refreshed for {len(slots)} slots')
        self.stdout.write(self.style.SUCCESS(f'{done} template(s) refreshed, {skipped} skipped.'))
