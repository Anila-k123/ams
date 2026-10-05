"""How Lisa answers a chat message.

Two modes, chosen per request (provider.tool_calling_enabled):

  TOOL MODE (OpenAI, Gemini): the model is given the tools this user may use
  (tools.tools_for) and fetches exactly the data the question needs -
  hearings between two dates, the user's own tasks, one case's court record -
  or acts: opens a page or form (sent to the browser as an `action` event).
  Every typed message comes here; nothing is matched by phrase first.
  Up to MAX_TOOL_ROUNDS rounds of tool calls, then the answer streams.

  CONTEXT MODE (a local model without tool support, or the fallback when a
  tool-mode request fails before anything was shown): a permission-filtered
  brief is built up front (context.build_context) and put into the prompt.

Either way, everything sent to the model is masked (privacy.Masker) and the
reply is unmasked as it streams; scope and permissions come from the
signed-in user (tools.acting_as). Each request writes one audit row.
"""

import datetime
import json
import logging
import time

import requests

from . import context, privacy, prompts, provider, tools

log = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 5
_MAX_DONE_CASES = 5


class _UseContextMode(Exception):
    """Tool mode failed before anything was shown; answer in context mode."""


def stream_answer(question, user, history=None, focus_case_ids=None):
    """Generator of SSE frames: {type:'text',text} pieces, then
    {type:'done', caseIds} or {type:'error', message}.

    `user` is the signed-in Advocate (an id is accepted too)."""
    from core.models import Advocate
    if not hasattr(user, 'id'):
        user = Advocate.objects.filter(id=user).first()
    backend = provider._backend()
    if backend is None:
        yield provider._sse({'type': 'error', 'code': 'unavailable', 'message':
                             f'The AI assistant is not configured (missing {provider._missing_config_var()}).'})
        return
    history = history or []
    focus = list(focus_case_ids or [])
    with tools.acting_as(user):
        masker = privacy.Masker.for_user(user.id) if provider.masking_enabled() else None
    mode = 'tools' if provider.tool_calling_enabled() else 'context'
    try:
        if mode == 'tools':
            try:
                yield from _tool_answer(question, user, history, focus, masker, backend)
                return
            except _UseContextMode as exc:
                log.warning('assistant: tool mode unavailable (%s); using the context brief', exc)
                mode = 'context'
        yield from _context_answer(question, user, history, focus, masker, backend)
    finally:
        _audit_call(user, backend[2], masker, mode)


# --- tool mode -------------------------------------------------------------

def _starter(user, focus):
    """The small facts the model gets up front; everything else it fetches."""
    aid = user.id
    today = datetime.date.today()
    earlier = []
    if focus and tools.allowed(aid, tools.CASES):
        for cid in focus[:_MAX_DONE_CASES]:
            row = tools.get_case_summary(aid, cid)
            if not row.get('error'):
                earlier.append({'caseId': row['caseId'], 'caseNumber': row['caseNumber'],
                                'caseTitle': row['caseTitle']})
    lines = [
        'TODAY: {} ({})'.format(today.isoformat(), today.strftime('%A')),
        'ME: {} ({})'.format(user.full_name, ', '.join(user.role_names()) or 'no role'),
        'NOT PERMITTED: {}'.format(', '.join(tools.not_permitted(aid)) or 'nothing'),
    ]
    if earlier:
        lines.append('EARLIER CASES: ' + json.dumps(earlier, ensure_ascii=False))
    return '\n'.join(lines)


def _read_round(resp, reveal, text_out):
    """Read one streamed model response, yielding its text to the user as it
    comes (unmasked; also kept in `text_out`). Returns, via `yield from`,
    (masked text, tool calls, usage)."""
    calls, text, usage = {}, [], None
    for obj in provider.iter_events(resp):
        if obj.get('usage'):
            usage = obj['usage']
        choices = obj.get('choices') or [{}]
        delta = choices[0].get('delta') or {}
        piece = delta.get('content')
        if piece:
            text.append(piece)
            shown = reveal.feed(piece) if reveal else piece
            if shown:
                yield provider._sse({'type': 'text', 'text': shown})
                text_out.append(shown)
        # Tool calls arrive in pieces too, keyed by index: the id and name
        # once, the JSON arguments spread over several chunks.
        for tc in delta.get('tool_calls') or []:
            slot = calls.setdefault(tc.get('index', 0), {'id': '', 'name': '', 'args': ''})
            slot['id'] = tc.get('id') or slot['id']
            fn = tc.get('function') or {}
            slot['name'] = fn.get('name') or slot['name']
            slot['args'] += fn.get('arguments') or ''
    return ''.join(text), [calls[i] for i in sorted(calls)], usage


