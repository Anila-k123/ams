"""Phase 8: plans, entitlements, quotas, metering and the subscription lifecycle.

Three firms (A, B, C) in firm mode. Entitlements only ever take away: RBAC and
tenancy decide first, then the subscription.
"""
import datetime
import io
import os
import shutil
import tempfile
import threading
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import connections
from django.test import TestCase, TransactionTestCase, override_settings

from core.models import Case, Client, Document
from core.testing import ALL_PERMISSIONS, auth, make_case, make_client, make_firm, make_firm_member
from firms.models import FirmMembership
from platform_admin.auth import issue_token
from platform_admin.models import PlatformOperator
from subscriptions import catalogue as C
from subscriptions import service
from subscriptions.models import (EntitlementOverride, FirmSubscription, FirmUsage, MeteredRequest, Plan,
                                  PlanChangeAudit, UsageEvent)


def json_post(client, url, body, user=None, **extra):
    import json
    h = auth(user) if user is not None else {}
    return client.post(url, data=json.dumps(body), content_type='application/json', **h, **extra)


def on_plan(firm, code, status='ACTIVE'):
    """Put a firm on a plan for an enforcement test. The seeded commercial plans
    are unapproved drafts; here they stand for approved, published ones."""
    C.ensure_plans()
    sub = FirmSubscription.objects.filter(firm=firm).first()
    plan = Plan.objects.get(code=code)
    if plan.state in (Plan.DRAFT, Plan.APPROVED):
        Plan.objects.filter(id=plan.id).update(state=Plan.PUBLISHED)
        plan.refresh_from_db()
    if sub is None:
        return FirmSubscription.objects.create(firm=firm, plan=plan, status=status,
                                               trial_ends_at=datetime.datetime.now() + datetime.timedelta(days=14)
                                               if status == 'TRIALING' else None)
    sub.plan, sub.status = plan, status
    sub.save()
    return sub


def override(firm, key, **kw):
    return EntitlementOverride.objects.update_or_create(firm=firm, key=key, defaults={'reason': 'test', **kw})[0]


class _Firms:
    def build(self):
        self.firm = {k: make_firm(k) for k in 'ABC'}
        self.admin = {k: make_firm_member(self.firm[k], ALL_PERMISSIONS + ('SETTINGS_EDIT',)) for k in 'ABC'}


@override_settings(TENANCY_MODE='firm')
class PlanCatalogueTests(TestCase):
    def test_every_plan_has_every_key_and_no_price(self):
        C.ensure_plans()
        for p in Plan.objects.all():
            self.assertEqual({e.key for e in p.entitlements.all()}, set(C.KEYS), p.code)
            self.assertIsNone(p.monthly_price)                     # prices are a business decision
            # Unapproved examples: never offered to customers; Legacy is internal.
            self.assertEqual(p.state, 'SYSTEM' if p.code == 'LEGACY' else 'DRAFT', p.code)
            self.assertFalse(p.is_public, p.code)
        trial = Plan.objects.get(code='TRIAL')
        self.assertEqual(trial.trial_days, 14)
        self.assertFalse(trial.entitlements.get(key=C.CLIENT_PORTAL).enabled)
        self.assertFalse(Plan.objects.get(code='BASIC').entitlements.get(key=C.DRAFTING).enabled)
        self.assertTrue(all(e.limit is None for e in Plan.objects.get(code='LEGACY').entitlements.all()))
        self.assertFalse(Plan.objects.get(code='LEGACY').is_public)

    def test_seeding_never_overwrites_an_operators_edit(self):
        C.ensure_plans()
        Plan.objects.get(code='BASIC').entitlements.filter(key=C.CASES).update(limit=7)
        call_command('seed_plans', stdout=io.StringIO())
        self.assertEqual(Plan.objects.get(code='BASIC').entitlements.get(key=C.CASES).limit, 7)


