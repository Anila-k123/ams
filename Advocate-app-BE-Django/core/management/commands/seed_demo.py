"""Seed the "Kumar & Associates" demo story used in the client presentation.

Creates one coherent, interconnected data set so a presenter can log in and walk
the whole demo through a single matter (ABC Constructions vs XYZ Builders):

    firm users (senior / junior / accountant)
      -> client (ABC Constructions Pvt. Ltd.)
        -> matters (one active writ, one decided)
          -> hearing, tasks, note, expenses, documents, invoices
          -> a ready-made Appeal Alert detection

Everything is created with the ORM directly, which bypasses the view layer, so
NO client emails or notifications fire while seeding (the NotificationQueue is
left untouched).

Idempotent: every row is get_or_create'd on a natural key, so re-running makes no
duplicates. `--reset` tears the demo data down first for a clean rebuild.

    python manage.py seed_demo
    python manage.py seed_demo --reset
    python manage.py seed_demo --password 'Other@123'

Prerequisite: run `seed_admin_permissions` and `seed_firm_wide_scope` once so the
Super Admin / Accountant roles carry their firm-wide admin permissions.
"""

from __future__ import annotations

import datetime
import os
import uuid

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from core.passwords import hash_password
from core.models import (
    Advocate, Client, Case, CaseEvent, Document, Role, AdvocateRole,
    Expense, Invoice,
)
from workspace.models import CaseNote, CaseTask
from invoices.models import InvoiceItem
from appeals.models import AppealDetection

DEFAULT_PASSWORD = 'Demo@1234'

# The three demo logins. Emails double as the natural key for idempotency/reset.
USERS = {
    'rajesh': dict(
        email='rajesh@kumar-associates.demo', full_name='Rajesh Kumar',
        bar_council_id='TN/1234/2001', role='ADVOCATE',
        specialization='Civil & Writ',
        roles=['Super Admin', 'Senior Advocate'], parent='self'),
    'priya': dict(
        email='priya@kumar-associates.demo', full_name='Priya Nair',
        bar_council_id='TN/5678/2018', role='ADVOCATE',
        specialization='Litigation', roles=['Junior Advocate'], parent='rajesh'),
    'suresh': dict(
        email='suresh@kumar-associates.demo', full_name='Suresh Kumar',
        bar_council_id='TN/ACC/0001', role='ACCOUNTANT',
        specialization='Accounts', roles=['Accountant'], parent=None),
}

# A minimal but valid one-page PDF, used as the placeholder document on disk.
_PLACEHOLDER_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources"
    b"<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n"
    b"4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
    b"5 0 obj<</Length 68>>stream\n"
    b"BT /F1 20 Tf 72 700 Td (ABC Constructions - Petition [DEMO]) Tj ET\n"
    b"endstream endobj\n"
    b"xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n"
    b"0000000101 00000 n \n0000000229 00000 n \n0000000298 00000 n \n"
    b"trailer<</Size 6/Root 1 0 R>>\nstartxref\n416\n%%EOF\n"
)