def _tool_answer(question, user, history, focus, masker, backend):
    base_url, openai_path, model, api_key = backend
    aid = user.id
    hide = masker.mask if masker else (lambda t: t)
    reveal = privacy.StreamUnmasker(masker) if masker else None
    with tools.acting_as(user):
        specs = tools.tools_for(aid)
        starter = _starter(user, focus)
    messages = [
        {'role': 'system', 'content': prompts.TOOL_PROMPT},
        *[{'role': t['role'], 'content': hide(t['content'])} for t in history],
        {'role': 'user', 'content': hide(starter + '\n\nQuestion: ' + question)},
    ]
    shown, used_cases, acted = [], [], False
    for round_no in range(MAX_TOOL_ROUNDS + 1):
        last = round_no == MAX_TOOL_ROUNDS
        payload = {
            'model': model, 'messages': messages, 'temperature': provider.LLM_TEMPERATURE,
            'stream': True, 'stream_options': {'include_usage': True},
            'tools': specs,
            # The final round must answer: no more lookups.
            'tool_choice': 'none' if last else 'auto',
        }
        started = time.monotonic()
        try:
            resp = provider._post_stream(payload, base_url, openai_path, api_key)
        except provider.AssistantUnavailable as exc:
            if round_no == 0:
                raise _UseContextMode(str(exc))
            yield provider._sse({'type': 'error', 'message': 'Could not reach the AI model. Please try again shortly.'})
            return
        text, calls, usage = '', [], None
        try:
            text, calls, usage = yield from _read_round(resp, reveal, shown)
        except requests.RequestException as exc:
            log.warning('assistant: stream dropped: %s', exc)
            if not shown:
                yield provider._sse({'type': 'error', 'message': 'The model connection dropped. Please try again.'})
                return
        finally:
            resp.close()
            provider._meter(model, usage, json.dumps(messages, ensure_ascii=False), text, started)
        if not calls or last:
            break

        messages.append({'role': 'assistant', 'content': text or None, 'tool_calls': [
            {'id': c['id'], 'type': 'function', 'function': {'name': c['name'], 'arguments': c['args'] or '{}'}}
            for c in calls]})
        for c in calls:
            raw = masker.unmask(c['args']) if masker else c['args']
            try:
                args = json.loads(raw or '{}')
            except ValueError:
                args = {}
            if not isinstance(args, dict):
                args = {}
            with tools.acting_as(user):
                result = tools.run_tool(c['name'], args, aid)
            # Opening a page or form: the browser does it now; the model is
            # only told it happened.
            action = result.pop('_action', None) if isinstance(result, dict) else None
            if action:
                acted = True
                yield provider._sse({'type': 'action', **action})
            # A page the answer refers to: shown as a button under the reply,
            # opened only when the user clicks it (unlike _action).
            link = result.pop('_link', None) if isinstance(result, dict) else None
            if link:
                yield provider._sse({'type': 'link', **link})
            if c['name'] in tools.CASE_TOOLS and not result.get('error') and args.get('case_id'):
                try:
                    cid = int(args['case_id'])
                except (TypeError, ValueError):
                    cid = None
                if cid and cid not in used_cases:
                    used_cases.append(cid)
            messages.append({'role': 'tool', 'tool_call_id': c['id'],
                             'content': hide(json.dumps(result, ensure_ascii=False, default=str))})

    if reveal:
        rest = reveal.flush()
        if rest:
            shown.append(rest)
            yield provider._sse({'type': 'text', 'text': rest})
    if not shown:
        if not acted:
            yield provider._sse({'type': 'error', 'message': 'The model returned no response. Please try again.'})
            return
        yield provider._sse({'type': 'text', 'text': 'Done.'})
    # The cases this answer was about, for the next follow-up; if it looked
    # none up, the conversation is still on the earlier ones.
    yield provider._sse({'type': 'done', 'caseIds': (used_cases or focus)[:_MAX_DONE_CASES]})


