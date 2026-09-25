"""Celery tasks for the drafting pipeline.

The async jobs behind the HTTP layer, among them:
- process_sample: parse an uploaded sample, split it into clauses, and embed them.
- generate_draft: fill each template slot with an LLM-drafted, citation-verified block.

Model/DB imports are done lazily inside each task so this module stays import-light
and avoids circular imports with the app's models/providers/services.
"""

import json
import logging
import re

from celery import shared_task
from django.conf import settings

logger = logging.getLogger(__name__)

# Number of candidate source clauses offered to the model per slot (Stage B).
TOP_K = 3



def _parse_json_object(text: str):
    """Extract a JSON object from model output (tolerates markdown fences/prose)."""
    text = (text or '').strip()
    if text.startswith('```'):
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text, flags=re.IGNORECASE)
    start, end = text.find('{'), text.rfind('}')
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None


# The model sometimes returns the cited id under a different key (e.g. "id").
_CITATION_KEYS = ('source_clause_id', 'sourceClauseId', 'source_id', 'clause_id', 'id', 'source')


def _claimed_source_id(obj: dict):
    """Read the cited clause id from any of the common keys the model may use."""
    for key in _CITATION_KEYS:
        if isinstance(obj, dict) and obj.get(key) is not None:
            return obj[key]
    return None


@shared_task(bind=True, max_retries=3)
def process_sample(self, sample_id: int):
    """Parse uploaded file → split clauses → embed each → persist SampleClause
    records, and (if a contract_type was set on upload) promote the same clauses
    into the reusable Clause Library for from-scratch (Mode 3) drafting."""
    from .models import Sample, SampleClause, LibraryClause

    try:
        # Inside the try: if the parser / embedding stack can't load, the sample is
        # marked failed (and can be retried) instead of staying "pending" for ever.
        from .services.parser import extract_clauses
        from .providers.embeddings import get_embeddings
        sample = Sample.objects.get(id=sample_id)
        sample.status = Sample.Status.PROCESSING
        sample.save(update_fields=['status'])

        clauses = extract_clauses(sample.file.path)
        embeddings = get_embeddings()

        # Idempotent re-run: clear any clauses (and library entries) from a prior attempt.
        SampleClause.objects.filter(sample=sample).delete()
        LibraryClause.objects.filter(source_sample=sample).delete()

        # Embed every clause, then persist them in one bulk insert.
        to_create = []
        for clause_data in clauses:
            embedding = embeddings.embed(clause_data['text'])
            to_create.append(SampleClause(
                sample=sample,
                clause_type=clause_data['clause_type'],
                position=clause_data['position'],
                text=clause_data['text'],
                embedding=embedding,
            ))
        SampleClause.objects.bulk_create(to_create)

        # Populate the clause library from these clauses when tagged with a type.
        if sample.contract_type:
            variant = sample.variant or LibraryClause.Variant.ANY
            LibraryClause.objects.bulk_create([
                LibraryClause(
                    contract_type=sample.contract_type, clause_type=c.clause_type,
                    variant=variant, title=(c.clause_type or 'Clause').replace('_', ' ').title(),
                    text=c.text, embedding=c.embedding, source_sample=sample,
                )
                for c in to_create
            ])

        sample.status = Sample.Status.READY
        sample.save(update_fields=['status'])

    except Exception as exc:
        # On any failure, mark the sample FAILED so the UI stops waiting, then
        # retry (up to max_retries) when a broker is available.
        from .models import Sample
        logger.exception('process_sample failed for sample %s', sample_id)
        Sample.objects.filter(id=sample_id).update(status=Sample.Status.FAILED)
        if settings.CELERY_TASK_ALWAYS_EAGER:
            return  # local/dev: no broker to retry on — fail fast and log
        raise self.retry(exc=exc, countdown=60)


@shared_task(bind=True, max_retries=3)
def process_template(self, template_id: int):
    """Parse an uploaded template file into clause-skeleton slots (body_json) and
    LLM-name each slot, then mark the template READY. Runs in the background so the
    upload returns immediately and the Templates page shows a Processing status."""
    from .models import Template
    from .services.parser import extract_template_slots
    from .services.naming import name_slots

    try:
        template = Template.objects.get(id=template_id)
        template.status = Template.Status.PROCESSING
        template.save(update_fields=['status'])

        slots = extract_template_slots(template.file.path)
        slots = name_slots(slots, doc_label=template.document_type or template.name or 'agreement',
                           model='gemini')
        template.body_json = slots
        template.status = Template.Status.READY
        template.save(update_fields=['body_json', 'status'])

    except Exception as exc:
        # Mark FAILED so the UI stops waiting, then retry when a broker is available.
        from .models import Template
        logger.exception('process_template failed for template %s', template_id)
        Template.objects.filter(id=template_id).update(status=Template.Status.FAILED)
        if settings.CELERY_TASK_ALWAYS_EAGER:
            return  # local/dev: no broker to retry on — fail fast and log
        raise self.retry(exc=exc, countdown=60)


# Drafting-brief field labels (Mode 3's structured intake) → readable prompt lines.
_BRIEF_LABELS = {
    'document_title': 'Document title',
    'parties': 'Parties',
    'purpose': 'Purpose',
    'instructions': 'Instructions',
}
_BRIEF_ORDER = ('document_title', 'parties', 'purpose', 'instructions')

# Preferred draft style → a directive appended to the system prompt.
_STYLE_DIRECTIVES = {
    'Detailed': 'Draft thoroughly, with fuller clause detail and sub-clauses where appropriate.',
    'Balanced': 'Draft even-handedly, balancing the interests of the parties fairly.',
    'Court-ready': 'Draft in a formal register suitable for filing/execution — precise legal '
                   'language and proper structure.',
    'Commercial-friendly': 'Draft in clear, business-friendly language while remaining legally '
                           'sound; avoid unnecessary legalese.',
    'Highly protective': "Draft to strongly protect the client's interests — robust safeguards, "
                         "warranties and remedies in the client's favour where lawful.",
    'Simple language': 'Draft in plain, simple English a non-lawyer can follow, while preserving '
                       'legal effect.',
    # 'Standard' → no special directive.
}


def _facts_brief(facts: dict) -> str:
    """Format the case facts as a readable, labelled brief for the prompt — known
    brief fields first (title, parties, purpose, instructions), then any remaining
    facts (e.g. template slot fields). ``draft_style`` is handled separately."""
    if not facts:
        return 'None provided.'
    lines, seen = [], set()
    for key in _BRIEF_ORDER:
        val = facts.get(key)
        if val and str(val).strip():
            lines.append(f'{_BRIEF_LABELS[key]}: {str(val).strip()}')
            seen.add(key)
    for k, v in facts.items():
        if k in seen or k == 'draft_style' or not (v and str(v).strip()):
            continue
        lines.append(f'{k.replace("_", " ").strip().capitalize()}: {str(v).strip()}')
    return '\n'.join(lines) or 'None provided.'


def _style_directive(facts: dict) -> str:
    """The system-prompt directive for the chosen draft style ('' for Standard/none)."""
    return _STYLE_DIRECTIVES.get((facts.get('draft_style') or '').strip(), '')


# Party ROLE terms — defined labels that must survive as terms, never be replaced by
# a party's name in operative clauses.
_ROLE_WORDS = [
    'Disclosing Party', 'Receiving Party', 'Vendor', 'Customer', 'Client', 'Supplier',
    'Contractor', 'Consultant', 'Licensor', 'Licensee', 'Purchaser', 'Seller', 'Lessor',
    'Lessee', 'Employer', 'Employee', 'Company', 'Service Provider',
]


