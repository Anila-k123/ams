"""Document translation via the Sarvam AI Translation API.

Takes a processed Sample's SampleClause records, translates each clause whole
(one request per clause), and reassembles into structured {heading, body} blocks.
Inline bold from the source PDF is captured (pdfplumber font names) and carried
through as markdown ``**…**`` so the translated view keeps the document's emphasis.
Source language is auto-detected from the document's script; target is the user's choice.
"""
import logging
import re
import time

from ..providers.translation import get_translator

logger = logging.getLogger(__name__)

# Supported ISO-639-1 language codes — mapped to Sarvam xx-IN codes in the provider.
LANG_TAGS = {
    'en', 'hi', 'kn', 'ta', 'te', 'ml', 'mr', 'gu', 'bn', 'pa', 'ur',
}

# Unicode script ranges → app language code, for source auto-detection.
_SCRIPTS = [
    ('bn', (0x0980, 0x09FF)),
    ('pa', (0x0A00, 0x0A7F)),
    ('gu', (0x0A80, 0x0AFF)),
    ('ta', (0x0B80, 0x0BFF)),
    ('te', (0x0C00, 0x0C7F)),
    ('kn', (0x0C80, 0x0CFF)),
    ('ml', (0x0D00, 0x0D7F)),
    ('ur', (0x0600, 0x06FF)),
    ('hi', (0x0900, 0x097F)),  # Devanagari — Hindi/Marathi share; default to Hindi
]

# Text matching these patterns is passed through unchanged — URLs, email
# addresses, and bare domains produce hallucinated filler when translated.
_PASSTHROUGH_RE = re.compile(
    r'^('
    r'https?://\S+'
    r'|www\.\S+'
    r'|\S+\.(com|co\.\w+|in|org|net|io|gov)\b'
    r'|\S+@\S+\.\S+'
    r'|\d[\d/.\-:]+\d?'
    r')$',
    re.IGNORECASE,
)


def detect_source_lang(text: str) -> str:
    """Detect the document's dominant script and return its ISO-639-1 code ('en' default)."""
    counts: dict[str, int] = {}
    for ch in text:
        cp = ord(ch)
        for code, (lo, hi) in _SCRIPTS:
            if lo <= cp <= hi:
                counts[code] = counts.get(code, 0) + 1
                break
    return max(counts, key=counts.get) if counts else 'en'


def _should_passthrough(text: str) -> bool:
    """Return True for text that should not be sent to the translation API."""
    stripped = text.strip()
    words = stripped.split()
    if len(words) <= 1 and not any(c.isalpha() for c in stripped):
        return True
    return bool(_PASSTHROUGH_RE.match(stripped))


def _resplit(original: str, translated: str):
    """Split a *translated* clause into (heading, body), mirroring the original's shape.

    Heading-ness is decided from the ORIGINAL clause (its script/structure), then the
    translated text is split on its first line break — the document-level model keeps
    the heading on its own line. If the original had no heading, it's all body.
    """
    from .parser import clause_title
    if not clause_title(original):
        return '', translated
    head, _, body = translated.partition('\n')
    return head.strip(), body.strip()


# ── inline bold capture (from the source PDF) → markdown ───────────────────────
# We can't recover per-character formatting from Docling's text, but pdfplumber
# exposes each glyph's font name, so bold runs can be read straight off the PDF.
_BOLD_FONT_RE = re.compile(r'bold|black|semibold|heavy', re.IGNORECASE)


def _extract_bold_phrases(file_path: str) -> list[str]:
    """Best-effort: distinct bold text phrases in a PDF, via pdfplumber per-char
    font names. Returns [] for non-PDFs or on any failure (bold is optional)."""
    if not file_path or not file_path.lower().endswith('.pdf'):
        return []
    try:
        import pdfplumber
    except Exception:
        return []
    phrases: list[str] = []
    try:
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                run: list[str] = []
                prev = None
                for ch in page.chars:
                    if _BOLD_FONT_RE.search(ch.get('fontname') or ''):
                        if prev is not None:
                            # New line, or a word gap → insert a space between glyphs.
                            new_line = abs((ch.get('top') or 0) - (prev.get('top') or 0)) > 3
                            word_gap = (ch.get('x0') or 0) - (prev.get('x1') or 0) > 1.2
                            if new_line or word_gap:
                                run.append(' ')
                        run.append(ch.get('text') or '')
                        prev = ch
                    elif run:
                        phrases.append(''.join(run)); run, prev = [], None
                if run:
                    phrases.append(''.join(run))
    except Exception:
        logger.exception('bold extraction failed for %s', file_path)
        return []
    # Clean + dedupe: keep phrases that carry letters and aren't trivially short.
    seen: set[str] = set()
    out: list[str] = []
    for p in phrases:
        p = re.sub(r'\s+', ' ', p).strip(' \t.,;:')
        if len(p) < 2 or not any(c.isalpha() for c in p):
            continue
        if p.lower() not in seen:
            seen.add(p.lower()); out.append(p)
    return out