# --- context mode ------------------------------------------------------------

def _context_answer(question, user, history, focus, masker, backend):
    base_url, openai_path, model, api_key = backend
    advocate_id = user.id
    hide = masker.mask if masker else (lambda t: t)
    with tools.acting_as(user):
        ctx = context.build_context(advocate_id, question, focus, history)
    payload = {
        'model': model,
        # Earlier turns go in as plain conversation; only the latest message
        # carries CONTEXT DATA, so facts always come from a fresh read. Every
        # turn is masked: earlier answers were shown to the user unmasked.
        'messages': [
            {'role': 'system', 'content': prompts.CONTEXT_PROMPT},
            *[{'role': t['role'], 'content': hide(t['content'])} for t in history],
            {'role': 'user', 'content': hide(context._user_message(question, ctx))},
        ],
        'temperature': provider.LLM_TEMPERATURE,
        'stream': True,
        # The token counts arrive in a final chunk (metering). Servers that
        # don't support it ignore the field, and the call is estimated instead.
        'stream_options': {'include_usage': True},
    }

    reveal = privacy.StreamUnmasker(masker) if masker else None
    started = time.monotonic()
    stream_usage = None
    answer_parts = []
    try:
        resp = provider._post_stream(payload, base_url, openai_path, api_key)
    except provider.AssistantUnavailable as exc:
        log.warning('assistant: %s LLM unreachable: %s', provider.LLM_PROVIDER, exc)
        yield provider._sse({'type': 'error', 'code': 'unavailable',
                             'message': 'Could not reach the AI model. Please try again shortly.'})
        return

    got_text = False
    try:
        for obj in provider.iter_events(resp):
            if obj.get('usage'):
                stream_usage = obj['usage']
            choices = obj.get('choices') or [{}]
            piece = (choices[0].get('delta') or {}).get('content')
            if piece:
                got_text = True
                answer_parts.append(piece)
                shown = reveal.feed(piece) if reveal else piece
                if shown:
                    yield provider._sse({'type': 'text', 'text': shown})
    except requests.RequestException as exc:
        log.warning('assistant: stream dropped: %s', exc)
        if not got_text:
            yield provider._sse({'type': 'error', 'message': 'The model connection dropped. Please try again.'})
            return
    finally:
        resp.close()
        provider._meter(model, stream_usage, json.dumps(payload['messages'], ensure_ascii=False),
                        ''.join(answer_parts), started)

    if reveal:
        rest = reveal.flush()
        if rest:
            yield provider._sse({'type': 'text', 'text': rest})
    if not got_text:
        yield provider._sse({'type': 'error', 'message': 'The model returned no response. Please try again.'})
    else:
        # caseIds lets the browser send "the case we were talking about" back
        # with the next question, for follow-ups that don't name it.
        yield provider._sse({'type': 'done', 'caseIds': context.context_case_ids(ctx)})


# --- audit -------------------------------------------------------------------

def _audit_call(user, model, masker, mode):
    """One audit row per chat request: provider, mode, whether masking ran
    and how many values of each kind it hid. Never the values themselves."""
    try:
        from django.utils import timezone
        from core.models import AuditLog
        hidden = masker.summary() if masker else {}
        AuditLog.objects.create(
            action_type='ASSISTANT_LLM_CALL', module='ASSISTANT', entity_type='ASSISTANT',
            title='Lisa sent a question to {} ({})'.format(provider.LLM_PROVIDER, model)[:255],
            description=('Masked: ' + ', '.join('{} {}'.format(n, k.lower()) for k, n in sorted(hidden.items()))
                         if masker else 'Not masked (local model)')[:255],
            status='SUCCESS', user_name=getattr(user, 'email', None) or '',
            ip_address='', device='', browser='', operating_system='',
            request_method='POST', request_uri='/api/assistant/chat',
            metadata=json.dumps({'provider': provider.LLM_PROVIDER, 'model': model, 'mode': mode,
                                 'masked': bool(masker), 'counts': hidden}),
            created_at=timezone.now(), advocate_id=getattr(user, 'id', None))
    except Exception:                                        # noqa: BLE001
        log.warning('assistant: could not write the audit row', exc_info=True)
