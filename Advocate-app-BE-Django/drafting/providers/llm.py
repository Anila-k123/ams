import json
import logging
import time

import httpx
from django.conf import settings

logger = logging.getLogger(__name__)

# Transient HTTP statuses worth retrying: gateway/busy (502/503/504) and rate
# limiting (429 — cloud models like Gemini free-tier). 429 backs off harder and
# honours a Retry-After header when the server sends one.
_RETRY_STATUS = {429, 502, 503, 504}
_MAX_ATTEMPTS = 4


class LLMProvider:
    """Backend-agnostic LLM wrapper. All generation goes through here.

    Selected via settings.LLM_PROVIDER:
      - 'anthropic' : Claude via the Anthropic SDK (settings.ANTHROPIC_API_KEY)
      - 'openai'    : OpenAI-compatible /v1/chat/completions at settings.LLM_BASE_URL
                      (covers Ollama's OpenAI mode, LM Studio, vLLM, llama.cpp server)
      - 'ollama'    : Ollama native /api/chat at settings.LLM_BASE_URL
      - 'flask'     : custom Flask wrapper POST /api/llm with {prompt, temperature,
                      seed} returning streamed plain text (forwards to Ollama
                      /api/generate). system+user are merged into one prompt.

    For the HTTP backends the base URL is typically an ngrok tunnel to a
    locally-hosted model. The 'ngrok-skip-browser-warning' header is sent so
    free-tier ngrok doesn't return its HTML interstitial instead of the body.
    """

    def __init__(self, config: dict):
        self._provider = config['provider'].lower()
        self._model = config['model']
        self._base_url = (config.get('base_url') or '').rstrip('/')
        self._openai_path = config.get('openai_path') or '/v1/chat/completions'
        self._api_key = config.get('api_key') or ''
        self._temperature = config.get('temperature', 0.2)
        seed = str(config.get('seed') or '').strip()
        self._seed = int(seed) if seed else None

        if self._provider == 'anthropic':
            self._client = None  # built lazily so a missing key fails with a clear message
        else:
            self._client = httpx.Client(
                timeout=httpx.Timeout(600.0),
                headers={'ngrok-skip-browser-warning': 'true'},
            )

    def complete(self, system: str, user: str, max_tokens: int = 2048) -> str:
        logger.info('=== Outgoing LLM Request (%s / %s) ===', self._provider, self._model)
        logger.info('System: %s', system)
        logger.info('User: %s', user)
        logger.info('Temperature: %s, Max tokens: %s', self._temperature, max_tokens)
        logger.info('=================================')

        if self._provider == 'anthropic':
            result = self._complete_anthropic(system, user, max_tokens)
        elif self._provider == 'ollama':
            result = self._complete_ollama(system, user, max_tokens)
        elif self._provider == 'flask':
            result = self._complete_flask(system, user, max_tokens)
        else:
            result = self._complete_openai(system, user, max_tokens)

        logger.info('Response: %s', result)
        logger.info('=================================')
        return result

    def _post(self, url: str, payload: dict, headers: dict | None = None) -> httpx.Response:
        """POST with retries on transient gateway errors / timeouts."""
        last_exc: Exception | None = None
        for attempt in range(_MAX_ATTEMPTS):
            status, retry_after = None, None
            try:
                resp = self._client.post(url, json=payload, headers=headers)
            except httpx.TransportError as exc:  # connect/read timeouts, conn reset
                last_exc = exc
            else:
                if resp.status_code not in _RETRY_STATUS:
                    resp.raise_for_status()
                    return resp
                status = resp.status_code
                last_exc = httpx.HTTPStatusError(
                    f'{resp.status_code} from {url}', request=resp.request, response=resp)
                ra = resp.headers.get('retry-after')
                if ra:
                    try:
                        retry_after = float(ra)
                    except ValueError:
                        retry_after = None
            if attempt < _MAX_ATTEMPTS - 1:
                # Rate limiting (429) backs off exponentially and honours Retry-After;
                # gateway errors use a short linear wait.
                if retry_after is not None:
                    wait = min(retry_after, 30)
                elif status == 429:
                    wait = min(5 * (2 ** attempt), 30)  # 5, 10, 20, 30s
                else:
                    wait = 1.5 * (attempt + 1)
                logger.warning('LLM POST %s failed (%s); retry %s/%s in %.1fs',
                               url, last_exc, attempt + 1, _MAX_ATTEMPTS - 1, wait)
                time.sleep(wait)
        assert last_exc is not None
        raise last_exc

    # ── Anthropic ──
    def _complete_anthropic(self, system: str, user: str, max_tokens: int) -> str:
        if not self._api_key or 'replace' in self._api_key.lower():
            raise RuntimeError('Claude (Anthropic) API key is not configured — set ANTHROPIC_API_KEY in backend/.env.')
        if self._client is None:
            import anthropic
            self._client = anthropic.Anthropic(api_key=self._api_key)
        message = self._client.messages.create(
            model=self._model,
            max_tokens=max_tokens,
            system=system,
            messages=[{'role': 'user', 'content': user}],
        )
        return message.content[0].text

    # ── OpenAI-compatible (/v1/chat/completions) ──
    def _complete_openai(self, system: str, user: str, max_tokens: int) -> str:
        # Stream the response (SSE). A long, non-streamed generation holds the HTTP
        # connection idle until the whole answer is ready, and the server/proxy often
        # drops it ("Server disconnected without sending a response"). Streaming sends
        # tokens as they are produced, keeping the connection alive.
        headers = {'Content-Type': 'application/json'}
        if self._api_key:
            headers['Authorization'] = f'Bearer {self._api_key}'
        return self._stream_openai(
            f'{self._base_url}{self._openai_path}',
            {
                'model': self._model,
                'messages': [
                    {'role': 'system', 'content': system},
                    {'role': 'user', 'content': user},
                ],
                'temperature': self._temperature,
                'stream': True,
            },
            headers=headers,
        )

    def _stream_openai(self, url: str, payload: dict, headers: dict) -> str:
        """POST with stream=True, accumulate the SSE delta chunks into the full text.
        Retries transient gateway errors / timeouts / mid-stream disconnects (starting the
        stream over each attempt), and honours Retry-After / backs off on 429 like _post."""
        last_exc: Exception | None = None
        for attempt in range(_MAX_ATTEMPTS):
            status, retry_after = None, None
            try:
                with self._client.stream('POST', url, json=payload, headers=headers) as resp:
                    if resp.status_code in _RETRY_STATUS:
                        status = resp.status_code
                        resp.read()  # drain so the connection can be reused
                        ra = resp.headers.get('retry-after')
                        retry_after = float(ra) if (ra and ra.replace('.', '', 1).isdigit()) else None
                        last_exc = httpx.HTTPStatusError(
                            f'{resp.status_code} from {url}', request=resp.request, response=resp)
                    else:
                        resp.raise_for_status()
                        chunks: list[str] = []
                        for line in resp.iter_lines():
                            line = line.strip()
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
                            piece = (choices[0].get('delta') or {}).get('content')
                            if piece:
                                chunks.append(piece)
                        content = ''.join(chunks).strip()
                        if not content:
                            raise RuntimeError('LLM returned empty content (streamed); raise max_tokens.')
                        return content
            except httpx.TransportError as exc:  # connect/read timeout, conn reset, mid-stream drop
                last_exc = exc
            if attempt < _MAX_ATTEMPTS - 1:
                if retry_after is not None:
                    wait = min(retry_after, 30)
                elif status == 429:
                    wait = min(5 * (2 ** attempt), 30)
                else:
                    wait = 1.5 * (attempt + 1)
                logger.warning('LLM stream %s failed (%s); retry %s/%s in %.1fs',
                               url, last_exc, attempt + 1, _MAX_ATTEMPTS - 1, wait)
                time.sleep(wait)
        assert last_exc is not None
        raise last_exc

    # ── Ollama native (/api/chat) ──
    def _complete_ollama(self, system: str, user: str, max_tokens: int) -> str:
        resp = self._post(
            f'{self._base_url}/api/chat',
            {
                'model': self._model,
                'messages': [
                    {'role': 'system', 'content': system},
                    {'role': 'user', 'content': user},
                ],
                'stream': False,
                'options': {'num_predict': max_tokens},
            },
        )
        data = resp.json()
        return data['message']['content']

    # ── Custom Flask wrapper (POST /api/llm -> streamed plain text) ──
    def _complete_flask(self, system: str, user: str, max_tokens: int) -> str:
        prompt = f'{system}\n\n{user}' if system else user
        body: dict = {'prompt': prompt, 'temperature': self._temperature}
        if self._seed is not None:
            body['seed'] = self._seed
        resp = self._post(f'{self._base_url}/api/llm', body)
        text = resp.text.strip()
        # The wrapper streams errors as plain text with a 200 status — surface them.
        if text.startswith('Error:'):
            raise RuntimeError(f'LLM wrapper returned: {text}')
        return text