def _inject_bold(text: str, phrases: list[str]) -> str:
    """Wrap occurrences of each bold `phrase` in ``text`` with markdown ``**…**``.

    Longest phrases first so a shorter phrase can't split a longer one; the
    lookarounds avoid re-wrapping something already inside ``**…**``.
    """
    if not phrases:
        return text
    # Case-SENSITIVE: proper nouns keep their case in the body, but a bold ALL-CAPS
    # title ("AFFIDAVIT") must not bold the same word used in lowercase body prose.
    for p in sorted(phrases, key=len, reverse=True):
        pat = re.compile(r'(?<!\*)' + r'\s+'.join(re.escape(w) for w in p.split()) + r'(?!\*)')
        text = pat.sub(lambda m: f'**{m.group(0)}**', text)
    return text


def _strip_md(text: str) -> str:
    """Drop markdown bold markers (for the plain-text download field)."""
    return text.replace('**', '')


def translate_sample(sample, target_lang: str) -> tuple[str, list, str]:
    """Translate a processed Sample into ``target_lang``.

    Returns ``(plain_text, blocks, source_lang)`` where ``blocks`` is a list of
    ``{heading, body}`` per source clause. Source language is auto-detected; if it
    equals the target the originals are returned unchanged (no API call made).

    Each clause is translated as a single request (whole clause, heading + body
    together) so the document-level model sees full context — exactly one Sarvam
    API call per translatable clause.
    """
    from ..models import SampleClause

    if target_lang not in LANG_TAGS:
        raise RuntimeError(f'Unsupported target language: {target_lang!r}')

    clauses = list(
        SampleClause.objects.filter(sample=sample).order_by('position').values_list('text', flat=True)
    )
    if not clauses:
        raise RuntimeError('Document has no extracted text to translate.')

    # Capture inline bold from the source PDF and mark it up as markdown ``**…**``,
    # so it survives into the translated view (and the PDF download).
    try:
        path = sample.file.path
    except Exception:
        path = ''
    bold = _extract_bold_phrases(path)
    rich = [_inject_bold(c, bold) for c in clauses]

    source_lang = detect_source_lang('\n'.join(clauses))
    if source_lang == target_lang:
        # No translation needed — keep the (bolded) originals.
        blocks = [dict(zip(('heading', 'body'), _resplit(clauses[i], rich[i]))) for i in range(len(clauses))]
        return _blocks_to_text(blocks), blocks, source_lang

    translator = get_translator()
    total = len(clauses)
    print(
        f'[translate] sample {sample.id}: {total} clause(s), {source_lang}→{target_lang} '
        f'({len(bold)} bold phrase(s))',
        flush=True,
    )
    t0 = time.time()

    # Translate each (bolded) clause whole, one request per clause (skip passthroughs).
    indices = [i for i, c in enumerate(clauses) if c.strip() and not _should_passthrough(c)]
    translated: dict[int, str] = {}
    if indices:
        outs = translator.translate([rich[i] for i in indices], source_lang, target_lang)
        translated = dict(zip(indices, outs))

    # Re-split each translated clause into (heading, body), mirroring the original's
    # shape. Untranslated (passthrough) clauses keep their (bolded) original text.
    blocks = [dict(zip(('heading', 'body'), _resplit(clauses[i], translated.get(i, rich[i]))))
              for i in range(total)]
    print(
        f'[translate] sample {sample.id}: DONE — {total} clause(s) in {time.time() - t0:.1f}s',
        flush=True,
    )
    logger.info('translate_sample %s: %s→%s, %d clause(s)', sample.id, source_lang, target_lang, total)
    return _blocks_to_text(blocks), blocks, source_lang


def _blocks_to_text(blocks: list[dict]) -> str:
    """Flatten blocks to plain text (markdown bold markers stripped) for download."""
    parts = []
    for b in blocks:
        if b.get('heading'):
            parts.append(_strip_md(b['heading']))
        if b.get('body'):
            parts.append(_strip_md(b['body']))
    return '\n\n'.join(parts)
