"""Tests for the money figures the dashboard shows.

The invoice summary drives cards labelled "Total cash collected", "Outstanding
client dues" and "Payment deadline passed". It once returned COUNTS while the
frontend formatted them as currency, so 7 paid invoices displayed as "Rs 7".
Wrong money on screen is the kind of error nobody reports as a bug - they just
stop trusting the number - so the arithmetic is pinned down here.
"""

from __future__ import annotations

import datetime

from django.test import TestCase

from core.models import Case, Client, Invoice
from core.testing import ALL_PERMISSIONS, auth, make_advocate as _make


def make_advocate(email=None):
    # Permissions resolve through advocate_roles -> role_permissions, so an
    # advocate with no role is refused by every gated endpoint regardless of
    # what their `role` string says.
    return _make(email=email, permissions=ALL_PERMISSIONS)


class InvoiceSummaryTest(TestCase):
    """Paid / outstanding / overdue must be amounts, split on the right rules."""

    def setUp(self):
        self.advocate = make_advocate()
        self.client_row = Client.objects.create(
            name='Payer', deleted=False, advocate_id=self.advocate.id)
        # invoices.case_id and client_id are both NOT NULL in the schema, so an
        # invoice always belongs to a case.
        self.case = Case.objects.create(
            case_number='INV/1/2026', case_title='Billing Case', status='Active',
            deleted=False, advocate_id=self.advocate.id, client=self.client_row)
        today = datetime.date.today()
        self.today = today

        def invoice(number, amount, status, due, inv_date=None):
            return Invoice.objects.create(
                invoice_number=number, amount=amount, status=status,
                invoice_date=inv_date or today, due_date=due,
                advocate_id=self.advocate.id, client=self.client_row,
                case=self.case)

        # 2 paid, 1 overdue, 1 not yet due.
        invoice('P-1', 1000.0, 'PAID', today)
        invoice('P-2', 2500.50, 'PAID', today)
        invoice('O-1', 700.0, 'UNPAID', today - datetime.timedelta(days=10))
        invoice('U-1', 300.0, 'UNPAID', today + datetime.timedelta(days=10))

    def _summary(self):
        res = self.client.get('/api/invoices/summary', **auth(self.advocate))
        self.assertEqual(res.status_code, 200, res.content[:200])
        return res.json()

    def test_amounts_are_amounts_not_counts(self):
        s = self._summary()
        # 1000 + 2500.50 - the bug returned 2 here.
        self.assertAlmostEqual(s['paidAmount'], 3500.50, places=2)
        self.assertNotEqual(s['paidAmount'], s['paid'])

    def test_overdue_is_past_due_date_and_unpaid(self):
        s = self._summary()
        self.assertEqual(s['overdue'], 1)
        self.assertAlmostEqual(s['overdueAmount'], 700.0, places=2)

    def test_unpaid_excludes_overdue(self):
        """An invoice is counted once: overdue or outstanding, never both."""
        s = self._summary()
        self.assertEqual(s['unpaid'], 1)
        self.assertAlmostEqual(s['unpaidAmount'], 300.0, places=2)
        self.assertEqual(s['paid'] + s['unpaid'] + s['overdue'], 4)

    def test_a_paid_invoice_is_never_overdue(self):
        """Paid wins over the due date - a settled invoice is not a debt."""
        Invoice.objects.create(
            invoice_number='P-OLD', amount=999.0, status='PAID',
            invoice_date=self.today - datetime.timedelta(days=60),
            due_date=self.today - datetime.timedelta(days=30),
            advocate_id=self.advocate.id, client=self.client_row, case=self.case)
        s = self._summary()
        self.assertEqual(s['overdue'], 1, 'the old PAID invoice must not be overdue')
        self.assertAlmostEqual(s['paidAmount'], 3500.50 + 999.0, places=2)

    def test_an_invoice_cannot_exist_without_an_amount(self):
        """The schema forbids it, so the totals can never meet a null.

        Every column on `invoices` is NOT NULL, which is why the view's
        `inv.amount or 0` guard is defensive rather than load-bearing. Worth
        pinning: if a future migration relaxes this, the totals silently start
        treating a missing amount as zero and nobody notices.
        """
        from django.db import IntegrityError, transaction
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Invoice.objects.create(
                    invoice_number='NULL-1', amount=None, status='PAID',
                    invoice_date=self.today, due_date=self.today,
                    advocate_id=self.advocate.id, client=self.client_row,
                    case=self.case)


class InvoiceScopeTest(TestCase):
    """One advocate's money must never appear in another's totals."""

    def setUp(self):
        self.a = make_advocate('a@test.local')
        self.b = make_advocate('b@test.local')
        today = datetime.date.today()
        for adv, number, amount in ((self.a, 'A-1', 100.0), (self.b, 'B-1', 5000.0)):
            client_row = Client.objects.create(
                name='C-' + number, deleted=False, advocate_id=adv.id)
            case = Case.objects.create(
                case_number='SC/%s/2026' % number, case_title='Scope',
                status='Active', deleted=False, advocate_id=adv.id,
                client=client_row)
            Invoice.objects.create(
                invoice_number=number, amount=amount, status='PAID',
                invoice_date=today, due_date=today,
                advocate_id=adv.id, client=client_row, case=case)

    def test_totals_are_scoped_to_the_caller(self):
        for advocate, expected in ((self.a, 100.0), (self.b, 5000.0)):
            res = self.client.get('/api/invoices/summary', **auth(advocate))
            self.assertEqual(res.status_code, 200)
            self.assertAlmostEqual(res.json()['paidAmount'], expected, places=2)

    def test_invoice_list_is_scoped_to_the_caller(self):
        res = self.client.get('/api/invoices', **auth(self.a))
        self.assertEqual(res.status_code, 200)
        body = res.json()
        rows = body['content'] if isinstance(body, dict) else body
        numbers = {r.get('invoiceNumber') or r.get('invoice_number') for r in rows}
        self.assertIn('A-1', numbers)
        self.assertNotIn('B-1', numbers)


class AuthRequiredTest(TestCase):
    """Money endpoints must refuse an unauthenticated caller."""

    def test_no_token_is_rejected(self):
        for url in ('/api/invoices', '/api/invoices/summary', '/api/payments'):
            res = self.client.get(url)
            self.assertIn(
                res.status_code, (401, 403),
                '%s answered %s without a token' % (url, res.status_code))
