"""Client review (docs/CLIENT_REVIEW.md): the firm sends a document to its client for review, round by round.

The firm keeps the master document. Each round sends a **review copy** of one version (comments removed,
tracked changes accepted); the client marks up only that copy (in the PactPro editor, review mode) and sends it
back, or approves. Messages and files in between form the review's thread.
"""

from django.conf import settings
from django.db import models


class ClientReview(models.Model):
    OPEN, APPROVED, CANCELLED = 'OPEN', 'APPROVED', 'CANCELLED'

    if settings.TENANCY_COLUMNS:
        firm_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    document_id = models.BigIntegerField(db_index=True)       # -> documents.id (the firm's master)
    client_id = models.BigIntegerField(db_index=True)         # -> clients.id
    advocate_id = models.BigIntegerField()                    # the practice the document belongs to
    created_by_id = models.BigIntegerField()
    message = models.TextField(blank=True, default='')
    questions = models.JSONField(default=list, blank=True)    # ["Confirm the deposit", ...]
    reply_by = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=12, default=OPEN)
    approved_version = models.PositiveIntegerField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by_name = models.CharField(max_length=255, blank=True, default='')
    last_reminded_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'client_review'
        ordering = ['-created_at', '-id']

    def current_round(self):
        return self.rounds.order_by('-number').first()


class ClientReviewRound(models.Model):
    """One version sent to the client, with the client's review copy (what they edit)."""
    SENT, RETURNED, APPROVED, SUPERSEDED = 'SENT', 'RETURNED', 'APPROVED', 'SUPERSEDED'

    review = models.ForeignKey(ClientReview, on_delete=models.CASCADE, related_name='rounds')
    number = models.PositiveIntegerField()
    version = models.PositiveIntegerField()                   # the document version sent
    file = models.FileField(upload_to='client_review/copies/')
    file_name = models.CharField(max_length=255)
    editable = models.BooleanField(default=False)             # a Word file: the client edits it in the editor
    key = models.CharField(max_length=128, blank=True)        # the editor's document key for this copy
    editing = models.BooleanField(default=False)
    status = models.CharField(max_length=12, default=SENT)
    sent_by_id = models.BigIntegerField()
    sent_at = models.DateTimeField(auto_now_add=True)
    client_saved_at = models.DateTimeField(null=True, blank=True)
    returned_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'client_review_round'
        unique_together = (('review', 'number'),)
        ordering = ['number']


class ClientReviewMessage(models.Model):
    FIRM, CLIENT = 'firm', 'client'

    review = models.ForeignKey(ClientReview, on_delete=models.CASCADE, related_name='messages')
    round_number = models.PositiveIntegerField(null=True, blank=True)
    author_kind = models.CharField(max_length=8)              # firm / client
    author_id = models.BigIntegerField()                      # an advocate (firm) or the client's login
    author_name = models.CharField(max_length=255, blank=True, default='')
    kind = models.CharField(max_length=16, default='message')  # message / sent / changes / approved / cancelled
    text = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'client_review_message'
        ordering = ['created_at', 'id']


class ClientReviewFile(models.Model):
    """A file attached to a message: the client's marked-up Word file, a photo of handwritten notes, a PDF."""
    message = models.ForeignKey(ClientReviewMessage, on_delete=models.CASCADE, related_name='files')
    file = models.FileField(upload_to='client_review/files/')
    name = models.CharField(max_length=255)
    size = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = 'client_review_file'
