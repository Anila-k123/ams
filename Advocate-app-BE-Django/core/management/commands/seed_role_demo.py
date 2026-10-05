"""Give the "Kumar & Associates" demo firm one login per role.

The real-case demo (docs/DEMO_GUIDE.md) already holds the matters, clients,
invoices and tasks. This command adds the PEOPLE needed to show how each role
differs, and a little role-specific activity on those same real cases:

    Meena Iyer     Super Admin       firm administration (users, roles, audit)
    Rajesh Kumar   Senior Advocate   practice owner; no longer also Super Admin
    Arjun Menon    Senior Advocate   second senior, heading his OWN team in the firm;
                                     two matters moved to him (Rajesh's team no longer sees them)
    Priya Nair     Advocate   (existing) also registers a walk-in client and
                                     books a consultation - there is no front desk
    Karthik R.     Intern            one research task
    Suresh Kumar   Accountant        linked into the firm; records a part-payment
    Anand Joshi    Client            (existing) O.S. No. 150/2025
    (Kannan and O.S. No. 900/2025 are created live in the demo - see
     docs/DEMO_OS900_2025.md - so this command no longer adds his login.)

It also applies two role-policy changes (they are global, since roles are
shared):

    Advocate    gains INVOICE_VIEW / INVOICE_CREATE - the advocate running a
                case raises its invoice; accounts (INVOICE_ISSUE) issue it.
                See invoices.models.InvoiceRequest.
    Advocate    loses PAYMENT_VIEW / EXPENSE_VIEW / REPORT_VIEW - collecting
                and the firm's figures stay with seniors and the accountant.
    Advocate    gains CLIENT_CREATE / CLIENT_EDIT - advocates do their own
                client intake (the Receptionist role was removed; see
                rbac/management/commands/remove_receptionist_role.py).
    Accountant  gains CASE_VIEW / CLIENT_VIEW - the invoice form's case
                and client pickers need them (/api/cases/my-cases).
    Accountant  also loses TASK_VIEW - accounts is not given tasks.

Everything goes through the ORM, so no emails or notifications fire. Idempotent:
each row is found by a natural key first, so a second run changes nothing.
Nothing is deleted.

    python manage.py seed_role_demo
    python manage.py seed_role_demo --password 'Other@123'
"""

from __future__ import annotations

import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from clientaccess.models import ClientUser
from core.models import (Advocate, AdvocateRole, Case, CaseEvent, Client,
                         ClientPayment, Permission, Role, RolePermission)
from core.passwords import hash_password
from workspace.models import CaseTask
from core.practice import practice_ids

DEFAULT_PASSWORD = 'Demo@1234'
OWNER_EMAIL = 'rajesh@kumar-associates.demo'

# email -> (full name, role, bar council id / staff code, phone)
# Seniors who head their own team inside the firm (not members of Rajesh's).
OWN_TEAM = {'arjun@kumar-associates.demo'}

STAFF = {
    'admin@kumar-associates.demo': (
        'Meena Iyer', 'Super Admin', 'TN/ADM/0001', '+91 90000 00011'),
    'arjun@kumar-associates.demo': (
        'Arjun Menon', 'Senior Advocate', 'TN/2210/2006', '+91 90000 00012'),
    'karthik.intern@kumar-associates.demo': (
        'Karthik R.', 'Intern', 'TN/INT/2026/07', '+91 90000 00013'),
}
EXISTING_MEMBERS = ('priya@kumar-associates.demo', 'suresh@kumar-associates.demo')

# Matters handed to the second senior, by case number.
ARJUN_CASES = ('A.S. No. 700/2025', 'C.M.A. No. 1200/2025')

# role name -> (codes to grant, codes to revoke)
ROLE_POLICY = {
    # No front desk: advocates register clients themselves, and raise their
    # cases' invoices for accounts to issue; collecting stays with seniors.
    'Advocate': (('CLIENT_CREATE', 'CLIENT_EDIT', 'INVOICE_VIEW', 'INVOICE_CREATE'),
                 ('PAYMENT_VIEW', 'EXPENSE_VIEW', 'REPORT_VIEW')),
    # Accounts bills cases and clients; it is not handed tasks.
    'Accountant': (('CASE_VIEW', 'CLIENT_VIEW'), ('TASK_VIEW',)),
}

CLIENT_LOGINS = {
    # login email -> client name (must already exist in the firm)
    'anand.joshi@clients.demo': 'K. M. Anand Joshi',
}


