"""Token metering (metering/usage.py) and its reports (metering/report.py)."""

import json
from unittest import mock

from django.test import TestCase, override_settings

from core.testing import ALL_PERMISSIONS, auth, make_advocate

from .models import LLMUsage
from .report import summarize
from .usage import metering, record, record_text


class _FakeResp:
    """A `requests` response for assistant.llm."""

    def __init__(self, obj=None, lines=None):
        self._obj, self._lines = obj, lines or []
        self.status_code, self.encoding = 200, 'utf-8'

    def raise_for_status(self):
        pass

    def json(self):
        return self._obj

    def iter_lines(self, decode_unicode=True):
        return iter(self._lines)

    def close(self):
        pass


class RecordTest(TestCase):
    def setUp(self):
        self.owner = make_advocate('meter-owner@test.local', ALL_PERMISSIONS)
        self.junior = make_advocate('meter-junior@test.local', parent_advocate_id=self.owner.id)

    def test_record_uses_the_context_and_the_users_firm(self):
        with metering('draft', 'draft.generate', self.junior.id, ref_type='draft', ref_id=7):
            record('openai', 'gpt-4o', 1200, 300)
        row = LLMUsage.objects.get()
        self.assertEqual((row.feature, row.operation, row.advocate_id, row.practice_id),
                         ('draft', 'draft.generate', self.junior.id, self.owner.id))
        self.assertEqual((row.input_tokens, row.output_tokens, row.total_tokens), (1200, 300, 1500))
        self.assertEqual((row.ref_type, row.ref_id, row.estimated), ('draft', 7, False))

    def test_outside_a_context_the_call_is_still_recorded(self):
        record('openai', 'gpt-4o', 10, 5)
        self.assertEqual(LLMUsage.objects.get().feature, 'unattributed')

    def test_record_never_raises(self):
        with mock.patch.object(LLMUsage.objects, 'create', side_effect=RuntimeError('db down')):
            record('openai', 'gpt-4o', 10, 5)   # must not raise

    def test_no_usage_is_estimated_from_text(self):
        with metering('summary', 'summary.document', self.owner.id):
            record_text('local', 'qwen', 'x' * 400, 'y' * 40)
        row = LLMUsage.objects.get()
        self.assertTrue(row.estimated)
        self.assertEqual((row.input_tokens, row.output_tokens), (100, 10))


class AssistantMeteringTest(TestCase):
    def setUp(self):
        self.adv = make_advocate('meter-chat@test.local', ALL_PERMISSIONS)

    def test_complete_text_records_the_providers_counts(self):
        from assistant import llm, provider
        resp = _FakeResp({'choices': [{'message': {'content': 'ok'}}],
                          'usage': {'prompt_tokens': 812, 'completion_tokens': 64}})
        with mock.patch.object(provider, '_backend', return_value=('http://m', '/c', 'gpt-4o', 'k')), \
                mock.patch.object(provider.requests, 'post', return_value=resp), \
                metering('summary', 'summary.document', self.adv.id):
            self.assertEqual(llm.complete_text('sys', 'user'), 'ok')
        row = LLMUsage.objects.get()
        self.assertEqual((row.feature, row.input_tokens, row.output_tokens, row.estimated),
                         ('summary', 812, 64, False))

    def test_the_chat_stream_records_usage_from_the_last_chunk(self):
        from assistant import llm, provider
        lines = ['data: ' + json.dumps({'choices': [{'delta': {'content': 'Hello'}}]}),
                 'data: ' + json.dumps({'choices': [], 'usage': {'prompt_tokens': 3000,
                                                                 'completion_tokens': 120}}),
                 'data: [DONE]']
        sent = {}

        def fake_post(payload, *a):
            sent.update(payload)
            return _FakeResp(lines=lines)

        with mock.patch.object(provider, '_backend', return_value=('http://m', '/c', 'gpt-4o', 'k')), \
                mock.patch.object(provider, 'ASSISTANT_TOOL_CALLING', 'off'), \
                mock.patch.object(provider, '_post_stream', side_effect=fake_post), \
                metering('chat', 'chat.answer', self.adv.id):
            list(llm.stream_answer('hello', self.adv.id))
        self.assertEqual(sent['stream_options'], {'include_usage': True})
        row = LLMUsage.objects.get()
        self.assertEqual((row.feature, row.input_tokens, row.output_tokens), ('chat', 3000, 120))

    def test_the_chat_endpoint_attributes_the_answer_to_the_user(self):
        from assistant import llm, provider
        lines = ['data: ' + json.dumps({'choices': [{'delta': {'content': 'Hi'}}],
                                        'usage': {'prompt_tokens': 50, 'completion_tokens': 2}}),
                 'data: [DONE]']
        with mock.patch.object(provider, '_backend', return_value=('http://m', '/c', 'gpt-4o', 'k')), \
                mock.patch.object(provider, '_post_stream', return_value=_FakeResp(lines=lines)):
            resp = self.client.post('/api/assistant/chat', data=json.dumps({'query': 'hello'}),
                                    content_type='application/json', **auth(self.adv))
            b''.join(resp.streaming_content)
        row = LLMUsage.objects.get()
        self.assertEqual((row.feature, row.advocate_id), ('chat', self.adv.id))