def _role_bindings(facts_text: str) -> dict:
    """Extract {party name: role} bindings the facts state, e.g. 'Sybrant … as Vendor'
    or 'Customer: Solara …'. Used to enforce defined role terms deterministically."""
    roles = '|'.join(re.escape(r) for r in _ROLE_WORDS)
    out: dict[str, str] = {}
    # "<delimiter> <Name> (…optional address…) as (the) <Role>" — the name is anchored to
    # start after 'between' / 'and' / a comma so it doesn't absorb preceding words.
    for m in re.finditer(r'(?:\bbetween\b|\band\b|,|^)\s*([A-Z][A-Za-z0-9.&\'\- ]{2,58}?)\s*(?:\([^)]*\)\s*)?\bas\s+(?:the\s+)?(' + roles + r')\b', facts_text):
        name = m.group(1).strip().rstrip(',').strip()
        if len(name) >= 3:
            out[name] = m.group(2).strip()
    # "<Role>: <Name>" / "<Role> is <Name>"
    for m in re.finditer(r'\b(' + roles + r')\b\s*(?:is|:)\s*([A-Z][A-Za-z0-9.,&\'\- ]{2,60})', facts_text):
        name = m.group(2).strip().rstrip('.,').strip()
        if len(name) >= 3 and name not in out:
            out[name] = m.group(1).strip()
    return out


def _binding_defined_here(text: str, role: str) -> bool:
    """True if this block DEFINES the role (binds a name to it), e.g. '… ("Vendor")' —
    the one place the party's name should stay."""
    return bool(re.search(r"""[("'‘“]\s*""" + re.escape(role) + r"""\s*[)"'’”]""", text))


# Signature / notice / address blocks legitimately restate the party's full name — the
# role-term enforcement must skip them (never turn a signatory's name into "the Vendor").
_IDENTITY_MARKERS = (
    'on behalf of', 'in witness whereof', 'attention of', 'signature and date',
    'signature:', '(name)', '(designation)', 'name / designation', 'duly executed',
)


def _is_identity_block(text: str) -> bool:
    low = (text or '').lower()
    return any(m in low for m in _IDENTITY_MARKERS)


def _enforce_role_terms(blocks, facts_text: str) -> None:
    """Replace a party's name with its defined role term ('the Vendor') in every clause
    EXCEPT the one that defines the binding — so operative clauses keep the defined term
    regardless of what the LLM produced. Mutates blocks in place."""
    bindings = _role_bindings(facts_text or '')
    if not bindings:
        return
    # Longest names first so a longer name isn't partially matched by a shorter one.
    compiled = [
        (name, role, re.compile(r"(?:the\s+)?['\"‘“]?" + re.escape(name) + r"['\"’”]?", re.I))
        for name, role in sorted(bindings.items(), key=lambda kv: -len(kv[0]))
    ]
    for b in blocks:
        text = b.text or ''
        html = b.content_html or ''
        # Identity blocks (signature / notice / address) must keep the actual party
        # name — never swap it for a role there.
        if _is_identity_block(text):
            continue
        for name, role, pat in compiled:
            if _binding_defined_here(text, role):
                continue  # this block defines the term — keep the name here
            text = pat.sub('the ' + role, text)
            if html:
                html = pat.sub('the ' + role, html)
        if text != (b.text or ''):
            b.text = text
        if html and html != (b.content_html or ''):
            b.content_html = html


# A blank fill-in run left in the text — underscores (___), a spaced underscore run,
# a long dotted leader (………/......), which the LLM should have turned into a labelled
# [[…]] placeholder (rule 6) but sometimes doesn't on the local model.
_BLANK_RUN = re.compile(r'_{3,}|(?:_[ \t]){2,}_?|\.{6,}|…+')


def _label_for_blank(before: str, after: str) -> str:
    """A [[Label]] for a blank, inferred from the words around it (so a filled-in chip
    names what belongs there — a date, a party name, an address …)."""
    # Tokens around the blank; strip a trailing period so a sentence-ending word
    # ("duration.") still matches its keyword.
    b = [t.rstrip('.') for t in re.findall(r"[a-z%$&./]+", before.lower())][-5:]
    a = [t.rstrip('.') for t in re.findall(r"[a-z%$&./]+", after.lower())][:4]
    ctx = set(b) | set(a)
    prv = b[-1] if b else ''
    nxt = a[0] if a else ''
    if prv == 'of' and 'date' in b[-3:]:                   # "…date of ____"
        return 'Month and Year'
    if nxt == 'date' or ('this' in b[-2:] and 'date' in a[:2]):
        return 'Day'
    # Durations before the generic date rule ("within ___ days" must not become "Date").
    if nxt == 'days' or ('within' in ctx and 'days' in a):
        return 'Number of Days'
    if nxt in ('years', 'year', 'months', 'month', 'duration', 'term', 'period'):
        return 'Duration'
    if {'date', 'dated'} & ctx or nxt == 'day':
        return 'Date'
    if prv in ('m/s.', 'm/s', 'messrs', 'messrs.') or nxt in ('pvt.', 'pvt', 'ltd.', 'ltd', 'co.', 'private'):
        return 'Party Name'
    if {'office', 'address', 'situated', 'premises'} & ctx or ('place' in ctx and 'business' in ctx):
        return 'Address'
    if prv in ('mr', 'ms', 'mrs', 'shri', 'smt', 'm/s'):
        return 'Name'
    if nxt == 'city' or (prv in ('at', 'in') and 'city' in a):
        return 'City'
    if nxt == '%' or {'rate', 'interest', 'percent'} & ctx:
        return 'Percentage'
    if {'rs', 'rs.', 'inr', 'amount', 'sum', 'fee', 'fees', 'dollars', 'consideration'} & ctx or prv in ('$',):
        return 'Amount'
    return 'Details'


def _fill_blank_placeholders(blocks) -> None:
    """Turn any leftover blank run (underscores / dotted leaders) into a labelled [[…]]
    placeholder, so the editor renders a fillable chip instead of a raw blank. Runs after
    generation as a deterministic backstop to rule 6. Mutates blocks in place."""
    def sub(s: str, is_html: bool) -> str:
        def repl(m):
            before, after = s[:m.start()], s[m.end():]
            if is_html:
                before, after = re.sub(r'<[^>]+>', ' ', before), re.sub(r'<[^>]+>', ' ', after)
            return '[[' + _label_for_blank(before, after) + ']]'
        return _BLANK_RUN.sub(repl, s)

    for b in blocks:
        if b.text and _BLANK_RUN.search(b.text):
            b.text = sub(b.text, False)
        if b.content_html and _BLANK_RUN.search(b.content_html):
            b.content_html = sub(b.content_html, True)


def _clause_heading(text: str) -> str:
    """The clause's OWN heading — its first non-empty line, when that line reads like
    a title (short, no sentence-ending punctuation) rather than body prose. Used in
    sample mode (Mode 2) so the draft shows the document's real heading/numbering
    (e.g. "1 DEFINITIONS") instead of an LLM-invented label. '' if the clause opens
    with prose (then no separate heading is shown)."""
    line = next((ln.strip() for ln in (text or '').splitlines() if ln.strip()), '')
    # A recital connector ("WHEREAS,", "NOW, THEREFORE", "AND") is NOT a heading — its
    # text is on the same line, so treating it as a heading would strip real content.
    norm = re.sub(r'[\s:.,\-]+$', '', line.lower())
    if norm in {'whereas', 'now therefore', 'now, therefore', 'and', 'or', 'between',
                'by and between', 'witnesseth', 'in witness whereof', 'recitals'}:
        return ''
    if line and len(line) <= 90 and not line.rstrip().endswith(('.', ';', ':')):
        return line
    return ''


# The "NOW, THEREFORE, … agree as follows:" operative lead-in (and "WITNESSETH")
# is pure boilerplate — it carries NO party-specific values — so a local model often
# drops it when rewriting the preamble (nothing to substitute anchors it). Capture the
# whole connector sentence so it can be re-appended verbatim if the rewrite lost it.
_NOW_THEREFORE = re.compile(
    r'NOW,?\s+THEREFORE\b.*?(?:agree[a-z]*\s+as\s+follows|witnesseth)\s*[:.]',
    re.I | re.S)


def _preserve_recital_connector(generated_text: str, source_text: str) -> str:
    """If the SOURCE clause had a 'NOW, THEREFORE, … agree as follows:' lead-in and the
    GENERATED rewrite dropped it, re-append it verbatim. Safe because the connector holds
    no party facts (unlike WHEREAS recitals, which we never re-inject for that reason)."""
    if not generated_text or not source_text:
        return generated_text
    if re.search(r'\bNOW,?\s+THEREFORE\b', generated_text, re.I):
        return generated_text  # the model kept it
    m = _NOW_THEREFORE.search(source_text)
    if not m:
        return generated_text
    connector = re.sub(r'\s+', ' ', m.group(0)).strip()
    return generated_text.rstrip() + '\n' + connector


