"""P1-9: confidential text never reaches an external model unmasked.

Only Lisa's chat used to be masked. Drafting (generation, edit, refine,
playbooks, consistency, risk) and document summaries sent client names, party
names and whole documents to Anthropic / Gemini / OpenAI as written. These
tests use a fake provider that records what would have been sent - nothing
leaves the machine.
"""
import json
from unittest import mock

from django.test import TestCase, override_settings

from core.testing import make_advocate, make_client
from drafting.providers.llm import LLMProvider
from drafting.providers.privacy import (ExternalAIBlocked, _Guard, fact_names, is_external,
                                        names_for_masking)
from metering.usage import metering

CONTRACT = (
    'MUTUAL NON-DISCLOSURE AGREEMENT\n'
    '1. PARTIES. This Agreement is made between Ramesh Kumar of 14 Lake View Road, Chennai '
    '(the "Disclosing Party") and Lakshmi Devi (the "Receiving Party").\n'
    '1.1 The Receiving Party shall keep all Confidential Information secret.\n'
    '12.3 Notices go to ramesh.kumar@example.com or 98400 12345, dated [[Date of Execution]].\n'
    '| Party | Role |\n| Ramesh Kumar | Disclosing Party |')


class _Fake:
    """Stands in for the provider's HTTP call; echoes the prompt back."""

    def __init__(self):
        self.sent = []

    def __call__(self, system, user, max_tokens):
        self.sent.append(system + '\n' + user)
        return user, (10, 10)


class ExternalDraftingTests(TestCase):
    def setUp(self):
        self.adv = make_advocate(full_name='Priya Nair')
        make_client(self.adv, 'Ramesh Kumar', address='14 Lake View Road, Chennai')
        self.provider = LLMProvider({'provider': 'anthropic', 'model': 'fake', 'api_key': 'x'})
        self.fake = _Fake()

    def run_external(self, text, names=()):
        with mock.patch.object(self.provider, '_complete_anthropic', self.fake), \
                mock.patch.object(self.provider, '_meter'), \
                metering('draft', 'test', self.adv.id), names_for_masking(names):
            return self.provider.complete('Draft carefully.', text)

    def test_names_and_identifiers_do_not_leave(self):
        self.run_external(CONTRACT, names=['Lakshmi Devi'])
        sent = self.fake.sent[0]
        for secret in ('Ramesh', 'Lakshmi', 'Lake View', 'ramesh.kumar@example.com', '98400'):
            self.assertNotIn(secret, sent)

    def test_reply_comes_back_with_the_real_text_exactly(self):
        out = self.run_external(CONTRACT, names=['Lakshmi Devi'])
        # Defined terms, numbering, table rows and [[placeholders]] survive the round trip.
        self.assertEqual(out, CONTRACT)

    def test_defined_terms_and_structure_are_not_masked(self):
        self.run_external(CONTRACT, names=['Lakshmi Devi'])
        sent = self.fake.sent[0]
        for kept in ('"Disclosing Party"', '"Receiving Party"', '1.1 The Receiving Party',
                     '12.3 Notices', '[[Date of Execution]]', 'Confidential Information', '| Party | Role |'):
            self.assertIn(kept, sent)

    def test_a_token_the_model_invents_is_left_visible(self):
        with mock.patch.object(self.provider, '_complete_anthropic',
                               return_value=('Signed by [CLIENT_99].', None)), \
                mock.patch.object(self.provider, '_meter'), metering('draft', 'test', self.adv.id):
            self.assertEqual(self.provider.complete('s', 'u'), 'Signed by [CLIENT_99].')

    def test_no_acting_user_means_nothing_is_sent(self):
        with mock.patch.object(self.provider, '_complete_anthropic', self.fake), \
                mock.patch.object(self.provider, '_meter'):
            with self.assertRaises(ExternalAIBlocked):
                self.provider.complete('Draft.', CONTRACT)
        self.assertEqual(self.fake.sent, [])

    def test_incomplete_masking_fails_closed(self):
        class Leaky:
            _names = []

            def mask(self, text):
                return text            # pretends to mask, changes nothing

            def unmask(self, text):
                return text
        guard = _Guard(Leaky(), {'Lakshmi Devi'})
        with self.assertRaises(ExternalAIBlocked):
            guard.outgoing('s', 'Agreement with Lakshmi Devi')

    @override_settings(DRAFTING_MASK_EXTERNAL=False)
    def test_explicit_opt_out_sends_the_original(self):
        self.run_external(CONTRACT)
        self.assertIn('Ramesh Kumar', self.fake.sent[0])


