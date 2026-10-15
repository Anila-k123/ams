"""Subscription APIs.

Platform operators (audience ams-platform):
  GET  /api/platform/plans                                  every plan with its state (firm.read)
  POST /api/platform/plans/<code>                           {action: edit|approve|publish|retire|revise, reason}
                                                            (plan.publish - platform OWNER only)
  GET  /api/platform/firms/<publicId>/subscription          plan, status, usage, overrides, history
  POST /api/platform/firms/<publicId>/subscription          {action, ...}  (subscription.manage)
Firm (its own firm only, never another's):
  GET  /api/firm/subscription                               SETTINGS_EDIT - read-only

A firm administrator can see the plan and usage but can't change them: every
change is an operator action, audited twice (platform_audit + subscription_history).
"""
import datetime

from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from core import tenant
from core.permissions import RequirePermission
from firms.models import Firm
from platform_admin.auth import PlatformJWTAuthentication, RequireOperator, audit

from . import catalogue as C
from . import service
from .models import EntitlementOverride, Plan, PlanChangeAudit


def _plan_map(p):
    return {'code': p.code, 'name': p.name, 'description': p.description, 'isPublic': p.state == Plan.PUBLISHED,
            'state': p.state, 'family': p.family or p.code, 'revision': p.revision,
            'approvedBy': p.approved_by, 'approvedAt': p.approved_at, 'approvalNote': p.approval_note,
            'publishedBy': p.published_by, 'publishedAt': p.published_at,
            'retiredBy': p.retired_by, 'retiredAt': p.retired_at,
            'subscribers': p.subscriptions.count(),
            # May an operator put a firm on it now? 'yes' (published), 'test' (draft / approved:
            # designated test firms only, where enabled), 'no'.
            'assignable': ('yes' if p.state == Plan.PUBLISHED else
                           'test' if p.state in (Plan.DRAFT, Plan.APPROVED) and service.test_plans_enabled() else 'no'),
            'isActive': p.is_active, 'trialDays': p.trial_days, 'currency': p.currency,
            'monthlyPrice': str(p.monthly_price) if p.monthly_price is not None else None,
            'entitlements': [{'key': e.key, 'label': C.LABELS.get(e.key, e.key), 'enabled': e.enabled,
                              'limit': e.limit} for e in p.entitlements.order_by('key')]}


def _history(firm_id, limit=50):
    return [{'id': h.id, 'action': h.action, 'fromPlan': h.from_plan, 'toPlan': h.to_plan,
             'fromStatus': h.from_status, 'toStatus': h.to_status, 'actor': h.actor, 'reason': h.reason,
             'detail': h.detail, 'at': h.at} for h in PlanChangeAudit.objects.filter(firm_id=firm_id)[:limit]]


def _overrides(firm_id):
    return [{'key': o.key, 'label': C.LABELS.get(o.key, o.key), 'enabled': o.enabled, 'limit': o.limit,
             'unlimited': o.unlimited, 'reason': o.reason, 'expiresAt': o.expires_at, 'createdBy': o.created_by,
             'createdAt': o.created_at, 'active': o.expires_at is None or o.expires_at > service.now()}
            for o in EntitlementOverride.objects.filter(firm_id=firm_id).order_by('key')]


def _expiry(value):
    """An override's expiry: a date-time, or a plain date meaning the end of that day."""
    if not value:
        return None
    dt = parse_datetime(str(value))
    if dt is None:
        day = parse_date(str(value))
        if day is None:
            raise ValueError('bad expiry')
        dt = datetime.datetime.combine(day, datetime.time(23, 59, 59))
    return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt


class _Platform(APIView):
    authentication_classes = [PlatformJWTAuthentication]


class PlansView(_Platform):
    permission_classes = [RequireOperator('firm.read')]

    def get(self, request):
        C.ensure_plans()
        return Response([_plan_map(p) for p in Plan.objects.prefetch_related('entitlements').all()])


class SubscriptionPolicyView(_Platform):
    """What the console needs to know about this installation."""
    permission_classes = [RequireOperator('firm.read')]

    def get(self, request):
        return Response({'testPlansEnabled': service.test_plans_enabled()})


