from django.db import models


class LLMUsage(models.Model):
    """One LLM call: who, which feature, which model, how many tokens.

    Written by metering.usage.record() from the two wrappers every LLM call
    goes through (assistant/llm.py, drafting/providers/llm.py), for per-feature
    and per-firm usage and future pricing. Plain ids, per the AMS convention
    for rows pointing at Spring-owned tables.
    """
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    advocate_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    practice_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    # Pricing bucket: chat / summary / draft / translation / unattributed.
    feature = models.CharField(max_length=32, db_index=True)
    # Finer detail, e.g. draft.generate, draft.refine, summary.document.
    operation = models.CharField(max_length=64, blank=True, default='')
    provider = models.CharField(max_length=32, blank=True, default='')
    model = models.CharField(max_length=128, blank=True, default='')
    input_tokens = models.IntegerField(default=0)
    output_tokens = models.IntegerField(default=0)
    total_tokens = models.IntegerField(default=0)
    # True when the provider sent no usage and tokens were estimated from text length.
    estimated = models.BooleanField(default=False)
    # For character-billed calls (Sarvam translation).
    characters = models.IntegerField(null=True, blank=True)
    ref_type = models.CharField(max_length=32, blank=True, default='')
    ref_id = models.BigIntegerField(null=True, blank=True)
    duration_ms = models.IntegerField(null=True, blank=True)
    ok = models.BooleanField(default=True)

    class Meta:
        db_table = 'llm_usage'
        indexes = [models.Index(fields=['feature', 'created_at'])]
