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


class RecipientDefaultsTest(TestCase):
    """The invoice form pre-fills the recipient's GST details from the client."""

    def setUp(self):
        import json as _json
        from clients.models import ClientProfile
        from core.testing import make_case, make_client
        self.json = _json
        self.adv = _make('billing@test.local', ALL_PERMISSIONS)
        self.client_row = make_client(self.adv, 'R. Murugan',
                                      address='No. 3, Gandhi Street, Tambaram, Tamil Nadu - 600045')
        ClientProfile.objects.create(client_id=self.client_row.id, gstin='33abcde1234f1z7',
                                     state='Tamil Nadu')
        self.case = make_case(self.adv, self.client_row)

    def test_defaults_come_from_the_client_record(self):
        resp = self.client.get('/api/invoices/recipient-defaults',
                               {'caseId': self.case.id}, **auth(self.adv))
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        d = resp.json()
        self.assertEqual(d['recipientGstin'], '33ABCDE1234F1Z7')
        self.assertEqual(d['recipientStateCode'], '33')     # from the GSTIN
        self.assertEqual(d['recipientState'], 'Tamil Nadu')
        self.assertIn('Gandhi Street', d['recipientAddress'])

    def test_another_practices_case_is_not_found(self):
        other = _make('other-billing@test.local', ALL_PERMISSIONS)
        resp = self.client.get('/api/invoices/recipient-defaults',
                               {'caseId': self.case.id}, **auth(other))
        self.assertEqual(resp.status_code, 404)

    def test_a_blank_invoice_is_filled_from_the_client(self):
        from invoices.models import InvoiceTaxDetail
        resp = self.client.post('/api/invoices/create', data=self.json.dumps({
            'caseEntity': {'id': self.case.id},
            'particulars': [{'description': 'Professional fee', 'amount': 10000}],
            'invoiceDate': '2026-09-30', 'dueDate': '2026-10-30'}),
            content_type='application/json', **auth(self.adv))
        self.assertIn(resp.status_code, (200, 201), resp.content[:300])
        tax = InvoiceTaxDetail.objects.order_by('-id').first()
        self.assertEqual((tax.recipient_gstin, tax.recipient_state_code), ('33ABCDE1234F1Z7', '33'))
        self.assertEqual(tax.place_of_supply, 'Tamil Nadu - 33')