class Command(BaseCommand):
    help = 'Seed the Kumar & Associates demo story (idempotent; --reset to rebuild).'

    def add_arguments(self, parser):
        parser.add_argument('--reset', action='store_true',
                            help='Delete existing demo data before seeding.')
        parser.add_argument('--password', default=DEFAULT_PASSWORD,
                            help='Shared password for the three demo logins.')

    # -- helpers -----------------------------------------------------------

    def _line(self, label, obj, created):
        self.stdout.write('  {}: {} ({})'.format(
            label, obj, 'created' if created else 'already present'))

    def _grant(self, advocate, role_name):
        # This command never creates roles — it only assigns EXISTING ones (from
        # the app's own RBAC seed), so a typo'd name can't mint an empty,
        # permission-less role. Missing roles warn and are skipped.
        role = Role.objects.filter(name=role_name).first()
        if role is None:
            self.stdout.write(self.style.WARNING(
                '  role {!r} not found — {} left without it (run the RBAC '
                'seed first)'.format(role_name, advocate.email)))
            return
        AdvocateRole.objects.get_or_create(
            advocate_id=advocate.id, role_id=role.id)

    def _reset(self):
        ids = list(Advocate.objects.filter(
            email__in=[u['email'] for u in USERS.values()]
        ).values_list('id', flat=True))
        if not ids:
            self.stdout.write('  reset: no demo advocates found — nothing to remove')
            return
        AppealDetection.objects.filter(advocate_id__in=ids).delete()
        invoice_ids = list(Invoice.objects.filter(
            advocate_id__in=ids).values_list('id', flat=True))
        InvoiceItem.objects.filter(invoice_id__in=invoice_ids).delete()
        Invoice.objects.filter(advocate_id__in=ids).delete()
        Expense.objects.filter(advocate_id__in=ids).delete()
        CaseEvent.objects.filter(advocate_id__in=ids).delete()
        CaseTask.objects.filter(advocate_id__in=ids).delete()
        CaseNote.objects.filter(advocate_id__in=ids).delete()
        for doc in Document.objects.filter(advocate_id__in=ids):
            try:
                if doc.file_path and os.path.exists(doc.file_path):
                    os.remove(doc.file_path)
            except OSError:
                pass
        Document.objects.filter(advocate_id__in=ids).delete()
        Case.objects.filter(advocate_id__in=ids).delete()
        Client.objects.filter(advocate_id__in=ids).delete()
        # Clear role grants so a role change on re-seed takes clean effect.
        AdvocateRole.objects.filter(advocate_id__in=ids).delete()
        # NOTE: the three Advocate accounts are intentionally kept. They are
        # referenced by real FK constraints (activities, audit logs, ...), so
        # deleting them fails; the seed re-uses them (get_or_create by email)
        # and re-grants their roles, so a rebuild is still clean.
        self.stdout.write(self.style.WARNING(
            '  reset: cleared demo data + role grants for {} advocate(s) '
            '(accounts kept)'.format(len(ids))))

    def _write_placeholder(self):
        """Write the placeholder PDF to the upload dir; return (path, name, size)."""
        base = getattr(settings, 'DOCUMENT_UPLOAD_DIR', None) or os.path.join(
            os.getcwd(), 'uploads')
        folder = os.path.join(base, 'documents')
        os.makedirs(folder, exist_ok=True)
        stored = '{}.pdf'.format(uuid.uuid4().hex)
        path = os.path.join(folder, stored)
        with open(path, 'wb') as fh:
            fh.write(_PLACEHOLDER_PDF)
        return path, stored, len(_PLACEHOLDER_PDF)

    # -- the seed ----------------------------------------------------------

    @transaction.atomic
    def handle(self, *args, **o):
        today = datetime.date.today()
        now = datetime.datetime.now()
        pw_hash = hash_password(o['password'])

        if o['reset']:
            self._reset()

        # 1) Users + roles + practice membership --------------------------
        advocates = {}
        for key, u in USERS.items():
            adv, created = Advocate.objects.get_or_create(
                email=u['email'],
                defaults=dict(
                    full_name=u['full_name'], password=pw_hash,
                    bar_council_id=u['bar_council_id'], role=u['role'],
                    specialization=u['specialization'], experience=10,
                    phone='+91 90000 0000{}'.format(len(advocates)),
                    office_name='Kumar & Associates', city='Chennai',
                    state='Tamil Nadu', country='India', currency='INR',
                    theme='light', email_notifications_enabled=False))
            advocates[key] = adv
            self._line('user', adv.email, created)

        # Practice membership: Rajesh owns it, Priya reports to him, Suresh
        # is a firm-wide accountant (own head; Accountant role widens scope).
        for key, u in USERS.items():
            adv = advocates[key]
            parent = None if u['parent'] in (None, 'self') else advocates[u['parent']].id
            if adv.parent_advocate_id != parent:
                adv.parent_advocate_id = parent
                Advocate.objects.filter(id=adv.id).update(parent_advocate_id=parent)
            for role_name in u['roles']:
                self._grant(adv, role_name)

        rajesh = advocates['rajesh']

        # 2) Client -------------------------------------------------------
        client, created = Client.objects.get_or_create(
            advocate=rajesh, name='ABC Constructions Pvt. Ltd.',
            defaults=dict(
                email='accounts@abcconstructions.demo', phone='+91 98400 12345',
                address='12, Anna Salai, Chennai, Tamil Nadu 600002',
                deleted=False, created_at=today - datetime.timedelta(days=40)))
        self._line('client', client.name, created)

        # 3) Matters ------------------------------------------------------
        primary, created = Case.objects.get_or_create(
            advocate=rajesh, case_number='WP/12345/2025',
            defaults=dict(
                case_title='ABC Constructions Pvt. Ltd. vs XYZ Builders',
                case_type='Writ Petition', court_level='High Court',
                status='Active', client=client,
                amount=50000, estimated_amount=50000,
                total_client_agreed_amount=50000, total_paid_by_client=8000,
                total_expenses_so_far=2900, balance_in_account=5100,
                pending_from_client=42000,
                description='Writ challenging stop-work notice on the ABC site.',
                deleted=False, created_at=today - datetime.timedelta(days=30)))
        self._line('matter (active)', primary.case_number, created)

        decided, created = Case.objects.get_or_create(
            advocate=rajesh, case_number='OS/987/2023',
            defaults=dict(
                case_title='ABC Constructions Pvt. Ltd. vs TN Housing Board',
                case_type='Original Suit', court_level='District Court',
                status='Closed', client=client, amount=30000,
                description='Suit decided in favour of ABC; now under appeal.',
                deleted=False, created_at=today - datetime.timedelta(days=200)))
        self._line('matter (decided)', decided.case_number, created)

        # 4) Hearing ------------------------------------------------------
        ev, created = CaseEvent.objects.get_or_create(
            advocate=rajesh, case=primary, title='Arguments on merits',
            date=today + datetime.timedelta(days=4),
            defaults=dict(event_type='HEARING', time=datetime.time(10, 30),
                          description='Writ petition listed for arguments.',
                          notified=False))
        self._line('hearing', '{} on {}'.format(ev.title, ev.date), created)

        # 5) Tasks --------------------------------------------------------
        for title, prio, due, done in [
            ('Draft and file the petition', 'HIGH', 3, False),
            ('Collect client documents', 'MEDIUM', 7, True),
        ]:
            t, created = CaseTask.objects.get_or_create(
                advocate_id=rajesh.id, case_id=primary.id, title=title,
                defaults=dict(priority=prio, completed=done,
                              deadline=today + datetime.timedelta(days=due)))
            self._line('task', t.title, created)

        # 6) Note ---------------------------------------------------------
        note_body = ('Client confirmed the stop-work notice was served on site. '
                     'Petition to be filed before the next listing.')
        note, created = CaseNote.objects.get_or_create(
            advocate_id=rajesh.id, case_id=primary.id, body=note_body)
        self._line('note', 'case note', created)

        # 7) Expenses -----------------------------------------------------
        for title, amount, cat in [
            ('Court filing fee', 2500, 'Court Fees'),
            ('Photocopying & typing', 400, 'Office'),
        ]:
            exp, created = Expense.objects.get_or_create(
                advocate=rajesh, case=primary, title=title,
                defaults=dict(expense_type='CLIENT_CASE', category=cat,
                              amount=amount, payment_date=today - datetime.timedelta(days=5),
                              payment_mode='BANK_TRANSFER', payment_status='PAID',
                              client=client,
                              reference_number='TXN-{}'.format(int(amount))))
            self._line('expense', '{} Rs {}'.format(exp.title, amount), created)

        # 8) Invoices (fixed numbers so re-runs are idempotent) -----------
        def make_invoice(number, amount, status, inv_date, due, items):
            inv, created = Invoice.objects.get_or_create(
                invoice_number=number,
                defaults=dict(amount=amount, invoice_date=inv_date, due_date=due,
                              status=status, advocate=rajesh, case=primary,
                              client=client))
            for pos, (desc, amt) in enumerate(items):
                InvoiceItem.objects.get_or_create(
                    invoice_id=inv.id, position=pos,
                    defaults=dict(description=desc, amount=amt))
            self._line('invoice', '{} {} Rs {}'.format(number, status, amount), created)

        make_invoice('INV-DEMO-001', 27500, 'UNPAID',
                     today - datetime.timedelta(days=2), today + datetime.timedelta(days=15),
                     [('Court appearance — writ hearing', 15000),
                      ('Drafting of petition', 10000),
                      ('Filing charges', 2500)])
        make_invoice('INV-DEMO-002', 8000, 'PAID',
                     today - datetime.timedelta(days=30), today - datetime.timedelta(days=15),
                     [('Initial consultation & opinion', 8000)])

        # 9) Documents ----------------------------------------------------
        for name, cat in [('Petition - ABC vs XYZ.pdf', 'Petition'),
                          ('Client engagement letter.pdf', 'Agreement')]:
            if Document.objects.filter(advocate=rajesh, case=primary,
                                       document_name=name).exists():
                self._line('document', name, False)
                continue
            path, stored, size = self._write_placeholder()
            doc = Document.objects.create(
                document_name=name, original_name=name, stored_name=stored,
                file_path=path, file_size=size, file_type='application/pdf',
                category=cat, description='Demo document for {}.'.format(cat),
                version=1, download_count=0, status='ACTIVE',
                upload_date=now, advocate=rajesh, case=primary, client=client)
            self._line('document', doc.document_name, True)

        # 10) Appeal Alert detection (ready-made) -------------------------
        det, created = AppealDetection.objects.get_or_create(
            advocate_id=rajesh.id, source_case_id=decided.id,
            appeal_cnr='TNHC01DEMO4562024',
            defaults=dict(
                source_case_number=decided.case_number,
                forum_court_id='ecourts_hc', forum_state_code='10',
                forum_label='Madras High Court (2024)',
                appeal_case_number='AS/456/2024',
                appeal_parties='ABC Constructions Pvt Ltd Vs TN Housing Board',
                appeal_filed_on=today - datetime.timedelta(days=20),
                matched_on='abc, constructions', match_score=0.75,
                status=AppealDetection.STATUS_NEW,
                notified_in_app=False, notified_email=False))
        self._line('appeal detection', det.appeal_case_number, created)

        self.stdout.write(self.style.SUCCESS(
            '\nDemo ready. Log in as {} / {} (Super Admin + Senior Advocate), '
            '{} (junior), {} (accountant).'.format(
                USERS['rajesh']['email'], o['password'],
                USERS['priya']['email'], USERS['suresh']['email'])))