# Signature / witness attestation phrases that mark a FORM's signing tail (Vakalatnama,
# affidavits). The model reproduces the body then tends to drop this trailing block.
_SIG_TAIL_MARKERS = ('signed in my presence', 'i identify the signature', 'thumb impression',
                     'in the presence of', 'signed, sealed and delivered')


def _preserve_signature_tail(generated_text: str, source_text: str) -> str:
    """If the SOURCE clause ends with a signature/witness attestation block and the
    GENERATED draft dropped it, graft that tail back on — the source lines after the last
    line the draft already covers. No-op for non-form clauses or when the tail is present."""
    if not generated_text or not source_text:
        return generated_text
    sl, gl = source_text.lower(), generated_text.lower()
    if not any(m in sl for m in _SIG_TAIL_MARKERS):   # source has no signing tail
        return generated_text
    if any(m in gl for m in _SIG_TAIL_MARKERS):        # the draft already includes it
        return generated_text
    src_lines = [ln for ln in source_text.splitlines() if ln.strip()]
    cut = None
    for i, ln in enumerate(src_lines):
        key = ' '.join(ln.split()[-6:]).lower().strip()   # tail of each source line
        if len(key) >= 8 and key in gl:
            cut = i                                        # last source line the draft covers
    if cut is None or cut < len(src_lines) * 0.5:          # couldn't confidently find the join
        return generated_text
    tail = '\n'.join(src_lines[cut + 1:]).strip()
    return generated_text.rstrip() + ('\n' + tail if tail else '')


def _template_heading(text: str) -> str:
    """The clause's OWN heading — the first line when it reads like a title: a number
    ('10. GOVERNING LAW:', '7. PAYMENT:'), an ARTICLE/SECTION marker, or a short ALL-CAPS
    title. '' when the clause opens with prose (e.g. an affidavit 'That, …' point)."""
    line = next((ln.strip() for ln in (text or '').splitlines() if ln.strip()), '')
    if not line or len(line) > 90:
        return ''
    if re.match(r'^\s*(?:\d+(?:\.\d+)*[.):]?\s|ARTICLE\s|SECTION\s|CLAUSE\s)', line, re.I):
        return line
    if any(c.isalpha() for c in line) and line == line.upper() and 1 <= len(line.split()) <= 8:
        return line
    return ''


def _preserve_clause_heading(generated_text: str, source_text: str) -> str:
    """If the source clause has its own heading and the model dropped it from the draft,
    prepend it — so every clause shows its name consistently (the model is unreliable about
    including the heading line). No-op when the source has no heading or the draft has it."""
    h = _template_heading(source_text)
    if not h or not generated_text:
        return generated_text
    first = next((ln.strip() for ln in generated_text.splitlines() if ln.strip()), '')
    norm = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())
    if norm(h) and norm(h) in norm(first):   # heading already present at the top
        return generated_text
    return h + '\n' + generated_text.lstrip()


def _failed_block(session, position, block_type, heading):
    """Placeholder block when a clause couldn't be generated (LLM unavailable)."""
    from .models import DraftBlock
    return DraftBlock(
        session=session, position=position, block_type=block_type, heading=heading,
        text='[This clause could not be generated — the LLM was unavailable. '
             'Please regenerate this draft.]',
        source=DraftBlock.Source.GENERATED, verified=False, similarity_score=None,
    )


def _is_rate_limit(exc: Exception) -> bool:
    """True if the failure is an HTTP 429 (rate limit) — as opposed to a transient
    connection drop / gateway error, which is safe to recover from per-slot."""
    try:
        import httpx
        return (isinstance(exc, httpx.HTTPStatusError)
                and exc.response is not None and exc.response.status_code == 429)
    except Exception:
        return False


# Cloud batch size: draft this many clauses per request. Small chunks keep each
# request fast/small so the provider doesn't disconnect on a huge single call, and a
# failed chunk only affects its own clauses.
_BATCH_CHUNK = 6


def _complete_batch(llm, system_prompt, specs, structured):
    """Draft EVERY clause in ONE LLM call (used for cloud models — a call per clause
    wastes tokens on the repeated system prompt). Returns {position: raw} where `raw`
    matches what the per-slot path produces (a {text, source_clause_id} JSON string
    when `structured`, else plain text). Missing positions are absent → the caller
    falls back to a per-slot call (also covering a dropped/truncated clause)."""
    if not specs:
        return {}
    items = '\n\n'.join(f'### ITEM {s["position"]} — {s["heading"]}\n{s["user_prompt"]}' for s in specs)
    system = system_prompt + (
        '\n\n--- BATCH MODE ---\n'
        'You are drafting SEVERAL clauses in one response. Apply all the rules above to EACH '
        'item independently. Return ONLY a JSON object (no markdown) mapping each ITEM number '
        '(string key) to its clause object: {"0": {"text": "<clause body>", "source_clause_id": '
        '<an id from THAT item\'s candidates, or null>}, "1": {…}}. Include EVERY item number; '
        'never merge, drop or renumber clauses.'
    )
    user = f'{items}\n\nReturn the JSON object mapping every item number to its clause:'
    try:
        raw = llm.complete(system=system, user=user, max_tokens=8192)
    except Exception as exc:
        # Distinguish WHY the batch failed:
        #  • rate-limit (429) → return None so the caller flags these clauses rather than
        #    firing one request per clause into the same limit (a 429 storm);
        #  • transient (connection drop / 5xx) → return {} so the caller falls back to
        #    per-slot calls (each request is small and usually succeeds).
        if _is_rate_limit(exc):
            logger.warning('generate_draft: batch chunk rate-limited; flagging (no per-slot storm)')
            return None
        logger.warning('generate_draft: batch chunk failed (%s); will retry per-slot', exc)
        return {}

    data = _parse_json_object(raw) or {}
    out = {}
    for key, val in data.items():
        if not str(key).lstrip('-').isdigit():
            continue
        if isinstance(val, dict):
            text, sid = (val.get('text') or '').strip(), val.get('source_clause_id', None)
        elif isinstance(val, str):
            text, sid = val.strip(), None
        else:
            continue
        if not text:
            continue
        out[int(key)] = json.dumps({'text': text, 'source_clause_id': sid}) if structured else text
    return out


# Appended to the prompt on a shrink-retry — the local model sometimes reproduces only a
# long clause's opening (the part with values to fill) and drops the rest as "boilerplate".
_FULL_REPRO_SUFFIX = (
    "\n\nIMPORTANT: your previous draft DROPPED content. Reproduce this clause IN FULL — "
    "EVERY numbered item, every enumerated power/obligation, every paragraph, and any "
    "witness/signature lines — substituting ONLY the party-specific values. Do NOT omit, "
    "summarise or truncate any paragraph; output the complete clause."
)


def _too_short(generated: str, source: str) -> bool:
    """True when a generated clause is suspiciously shorter than its source — a sign the
    model dropped whole paragraphs (only meaningful for a reasonably long source)."""
    s = len(source or '')
    return s >= 500 and len(generated or '') < 0.55 * s