def _config_for(choice: str) -> dict:
    """Resolve an LLM choice to a provider config.

    'local'  -> the configured local model (settings.LLM_PROVIDER, e.g. the flask
                /Ollama Qwen wrapper).
    'gemini' -> Google Gemini via its OpenAI-compatible endpoint (GEMINI_* settings).
    """
    if (choice or '').lower() == 'openai':
        return {
            'provider': 'openai',
            'model': settings.OPENAI_MODEL,
            'base_url': settings.OPENAI_BASE_URL,
            'openai_path': '/v1/chat/completions',
            'api_key': settings.OPENAI_API_KEY,
            'temperature': settings.LLM_TEMPERATURE,
        }
    if (choice or '').lower() == 'gemini':
        return {
            'provider': 'openai',
            'model': settings.GEMINI_MODEL,
            'base_url': settings.GEMINI_BASE_URL,
            'openai_path': '/chat/completions',
            'api_key': settings.GEMINI_API_KEY,
            'temperature': settings.LLM_TEMPERATURE,
        }
    return {  # 'local' (default)
        'provider': settings.LLM_PROVIDER,
        'model': settings.LLM_MODEL,
        'base_url': settings.LLM_BASE_URL,
        'openai_path': settings.LLM_OPENAI_PATH,
        'api_key': settings.LLM_API_KEY,
        'temperature': settings.LLM_TEMPERATURE,
        'seed': settings.LLM_SEED,
    }


_providers: dict[str, LLMProvider] = {}


def get_llm(choice: str = 'local') -> LLMProvider:
    """Return a (cached) provider for the active LLM.

    Single-provider for now: every call resolves to settings.LLM_ACTIVE (currently
    'openai'), regardless of the per-session/per-call choice. To go back to a
    user-selectable model, resolve from `choice` again instead of LLM_ACTIVE.
    """
    key = (getattr(settings, 'LLM_ACTIVE', 'openai') or 'openai').lower()
    if key not in ('openai', 'gemini', 'local'):
        key = 'openai'
    if key not in _providers:
        _providers[key] = LLMProvider(_config_for(key))
    return _providers[key]