class DraftingProviderMeteringTest(TestCase):
    def _provider(self, provider):
        from drafting.providers.llm import LLMProvider
        return LLMProvider({'provider': provider, 'model': 'm-1', 'base_url': 'http://x',
                            'api_key': 'k'})

    def test_anthropic_usage(self):
        p = self._provider('anthropic')
        msg = mock.Mock(content=[mock.Mock(text='done')], usage=mock.Mock(input_tokens=900, output_tokens=80))
        p._client = mock.Mock()
        p._client.messages.create.return_value = msg
        with metering('draft', 'draft.generate', None):
            self.assertEqual(p.complete('s', 'u'), 'done')
        row = LLMUsage.objects.get()
        self.assertEqual((row.provider, row.input_tokens, row.output_tokens), ('anthropic', 900, 80))

    def test_openai_stream_usage_and_plain_text_result(self):
        p = self._provider('openai')
        lines = ['data: ' + json.dumps({'choices': [{'delta': {'content': 'Clause text'}}]}),
                 'data: ' + json.dumps({'choices': [], 'usage': {'prompt_tokens': 1500,
                                                                 'completion_tokens': 400}}),
                 'data: [DONE]']
        stream = mock.MagicMock()
        stream.__enter__.return_value = mock.Mock(status_code=200, iter_lines=lambda: iter(lines),
                                                  raise_for_status=lambda: None)
        p._client = mock.Mock(stream=mock.Mock(return_value=stream))
        with metering('draft', 'draft.refine', None):
            self.assertEqual(p.complete('s', 'u'), 'Clause text')
        sent = p._client.stream.call_args.kwargs['json']
        self.assertEqual(sent['stream_options'], {'include_usage': True})
        row = LLMUsage.objects.get()
        self.assertEqual((row.operation, row.input_tokens, row.output_tokens, row.estimated),
                         ('draft.refine', 1500, 400, False))

    def test_a_failed_call_is_recorded_as_not_ok(self):
        p = self._provider('anthropic')
        p._client = mock.Mock()
        p._client.messages.create.side_effect = RuntimeError('quota')
        with metering('draft', 'draft.generate', None), self.assertRaises(RuntimeError):
            p.complete('s', 'u')
        self.assertFalse(LLMUsage.objects.get().ok)


@override_settings(LLM_PRICES={'gpt-4o': [2.5, 10]}, LLM_PRICE_CURRENCY='USD')
class ReportTest(TestCase):
    def setUp(self):
        self.admin = make_advocate('meter-admin@test.local', ALL_PERMISSIONS)
        self.plain = make_advocate('meter-plain@test.local', ('CASE_VIEW',))
        for feature, i, o in (('chat', 1_000_000, 100_000), ('draft', 2_000_000, 500_000),
                              ('draft', 1_000_000, 0)):
            with metering(feature, feature, self.admin.id):
                record('openai', 'gpt-4o', i, o)
        with metering('summary', 'summary', self.admin.id):
            record('local', 'unpriced-model', 500, 50)

    def test_totals_and_cost_by_feature(self):
        data = summarize(by='feature')
        by = {g['key']: g for g in data['groups']}
        self.assertEqual(by['draft']['calls'], 2)
        self.assertEqual(by['draft']['input_tokens'], 3_000_000)
        self.assertAlmostEqual(by['draft']['cost'], 3 * 2.5 + 0.5 * 10)   # 12.5
        self.assertAlmostEqual(by['chat']['cost'], 2.5 + 1.0)              # 3.5
        self.assertEqual(by['summary']['cost'], 0)
        self.assertEqual(data['total']['unpriced_tokens'], 550)

    def test_the_api_matches_and_is_admin_only(self):
        resp = self.client.get('/api/usage/summary?by=feature', **auth(self.admin))
        self.assertEqual(resp.status_code, 200)
        self.assertAlmostEqual(resp.json()['total']['cost'], 16.0)
        self.assertEqual(self.client.get('/api/usage/summary', **auth(self.plain)).status_code, 403)
