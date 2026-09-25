"""Legal dictionary: search, term detail, and the Legal Glossary's Hindi equivalents."""

import json
import tempfile

from django.core.management import call_command
from django.test import TestCase

from core.testing import auth, make_advocate
from dictionary.models import LegalTerm
from dictionary.parse_glossary_hindi import fix_hindi, I_MARK, REPH


class HindiRepairTest(TestCase):
    """parse_glossary_hindi.fix_hindi: the PDF's drawing order -> logical Unicode."""

    def test_pre_base_i_moves_after_its_cluster(self):
        self.assertEqual(fix_hindi('अ' + I_MARK + 'भयुक्त'), 'अभियुक्त')
        self.assertEqual(fix_hindi('व्य' + I_MARK + 'क्त'), 'व्यक्ति')

    def test_reph_moves_before_its_syllable(self):
        self.assertEqual(fix_hindi('यथाथ' + REPH + 'ता'), 'यथार्थता')
        self.assertEqual(fix_hindi('पूवा' + REPH + 'नुमान'), 'पूर्वानुमान')

    def test_spurious_spaces_go(self):
        self.assertEqual(fix_hindi('अभियुक् त'), 'अभियुक्त')
        self.assertEqual(fix_hindi('करन े'), 'करने')


class DictionaryHindiApiTest(TestCase):
    def setUp(self):
        self.user = make_advocate()
        self.bail = LegalTerm.objects.create(term='bail', term_norm='bail', letter='B',
                                             definition='temporary release from imprisonment', source='legal-glossary-in')
        self.tort = LegalTerm.objects.create(term='tort', term_norm='tort', letter='T',
                                             definition='a civil wrong', source='blacks-1910')

    def import_hindi(self, rows):
        f = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8')
        json.dump(rows, f, ensure_ascii=False)
        f.close()
        call_command('import_glossary_hindi', file=f.name)

    def test_import_and_api(self):
        self.import_hindi([{'term': 'Bail', 'hindi': 'जमानत ; उपनिहित करना'}])
        self.bail.refresh_from_db()
        self.assertEqual(self.bail.hindi, 'जमानत ; उपनिहित करना')
        detail = self.client.get(f'/api/dictionary/term/{self.bail.id}', **auth(self.user)).json()
        self.assertEqual(detail['hindi'], 'जमानत ; उपनिहित करना')
        hits = {r['term']: r['hasHindi'] for r in
                self.client.get('/api/dictionary/search?q=bail', **auth(self.user)).json()}
        self.assertTrue(hits['bail'])
        self.assertIsNone(self.client.get(f'/api/dictionary/term/{self.tort.id}', **auth(self.user)).json()['hindi'])

    def test_matching_ignores_spacing_and_spelling(self):
        judgment = LegalTerm.objects.create(term='judgment', term_norm='judgment', letter='J',
                                            definition='a decision', source='blacks-1910')
        imprest = LegalTerm.objects.create(term='imprest account', term_norm='imprest account', letter='I',
                                           definition='an advance account', source='legal-glossary-in')
        self.import_hindi([{'term': 'judgement', 'hindi': 'निर्णय'},
                           {'term': 'imprestaccount', 'hindi': 'अग्रदाय खाता'}])
        judgment.refresh_from_db()
        imprest.refresh_from_db()
        self.assertEqual((judgment.hindi, imprest.hindi), ('निर्णय', 'अग्रदाय खाता'))