@override_settings(TENANCY_MODE='firm')
class EnforcementTests(_Firms, TestCase):
    def setUp(self):
        self.build()

    def create_case(self, who, n):
        return json_post(self.client, '/api/cases/create', {
            'caseNumber': f'OS/{who}/{n}', 'caseTitle': f'T{n}', 'caseType': 'OS', 'courtLevel': 'District',
            'status': 'Active', 'clientId': make_client(self.admin[who]).id, 'matterType': 'litigation'},
            self.admin[who])

    def test_a_firm_without_a_subscription_is_refused_not_unrestricted(self):
        FirmSubscription.objects.filter(firm=self.firm['A']).delete()
        self.assertEqual(service.check_entitlement(self.firm['A'], C.CASES).reason, 'SUBSCRIPTION_MISSING')
        r = self.create_case('A', 1)
        self.assertEqual((r.status_code, r.json()['code']), (403, 'ENTITLEMENT_SUBSCRIPTION_MISSING'))
        self.assertEqual(self.client.get('/api/cases/my-cases', **auth(self.admin['A'])).status_code, 200)
        # Existing (Legacy) firms keep everything.
        for n in range(3):
            self.assertLess(self.create_case('B', n).status_code, 300)

    def test_a_draft_plan_is_never_treated_as_a_customer_plan(self):
        on_plan(self.firm['A'], 'BASIC')
        Plan.objects.filter(code='BASIC').update(state=Plan.DRAFT)
        r = self.create_case('A', 1)
        self.assertEqual(r.json()['code'], 'ENTITLEMENT_PLAN_NOT_PUBLISHED')
        FirmSubscription.objects.filter(firm=self.firm['A']).update(test_firm=True)
        self.assertEqual(self.create_case('A', 2).json()['code'], 'ENTITLEMENT_PLAN_NOT_PUBLISHED')  # setting off
        with override_settings(SUBSCRIPTION_TEST_PLANS=True):
            self.assertLess(self.create_case('A', 3).status_code, 300)
        Plan.objects.filter(code='BASIC').update(state=Plan.RETIRED)                 # firms on it keep it
        FirmSubscription.objects.filter(firm=self.firm['A']).update(test_firm=False)
        self.assertLess(self.create_case('A', 4).status_code, 300)

    def test_pending_subscription_adds_nothing_but_reads_work(self):
        FirmSubscription.objects.filter(firm=self.firm['A']).update(plan=None, status='PENDING')
        r = self.create_case('A', 1)
        self.assertEqual(r.json()['code'], 'ENTITLEMENT_SUBSCRIPTION_INACTIVE')
        self.assertIn('not been chosen', r.json()['error'])
        self.assertEqual(self.client.get('/api/cases/my-cases', **auth(self.admin['A'])).status_code, 200)
        on = self.client.get('/api/firm/subscription', **auth(self.admin['A'])).json()
        self.assertEqual((on['status'], on['readOnly'], on['plan']['code']), ('PENDING', True, ''))
        with self.assertRaises(service.SubscriptionError):
            service.set_status(self.firm['A'], 'ACTIVE', actor='o', reason='no plan yet')
        on_plan(self.firm['B'], 'BASIC')                               # publishes BASIC for this test
        service.change_plan(self.firm['A'], 'BASIC', actor='o', reason='plan chosen')
        self.assertLess(self.create_case('A', 2).status_code, 300)

    def test_create_firm_command_is_refused_once_tenancy_is_on(self):
        from django.core.management.base import CommandError
        with self.assertRaises(CommandError):
            call_command('create_firm', name='Side Firm', admin_name='Side Admin', admin_email='side@x.test',
                         password='Explore@2026', yes=True, stdout=io.StringIO())
        from core.models import Advocate
        self.assertFalse(Advocate.objects.filter(email='side@x.test').exists())

    def test_moving_a_matter_counts_a_copied_client(self):
        on_plan(self.firm['A'], 'BASIC')
        other = make_firm_member(self.firm['A'])
        from cases.views import _resolve_target_client
        from django.db import transaction
        src = make_client(self.admin['A'], name='Copy Me', email='copy@x.test')
        override(self.firm['A'], C.CLIENTS, limit=Client.objects.filter(firm_id=self.firm['A'].id, deleted=False).count())
        with self.assertRaises(service.EntitlementDenied), transaction.atomic():
            _resolve_target_client(other, src)

    def test_legacy_is_never_assignable_by_an_operator(self):
        on_plan(self.firm['A'], 'BASIC')
        with self.assertRaises(service.SubscriptionError) as e:
            service.change_plan(self.firm['A'], 'LEGACY', actor='o', reason='x')
        self.assertEqual(e.exception.code, 'PLAN_NOT_ASSIGNABLE')

    def test_legacy_plan_is_unlimited(self):
        on_plan(self.firm['A'], 'LEGACY')
        d = service.check_entitlement(self.firm['A'], C.STORAGE, quantity=10 ** 15)
        self.assertTrue(d.allowed)
        self.assertIsNone(d.limit)

    def test_case_limit_blocks_new_cases_only_in_that_firm_and_keeps_data_readable(self):
        on_plan(self.firm['A'], 'BASIC')
        override(self.firm['A'], C.CASES, limit=2)
        on_plan(self.firm['B'], 'BASIC')
        self.assertLess(self.create_case('A', 1).status_code, 300)
        self.assertLess(self.create_case('A', 2).status_code, 300)
        r = self.create_case('A', 3)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()['code'], 'ENTITLEMENT_LIMIT_REACHED')
        self.assertEqual((r.json()['entitlement']['limit'], r.json()['entitlement']['used']), (2, 2))
        self.assertLess(self.create_case('B', 1).status_code, 300)              # firm B unaffected
        self.assertEqual(self.client.get('/api/cases/my-cases', **auth(self.admin['A'])).status_code, 200)
        self.assertEqual(Case.objects.filter(firm_id=self.firm['A'].id, deleted=False).count(), 2)

    def test_a_plan_never_grants_a_permission(self):
        on_plan(self.firm['A'], 'ENTERPRISE')
        viewer = make_firm_member(self.firm['A'], permissions=('CASE_VIEW',))
        r = json_post(self.client, '/api/cases/create', {'caseNumber': 'X/1', 'caseTitle': 'x', 'caseType': 'OS',
                                                        'courtLevel': 'District', 'status': 'Active'}, viewer)
        self.assertEqual(r.status_code, 403)
        self.assertNotIn('ENTITLEMENT', r.json().get('code', ''))
        self.assertEqual(self.client.get('/api/firm/subscription', **auth(viewer)).status_code, 403)

    def test_expired_trial_is_read_only_and_loses_nothing(self):
        on_plan(self.firm['A'], 'TRIAL', status='TRIALING')
        self.assertLess(self.create_case('A', 1).status_code, 300)
        FirmSubscription.objects.filter(firm=self.firm['A']).update(
            trial_ends_at=datetime.datetime.now() - datetime.timedelta(minutes=1))
        r = self.create_case('A', 2)
        self.assertEqual(r.json()['code'], 'ENTITLEMENT_SUBSCRIPTION_INACTIVE')
        self.assertEqual(self.client.get('/api/cases/my-cases', **auth(self.admin['A'])).status_code, 200)
        login = json_post(self.client, '/api/advocates/login', {'email': self.admin['A'].email, 'password': 'x'})
        self.assertNotEqual(login.json().get('code'), 'FIRM_SUSPENDED')            # not a security suspension
        self.assertEqual(service.expire_due_trials(), 1)
        sub = FirmSubscription.objects.get(firm=self.firm['A'])
        self.assertEqual(sub.status, 'EXPIRED')
        self.assertEqual(Case.objects.filter(firm_id=self.firm['A'].id).count(), 1)  # nothing deleted
        self.assertEqual(self.firm['A'].__class__.objects.get(id=self.firm['A'].id).status, 'ACTIVE')
        service.extend_trial(self.firm['A'], 7, actor='ops@test', reason='more time')
        self.assertLess(self.create_case('A', 3).status_code, 300)

    def test_downgrade_keeps_data_and_blocks_only_new_additions(self):
        on_plan(self.firm['A'], 'PROFESSIONAL')
        for n in range(3):
            self.create_case('A', n)
        Plan.objects.filter(code__in=['BASIC', 'ENTERPRISE']).update(state=Plan.PUBLISHED)
        service.change_plan(self.firm['A'], 'BASIC', actor='ops@test', reason='downgrade')
        override(self.firm['A'], C.CASES, limit=1)
        self.assertEqual(Case.objects.filter(firm_id=self.firm['A'].id, deleted=False).count(), 3)
        self.assertEqual(self.create_case('A', 9).json()['code'], 'ENTITLEMENT_LIMIT_REACHED')
        service.change_plan(self.firm['A'], 'ENTERPRISE', actor='ops@test', reason='upgrade')
        EntitlementOverride.objects.all().delete()
        self.assertLess(self.create_case('A', 10).status_code, 300)

    def test_state_machine(self):
        on_plan(self.firm['A'], 'BASIC', status='ACTIVE')
        service.set_status(self.firm['A'], 'CANCELLED', actor='o', reason='left')
        with self.assertRaises(service.SubscriptionError):
            service.set_status(self.firm['A'], 'PAST_DUE', actor='o', reason='x')     # not from CANCELLED
        service.set_status(self.firm['A'], 'ACTIVE', actor='o', reason='back')
        self.assertEqual(list(PlanChangeAudit.objects.filter(firm=self.firm['A'], action__startswith='STATUS_')
                              .values_list('action', flat=True)),
                         ['STATUS_ACTIVE', 'STATUS_CANCELLED'])

    def test_expired_override_is_ignored(self):
        on_plan(self.firm['A'], 'BASIC')
        override(self.firm['A'], C.DRAFTING, enabled=True, expires_at=datetime.datetime.now() - datetime.timedelta(days=1))
        self.assertFalse(service.check_entitlement(self.firm['A'], C.DRAFTING).allowed)
        override(self.firm['A'], C.DRAFTING, enabled=True, expires_at=None)
        self.assertTrue(service.check_entitlement(self.firm['A'], C.DRAFTING).allowed)


