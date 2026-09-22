from django.db import models


class LegalTerm(models.Model):
    """A legal term + definition. Django-managed (we own this data), populated by
    the import_legal_terms command from open/public-domain dictionaries."""

    id = models.BigAutoField(primary_key=True)
    term = models.CharField(max_length=255)
    term_norm = models.CharField(max_length=255, db_index=True)  # lowercased, for lookup
    definition = models.TextField()                          # refined text shown to users
    definition_raw = models.TextField(null=True, blank=True)  # original, for re-refining
    letter = models.CharField(max_length=8, blank=True, default='')
    source = models.CharField(max_length=64, default='blacks-1910')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = True
        db_table = 'legal_term'
        ordering = ['term']
