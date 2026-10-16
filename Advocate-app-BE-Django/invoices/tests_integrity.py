"""Phase 7: billing integrity across three firms (firm mode).

Firm-specific numbering (and its database uniqueness), safe numbering under
concurrent requests, atomic creation, valid status transitions, Decimal amount
validation, idempotent and duplicate-proof payments, firm-scoped access and
audit. Law-firm billing of clients only - AMS subscription billing is not here.
"""
import datetime
import threading
import uuid

from django.db import IntegrityError, connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings

from core.models import AuditLog, ClientPayment, Invoice
from core.testing import auth, make_case, make_client, make_firm, make_firm_member
from firms.models import FirmSettings
from invoices import numbering
from invoices.models import InvoiceItem, InvoiceSequence, PaymentInvoice, PaymentRequestKey


def _create(test, who, case, **body):
    body = {'caseId': case.id, 'particulars': [{'description': 'Fee', 'amount': 1000}], **body}
    return test.client.post('/api/invoices/create', body, content_type='application/json', **auth(who))


def _pay(test, who, key=None, **body):
    headers = {'HTTP_IDEMPOTENCY_KEY': key} if key else {}
    return test.client.post('/api/payments/create', body, content_type='application/json',
                            **auth(who), **headers)


class _Firms:
    def build(self):
        self.firm = {k: make_firm(k) for k in 'ABC'}
        self.user = {k: make_firm_member(self.firm[k]) for k in 'ABC'}
        self.case = {k: make_case(self.user[k], client=make_client(self.user[k], name=f'Client {k}'))
                     for k in 'ABC'}


@override_settings(TENANCY_MODE='firm')
class NumberingTests(_Firms, TestCase):
    def setUp(self):
        self.build()

    def test_each_firm_numbers_independently(self):
        a1 = _create(self, self.user['A'], self.case['A']).json()['invoiceNumber']
        a2 = _create(self, self.user['A'], self.case['A']).json()['invoiceNumber']
        b1 = _create(self, self.user['B'], self.case['B']).json()['invoiceNumber']
        c1 = _create(self, self.user['C'], self.case['C']).json()['invoiceNumber']
        self.assertEqual((a1, a2), ('INV-000001', 'INV-000002'))
        # The same number in two firms is allowed (unique per firm only).
        self.assertEqual(b1, 'INV-000001')
        self.assertEqual(c1, 'INV-000001')

    def test_database_refuses_a_duplicate_within_one_firm(self):
        _create(self, self.user['A'], self.case['A'])
        inv = Invoice.objects.get(firm_id=self.firm['A'].id)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Invoice.objects.create(invoice_number=inv.invoice_number, amount=1, invoice_date=inv.invoice_date,
                                   due_date=inv.due_date, status='UNPAID', advocate_id=self.user['A'].id,
                                   case=self.case['A'], client_id=self.case['A'].client_id)

    def test_existing_invoices_keep_their_numbers_and_numbering_continues_after_them(self):
        today = datetime.date.today()
        old = Invoice.objects.create(invoice_number='INV-000041', amount=500, invoice_date=today, due_date=today,
                                     status='UNPAID', advocate_id=self.user['A'].id, case=self.case['A'],
                                     client_id=self.case['A'].client_id)
        legacy = Invoice.objects.create(invoice_number='INV-HCL-002', amount=500, invoice_date=today,
                                        due_date=today, status='PAID', advocate_id=self.user['A'].id,
                                        case=self.case['A'], client_id=self.case['A'].client_id)
        new = _create(self, self.user['A'], self.case['A']).json()['invoiceNumber']
        self.assertEqual(new, 'INV-000042')
        old.refresh_from_db()
        legacy.refresh_from_db()
        self.assertEqual((old.invoice_number, legacy.invoice_number), ('INV-000041', 'INV-HCL-002'))

    def test_typed_number_is_checked_within_the_firm_only(self):
        self.assertEqual(_create(self, self.user['A'], self.case['A'], invoiceNumber='KA-7').status_code, 201)
        self.assertEqual(_create(self, self.user['A'], self.case['A'], invoiceNumber='KA-7').status_code, 409)
        # Another firm may use it; and the 409 above never revealed firm B's numbers.
        self.assertEqual(_create(self, self.user['B'], self.case['B'], invoiceNumber='KA-7').status_code, 201)

    def test_financial_year_numbering_with_the_firms_prefix(self):
        FirmSettings.objects.filter(firm=self.firm['B']).update(invoice_prefix='KB/', invoice_fy_reset=True)
        fy = numbering.financial_year(datetime.date.today())
        self.assertEqual(_create(self, self.user['B'], self.case['B']).json()['invoiceNumber'], f'KB/{fy}/0001')
        self.assertEqual(_create(self, self.user['B'], self.case['B']).json()['invoiceNumber'], f'KB/{fy}/0002')
        self.assertEqual(numbering.financial_year(datetime.date(2027, 3, 31)), '2026-27')
        self.assertEqual(numbering.financial_year(datetime.date(2027, 4, 1)), '2027-28')

    def test_a_failed_creation_saves_nothing_and_gives_the_number_back(self):
        from unittest import mock
        with mock.patch('invoices.views.InvoiceTaxDetail.objects.create', side_effect=RuntimeError('disk')):
            with self.assertRaises(RuntimeError):
                _create(self, self.user['A'], self.case['A'])
        self.assertFalse(Invoice.objects.filter(firm_id=self.firm['A'].id).exists())
        self.assertFalse(InvoiceItem.objects.exists())
        self.assertEqual(_create(self, self.user['A'], self.case['A']).json()['invoiceNumber'], 'INV-000001')


