"""P1-8: model prompts, replies and translated text never reach the logs.

They carry client facts and clause text, and the logs are plain files
(keepalive logs/*.log). Only sizes, timing and a fingerprint may be logged.
"""
import io
import logging
from contextlib import redirect_stdout
from unittest import mock

from django.test import SimpleTestCase, override_settings

from drafting.providers.llm import LLMProvider
from drafting.providers.translation import TranslationProvider

SECRET_FACT = 'Ramesh Kumar of 14 Lake View Road owes Rs 42,00,000'
SECRET_REPLY = 'Draft clause naming Ramesh Kumar as the Borrower'


class _CaptureAll:
    """Collect every log record (any logger, any level) plus stdout."""

    def __enter__(self):
        self.stream = io.StringIO()
        self.handler = logging.StreamHandler(self.stream)
        self.handler.setLevel(logging.DEBUG)
        self.root = logging.getLogger()
        self.old_level = self.root.level
        self.root.setLevel(logging.DEBUG)
        self.root.addHandler(self.handler)
        self.stdout = io.StringIO()
        self._redirect = redirect_stdout(self.stdout)
        self._redirect.__enter__()
        # Loggers with propagate=False would bypass root; attach to them too.
        self.extra = [logging.getLogger(n) for n in ('drafting', 'drafting.providers.llm',
                                                     'drafting.providers.translation')]
        for lg in self.extra:
            lg.addHandler(self.handler)
        return self

    def __exit__(self, *exc):
        self._redirect.__exit__(*exc)
        for lg in self.extra:
            lg.removeHandler(self.handler)
        self.root.removeHandler(self.handler)
        self.root.setLevel(self.old_level)

    @property
    def text(self):
        return self.stream.getvalue() + self.stdout.getvalue()


class LLMProviderLoggingTests(SimpleTestCase):
    def _provider(self):
        return LLMProvider({'provider': 'openai', 'model': 'fake-model',
                            'base_url': 'http://127.0.0.1:9'})

    def test_prompt_and_reply_are_not_logged(self):
        p = self._provider()
        with mock.patch.object(p, '_complete_openai', return_value=(SECRET_REPLY, (10, 5))), \
                mock.patch.object(p, '_meter'), _CaptureAll() as cap:
            out = p.complete('You draft loan agreements.', SECRET_FACT)
        self.assertEqual(out, SECRET_REPLY)
        self.assertNotIn('Ramesh', cap.text)
        self.assertNotIn('Lake View', cap.text)
        self.assertNotIn('loan agreements', cap.text)
        # Still useful for operations: sizes are logged.
        self.assertIn('chars', cap.text)


@override_settings(SARVAM_API_KEY='test-only', SARVAM_MODEL='sarvam-translate:v1', SARVAM_MODE='formal',
                   ALLOW_EXTERNAL_TRANSLATION=True)
class TranslationLoggingTests(SimpleTestCase):
    def test_translated_text_is_not_logged_or_printed(self):
        t = TranslationProvider()
        with mock.patch.object(t, '_call', side_effect=lambda text, s, d: 'अनुवाद ' + text), \
                _CaptureAll() as cap:
            out = t.translate([SECRET_FACT], 'en', 'hi')
        self.assertEqual(len(out), 1)
        self.assertNotIn('Ramesh', cap.text)
        self.assertNotIn('अनुवाद', cap.text)