def _generate_blocks(session, llm, system_prompt, specs, verify_citation, structured):
    """Turn per-clause `specs` into DraftBlocks. Model-aware: a CLOUD model drafts all
    clauses in one batched call; the LOCAL model goes clause-by-clause. Any clause the
    batch misses falls back to a per-slot call. `specs` items:
    {position, block_type, heading, user_prompt, by_id}. `structured` → parse+verify a
    {text, source_clause_id} response (Modes 1/2); else store plain text (Mode 3)."""
    from .models import DraftBlock

    # Cloud → batched calls in small CHUNKS; local → per-slot. A chunk that is
    # rate-limited (429) marks its clauses `rate_limited` so we DON'T fan out per-slot into
    # the same limit (a 429 storm). A chunk that fails transiently (connection drop / 5xx)
    # returns {} → those clauses fall back to per-slot calls. Missing/partial ids also fall
    # back per-slot. Local always goes per-slot.
    batch: dict = {}
    rate_limited: set = set()
    if session.llm != 'local':
        for i in range(0, len(specs), _BATCH_CHUNK):
            chunk = specs[i:i + _BATCH_CHUNK]
            res = _complete_batch(llm, system_prompt, chunk, structured)
            if res is None:                       # rate-limited — flag, no per-slot storm
                rate_limited.update(s['position'] for s in chunk)
            else:
                batch.update(res)
    blocks, failures = [], 0
    for s in specs:
        raw = batch.get(s['position'])
        if raw is None and s['position'] in rate_limited:  # rate-limited — don't storm
            failures += 1
            blocks.append(_failed_block(session, s['position'], s['block_type'], s['heading']))
            continue
        if raw is None:  # local model, or the batch omitted this one clause
            try:
                # Generous output cap so long clauses (e.g. a full DEFINITIONS with
                # exclusions) aren't truncated on the way out.
                raw = llm.complete(system=system_prompt, user=s['user_prompt'], max_tokens=4096)
            except Exception:
                logger.exception('generate_draft: clause %s (%r) failed; flagging for review',
                                 s['position'], s['heading'])
                failures += 1
                blocks.append(_failed_block(session, s['position'], s['block_type'], s['heading']))
                continue
        if structured:
            block = _verified_block(session, s['position'], s['block_type'], s['heading'],
                                    raw, s['by_id'], verify_citation)
            # Shrink guard: if the model dropped whole paragraphs of a long clause, retry
            # once demanding the FULL clause; keep whichever attempt is more complete. If it
            # is STILL truncated, fall back to the source text so no content is lost (the
            # role-term / blank-placeholder passes still run over it afterwards).
            src = s.get('source_text')
            if src and _too_short(block.text, src):
                try:
                    raw2 = llm.complete(system=system_prompt,
                                        user=s['user_prompt'] + _FULL_REPRO_SUFFIX, max_tokens=4096)
                    blk2 = _verified_block(session, s['position'], s['block_type'], s['heading'],
                                           raw2, s['by_id'], verify_citation)
                    if len(blk2.text or '') > len(block.text or ''):
                        block = blk2
                except Exception:
                    logger.exception('generate_draft: shrink-retry failed for clause %s', s['position'])
                if _too_short(block.text, src):
                    logger.warning('generate_draft: clause %s still truncated after retry — '
                                   'falling back to source text', s['position'])
                    block.text = src
                    block.source, block.verified, block.source_clause = DraftBlock.Source.GENERATED, False, None
            # Guarantee the recital connector + signature/witness tail survive even if
            # the model dropped them.
            if src:
                block.text = _preserve_recital_connector(block.text, src)
                block.text = _preserve_signature_tail(block.text, src)
                # When the clause has no separate display heading (Mode 1), guarantee its
                # own heading is in the body — the model omits it inconsistently.
                if not s.get('heading'):
                    block.text = _preserve_clause_heading(block.text, src)
        else:
            block = DraftBlock(
                session=session, position=s['position'], block_type=s['block_type'], heading=s['heading'],
                text=raw.strip(), source=DraftBlock.Source.GENERATED, verified=False, similarity_score=None,
            )
        block.text = _strip_markdown(block.text)  # never let Markdown (**bold**, #) leak into the doc
        _apply_template_style(block, s.get('style'))
        blocks.append(block)
    return blocks, failures


def _style_to_css(style: dict) -> str:
    """Turn a captured style dict into an inline CSS string (empty if nothing set)."""
    if not style:
        return ''
    css = []
    if style.get('align'):
        css.append(f"text-align:{style['align']}")
    if style.get('font'):
        css.append(f"font-family:'{style['font']}'")
    if style.get('size'):
        css.append(f"font-size:{style['size']}pt")
    if style.get('color'):
        css.append(f"color:{style['color']}")
    if style.get('bold'):
        css.append('font-weight:bold')
    if style.get('italic'):
        css.append('font-style:italic')
    if style.get('underline'):
        css.append('text-decoration:underline')
    if style.get('caps'):
        css.append('text-transform:uppercase')
    return ';'.join(css)


_MD_BOLD = re.compile(r'\*\*(.+?)\*\*|__(.+?)__')
_MD_HEADING = re.compile(r'^\s{0,3}#{1,6}\s+', re.MULTILINE)


def _strip_markdown(text: str) -> str:
    """Remove Markdown the model sometimes emits (the editor renders plain text, not
    Markdown): unwrap **bold**/__bold__ keeping the inner words, and drop leading #
    heading marks. Party names etc. then read cleanly instead of showing raw asterisks."""
    if not text:
        return text
    text = _MD_BOLD.sub(lambda m: m.group(1) or m.group(2), text)
    return _MD_HEADING.sub('', text)


def _styled_html(text: str, body_style: dict) -> str:
    """Build content_html for a generated clause: one <p> per line, carrying the
    template's body paragraph style as inline CSS. [[Label]] tokens are left intact
    (the editor converts them to placeholder nodes on load)."""
    css = _style_to_css(body_style)
    attr = f' style="{css}"' if css else ''
    esc = lambda s: s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    paras = [f'<p{attr}>{esc(line)}</p>' for line in (text or '').split('\n') if line.strip()]
    return ''.join(paras) or '<p></p>'


def _apply_template_style(block, style: dict | None):
    """Bake the captured DOCX template style onto a generated block: body paragraph
    style into content_html, heading style into style_json (for the editor)."""
    if not style:
        return
    body = style.get('body')
    if body and _style_to_css(body):
        block.content_html = _styled_html(block.text, body)
    heading = style.get('heading')
    if heading:
        block.style_json = {'heading': heading}


