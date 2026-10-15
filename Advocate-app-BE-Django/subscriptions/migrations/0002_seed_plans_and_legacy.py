"""Seed the plans and give every firm that already exists the LEGACY plan.

Legacy policy: firms that used AMS before subscriptions keep everything they
had - all features, no limits - until an operator deliberately changes their
plan. Nothing is suspended or switched off. Only rows are added (plans, their
entitlements, one subscription + one history row per existing firm); no firm,
role, invoice or other record is changed. Reverse: removes only those rows.
"""
import datetime

from django.db import migrations


def forwards(apps, schema_editor):
    from subscriptions.catalogue import LEGACY, ensure_plans
    Plan = apps.get_model('subscriptions', 'Plan')
    PlanEntitlement = apps.get_model('subscriptions', 'PlanEntitlement')
    FirmSubscription = apps.get_model('subscriptions', 'FirmSubscription')
    PlanChangeAudit = apps.get_model('subscriptions', 'PlanChangeAudit')
    Firm = apps.get_model('firms', 'Firm')
    ensure_plans(Plan=Plan, PlanEntitlement=PlanEntitlement)
    legacy = Plan.objects.get(code=LEGACY)
    now = datetime.datetime.now()
    for firm in Firm.objects.all():
        if FirmSubscription.objects.filter(firm_id=firm.id).exists():
            continue
        FirmSubscription.objects.create(firm_id=firm.id, plan=legacy, status='ACTIVE', current_period_start=now)
        PlanChangeAudit.objects.create(firm_id=firm.id, action='LEGACY_ASSIGNED', to_plan=LEGACY, to_status='ACTIVE',
                                       actor='SYSTEM (migration)', at=now,
                                       reason='Existing firm: Legacy policy, nothing changes',
                                       detail={'previousPlanCode': firm.plan_code})


def backwards(apps, schema_editor):
    FirmSubscription = apps.get_model('subscriptions', 'FirmSubscription')
    PlanChangeAudit = apps.get_model('subscriptions', 'PlanChangeAudit')
    PlanChangeAudit.objects.filter(action='LEGACY_ASSIGNED', actor='SYSTEM (migration)').delete()
    FirmSubscription.objects.filter(plan__code='LEGACY').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('subscriptions', '0001_initial'),
        ('firms', '0006_invitation_delivery'),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
