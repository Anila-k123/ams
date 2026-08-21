"""LLM brain for the AI assistant. Two interchangeable backends, both spoken to over
the SAME OpenAI-compatible streaming-SSE protocol — the exact connection style used by
the pact-pro-draft app:

  * "local"  — a LOCALLY-HOSTED model exposed over an ngrok tunnel
               (OpenAI-compatible `/v1/chat/completions`).
  * "gemini" — Google Gemini via its OpenAI-compatible endpoint
               (`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`).

Pick the backend with LLM_PROVIDER=local|gemini (default: local).

Neither backend uses function/tool calling, so instead of an agentic tool loop we
gather the relevant data server-side (scoped to the logged-in advocate, read-only)
and inject it into the prompt as a grounded brief, then stream the completion back
to the client as our own SSE frames.

Config (backend .env), mirroring pact-pro-draft:
    LLM_PROVIDER     local | gemini                       (default: local)

    # --- local backend (LLM_PROVIDER=local) ---
    LLM_BASE_URL     e.g. https://abc123.ngrok-free.app   (required for local)
    LLM_MODEL        the served model name                (default: local-model)
    LLM_API_KEY      optional bearer token
    LLM_OPENAI_PATH  default /v1/chat/completions

    # --- Gemini backend (LLM_PROVIDER=gemini) ---
    GEMINI_API_KEY   Google AI Studio key                 (required for gemini)
    GEMINI_MODEL     default gemini-2.5-flash
    GEMINI_BASE_URL  default https://generativelanguage.googleapis.com/v1beta/openai

    # --- shared ---
    LLM_TEMPERATURE  default 0.2
    LLM_TIMEOUT      default 600 (seconds)
"""

import json
import logging
import re
import time

import requests
from decouple import config

from . import tools

log = logging.getLogger(__name__)

LLM_PROVIDER = config('LLM_PROVIDER', default='local').strip().lower()

# local backend
LLM_BASE_URL = config('LLM_BASE_URL', default='').rstrip('/')
LLM_MODEL = config('LLM_MODEL', default='local-model')
LLM_API_KEY = config('LLM_API_KEY', default='')
LLM_OPENAI_PATH = config('LLM_OPENAI_PATH', default='/v1/chat/completions')

# Gemini backend (OpenAI-compatible endpoint)
GEMINI_API_KEY = config('GEMINI_API_KEY', default='')
GEMINI_MODEL = config('GEMINI_MODEL', default='gemini-2.5-flash')
GEMINI_BASE_URL = config(
    'GEMINI_BASE_URL',
    default='https://generativelanguage.googleapis.com/v1beta/openai',
).rstrip('/')

# shared
LLM_TEMPERATURE = config('LLM_TEMPERATURE', default=0.2, cast=float)
LLM_TIMEOUT = config('LLM_TIMEOUT', default=600, cast=int)


def _backend():
    """Resolve the active backend to a (base_url, openai_path, model, api_key) tuple,
    mirroring pact-pro-draft's `_config_for()`. Returns None if unconfigured."""
    if LLM_PROVIDER == 'gemini':
        if not GEMINI_API_KEY:
            return None
        return (GEMINI_BASE_URL, '/chat/completions', GEMINI_MODEL, GEMINI_API_KEY)
    # default: local model over ngrok
    if not LLM_BASE_URL:
        return None
    return (LLM_BASE_URL, LLM_OPENAI_PATH, LLM_MODEL, LLM_API_KEY)

_MAX_ATTEMPTS = 3
_RETRY_STATUS = {429, 502, 503, 504}
_MAX_CASES_IN_CONTEXT = 2

SYSTEM_PROMPT = (
    "You are the AI assistant inside an Advocate (lawyer) Management System. You help an "
    "advocate — or an assistant covering for them — understand their caseload quickly.\n\n"
    "Answer using ONLY the CONTEXT DATA provided in the user message. Never invent case "
    "facts, dates, names, or amounts. If the context doesn't contain the answer, say so "
    "plainly and suggest what to search for.\n\n"
    "When asked to summarise a case or what to follow up, produce:\n"
    "1. A short plain-language summary (parties, type, court, current status/stage).\n"
    "2. A clearly-labelled 'Follow-up' list of concrete things needing attention — the next "
    "hearing date, pending/overdue tasks, outstanding dues or unpaid invoices, and anything "
    "unresolved. Only include items supported by the context data.\n\n"
    "Be concise and practical. Use Indian rupees (₹) for money. Format with short markdown."
)

_STOPWORDS = {
    'the', 'and', 'for', 'with', 'what', 'whats', 'show', 'tell', 'give', 'about', 'case',
    'cases', 'client', 'hearing', 'hearings', 'follow', 'followup', 'follow-up', 'summary',
    'summarise', 'summarize', 'details', 'detail', 'need', 'needs', 'this', 'that', 'have',
    'any', 'all', 'from', 'please', 'next', 'upcoming', 'status', 'pending', 'due', 'dues',
}


# --- context building (replaces the tool-use loop for the local model) ----