def _draft_template_mode(session, llm, emb, facts_text, sample_ids, style_directive=''):
    """Mode 1 — draft one block per template slot, retrieving candidate clauses
    pooled across ALL of the session's documents. Returns (blocks, failures)."""
    from pgvector.django import CosineDistance
    from .models import SampleClause
    from .services.citation import verify_citation

    doc_label = session.template.document_type or session.template.name or 'legal agreement'
    system_prompt = (
        "You are a legal drafting assistant specialising in Indian transactional law. "
        f"You are drafting ONE clause of a {doc_label} governed by Indian law.\n"
        "Follow these rules strictly:\n"
        "1. Draft ONLY the subject matter of the requested clause. Do NOT import obligations, "
        "amounts, durations, or terms that belong to other clauses — e.g. salary belongs in "
        "Compensation, notice periods and penalties in Termination, non-compete in the "
        "Restrictive Covenant clause. Each operative term must appear only in its own clause.\n"
        "2. If this clause is Definitions or Interpretation, only state the MEANING of each term. "
        "Keep definitions generic; never embed operative terms such as salary, penalties, "
        "notice periods, or durations inside a definition.\n"
        "3. Use the sample clause only as a reference for language and structure — adapt it, do "
        "not copy it verbatim.\n"
        "4. PARTY-SPECIFIC details — names, addresses, dates, monetary amounts, durations — must "
        "come from the case facts. Where a case fact supplies such a value, use it and REPLACE "
        "the corresponding example value found in the sample. The sample's own names, addresses "
        "and amounts are only examples — do not keep them when the case facts give the real value.\n"
        "4a. DEFINED TERMS — Keep every defined term EXACTLY as written and NEVER expand it into its "
        "literal value. This covers party role labels ('Disclosing Party', 'Receiving Party', "
        "'Party', 'Parties', 'Company') AND defined concepts ('Effective Date', 'Term', "
        "'Confidential Information', and any capitalised term the agreement defines). Write 'the "
        "Receiving Party' (NOT a party name/address), 'the Effective Date' (NOT '3rd March 2025'), "
        "'the term of this Agreement' (NOT 'two years'). A concrete VALUE — name, address, date, "
        "amount or duration — belongs ONLY in the one place the source first states/defines it (the "
        "parties/recital block binds a name to its label; the clause that sets the Effective Date or "
        "the Term states that value). Wherever a clause merely REFERENCES a defined term, keep the "
        "term, not the value. Role terms also include 'Customer', 'Vendor', 'Client', 'Supplier', "
        "'Contractor', 'Licensor', 'Licensee'. The facts may identify a party BY role (e.g. 'X as "
        "Vendor'); apply that binding ONLY in the parties block where the party is first defined — in "
        "recitals and every operative clause use the role term, NEVER the party's name.\n"
        "4b. DEFINING vs REFERENCING a value: the parties/title/recital block that introduces the "
        "agreement date ('as of ___', 'dated ___', 'on ___ (the Effective Date)') is the DEFINING "
        "clause — if the facts give the agreement date, insert the ACTUAL date here; do NOT leave a "
        "placeholder. ('Keep the term, not the value' applies only to OTHER clauses that merely "
        "reference the Effective Date.)\n"
        "5. PRESERVE generic or illustrative content from the sample that the case facts do not "
        "govern — e.g. bracketed lists like '[source code, client databases, pricing models]', "
        "and legal boilerplate. Do NOT delete such content.\n"
        "5a. KEEP recital / connector lines. Every 'WHEREAS …' recital and the operative lead-in "
        "('NOW, THEREFORE, … the parties hereby agree as follows:', 'WITNESSETH') MUST appear in "
        "your output — they carry no party values, so never drop them as filler.\n"
        "6. Do NOT invent values. If neither the case facts nor the sample provide a value, leave "
        "a LABELLED placeholder in the form [[Short Label]] that names the value (e.g. "
        "[[Date of Execution]], [[Employee Address]]); never use blank underscores.\n"
        "7. ATTRIBUTION: you are given candidate source clauses, each with a numeric id. Set "
        "\"source_clause_id\" to the id of the ONE candidate you actually drew the wording/"
        "structure from. If you drafted from scratch or none of the candidates fit, set it to "
        "null. You may ONLY use an id from the provided list — never invent an id.\n"
        "8a. PARAGRAPH STRUCTURE: Preserve the paragraph and line structure of the source "
        "clause. In the JSON \"text\" field, use \\n to separate each paragraph, power, "
        "obligation, or numbered item — never merge separate paragraphs into one run-on block.\n"
        "8a. Write the clause as PLAIN TEXT — do NOT use Markdown formatting: no **bold**, "
        "*italics*, backticks, or # headings.\n"
        "8. Return ONLY a JSON object, no markdown and no prose: "
        "{\"text\": \"<the clause body text>\", \"source_clause_id\": <id or null>}."
    )
    if style_directive:
        system_prompt += f'\n\nPREFERRED DRAFTING STYLE: {style_directive}'

    specs = []
    for position, slot in enumerate(session.template.body_json):
        slot_label = slot.get('label', '')
        slot_desc = slot.get('description', slot_label)
        slot_type = slot.get('type', 'clause')

        # Stage B — retrieve top-k candidate clauses (with ids) across all documents.
        query_vec = emb.embed(slot_desc)
        candidates = list(
            SampleClause.objects
            .filter(sample_id__in=sample_ids)
            .exclude(embedding=None)
            .order_by(CosineDistance('embedding', query_vec))[:TOP_K]
        )
        # Full candidate text (no truncation) so long form clauses — powers lists,
        # signature/witness blocks — are available in full for the model to reproduce.
        candidate_block = ('\n\n'.join(f'[id={c.id}] {c.text}' for c in candidates)
                           if candidates else 'No candidate clauses available.')

        user_prompt = (
            f"CLAUSE TO DRAFT: {slot_label}\n"
            f"SCOPE / PURPOSE OF THIS CLAUSE: {slot_desc}\n\n"
            f"AVAILABLE CASE FACTS (use ONLY those relevant to this clause; ignore the rest):\n{facts_text}\n\n"
            f"CANDIDATE SOURCE CLAUSES (reference for language/structure — adapt, do not copy "
            f"verbatim; cite at most one id you actually used, else null):\n{candidate_block}\n\n"
            f"Now draft only the \"{slot_label}\" clause and return the JSON object described above:"
        )
        # No separate display heading: the LLM-invented slot name can be wrong/awkward, and
        # the drafted clause already carries its own real heading/number in its text. Leave
        # the block heading empty so the clause's own heading shows, not an invented label.
        specs.append({'position': position, 'block_type': slot_type, 'heading': '',
                      'user_prompt': user_prompt, 'by_id': {c.id: c for c in candidates},
                      'source_text': slot_desc, 'style': slot.get('style')})

    return _generate_blocks(session, llm, system_prompt, specs, verify_citation, structured=True)


def _draft_sample_mode(session, llm, emb, facts_text, sample_ids, style_directive=''):
    """Mode 2 — no template. The FIRST selected document is the structural base:
    its clauses become the draft's clauses, rewritten to the case facts. Any OTHER
    selected documents are used only as *reference* — for each base clause we
    retrieve the most similar clauses from them so the model can borrow language,
    but they never create their own blocks (so two documents can't produce
    duplicate/contradictory clauses). For a field the facts don't mention, the base
    document's value is kept. Headings come from the LLM namer. Returns
    (blocks, failures)."""
    from pgvector.django import CosineDistance
    from .models import SampleClause
    from .services.citation import verify_citation

    primary_id, other_ids = sample_ids[0], sample_ids[1:]
    clauses = list(SampleClause.objects.filter(sample_id=primary_id).order_by('position'))

    system_prompt = (
        "You are a legal drafting assistant specialising in Indian transactional law. "
        "You are REWRITING one clause of an existing agreement to fit new case facts.\n"
        "Follow these rules strictly:\n"
        "1. Preserve the clause's subject matter, structure and legal effect; adapt the wording — "
        "do not copy it verbatim, and do not pull in content from other clauses.\n"
        "2. PARTY-SPECIFIC details — names, addresses, dates, monetary amounts, durations — come "
        "from the case facts. Where a fact supplies such a value, use it and REPLACE the clause's "
        "example value. Keep the clause's own example values only where the facts don't supply one.\n"
        "2a. DEFINED TERMS — Keep every defined term EXACTLY as written and NEVER expand it into its "
        "literal value. This covers party role labels ('Disclosing Party', 'Receiving Party', "
        "'Party', 'Parties', 'Company') AND defined concepts ('Effective Date', 'Term', "
        "'Confidential Information', and any capitalised term the agreement defines). Write 'the "
        "Receiving Party' (NOT a party name/address), 'the Effective Date' (NOT '3rd March 2025'), "
        "'the term of this Agreement' (NOT 'two years'). A concrete VALUE — name, address, date, "
        "amount or duration — belongs ONLY in the one place the source first states/defines it (the "
        "parties/recital block binds a name to its label; the clause that sets the Effective Date or "
        "the Term states that value). Wherever a clause merely REFERENCES a defined term, keep the "
        "term, not the value. Role terms also include 'Customer', 'Vendor', 'Client', 'Supplier', "
        "'Contractor', 'Licensor', 'Licensee'. The facts may identify a party BY role (e.g. 'X as "
        "Vendor'); apply that binding ONLY in the parties block where the party is first defined — in "
        "WHEREAS recitals and every operative clause use the role term ('the Vendor'), NEVER the name. "
        "(In DEFINITIONS, map a role to the party's short defined name — do NOT "
        "paste the full name and address.)\n"
        "3. Reference clauses (if any) are OPTIONAL language you may draw phrasing from — do NOT "
        "adopt their differing party-specific values or add unrelated content from them.\n"
        "4. PRESERVE generic or illustrative content the facts do not govern (bracketed lists, "
        "legal boilerplate). Do NOT delete such content.\n"
        "4b. KEEP recital / connector lines. Every 'WHEREAS …' recital and the operative lead-in "
        "('NOW, THEREFORE, … the parties hereby agree as follows:', 'WITNESSETH') MUST appear in "
        "your output. They carry no party values, so never drop them as filler.\n"
        "4c. DEFINING vs REFERENCING a value: the parties/title/recital block that introduces the "
        "agreement date ('as of ___', 'dated ___', 'on ___ (the Effective Date)') is the DEFINING "
        "clause — if the facts give the agreement date, insert the ACTUAL date here; do NOT leave a "
        "placeholder. ('Keep the term, not the value' applies only to OTHER clauses that reference it.)\n"
        "5. Do NOT invent values. If neither the facts nor the clause provide a value, leave a "
        "LABELLED placeholder in the form [[Short Label]] that names the value (e.g. "
        "[[Date of Execution]], [[Employee Address]]); never use blank underscores.\n"
        "6. ATTRIBUTION: set \"source_clause_id\" to the id of the clause you drew from (usually "
        "the clause being rewritten).\n"
        "6a. PARAGRAPH STRUCTURE: Preserve the paragraph and line structure of the source "
        "clause. In the JSON \"text\" field, use \\n to separate each paragraph, power, "
        "obligation, or numbered item — never merge separate paragraphs into one run-on block.\n"
        "7a. Write the clause as PLAIN TEXT — do NOT use Markdown formatting: no **bold**, "
        "*italics*, backticks, or # headings.\n"
        "7. Return ONLY a JSON object, no markdown and no prose: "
        "{\"text\": \"<the clause body text>\", \"source_clause_id\": <id or null>}."
    )
    if style_directive:
        system_prompt += f'\n\nPREFERRED DRAFTING STYLE: {style_directive}'

    from .models import DraftBlock
    specs, dividers = [], []
    for position, clause in enumerate(clauses):
        # Sample mode keeps the document's OWN heading (from the clause text), not an
        # LLM-invented name — the drafted text already carries the real title/numbering.
        heading = _clause_heading(clause.text)
        block_type = clause.clause_type or 'clause'

        # A bare heading / label line (e.g. "8 GENERAL", "ACCEPTED AND AGREED:",
        # "END OF TERMS") has no body to rewrite — sending it to the LLM makes it invent
        # a whole section/recital from the facts. Keep such single-line blocks verbatim.
        _lines = [ln for ln in clause.text.splitlines() if ln.strip()]
        _single = _lines[0].strip() if len(_lines) == 1 else ''
        is_divider = bool(_single) and (
            bool(heading)                                            # title/caps heading
            or _single.endswith(':')                                 # label / lead-in ("ACCEPTED AND AGREED:")
            or (_single.isupper() and len(_single.split()) <= 8)     # short all-caps ("END OF TERMS")
        )
        if is_divider:
            dividers.append(DraftBlock(
                session=session, position=position, block_type=block_type, heading=heading or _single,
                text=clause.text, source=DraftBlock.Source.GENERATED, verified=False, similarity_score=None))
            continue

        # References: the most similar clauses from the OTHER documents (if any).
        refs = []
        if other_ids and clause.embedding is not None:
            refs = list(
                SampleClause.objects.filter(sample_id__in=other_ids).exclude(embedding=None)
                .order_by(CosineDistance('embedding', list(clause.embedding)))[:TOP_K]
            )
        if refs:
            ref_list = '\n\n'.join(f'[id={r.id}] {r.text}' for r in refs)
            ref_block = ("\n\nREFERENCE CLAUSES from other documents (optional phrasing only; "
                         "keep this clause's own values):\n" + ref_list)
        else:
            ref_block = ''

        user_prompt = (
            # Full clause text — this is the clause being rewritten, so it must NOT be
            # truncated (a cut mid-clause loses content and leaves dangling sentences
            # the model "completes" with spurious placeholders).
            f"CLAUSE TO REWRITE (id={clause.id}, heading: {heading}):\n{clause.text}\n\n"
            f"AVAILABLE CASE FACTS (use ONLY those relevant to this clause; ignore the rest):\n{facts_text}"
            f"{ref_block}\n\n"
            "Rewrite this clause to reflect the case facts and return the JSON object described above:"
        )
        # Base clause + references are the citation candidates.
        specs.append({'position': position, 'block_type': block_type, 'heading': heading,
                      'user_prompt': user_prompt, 'source_text': clause.text,
                      'by_id': {clause.id: clause, **{r.id: r for r in refs}}})

    blocks, failures = _generate_blocks(session, llm, system_prompt, specs, verify_citation, structured=True)
    # Headings come from the ORIGINAL clause (set above), so a clause keeps its title
    # ("6 TERM") even when the LLM drops the heading line from its body-only rewrite.
    # Merge the heading-only dividers back in document order.
    all_blocks = sorted(blocks + dividers, key=lambda b: b.position)
    return all_blocks, failures


