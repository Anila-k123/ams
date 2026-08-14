"""Case Workspace — Django-managed tables that enrich the shared (Spring-owned,
managed=False) `cases` table with notes, tags/labels and per-case tasks. These are
owned and migrated by Django. case_id is stored as a plain integer referencing the
`cases` table; we deliberately avoid a DB-level FK so Django never touches that table.
"""

from django.db import models


class CaseNote(models.Model):
    id = models.BigAutoField(primary_key=True)
    advocate_id = models.BigIntegerField(db_index=True)
    case_id = models.BigIntegerField(db_index=True)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'case_note'
        ordering = ['-created_at', '-id']


class CaseTag(models.Model):
    id = models.BigAutoField(primary_key=True)
    advocate_id = models.BigIntegerField(db_index=True)
    case_id = models.BigIntegerField(db_index=True)
    label = models.CharField(max_length=64)
    color = models.CharField(max_length=16, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'case_tag'
        ordering = ['label']
        unique_together = ('advocate_id', 'case_id', 'label')


class CaseTask(models.Model):
    id = models.BigAutoField(primary_key=True)
    advocate_id = models.BigIntegerField(db_index=True)
    case_id = models.BigIntegerField(db_index=True, null=True, blank=True)
    title = models.CharField(max_length=255)
    priority = models.CharField(max_length=16, default='MEDIUM')
    deadline = models.DateField(null=True, blank=True)
    completed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'case_task'
        ordering = ['completed', 'deadline', 'id']


class CaseTaskDocument(models.Model):
    """Links a task to a document from the shared documents store (many docs per task)."""
    id = models.BigAutoField(primary_key=True)
    advocate_id = models.BigIntegerField(db_index=True)
    task_id = models.BigIntegerField(db_index=True)
    document_id = models.BigIntegerField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'case_task_document'
        ordering = ['id']
        unique_together = ('task_id', 'document_id')


class CaseParty(models.Model):
    """A party/opponent on a case (petitioner, respondent, opposing counsel, etc.)."""
    id = models.BigAutoField(primary_key=True)
    advocate_id = models.BigIntegerField(db_index=True)
    case_id = models.BigIntegerField(db_index=True)
    name = models.CharField(max_length=255)
    role = models.CharField(max_length=32, null=True, blank=True)
    counsel = models.CharField(max_length=255, null=True, blank=True)
    contact = models.CharField(max_length=255, null=True, blank=True)
    is_opponent = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'case_party'
        ordering = ['-is_opponent', 'id']


class RelatedCase(models.Model):
    """A directional link from one case to another owned case (appeal, connected, etc.).
    Listing a case shows both outgoing and incoming links."""
    id = models.BigAutoField(primary_key=True)
    advocate_id = models.BigIntegerField(db_index=True)
    case_id = models.BigIntegerField(db_index=True)
    related_case_id = models.BigIntegerField(db_index=True)
    relation = models.CharField(max_length=32, null=True, blank=True)
    note = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'case_related'
        ordering = ['-id']
        unique_together = ('advocate_id', 'case_id', 'related_case_id')