def _candidate_case_ids(advocate_id, question):
    """Resolve which case(s) the question is about, by matching tokens against find_case.
    Returns caseIds ranked by how many query tokens hit them (best first)."""
    tokens = [t for t in re.findall(r"[A-Za-z0-9/().\-]{3,}", question)]
    tokens = [t for t in tokens if t.lower() not in _STOPWORDS]
    # Case-number-ish tokens (digits or a slash) are the strongest signal — try them first.
    ranked, counts = [], {}
    for tok in tokens:
        for c in tools.find_case(advocate_id, tok).get('cases', []):
            cid = c['caseId']
            counts[cid] = counts.get(cid, 0) + (2 if ('/' in tok or any(ch.isdigit() for ch in tok)) else 1)
    for cid, _ in sorted(counts.items(), key=lambda kv: kv[1], reverse=True):
        ranked.append(cid)
    return ranked[:_MAX_CASES_IN_CONTEXT]


def build_context(advocate_id, question):
    """Assemble a compact, grounded data brief for the prompt (read-only, own cases)."""
    ctx = {'dashboard': tools.dashboard_summary(advocate_id),
           'upcomingHearings': tools.list_upcoming_hearings(advocate_id, 14).get('hearings', [])}
    cases = []
    for cid in _candidate_case_ids(advocate_id, question):
        summary = tools.get_case_summary(advocate_id, cid)
        if summary.get('error'):
            continue
        cases.append({
            'summary': summary,
            'hearings': tools.get_hearings(advocate_id, cid),
            'parties': tools.get_parties(advocate_id, cid).get('parties', []),
            'tasks': tools.get_tasks(advocate_id, cid).get('tasks', []),
            'financials': tools.get_case_financials(advocate_id, cid),
            'notes': tools.get_notes(advocate_id, cid).get('notes', []),
        })
    ctx['matchedCases'] = cases
    return ctx


def _user_message(question, ctx):
    return (f"Question: {question}\n\n"
            f"CONTEXT DATA (the only source of truth — do not go beyond it):\n"
            f"```json\n{json.dumps(ctx, ensure_ascii=False, default=str, indent=1)}\n```")


# --- streaming call to the local model ------------------------------------

class AssistantUnavailable(Exception):
    pass


def _sse(obj):
    return f"data: {json.dumps(obj)}\n\n"


def _post_stream(payload, base_url, openai_path, api_key):
    """POST to the active backend's OpenAI-compatible endpoint, returning the streaming
    Response. Retries transient failures like pact-pro-draft does."""
    url = f"{base_url}{openai_path}"
    headers = {'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true'}
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'
    last = None
    for attempt in range(_MAX_ATTEMPTS):
        try:
            resp = requests.post(url, json=payload, headers=headers, stream=True, timeout=LLM_TIMEOUT)
            if resp.status_code in _RETRY_STATUS and attempt < _MAX_ATTEMPTS - 1:
                resp.close()
                time.sleep(1.5 * (attempt + 1))
                continue
            resp.raise_for_status()
            return resp
        except requests.RequestException as exc:
            last = exc
            if attempt < _MAX_ATTEMPTS - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise AssistantUnavailable(str(exc))
    raise AssistantUnavailable(str(last) if last else 'request failed')


def stream_answer(question, advocate_id):
    """Generator yielding SSE frames: {type:'text',text} deltas, then {type:'done'}
    (or {type:'error',message}). Builds context, then streams the local model."""
    backend = _backend()
    if backend is None:
        missing = 'GEMINI_API_KEY' if LLM_PROVIDER == 'gemini' else 'LLM_BASE_URL'
        yield _sse({'type': 'error',
                    'message': f'The AI assistant is not configured (missing {missing}).'})
        return
    base_url, openai_path, model, api_key = backend

    ctx = build_context(advocate_id, question)
    payload = {
        'model': model,
        'messages': [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': _user_message(question, ctx)},
        ],
        'temperature': LLM_TEMPERATURE,
        'stream': True,
    }

    try:
        resp = _post_stream(payload, base_url, openai_path, api_key)
    except AssistantUnavailable as exc:
        log.warning('assistant: %s LLM unreachable: %s', LLM_PROVIDER, exc)
        yield _sse({'type': 'error', 'message': 'Could not reach the AI model. Please try again shortly.'})
        return

    got_text = False
    try:
        for raw in resp.iter_lines(decode_unicode=True):
            if not raw:
                continue
            line = raw.strip()
            if not line.startswith('data:'):
                continue
            data = line[len('data:'):].strip()
            if data == '[DONE]':
                break
            try:
                obj = json.loads(data)
            except ValueError:
                continue
            choices = obj.get('choices') or [{}]
            delta = choices[0].get('delta') or {}
            piece = delta.get('content')
            if piece:
                got_text = True
                yield _sse({'type': 'text', 'text': piece})
    except requests.RequestException as exc:
        log.warning('assistant: stream dropped: %s', exc)
        if not got_text:
            yield _sse({'type': 'error', 'message': 'The model connection dropped. Please try again.'})
            return
    finally:
        resp.close()

    if not got_text:
        yield _sse({'type': 'error', 'message': 'The model returned no response. Please try again.'})
    else:
        yield _sse({'type': 'done'})
