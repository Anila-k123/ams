"""Background document summarization.

On upload we create a `DocumentSummary` row (PENDING) and process it off the
request thread. Text is extracted locally (PDF/DOCX/TXT), then sent to the same
LLM backend the assistant uses (`assistant.llm`, provider-selectable via
LLM_PROVIDER — set it to `gemini` for the online model). The model returns the
12-field legal key-points object as strict JSON, which we store.

Mirrors the repo's deferred-work philosophy (notifications: enqueue a row, then
process immediately AND via a scheduled command as the catch-up/retry path).
"""

import json
import logging
import os
import threading

from django.conf import settings

from core.models import Document
from assistant.llm import complete_text, active_model_name, AssistantUnavailable
from .models import DocumentSummary

log = logging.getLogger(__name__)

SUMMARY_MAX_CHARS = getattr(settings, 'SUMMARY_MAX_CHARS', 24000)

# MIME types / extensions we can extract text from.
_PDF_TYPES = ('application/pdf',)
_DOCX_TYPES = (
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
)


SUMMARY_SYSTEM_PROMPT = (
    "You are a meticulous legal-document analyst for an Indian advocate's practice. "
    "You are given the extracted text of a single legal document. Produce a concise, "
    "accurate briefing. Use ONLY what the text supports — never invent parties, dates, "
    "sections, or amounts. If a field is not present in the document, use null (for "
    "single values) or an empty array (for lists).\n\n"
    "Respond with STRICT JSON ONLY — no markdown, no code fences, no commentary — "
    "matching exactly this shape:\n"
    "{\n"
    '  "document_type": string|null,            // e.g. Plaint, Written Statement, Petition, Affidavit, Vakalatnama, Order/Judgment, Notice, Contract/Agreement, Bail application\n'
    '  "summary": string,                       // 3-5 sentence plain-language overview\n'
    '  "parties": [{"name": string, "role": string}],\n'
    '  "court_and_case_ref": string|null,       // court/forum name and case/CNR number if present\n'
    '  "key_dates": [{"date": string, "description": string}],\n'
    '  "reliefs_sought": [string],\n'
    '  "key_facts": [string],\n'
    '  "legal_grounds": [string],              // acts, sections, precedents cited\n'
    '  "obligations": [{"party": string, "obligation": string}],\n'
    '  "monetary_amounts": [{"amount": string, "context": string}],\n'
    '  "action_items": [string],               // deadlines/actions the advocate must take\n'
    '  "risks": [string]                       // red flags: missing signatures, ambiguous clauses, limitation concerns\n'
    "}\n"
    "Use Indian rupees (₹) for money. Keep list items short."
)


def _is_supported(file_type, path):
    ft = (file_type or '').lower()
    ext = os.path.splitext(path or '')[1].lower()
    if ft in _PDF_TYPES or ext == '.pdf':
        return 'pdf'
    if ft in _DOCX_TYPES or ext == '.docx':
        return 'docx'
    if ft.startswith('text/') or ext in ('.txt', '.md'):
        return 'txt'
    return None


def extract_text(doc):
    """Return extracted text (capped) or None if unsupported / no text found."""
    path = doc.file_path
    if not path or not os.path.exists(path):
        return None
    kind = _is_supported(doc.file_type, path)
    if kind is None:
        return None
    try:
        if kind == 'pdf':
            import pdfplumber
            parts = []
            with pdfplumber.open(path) as pdf:
                for page in pdf.pages:
                    parts.append(page.extract_text() or '')
                    if sum(len(p) for p in parts) >= SUMMARY_MAX_CHARS:
                        break
            text = '\n'.join(parts)
        elif kind == 'docx':
            import docx
            document = docx.Document(path)
            text = '\n'.join(p.text for p in document.paragraphs)
        else:  # txt
            with open(path, 'r', encoding='utf-8', errors='replace') as fh:
                text = fh.read(SUMMARY_MAX_CHARS + 1)
    except Exception as exc:  # extraction libraries can throw on odd files
        log.warning('summarizer: text extraction failed for doc %s: %s', doc.id, exc)
        return None

    text = (text or '').strip()
    if not text:
        return None
    return text[:SUMMARY_MAX_CHARS]


def _parse_json(raw):
    """Parse the model output into a dict, tolerating code fences / stray text."""
    s = (raw or '').strip()
    if s.startswith('```'):
        s = s.strip('`')
        # drop an optional leading 'json' language tag
        if s[:4].lower() == 'json':
            s = s[4:]
        s = s.strip()
    try:
        return json.loads(s)
    except ValueError:
        # last resort: grab the outermost {...}
        start, end = s.find('{'), s.rfind('}')
        if start != -1 and end > start:
            return json.loads(s[start:end + 1])
        raise


def summarize(row):
    """Run summarization for a DocumentSummary row (synchronous)."""
    row.status = DocumentSummary.PROCESSING
    row.error = None
    row.save(update_fields=['status', 'error', 'updated_at'])

    doc = Document.objects.filter(id=row.document_id).first()
    if doc is None:
        row.status = DocumentSummary.FAILED
        row.error = 'Document no longer exists.'
        row.save(update_fields=['status', 'error', 'updated_at'])
        return

    text = extract_text(doc)
    if text is None:
        row.status = DocumentSummary.UNSUPPORTED
        row.error = 'No extractable text (unsupported type or scanned image).'
        row.save(update_fields=['status', 'error', 'updated_at'])
        return

    user_prompt = (
        f"Document name: {doc.document_name}\n"
        f"Category (advocate-provided, may be wrong): {doc.category or 'unknown'}\n\n"
        f"--- DOCUMENT TEXT ---\n{text}"
    )
    try:
        raw = complete_text(SUMMARY_SYSTEM_PROMPT, user_prompt)
        data = _parse_json(raw)
    except AssistantUnavailable as exc:
        row.status = DocumentSummary.FAILED
        row.error = f'LLM unavailable: {exc}'
        row.save(update_fields=['status', 'error', 'updated_at'])
        return
    except ValueError as exc:
        row.status = DocumentSummary.FAILED
        row.error = f'Could not parse model output: {exc}'
        row.save(update_fields=['status', 'error', 'updated_at'])
        return

    row.summary_text = (data.get('summary') or '').strip() or None
    row.key_points_json = json.dumps(data, ensure_ascii=False)
    row.model_used = active_model_name()
    row.status = DocumentSummary.READY
    row.error = None
    row.save()


def _run_guarded(row_id):
    try:
        row = DocumentSummary.objects.filter(id=row_id).first()
        if row is not None:
            summarize(row)
    except Exception:
        log.exception('summarizer: background run failed for row %s', row_id)


def enqueue_and_run(doc):
    """Create/reset the summary row to PENDING and process it in a daemon thread.

    Non-blocking: returns immediately so the upload response isn't delayed. The
    scheduled `summarize_documents` command re-processes anything left PENDING or
    stuck in PROCESSING (e.g. if the process restarts mid-run).
    """
    if not getattr(settings, 'SUMMARY_ENABLED', True):
        return None
    row, _ = DocumentSummary.objects.update_or_create(
        document_id=doc.id,
        defaults={'status': DocumentSummary.PENDING, 'error': None},
    )
    threading.Thread(target=_run_guarded, args=(row.id,), daemon=True).start()
    return row