def _draft_library_mode(session, llm, emb, facts_text, style_directive=''):
    """Mode 3 — from scratch, no uploaded document. Structure comes from the
    session's template; each slot is filled from the firm's Clause Library
    (retrieved by contract_type) and adapted to the case facts. No citation
    verification (blocks are recorded as generated). Returns (blocks, failures)."""
    from pgvector.django import CosineDistance
    from .models import LibraryClause

    doc_label = session.template.document_type or session.template.name or 'legal agreement'
    contract_type = (session.template.document_type or session.template.name or '').strip()
    system_prompt = (
        "You are a legal drafting assistant specialising in Indian transactional law. "
        f"You are drafting ONE clause of a {doc_label} governed by Indian law, using the "
        "firm's approved clause library.\n"
        "Follow these rules strictly:\n"
        "1. Draft ONLY the subject matter of the requested clause; do NOT import terms from other clauses.\n"
        "2. Use the reference clause(s) from the library for language and structure — adapt them, do NOT copy verbatim.\n"
        "3. PARTY-SPECIFIC details — names, addresses, dates, amounts, durations — come from the case facts; "
        "use them and REPLACE any example values in the reference clause. Where a fact isn't provided, leave a "
        "LABELLED placeholder in the form [[Short Label]] that names the value (e.g. "
        "[[Date of Execution]], [[Employee Address]]); never use blank underscores.\n"
        "3a. DEFINED TERMS — Keep every defined term EXACTLY as written and NEVER expand it into its literal "
        "value. This covers party role labels ('Disclosing Party', 'Receiving Party', 'Party', 'Parties', "
        "'Company') AND defined concepts ('Effective Date', 'Term', 'Confidential Information', and any "
        "capitalised defined term). Write 'the Receiving Party' (NOT a name/address), 'the Effective Date' (NOT "
        "the literal date), 'the term of this Agreement' (NOT the number of years). A concrete VALUE belongs "
        "ONLY where the source first states/defines it; elsewhere reference the defined term, not the value.\n"
        "4. PRESERVE generic or illustrative content the facts do not govern (bracketed lists, boilerplate).\n"
        "4a. KEEP recital / connector lines — every 'WHEREAS …' recital and the operative lead-in "
        "('NOW, THEREFORE, … agree as follows:', 'WITNESSETH') MUST appear; never drop them as filler.\n"
        "4b. The parties/title/recital block that introduces the agreement date ('as of ___', 'dated "
        "___', 'on ___ (the Effective Date)') DEFINES it — if the facts give the date, insert the "
        "ACTUAL date here, do NOT leave a placeholder.\n"
        "5. Do NOT invent values.\n"
        "5a. PARAGRAPH STRUCTURE: Preserve the paragraph and line structure of the reference "
        "clause. Use a newline (\\n) to separate each paragraph, power, obligation, or numbered "
        "item — never merge separate paragraphs into one run-on block.\n"
        "6. Draft ONLY the clause body text — no heading and no commentary.\n"
        "7. Write PLAIN TEXT only — do NOT use Markdown: no **bold**, *italics*, backticks, or # headings."
    )
    if style_directive:
        system_prompt += f'\n\nPREFERRED DRAFTING STYLE: {style_directive}'

    specs = []
    for position, slot in enumerate(session.template.body_json):
        slot_label = slot.get('label', '')
        slot_desc = slot.get('description', slot_label)
        slot_type = slot.get('type', 'clause')

        # Retrieve the closest library clauses for this slot (contract_type-scoped).
        query_vec = emb.embed(slot_desc)
        candidates = list(
            LibraryClause.objects
            .filter(contract_type__iexact=contract_type, is_active=True)
            .exclude(embedding=None)
            .order_by(CosineDistance('embedding', query_vec))[:TOP_K]
        )
        ref_block = ('\n\n'.join(f'- {c.text}' for c in candidates)
                     if candidates else 'No library clause available — draft from the facts.')

        user_prompt = (
            f"CLAUSE TO DRAFT: {slot_label}\n"
            f"SCOPE / PURPOSE OF THIS CLAUSE: {slot_desc}\n\n"
            f"AVAILABLE CASE FACTS (use ONLY those relevant to this clause; ignore the rest):\n{facts_text}\n\n"
            f"REFERENCE CLAUSES (from the firm's clause library — adapt, do not copy verbatim):\n{ref_block}\n\n"
            f"Now draft only the \"{slot_label}\" clause (body text only):"
        )
        specs.append({'position': position, 'block_type': slot_type, 'heading': slot_label,
                      'user_prompt': user_prompt, 'by_id': {}, 'style': slot.get('style')})

    # Library mode has no citation verification — blocks are recorded as generated.
    return _generate_blocks(session, llm, system_prompt, specs, verify_citation=None, structured=False)