@override_settings(TENANCY_MODE='firm')
class SeatTests(_Firms, TestCase):
    def setUp(self):
        self.build()
        on_plan(self.firm['A'], 'TRIAL', status='TRIALING')              # 3 seats; the admin holds one
        from core.models import Role
        self.role = Role.objects.create(name='Advocate', firm_id=self.firm['A'].id)

    def invite(self, email):
        with self.captureOnCommitCallbacks(execute=True):
            return json_post(self.client, '/api/firm/invitations', {'email': email, 'roleIds': [self.role.id]},
                             self.admin['A'])

    def test_pending_invitations_hold_seats_and_a_withdrawn_one_frees_it(self):
        self.assertEqual(self.invite('a@x.test').status_code, 201)
        self.assertEqual(self.invite('b@x.test').status_code, 201)
        r = self.invite('c@x.test')
        self.assertEqual((r.status_code, r.json()['code']), (403, 'ENTITLEMENT_LIMIT_REACHED'))
        self.assertEqual(self.invite('a@x.test').status_code // 100, 4)          # re-inviting can't double count
        from firms.models import FirmInvitation
        inv = FirmInvitation.objects.get(email='a@x.test')
        json_post(self.client, f'/api/firm/invitations/{inv.id}/revoke', {}, self.admin['A'])
        self.assertEqual(self.invite('c@x.test').status_code, 201)
        self.assertEqual(service.seats_used(self.firm['A'].id), 3)

    def test_reactivating_a_member_needs_a_free_seat(self):
        m1 = make_firm_member(self.firm['A'])
        make_firm_member(self.firm['A'])
        FirmMembership.objects.filter(advocate_id=m1.id).update(status=FirmMembership.SUSPENDED)
        self.invite('fill@x.test')                                               # seats: admin + m2 + invite = 3
        r = json_post(self.client, f'/api/firm/members/{m1.id}/reactivate', {}, self.admin['A'])
        self.assertEqual(r.json()['code'], 'ENTITLEMENT_LIMIT_REACHED')
        self.assertEqual(FirmMembership.objects.get(advocate_id=m1.id).status, FirmMembership.SUSPENDED)

    def test_client_portal_logins_dont_use_staff_seats(self):
        FirmMembership.objects.create(firm=self.firm['A'], advocate_id=make_firm_member(self.firm['B']).id + 999,
                                      kind=FirmMembership.CLIENT, status=FirmMembership.ACTIVE)
        self.assertEqual(service.seats_used(self.firm['A'].id), 1)


@override_settings(TENANCY_MODE='firm')
class MeteringTests(_Firms, TestCase):
    def setUp(self):
        self.build()
        on_plan(self.firm['A'], 'TRIAL', status='TRIALING')
        override(self.firm['A'], C.AI_REQUESTS, limit=3)

    def test_a_request_key_is_never_free_reuse(self):
        r = service.consume(self.firm['A'], C.AI_REQUESTS, request_key='req-1', advocate_id=self.admin['A'].id)
        with self.assertRaises(service.SubscriptionError) as e:                      # still running
            service.consume(self.firm['A'], C.AI_REQUESTS, request_key='req-1')
        self.assertEqual((e.exception.status, e.exception.code), (409, 'REQUEST_IN_PROGRESS'))
        r.succeed()
        with self.assertRaises(service.SubscriptionError) as e:                      # done: no free replays
            service.consume(self.firm['A'], C.AI_REQUESTS, request_key='req-1')
        self.assertEqual(e.exception.code, 'IDEMPOTENCY_KEY_USED')
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS), 1)

    def test_a_failed_request_is_released_and_its_retry_counts_again(self):
        r = service.consume(self.firm['A'], C.AI_REQUESTS, request_key='k')
        self.assertTrue(r.fail())
        self.assertFalse(r.fail())                                                   # settled once
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS), 0)
        r2 = service.consume(self.firm['A'], C.AI_REQUESTS, request_key='k')       # the retry
        r2.succeed()
        req = MeteredRequest.objects.get(request_key='k')
        self.assertEqual((req.state, req.attempts), ('SUCCEEDED', 2))
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS), 1)
        # Events are never edited: +1, -1, +1.
        self.assertEqual(list(UsageEvent.objects.filter(firm_id=self.firm['A'].id).order_by('id')
                              .values_list('quantity', flat=True)), [1, -1, 1])

    def test_cancelled_stays_counted_and_stale_reservations_are_released(self):
        service.consume(self.firm['A'], C.AI_REQUESTS).cancel()
        stale = service.consume(self.firm['A'], C.AI_REQUESTS)
        MeteredRequest.objects.filter(id=stale.id).update(
            updated_at=datetime.datetime.now() - datetime.timedelta(hours=3))
        self.assertEqual(service.release_stale(), 1)
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS), 1)

    def test_a_failure_after_the_month_turned_releases_the_old_month(self):
        r = service.consume(self.firm['A'], C.AI_REQUESTS)
        later = datetime.datetime.now() + datetime.timedelta(days=40)
        with mock.patch('subscriptions.service.now', return_value=later):
            service.consume(self.firm['A'], C.AI_REQUESTS).succeed()
            r.fail()
            self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS, at=later), 1)
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS), 0)

    def test_limit_then_correction(self):
        for i in range(3):
            service.consume(self.firm['A'], C.AI_REQUESTS, request_key=f'r{i}').succeed()
        with self.assertRaises(service.EntitlementDenied) as e:
            service.consume(self.firm['A'], C.AI_REQUESTS, request_key='r3')
        self.assertEqual(e.exception.decision.reason, 'LIMIT_REACHED')
        self.assertFalse(MeteredRequest.objects.filter(request_key='r3').exists())  # a refusal records nothing
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS), 3)
        service.correct(self.firm['A'], C.AI_REQUESTS, -1, actor='ops@test', reason='provider outage')
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS), 2)
        self.assertTrue(PlanChangeAudit.objects.filter(action='USAGE_CORRECTED').exists())

    def test_windows_are_monthly(self):
        service.consume(self.firm['A'], C.AI_REQUESTS, request_key='jan')
        with mock.patch('subscriptions.service.now', return_value=datetime.datetime.now() + datetime.timedelta(days=40)):
            self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS,
                                           at=datetime.datetime.now() + datetime.timedelta(days=40)), 0)

    def test_reconcile_rebuilds_counters_from_events(self):
        service.consume(self.firm['A'], C.AI_REQUESTS, request_key='x1')
        FirmUsage.objects.filter(key=C.AI_REQUESTS).update(used=99)
        out = io.StringIO()
        call_command('reconcile_usage', stdout=out)                                  # report first
        self.assertIn('counter 99, events 1', out.getvalue())
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS), 99)
        call_command('reconcile_usage', '--apply', stdout=io.StringIO())
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS), 1)

    def test_lisa_needs_the_feature_and_counts_requests(self):
        on_plan(self.firm['B'], 'BASIC')
        override(self.firm['B'], C.ASSISTANT, enabled=False)
        r = json_post(self.client, '/api/assistant/chat', {'message': 'hello'}, self.admin['B'])
        self.assertEqual((r.status_code, r.json()['code']), (403, 'ENTITLEMENT_FEATURE_NOT_IN_PLAN'))
        ok = ['data: {"type": "text", "text": "Hi"}\n\n', 'data: {"type": "done"}\n\n']
        with mock.patch('assistant.views.stream_answer', side_effect=lambda *a, **k: iter(ok)):
            r = json_post(self.client, '/api/assistant/chat', {'message': 'hello'}, self.admin['A'],
                          HTTP_IDEMPOTENCY_KEY='lisa-1')
            b''.join(r.streaming_content)
            again = json_post(self.client, '/api/assistant/chat', {'message': 'hello'}, self.admin['A'],
                              HTTP_IDEMPOTENCY_KEY='lisa-1')
            # The same key from someone else in the firm is their own request.
            other = make_firm_member(self.firm['A'])
            b''.join(json_post(self.client, '/api/assistant/chat', {'message': 'hi'}, other,
                               HTTP_IDEMPOTENCY_KEY='lisa-1').streaming_content)
        self.assertEqual((again.status_code, again.json()['code']), (409, 'IDEMPOTENCY_KEY_USED'))
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS), 2)
        self.assertEqual(set(MeteredRequest.objects.values_list('state', flat=True)), {'SUCCEEDED'})

    def test_lisa_gives_back_a_request_the_provider_failed(self):
        err = ['data: {"type": "error", "message": "The assistant is unavailable."}\n\n']
        with mock.patch('assistant.views.stream_answer', side_effect=lambda *a, **k: iter(err)):
            b''.join(json_post(self.client, '/api/assistant/chat', {'message': 'hello'},
                               self.admin['A']).streaming_content)
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS), 0)
        self.assertEqual(MeteredRequest.objects.get().state, 'FAILED')

        def boom(*a, **k):
            yield 'data: {"type": "text", "text": "par"}\n\n'
            raise TimeoutError('provider timed out')
        with mock.patch('assistant.views.stream_answer', side_effect=boom):
            r = json_post(self.client, '/api/assistant/chat', {'message': 'hello'}, self.admin['A'])
            with self.assertRaises(TimeoutError):
                b''.join(r.streaming_content)
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS), 0)

    def test_lisa_counts_a_request_the_browser_walked_away_from(self):
        from assistant.views import _metered
        ok = ['data: {"type": "text", "text": "a"}\n\n', 'data: {"type": "text", "text": "b"}\n\n']
        stream = _metered(iter(ok), self.admin['A'].id, service.meter(self.admin['A'], C.AI_REQUESTS))
        next(stream)
        stream.close()                                     # what the server does when the browser goes away
        self.assertEqual(MeteredRequest.objects.get().state, 'CANCELLED')
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS), 1)

    def test_drafting_is_not_in_basic(self):
        on_plan(self.firm['B'], 'BASIC')
        from drafting.models import DraftSession, Template
        s = DraftSession.objects.create(template=Template.objects.create(name='T', created_by_id=self.admin['B'].id),
                                        created_by_id=self.admin['B'].id, facts={}, status='ready')
        with mock.patch('drafting.views._dispatch') as dispatch:
            r = json_post(self.client, f'/api/drafting/draft-sessions/{s.id}/regenerate/', {}, self.admin['B'])
        self.assertEqual(r.json()['code'], 'ENTITLEMENT_FEATURE_NOT_IN_PLAN')
        dispatch.assert_not_called()
        s.refresh_from_db()
        self.assertEqual(s.status, 'ready')                  # the claim was given back

    def test_drafting_setup_needs_the_feature_and_a_failed_action_is_released(self):
        on_plan(self.firm['B'], 'BASIC')
        r = json_post(self.client, '/api/drafting/playbooks/', {'name': 'P', 'category': 'x'}, self.admin['B'])
        self.assertEqual(r.json()['code'], 'ENTITLEMENT_FEATURE_NOT_IN_PLAN')
        from drafting.models import DraftSession, Template
        s = DraftSession.objects.create(template=Template.objects.create(name='T', created_by_id=self.admin['A'].id),
                                        created_by_id=self.admin['A'].id, facts={}, status='ready')
        from drafting import views as dv
        reservation = dv._drafting_op(type('R', (), {'user': self.admin['A'], 'headers': {}})(), 'draft.refine')
        with self.assertRaises(RuntimeError):
            dv._settled(reservation, lambda: (_ for _ in ()).throw(RuntimeError('model down')))
        from rest_framework.response import Response
        dv._settled(dv._drafting_op(type('R', (), {'user': self.admin['A'], 'headers': {}})(), 'draft.refine'),
                    lambda: Response({'detail': 'bad'}, status=400))
        self.assertEqual(service.usage(self.firm['A'].id, C.DRAFTING_OPS), 0)
        dv._settled(dv._drafting_op(type('R', (), {'user': self.admin['A'], 'headers': {}})(), 'draft.refine'),
                    lambda: Response({'ok': True}))
        self.assertEqual(service.usage(self.firm['A'].id, C.DRAFTING_OPS), 1)
        self.assertTrue(s.id)

    def test_draft_generation_settles_its_reservation(self):
        from drafting import tasks
        from drafting.models import DraftSession, Template
        s = DraftSession.objects.create(template=Template.objects.create(name='T', created_by_id=self.admin['A'].id),
                                        created_by_id=self.admin['A'].id, facts={}, status='failed')
        r = service.consume(self.firm['A'], C.DRAFTING_OPS)
        r.attach(f'draft:{s.id}')
        task = type('T', (), {'request': type('Q', (), {'retries': 0})(), 'max_retries': 3})()
        with override_settings(CELERY_TASK_ALWAYS_EAGER=True):
            tasks._settle_session('draft', s.id, task)
        self.assertEqual(MeteredRequest.objects.get(id=r.id).state, 'FAILED')
        r2 = service.consume(self.firm['A'], C.DRAFTING_OPS)
        r2.attach(f'draft:{s.id}')
        DraftSession.objects.filter(id=s.id).update(status='ready')
        tasks._settle_session('draft', s.id, task)
        self.assertEqual(MeteredRequest.objects.get(id=r2.id).state, 'SUCCEEDED')
        self.assertEqual(service.usage(self.firm['A'].id, C.DRAFTING_OPS), 1)

    def test_document_summaries_are_gated_and_counted_once_per_run(self):
        from documents import summarizer
        from documents.models import DocumentSummary
        now = datetime.datetime.now()
        doc = Document.objects.create(document_name='d', stored_name='d.txt', file_path='x', file_size=1,
                                      version=1, advocate_id=self.admin['A'].id, status='ACTIVE',
                                      upload_date=now, updated_at=now, download_count=0)
        row = DocumentSummary.objects.create(document_id=doc.id, status='PENDING')
        with mock.patch.object(summarizer, 'extract_text', return_value='text'), \
                mock.patch.object(summarizer, 'complete_text', return_value='{"summary": "S"}'):
            summarizer.summarize(row)
            self.assertEqual(row.status, 'READY')
            summarizer.summarize(row)                                               # a deliberate re-summary
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_SUMMARIES), 2)
        with mock.patch.object(summarizer, 'extract_text', return_value='text'), \
                mock.patch.object(summarizer, 'complete_text', side_effect=ValueError('bad json')):
            summarizer.summarize(row)
        self.assertEqual((row.status, service.usage(self.firm['A'].id, C.AI_SUMMARIES)), ('FAILED', 2))
        override(self.firm['A'], C.DOC_SUMMARY, enabled=False)                      # e.g. regenerate / cron
        with mock.patch.object(summarizer, 'extract_text', return_value='text'), \
                mock.patch.object(summarizer, 'complete_text') as model:
            summarizer.summarize(row)
        model.assert_not_called()
        self.assertIn('not included', row.error)

    def test_ai_tokens_come_from_the_meter_never_invented(self):
        from metering.models import LLMUsage
        LLMUsage.objects.create(advocate_id=self.admin['A'].id, firm_id=self.firm['A'].id, feature='assistant',
                                input_tokens=10, output_tokens=5, total_tokens=15, estimated=False)
        LLMUsage.objects.create(advocate_id=self.admin['B'].id, firm_id=self.firm['B'].id, feature='assistant',
                                total_tokens=1000)
        ai = service.summary(self.firm['A'])['ai']
        self.assertEqual((ai['totalTokens'], ai['calls'], ai['cost']), (15, 1, None))


