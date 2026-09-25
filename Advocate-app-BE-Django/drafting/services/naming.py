import json
import logging
import re

logger = logging.getLogger(__name__)

# Clauses are named in bounded batches (one LLM call each) so the prompt never
# grows unboundedly on large documents. A 24-clause doc -> 3 calls, etc.
NAME_BATCH_SIZE = 8

_SYSTEM = (
    "You name clauses in a legal document. You are given a numbered list of clause "
    "texts. For each clause, decide a concise, descriptive title and a short category "
    "label that best fit its content — use your own judgement, there is no fixed list. "
    "Return ONLY a JSON array with one object per clause, in the same order and the same "
    "count, each: {\"name\": a concise clause title of 3-6 words, \"type\": a short "
    "lowercase category (e.g. definitions, termination, indemnity)}. "
    "No prose, no markdown — just the JSON array."
)


def name_slots(slots: list[dict], doc_label: str = 'agreement', model: str = 'gemini') -> list[dict]:
    """Best-effort: ask the LLM for a clean name + type per clause slot.

    Processes clauses in bounded batches — one LLM call per batch — so large
    documents don't send everything in a single oversized prompt. Each batch is
    independent: if one batch's call fails or returns an unexpected shape, that
    batch keeps its rule-derived labels while the others still get named.
    `model` selects the LLM (only 'gemini' is supported).
    """
    if not slots:
        return slots

    # Cloud models (Gemini) have the context to name the whole document in ONE call —
    # avoids the repeated system prompt. The small local model stays bounded at 8/call.
    batch_size = len(slots) if (model or '').lower() == 'gemini' else NAME_BATCH_SIZE
    batches = [slots[i:i + batch_size] for i in range(0, len(slots), batch_size)]
    logger.info('name_slots: naming %s clauses in %s batch(es) via %s', len(slots), len(batches), model)

    named: list[dict] = []
    for batch in batches:
        named.extend(_name_batch(batch, doc_label, model))
    return named


def _call_namer(batch: list[dict], doc_label: str, model: str):
    """One LLM naming call → parsed JSON array (or None on failure/bad shape)."""
    from drafting.providers.llm import get_llm
    listing = '\n\n'.join(
        f"[{i + 1}] {s.get('description', s.get('label', ''))[:600]}"
        for i, s in enumerate(batch)
    )
    user = f"Document type: {doc_label}\n\nClauses:\n{listing}"
    try:
        # Cloud names the whole doc in one call → allow a larger JSON array without truncation.
        raw = get_llm(model).complete(system=_SYSTEM, user=user, max_tokens=4096)
        parsed = _parse_json_array(raw)
    except Exception:
        logger.warning('name_slots: %s naming call failed', model)
        return None
    if not isinstance(parsed, list) or len(parsed) != len(batch):
        logger.warning('name_slots: %s returned %s items for %s clauses',
                       model, len(parsed) if isinstance(parsed, list) else 'non-list', len(batch))
        return None
    return parsed


def _name_batch(batch: list[dict], doc_label: str, model: str = 'gemini') -> list[dict]:
    """Name a bounded group of clauses. Tries `model`, falling back to
    rule-derived labels if it errors/rate-limits — so template naming still works
    when the model is unavailable."""
    try:
        parsed = _call_namer(batch, doc_label, model)
        if parsed is None:
            return batch  # model failed — keep rule-derived labels

        from .parser import clause_title, annexure_prefix, is_signature_block

        out = []
        for slot, info in zip(batch, parsed):
            name = (info.get('name') or '').strip() if isinstance(info, dict) else ''
            ctype = (info.get('type') or '').strip().lower() if isinstance(info, dict) else ''
            desc = slot.get('description', '')
            fallback = slot.get('label', 'Clause')

            prefix = annexure_prefix(desc)
            if prefix:
                # "Exhibit A" + the LLM's descriptive name => "Exhibit A — Subscription Order Form"
                label = f'{prefix} — {name}' if name else fallback
            elif is_signature_block(desc):
                label, ctype = '', 'signature'   # execution block — no section title/heading
            elif slot.get('id') == 'clause_0':
                # The first block is the title/preamble (no real clause heading) — use the LLM name.
                label = name or fallback
            else:
                # Structured clause: prefer the document's own section heading.
                label = clause_title(desc) or name or fallback

            out.append({**slot, 'label': label, 'type': ctype or slot.get('type', 'general')})
        return out
    except Exception:
        logger.exception('name_slots: batch failed; keeping rule-derived labels')
        return batch


def _parse_json_array(text: str):
    """Extract a JSON array from the model output. Tolerates markdown fences, prose,
    and the quirks cloud models (Gemini) emit — trailing commas and single quotes —
    which strict json.loads rejects."""
    text = (text or '').strip()
    text = re.sub(r'```(?:json)?', '', text, flags=re.IGNORECASE).strip()
    start, end = text.find('['), text.rfind(']')
    if start != -1 and end != -1 and end > start:
        text = text[start:end + 1]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Repair common LLM JSON quirks and retry: strip trailing commas before ] or }.
        repaired = re.sub(r',(\s*[\]}])', r'\1', text)
        return json.loads(repaired)