class LocalModelTests(TestCase):
    def test_local_models_are_not_masked(self):
        self.assertFalse(is_external('openai', 'http://127.0.0.1:11434'))
        self.assertFalse(is_external('ollama', 'http://localhost:11434'))
        self.assertFalse(is_external('openai', 'http://192.168.1.20:8000'))

    def test_cloud_and_tunnels_are_external(self):
        self.assertTrue(is_external('anthropic', ''))
        self.assertTrue(is_external('gemini', ''))
        self.assertTrue(is_external('openai', 'https://api.openai.com'))
        self.assertTrue(is_external('flask', 'https://abcd.ngrok-free.app'))


class FactNamesTests(TestCase):
    def test_party_facts_are_collected_and_terms_are_not(self):
        facts = {'disclosing_party_name': 'Ramesh Kumar', 'receiving_party': {'name': 'Lakshmi Devi'},
                 'term': '24 months', 'governing_law': 'India', 'parties': ['Acme Pvt Ltd']}
        names = fact_names(facts)
        self.assertIn('Ramesh Kumar', names)
        self.assertIn('Lakshmi Devi', names)
        self.assertIn('Acme Pvt Ltd', names)
        self.assertNotIn('24 months', names)
        self.assertNotIn('India', names)


class SummaryMaskingTests(TestCase):
    def test_document_text_is_masked_and_summary_unmasked(self):
        import datetime
        from core.models import Document
        from documents import summarizer
        from documents.models import DocumentSummary
        adv = make_advocate()
        make_client(adv, 'Ramesh Kumar')
        now = datetime.datetime.now()
        doc = Document.objects.create(document_name='Plaint', original_name='p.txt', stored_name='p.txt',
                                      file_path='p.txt', file_size=1, file_type='text/plain', version=1,
                                      download_count=0, status='ACTIVE', upload_date=now, updated_at=now,
                                      advocate_id=adv.id)
        row = DocumentSummary.objects.create(document_id=doc.id, status=DocumentSummary.PENDING)
        sent = []

        def fake_complete(system, user, **kw):
            sent.append(user)
            token = user.split('Plaintiff ')[1].split(' ')[0]
            return json.dumps({'summary': f'{token} sues for recovery.'})
        with mock.patch.object(summarizer, 'extract_text', return_value='Plaintiff Ramesh Kumar claims Rs 5 lakh.'), \
                mock.patch.object(summarizer, 'complete_text', side_effect=fake_complete), \
                mock.patch('assistant.provider.masking_enabled', return_value=True):
            summarizer.summarize(row)
        row.refresh_from_db()
        self.assertNotIn('Ramesh', sent[0])
        self.assertEqual(row.summary_text, 'Ramesh Kumar sues for recovery.')


class TranslationGateTests(TestCase):
    @override_settings(SARVAM_API_KEY='x', SARVAM_MODEL='sarvam-translate:v1', SARVAM_MODE='formal')
    def test_external_translation_is_off_by_default(self):
        from drafting.providers.translation import TranslationProvider
        t = TranslationProvider()
        with mock.patch.object(t, '_call') as call:
            with self.assertRaises(RuntimeError):
                t.translate(['Ramesh Kumar'], 'en', 'hi')
            call.assert_not_called()