@override_settings(TENANCY_MODE='firm')
class ClientPortalTests(_Firms, TestCase):
    def test_new_logins_need_the_feature_existing_ones_keep_working(self):
        on_plan(self.firm['A'], 'PROFESSIONAL')
        client = make_client(self.admin['A'], name='Meena', email='meena@c.test')
        r = json_post(self.client, f'/api/clients/{client.id}/logins', {'email': 'meena@c.test'}, self.admin['A'])
        self.assertEqual(r.status_code, 201, r.content)
        on_plan(self.firm['A'], 'TRIAL', status='TRIALING')                 # trial: no client portal
        other = make_client(self.admin['A'], name='Ravi', email='ravi@c.test')
        r2 = json_post(self.client, f'/api/clients/{other.id}/logins', {'email': 'ravi@c.test'}, self.admin['A'])
        self.assertEqual(r2.json()['code'], 'ENTITLEMENT_FEATURE_NOT_IN_PLAN')
        self.assertTrue(FirmMembership.objects.filter(kind='CLIENT', firm=self.firm['A'], status='ACTIVE').exists())

    def setUp(self):
        self.build()


@override_settings(TENANCY_MODE='firm')
class ApiTests(_Firms, TestCase):
    def setUp(self):
        self.build()
        C.ensure_plans()
        on_plan(self.firm['A'], 'TRIAL', status='TRIALING')
        on_plan(self.firm['B'], 'BASIC')

    def op(self, role):
        from core.passwords import hash_password
        op, _ = PlatformOperator.objects.get_or_create(email=f'{role.lower()}@ops.test', defaults={
            'role': role, 'password_hash': hash_password('x' * 16)})
        return {'HTTP_AUTHORIZATION': f'Bearer {issue_token(op)}'}

    def test_operators_read_and_only_owners_change(self):
        Plan.objects.filter(code='PROFESSIONAL').update(state=Plan.PUBLISHED)
        url = f'/api/platform/firms/{self.firm["A"].public_id}/subscription'
        for role in ('OWNER', 'SUPPORT', 'READONLY'):
            self.assertEqual(self.client.get(url, **self.op(role)).status_code, 200, role)
        body = {'action': 'change_plan', 'planCode': 'PROFESSIONAL', 'reason': 'customer upgrade'}
        for role in ('SUPPORT', 'READONLY'):
            self.assertEqual(json_post(self.client, url, body, **self.op(role)).status_code, 403, role)
        owner = self.op('OWNER')
        self.assertEqual(json_post(self.client, url, {**body, 'reason': ''}, **owner).status_code, 400)
        r = json_post(self.client, url, body, **owner)
        self.assertEqual((r.status_code, r.json()['plan']['code'], r.json()['status']), (200, 'PROFESSIONAL', 'ACTIVE'))
        self.firm['A'].refresh_from_db()
        self.assertEqual(self.firm['A'].plan_code, 'PROFESSIONAL')
        self.assertEqual(r.json()['history'][0]['actor'], 'owner@ops.test')
        r = json_post(self.client, url, {'action': 'set_override', 'key': C.CASES, 'limit': 9, 'reason': 'pilot'}, **owner)
        self.assertEqual(next(e for e in r.json()['entitlements'] if e['key'] == C.CASES)['limit'], 9)
        self.assertEqual(self.client.get('/api/platform/plans', **owner).status_code, 200)
        # The firm's plan field can't be edited around the subscription.
        r = self.client.patch(f'/api/platform/firms/{self.firm["A"].public_id}', data='{"planCode":"X"}',
                              content_type='application/json', **owner)
        self.assertEqual(r.json()['code'], 'USE_SUBSCRIPTION')

    def test_a_firm_sees_only_its_own_subscription_and_cannot_change_it(self):
        a = self.client.get('/api/firm/subscription', **auth(self.admin['A'])).json()
        b = self.client.get('/api/firm/subscription', **auth(self.admin['B'])).json()
        self.assertEqual((a['plan']['code'], b['plan']['code']), ('TRIAL', 'BASIC'))
        self.assertEqual(json_post(self.client, '/api/firm/subscription', {'planCode': 'ENTERPRISE'},
                                   self.admin['A']).status_code, 405)
        # A firm token is refused on the operator API.
        self.assertEqual(self.client.get(f'/api/platform/firms/{self.firm["B"].public_id}/subscription',
                                         **auth(self.admin['A'])).status_code, 401)

    def test_provisioning_never_silently_picks_a_plan(self):
        from firms.models import Firm
        from firms.provisioning import ProvisioningError, provision_firm
        from platform_admin.tests import make_templates
        make_templates()
        Plan.objects.filter(code='BASIC').update(state=Plan.DRAFT)
        f1, *_ = provision_firm(name='New One', slug='new-one', admin_email='n1@x.test')
        s1 = FirmSubscription.objects.get(firm=f1)
        self.assertEqual((s1.plan_id, s1.status), (None, 'PENDING'))                # no silent trial
        for code, err in (('BASIC', 'PLAN_NOT_PUBLISHED'), ('LEGACY', 'PLAN_NOT_ASSIGNABLE'), ('NOPE', 'NO_PLAN')):
            with self.assertRaises(ProvisioningError) as e:
                provision_firm(name='Draft', slug=f'd-{code.lower()}', admin_email=f'{code}@x.test', plan_code=code)
            self.assertEqual(e.exception.code, err)
            self.assertFalse(Firm.objects.filter(slug=f'd-{code.lower()}').exists())  # nothing half-made
        with self.assertRaises(ProvisioningError):                                   # test firms need the setting
            provision_firm(name='Test Firm', slug='t-off', admin_email='t@x.test', plan_code='BASIC', test_firm=True)
        with override_settings(SUBSCRIPTION_TEST_PLANS=True):
            f3, *_ = provision_firm(name='Test Firm', slug='t-on', admin_email='t@x.test', plan_code='BASIC', test_firm=True)
        self.assertEqual(FirmSubscription.objects.get(firm=f3).plan.code, 'BASIC')
        Plan.objects.filter(code='BASIC').update(state=Plan.PUBLISHED)
        f4, *_ = provision_firm(name='New Two', slug='new-two', admin_email='n2@x.test', plan_code='basic')
        s4 = FirmSubscription.objects.get(firm=f4)
        self.assertEqual((s4.plan.code, s4.status, s4.test_firm), ('BASIC', 'ACTIVE', False))

    def test_plan_approval_is_owner_only_audited_and_has_no_prices(self):
        from platform_admin.models import PlatformAudit
        Plan.objects.filter(code='PROFESSIONAL').update(state=Plan.DRAFT)
        url = '/api/platform/plans/PROFESSIONAL'
        for role in ('SUPPORT', 'READONLY'):
            self.assertEqual(json_post(self.client, url, {'action': 'approve', 'reason': 'ok'},
                                       **self.op(role)).status_code, 403, role)
        owner = self.op('OWNER')
        self.assertEqual(json_post(self.client, url, {'action': 'publish', 'reason': 'skip approval'},
                                   **owner).json()['code'], 'BAD_PLAN_STATE')
        self.assertEqual(json_post(self.client, url, {'action': 'edit', 'monthlyPrice': '999', 'reason': 'x y'},
                                   **owner).json()['code'], 'NO_PRICES')
        r = json_post(self.client, url, {'action': 'edit', 'reason': 'board figures',
                                         'entitlements': [{'key': C.CASES, 'enabled': True, 'limit': 1000}]}, **owner)
        self.assertEqual(next(e['limit'] for e in r.json()['entitlements'] if e['key'] == C.CASES), 1000)
        r = json_post(self.client, url, {'action': 'approve', 'reason': 'Board minute 12'}, **owner)
        self.assertEqual((r.json()['state'], r.json()['approvedBy']), ('APPROVED', 'owner@ops.test'))
        self.assertEqual(json_post(self.client, url, {'action': 'edit', 'name': 'Pro', 'reason': 'late change'},
                                   **owner).json()['code'], 'BAD_PLAN_STATE')          # approved terms are fixed
        r = json_post(self.client, url, {'action': 'publish', 'reason': 'launch'}, **owner)
        self.assertEqual((r.json()['state'], r.json()['assignable']), ('PUBLISHED', 'yes'))
        self.assertEqual(json_post(self.client, '/api/platform/plans/LEGACY', {'action': 'retire', 'reason': 'x y'},
                                   **owner).json()['code'], 'SYSTEM_PLAN')
        self.assertEqual(set(PlatformAudit.objects.filter(action__startswith='PLAN_', success=True)
                             .values_list('action', flat=True)), {'PLAN_EDIT', 'PLAN_APPROVE', 'PLAN_PUBLISH'})

    def test_a_new_revision_never_moves_existing_firms(self):
        on_plan(self.firm['A'], 'PROFESSIONAL')                         # published (see on_plan)
        owner = self.op('OWNER')
        r = json_post(self.client, '/api/platform/plans/PROFESSIONAL', {'action': 'revise', 'reason': 'new terms'},
                      **owner)
        new = r.json()['code']
        self.assertEqual((new, r.json()['state'], r.json()['revision']), ('PROFESSIONAL_R2', 'DRAFT', 2))
        json_post(self.client, f'/api/platform/plans/{new}', {'action': 'approve', 'reason': 'ok ok'}, **owner)
        r = json_post(self.client, f'/api/platform/plans/{new}', {'action': 'publish', 'reason': 'go live'}, **owner)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Plan.objects.get(code='PROFESSIONAL').state, 'RETIRED')
        self.assertEqual(FirmSubscription.objects.get(firm=self.firm['A']).plan.code, 'PROFESSIONAL')
        self.assertLess(json_post(self.client, '/api/cases/create', {
            'caseNumber': 'R/1', 'caseTitle': 't', 'caseType': 'OS', 'courtLevel': 'District', 'status': 'Active',
            'clientId': make_client(self.admin['A']).id, 'matterType': 'litigation'}, self.admin['A']).status_code, 300)
        url = f'/api/platform/firms/{self.firm["B"].public_id}/subscription'
        r = json_post(self.client, url, {'action': 'change_plan', 'planCode': 'PROFESSIONAL', 'reason': 'x y'}, **owner)
        self.assertEqual(r.json()['code'], 'PLAN_RETIRED')

    def test_test_firm_designation_needs_the_setting(self):
        url = f'/api/platform/firms/{self.firm["A"].public_id}/subscription'
        owner = self.op('OWNER')
        r = json_post(self.client, url, {'action': 'mark_test_firm', 'reason': 'synthetic'}, **owner)
        self.assertEqual(r.json()['code'], 'TEST_PLANS_DISABLED')
        with override_settings(SUBSCRIPTION_TEST_PLANS=True):
            r = json_post(self.client, url, {'action': 'mark_test_firm', 'reason': 'synthetic'}, **owner)
            self.assertTrue(r.json()['testFirm'])
            self.assertEqual(json_post(self.client, url, {'action': 'mark_test_firm', 'reason': 'x y'},
                                       **self.op('SUPPORT')).status_code, 403)

    def test_another_firms_ids_reach_nothing(self):
        import uuid
        owner = self.op('OWNER')
        r = json_post(self.client, f'/api/platform/firms/{uuid.uuid4()}/subscription',
                      {'action': 'change_plan', 'planCode': 'BASIC', 'reason': 'x y'}, **owner)
        self.assertEqual(r.status_code, 404)
        # A firm user can't name another firm: the firm endpoint takes no id at all.
        b = self.client.get(f'/api/firm/subscription?firm={self.firm["A"].public_id}', **auth(self.admin['B']))
        self.assertEqual(b.json()['plan']['code'], 'BASIC')



