"""GST place of supply by state codes (invoices/gst.py): intra- vs inter-state
is decided from GST state codes, never free-text names, and a forward-charge
invoice is refused rather than taxed on a guess when a location is missing."""
from decimal import Decimal

from django.test import SimpleTestCase, TestCase, override_settings

from core.models import Invoice
from core.testing import auth, make_case, make_client, make_firm, make_firm_member
from core.validators import gstin_check_char
from firms.models import FirmSettings
from invoices import gst
from invoices.models import InvoiceTaxDetail


def gstin(state_code, pan='ABCDE1234F'):
    first14 = f'{state_code}{pan}1Z'
    return first14 + gstin_check_char(first14)


class StateCodeTests(SimpleTestCase):
    def test_names_short_forms_and_codes_resolve_to_one_code(self):
        for value in ('Tamil Nadu', 'tamil nadu', 'Tamilnadu', 'TN', '33', '33 - Tamil Nadu', 'Tamil Nadu (33)'):
            self.assertEqual(gst.state_code(value), '33', value)
        self.assertEqual(gst.state_code('Orissa'), '21')
        self.assertEqual(gst.state_code('New Delhi'), '07')
        self.assertEqual(gst.state_code('Pondicherry'), '34')
        self.assertIsNone(gst.state_code('Atlantis'))
        self.assertIsNone(gst.state_code(''))

    def test_old_and_new_codes_of_one_state_are_the_same_place(self):
        self.assertFalse(gst.is_interstate('28', '37'))           # undivided / new Andhra Pradesh
        self.assertFalse(gst.is_interstate('25', '26'))           # Daman and Diu merged
        self.assertTrue(gst.is_interstate('33', '29'))
        self.assertIsNone(gst.is_interstate(None, '33'))

    def test_a_registered_recipient_is_located_by_their_gstin(self):
        self.assertEqual(gst.recipient_code(gstin('29'), '', ''), '29')
        self.assertEqual(gst.recipient_code(gstin('29'), 'Karnataka', ''), '29')
        with self.assertRaises(gst.PlaceOfSupplyError) as e:
            gst.recipient_code(gstin('29'), 'Tamil Nadu', '')
        self.assertEqual(e.exception.code, 'STATE_GSTIN_MISMATCH')
        with self.assertRaises(gst.PlaceOfSupplyError) as e:
            gst.recipient_code('', 'Atlantis', '')
        self.assertEqual(e.exception.code, 'UNKNOWN_STATE')
        self.assertIsNone(gst.recipient_code('', '', ''))


