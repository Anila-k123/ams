"""The connection to the language model, for Lisa (planner.py) and document
summaries (complete_text). Three interchangeable backends, all spoken to over
the same OpenAI-compatible chat-completions protocol (streaming SSE for Lisa):

  * "local"  - a locally hosted model over an ngrok tunnel (`/v1/chat/completions`).
  * "gemini" - Google Gemini via its OpenAI-compatible endpoint.
  * "openai" - OpenAI.

Pick the backend with LLM_PROVIDER=local|gemini|openai (default: local).
openai and gemini are EXTERNAL: data leaves our servers, so Lisa always masks
it (privacy.py), and they support tool calling (ASSISTANT_TOOL_CALLING=auto).

Config (backend .env), mirroring pact-pro-draft:
    LLM_PROVIDER     local | gemini | openai              (default: local)
    ASSISTANT_TOOL_CALLING  auto | on | off              (default: auto)
    ASSISTANT_MASK_LOCAL    mask for the local model too (default: True)

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
import time

import requests
from decouple import config

from metering import usage as metering

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

# OpenAI backend (native OpenAI Chat Completions API)
OPENAI_API_KEY = config('OPENAI_API_KEY', default='')
OPENAI_MODEL = config('OPENAI_MODEL', default='gpt-4o-2024-08-06')
OPENAI_BASE_URL = config('OPENAI_BASE_URL', default='https://api.openai.com/v1').rstrip('/')

# shared
LLM_TEMPERATURE = config('LLM_TEMPERATURE', default=0.2, cast=float)
LLM_TIMEOUT = config('LLM_TIMEOUT', default=600, cast=int)

# Privacy masking (assistant/privacy.py). Always on for a provider outside our
# servers; for the locally hosted model it can be turned off.
EXTERNAL_PROVIDERS = {'openai', 'gemini'}
ASSISTANT_MASK_LOCAL = config('ASSISTANT_MASK_LOCAL', default=True, cast=bool)


def masking_enabled():
    return LLM_PROVIDER in EXTERNAL_PROVIDERS or ASSISTANT_MASK_LOCAL


def _backend():
    """Resolve the active backend to a (base_url, openai_path, model, api_key) tuple,
    mirroring pact-pro-draft's `_config_for()`. Returns None if unconfigured."""
    if LLM_PROVIDER == 'openai':
        if not OPENAI_API_KEY:
            return None
        return (OPENAI_BASE_URL, '/chat/completions', OPENAI_MODEL, OPENAI_API_KEY)
    if LLM_PROVIDER == 'gemini':
        if not GEMINI_API_KEY:
            return None
        return (GEMINI_BASE_URL, '/chat/completions', GEMINI_MODEL, GEMINI_API_KEY)
    # default: local model over ngrok
    if not LLM_BASE_URL:
        return None
    return (LLM_BASE_URL, LLM_OPENAI_PATH, LLM_MODEL, LLM_API_KEY)


def _missing_config_var():
    """Name of the env var that must be set for the active provider."""
    return {
        'openai': 'OPENAI_API_KEY',
        'gemini': 'GEMINI_API_KEY',
    }.get(LLM_PROVIDER, 'LLM_BASE_URL')


def active_model_name():
    """The model name of the active backend, or None if unconfigured."""
    backend = _backend()
    return backend[2] if backend else None

_MAX_ATTEMPTS = 3
_RETRY_STATUS = {429, 502, 503, 504}

# Tool calling (assistant/planner.py): auto = on for the external providers,
# which support OpenAI-style tools; off for a local model, which then gets the
# pre-built context brief instead.
ASSISTANT_TOOL_CALLING = config('ASSISTANT_TOOL_CALLING', default='auto').strip().lower()


def tool_calling_enabled():
    if ASSISTANT_TOOL_CALLING in ('on', 'true', '1'):
        return True
    if ASSISTANT_TOOL_CALLING in ('off', 'false', '0'):
        return False
    return LLM_PROVIDER in EXTERNAL_PROVIDERS


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
            # These APIs answer 'text/event-stream' with NO charset, and for a
            # text/* response without one requests falls back to ISO-8859-1.
            # The bodies are always UTF-8 JSON, so that fallback mangles every
            # non-ASCII character downstream in iter_lines(decode_unicode=True)
            # — '₹' arrives as 'â\x82¹'. Pin the real encoding.
            resp.encoding = 'utf-8'
            return resp
        except requests.RequestException as exc:
            last = exc
            if attempt < _MAX_ATTEMPTS - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise AssistantUnavailable(str(exc))
    raise AssistantUnavailable(str(last) if last else 'request failed')


def _meter(model, usage, prompt_text, output_text, started):
    """Record one call's tokens (metering/usage.py): the provider's own counts
    when it sent them (OpenAI-style prompt_tokens / completion_tokens), else an
    estimate from the text, flagged as such."""
    ms = int((time.monotonic() - started) * 1000)
    if usage and (usage.get('prompt_tokens') is not None or usage.get('completion_tokens') is not None):
        metering.record(LLM_PROVIDER, model, usage.get('prompt_tokens'), usage.get('completion_tokens'),
                        duration_ms=ms)
    else:
        metering.record_text(LLM_PROVIDER, model, prompt_text, output_text, duration_ms=ms)


def complete_text(system_prompt, user_prompt, temperature=None, max_tokens=2000):
    """Non-streaming completion against the active backend (local or gemini).

    Reuses the same provider config, endpoint, and retry policy as the streaming
    assistant. Returns the assistant's message content as a plain string.
    Raises AssistantUnavailable if the backend is unconfigured or unreachable.
    """
    backend = _backend()
    if backend is None:
        raise AssistantUnavailable(f'LLM is not configured (missing {_missing_config_var()}).')
    base_url, openai_path, model, api_key = backend

    url = f"{base_url}{openai_path}"
    headers = {'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true'}
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'
    payload = {
        'model': model,
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': user_prompt},
        ],
        'temperature': LLM_TEMPERATURE if temperature is None else temperature,
        'max_tokens': max_tokens,
        'stream': False,
    }

    last = None
    started = time.monotonic()
    for attempt in range(_MAX_ATTEMPTS):
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=LLM_TIMEOUT)
            if resp.status_code in _RETRY_STATUS and attempt < _MAX_ATTEMPTS - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            resp.raise_for_status()
            resp.encoding = 'utf-8'
            obj = resp.json()
            choices = obj.get('choices') or [{}]
            content = (choices[0].get('message') or {}).get('content') or ''
            _meter(model, obj.get('usage'), system_prompt + user_prompt, content, started)
            return content
        except requests.RequestException as exc:
            last = exc
            if attempt < _MAX_ATTEMPTS - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise AssistantUnavailable(str(exc))
        except ValueError as exc:  # bad/empty JSON body
            raise AssistantUnavailable(f'invalid response from model: {exc}')
    raise AssistantUnavailable(str(last) if last else 'request failed')


def iter_events(resp):
    """The JSON objects of an OpenAI-style SSE response, until [DONE]."""
    for raw in resp.iter_lines(decode_unicode=True):
        if not raw:
            continue
        line = raw.strip()
        if not line.startswith('data:'):
            continue
        data = line[len('data:'):].strip()
        if data == '[DONE]':
            return
        try:
            yield json.loads(data)
        except ValueError:
            continue
