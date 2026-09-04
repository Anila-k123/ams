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


class HearingDetail(models.Model):
    """Advocate-facing extra detail for a hearing (a core.CaseEvent, Spring-owned).

    Kept in a Django-owned side table keyed by the event id rather than altering
    the shared `case_events` schema — the same pattern as invoice_items. Holds
    what an advocate actually records for a hearing: what it is listed for, where
    and before whom, and afterwards the next date and the outcome/order.
    """
    id = models.BigAutoField(primary_key=True)
    event_id = models.BigIntegerField(unique=True, db_index=True)   # -> case_events.id
    advocate_id = models.BigIntegerField(db_index=True)
    purpose = models.CharField(max_length=64, blank=True, default='')
    court = models.CharField(max_length=255, blank=True, default='')
    bench_hall = models.CharField(max_length=128, blank=True, default='')
    judge = models.CharField(max_length=255, blank=True, default='')
    next_date = models.DateField(null=True, blank=True)
    outcome = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'hearing_detail'

    # Camel-cased keys the frontend consumes; both the events serializer and the
    # workspace event payload reuse this so the shape is identical everywhere.
    FIELD_MAP = [('purpose', 'purpose'), ('court', 'court'),
                 ('bench_hall', 'benchHall'), ('judge', 'judge'),
                 ('outcome', 'outcome')]

    def as_dict(self):
        d = {api: getattr(self, col) for col, api in self.FIELD_MAP}
        d['nextDate'] = self.next_date.isoformat() if self.next_date else None
        return d

    @staticmethod
    def payload(event_id):
        row = HearingDetail.objects.filter(event_id=event_id).first()
        return row.as_dict() if row else None