@override_settings(TENANCY_MODE='firm')
class AmountAndTransitionTests(_Firms, TestCase):
    def setUp(self):
        self.build()

    def test_bad_amounts_are_refused(self):
        a, case = self.user['A'], self.case['A']
        for particulars in ([{'description': 'Fee', 'amount': -50}],
                            [{'description': 'Fee', 'amount': '10.555'}],
                            [{'description': 'Fee', 'amount': 'ten'}],
                            [{'description': 'Fee', 'amount': 0}]):
            self.assertEqual(_create(self, a, case, particulars=particulars).status_code, 400, particulars)
        self.assertEqual(_create(self, a, case, gstRate=7).status_code, 400)
        self.assertEqual(_create(self, a, case, currency='USD').status_code, 400)
        self.assertFalse(Invoice.objects.exists())

    def test_decimal_gst_has_no_float_drift(self):
        # Forward charge needs both locations (invoices/gst.py): same state here.
        self.user['A'].state = 'Tamil Nadu'
        self.user['A'].save()
        r = _create(self, self.user['A'], self.case['A'], taxMode='forward', gstRate=18, recipientState='Tamil Nadu',
                    particulars=[{'description': 'a', 'amount': '0.10'}, {'description': 'b', 'amount': '0.20'}])
        inv = Invoice.objects.get(id=r.json()['id'])
        # 0.30 + 18% = 0.354 -> 0.35 (CGST 0.03 + SGST 0.02 -> total 0.35)
        self.assertEqual(inv.amount, 0.35)

    def test_status_transitions(self):
        a = self.user['A']
        inv = _create(self, a, self.case['A']).json()
        cancel = lambda i: self.client.post(f'/api/invoices/{i}/cancel', {'reason': 'wrong'},  # noqa: E731
                                            content_type='application/json', **auth(a))
        mark_paid = lambda i: self.client.put(f'/api/invoices/pay/{i}', **auth(a))  # noqa: E731
        self.assertEqual(mark_paid(inv['id']).status_code, 200)
        self.assertEqual(mark_paid(inv['id']).status_code, 200)            # a retry is harmless
        self.assertEqual(cancel(inv['id']).status_code, 409)               # PAID -> CANCELLED refused
        other = _create(self, a, self.case['A']).json()
        self.assertEqual(cancel(other['id']).status_code, 200)
        self.assertEqual(mark_paid(other['id']).status_code, 409)          # CANCELLED -> PAID refused
        from core.finance import TransitionError, check_invoice_transition
        with self.assertRaises(TransitionError):
            check_invoice_transition('PAID', 'UNPAID')


