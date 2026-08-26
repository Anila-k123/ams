"""Unmanaged, READ-ONLY models mapping onto tables owned and written by the
separate `acts-importer` project (github.com/Anila-k123/act_scrap), not by
this app. managed=False => Django never migrates, creates, or drops them;
ams never writes to these tables, only reads. Mirrors how core/models.py
already treats tables it doesn't own — same pattern, different owner.

Field shapes match acts-importer's acts/models.py exactly (kept in sync by
hand, since the two are separate codebases with no shared imports).
"""

from django.db import models


class Act(models.Model):
    title = models.CharField(max_length=512)
    long_title = models.TextField(blank=True)
    abstract = models.TextField(blank=True)
    preamble_html = models.TextField(blank=True)

    source_state_name = models.CharField(max_length=128)   # "CENTRAL" | "Tamil Nadu" | ...
    act_number = models.CharField(max_length=32, blank=True)
    act_year = models.IntegerField(null=True, blank=True)

    ministry_name = models.CharField(max_length=256, blank=True)
    department_name = models.CharField(max_length=256, blank=True)

    enact_date = models.DateField(null=True, blank=True)
    enforcement_date = models.TextField(blank=True)  # free text, not a clean date - see importer

    repealed = models.BooleanField(default=False)
    no_of_chapter = models.IntegerField(default=0)
    no_of_section = models.IntegerField(default=0)

    pdf_url = models.URLField(max_length=1024, blank=True)

    source_uuid = models.CharField(max_length=64)
    source_act_id = models.CharField(max_length=128, blank=True)
    source_state_id = models.CharField(max_length=32, blank=True)

    created_at = models.DateTimeField()
    last_synced_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'acts_act'

    def __str__(self):
        return f'{self.title} ({self.source_state_name}, Act {self.act_number} of {self.act_year})'


class Chapter(models.Model):
    act = models.ForeignKey(Act, on_delete=models.DO_NOTHING, db_column='act_id',
                            related_name='chapters')
    number = models.CharField(max_length=32, blank=True)
    title = models.CharField(max_length=512, blank=True)
    order = models.IntegerField(default=0)

    class Meta:
        managed = False
        db_table = 'acts_chapter'

    def __str__(self):
        return f'Chapter {self.number}: {self.title}'


class Section(models.Model):
    act = models.ForeignKey(Act, on_delete=models.DO_NOTHING, db_column='act_id',
                            related_name='sections')
    chapter = models.ForeignKey(Chapter, on_delete=models.DO_NOTHING, db_column='chapter_id',
                                null=True, blank=True, related_name='sections')

    number = models.CharField(max_length=32)
    title = models.CharField(max_length=512, blank=True)
    content = models.TextField(blank=True)
    footnote = models.TextField(blank=True)
    order_number = models.IntegerField(default=0)

    source_section_id = models.CharField(max_length=64, blank=True)

    class Meta:
        managed = False
        db_table = 'acts_section'

    def __str__(self):
        return f'Section {self.number}: {self.title}'


class ActCaseLink(models.Model):
    """Advocate-created link between an act and one of their own cases - the
    "Cases Linked" tab. Unlike Act/Chapter/Section above, this table IS owned
    and written by ams itself, so it's Django-managed with a real migration.
    case_id/advocate_id are plain ints, not real ForeignKeys, matching
    courtsearch.models.ImportedCaseRecord's convention for referencing
    Case/Advocate - both live in core.models, a different, Spring-owned
    unmanaged table this app doesn't want a hard FK constraint against."""
    act = models.ForeignKey(Act, on_delete=models.CASCADE, related_name='case_links')
    case_id = models.BigIntegerField()       # -> core.Case.id (Spring-owned)
    advocate_id = models.BigIntegerField()   # -> core.Advocate.id, who linked it
    linked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('act', 'case_id')]

    def __str__(self):
        return f'ActCaseLink(act={self.act_id}, case={self.case_id})'
