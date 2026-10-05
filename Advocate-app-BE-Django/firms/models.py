"""Teams grouped into a firm.

A team is a practice root (an advocate with parent_advocate_id NULL) and its
members - see core/practice.py. A firm with several seniors has several teams;
this table says which teams belong to the same firm, so firm-wide staff (Super
Admin, Accountant) see all of them while each senior's team sees only its own.

A team root with no row here is a one-team firm, so solo practices and firms
with a single senior behave exactly as before.
"""

from django.db import models


class FirmTeam(models.Model):
    id = models.BigAutoField(primary_key=True)
    team_root_id = models.BigIntegerField(unique=True)        # -> advocate.id (a practice root)
    firm_root_id = models.BigIntegerField(db_index=True)      # the firm's head team root
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'firm_team'
