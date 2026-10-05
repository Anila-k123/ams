"""Seed INVOICE_ISSUE and let advocates raise invoices for accounts.

Raising a bill and issuing it are different things. The advocate who runs a
case knows what was done and raises its invoice (INVOICE_CREATE); it then
waits as an invoices.models.InvoiceRequest until someone with INVOICE_ISSUE -
the accountant or the admin - checks it and issues it, or returns it with a
note. Seniors raise like any advocate: every bill goes through accounts. Issuing is what numbers the invoice, counts it and sends it to
the client, so creating an invoice directly also needs INVOICE_ISSUE.

After issue the invoice belongs to accounts too: recording payments against it
(PAYMENT_CREATE), marking it paid and cancelling it (INVOICE_EDIT). All of
these are taken away from the Senior Advocate.

`permissions` is a Spring-owned table (core.models.Permission is managed=False),
so new codes cannot arrive via a Django migration - hence a command. Idempotent:
safe to re-run on every deploy.
"""

from django.core.management.base import BaseCommand
from core.models import Permission, Role, RolePermission

# (name, module, description)
PERMISSIONS = [
    ('INVOICE_ISSUE', 'INVOICES',
     'Issue invoices (directly, or ones raised by advocates) and return them'),
]

# role name -> codes it should hold.
GRANTS = {
    'Super Admin': ['INVOICE_ISSUE'],
    'Accountant': ['INVOICE_ISSUE'],
    # Raise only: their invoices go to accounts to issue.
    'Advocate': ['INVOICE_VIEW', 'INVOICE_CREATE'],
}

# role name -> codes it must not hold: what happens after issue is accounts'.
REVOKES = {
    'Senior Advocate': ['INVOICE_ISSUE', 'PAYMENT_CREATE', 'INVOICE_EDIT'],
}


class Command(BaseCommand):
    help = ('Create INVOICE_ISSUE; give it to accounts, let advocates and seniors raise '
            'invoices, and leave issuing, payments and corrections to accounts.')

    def handle(self, *args, **options):
        created = []
        for name, module, description in PERMISSIONS:
            perm, made = Permission.objects.get_or_create(
                name=name, defaults={'module': module, 'description': description})
            if made:
                created.append(name)
            self.stdout.write(f"  permission {name}: {'created' if made else 'already present'}")

        granted = 0
        for role_name, codes in GRANTS.items():
            role = Role.objects.filter(name=role_name).first()
            if role is None:
                self.stdout.write(self.style.WARNING(f"  role {role_name!r} not found - skipped"))
                continue
            for code in codes:
                perm = Permission.objects.filter(name=code).first()
                if perm is None:
                    self.stdout.write(self.style.WARNING(f"  permission {code} not found - skipped"))
                    continue
                _, made = RolePermission.objects.get_or_create(role_id=role.id, permission_id=perm.id)
                if made:
                    granted += 1
                    self.stdout.write(f"  granted {code} to {role_name}")

        revoked = 0
        for role_name, codes in REVOKES.items():
            role = Role.objects.filter(name=role_name).first()
            if role is None:
                continue
            perm_ids = list(Permission.objects.filter(name__in=codes).values_list('id', flat=True))
            n, _ = RolePermission.objects.filter(role_id=role.id, permission_id__in=perm_ids).delete()
            if n:
                revoked += n
                self.stdout.write(f"  removed {', '.join(codes)} from {role_name}")

        self.stdout.write(self.style.SUCCESS(
            f"Done: {len(created)} permission(s) created, {granted} grant(s) added, {revoked} removed."))
