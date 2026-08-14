from django.db import models


class CourtCaseTypes(models.Model):
    """Persisted case-type map for a court, scraped once and reused indefinitely.

    Case types are effectively static, so we store them here rather than re-hitting
    the court site on a timer. The map is fetched the first time a court is requested;
    every request after that is served from this table. Refresh is admin-only (the
    `refresh_case_types` management command) — there is deliberately no user-facing
    refresh, to avoid anyone spamming the government site.
    """
    court_id = models.CharField(max_length=64, unique=True)
    types = models.JSONField(default=dict)          # { LABEL: numeric_id }
    fetched_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'courtsearch_case_types'

    def __str__(self):
        return f'{self.court_id} ({len(self.types)} types)'


class ImportedCaseRecord(models.Model):
    """The complete court-API response captured when a case is imported.

    We persist the raw response verbatim (all fields, tables, orders, hearing
    history, etc.) so nothing scraped is lost. The structured presentation of
    this data is a later concern — this table is the source of truth for it.
    """
    advocate_id = models.BigIntegerField()
    case_id = models.BigIntegerField(null=True, blank=True)   # -> cases.id (Spring-owned)
    court_id = models.CharField(max_length=64)                # madras_hc | ecourts_dc
    query = models.JSONField(default=dict)                    # search params used
    raw = models.JSONField(default=dict)                      # full API response, verbatim
    fetched_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'courtsearch_imported_record'
        indexes = [models.Index(fields=['advocate_id', 'case_id'])]

    def __str__(self):
        return f'ImportedCaseRecord(case={self.case_id}, court={self.court_id})'
