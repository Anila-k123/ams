"""Client users. A client (litigant) signs in to AMS as an ordinary Advocate row with
the Client role; this link says which client they are. Kept in its own table so the
Spring-owned `advocate` table is not altered."""

from django.db import models


class ClientUser(models.Model):
    id = models.BigAutoField(primary_key=True)
    advocate_id = models.BigIntegerField(unique=True)            # -> advocate.id (the login)
    client_id = models.BigIntegerField(db_index=True)            # -> clients.id (whose matters)
    created_by_id = models.BigIntegerField(null=True, blank=True)
    activated_at = models.DateTimeField(null=True, blank=True)   # first password set
    last_login_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'client_user'


class ClientInvite(models.Model):
    """A one-time set-password link (invite or reset). Only the token's hash is stored."""
    id = models.BigAutoField(primary_key=True)
    client_user = models.ForeignKey(ClientUser, on_delete=models.CASCADE, related_name='invites')
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'client_invite'