class Command(BaseCommand):
    help = 'Add one demo login per role to the Kumar & Associates demo firm.'

    def add_arguments(self, parser):
        parser.add_argument('--password', default=DEFAULT_PASSWORD)

    def _line(self, label, what, changed):
        self.stdout.write('  {:<9} {} - {}'.format(
            label, what, 'created/updated' if changed else 'already present'))

    def _role(self, name):
        role = Role.objects.filter(name=name).first()
        if role is None:
            raise CommandError('Role {!r} not found - run the RBAC seeds first.'.format(name))
        return role

    def _only_role(self, advocate, role_name):
        """Leave this advocate with exactly one role, so the demo is unambiguous."""
        role = self._role(role_name)
        extra = AdvocateRole.objects.filter(advocate_id=advocate.id).exclude(role_id=role.id)
        changed = extra.exists()
        extra.delete()
        _, created = AdvocateRole.objects.get_or_create(advocate_id=advocate.id, role_id=role.id)
        return changed or created

    def _apply_role_policy(self):
        now = datetime.datetime.now()
        for role_name, (grant, revoke) in ROLE_POLICY.items():
            role = self._role(role_name)
            for code in grant:
                perm = Permission.objects.filter(name=code).first()
                if perm is None:
                    raise CommandError('Permission {!r} not found.'.format(code))
                _, created = RolePermission.objects.get_or_create(
                    role_id=role.id, permission_id=perm.id,
                    defaults=dict(created_at=now))
                self._line('grant', '{} +{}'.format(role_name, code), created)
            for code in revoke:
                ids = Permission.objects.filter(name=code).values_list('id', flat=True)
                n, _ = RolePermission.objects.filter(
                    role_id=role.id, permission_id__in=list(ids)).delete()
                self._line('revoke', '{} -{}'.format(role_name, code), bool(n))

    def _staff(self, email, full_name, role_name, code, phone, owner, pw_hash):
        # A second senior heads his OWN team in the firm (firms.FirmTeam), so
        # his matters are not visible to Rajesh's juniors, and vice versa.
        parent_id = None if email in OWN_TEAM else owner.id
        adv, created = Advocate.objects.get_or_create(
            email=email,
            defaults=dict(
                full_name=full_name, password=pw_hash, bar_council_id=code,
                role='ADVOCATE', phone=phone, office_name='Kumar & Associates',
                city='Chennai', state='Tamil Nadu', country='India',
                currency='INR', theme='light', whatsapp_enabled=False,
                email_notifications_enabled=False,
                browser_notifications_enabled=True,
                parent_advocate_id=parent_id))
        moved = False
        if adv.parent_advocate_id != parent_id:
            Advocate.objects.filter(id=adv.id).update(parent_advocate_id=parent_id)
            adv.parent_advocate_id = parent_id
            moved = True
        if parent_id is None:
            from firms.models import FirmTeam
            FirmTeam.objects.update_or_create(team_root_id=owner.id, defaults={'firm_root_id': owner.id})
            FirmTeam.objects.update_or_create(team_root_id=adv.id, defaults={'firm_root_id': owner.id})
        roles_changed = self._only_role(adv, role_name)
        self._line('user', '{} ({})'.format(email, role_name),
                   created or moved or roles_changed)
        return adv

    @transaction.atomic
    def handle(self, *args, **o):
        owner = Advocate.objects.filter(email=OWNER_EMAIL).first()
        if owner is None:
            raise CommandError('{} not found - load the real-case demo first.'.format(OWNER_EMAIL))
        pw_hash = hash_password(o['password'])
        today = datetime.date.today()

        # Case alerts follow CASE_ALERTS, not CASE_VIEW, so the accountant can
        # view cases for billing without getting hearing alerts.
        from django.core.management import call_command
        call_command('seed_alert_permissions', stdout=self.stdout)
        self._apply_role_policy()

        # 1) People ---------------------------------------------------------
        # Rajesh keeps the practice but stops being Super Admin: the admin is
        # now a separate person, which is the point of the demo.
        self._line('role', 'Rajesh -> Senior Advocate only',
                   self._only_role(owner, 'Senior Advocate'))
        staff = {email: self._staff(email, *spec, owner=owner, pw_hash=pw_hash)
                 for email, spec in STAFF.items()}

        # Priya and Suresh exist; make sure both sit inside the firm. Suresh was
        # created without a parent, which left him an empty firm of his own.
        for email in EXISTING_MEMBERS:
            adv = Advocate.objects.filter(email=email).first()
            if adv is None:
                self.stdout.write(self.style.WARNING('  {} missing, skipped'.format(email)))
                continue
            changed = adv.parent_advocate_id != owner.id
            if changed:
                Advocate.objects.filter(id=adv.id).update(parent_advocate_id=owner.id)
            self._line('member', email, changed)
            staff[email] = adv

        arjun = staff['arjun@kumar-associates.demo']
        intern = staff['karthik.intern@kumar-associates.demo']
        junior = staff.get('priya@kumar-associates.demo') or Advocate.objects.filter(
            email='priya@kumar-associates.demo').first()
        suresh = staff.get('suresh@kumar-associates.demo')

        # 2) Client logins ---------------------------------------------------
        client_role = self._role('Client')
        for email, client_name in CLIENT_LOGINS.items():
            client = Client.objects.filter(advocate_id=owner.id, name=client_name).first()
            if client is None:
                self.stdout.write(self.style.WARNING('  client {!r} missing, skipped'.format(client_name)))
                continue
            login, created = Advocate.objects.get_or_create(
                email=email,
                defaults=dict(
                    full_name=client_name, password=pw_hash,
                    bar_council_id='CLIENT-{}'.format(client.id), role='CLIENT',
                    theme='light', whatsapp_enabled=False,
                    email_notifications_enabled=False,
                    browser_notifications_enabled=False, parent_advocate_id=None))
            AdvocateRole.objects.get_or_create(advocate_id=login.id, role_id=client_role.id)
            _, linked = ClientUser.objects.get_or_create(
                advocate_id=login.id,
                defaults=dict(client_id=client.id, created_by_id=owner.id,
                              activated_at=datetime.datetime.now()))
            self._line('client', '{} -> {}'.format(email, client_name), created or linked)

        # 3) Role showcase activity on the real cases -----------------------
        cases = {c.case_number: c for c in Case.objects.filter(advocate_id__in=[owner.id, arjun.id])}

        # Second senior owns two matters (shows ownership / transfer). They move
        # to his team with their hearings, bills and notes (a cross-team move).
        from cases.views import _move_matter
        for number in ARJUN_CASES:
            case = cases.get(number)
            if case and case.advocate_id != arjun.id:
                _move_matter(case, arjun)
                self._line('case', '{} -> Arjun'.format(number), True)
            elif case:
                self._line('case', '{} -> Arjun'.format(number), False)

        # Intern: a research task, assigned by Rajesh.
        slp = cases.get('SLP(C) No. 12710/2026')
        if slp:
            _, created = CaseTask.objects.get_or_create(
                advocate_id=owner.id, case_id=slp.id,
                title='Research note: recent SC rulings on condonation of delay',
                defaults=dict(priority='MEDIUM', assigned_to_id=intern.id,
                              assigned_by_id=owner.id,
                              deadline=today + datetime.timedelta(days=4)))
            self._line('task', 'intern research task', created)
            # Karthik has handed it back with a report - a non-drafting task
            # waiting for Rajesh's review, to show the Submit work flow.
            from workspace.models import TaskSubmission
            task = CaseTask.objects.get(advocate_id=owner.id, case_id=slp.id,
                                        title='Research note: recent SC rulings on condonation of delay')
            if not TaskSubmission.objects.filter(task_id=task.id).exists():
                TaskSubmission.objects.create(
                    task_id=task.id, submitted_by_id=intern.id, hours=2.5,
                    note=('Found 3 recent Supreme Court rulings on condonation of delay:\n'
                          '1. Sheo Raj Singh v. Union of India (2023) - "sufficient cause" read liberally.\n'
                          '2. Pathapati Subba Reddy v. Special Deputy Collector (2024) - delay alone is no bar, but no premium on negligence.\n'
                          '3. Esha Bhattacharjee v. Raghunathpur Nafar Academy (2013) - the guiding principles.\n'
                          'Summary: our 94-day delay is explainable if the medical records are filed with the application.'))
                CaseTask.objects.filter(id=task.id).update(
                    review_status='SUBMITTED', submitted_at=datetime.datetime.now())
                self._line('submit', 'intern research report (awaiting review)', True)
            else:
                self._line('submit', 'intern research report (awaiting review)', False)

        # No front desk: the junior registers a walk-in and books a consultation.
        # Found by name within the practice, not by creator, so a row handed to
        # the owner when the Receptionist role was removed isn't duplicated.
        in_firm = practice_ids(owner)
        created = False
        if junior and not Client.objects.filter(advocate_id__in=in_firm, name='Selvi Ramasamy').exists():
            Client.objects.create(
                advocate_id=junior.id, name='Selvi Ramasamy', email='selvi.ramasamy@clients.demo',
                phone='+91 98410 55021', address='22, Arcot Road, Vadapalani, Chennai 600026',
                deleted=False, created_at=today)
            created = True
        self._line('client', 'walk-in enquiry (by the junior)', created)
        cma = cases.get('C.M.A. No. 1200/2025')
        if cma and junior:
            created = False
            if not CaseEvent.objects.filter(case_id=cma.id, event_type='MEETING',
                                            title='Client consultation - Mathankumar').exists():
                CaseEvent.objects.create(
                    case_id=cma.id, advocate_id=junior.id, event_type='MEETING',
                    title='Client consultation - Mathankumar',
                    date=today + datetime.timedelta(days=3), time=datetime.time(11, 0),
                    description='Booked by the advocate')
                created = True
            self._line('event', 'consultation booked by the junior', created)

        # Accountant: a part-payment against the SLP invoice.
        if suresh and slp:
            _, created = ClientPayment.objects.get_or_create(
                advocate_id=suresh.id, case_id=slp.id, client_id=slp.client_id,
                reference_number='NEFT-DEMO-26092801',
                defaults=dict(amount=100000.0, payment_mode='NEFT',
                              payment_date=today - datetime.timedelta(days=1),
                              description='Part-payment against INV-000006'))
            self._line('payment', 'part-payment recorded by accountant', created)

        self.stdout.write(self.style.SUCCESS(
            'Role demo ready. Every login uses password {!r}.'.format(o['password'])))
