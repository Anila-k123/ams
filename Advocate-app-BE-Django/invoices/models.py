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


# Default GST reverse-charge note for legal services (editable per firm).
DEFAULT_GST_NOTE = (
    'GST on Legal Services is payable by the recipient of service on reverse charge '
    'basis. (CGST 9% + SGST/UTGST 9% OR IGST 18% AS THE CASE MAY BE). Please also note '
    'the time of supply for this invoice will be 60 days from the date of Invoice unless '
    'Payment is made earlier. Non payment of GST beyond 60 days will attract interest as '
    'per GST Law.'
)


class FirmBillingProfile(models.Model):
    """A firm's static billing details for its GST invoices — bank/remittance info,
    HSN/category and the standard GST notes. One row per practice OWNER (keyed by the
    owner's advocate id), so every member's invoice carries the firm's billing block.
    The `advocate`/`invoices` tables are Spring-owned (unmanaged); this table is ours.
    Supplier GSTIN/PAN are NOT duplicated here — they already live on the Advocate row
    (`gst_number`, `pan_number`)."""
    advocate_id = models.BigIntegerField(unique=True)          # practice owner
    pay_in_favour_of = models.CharField(max_length=255, blank=True, default='')
    bank_name = models.CharField(max_length=255, blank=True, default='')
    bank_branch_address = models.CharField(max_length=500, blank=True, default='')
    account_number = models.CharField(max_length=64, blank=True, default='')
    ifsc_code = models.CharField(max_length=32, blank=True, default='')
    micr_code = models.CharField(max_length=32, blank=True, default='')
    remittance_email = models.CharField(max_length=255, blank=True, default='')
    hsn_code = models.CharField(max_length=32, blank=True, default='998212')
    service_category = models.CharField(max_length=128, blank=True, default='LEGAL SERVICES')
    gst_note = models.TextField(blank=True, default=DEFAULT_GST_NOTE)
    iso_note = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'firm_billing_profile'

    def __str__(self):
        return 'BillingProfile(owner={})'.format(self.advocate_id)


class InvoiceTaxDetail(models.Model):
    """Per-invoice recipient / GST details, snapshotted at creation (a GST invoice is
    immutable, so the recipient's identifiers are captured on the invoice itself).
    Keyed by invoice id, like InvoiceItem — no FK, since `invoices` is unmanaged."""
    invoice_id = models.BigIntegerField(unique=True)
    kind_attn = models.CharField(max_length=255, blank=True, default='')
    recipient_gstin = models.CharField(max_length=32, blank=True, default='')
    recipient_state = models.CharField(max_length=128, blank=True, default='')
    recipient_state_code = models.CharField(max_length=8, blank=True, default='')
    recipient_address = models.TextField(blank=True, default='')   # multi-line
    place_of_supply = models.CharField(max_length=128, blank=True, default='')
    # GST treatment, snapshotted so the invoice is an immutable record.
    #   rcm     -> reverse charge: recipient pays GST, invoice shows taxable value only
    #   forward -> firm charges GST: CGST+SGST (intra-state) or IGST (inter-state)
    tax_mode = models.CharField(max_length=16, default='rcm')
    gst_rate = models.FloatField(default=18.0)
    is_interstate = models.BooleanField(default=False)
    taxable_value = models.FloatField(default=0)
    cgst_amount = models.FloatField(default=0)
    sgst_amount = models.FloatField(default=0)
    igst_amount = models.FloatField(default=0)
    total_value = models.FloatField(default=0)         # taxable + tax (gross)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'invoice_tax_detail'
        indexes = [models.Index(fields=['invoice_id'])]

    def __str__(self):
        return 'TaxDetail(invoice={})'.format(self.invoice_id)
