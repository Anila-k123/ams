from django.db import migrations
from django.db.models import F


def backfill_assignee(apps, schema_editor):
    """Existing tasks were self-owned, so the assignee is the creator."""
    CaseTask = apps.get_model('workspace', 'CaseTask')
    CaseTask.objects.filter(assigned_to_id__isnull=True).update(
        assigned_to_id=F('advocate_id'))


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('workspace', '0005_casetask_assigned_by_id_casetask_assigned_to_id'),
    ]

    operations = [
        migrations.RunPython(backfill_assignee, noop),
    ]
