"""Playbook processing service — two-pass extraction + synthesis.

Pass 1  (per document): parse each PlaybookDocument, extract raw clauses with
        the LLM, save a PlaybookClauseRaw row per clause.

Pass 2  (synthesis): for each distinct clause_type, load all raw rows, count
        frequencies, let code decide majority = standard / red line, minority =
        fallback, ask the LLM to write natural-language descriptions, persist
        PlaybookClause rows, then delete the raw rows.

Risk analysis: compare DraftBlock texts to PlaybookClause embeddings (cosine
similarity) then ask the LLM to flag deviations from red_lines / standard_text.
"""
import json
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

# ── helpers ───────────────────────────────────────────────────────────────────

def _parse_json(raw: str):
    """Extract a JSON object (or list) from LLM output, tolerating fences."""
    s = re.sub(r'```(?:json)?', '', (raw or '')).strip()

    def _try_parse(text):
        for start_ch, end_ch in [('{', '}'), ('[', ']')]:
            s_idx, e_idx = text.find(start_ch), text.rfind(end_ch)
            if s_idx != -1 and e_idx > s_idx:
                try:
                    return json.loads(text[s_idx:e_idx + 1])
                except Exception:
                    pass
        return None

    result = _try_parse(s)
    if result is not None:
        return result

    # Gemini occasionally omits the closing } of a dict inside an array,
    # leaving a bare comma on the next line:  "value"\n    ,\n    {
    # Repair: insert } before any lone , that follows a string value on a prior line.
    repaired = re.sub(r'("(?:[^"\\]|\\.)*")\s*\n(\s*),', r'\1\n\2},', s)
    if repaired != s:
        return _try_parse(repaired)

    return None


def _parse_json_list(raw: str) -> list:
    result = _parse_json(raw)
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        # model sometimes wraps the list: {"clauses": [...]}
        for v in result.values():
            if isinstance(v, list):
                return v
    return []


# ── Pass 1: chunk-batch extraction ────────────────────────────────────────────
# Docling splits the document into clause-sized chunks (via process_sample).
# We send 5 chunks per LLM call. The LLM decides which are substantive and
# which to skip — no code-side filtering needed.

_EXTRACT_BATCH_SYSTEM = """\
You are a legal analyst specialising in Indian transactional law.
You are given a batch of pre-split clauses from a commercial agreement.
Each clause is numbered [1], [2], etc.

For EACH clause, decide:

SKIP (return nothing for it) if it is any of:
  - Preamble / background / recitals / "whereas" / "witnesseth"
  - Definitions or interpretation section (a list of defined terms)
  - Signature / execution block (names, titles, dates, "by signature")
  - Pure boilerplate with no negotiating value: severability, waiver, counterparts,
    notice of amendment, entire agreement

EXTRACT (include in output) if it is a substantive operative clause that contains
obligations, prohibitions, rights, or positions that a law firm would negotiate, e.g.:
  confidentiality, authorized_persons, non_solicitation, indemnification,
  equitable_relief, remedies_for_breach, duration, relationship_of_parties,
  no_public_announcement, governing_law, dispute_resolution,
  limitation_of_liability, intellectual_property, assignment, warranties,
  approved_purposes — or any other operative clause.

SPLIT rule: split ONLY when sub-clauses address fundamentally different legal
topics that a lawyer would negotiate as separate agenda items (e.g. an
indemnification provision and an equitable relief provision in the same section
belong to different topics — split them). Do NOT split complementary aspects of
the same topic: the obligation to keep information secret, the prohibition on
disclosing it, and carve-outs for permitted disclosure are all part of one
confidentiality clause — keep them as a single object with a single clause_type.
When in doubt, keep together.

For each clause you EXTRACT, return a JSON object with exactly these keys:
  "clause_type"   – snake_case label from the list above, or a clear new one
  "raw_text"      – verbatim text of this clause (do NOT paraphrase or invent)
  "obligations"   – list of strings: what each party MUST do
  "prohibitions"  – list of strings: what each party MUST NOT do
  "carve_outs"    – list of strings: exceptions or carve-outs
  "key_terms"     – dict of notable values (duration, notice period, amounts, etc.)

Return ONLY a JSON array of extracted objects. Omit skipped clauses entirely.
No markdown fences, no prose.
"""

