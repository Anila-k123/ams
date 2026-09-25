"""Translation provider — Sarvam AI Translation API.

Hosted API for English ↔ 22 Indian languages. Get a subscription key at
sarvam.ai; set SARVAM_API_KEY in backend/.env.

Sarvam's /translate endpoint takes a SINGLE string per call (no batch array) and
caps input length per request (1000 chars for mayura:v1, 2000 for
sarvam-translate:v1), so this provider loops over the list and chunks any long
item on line/sentence boundaries, then rejoins — the public ``translate(list)``
interface is unchanged.

App language codes are ISO-639-1 ('en', 'hi', 'ml', ...); Sarvam wants the
regional ``xx-IN`` form, mapped in ``_LANG`` below.
"""
import logging
import re
import time

import requests as _requests

from django.conf import settings

logger = logging.getLogger(__name__)

_ENDPOINT = 'https://api.sarvam.ai/translate'

# App ISO-639-1 code → Sarvam language code.
_LANG = {
    'en': 'en-IN',
    'hi': 'hi-IN',
    'kn': 'kn-IN',
    'ta': 'ta-IN',
    'te': 'te-IN',
    'ml': 'ml-IN',
    'mr': 'mr-IN',
    'gu': 'gu-IN',
    'bn': 'bn-IN',
    'pa': 'pa-IN',
    'ur': 'ur-IN',
}

# Per-request input character cap, by model.
_CHAR_LIMIT = {
    'mayura:v1': 1000,
    'sarvam-translate:v1': 2000,
}


class TranslationProvider:
    """Calls the Sarvam AI Translation API."""

    def __init__(self):
        self._key = settings.SARVAM_API_KEY
        self._model = settings.SARVAM_MODEL
        self._mode = settings.SARVAM_MODE
        self._limit = _CHAR_LIMIT.get(self._model, 1000)

    @property
    def configured(self) -> bool:
        return bool(self._key)

    def translate(self, sentences: list[str], source_lang: str, target_lang: str) -> list[str]:
        """Translate a list of strings; returns translations in the same order."""
        if not sentences:
            return []
        if not self._key:
            raise RuntimeError(
                'Sarvam API key not set. Add SARVAM_API_KEY=... to backend/.env.'
            )

        src = _LANG.get(source_lang)
        tgt = _LANG.get(target_lang)
        if src is None or tgt is None:
            raise RuntimeError(
                f'Sarvam has no language code for {source_lang!r}→{target_lang!r}'
            )

        print(
            f'[translate] → Sarvam ({self._model}): {len(sentences)} item(s) {src}→{tgt}',
            flush=True,
        )
        t0 = time.time()

        results = [self._translate_one(s, src, tgt) for s in sentences]

        print(
            f'[translate] ← done in {time.time() - t0:.1f}s | '
            f'e.g. {sentences[0][:60]!r} → {results[0][:60]!r}',
            flush=True,
        )
        return results

    def _translate_one(self, text: str, src: str, tgt: str) -> str:
        """Translate one string, chunking if it exceeds the model's char limit."""
        if len(text) <= self._limit:
            return self._call(text, src, tgt)
        # Preserve paragraph structure: translate each chunk, rejoin with '\n'.
        return '\n'.join(self._call(chunk, src, tgt) for chunk in self._chunk(text))

    def _chunk(self, text: str):
        """Yield pieces of ``text`` each within the char limit, split on line then
        sentence boundaries so we never cut mid-sentence when avoidable."""
        for line in text.split('\n'):
            if len(line) <= self._limit:
                yield line
                continue
            # Line itself too long — pack sentences greedily.
            buf = ''
            for sent in re.split(r'(?<=[.।?!])\s+', line):
                if buf and len(buf) + 1 + len(sent) > self._limit:
                    yield buf
                    buf = sent
                else:
                    buf = f'{buf} {sent}'.strip() if buf else sent
                # A single sentence longer than the limit: hard-split by width.
                while len(buf) > self._limit:
                    yield buf[: self._limit]
                    buf = buf[self._limit:]
            if buf:
                yield buf

    def _call(self, text: str, src: str, tgt: str) -> str:
        """One POST to /translate; returns the translated string."""
        if not text.strip():
            return text
        payload = {
            'input': text,
            'source_language_code': src,
            'target_language_code': tgt,
            'model': self._model,
            'mode': self._mode,
            'numerals_format': 'native',
        }
        resp = _requests.post(
            _ENDPOINT,
            headers={'api-subscription-key': self._key},
            json=payload,
            timeout=30,
        )
        if not resp.ok:
            raise RuntimeError(
                f'Sarvam Translate error {resp.status_code}: {resp.text[:300]}'
            )
        return resp.json()['translated_text']


_provider: TranslationProvider | None = None


def get_translator() -> TranslationProvider:
    """Return the (cached) translation provider singleton."""
    global _provider
    if _provider is None:
        _provider = TranslationProvider()
    return _provider