def _verified_block(session, position, block_type, heading, raw, by_id, verify_citation):
    """Parse the model's {text, source_clause_id}, verify the claimed citation by
    embedding similarity, and build a DraftBlock (SAMPLE_CLAUSE if verified, else
    GENERATED)."""
    from .models import DraftBlock

    # Stage C — parse the model's structured output {text, source_clause_id}.
    parsed = _parse_json_object(raw)
    if isinstance(parsed, dict) and isinstance(parsed.get('text'), str):
        generated_text = parsed['text'].strip()
        claimed_id = _claimed_source_id(parsed)
    else:
        generated_text = raw.strip()  # not valid JSON — keep text, no citation claim
        claimed_id = None

    # Stage D — resolve the claimed id against the offered candidates and confirm
    # the drafted text really matches that clause (embedding similarity).
    try:
        claimed = by_id.get(int(claimed_id))
    except (TypeError, ValueError):
        claimed = None

    if claimed is not None and claimed.embedding is not None:
        verified, score = verify_citation(generated_text, list(claimed.embedding))
    else:
        verified, score = False, None

    if verified:
        source, source_clause = DraftBlock.Source.SAMPLE_CLAUSE, claimed
    else:
        source, source_clause = DraftBlock.Source.GENERATED, None

    return DraftBlock(
        session=session, position=position, block_type=block_type, heading=heading,
        text=generated_text, source=source, source_clause=source_clause,
        verified=verified, similarity_score=score,
    )


@shared_task(bind=True, max_retries=3)
def translate_sample(self, sample_id: int, target_lang: str = 'en'):
    """Translate a processed sample into target_lang; cache it on the Sample."""
    from .models import Sample
    from .services.translate import translate_sample as run_translate

    try:
        sample = Sample.objects.get(id=sample_id)
        sample.translation_status = Sample.TranslationStatus.GENERATING
        sample.translation_target = target_lang
        sample.save(update_fields=['translation_status', 'translation_target'])

        text, blocks, source_lang = run_translate(sample, target_lang)

        sample.translation = text
        sample.translation_json = blocks
        sample.translation_source = source_lang
        sample.translation_status = Sample.TranslationStatus.READY
        sample.save(update_fields=['translation', 'translation_json', 'translation_source',
                                   'translation_status'])

    except Exception as exc:
        from .models import Sample
        logger.exception('translate_sample failed for sample %s', sample_id)
        Sample.objects.filter(id=sample_id).update(translation_status=Sample.TranslationStatus.FAILED)
        if settings.CELERY_TASK_ALWAYS_EAGER:
            return  # local/dev: no broker to retry on — fail fast and log
        raise self.retry(exc=exc, countdown=60)


@shared_task(bind=True, max_retries=3)
def generate_draft(self, session_id: int):
    """Retrieve/rewrite clauses → call LLM → verify citations → persist DraftBlocks.

    Branches on whether the session has a template: Mode 1 (template slots) or
    Mode 2 (rewrite the documents' own clauses). Candidate clauses are pooled
    across all of the session's documents.
    """
    from .models import DraftSession, DraftBlock
    from .providers.llm import get_llm
    from .providers.embeddings import get_embeddings

    try:
        session = (DraftSession.objects.select_related('template')
                   .prefetch_related('samples').get(id=session_id))
        session.status = DraftSession.Status.GENERATING
        session.save(update_fields=['status'])

        # Idempotent re-run: drop any blocks from a previous attempt.
        DraftBlock.objects.filter(session=session).delete()

        llm = get_llm(session.llm)           # always Gemini
        emb = get_embeddings()
        # Assemble the case facts into a labelled drafting brief; the chosen draft
        # style becomes a system-prompt directive.
        facts_text = _facts_brief(session.facts)
        style_directive = _style_directive(session.facts)
        # Preserve the user's selection order (M2M rows are created in that order),
        # so in Mode 2 the FIRST-selected document is the structural "primary".
        sample_ids = list(
            session.samples.through.objects.filter(draftsession=session)
            .order_by('id').values_list('sample_id', flat=True)
        )

        # Mode 3 (library): from scratch — template structure filled from the clause
        # library. Otherwise a template's slots drive Mode 1; without one we rewrite
        # the documents' own clauses (Mode 2).
        if session.mode == DraftSession.Mode.LIBRARY:
            blocks, failures = _draft_library_mode(session, llm, emb, facts_text, style_directive)
        elif session.template_id:
            blocks, failures = _draft_template_mode(session, llm, emb, facts_text, sample_ids, style_directive)
        else:
            blocks, failures = _draft_sample_mode(session, llm, emb, facts_text, sample_ids, style_directive)

        # If every clause failed, treat the whole run as failed (LLM down).
        if blocks and failures == len(blocks):
            raise RuntimeError('All clause generations failed — LLM server unavailable.')

        # Deterministic guard: the LLM sometimes replaces a defined ROLE term
        # (Vendor/Customer/Disclosing Party/…) with the party's name in operative
        # clauses. Restore the role term everywhere except the block that defines it.
        _enforce_role_terms(blocks, facts_text)
        # Deterministic backstop to rule 6: the local model leaves some blanks as raw
        # underscores — turn every leftover blank into a labelled [[…]] placeholder.
        _fill_blank_placeholders(blocks)

        # Persist all blocks at once.
        DraftBlock.objects.bulk_create(blocks)

        # Optional post-pass: replace stale IPC/CrPC/Evidence Act references with
        # the BNS/BNSS/BSA equivalents — only when the user opted in at session creation.
        if session.apply_bns_codes:
            from .services.legal_codes import patch_draft_session as _patch_legal_codes
            _patch_legal_codes(session.id)

        session.status = DraftSession.Status.READY
        session.save(update_fields=['status'])

    except Exception as exc:
        from .models import DraftSession
        logger.exception('generate_draft failed for session %s', session_id)
        DraftSession.objects.filter(id=session_id).update(status=DraftSession.Status.FAILED)
        if settings.CELERY_TASK_ALWAYS_EAGER:
            return  # local/dev: no broker to retry on — fail fast and log
        raise self.retry(exc=exc, countdown=60)


