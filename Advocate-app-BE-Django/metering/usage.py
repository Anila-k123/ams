"""Token metering for every LLM call, by feature, user and firm.

Where the work starts (a view, a background task), wrap it in
`metering(feature, operation, advocate_id)`. The two wrappers every LLM call
goes through (assistant/llm.py and drafting/providers/llm.py) call `record()`
with the provider's token counts, and the row picks up who and what from the
context. A ContextVar, not a thread-local: it follows the code through the
streaming generator of a chat answer and survives the drafting job runner,
which sets it inside the task function itself.

record() never raises. Metering must not be able to break a draft or a chat
answer; a failed write is logged and dropped.
"""

import contextlib
import contextvars
import logging

log = logging.getLogger(__name__)

# Rough English token size, for providers that report no usage.
CHARS_PER_TOKEN = 4

_ctx = contextvars.ContextVar('llm_metering', default=None)


@contextlib.contextmanager
def metering(feature, operation='', advocate_id=None, ref_type='', ref_id=None):
    token = _ctx.set({'feature': feature, 'operation': operation or feature,
                      'advocate_id': advocate_id, 'ref_type': ref_type or '', 'ref_id': ref_id})
    try:
        yield
    finally:
        _ctx.reset(token)


def current():
    return _ctx.get()


def estimate_tokens(text):
    return max(1, len(text or '') // CHARS_PER_TOKEN) if text else 0


def _practice_of(advocate_id):
    if not advocate_id:
        return None
    from core.models import Advocate
    parent = (Advocate.objects.filter(id=advocate_id)
              .values_list('parent_advocate_id', flat=True).first())
    return parent or advocate_id


def record(provider='', model='', input_tokens=0, output_tokens=0, *, estimated=False,
           characters=None, duration_ms=None, ok=True):
    """Store one call's usage under the current metering context."""
    try:
        from .models import LLMUsage
        ctx = _ctx.get() or {'feature': 'unattributed', 'operation': '', 'advocate_id': None,
                             'ref_type': '', 'ref_id': None}
        i, o = int(input_tokens or 0), int(output_tokens or 0)
        LLMUsage.objects.create(
            advocate_id=ctx['advocate_id'], practice_id=_practice_of(ctx['advocate_id']),
            feature=ctx['feature'], operation=ctx['operation'],
            provider=(provider or '')[:32], model=(model or '')[:128],
            input_tokens=i, output_tokens=o, total_tokens=i + o, estimated=bool(estimated),
            characters=characters, ref_type=ctx['ref_type'], ref_id=ctx['ref_id'],
            duration_ms=duration_ms, ok=ok)
    except Exception:                                        # noqa: BLE001
        log.exception('LLM usage could not be recorded')


def record_text(provider, model, prompt_text, output_text, *, duration_ms=None, ok=True):
    """For a provider that returned no usage: estimate from the text lengths."""
    record(provider, model, estimate_tokens(prompt_text), estimate_tokens(output_text),
           estimated=True, duration_ms=duration_ms, ok=ok)