class InvoiceRequestFlowTest(TestCase):
    """An advocate raises a case's invoice; accounts issue it or send it back.

    Until it is issued it must not be an invoice at all - no number, not in the
    totals, not sent to the client - so it is checked against `invoices` here.
    """

    def setUp(self):
        from core.testing import make_case, make_client
        self.senior = make_advocate()
        self.advocate = _make(parent_advocate_id=self.senior.id,
                              permissions=('CASE_VIEW', 'INVOICE_VIEW', 'INVOICE_CREATE'))
        self.client_row = make_client(self.senior, name='Payer')
        self.case = make_case(self.senior, client=self.client_row)
        self.body = {'caseId': self.case.id, 'invoiceNumber': 'MINE-1',
                     'particulars': [{'description': 'Appearance', 'amount': 5000}]}

    def _raise(self, body=None):
        from unittest import mock
        with mock.patch('notifications.internal_events.invoice_submitted') as sent:
            res = self.client.post('/api/invoices/requests', body or self.body,
                                   content_type='application/json', **auth(self.advocate))
        return res, sent

    def test_advocate_cannot_issue_directly(self):
        res = self.client.post('/api/invoices/create', self.body,
                               content_type='application/json', **auth(self.advocate))
        self.assertEqual(res.status_code, 403)
        self.assertFalse(Invoice.objects.exists())

    def test_raising_tells_accounts_but_makes_no_invoice(self):
        res, sent = self._raise()
        self.assertEqual(res.status_code, 201, res.content[:200])
        self.assertEqual(res.json()['status'], 'SUBMITTED')
        self.assertEqual(res.json()['amount'], 5000)
        sent.assert_called_once()
        self.assertFalse(Invoice.objects.exists())
        # The number is the accountant's to give, not the advocate's.
        self.assertNotIn('invoiceNumber', res.json()['payload'])

    def test_needs_an_amount(self):
        res, sent = self._raise({'caseId': self.case.id, 'particulars': []})
        self.assertEqual(res.status_code, 400)
        sent.assert_not_called()

    def test_issue_creates_the_invoice_raised_by_the_advocate(self):
        from unittest import mock
        req_id = self._raise()[0].json()['id']
        with mock.patch('notifications.internal_events.invoice_request_issued') as told:
            res = self.client.post('/api/invoices/requests/%d/issue' % req_id, {},
                                   content_type='application/json', **auth(self.senior))
        self.assertEqual(res.status_code, 201, res.content[:300])
        inv = Invoice.objects.get()
        self.assertEqual(inv.advocate_id, self.advocate.id)   # raised by
        self.assertEqual(inv.amount, 5000)
        self.assertTrue(inv.invoice_number.startswith('INV-'))
        self.assertEqual(res.json()['request']['status'], 'ISSUED')
        self.assertEqual(res.json()['request']['invoiceId'], inv.id)
        told.assert_called_once()
        # A second press makes no second invoice.
        again = self.client.post('/api/invoices/requests/%d/issue' % req_id, {},
                                 content_type='application/json', **auth(self.senior))
        self.assertEqual(again.status_code, 409)
        self.assertEqual(Invoice.objects.count(), 1)

    def test_accounts_can_correct_on_issue(self):
        req_id = self._raise()[0].json()['id']
        res = self.client.post('/api/invoices/requests/%d/issue' % req_id,
                               {'particulars': [{'description': 'Appearance', 'amount': 6000}]},
                               content_type='application/json', **auth(self.senior))
        self.assertEqual(res.status_code, 201, res.content[:300])
        self.assertEqual(Invoice.objects.get().amount, 6000)

    def test_advocate_cannot_issue_own_request(self):
        req_id = self._raise()[0].json()['id']
        res = self.client.post('/api/invoices/requests/%d/issue' % req_id, {},
                               content_type='application/json', **auth(self.advocate))
        self.assertEqual(res.status_code, 403)

    def test_return_then_resubmit(self):
        from unittest import mock
        req_id = self._raise()[0].json()['id']
        url = '/api/invoices/requests/%d' % req_id
        self.assertEqual(self.client.post(url + '/return', {}, content_type='application/json',
                                          **auth(self.senior)).status_code, 400)   # note required
        with mock.patch('notifications.internal_events.invoice_returned') as told:
            res = self.client.post(url + '/return', {'note': 'Add the GSTIN'},
                                   content_type='application/json', **auth(self.senior))
        self.assertEqual(res.json()['status'], 'RETURNED')
        self.assertEqual(res.json()['note'], 'Add the GSTIN')
        told.assert_called_once()
        # A returned request cannot be issued until it is sent again.
        self.assertEqual(self.client.post(url + '/issue', {}, content_type='application/json',
                                          **auth(self.senior)).status_code, 409)
        with mock.patch('notifications.internal_events.invoice_submitted') as sent:
            res = self.client.put(url, dict(self.body, recipientGstin=''),
                                  content_type='application/json', **auth(self.advocate))
        self.assertEqual(res.json()['status'], 'SUBMITTED')
        sent.assert_called_once()

    def test_only_the_raiser_edits_or_withdraws(self):
        req_id = self._raise()[0].json()['id']
        url = '/api/invoices/requests/%d' % req_id
        self.assertEqual(self.client.delete(url, **auth(self.senior)).status_code, 403)
        self.assertEqual(self.client.delete(url, **auth(self.advocate)).status_code, 204)
        listed = self.client.get('/api/invoices/requests', **auth(self.senior)).json()
        self.assertEqual(listed, [])

    def test_other_team_cannot_see_or_issue(self):
        outsider = make_advocate()
        req_id = self._raise()[0].json()['id']
        self.assertEqual(self.client.get('/api/invoices/requests', **auth(outsider)).json(), [])
        res = self.client.post('/api/invoices/requests/%d/issue' % req_id, {},
                               content_type='application/json', **auth(outsider))
        self.assertEqual(res.status_code, 404)


