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


class CauseListItem(models.Model):
    """One case's position in a court's published order of business for one day.

    This is what a display board cannot tell you. The board reports the item a
    courtroom is calling right now - one row per room; the cause list is the
    whole day's order, so it is the only source for "your matter is item 40".
    Both are needed to say how far away a hearing is.

    Rows are replaced wholesale per (court, list_date) on each sync rather than
    upserted: the court can revise a list during the day, and a stale row that
    quietly survived a re-fetch would put a client in the wrong place in the
    queue. Replacing is also idempotent, so re-running the sync is always safe.

    Only DAILY rows are stored by default. The Supreme Court also publishes an
    ADVANCE list, but it is explicitly a forecast ("matters which are LIKELY to
    be listed"), and an item number from it may not hold.
    """
    court = models.CharField(max_length=32)              # provider key, e.g. 'sci'
    list_date = models.DateField()
    court_number = models.CharField(max_length=16)       # '1'..'16', or 'R1'
    item_number = models.CharField(max_length=32)        # '35', '35.1'
    case_string = models.CharField(max_length=255)       # as printed by the court

    # The join key. Registration numbers, display-board strings and cause-list
    # entries all write the same case differently, so every side is reduced to
    # (type, number, year) - with 'DIARY' as the type for diary-numbered
    # matters, which is how most fresh Supreme Court cases are listed.
    case_type = models.CharField(max_length=32, blank=True)
    case_no = models.CharField(max_length=32, blank=True)
    case_year = models.CharField(max_length=8, blank=True)

    diary_number = models.CharField(max_length=64, blank=True)
    list_type = models.CharField(max_length=16, default='DAILY')
    source = models.CharField(max_length=128, blank=True)   # originating PDF
    fetched_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'causelist_item'
        indexes = [
            models.Index(fields=['court', 'list_date']),
            # The lookup the "Your Item" join makes, once per case.
            models.Index(fields=['court', 'list_date', 'case_type',
                                 'case_no', 'case_year'],
                         name='causelist_join_idx'),
        ]

    def __str__(self):
        return '{} {} court {} item {}: {}'.format(
            self.court, self.list_date, self.court_number,
            self.item_number, self.case_string)
