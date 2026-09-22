# The Document model itself lives in core.models (shared, managed=False, mapping
# onto the Spring-owned `documents` table). This app owns one *Django-managed*
# table: the AI-generated summary for a document. It is a separate table (not a
# column on `documents`) precisely because we cannot migrate the unmanaged table.
from django.db import models


class DocumentSummary(models.Model):
    """AI summary + structured key points for a Document, generated in the
    background after upload. One row per document (`document_id` is unique)."""

    PENDING = 'PENDING'
    PROCESSING = 'PROCESSING'
    READY = 'READY'
    FAILED = 'FAILED'
    UNSUPPORTED = 'UNSUPPORTED'

    id = models.BigAutoField(primary_key=True)
    # Points at core.Document.id. A plain integer (not a FK) so we never create a
    # database-level foreign key into the Spring-owned `documents` table.
    document_id = models.BigIntegerField(unique=True, db_index=True)
    status = models.CharField(max_length=32, default=PENDING)
    summary_text = models.TextField(null=True, blank=True)
    # The full key-points object (the 12-field legal schema) as a JSON string.
    key_points_json = models.TextField(null=True, blank=True)
    model_used = models.CharField(max_length=128, null=True, blank=True)
    error = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = True
        db_table = 'document_summary'


class DocumentVersion(models.Model):
    """A snapshot of a document's PREVIOUS file, kept when a new version is
    uploaded. The Document row always holds the current (latest) version; each
    older version's file lives on and is recorded here so it can be downloaded."""

    id = models.BigAutoField(primary_key=True)
    document_id = models.BigIntegerField(db_index=True)   # -> documents.id
    version = models.IntegerField()
    stored_name = models.CharField(max_length=255)
    file_path = models.CharField(max_length=255)
    file_size = models.BigIntegerField(null=True, blank=True)
    file_type = models.CharField(max_length=255, null=True, blank=True)
    original_name = models.CharField(max_length=255, null=True, blank=True)
    note = models.TextField(null=True, blank=True)   # what changed in this version
    uploaded_by_id = models.BigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = True
        db_table = 'document_version'
        ordering = ['-version']
        unique_together = (('document_id', 'version'),)
