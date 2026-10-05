"""Fill invoice_handling.client_notified_at for invoices issued before 0006.

Those invoices were emailed to the client, but the field did not exist yet, so
the list said "client not emailed". The email is in notification_queue: an
EMAIL row of type INVOICE_GENERATED, subject "Invoice <number> raised", for the
invoice's client, sent at or after the invoice was issued. (Matching the client
too matters: a number can be reused after a demo reset deletes an invoice.)
"""

import json

from django.db import migrations


def backfill(apps, schema_editor):
    InvoiceHandling = apps.get_model('invoices', 'InvoiceHandling')
    with schema_editor.connection.cursor() as cur:
        for h in InvoiceHandling.objects.filter(client_notified_at__isnull=True):
            cur.execute('select invoice_number, client_id from invoices where id = %s', [h.invoice_id])
            row = cur.fetchone()
            if not row:
                continue
            number, client_id = row
            cur.execute(
                "select created_at, payload_json from notification_queue "
                "where type = 'INVOICE_GENERATED' and status = 'SENT' and created_at >= %s "
                "order by created_at", [h.created_at])
            for sent_at, payload in cur.fetchall():
                try:
                    p = json.loads(payload or '{}')
                except ValueError:
                    continue
                if (p.get('channel') == 'EMAIL' and p.get('clientId') == client_id
                        and p.get('subject') == 'Invoice {} raised'.format(number)):
                    h.client_notified_at = sent_at
                    h.save(update_fields=['client_notified_at'])
                    break


class Migration(migrations.Migration):

    dependencies = [
        ('invoices', '0006_invoice_client_notified'),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
