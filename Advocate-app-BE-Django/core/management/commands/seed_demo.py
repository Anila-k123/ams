"""Seed the "Kumar & Associates" demo practice used in the client presentation.

Creates a coherent, realistic data set so a presenter can log in and walk the
whole product through believable matters:

    firm users (senior / junior / accountant)
      -> 10 real clients (companies + individuals, Chennai / Tamil Nadu)
        -> ~15 real cases across Madras HC, Chennai District Court & Supreme Court
          -> hearings (today + upcoming), tasks, notes, expenses, invoices
          -> a populated Daily Causelist (ImportedCaseRecord + CauseListItem)
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
    Expense, Invoice, NotificationHistory,
)
from workspace.models import CaseNote, CaseTask, HearingDetail
from invoices.models import InvoiceItem
from appeals.models import AppealDetection
from courtsearch.models import ImportedCaseRecord, CauseListItem
from courtsearch.matching import case_identity

DEFAULT_PASSWORD = 'Demo@1234'

# Marker written on every CauseListItem this seed creates. The cause-list table
# is shared (not advocate-scoped), so reset deletes ONLY our tagged rows.
SEED_SOURCE = 'seed_demo'

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

# 10 real clients (all owned by Rajesh). A "company" client simply uses `name`;
# the Client model has no separate company column.
CLIENTS = [
    dict(key='saravanan', name='Saravanan Textiles Pvt. Ltd.',
         email='accounts@saravanantextiles.in', phone='+91 98400 21001',
         address='45, Kutchery Road, Mylapore, Chennai, Tamil Nadu 600004',
         created_days=140),
    dict(key='anand', name='Anand Motors Pvt. Ltd.',
         email='legal@anandmotors.in', phone='+91 98400 21002',
         address='12, Mount Road, Guindy, Chennai, Tamil Nadu 600032',
         created_days=125),
    dict(key='coromandel', name='Coromandel Exports Pvt. Ltd.',
         email='office@coromandelexports.in', phone='+91 98400 21003',
         address='8, Rajaji Salai, Parrys, Chennai, Tamil Nadu 600001',
         created_days=110),
    dict(key='deccan', name='Deccan Logistics Pvt. Ltd.',
         email='ops@deccanlogistics.in', phone='+91 98400 21004',
         address='220, GST Road, Tambaram, Chennai, Tamil Nadu 600045',
         created_days=95),
    dict(key='rajalakshmi', name='Rajalakshmi Enterprises',
         email='contact@rajalakshmient.in', phone='+91 98400 21005',
         address='17, Ranganathan Street, T. Nagar, Chennai, Tamil Nadu 600017',
         created_days=80),
    dict(key='vasanth', name='Vasanth & Co.',
         email='vasanth.co@gmail.com', phone='+91 98400 21006',
         address='5, North Usman Road, T. Nagar, Chennai, Tamil Nadu 600017',
         created_days=70),
    dict(key='lakshmi', name='Lakshmi Ramachandran',
         email='lakshmi.rama@gmail.com', phone='+91 98410 33007',
         address='3, Bazullah Road, T. Nagar, Chennai, Tamil Nadu 600017',
         created_days=60),
    dict(key='meenakshi', name='Meenakshi Sundaram',
         email='meenakshi.sundaram@gmail.com', phone='+91 98410 33008',
         address='29, Luz Church Road, Mylapore, Chennai, Tamil Nadu 600004',
         created_days=50),
    dict(key='karthik', name='Karthik Subramanian',
         email='karthik.subramanian@outlook.com', phone='+91 98410 33009',
         address='14, Habibullah Road, T. Nagar, Chennai, Tamil Nadu 600017',
         created_days=40),
    dict(key='priyav', name='Priya Venkatesan',
         email='priya.venkatesan@gmail.com', phone='+91 98410 33010',
         address='7, Dr Radhakrishnan Salai, Mylapore, Chennai, Tamil Nadu 600004',
         created_days=30),
]

# ~15 real cases. `listing` (optional) wires the case into the Daily Causelist by
# creating an ImportedCaseRecord (court identity) + a CauseListItem for today.
#   kind 'hc'  -> Madras High Court   (CNR prefix HCMA01 -> provider 'chennai')
#   kind 'dc'  -> Chennai District    (CNR prefix TNCH   -> provider 'chennai_dc')
#   kind 'sci' -> Supreme Court       (CNR prefix SCIN01 -> provider 'sci')
CASES = [
    dict(client='saravanan', number='W.P.No.15234/2025',
         title='Saravanan Textiles Pvt. Ltd. vs Commercial Tax Officer, Chennai',
         type='Writ Petition', court='High Court', status='Active',
         agreed=250000, paid=60000, expenses=18000, created_days=90,
         desc='Writ challenging a disputed VAT assessment order.',
         listing=dict(kind='hc', cnr='HCMA010152342025', case_type='WP',
                      reg='15234/2025', court_number='R7', item_number='42',
                      case_string='W.P.No.15234 of 2025', dates=[0, 7])),
    dict(client='anand', number='O.S.No.567/2024',
         title='Anand Motors Pvt. Ltd. vs Sundaram Finance Ltd.',
         type='Original Suit', court='District Court', status='Active',
         agreed=180000, paid=90000, expenses=12000, created_days=120,
         desc='Suit for recovery arising out of a hire-purchase dispute.',
         listing=dict(kind='dc', cnr='TNCH010005672024', case_type='OS',
                      reg='567/2024', court_number='III Addl. City Civil Court',
                      item_number='18', case_string='O.S.No.567 of 2024', dates=[0])),
    dict(client='coromandel', number='SLP(C) No. 23419/2026',
         title='Coromandel Exports Pvt. Ltd. vs Union of India',
         type='Special Leave Petition', court='Supreme Court', status='Active',
         agreed=600000, paid=200000, expenses=45000, created_days=60,
         desc='SLP against the Madras High Court order in the export duty matter.',
         listing=dict(kind='sci', cnr='SCIN010234192026',
                      case_number='SLP(C) No. 023419 / 2026', diary='25510/2026',
                      court_number='7', item_number='41',
                      case_string='SLP(C) No. 023419 / 2026', dates=[0])),
    dict(client='deccan', number='W.P.No.16890/2025',
         title='Deccan Logistics Pvt. Ltd. vs State of Tamil Nadu',
         type='Writ Petition', court='High Court', status='Active',
         agreed=220000, paid=50000, expenses=15000, created_days=45,
         desc='Writ challenging levy of entry tax on inter-state carriage.',
         listing=dict(kind='hc', cnr='HCMA010168902025', case_type='WP',
                      reg='16890/2025', court_number='R3', item_number='9',
                      case_string='W.P.No.16890 of 2025', dates=[0])),
    dict(client='lakshmi', number='O.S.No.892/2023',
         title='Lakshmi Ramachandran vs Revenue Divisional Officer, Chengalpattu',
         type='Original Suit', court='District Court', status='Active',
         agreed=90000, paid=45000, expenses=8000, created_days=150,
         desc='Suit for declaration of title over ancestral land.',
         listing=dict(kind='dc', cnr='TNCH010008922023', case_type='OS',
                      reg='892/2023', court_number='V Addl. Sub Court',
                      item_number='27', case_string='O.S.No.892 of 2023', dates=[0, 7])),
    dict(client='karthik', number='Crl.O.P.No.22145/2025',
         title='Karthik Subramanian vs State (Inspector of Police, T. Nagar)',
         type='Criminal Original Petition', court='High Court', status='Active',
         agreed=120000, paid=40000, expenses=9000, created_days=35,
         desc='Petition to quash proceedings in a cheque-bounce complaint.',
         listing=dict(kind='hc', cnr='HCMA010221452025', case_type='Crl.O.P.',
                      reg='22145/2025', court_number='R9', item_number='58',
                      case_string='Crl.O.P.No.22145 of 2025', dates=[0])),

    # --- cases NOT on today's cause list (variety / history) ---
    dict(client='coromandel', number='C.P.No.45/2024',
         title='In re: Coromandel Exports Pvt. Ltd.',
         type='Company Petition', court='High Court', status='Active',
         agreed=350000, paid=150000, expenses=22000, created_days=100,
         desc='Company petition for scheme of amalgamation.'),
    dict(client='rajalakshmi', number='O.S.No.1123/2022',
         title='Rajalakshmi Enterprises vs Indian Overseas Bank',
         type='Original Suit', court='District Court', status='Closed',
         agreed=140000, paid=140000, expenses=16000, created_days=320,
         desc='Suit on a wrongful debit; decreed in favour of the plaintiff.'),
    dict(client='vasanth', number='W.P.No.9087/2024',
         title='Vasanth & Co. vs Employees State Insurance Corporation',
         type='Writ Petition', court='High Court', status='Active',
         agreed=160000, paid=80000, expenses=11000, created_days=200,
         desc='Writ challenging an ESI contribution demand.'),
    dict(client='meenakshi', number='H.M.O.P.No.210/2023',
         title='Meenakshi Sundaram vs R. Sundaram',
         type='Matrimonial Petition', court='District Court', status='Active',
         agreed=75000, paid=30000, expenses=6000, created_days=180,
         desc='Petition for dissolution of marriage and maintenance.'),
    dict(client='priyav', number='C.S.No.332/2024',
         title='Priya Venkatesan vs Prestige Estates Pvt. Ltd.',
         type='Civil Suit', court='High Court', status='Active',
         agreed=300000, paid=100000, expenses=25000, created_days=75,
         desc='Suit for specific performance of an apartment sale agreement.'),
    dict(client='saravanan', number='A.S.No.56/2023',
         title='Saravanan Textiles Pvt. Ltd. vs Tamil Nadu Electricity Board',
         type='Appeal Suit', court='High Court', status='Closed',
         agreed=210000, paid=210000, expenses=20000, created_days=260,
         desc='Appeal on excess demand charges; decided in favour of the client.'),
    dict(client='anand', number='E.P.No.78/2024',
         title='Anand Motors Pvt. Ltd. vs Sundaram Finance Ltd.',
         type='Execution Petition', court='District Court', status='Active',
         agreed=60000, paid=20000, expenses=4000, created_days=40,
         desc='Execution of the decree in O.S.No.567 of 2024.'),
    dict(client='deccan', number='C.M.A.No.443/2025',
         title='Deccan Logistics Pvt. Ltd. vs National Insurance Co. Ltd.',
         type='Civil Miscellaneous Appeal', court='High Court', status='Active',
         agreed=190000, paid=70000, expenses=13000, created_days=55,
         desc='Appeal against the Tribunal award in a goods-in-transit claim.'),
    dict(client='karthik', number='Crl.A.No.88/2023',
         title='Karthik Subramanian vs State',
         type='Criminal Appeal', court='High Court', status='Closed',
         agreed=110000, paid=110000, expenses=14000, created_days=300,
         desc='Appeal against conviction; acquitted on appeal.'),
]

# A minimal but valid one-page PDF, used as the placeholder document on disk.
_PLACEHOLDER_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources"
    b"<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n"
    b"4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
    b"5 0 obj<</Length 60>>stream\n"
    b"BT /F1 20 Tf 72 700 Td (Kumar & Associates [DEMO]) Tj ET\n"
    b"endstream endobj\n"
    b"xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n"
    b"0000000101 00000 n \n0000000229 00000 n \n0000000298 00000 n \n"
    b"trailer<</Size 6/Root 1 0 R>>\nstartxref\n416\n%%EOF\n"
)


def _build_raw(listing):
    """The court-API `raw` JSON for an ImportedCaseRecord, in the exact shape
    `courtsearch.matching.case_identity` reads for each court kind."""
    kind = listing['kind']
    if kind == 'sci':
        return dict(
            fields={'CNR Number': listing['cnr'],
                    'Case Number': listing['case_number']},
            diaryNo=listing['diary'])
    # High Court / District Court share the eCourts detail shape.
    return dict(cases=[dict(detail=dict(case_details={
        'CNR Number': listing['cnr'],
        'Case Type': listing['case_type'],
        'Registration Number': listing['reg'],
    }))])


def _court_id_for(kind):
    return {'sci': 'sci', 'hc': 'ecourts_hc', 'dc': 'ecourts_dc'}[kind]


def _best_key(keys):
    """Pick the most specific identity key: prefer a typed key (non-empty type),
    then the longest type token (so 'SLP(C)' beats 'DIARY', 'OS' beats '')."""
    typed = [k for k in keys if k[0]]
    pool = typed or list(keys)
    return sorted(pool, key=lambda k: len(k[0]), reverse=True)[0]


class Command(BaseCommand):
    help = 'Seed the Kumar & Associates demo practice (idempotent; --reset to rebuild).'

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
        # Delivery-audit rows reference cases/clients by FK, so they must go
        # before the cases/clients they point at can be deleted.
        NotificationHistory.objects.filter(advocate_id__in=ids).delete()
        # Hearing side-table + cause-list wiring for the demo.
        HearingDetail.objects.filter(advocate_id__in=ids).delete()
        ImportedCaseRecord.objects.filter(advocate_id__in=ids).delete()
        # The cause-list table is shared, so only our tagged rows are removed.
        CauseListItem.objects.filter(source=SEED_SOURCE).delete()
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

    def _wire_causelist(self, advocate, case, listing, today):
        """Create the ImportedCaseRecord + CauseListItem rows that make `case`
        appear on the Daily Causelist. The CauseListItem tuple is derived from
        `case_identity(case)` itself, so it is guaranteed to match (never drifts
        from the normaliser)."""
        ImportedCaseRecord.objects.get_or_create(
            advocate_id=advocate.id, case_id=case.id,
            court_id=_court_id_for(listing['kind']),
            defaults=dict(query={}, raw=_build_raw(listing)))

        ident = case_identity(case)
        court, keys = ident['court'], ident['keys']
        if not court or not keys:
            self.stdout.write(self.style.WARNING(
                '  causelist: {} did not resolve a court/keys — skipped'.format(
                    case.case_number)))
            return
        key = _best_key(keys)
        for offset in listing.get('dates', [0]):
            ld = today - datetime.timedelta(days=offset)
            item, created = CauseListItem.objects.get_or_create(
                court=court, list_date=ld,
                case_type=key[0], case_no=key[1], case_year=key[2],
                defaults=dict(
                    court_number=listing['court_number'],
                    item_number=listing['item_number'],
                    case_string=listing['case_string'],
                    diary_number=listing.get('diary', '') or '',
                    list_type='DAILY', source=SEED_SOURCE))
            self._line('causelist', '{} @ {} [{}]'.format(
                listing['case_string'], court, ld), created)

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

        # 2) Clients (all owned by Rajesh) --------------------------------
        clients = {}
        for c in CLIENTS:
            obj, created = Client.objects.get_or_create(
                advocate=rajesh, name=c['name'],
                defaults=dict(
                    email=c['email'], phone=c['phone'], address=c['address'],
                    deleted=False,
                    created_at=today - datetime.timedelta(days=c['created_days'])))
            clients[c['key']] = obj
            self._line('client', obj.name, created)

        # 3) Cases --------------------------------------------------------
        cases = {}
        for c in CASES:
            client = clients[c['client']]
            agreed = float(c['agreed'])
            paid = float(c['paid'])
            expenses = float(c['expenses'])
            obj, created = Case.objects.get_or_create(
                advocate=rajesh, case_number=c['number'],
                defaults=dict(
                    case_title=c['title'], case_type=c['type'],
                    court_level=c['court'], status=c['status'], client=client,
                    amount=agreed, estimated_amount=agreed,
                    total_client_agreed_amount=agreed,
                    total_paid_by_client=paid,
                    total_expenses_so_far=expenses,
                    balance_in_account=round(paid - expenses, 2),
                    pending_from_client=round(agreed - paid, 2),
                    description=c['desc'], deleted=False,
                    created_at=today - datetime.timedelta(days=c['created_days'])))
            cases[c['number']] = obj
            self._line('case', '{} — {}'.format(obj.case_number, c['status']), created)

            # 3a) Daily Causelist wiring for the listed cases.
            if c.get('listing'):
                self._wire_causelist(rajesh, obj, c['listing'], today)

        # 4) Hearings & events (today + upcoming) -------------------------
        # (case_number, days_from_today, HH, MM, event_type, title)
        EVENTS = [
            ('W.P.No.15234/2025', 0, 10, 30, 'HEARING', 'Arguments on maintainability'),
            ('SLP(C) No. 23419/2026', 0, 11, 0, 'HEARING', 'Listed for admission'),
            ('O.S.No.567/2024', 0, 14, 15, 'HEARING', 'Trial — plaintiff evidence'),
            ('W.P.No.16890/2025', 3, 10, 45, 'HEARING', 'Counter to be filed'),
            ('Crl.O.P.No.22145/2025', 5, 11, 30, 'HEARING', 'Hearing on quash petition'),
            ('O.S.No.892/2023', 7, 10, 0, 'HEARING', 'Framing of issues'),
            ('W.P.No.9087/2024', 10, 12, 0, 'HEARING', 'Final hearing'),
            ('C.S.No.332/2024', 2, 15, 0, 'MEETING', 'Client conference — settlement'),
            ('C.M.A.No.443/2025', 6, 0, 0, 'PAYMENT_DUE', 'Court fee balance due'),
        ]
        events = {}
        for num, days, hh, mm, etype, title in EVENTS:
            case = cases.get(num)
            if case is None:
                continue
            ev, created = CaseEvent.objects.get_or_create(
                advocate=rajesh, case=case, title=title,
                date=today + datetime.timedelta(days=days),
                defaults=dict(
                    event_type=etype,
                    time=datetime.time(hh, mm) if (hh or mm) else None,
                    description='{} for {}.'.format(title, case.case_number),
                    notified=False))
            events[num] = ev
            self._line('event', '{} {} on {}'.format(etype, title, ev.date), created)

        # 4a) Hearing detail (courtroom / bench / purpose) for a few hearings.
        HEARING_DETAILS = [
            ('W.P.No.15234/2025', 'Arguments', 'Madras High Court',
             'Court Hall R7', "Hon'ble Mr. Justice N. Anand Venkatesh"),
            ('O.S.No.567/2024', 'Evidence', 'III Addl. City Civil Court, Chennai',
             'Court Hall 3', 'The Principal Judge'),
            ('SLP(C) No. 23419/2026', 'Admission', 'Supreme Court of India',
             'Court No. 7', "Hon'ble the Chief Justice's Bench"),
        ]
        for num, purpose, court, bench, judge in HEARING_DETAILS:
            ev = events.get(num)
            if ev is None:
                continue
            hd, created = HearingDetail.objects.get_or_create(
                event_id=ev.id,
                defaults=dict(advocate_id=rajesh.id, purpose=purpose,
                              court=court, bench_hall=bench, judge=judge))
            self._line('hearing detail', '{} — {}'.format(num, purpose), created)

        # 5) Tasks --------------------------------------------------------
        TASKS = [
            ('W.P.No.15234/2025', 'Draft rejoinder to the counter', 'HIGH', 3, False),
            ('O.S.No.567/2024', 'Prepare list of documents for trial', 'MEDIUM', 5, False),
            ('SLP(C) No. 23419/2026', 'File paper-book with the Registry', 'HIGH', 2, False),
            ('C.S.No.332/2024', 'Collect sale agreement originals from client', 'LOW', 7, True),
            ('Crl.O.P.No.22145/2025', 'Obtain certified copy of the complaint', 'MEDIUM', 4, False),
        ]
        for num, title, prio, due, done in TASKS:
            case = cases.get(num)
            if case is None:
                continue
            t, created = CaseTask.objects.get_or_create(
                advocate_id=rajesh.id, case_id=case.id, title=title,
                defaults=dict(priority=prio, completed=done,
                              deadline=today + datetime.timedelta(days=due)))
            self._line('task', t.title, created)

        # 6) Notes --------------------------------------------------------
        NOTES = [
            ('W.P.No.15234/2025',
             'Client confirmed the disputed assessment was served on 12th of last '
             'month. Interim stay to be pressed at the next listing.'),
            ('SLP(C) No. 23419/2026',
             'Condonation of 9 days delay to be sought; affidavit obtained from '
             'the Managing Director.'),
        ]
        for num, body in NOTES:
            case = cases.get(num)
            if case is None:
                continue
            note, created = CaseNote.objects.get_or_create(
                advocate_id=rajesh.id, case_id=case.id, body=body)
            self._line('note', 'note on {}'.format(num), created)

        # 7) Expenses -----------------------------------------------------
        EXPENSES = [
            ('W.P.No.15234/2025', 'Court filing fee', 2500, 'Court Fees'),
            ('W.P.No.15234/2025', 'Photocopying & typing', 600, 'Office'),
            ('O.S.No.567/2024', 'Process fee & summons', 1200, 'Court Fees'),
            ('SLP(C) No. 23419/2026', 'Paper-book printing (Registry)', 4800, 'Printing'),
            ('C.S.No.332/2024', 'Advocate commissioner fee', 3500, 'Professional'),
        ]
        for num, title, amount, cat in EXPENSES:
            case = cases.get(num)
            if case is None:
                continue
            exp, created = Expense.objects.get_or_create(
                advocate=rajesh, case=case, title=title,
                defaults=dict(expense_type='CLIENT_CASE', category=cat,
                              amount=float(amount),
                              payment_date=today - datetime.timedelta(days=5),
                              payment_mode='BANK_TRANSFER', payment_status='PAID',
                              client=case.client,
                              reference_number='TXN-{}-{}'.format(
                                  case.id, int(amount))))
            self._line('expense', '{} Rs {}'.format(exp.title, amount), created)

        # 8) Invoices (fixed numbers so re-runs are idempotent) -----------
        def make_invoice(number, case, amount, status, inv_date, due, items):
            inv, created = Invoice.objects.get_or_create(
                invoice_number=number,
                defaults=dict(amount=float(amount), invoice_date=inv_date,
                              due_date=due, status=status, advocate=rajesh,
                              case=case, client=case.client))
            for pos, (desc, amt) in enumerate(items):
                InvoiceItem.objects.get_or_create(
                    invoice_id=inv.id, position=pos,
                    defaults=dict(description=desc, amount=float(amt)))
            self._line('invoice', '{} {} Rs {}'.format(number, status, amount), created)

        make_invoice('INV-DEMO-001', cases['W.P.No.15234/2025'], 27500, 'UNPAID',
                     today - datetime.timedelta(days=2), today + datetime.timedelta(days=15),
                     [('Court appearance — writ hearing', 15000),
                      ('Drafting of petition', 10000),
                      ('Filing charges', 2500)])
        make_invoice('INV-DEMO-002', cases['O.S.No.567/2024'], 18000, 'PAID',
                     today - datetime.timedelta(days=30), today - datetime.timedelta(days=15),
                     [('Trial preparation & appearance', 18000)])
        make_invoice('INV-DEMO-003', cases['SLP(C) No. 23419/2026'], 45000, 'UNPAID',
                     today - datetime.timedelta(days=5), today + datetime.timedelta(days=20),
                     [('SLP drafting & settling', 30000),
                      ('Senior counsel briefing', 15000)])

        # 9) Documents ----------------------------------------------------
        DOCS = [
            ('W.P.No.15234/2025', 'Writ Petition - Saravanan Textiles.pdf', 'Petition'),
            ('W.P.No.15234/2025', 'Engagement letter - Saravanan Textiles.pdf', 'Agreement'),
            ('SLP(C) No. 23419/2026', 'SLP paper-book - Coromandel Exports.pdf', 'Petition'),
        ]
        for num, name, cat in DOCS:
            case = cases.get(num)
            if case is None:
                continue
            if Document.objects.filter(advocate=rajesh, case=case,
                                       document_name=name).exists():
                self._line('document', name, False)
                continue
            path, stored, size = self._write_placeholder()
            doc = Document.objects.create(
                document_name=name, original_name=name, stored_name=stored,
                file_path=path, file_size=size, file_type='application/pdf',
                category=cat, description='Demo document for {}.'.format(cat),
                version=1, download_count=0, status='ACTIVE',
                upload_date=now, advocate=rajesh, case=case, client=case.client)
            self._line('document', doc.document_name, True)

        # 10) Appeal Alert detection (ready-made, on a decided matter) -----
        decided = cases['A.S.No.56/2023']
        det, created = AppealDetection.objects.get_or_create(
            advocate_id=rajesh.id, source_case_id=decided.id,
            appeal_cnr='HCMA010004562024',
            defaults=dict(
                source_case_number=decided.case_number,
                forum_court_id='ecourts_hc', forum_state_code='10',
                forum_label='Madras High Court (2024)',
                appeal_case_number='W.A./456/2024',
                appeal_parties='Tamil Nadu Electricity Board Vs Saravanan Textiles Pvt Ltd',
                appeal_filed_on=today - datetime.timedelta(days=20),
                matched_on='saravanan, textiles', match_score=0.78,
                status=AppealDetection.STATUS_NEW,
                notified_in_app=False, notified_email=False))
        self._line('appeal detection', det.appeal_case_number, created)

        self.stdout.write(self.style.SUCCESS(
            '\nDemo ready — 10 clients, {} cases, causelist populated for today. '
            'Log in as {} / {} (Super Admin + Senior Advocate), {} (junior), '
            '{} (accountant).'.format(
                len(CASES), USERS['rajesh']['email'], o['password'],
                USERS['priya']['email'], USERS['suresh']['email'])))
