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


class DocumentEditState(models.Model):
    """A document's state in the ONLYOFFICE editor (documents/editor.py). `documents` is a Spring-era table,
    so this side table holds the editor's document key (new for every version: a reused key opens a cached
    old copy) and whether someone has it open."""
    document_id = models.BigIntegerField(unique=True)   # -> documents.id
    key = models.CharField(max_length=128)
    editing = models.BooleanField(default=False)
    # Made blank by New document / Write in editor and never saved since: removed when closed unchanged
    # (documents/blank.py), so an opened-and-abandoned new document doesn't stay in Documents or on a task.
    blank = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = True
        db_table = 'document_edit_state'


class DocumentVersionChanges(models.Model):
    """What the editor reported when it saved a version (key, changes zip, history), so its Version
    History can highlight the changes. Versions uploaded by hand have no row."""
    document_id = models.BigIntegerField(db_index=True)
    version = models.IntegerField()
    key = models.CharField(max_length=128)
    changes = models.FileField(upload_to='documents/editor/changes/', null=True, blank=True)
    history = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = True
        db_table = 'document_version_changes'
        unique_together = (('document_id', 'version'),)


class DesktopLock(models.Model):
    """A document / draft open in a desktop program over WebDAV (documents/dav.py): Office's lock, so the
    PactPro editor opens it read-only meanwhile. In the database (not a cache) so every server process
    sees it; it expires when Office stops refreshing it."""
    kind = models.CharField(max_length=8)                 # 'doc' | 'draft'
    obj_id = models.BigIntegerField()
    token = models.CharField(max_length=80)
    user_id = models.BigIntegerField()
    by = models.CharField(max_length=255)
    since = models.DateTimeField(auto_now_add=True)
    expires = models.DateTimeField()

    class Meta:
        managed = True
        db_table = 'desktop_lock'
        unique_together = (('kind', 'obj_id'),)


class DesktopWork(models.Model):
    """What a desktop program saved over WebDAV (documents/dav.py), not yet a PactPro version. Word /
    LibreOffice save as often as the user likes, each save overwriting this working copy; the user's
    "Save to PactPro" turns it into one version (or Discard drops it). One per document / draft."""
    kind = models.CharField(max_length=8)                 # 'doc' | 'draft'
    obj_id = models.BigIntegerField()
    user_id = models.BigIntegerField()
    by = models.CharField(max_length=255)
    name = models.CharField(max_length=255)
    file = models.FileField(upload_to='desktop_work/')
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        managed = True
        db_table = 'desktop_work'
        unique_together = (('kind', 'obj_id'),)
