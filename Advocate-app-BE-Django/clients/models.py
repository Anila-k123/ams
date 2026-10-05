# Models live in core.models (shared, managed=False).
from django.db import models


class ClientHandler(models.Model):
    """The advocate who will take a new client's matter, named when the client
    is added (by the advocate who met them, before any case exists).

    A separate managed table rather than a column on `clients`, which belongs
    to the original Spring schema and is managed=False. Plain ids, not foreign
    keys, per the convention for rows pointing at Spring-owned tables.
    """
    client_id = models.BigIntegerField(unique=True)
    advocate_id = models.BigIntegerField(db_index=True)
    assigned_by_id = models.BigIntegerField(null=True, blank=True)
    assigned_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'client_handler'


class ClientProfile(models.Model):
    """The client form's fields that the Spring `clients` table has no columns
    for. Without this they were accepted by the form and silently dropped.

    `clients.address` stays the one-line address every older reader uses
    (reports, PDFs, the client portal); it is rebuilt from the parts below
    whenever they're saved (see clients.profile.compose_address).
    """
    client_id = models.BigIntegerField(unique=True)
    description = models.CharField(max_length=500, blank=True, default='')
    website = models.CharField(max_length=255, blank=True, default='')
    billing_currency = models.CharField(max_length=8, blank=True, default='INR')
    gstin = models.CharField(max_length=32, blank=True, default='')
    building = models.CharField(max_length=255, blank=True, default='')
    street = models.CharField(max_length=255, blank=True, default='')
    city = models.CharField(max_length=128, blank=True, default='')
    district = models.CharField(max_length=128, blank=True, default='')
    state = models.CharField(max_length=128, blank=True, default='')
    pincode = models.CharField(max_length=16, blank=True, default='')
    country = models.CharField(max_length=128, blank=True, default='')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'client_profile'