@override_settings(TENANCY_MODE='firm')
class InvoiceIdempotencyTests(_Firms, TestCase):
    def test_a_retried_invoice_is_issued_once(self):
        self.build()
        case = make_case(self.admin['A'])
        body = {'caseId': case.id, 'particulars': [{'description': 'Fee', 'amount': '100'}]}
        r1 = json_post(self.client, '/api/invoices/create', body, self.admin['A'], HTTP_IDEMPOTENCY_KEY='inv-1')
        r2 = json_post(self.client, '/api/invoices/create', body, self.admin['A'], HTTP_IDEMPOTENCY_KEY='inv-1')
        self.assertEqual((r1.status_code, r2.status_code), (201, 200))
        self.assertEqual(r1.json()['id'], r2.json()['id'])
        r3 = json_post(self.client, '/api/invoices/create', {**body, 'particulars': [{'description': 'x', 'amount': '5'}]},
                       self.admin['A'], HTTP_IDEMPOTENCY_KEY='inv-1')
        self.assertEqual(r3.json()['code'], 'IDEMPOTENCY_MISMATCH')
        from core.models import Invoice
        self.assertEqual(Invoice.objects.filter(case_id=case.id).count(), 1)


@override_settings(TENANCY_MODE='firm')
class ConcurrencyTests(_Firms, TransactionTestCase):
    def setUp(self):
        self.build()
        self.dir = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.dir, 'documents'))
        self.addCleanup(shutil.rmtree, self.dir, True)

    def _parallel(self, fn, n):
        barrier, out = threading.Barrier(n), []

        def run(i):
            try:
                barrier.wait()
                out.append(fn(i))
            finally:
                connections.close_all()
        ts = [threading.Thread(target=run, args=(i,)) for i in range(n)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        return out

    def test_simultaneous_invitations_never_exceed_the_seats(self):
        on_plan(self.firm['A'], 'TRIAL', status='TRIALING')            # 3 seats, admin holds 1
        from core.models import Role
        role = Role.objects.create(name='Advocate', firm_id=self.firm['A'].id)
        with mock.patch('firms.invitations._send'):
            rs = self._parallel(lambda i: json_post(self.client, '/api/firm/invitations',
                                                    {'email': f'p{i}@x.test', 'roleIds': [role.id]}, self.admin['A']), 6)
        self.assertEqual(sorted(r.status_code for r in rs), [201, 201, 403, 403, 403, 403])
        self.assertEqual(service.seats_used(self.firm['A'].id), 3)

    def test_simultaneous_uploads_near_the_storage_quota(self):
        on_plan(self.firm['A'], 'BASIC')
        override(self.firm['A'], C.STORAGE, limit=3000)
        payload = b'%PDF-1.4 ' + b'x' * 991                          # 1000 bytes each
        with override_settings(DOCUMENT_UPLOAD_DIR=self.dir, SUMMARY_ENABLED=False):
            rs = self._parallel(lambda i: self.client.post('/api/documents/upload', {
                'file': SimpleUploadedFile(f'd{i}.pdf', payload, content_type='application/pdf')},
                **auth(self.admin['A'])), 6)
        self.assertEqual(sorted(r.status_code for r in rs)[:3], [200, 200, 200] if rs[0].status_code == 200 else
                         sorted(r.status_code for r in rs)[:3])
        ok = [r for r in rs if r.status_code < 300]
        self.assertEqual(len(ok), 3)
        self.assertEqual(Document.objects.filter(firm_id=self.firm['A'].id).count(), 3)
        self.assertEqual(len(os.listdir(os.path.join(self.dir, 'documents'))), 3)   # refused files removed
        self.assertTrue(all(r.json()['code'] == 'ENTITLEMENT_LIMIT_REACHED' for r in rs if r.status_code == 403))

    def test_simultaneous_ai_requests_never_exceed_the_allowance(self):
        on_plan(self.firm['A'], 'BASIC')
        override(self.firm['A'], C.AI_REQUESTS, limit=3)

        def go(i):
            try:
                service.consume(self.firm['A'], C.AI_REQUESTS, request_key=f'p{i}').succeed()
                return 'ok'
            except service.EntitlementDenied:
                return 'denied'
        self.assertEqual(sorted(self._parallel(go, 8)), ['denied'] * 5 + ['ok'] * 3)
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS), 3)

    def test_the_same_key_sent_twice_at_once_counts_once(self):
        on_plan(self.firm['A'], 'BASIC')

        def go(i):
            try:
                service.consume(self.firm['A'], C.AI_REQUESTS, request_key='same')
                return 'ok'
            except service.SubscriptionError as exc:
                return exc.code
        self.assertEqual(sorted(self._parallel(go, 5)), ['REQUEST_IN_PROGRESS'] * 4 + ['ok'])
        self.assertEqual(service.usage(self.firm['A'].id, C.AI_REQUESTS), 1)

    def test_simultaneous_cases_at_the_limit(self):
        on_plan(self.firm['A'], 'BASIC')
        override(self.firm['A'], C.CASES, limit=2)
        clients = [make_client(self.admin['A']).id for _ in range(5)]
        rs = self._parallel(lambda i: json_post(self.client, '/api/cases/create', {
            'caseNumber': f'C/{i}', 'caseTitle': 't', 'caseType': 'OS', 'courtLevel': 'District',
            'status': 'Active', 'clientId': clients[i], 'matterType': 'litigation'}, self.admin['A']), 5)
        self.assertEqual(sum(r.status_code < 300 for r in rs), 2)
        self.assertEqual(Case.objects.filter(firm_id=self.firm['A'].id, deleted=False).count(), 2)

