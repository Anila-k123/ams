"""Invoice requests (advocate raises, accounts issue) and their two notification
types. The notification tables are Spring-owned with a CHECK on `type`, so the
new types are added there the same way workspace 0009 added the task ones.
"""

import importlib

from django.db import migrations, models

_task_types = importlib.import_module('workspace.migrations.0009_task_notification_types')
BEFORE = _task_types.ORIGINAL + _task_types.ADDED
ADDED = ['INVOICE_SUBMITTED', 'INVOICE_RETURNED']


class Migration(migrations.Migration):

    dependencies = [
        ('invoices', '0003_invoicetaxdetail_cgst_amount_and_more'),
        ('workspace', '0009_task_notification_types'),
    ]

    operations = [
        migrations.CreateModel(
            name='InvoiceRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('case_id', models.BigIntegerField(db_index=True)),
                ('client_id', models.BigIntegerField(null=True)),
                ('requested_by_id', models.BigIntegerField(db_index=True)),
                ('status', models.CharField(db_index=True, default='SUBMITTED', max_length=16)),
                ('payload', models.JSONField(default=dict)),
                ('amount', models.FloatField(default=0)),
                ('note', models.TextField(blank=True, default='')),
                ('reviewed_by_id', models.BigIntegerField(null=True)),
                ('invoice_id', models.BigIntegerField(null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'invoice_request',
            },
        ),
        migrations.RunSQL(sql=_task_types._sql(BEFORE + ADDED), reverse_sql=_task_types._sql(BEFORE)),
    ]