@override_settings(TENANCY_MODE='firm')
class PaymentTests(_Firms, TestCase):
    def setUp(self):
        self.build()
        self.inv = _create(self, self.user['A'], self.case['A']).json()

    def test_a_retried_payment_is_recorded_once(self):
        key = str(uuid.uuid4())
        body = {'invoiceId': self.inv['id'], 'amount': '400', 'paymentMode': 'UPI', 'referenceNumber': 'UTR1'}
        first = _pay(self, self.user['A'], key, **body)
        again = _pay(self, self.user['A'], key, **body)
        self.assertEqual((first.status_code, again.status_code), (201, 200))
        self.assertEqual(first.json()['id'], again.json()['id'])
        self.assertEqual(ClientPayment.objects.filter(case_id=self.case['A'].id).count(), 1)
        # Same key, different payment -> refused, nothing recorded.
        other = _pay(self, self.user['A'], key, **{**body, 'amount': '300'})
        self.assertEqual(other.json()['code'], 'IDEMPOTENCY_MISMATCH')
        self.assertEqual(ClientPayment.objects.count(), 1)

    def test_the_same_money_entered_twice_is_caught(self):
        body = {'invoiceId': self.inv['id'], 'amount': '100', 'referenceNumber': 'CHQ-77'}
        self.assertEqual(_pay(self, self.user['A'], **body).status_code, 201)
        dup = _pay(self, self.user['A'], **body)
        self.assertEqual((dup.status_code, dup.json()['code']), (409, 'DUPLICATE_REFERENCE'))
        # One cheque split over two invoices is fine.
        inv2 = _create(self, self.user['A'], self.case['A']).json()
        self.assertEqual(_pay(self, self.user['A'], invoiceId=inv2['id'], amount='100',
                              referenceNumber='CHQ-77').status_code, 201)

    def test_bad_payments_are_refused(self):
        a, inv = self.user['A'], self.inv['id']
        tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
        self.assertEqual(_pay(self, a, invoiceId=inv, amount='1000.01').status_code, 400)  # over the balance
        self.assertEqual(_pay(self, a, invoiceId=inv, amount='10.001').status_code, 400)
        self.assertEqual(_pay(self, a, invoiceId=inv, amount='-5').status_code, 400)
        self.assertEqual(_pay(self, a, invoiceId=inv, amount='5', paymentDate=tomorrow).status_code, 400)
        self.assertEqual(_pay(self, a, invoiceId=inv, amount='5', paymentDate='31-31-2026').status_code, 400)
        self.assertFalse(ClientPayment.objects.exists())

    def test_part_payments_move_the_status(self):
        a, inv = self.user['A'], self.inv['id']
        _pay(self, a, invoiceId=inv, amount='400.50')
        self.assertEqual(Invoice.objects.get(id=inv).status, 'PARTIAL')
        _pay(self, a, invoiceId=inv, amount='599.50')
        self.assertEqual(Invoice.objects.get(id=inv).status, 'PAID')
        self.assertEqual(_pay(self, a, invoiceId=inv, amount='1').status_code, 409)

    def test_another_firm_cannot_touch_the_invoice(self):
        b, inv = self.user['B'], self.inv['id']
        self.assertEqual(_pay(self, b, invoiceId=inv, amount='10').status_code, 404)
        self.assertEqual(self.client.put(f'/api/invoices/pay/{inv}', **auth(b)).status_code, 404)
        self.assertEqual(self.client.post(f'/api/invoices/{inv}/cancel', {'reason': 'x'},
                                          content_type='application/json', **auth(b)).status_code, 404)
        self.assertEqual(self.client.get(f'/api/reports/invoice/{inv}', **auth(b)).status_code, 404)
        listed = self.client.get('/api/invoices/my-invoices', **auth(b)).json()
        self.assertNotIn(inv, [i['id'] for i in listed])
        self.assertEqual(Invoice.objects.get(id=inv).status, 'UNPAID')

    def test_financial_changes_are_audited_in_the_right_firm(self):
        _pay(self, self.user['A'], invoiceId=self.inv['id'], amount='10')
        issued = AuditLog.objects.get(action_type='INVOICE_ISSUE', entity_id=self.inv['id'])
        paid = AuditLog.objects.get(action_type='PAYMENT_CREATE')
        self.assertEqual({issued.firm_id, paid.firm_id}, {self.firm['A'].id})
        self.assertIn('"amount": "10.00"', paid.metadata)


@override_settings(TENANCY_MODE='firm')
class ConcurrencyTests(_Firms, TransactionTestCase):
    """Real concurrent requests: separate threads, separate database connections."""

    def setUp(self):
        self.build()

    def _parallel(self, fn, n):
        barrier, results = threading.Barrier(n), []

        def run(i):
            try:
                barrier.wait()
                results.append(fn(i))
            finally:
                connections.close_all()
        threads = [threading.Thread(target=run, args=(i,)) for i in range(n)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        return results

    def test_simultaneous_invoices_in_one_firm_get_distinct_consecutive_numbers(self):
        def go(i):
            who = 'A' if i < 6 else 'B'
            return who, _create(self, self.user[who], self.case[who])
        results = self._parallel(go, 8)
        self.assertTrue(all(r.status_code == 201 for _, r in results), [r.content for _, r in results])
        a = sorted(r.json()['invoiceNumber'] for w, r in results if w == 'A')
        b = sorted(r.json()['invoiceNumber'] for w, r in results if w == 'B')
        self.assertEqual(a, ['INV-%06d' % i for i in range(1, 7)])
        self.assertEqual(b, ['INV-000001', 'INV-000002'])
        self.assertEqual(InvoiceSequence.objects.get(scope=f"firm:{self.firm['A'].id}").next_value, 7)

    def test_simultaneous_payments_never_exceed_the_balance(self):
        inv = _create(self, self.user['A'], self.case['A']).json()       # Rs. 1000 due
        results = self._parallel(lambda i: _pay(self, self.user['A'], invoiceId=inv['id'], amount='400'), 4)
        self.assertEqual(sorted(r.status_code for r in results), [201, 201, 400, 400])
        self.assertEqual(PaymentInvoice.objects.filter(invoice_id=inv['id']).count(), 2)

    def test_a_double_submitted_payment_records_once(self):
        inv = _create(self, self.user['A'], self.case['A']).json()
        key = str(uuid.uuid4())
        results = self._parallel(lambda i: _pay(self, self.user['A'], key, invoiceId=inv['id'], amount='50'), 3)
        self.assertEqual(ClientPayment.objects.count(), 1)
        self.assertEqual(PaymentRequestKey.objects.count(), 1)
        ok = [r for r in results if r.status_code in (200, 201)]
        self.assertTrue(ok and len({r.json()['id'] for r in ok}) == 1)
        # The rest were told to wait for the first attempt, never given a second payment.
        self.assertTrue(all(r.status_code in (200, 201, 409) for r in results))