@override_settings(TENANCY_MODE='firm')
class InvoicePlaceOfSupplyTests(TestCase):
    def setUp(self):
        self.firm = make_firm('G')
        self.adv = make_firm_member(self.firm)
        self.case = make_case(self.adv, client=make_client(self.adv, name='Meena Textiles'))

    def firm_in(self, state='', gst_number=''):
        self.adv.state, self.adv.gst_number = state, gst_number
        self.adv.save()

    def create(self, **body):
        body = {'caseId': self.case.id, 'taxMode': 'forward', 'gstRate': 18,
                'particulars': [{'description': 'Appearance fee', 'amount': '10000'}], **body}
        return self.client.post('/api/invoices/create', body, content_type='application/json', **auth(self.adv))

    def tax(self, r):
        self.assertEqual(r.status_code, 201, r.content)
        return InvoiceTaxDetail.objects.get(invoice_id=r.json()['id'])

    def test_a_short_form_state_is_the_same_state(self):
        # The old free-text comparison made "TN" vs "Tamil Nadu" inter-state (IGST).
        self.firm_in('Tamil Nadu')
        t = self.tax(self.create(recipientState='TN'))
        self.assertEqual((t.is_interstate, t.cgst_amount, t.sgst_amount, t.igst_amount), (False, 900, 900, 0))
        self.assertEqual((t.recipient_state_code, t.place_of_supply), ('33', 'Tamil Nadu - 33'))

    def test_another_state_is_igst(self):
        self.firm_in('Tamil Nadu')
        t = self.tax(self.create(recipientState='Karnataka'))
        self.assertEqual((t.is_interstate, t.cgst_amount, t.sgst_amount, t.igst_amount), (True, 0, 0, 1800))
        self.assertEqual(Invoice.objects.get(id=t.invoice_id).amount, 11800)

    def test_the_recipients_gstin_decides_when_they_are_registered(self):
        self.firm_in('Tamil Nadu')
        t = self.tax(self.create(recipientGstin=gstin('29')))
        self.assertEqual((t.is_interstate, t.recipient_state_code, t.recipient_state), (True, '29', 'Karnataka'))

    def test_the_firms_gstin_outranks_its_typed_state(self):
        self.firm_in('Karnataka', gst_number=gstin('33', 'PQRST6789K'))
        t = self.tax(self.create(recipientState='Tamil Nadu'))
        self.assertFalse(t.is_interstate)                          # firm registered in Tamil Nadu

    def test_an_invalid_stored_firm_gstin_is_a_configuration_error_not_a_fallback(self):
        good = gstin('33', 'PQRST6789K')
        broken = good[:-1] + ('A' if good[-1] != 'A' else 'B')          # wrong check character
        self.firm_in('Tamil Nadu', gst_number=broken)                 # the state alone would have said intra-state
        r = self.create(recipientState='Tamil Nadu')
        self.assertEqual((r.status_code, r.json()['code']), (400, 'FIRM_GSTIN_INVALID'))
        self.assertIn('Profile → Office → GST number', r.json()['error'])
        self.assertFalse(Invoice.objects.exists())
        # Reverse charge adds no tax: not blocked, location recorded as unknown (no fallback).
        t = self.tax(self.create(taxMode='rcm', recipientState='Tamil Nadu'))
        self.assertIsNone(t.is_interstate)
        self.adv.refresh_from_db()
        self.assertEqual(self.adv.gst_number, broken)                 # never changed by AMS
        # The integrity report lists it.
        import io
        from django.core.management import call_command
        out = io.StringIO()
        try:
            call_command('integrity_report', stdout=out)
        except SystemExit:
            pass        # the bare test database fails unrelated checks; only this line matters here
        self.assertIn(f'advocate {self.adv.id}', out.getvalue())

    def test_firm_settings_supply_the_location_when_the_advocate_has_none(self):
        FirmSettings.objects.filter(firm=self.firm).update(state='Kerala')
        t = self.tax(self.create(recipientState='Kerala'))
        self.assertFalse(t.is_interstate)

    def test_forward_charge_without_a_location_is_refused_not_guessed(self):
        self.firm_in('Tamil Nadu')
        r = self.create()                                          # no client state or GSTIN
        self.assertEqual((r.status_code, r.json()['code']), (400, 'RECIPIENT_STATE_REQUIRED'))
        self.firm_in('')
        r = self.create(recipientState='Tamil Nadu')
        self.assertEqual((r.status_code, r.json()['code']), (400, 'SUPPLIER_STATE_REQUIRED'))
        self.assertFalse(Invoice.objects.exists())                 # nothing saved, no number used

    def test_contradictions_and_unknown_states_are_refused(self):
        self.firm_in('Tamil Nadu')
        r = self.create(recipientGstin=gstin('29'), recipientState='Tamil Nadu')
        self.assertEqual(r.json()['code'], 'STATE_GSTIN_MISMATCH')
        r = self.create(recipientState='Atlantis')
        self.assertEqual(r.json()['code'], 'UNKNOWN_STATE')
        self.assertFalse(Invoice.objects.exists())

    def test_reverse_charge_is_not_blocked_and_records_unknown_as_unknown(self):
        r = self.create(taxMode='rcm')                             # no locations at all
        t = self.tax(r)
        self.assertIsNone(t.is_interstate)                         # not guessed as intra-state
        self.assertEqual((t.cgst_amount, t.sgst_amount, t.igst_amount, t.total_value), (0, 0, 0, 10000))
        self.firm_in('Tamil Nadu')
        t = self.tax(self.create(taxMode='rcm', recipientState='Maharashtra'))
        self.assertTrue(t.is_interstate)

    def test_earlier_invoices_are_untouched(self):
        self.firm_in('Tamil Nadu')
        t = self.tax(self.create(recipientState='Karnataka'))
        before = (t.cgst_amount, t.sgst_amount, t.igst_amount, t.total_value, t.place_of_supply)
        self.firm_in('Karnataka')                                  # the firm moves later
        self.tax(self.create(recipientState='Karnataka'))
        t.refresh_from_db()
        self.assertEqual((t.cgst_amount, t.sgst_amount, t.igst_amount, t.total_value, t.place_of_supply), before)

    def test_paise_split_is_exact(self):
        self.firm_in('Tamil Nadu')
        t = self.tax(self.create(recipientState='Tamil Nadu', particulars=[{'description': 'Fee', 'amount': '1000.05'}]))
        self.assertEqual(Decimal(str(t.cgst_amount)) + Decimal(str(t.sgst_amount)), Decimal('180.01'))