@shared_task(bind=True, max_retries=2)
def process_playbook(self, playbook_id: int):
    """Two-pass pipeline: extract raw clauses from each uploaded document, then
    synthesise them into consolidated PlaybookClause rows.

    Pass 1 (per document):
      - Create a Sample record (client=NULL) for the uploaded file.
      - Run process_sample synchronously → Docling splits into SampleClause chunks.
      - Send chunks in batches of 5 to the LLM; LLM filters preamble/definitions/
        boilerplate and extracts only substantive clauses.
      - Save PlaybookClauseRaw rows.

    Pass 2 (synthesis): for each distinct clause_type, collect all raw rows,
            use frequency stats to decide majority/minority, ask LLM to write
            natural-language standard_text / red_lines / fallback_positions,
            save PlaybookClause, delete the raw rows.
    """
    from django.conf import settings as _settings
    from .models import Playbook, PlaybookDocument, PlaybookClauseRaw, PlaybookClause, Sample, SampleClause
    from .providers.llm import get_llm
    from .providers.embeddings import get_embeddings
    from .services.playbook import extract_clauses_from_chunks, synthesise_clause_type

    try:
        playbook = Playbook.objects.get(id=playbook_id)
    except Playbook.DoesNotExist:
        logger.error('process_playbook: playbook %s not found', playbook_id)
        return

    playbook.status = Playbook.Status.PROCESSING
    playbook.save(update_fields=['status'])

    try:
        llm = get_llm(playbook.llm_provider)
        emb = get_embeddings()
        documents = list(playbook.documents.all())

        if not documents:
            # Scratch playbook — nothing to extract; mark ready immediately.
            playbook.status = Playbook.Status.READY
            playbook.save(update_fields=['status'])
            return

        # ── Pass 1: per document — create Sample → parse chunks → LLM extract ──
        for doc in documents:
            # Create a Sample record so the document appears in the Samples page
            # and its Docling-parsed chunks are stored as SampleClause rows.
            if not doc.sample_id:
                sample = Sample.objects.create(
                    name=doc.original_filename or doc.file.name,
                    file=doc.file,
                    uploaded_by_id=playbook.created_by_id,
                    # client and project left NULL — playbook docs have no client context
                )
                doc.sample = sample
                doc.save(update_fields=['sample'])
            else:
                sample = doc.sample

            # Run process_sample synchronously to parse + embed SampleClause rows.
            # .apply() always runs in the current process (bypasses broker).
            if sample.status != Sample.Status.READY:
                logger.info('process_playbook: running process_sample for sample %s', sample.id)
                process_sample.apply(args=[sample.id])
                sample.refresh_from_db()

            if sample.status != Sample.Status.READY:
                logger.warning('process_playbook: sample %s did not reach READY, skipping', sample.id)
                continue

            # Load Docling-parsed chunks for this document.
            chunks = list(SampleClause.objects.filter(sample=sample).order_by('position'))
            if not chunks:
                logger.warning('process_playbook: no chunks for sample %s', sample.id)
                continue

            extracted = extract_clauses_from_chunks(chunks, llm)
            raw_rows = [
                PlaybookClauseRaw(
                    playbook=playbook,
                    source_document=doc,
                    clause_type=item['clause_type'],
                    raw_text=item['raw_text'],
                    extracted_json=item['extracted_json'],
                )
                for item in extracted
            ]
            if raw_rows:
                PlaybookClauseRaw.objects.bulk_create(raw_rows)
            logger.info(
                'process_playbook: pass 1 — %d clauses from doc %s (%d chunks)',
                len(raw_rows), doc.id, len(chunks),
            )

        # ── Pass 2: synthesise by clause type ──────────────────────────────
        clause_types = (
            PlaybookClauseRaw.objects
            .filter(playbook=playbook)
            .values_list('clause_type', flat=True)
            .distinct()
        )

        playbook_clauses = []
        for position, clause_type in enumerate(clause_types):
            raw_rows = list(PlaybookClauseRaw.objects.filter(
                playbook=playbook, clause_type=clause_type
            ))
            result = synthesise_clause_type(clause_type, raw_rows, llm, emb=emb)
            if not result:
                logger.warning('process_playbook: synthesis returned nothing for %s', clause_type)
                continue

            embedding = None
            try:
                embedding = emb.embed(result['standard_text'])
            except Exception:
                logger.warning('process_playbook: embedding failed for %s', clause_type)

            playbook_clauses.append(PlaybookClause(
                playbook=playbook,
                clause_type=clause_type,
                position=position,
                standard_text=result['standard_text'],
                red_lines=result['red_lines'],
                fallback_positions=result['fallback_positions'],
                notes=result['notes'],
                source_doc_count=result['source_doc_count'],
                embedding=embedding,
            ))

        if playbook_clauses:
            PlaybookClause.objects.bulk_create(playbook_clauses)

        # Clean up the intermediate raw rows.
        PlaybookClauseRaw.objects.filter(playbook=playbook).delete()

        playbook.status = Playbook.Status.READY
        playbook.save(update_fields=['status'])
        logger.info('process_playbook: done — %d clauses for playbook %s', len(playbook_clauses), playbook_id)

    except Exception as exc:
        logger.exception('process_playbook failed for playbook %s', playbook_id)
        Playbook.objects.filter(id=playbook_id).update(status=Playbook.Status.FAILED)
        if settings.CELERY_TASK_ALWAYS_EAGER:
            return
        raise self.retry(exc=exc, countdown=60)


@shared_task(bind=True, max_retries=2)
def analyse_risks(self, session_id: int):
    """Clause-centric risk analysis: for every PlaybookClause, find the nearest
    DraftBlock and ask the LLM to flag deviations from the playbook position.

    Iterating over clauses (not blocks) guarantees all 30 playbook clauses are
    evaluated regardless of how the draft is split into blocks.
    """
    import numpy as np
    from .models import DraftSession, DraftBlock, PlaybookClause, PlaybookRisk
    from .providers.llm import get_llm
    from .providers.embeddings import get_embeddings
    from .services.playbook import analyse_block_risks, synthesise_risk_report

    try:
        session = DraftSession.objects.select_related('playbook').get(id=session_id)
    except DraftSession.DoesNotExist:
        logger.error('analyse_risks: session %s not found', session_id)
        return

    if not session.playbook_id:
        logger.warning('analyse_risks: session %s has no playbook attached', session_id)
        return

    session.risk_status = 'analyzing'
    session.save(update_fields=['risk_status'])

    try:
        llm = get_llm(getattr(settings, 'LLM_PLAYBOOK', 'gemini'))
        emb = get_embeddings()

        blocks = [b for b in DraftBlock.objects.filter(session=session).order_by('position')
                  if (b.text or '').strip()]

        if not blocks:
            session.risk_status = 'ready'
            session.save(update_fields=['risk_status'])
            logger.info('analyse_risks: no blocks for session %s', session_id)
            return

        # Embed all draft blocks upfront and normalise for cosine similarity.
        block_vecs = {}
        for block in blocks:
            try:
                vec = np.array(emb.embed(block.text), dtype=float)
                norm = np.linalg.norm(vec)
                block_vecs[block.id] = vec / norm if norm else vec
            except Exception:
                logger.warning('analyse_risks: embed failed for block %s', block.id)

        # Delete any prior run.
        PlaybookRisk.objects.filter(session=session).delete()

        playbook_clauses = list(
            PlaybookClause.objects.filter(playbook_id=session.playbook_id).exclude(embedding=None)
        )
        if not playbook_clauses:
            session.risk_status = 'ready'
            session.save(update_fields=['risk_status'])
            logger.warning('analyse_risks: no embedded clauses for playbook %s', session.playbook_id)
            return

        risks_to_create = []

        for pc in playbook_clauses:
            # Find the draft block nearest to this playbook clause.
            pc_vec = np.array(list(pc.embedding), dtype=float)
            pc_norm_val = np.linalg.norm(pc_vec)
            pc_norm = pc_vec / pc_norm_val if pc_norm_val else pc_vec

            best_block, best_sim = None, -1.0
            for block in blocks:
                if block.id not in block_vecs:
                    continue
                sim = float(np.dot(pc_norm, block_vecs[block.id]))
                if sim > best_sim:
                    best_sim, best_block = sim, block

            if best_block is None:
                continue

            logger.info(
                'analyse_risks: clause "%s" → block %s (dist=%.3f)',
                pc.clause_type, best_block.id, 1.0 - best_sim,
            )

            block_risks = analyse_block_risks(best_block.text, pc, llm)
            for r in block_risks:
                risks_to_create.append(PlaybookRisk(
                    session=session,
                    block=best_block,
                    playbook_clause=pc,
                    severity=r['severity'],
                    issue=r['issue'],
                    suggestion=r['suggestion'],
                    quote=r['quote'],
                    status=PlaybookRisk.RiskStatus.OPEN,
                ))

        if risks_to_create:
            PlaybookRisk.objects.bulk_create(risks_to_create)

        # Roll the flat findings up into a document-level report. The unsaved
        # PlaybookRisk objects still carry their python .playbook_clause / .block
        # references, so we can build the findings list without re-querying.
        findings = [
            {
                'clause_type': r.playbook_clause.clause_type if r.playbook_clause else '',
                'severity': r.severity,
                'issue': r.issue,
                'suggestion': r.suggestion,
                'location': (r.block.heading if r.block else '') or '',
            }
            for r in risks_to_create
        ]
        doc_label = (
            (session.template.document_type if session.template_id else None)
            or next((s.name for s in session.samples.all()), None)
            or f'Session {session.id}'
        )
        session.risk_report = synthesise_risk_report(findings, doc_label, llm)

        session.risk_status = 'ready'
        session.save(update_fields=['risk_status', 'risk_report'])
        logger.info('analyse_risks: %d risks for session %s', len(risks_to_create), session_id)

    except Exception as exc:
        logger.exception('analyse_risks failed for session %s', session_id)
        DraftSession.objects.filter(id=session_id).update(risk_status='failed')
        if settings.CELERY_TASK_ALWAYS_EAGER:
            return
        raise self.retry(exc=exc, countdown=60)