class InvoiceSettlementTest(TestCase):
    """Payments recorded against an invoice settle it; a cancelled invoice is
    kept but owed by nobody; each invoice says who raised and who handles it."""

    def setUp(self):
        from core.testing import make_case, make_client
        self.accounts = make_advocate()
        self.client_row = make_client(self.accounts, name='Payer')
        self.case = make_case(self.accounts, client=self.client_row)
        res = self.client.post('/api/invoices/create',
                               {'caseId': self.case.id,
                                'particulars': [{'description': 'Fee', 'amount': 10000}]},
                               content_type='application/json', **auth(self.accounts))
        self.assertEqual(res.status_code, 201, res.content[:300])
        self.inv = res.json()

    def _pay(self, amount, invoice_id=None):
        return self.client.post('/api/payments/create',
                                {'invoiceId': invoice_id or self.inv['id'], 'amount': amount,
                                 'paymentMode': 'UPI', 'paymentDate': str(datetime.date.today())},
                                content_type='application/json', **auth(self.accounts))

    def _get(self):
        rows = self.client.get('/api/invoices', **auth(self.accounts)).json()['content']
        return next(r for r in rows if r['id'] == self.inv['id'])

    def test_part_payment_then_full(self):
        self.assertEqual(self._pay(4000).status_code, 201)
        row = self._get()
        self.assertEqual(row['status'], 'PARTIAL')
        self.assertEqual(row['paidAmount'], 4000)
        self.assertEqual(row['balance'], 6000)
        s = self.client.get('/api/invoices/summary', **auth(self.accounts)).json()
        self.assertAlmostEqual(s['paidAmount'], 4000)
        self.assertAlmostEqual(s['unpaidAmount'], 6000)   # the balance, not the full bill
        self.assertEqual(self._pay(6000).status_code, 201)
        row = self._get()
        self.assertEqual((row['status'], row['balance']), ('PAID', 0))
        self.assertEqual(Case.objects.get(id=self.case.id).total_paid_by_client, 10000)

    def test_cannot_pay_more_than_the_balance(self):
        self._pay(9000)
        res = self._pay(2000)
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self._get()['balance'], 1000)

    def test_payment_links_to_its_invoice(self):
        pay = self._pay(1000).json()
        self.assertEqual(pay['invoiceId'], self.inv['id'])
        self.assertEqual(pay['invoiceNumber'], self.inv['invoiceNumber'])
        self.assertEqual(pay['caseId'], self.case.id)

    def test_cancel_needs_a_reason_and_drops_out_of_totals(self):
        url = '/api/invoices/%d/cancel' % self.inv['id']
        self.assertEqual(self.client.post(url, {}, content_type='application/json',
                                          **auth(self.accounts)).status_code, 400)
        res = self.client.post(url, {'reason': 'Wrong GST treatment'},
                               content_type='application/json', **auth(self.accounts))
        self.assertEqual(res.status_code, 200, res.content[:200])
        self.assertEqual(res.json()['status'], 'CANCELLED')
        self.assertEqual(res.json()['cancelReason'], 'Wrong GST treatment')
        s = self.client.get('/api/invoices/summary', **auth(self.accounts)).json()
        self.assertEqual(s['paid'] + s['unpaid'] + s['overdue'], 0)
        self.assertEqual(Case.objects.get(id=self.case.id).pending_from_client, 0)
        self.assertTrue(Invoice.objects.filter(id=self.inv['id']).exists())   # kept
        self.assertEqual(self._pay(100).status_code, 404)                     # not payable

    def test_cannot_cancel_once_money_received(self):
        self._pay(500)
        res = self.client.post('/api/invoices/%d/cancel' % self.inv['id'], {'reason': 'x'},
                               content_type='application/json', **auth(self.accounts))
        self.assertEqual(res.status_code, 409)

    def test_cancel_is_for_accounts(self):
        """Issuing is not enough: a senior who issues has no INVOICE_EDIT."""
        clerk = _make(parent_advocate_id=self.accounts.id, permissions=('INVOICE_VIEW', 'INVOICE_CREATE'))
        res = self.client.post('/api/invoices/%d/cancel' % self.inv['id'], {'reason': 'x'},
                               content_type='application/json', **auth(clerk))
        self.assertEqual(res.status_code, 403)

    def test_raised_and_handled_by(self):
        self.assertEqual(self.inv['raisedById'], self.accounts.id)
        self.assertEqual(self.inv['handledById'], self.accounts.id)
        self.assertEqual(self.inv['handledByName'], self.accounts.full_name)

    def test_issued_request_is_handled_by_the_issuer(self):
        adv = _make(parent_advocate_id=self.accounts.id,
                    permissions=('CASE_VIEW', 'INVOICE_VIEW', 'INVOICE_CREATE'))
        req = self.client.post('/api/invoices/requests',
                               {'caseId': self.case.id, 'particulars': [{'description': 'Fee', 'amount': 700}]},
                               content_type='application/json', **auth(adv)).json()
        inv = self.client.post('/api/invoices/requests/%d/issue' % req['id'], {},
                               content_type='application/json', **auth(self.accounts)).json()['invoice']
        self.assertEqual((inv['raisedById'], inv['handledById']), (adv.id, self.accounts.id))

    def test_older_paid_invoice_stays_paid(self):
        """Marked paid by hand, with no linked payment: not dragged back to UNPAID."""
        from core.finance import recalc_invoice_status
        Invoice.objects.filter(id=self.inv['id']).update(status='PAID')
        self.assertEqual(recalc_invoice_status(self.inv['id']).status, 'PAID')
        self.assertEqual(self._get()['balance'], 0)


class ClientNotifiedTest(TestCase):
    """Issuing is what tells the client; the invoice records whether it did."""

    def setUp(self):
        from core.testing import make_case, make_client
        self.accounts = make_advocate()
        self.case = make_case(self.accounts, client=make_client(self.accounts, name='Payer'))

    def _issue(self):
        return self.client.post('/api/invoices/create',
                                {'caseId': self.case.id, 'particulars': [{'description': 'Fee', 'amount': 500}]},
                                content_type='application/json', **auth(self.accounts)).json()

    def test_marked_when_the_email_goes(self):
        from unittest import mock
        with mock.patch('notifications.client_events.invoice_generated', return_value=[1]):
            inv = self._issue()
        self.assertIsNotNone(inv['issuedAt'])
        self.assertIsNotNone(inv['clientNotifiedAt'])

    def test_not_marked_when_no_email_was_sent(self):
        from unittest import mock
        with mock.patch('notifications.client_events.invoice_generated', return_value=[]):
            inv = self._issue()
        self.assertIsNotNone(inv['issuedAt'])
        self.assertIsNone(inv['clientNotifiedAt'])
