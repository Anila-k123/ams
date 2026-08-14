"""Appeal Alert — a Django-managed table (unlike the shared Spring-owned tables in
core.models, this one IS created and migrated by Django). Column names follow the
snake_case convention; camelCase JSON is produced in the serializer.
"""

from django.db import models


class AppealAlert(models.Model):
    id = models.BigAutoField(primary_key=True)
    advocate_id = models.BigIntegerField(db_index=True)
    forum = models.CharField(max_length=255, default='Supreme Court')
    court = models.CharField(max_length=255, null=True, blank=True)
    state = models.CharField(max_length=255, null=True, blank=True)
    case_number = models.CharField(max_length=255, null=True, blank=True)
    case_year = models.CharField(max_length=8, null=True, blank=True)
    judgement_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'appeal_alert'
        ordering = ['-created_at', '-id']
