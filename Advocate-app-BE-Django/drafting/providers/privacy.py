"""What drafting may send to a language model outside our own machines.

Every drafting model call goes through LLMProvider.complete, which asks
`guard()` here first:

- Model on this machine or the office network: nothing changes.
- Model elsewhere (Anthropic, Gemini, OpenAI, a tunnel such as ngrok): the
  prompt is masked with assistant.privacy.Masker before it leaves - names,
  addresses and identifiers of the acting advocate's clients, parties and staff,
  plus the party names typed into the draft's facts - and the reply is
  unmasked, so the draft still carries the real names.
- If masking can't be done safely it FAILS CLOSED (ExternalAIBlocked) rather
  than sending the original text: no acting advocate is known, or a value we
  know is confidential is still visible after masking.

Masking is not a guarantee: a name that appears only in free text and in no
record or fact is not known, so not masked (the same limit as Lisa). Firms that
need certainty use a local model. DRAFTING_MASK_EXTERNAL=False switches masking
off (sends the original text) - only for an approved, explicit decision.
"""
import contextvars
import ipaddress
import logging
import re
from urllib.parse import urlparse

from django.conf import settings

log = logging.getLogger(__name__)

ALWAYS_EXTERNAL = {'anthropic', 'gemini'}
TOKEN_NOTE = (
    'Some names and identifiers in this request are replaced by placeholders such as '
    '[CLIENT_1], [PARTY_2], [PERSON_1], [ADDRESS_1], [PHONE_1]. Treat each placeholder as the '
    'real value: copy it into your answer exactly as written, brackets included, wherever that '
    'value belongs. Never invent, renumber, translate or explain placeholders.\n\n')

# Facts keys whose values are people, organisations or contact details.
_SENSITIVE_FACT = re.compile(
    r'name|party|parties|address|email|phone|mobile|company|firm|counsel|witness|signator|'
    r'employee|employer|landlord|tenant|lessor|lessee|buyer|seller|vendor|purchaser|lender|'
    r'borrower|guarantor|disclos|recipient|receiving|licensor|licensee|client|director|partner',
    re.I)

_extra_names = contextvars.ContextVar('drafting_mask_names', default=())


class ExternalAIBlocked(RuntimeError):
    """Refused to send this request to an external model."""


def is_external(provider, base_url):
    if provider in ALWAYS_EXTERNAL:
        return True
    host = (urlparse(base_url or '').hostname or '').lower()
    if not host:
        return provider not in ('ollama', 'flask', 'openai')   # no URL: their default is local
    if host == 'localhost':
        return False
    try:
        ip = ipaddress.ip_address(host)
        return not (ip.is_loopback or ip.is_private)
    except ValueError:
        return True          # a host name (ngrok, a cloud API): outside our network


def fact_names(facts):
    """Sensitive string values from a draft's facts (nested dicts/lists too)."""
    out = []

    def walk(value, key=''):
        if isinstance(value, dict):
            for k, v in value.items():
                walk(v, str(k))
        elif isinstance(value, list):
            for v in value:
                walk(v, key)
        elif isinstance(value, str):
            v = ' '.join(value.split())
            if _SENSITIVE_FACT.search(key) and 3 <= len(v) <= 200 and re.search(r'[A-Za-z]', v):
                out.append(v)
    walk(facts or {})
    return out


class names_for_masking:
    """Context manager: extra confidential values (e.g. a draft's facts) the
    masker must hide for calls made inside the block."""

    def __init__(self, values):
        self.values = tuple(v for v in (values or ()) if v)

    def __enter__(self):
        self._token = _extra_names.set(tuple(_extra_names.get()) + self.values)
        return self

    def __exit__(self, *exc):
        _extra_names.reset(self._token)


class _Guard:
    def __init__(self, masker, known):
        self.masker = masker
        self.known = known

    def outgoing(self, system, user):
        system_m = TOKEN_NOTE + (self.masker.mask(system or '') or '')
        user_m = self.masker.mask(user or '') or ''
        both = system_m + '\n' + user_m
        # Same word boundaries as the masker: 'Kumar' must not match 'Kumaravel'.
        leaked = [v for v in self.known if len(v) >= 4 and re.search(
            r'(?<![A-Za-z0-9/])' + re.escape(v).replace(r'\ ', r'\s+') + r'(?![A-Za-z0-9/])',
            both, re.I)]
        if leaked:
            raise ExternalAIBlocked(
                'Masking was incomplete, so this request was not sent to the external AI model. '
                'Use a local model for this draft.')
        return system_m, user_m

    def incoming(self, text):
        return self.masker.unmask(text)


def guard(provider, base_url):
    """None when the call may go out as-is, else a _Guard that masks it.
    Raises ExternalAIBlocked when it must not go out at all."""
    if not is_external(provider, base_url):
        return None
    if not settings.DRAFTING_MASK_EXTERNAL:
        log.warning('Drafting is sending unmasked text to external model provider %s '
                    '(DRAFTING_MASK_EXTERNAL=False).', provider)
        return None
    from assistant.privacy import Masker
    from metering.usage import current
    ctx = current() or {}
    advocate_id = ctx.get('advocate_id')
    if not advocate_id:
        raise ExternalAIBlocked(
            'This request has no acting user, so it cannot be masked; it was not sent to the '
            'external AI model.')
    masker = Masker.for_user(advocate_id)
    extra = list(_extra_names.get())
    for value in extra:
        masker.add(value, 'PARTY')
    # Values we can check for after masking: the facts, plus every registered name.
    known = set(extra) | {surface for surface, _ in masker._names if len(surface) >= 6}
    return _Guard(masker, known)
