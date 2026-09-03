"""Invoice line items ("Particulars").

The `invoices` table itself is the Spring-era, unmanaged schema with a single
`amount` column and no breakdown. Rather than alter that shared table, the
line-item breakdown lives here in a table Django fully owns (like
courtsearch's tables) - one row per particular, linked to an invoice by id.
The invoice's own `amount` still holds the total (the sum of these), so every
existing invoice list/summary keeps working unchanged; the particulars are
extra detail layered on top.
"""

from django.db import models


class InvoiceItem(models.Model):
    """One line of an invoice: a particular and its amount."""
    # Plain id, not a FK: `invoices` is an unmanaged table, so we avoid a
    # cross-managed-ness FK constraint and just key by the invoice's id.
    invoice_id = models.BigIntegerField()
    description = models.CharField(max_length=500)
    amount = models.FloatField(default=0)
    position = models.IntegerField(default=0)      # display order within the invoice
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'invoice_items'
        ordering = ['position', 'id']
        indexes = [models.Index(fields=['invoice_id'])]

    def __str__(self):
        return '{} : {}'.format(self.description, self.amount)
