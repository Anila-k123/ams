"""Management command that seeds the v1 Mutual NDA Template.

Run with ``python manage.py seed_nda_template``. It is idempotent — re-running
updates the existing template rather than creating duplicates.
"""

from django.core.management.base import BaseCommand
from drafting.models import Template

# Template.slot_schema: the case-fact inputs a lawyer fills in for this template.
# Each slot drives one field in the frontend's facts form.
SLOT_SCHEMA = [
    {'key': 'party_a_name',  'label': 'Party A Name',        'required': True,  'type': 'text',   'hint': 'Full legal name of the first party'},
    {'key': 'party_a_type',  'label': 'Party A Entity Type', 'required': True,  'type': 'select', 'option_set': 'entity_types', 'hint': 'Legal form of the first party'},
    {'key': 'party_b_name',  'label': 'Party B Name',        'required': True,  'type': 'text',   'hint': 'Full legal name of the second party'},
    {'key': 'party_b_type',  'label': 'Party B Entity Type', 'required': True,  'type': 'select', 'option_set': 'entity_types', 'hint': 'Legal form of the second party'},
    {'key': 'purpose',       'label': 'Purpose of Disclosure','required': True, 'type': 'text',   'hint': 'Business purpose for sharing confidential information'},
    {'key': 'effective_date','label': 'Effective Date',       'required': True,  'type': 'date',   'hint': 'The date the NDA takes effect'},
    {'key': 'term_years',    'label': 'Term (years)',         'required': True,  'type': 'text',   'hint': 'Duration of the NDA, e.g. 2'},
    {'key': 'survival_years','label': 'Confidentiality survives for (years after termination)', 'required': False, 'type': 'text', 'hint': 'How long confidentiality lasts after the NDA ends, e.g. 3'},
    {'key': 'termination_notice_days', 'label': 'Termination notice period (days)', 'required': False, 'type': 'text', 'hint': 'Notice required to terminate early, e.g. 30'},
    {'key': 'governing_state','label': 'Governing State',     'required': True,  'type': 'select', 'option_set': 'states', 'hint': 'Whose state law governs the NDA'},
]

# Template.body_json: the ordered clause skeleton of the NDA. Each block's
# 'description' guides retrieval/generation for that section; no clause text is
# stored here — the actual wording is drawn from the chosen Sample at draft time.
BODY = [
    {
        'id': 'parties', 'type': 'parties', 'label': 'Parties',
        'description': (
            'Identification of the parties entering into the Mutual Non-Disclosure Agreement, '
            'including their full legal names, entity types, and registered addresses under Indian law.'
        ),
    },
    {
        'id': 'recitals', 'type': 'recitals', 'label': 'Recitals',
        'description': (
            'Background recitals (whereas clauses) describing the purpose of the agreement and '
            'the intent of both parties to share confidential information for a specific business purpose.'
        ),
    },
    {
        'id': 'definitions', 'type': 'definition', 'label': 'Definitions',
        'description': (
            'Definition of Confidential Information under the agreement, specifying what types of '
            'information are covered, how disclosure may occur (oral, written, electronic), and '
            'the standard of care required.'
        ),
    },
    {
        'id': 'obligations', 'type': 'obligations', 'label': 'Confidentiality Obligations',
        'description': (
            'Core mutual obligations of each party to keep the other party\'s confidential information '
            'secret, not to disclose it to third parties without prior written consent, and to use it '
            'solely for the stated purpose.'
        ),
    },
    {
        'id': 'exclusions', 'type': 'exclusions', 'label': 'Exclusions from Confidentiality',
        'description': (
            'Carve-outs from the confidentiality obligation: information already in the public domain, '
            'independently developed without use of confidential information, received from a third party '
            'without restriction, or required to be disclosed by applicable Indian law or court order.'
        ),
    },
    {
        'id': 'term', 'type': 'term', 'label': 'Term and Termination',
        'description': (
            'Duration of the agreement from the effective date (the Term); early termination by either '
            'party on the stated notice period (termination notice in days); and survival of the '
            'confidentiality obligations for the stated number of years after termination or expiry.'
        ),
    },
    {
        'id': 'governing_law', 'type': 'governing_law', 'label': 'Governing Law and Jurisdiction',
        'description': (
            'The agreement shall be governed by and construed in accordance with the laws of India. '
            'Disputes shall be subject to the exclusive jurisdiction of courts in the specified state.'
        ),
    },
    {
        'id': 'general', 'type': 'general', 'label': 'General Provisions',
        'description': (
            'Miscellaneous provisions including: entire agreement, amendments in writing, severability, '
            'waiver, no partnership or agency, notices, and counterparts.'
        ),
    },
]


class Command(BaseCommand):
    """Upserts the Mutual NDA template using the SLOT_SCHEMA and BODY above."""

    help = 'Seed the database with a Mutual NDA template'

    def handle(self, *args, **options):
        """Create or update the NDA template, keyed on (name, document_type)."""
        # update_or_create makes the command idempotent: the (name, document_type)
        # pair is the lookup key, and defaults are (re)applied on every run.
        template, created = Template.objects.update_or_create(
            name='Mutual Non-Disclosure Agreement',
            document_type='nda',
            defaults={
                'language': 'en',
                'slot_schema': SLOT_SCHEMA,
                'body_json': BODY,
            },
        )
        verb = 'Created' if created else 'Updated'
        self.stdout.write(self.style.SUCCESS(f'{verb} NDA template (id={template.id})'))