LOCAL_BATCH_SIZE = 5  # chunks per LLM call for local models (small context window)


def extract_clauses_from_chunks(sample_clauses: list, llm, batch_size: int = LOCAL_BATCH_SIZE) -> list[dict]:
    """Extract playbook clause data from a list of SampleClause objects.

    Sends chunks in batches of batch_size to the LLM. The LLM filters out
    preamble/definitions/boilerplate and returns only substantive clauses.
    Returns a flat list of {clause_type, raw_text, extracted_json} dicts.
    """
    results = []
    chunks = [c for c in sample_clauses if (c.text or '').strip()]
    if not chunks:
        return results

    effective_batch = batch_size

    for i in range(0, len(chunks), effective_batch):
        batch = chunks[i:i + effective_batch]
        batch_num = i // effective_batch + 1
        total_batches = -(-len(chunks) // effective_batch)

        user_text = '\n\n'.join(
            f'[{j + 1}]\n{chunk.text.strip()}'
            for j, chunk in enumerate(batch)
        )
        try:
            raw = llm.complete(
                system=_EXTRACT_BATCH_SYSTEM,
                user=f'CLAUSES:\n{user_text}\n\nJSON array:',
            )
        except Exception:
            logger.exception(
                'playbook extract_chunks: LLM call failed for batch %d/%d (%d chunks)',
                batch_num, total_batches, len(batch),
            )
            continue

        extracted = _parse_json_list(raw)
        batch_count = 0
        for item in extracted:
            if not isinstance(item, dict):
                continue
            clause_type = (item.get('clause_type') or '').strip().lower().replace(' ', '_')
            raw_text = (item.get('raw_text') or '').strip()
            if clause_type and raw_text:
                results.append({
                    'clause_type': clause_type,
                    'raw_text': raw_text,
                    'extracted_json': {
                        'obligations': item.get('obligations') or [],
                        'prohibitions': item.get('prohibitions') or [],
                        'carve_outs': item.get('carve_outs') or [],
                        'key_terms': item.get('key_terms') or {},
                    },
                })
                batch_count += 1
        logger.info(
            'playbook extract_chunks: batch %d/%d → %d clauses (running total: %d)',
            batch_num, total_batches, batch_count, len(results),
        )

    return results


# ── Pass 2: synthesis ─────────────────────────────────────────────────────────

_SYNTHESISE_SYSTEM = """\
You are a senior legal drafter building a firm playbook for {clause_type} clauses.

You have been given {doc_count} version(s) of this clause from different agreements.
The code has already classified them:
  - MAJORITY positions ({majority_count}/{doc_count} docs): these are the firm's STANDARD.
  - MINORITY positions ({minority_count}/{doc_count} docs): these are FALLBACK / negotiating room.

Your task:
1. Write "standard_text": the firm's preferred {clause_type} clause in 2–4 sentences of
   plain English (not legalese). Reflect the majority position exactly — do not invent terms.
2. Identify 1–3 "red_lines": non-negotiable positions the firm must always protect.
   Base these ONLY on what is actually present in the source clauses below.
   Each is a dict: {{"rule": "<the rule>", "rationale": "<why it matters>"}}.
3. "fallback_positions": acceptable alternatives the firm can concede.
   CRITICAL: Only include fallbacks that are explicitly present in the MINORITY SOURCE CLAUSES
   provided below. DO NOT invent or suggest fallback positions from general legal knowledge.
   If no minority clauses are provided, return an empty array [].
   Each is a dict: {{"text": "<verbatim or close paraphrase from source>", "condition": "<when to accept>"}}.
4. Write a short "notes" paragraph (1–2 sentences) about common issues with this clause type.

Return ONLY a JSON object with keys: standard_text, red_lines, fallback_positions, notes.
"""


# Two clauses that express the SAME legal position are almost always worded
# differently across firms and documents, so a text-exact count never finds a
# majority. Instead we embed each clause and group by meaning: clauses whose
# cosine similarity is at or above this threshold are treated as the same
# position. Overridable via settings.PLAYBOOK_CLUSTER_SIM.
CLUSTER_SIM_THRESHOLD = 0.82


def _cluster_positions(raw_rows: list, emb, threshold: float) -> list[dict]:
    """Greedily group raw clause rows into position-clusters by embedding
    similarity. Each cluster is {'rows': [...], 'vec': centroid|None}.

    A row joins the nearest existing cluster when cosine similarity to that
    cluster's centroid is >= threshold; otherwise it starts a new cluster. Rows
    whose text can't be embedded become singleton clusters (never merged).
    """
    import numpy as np

    clusters: list[dict] = []
    for row in raw_rows:
        text = (row.raw_text or '').strip()
        if not text:
            continue
        try:
            v = np.array(emb.embed(text), dtype=float)
            n = np.linalg.norm(v)
            v = v / n if n else None
        except Exception:
            logger.warning('playbook cluster: embed failed for raw row %s', getattr(row, 'id', '?'))
            v = None

        if v is None:
            clusters.append({'rows': [row], 'vec': None})
            continue

        best, best_sim = None, -1.0
        for c in clusters:
            if c['vec'] is None:
                continue
            sim = float(np.dot(c['vec'], v))
            if sim > best_sim:
                best_sim, best = sim, c

        if best is not None and best_sim >= threshold:
            k = len(best['rows'])
            merged = (best['vec'] * k + v) / (k + 1)  # running-mean centroid
            mn = np.linalg.norm(merged)
            best['vec'] = merged / mn if mn else best['vec']
            best['rows'].append(row)
        else:
            clusters.append({'rows': [row], 'vec': v})

    return clusters


def _cluster_doc_ids(cluster: dict) -> set:
    """Distinct source documents represented in a cluster."""
    return {r.source_document_id for r in cluster['rows'] if r.source_document_id}


def synthesise_clause_type(clause_type: str, raw_rows: list, llm, emb=None) -> dict | None:
    """Given all PlaybookClauseRaw rows for one clause_type, synthesise a
    PlaybookClause dict: {standard_text, red_lines, fallback_positions, notes,
    source_doc_count}.

    Splits rows into majority (standard) / minority (fallback) BEFORE calling the
    LLM — the LLM only writes; code decides classification. Grouping is by
    embedding similarity (see CLUSTER_SIM_THRESHOLD): the position-cluster
    spanning the most documents is the majority; the rest are fallbacks.
    """
    if not raw_rows:
        return None

    if emb is None:
        from ..providers.embeddings import get_embeddings
        emb = get_embeddings()

    from django.conf import settings
    threshold = float(getattr(settings, 'PLAYBOOK_CLUSTER_SIM', CLUSTER_SIM_THRESHOLD))

    # Count unique source documents (not raw rows — one doc can contribute multiple sub-clauses).
    source_doc_ids = {row.source_document_id for row in raw_rows if row.source_document_id}
    doc_count = len(source_doc_ids) if source_doc_ids else len(raw_rows)

    def _rep_text(cluster: dict) -> str:
        """A representative clause for a cluster (its first non-empty member)."""
        for r in cluster['rows']:
            t = (r.raw_text or '').strip()
            if t:
                return t
        return ''

    if doc_count == 1:
        # Single document: everything is the standard position by definition.
        majority_texts = [(r.raw_text or '').strip() for r in raw_rows if (r.raw_text or '').strip()]
        minority_texts = []
        majority_count, minority_count = doc_count, 0
    else:
        clusters = _cluster_positions(raw_rows, emb, threshold)
        if not clusters:
            return None
        # Majority = the cluster spanning the most documents (tie → most members).
        majority = max(clusters, key=lambda c: (len(_cluster_doc_ids(c)), len(c['rows'])))
        minority = [c for c in clusters if c is not majority]

        # Majority context = every wording in the winning cluster (deduped);
        # each minority cluster contributes one representative fallback wording.
        seen, majority_texts = set(), []
        for r in majority['rows']:
            t = (r.raw_text or '').strip()
            key = re.sub(r'\s+', ' ', t.lower())
            if t and key not in seen:
                seen.add(key)
                majority_texts.append(t)
        minority_texts = [t for t in (_rep_text(c) for c in minority) if t]

        majority_count = len(_cluster_doc_ids(majority)) or len(majority['rows'])
        minority_count = max(doc_count - majority_count, 0)

    # Build the prompt context.
    sections = []
    if majority_texts:
        sections.append('--- MAJORITY POSITIONS ---')
        for i, t in enumerate(majority_texts, 1):
            sections.append(f'[{i}] {t[:800]}')
    if minority_texts:
        sections.append('--- MINORITY / FALLBACK POSITIONS ---')
        for i, t in enumerate(minority_texts, 1):
            sections.append(f'[{i}] {t[:800]}')

    context = '\n'.join(sections)
    system = _SYNTHESISE_SYSTEM.format(
        clause_type=clause_type,
        doc_count=doc_count,
        majority_count=majority_count,
        minority_count=minority_count,
    )

    try:
        raw = llm.complete(
            system=system,
            user=f'SOURCE CLAUSES:\n{context}\n\nPlaybook entry as JSON:',
        )
    except Exception:
        logger.exception('playbook synthesise: LLM call failed for %s', clause_type)
        return None

    data = _parse_json(raw)
    if not isinstance(data, dict):
        return None

    return {
        'standard_text': (data.get('standard_text') or '').strip(),
        'red_lines': data.get('red_lines') or [],
        'fallback_positions': data.get('fallback_positions') or [],
        'notes': (data.get('notes') or '').strip(),
        'source_doc_count': doc_count,
    }


# ── Risk analysis ──────────────────────────────────────────────────────────────

_RISK_SYSTEM = """\
You are a legal risk analyst. Compare a draft clause to the firm's playbook
position and identify deviations.

PLAYBOOK STANDARD:
{standard_text}

RED LINES (non-negotiable):
{red_lines}

FALLBACK POSITIONS (acceptable alternatives):
{fallback_positions}

Analyse the draft clause below. Return a JSON array of risk objects.
Each object must have:
  "severity"   – one of: "critical" (red line violated), "major" (significant
                 deviation from standard not covered by any fallback),
                 "minor" (minor deviation), "info" (note worth flagging)
  "issue"      – what is wrong or missing in the draft clause (1–2 sentences)
  "suggestion" – how to fix or negotiate it (1–2 sentences)
  "quote"      – the exact phrase from the DRAFT that triggers this risk
                 (verbatim, ≤ 80 words; or "" if a missing clause)

If the draft clause fully complies with the playbook, return an empty array [].
Output ONLY the JSON array.
"""


def analyse_block_risks(block_text: str, playbook_clause, llm) -> list[dict]:
    """Compare one DraftBlock's text to a PlaybookClause and return a list of
    risk dicts: {severity, issue, suggestion, quote}.
    """
    red_lines_text = '\n'.join(
        f"- {r.get('rule', '')} ({r.get('rationale', '')})"
        for r in (playbook_clause.red_lines or [])
    ) or '(none specified)'

    fallback_text = '\n'.join(
        f"- {f.get('text', '')} [when: {f.get('condition', '')}]"
        for f in (playbook_clause.fallback_positions or [])
    ) or '(none specified)'

    system = _RISK_SYSTEM.format(
        standard_text=playbook_clause.standard_text or '(not specified)',
        red_lines=red_lines_text,
        fallback_positions=fallback_text,
    )

    try:
        raw = llm.complete(
            system=system,
            user=f'DRAFT CLAUSE:\n{block_text}\n\nRisks as JSON array:',
        )
    except Exception:
        logger.exception('playbook risk: LLM call failed')
        return []

    risks = _parse_json_list(raw)
    result = []
    for r in risks:
        if not isinstance(r, dict):
            continue
        severity = (r.get('severity') or '').lower()
        if severity not in ('critical', 'major', 'minor', 'info'):
            severity = 'info'
        issue = (r.get('issue') or '').strip()
        suggestion = (r.get('suggestion') or '').strip()
        quote = (r.get('quote') or '').strip()
        if issue:
            result.append({
                'severity': severity,
                'issue': issue,
                'suggestion': suggestion,
                'quote': quote,
            })
    return result


# ── Document-level synthesis ─────────────────────────────────────────────────
# After the per-clause pass produces flat findings, this rolls them up into a
# lawyer-ready summary. As with synthesis above, code does the classification
# (severity ranking, the risk register, the baseline recommendation) and the LLM
# only writes prose (deal-breaker phrasing, client open questions). This keeps the
# report contract-type agnostic: sections are driven by whatever clause_types the
# playbook actually contains — nothing about NDAs or any party is hard-coded.

_SEVERITY_RANK = {'critical': 0, 'major': 1, 'minor': 2, 'info': 3}

_REPORT_SYSTEM = """\
You are a senior legal counsel preparing a review summary for a lawyer who has
just run a clause-by-clause playbook check over a single uploaded agreement.

The findings below have ALREADY been classified by severity by code. Severity
counts for this document: {counts}.

Produce a concise, document-level summary with these parts ONLY:

1. "recommendation" – exactly one of: "proceed", "negotiate", "decline".
   - "decline": unresolved critical red-line violations make the agreement
     unacceptable as drafted.
   - "negotiate": critical or major issues that should be fixed before signing.
   - "proceed": only minor / informational issues remain.

2. "deal_breakers" – a list of the most serious problems (the critical ones, and
   any major ones severe enough to block signing), each phrased as a short,
   plain-English red flag a partner would want to see first. Base each ONLY on a
   finding below. Return [] if there are none.

3. "open_questions" – a list of questions the lawyer should put to the client
   before finalising (e.g. desired mutuality, acceptable durations, preferred
   governing law, purpose wording). Derive these from the gaps and deviations in
   the findings. Return [] if nothing needs client input.

Do NOT invent issues that are not in the findings. Do NOT restate every finding.
Return ONLY a JSON object with keys: recommendation, deal_breakers, open_questions.
"""


def _baseline_recommendation(counts: dict) -> str:
    """Deterministic fallback verdict from severity counts, used if the LLM
    omits or returns an invalid recommendation."""
    if counts.get('critical'):
        return 'decline' if counts['critical'] >= 3 else 'negotiate'
    if counts.get('major'):
        return 'negotiate'
    return 'proceed'


def synthesise_risk_report(findings: list[dict], doc_label: str, llm) -> dict:
    """Roll a flat list of per-clause findings up into a document-level report.

    `findings` items are dicts with: clause_type, severity, issue, suggestion,
    location (block heading or ''). Returns:
      {title, recommendation, risk_register, deal_breakers, open_questions,
       counts}
    """
    counts = {'critical': 0, 'major': 0, 'minor': 0, 'info': 0}
    for f in findings:
        sev = f.get('severity', 'info')
        counts[sev] = counts.get(sev, 0) + 1

    # Risk register: findings sorted worst-first, then by clause type — built by
    # code so nothing is dropped or hallucinated.
    ordered = sorted(
        findings,
        key=lambda f: (_SEVERITY_RANK.get(f.get('severity'), 3), f.get('clause_type') or ''),
    )
    risk_register = [
        {
            'clause_type': f.get('clause_type') or '',
            'severity': f.get('severity', 'info'),
            'issue': f.get('issue', ''),
            'location': f.get('location') or '',
            'recommendation': f.get('suggestion', ''),
        }
        for f in ordered
    ]

    title = f'PLAYBOOK REVIEW — {doc_label}'

    if not findings:
        return {
            'title': title,
            'recommendation': 'proceed',
            'risk_register': [],
            'deal_breakers': [],
            'open_questions': [],
            'counts': counts,
        }

    counts_str = ', '.join(f'{k}: {v}' for k, v in counts.items() if v)
    lines = [
        f"- [{f.get('severity', 'info').upper()}] {f.get('clause_type') or 'clause'}: "
        f"{f.get('issue', '')}"
        for f in ordered
    ]
    system = _REPORT_SYSTEM.format(counts=counts_str)

    recommendation = _baseline_recommendation(counts)
    deal_breakers: list = []
    open_questions: list = []
    try:
        raw = llm.complete(
            system=system,
            user='FINDINGS:\n' + '\n'.join(lines) + '\n\nSummary as JSON:',
        )
        data = _parse_json(raw)
        if isinstance(data, dict):
            rec = (data.get('recommendation') or '').strip().lower()
            if rec in ('proceed', 'negotiate', 'decline'):
                recommendation = rec
            db = data.get('deal_breakers')
            if isinstance(db, list):
                deal_breakers = [str(x).strip() for x in db if str(x).strip()]
            oq = data.get('open_questions')
            if isinstance(oq, list):
                open_questions = [str(x).strip() for x in oq if str(x).strip()]
    except Exception:
        logger.exception('playbook synthesise_risk_report: LLM call failed')

    return {
        'title': title,
        'recommendation': recommendation,
        'risk_register': risk_register,
        'deal_breakers': deal_breakers,
        'open_questions': open_questions,
        'counts': counts,
    }
