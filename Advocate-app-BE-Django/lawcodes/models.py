from django.db import models


class LegalCodeMapping(models.Model):
    """Maps an old Indian criminal-law section to its replacement in the 2023 codes
    (effective 1 July 2024):

        IPC  (1860) -> BNS  (Bharatiya Nyaya Sanhita, 2023)
        CrPC (1973) -> BNSS (Bharatiya Nagarik Suraksha Sanhita, 2023)
        IEA  (1872) -> BSA  (Bharatiya Sakshya Adhiniyam, 2023)

    Django-managed reference data, populated by the `load_section_mappings` command from
    the source tables in lawcodes/data/ (from vakilpedia.com). A blank `new_section`
    means the old provision was repealed with no direct equivalent; `changed` marks a
    substantive change in wording or penalty.
    """

    OLD_ACTS = (('IPC', 'Indian Penal Code, 1860'),
                ('CrPC', 'Code of Criminal Procedure, 1973'),
                ('IEA', 'Indian Evidence Act, 1872'))
    NEW_ACTS = (('BNS', 'Bharatiya Nyaya Sanhita, 2023'),
                ('BNSS', 'Bharatiya Nagarik Suraksha Sanhita, 2023'),
                ('BSA', 'Bharatiya Sakshya Adhiniyam, 2023'))

    id = models.BigAutoField(primary_key=True)
    old_act = models.CharField(max_length=10, choices=OLD_ACTS, db_index=True)
    old_section = models.CharField(max_length=60)
    old_section_norm = models.CharField(max_length=60, db_index=True, default='')   # lowered, spaceless
    description = models.CharField(max_length=500, blank=True, default='')
    new_act = models.CharField(max_length=10, choices=NEW_ACTS)
    new_section = models.CharField(max_length=120, blank=True, default='')
    new_section_norm = models.CharField(max_length=120, db_index=True, default='')
    changed = models.BooleanField(default=False)
    source = models.CharField(max_length=40, default='vakilpedia')   # provenance
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = True
        db_table = 'legal_code_mapping'
        unique_together = [('old_act', 'old_section')]
        ordering = ['old_act', 'old_section']

    def __str__(self):
        new = '{} S.{}'.format(self.new_act, self.new_section) if self.new_section else 'repealed'
        return '{} S.{} -> {}'.format(self.old_act, self.old_section, new)
