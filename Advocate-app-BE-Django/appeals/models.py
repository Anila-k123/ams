"""Appeal Alert - Django-managed tables (unlike the Spring-owned tables in
core.models, these ARE created and migrated by Django). Column names follow the
snake_case convention; camelCase JSON is produced in the serializer.

The feature is automatic: the scan_appeals sweep detects appeals filed against
decided cases. The old manually-entered AppealAlert model was removed - it
stored a court, case number and judgment date and never used them, so the page
read as a deadline tracker while tracking nothing.
"""

from django.db import models


class AppealDetection(models.Model):
    """A case spotted in a higher court that looks like an appeal against one
    of this advocate's own decided cases.

    This is a FACT read off the court's record - "an appeal naming your client
    has appeared in the High Court" - not a computed limitation deadline. It
    deliberately carries no statutory arithmetic; the periods vary by forum and
    matter type and carry real malpractice risk, so they are out of scope here.

    Rows are created by the `scan_appeals` command and are never auto-deleted:
    a false positive is dismissed by the advocate so the same case is not
    reported again.
    """
    STATUS_NEW = 'NEW'
    STATUS_CONFIRMED = 'CONFIRMED'
    STATUS_DISMISSED = 'DISMISSED'
    STATUS_CHOICES = [
        (STATUS_NEW, 'New'),
        (STATUS_CONFIRMED, 'Confirmed as an appeal'),
        (STATUS_DISMISSED, 'Not related'),
    ]

    id = models.BigAutoField(primary_key=True)
    advocate_id = models.BigIntegerField(db_index=True)
    # The advocate's own case that appears to have been appealed.
    source_case_id = models.BigIntegerField(db_index=True)
    source_case_number = models.CharField(max_length=255, blank=True, default='')

    # Where the suspected appeal was found.
    forum_court_id = models.CharField(max_length=32)          # ecourts_hc | sci
    forum_state_code = models.CharField(max_length=8, blank=True, default='')
    forum_label = models.CharField(max_length=255, blank=True, default='')

    # The higher-court case itself.
    appeal_case_number = models.CharField(max_length=255, blank=True, default='')
    appeal_cnr = models.CharField(max_length=32, blank=True, default='', db_index=True)
    appeal_parties = models.CharField(max_length=500, blank=True, default='')
    appeal_filed_on = models.DateField(null=True, blank=True)

    # Why we think it matches, so the advocate can judge it rather than trust it.
    matched_on = models.CharField(max_length=255, blank=True, default='')
    match_score = models.FloatField(default=0.0)

    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_NEW)
    notified_in_app = models.BooleanField(default=False)
    notified_email = models.BooleanField(default=False)
    detected_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'appeal_detection'
        ordering = ['-detected_at', '-id']
        indexes = [models.Index(fields=['advocate_id', 'status'])]
        # The same higher-court case must never be reported twice for the same
        # source case, however often the sweep runs.
        constraints = [
            models.UniqueConstraint(
                fields=['advocate_id', 'source_case_id', 'appeal_cnr'],
                name='uniq_appeal_per_source_case',
            ),
        ]


class CaseDecision(models.Model):
    """A case the court has decided, and what that means for an appeal (appeals/decisions.py,
    docs/APPEALS.md). One row per case, made when the order sync (or a Refresh) sees the case disposed.

    `outcome` is who won by the court's wording ("ALLOWED", "DISMISSED"...); with our client's side it puts
    the case on the Appeal Alerts page under "You can appeal" (we lost), "The other side may appeal" (we won,
    the evening appeal check watches the higher court), or "Needs a look" (unclear, or our side unknown).
    No limitation date yet: that is the next piece of work."""
    PETITIONER, RESPONDENT, PARTLY, NO_CONTEST, UNCLEAR = 'petitioner', 'respondent', 'partly', 'no_contest', 'unclear'
    OPEN, APPEALING, NO_APPEAL, WATCHING, WATCH_STOPPED = 'open', 'appealing', 'no_appeal', 'watching', 'watch_stopped'

    id = models.BigAutoField(primary_key=True)
    case_id = models.BigIntegerField(unique=True)                # -> cases.id (Spring-owned)
    advocate_id = models.BigIntegerField(db_index=True)          # the case's advocate (practice scope)
    court_id = models.CharField(max_length=32)
    decided_on = models.DateField(null=True, blank=True)
    nature = models.CharField(max_length=255, blank=True, default='')   # the court's own words
    outcome = models.CharField(max_length=16, default=UNCLEAR)          # who won (petitioner side / respondent side)
    our_side = models.CharField(max_length=16, blank=True, default='')  # petitioner | respondent | '' unknown
    side_source = models.CharField(max_length=16, blank=True, default='')   # profile | parties | asked
    next_forum = models.CharField(max_length=255, blank=True, default='')
    status = models.CharField(max_length=16, default=OPEN)
    decided_by_id = models.BigIntegerField(null=True, blank=True)        # who chose appeal / no appeal
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    alerted_at = models.DateTimeField(null=True, blank=True)
    watched_at = models.DateTimeField(null=True, blank=True)             # last evening appeal check

    class Meta:
        db_table = 'appeal_case_decision'