class PlanView(_Platform):
    """Review / approve / publish / retire / revise a plan: platform OWNER only.
    No prices are accepted (commercial pricing is outside AMS for now)."""
    permission_classes = [RequireOperator('plan.publish')]

    def post(self, request, code):
        from . import plans
        d, actor = request.data, request.user.email
        action = (d.get('action') or '').strip()
        reason = (d.get('reason') or '').strip()
        if len(reason) < 3:
            return Response({'error': 'Give a reason (it is kept in the platform audit).', 'code': 'REASON_REQUIRED'},
                            status=400)
        if any(k in d for k in ('monthlyPrice', 'price', 'monthly_price')):
            return Response({'error': 'Prices are not set in AMS.', 'code': 'NO_PRICES'}, status=400)
        code = code.upper()
        detail = {'plan': code, 'reason': reason[:200]}
        try:
            if action == 'edit':
                ents = d.get('entitlements')
                if ents is not None and not isinstance(ents, list):
                    raise ValueError('entitlements')
                td = d.get('trialDays')
                plan = plans.edit_draft(code, name=d.get('name'), description=d.get('description'),
                                        trial_days=int(td) if td not in (None, '') else None, entitlements=ents)
                detail['changes'] = sorted(k for k in ('name', 'description', 'trialDays', 'entitlements') if k in d)
                if ents:
                    detail['entitlements'] = [{'key': e.get('key'), 'enabled': e.get('enabled'), 'limit': e.get('limit')}
                                              for e in ents][:20]
            elif action == 'approve':
                plan = plans.approve(code, actor=actor, note=reason)
            elif action == 'publish':
                plan, retired = plans.publish(code, actor=actor)
                detail['retiredForNewFirms'] = retired
            elif action == 'retire':
                plan = plans.retire(code, actor=actor)
            elif action == 'revise':
                plan = plans.revise(code, actor=actor)
                detail['newRevision'] = plan.code
            else:
                return Response({'error': 'Unknown action.', 'code': 'BAD_ACTION'}, status=400)
        except service.SubscriptionError as exc:
            audit(request, f'PLAN_{action.upper()}', success=False, detail={**detail, 'code': exc.code})
            return Response({'error': str(exc), 'code': exc.code}, status=exc.status)
        except (TypeError, ValueError):
            return Response({'error': 'Check the values given.', 'code': 'BAD_INPUT'}, status=400)
        audit(request, f'PLAN_{action.upper()}', detail=detail)
        return Response(_plan_map(Plan.objects.prefetch_related('entitlements').get(id=plan.id)))


class FirmSubscriptionView(_Platform):
    def get_permissions(self):
        return [RequireOperator('subscription.manage' if self.request.method == 'POST' else 'firm.read')()]

    def _firm(self, public_id):
        return Firm.objects.filter(public_id=public_id).first()

    def get(self, request, public_id):
        firm = self._firm(public_id)
        if firm is None:
            return Response({'error': 'Firm not found'}, status=404)
        return Response({**service.summary(firm), 'overrides': _overrides(firm.id), 'history': _history(firm.id),
                         'keys': [{'key': k, 'label': C.LABELS[k],
                                   'kind': 'feature' if k in C.FEATURES else ('metered' if k in C.METERED else 'stock')}
                                  for k in C.KEYS]})

    def post(self, request, public_id):
        firm = self._firm(public_id)
        if firm is None:
            return Response({'error': 'Firm not found'}, status=404)
        d, actor = request.data, request.user.email
        action = (d.get('action') or '').strip()
        reason = (d.get('reason') or '').strip()
        if len(reason) < 3:
            return Response({'error': 'Give a reason (it is kept in the subscription history).',
                             'code': 'REASON_REQUIRED'}, status=400)
        try:
            if action == 'start':
                service.start_subscription(firm, (d.get('planCode') or '').upper() or None, actor=actor, reason=reason)
            elif action == 'change_plan':
                service.change_plan(firm, (d.get('planCode') or '').upper(), actor=actor, reason=reason,
                                    status=(d.get('status') or 'ACTIVE').upper())
            elif action == 'extend_trial':
                service.extend_trial(firm, int(d.get('days') or 0), actor=actor, reason=reason)
            elif action in ('activate', 'past_due', 'suspend', 'cancel', 'expire'):
                to = {'activate': 'ACTIVE', 'past_due': 'PAST_DUE', 'suspend': 'SUSPENDED',
                      'cancel': 'CANCELLED', 'expire': 'EXPIRED'}[action]
                service.set_status(firm, to, actor=actor, reason=reason, action=action.upper())
            elif action == 'set_override':
                exp = _expiry(d.get('expiresAt'))
                lim = d.get('limit')
                service.set_override(firm, d.get('key') or '', actor=actor, reason=reason,
                                     enabled=d.get('enabled') if isinstance(d.get('enabled'), bool) else None,
                                     limit=int(lim) if lim not in (None, '') else None,
                                     unlimited=bool(d.get('unlimited')), expires_at=exp)
            elif action in ('mark_test_firm', 'clear_test_firm'):
                service.set_test_firm(firm, action == 'mark_test_firm', actor=actor, reason=reason)
            elif action == 'clear_override':
                service.clear_override(firm, d.get('key') or '', actor=actor, reason=reason)
            elif action == 'correct_usage':
                service.correct(firm, d.get('key') or '', int(d.get('quantity') or 0), actor=actor, reason=reason)
            else:
                return Response({'error': 'Unknown action.', 'code': 'BAD_ACTION'}, status=400)
        except service.SubscriptionError as exc:
            audit(request, f'SUBSCRIPTION_{action.upper()}', firm_id=firm.id, success=False,
                  detail={'code': exc.code})
            return Response({'error': str(exc), 'code': exc.code}, status=exc.status)
        except (TypeError, ValueError):
            return Response({'error': 'Check the numbers given.', 'code': 'BAD_INPUT'}, status=400)
        audit(request, f'SUBSCRIPTION_{action.upper()}', firm_id=firm.id,
              detail={'planCode': d.get('planCode'), 'key': d.get('key'), 'reason': reason[:200]})
        return self.get(request, public_id)


class MySubscriptionView(APIView):
    """The signed-in user's own firm only (resolved from the membership)."""
    permission_classes = [RequirePermission('SETTINGS_EDIT')]

    def get(self, request):
        firm = tenant.firm_of(request.user)
        if firm is None:
            return Response({'error': 'No firm', 'code': 'NO_FIRM'}, status=404)
        return Response(service.summary(firm))
