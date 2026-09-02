"""Tests for cause-list matching - deciding whether a listed case is ours.

The important ones here pin the normalisation, because it is duplicated across a
service boundary. The scraper reduces cause-list entries to (TYPE, number, year)
on ingest and stores the parts; this side reduces our own case records the same
way and looks them up. The two implementations live in separate deployables and
cannot share code, so if they ever disagree the feature fails silently - every
"Your Item" simply comes back empty, which looks identical to "nothing of yours
is listed today". These examples are the contract between them.
"""

import datetime

from django.test import TestCase

from core.models import Advocate, Case, Client
from courtsearch.matching import case_identity, find_listings, normalise_case
from courtsearch.models import CauseListItem, ImportedCaseRecord

TODAY = datetime.date(2026, 9, 2)


class NormaliseCaseTests(TestCase):
    """One matter, written the many ways the courts write it."""

    def test_the_same_case_written_three_ways_agrees(self):
        # cause list / display board / our own registration number
        self.assertEqual(normalise_case('SLP(C) No. 014217 / 2025'),
                         ('SLP(C)', '14217', '2025'))
        self.assertEqual(normalise_case('SLP(C) 14217/2025'),
                         ('SLP(C)', '14217', '2025'))
        self.assertEqual(normalise_case('SLP(C) /14217/2025'),
                         ('SLP(C)', '14217', '2025'))

    def test_leading_zeros_are_stripped(self):
        self.assertEqual(normalise_case('C.A. No. 005640 / 2026'),
                         ('CA', '5640', '2026'))

    def test_hyphenated_range_keeps_the_first_number(self):
        # "SLP(C) No. 1644-1662/2024" is one listing covering a range.
        self.assertEqual(normalise_case('SLP(C) No. 1644-1662/2024'),
                         ('SLP(C)', '1644', '2024'))

    def test_registration_suffix_is_ignored(self):
        self.assertEqual(
            normalise_case('C.A. No. 005640 / 2026 Registered on 23-04-2026'),
            ('CA', '5640', '2026'))

    def test_a_cnr_is_not_a_case_number(self):
        # cases.case_number often holds the CNR, which no cause list prints.
        self.assertIsNone(normalise_case('SCIN010147042025'))
        self.assertIsNone(normalise_case(''))
        self.assertIsNone(normalise_case(None))


class CaseIdentityTests(TestCase):
    """What a case can be listed under, read off its imported court record."""

    def setUp(self):
        self.advocate = Advocate.objects.create(
            full_name='Test Advocate', email='adv@example.com', password='x')
        self.client_row = Client.objects.create(
            name='Test Client', email='c@example.com', deleted=False,
            advocate_id=self.advocate.id)
        self.case = Case.objects.create(
            case_number='SCIN010147042025', case_title='A vs B',
            deleted=False, advocate_id=self.advocate.id,
            client_id=self.client_row.id)

    def _import_sci(self):
        ImportedCaseRecord.objects.create(
            advocate_id=self.advocate.id, case_id=self.case.id, court_id='sci',
            query={}, raw={
                'diaryNo': '14704/2025',
                'fields': {
                    'CNR Number': 'SCIN010147042025',
                    # The Supreme Court packs the whole history into one string.
                    'Case Number': ('C.A. No. 005640 / 2026 Registered on '
                                    '23-04-2026 SLP(C) No. 014217 - / 2025 '
                                    'Registered on 15-05-2025'),
                },
            })

    def test_every_number_the_matter_carries_is_collected(self):
        self._import_sci()
        identity = case_identity(self.case)
        self.assertEqual(identity['court'], 'sci')
        # Listed under the diary number before registration, and under either
        # registered number after - all three must match.
        self.assertEqual(identity['keys'], {
            ('DIARY', '14704', '2025'),
            ('CA', '5640', '2026'),
            ('SLP(C)', '14217', '2025'),
        })

    def test_bench_comes_from_the_cnr_prefix(self):
        self._import_sci()
        self.assertEqual(case_identity(self.case)['court'], 'sci')

    def test_a_case_with_no_court_record_yields_nothing_to_match_on(self):
        # No imported record, so nothing to match on - and crucially no
        # guesses: an empty "Your Item" is correct here, a wrong one is not.
        identity = case_identity(self.case)
        self.assertEqual(identity['keys'], set())
        # The bench is still known: a CNR typed as the case number carries it,
        # so the case can be attributed to a court even before it is imported.
        self.assertEqual(identity['court'], 'sci')

    def test_a_case_with_no_identifiers_at_all_matches_nothing(self):
        blank = Case.objects.create(case_number='DEMO-1-10000', deleted=False,
                                    advocate_id=self.advocate.id)
        identity = case_identity(blank)
        self.assertEqual(identity['keys'], set())
        self.assertIsNone(identity['court'])
        self.assertEqual(find_listings(blank, TODAY), [])


class FindListingsTests(TestCase):
    """The join itself: our case against a day's stored cause list."""

    def setUp(self):
        self.advocate = Advocate.objects.create(
            full_name='Test Advocate', email='adv2@example.com', password='x')
        self.case = Case.objects.create(
            case_number='SCIN010147042025', deleted=False,
            advocate_id=self.advocate.id)
        ImportedCaseRecord.objects.create(
            advocate_id=self.advocate.id, case_id=self.case.id, court_id='sci',
            query={}, raw={'diaryNo': '14704/2025',
                           'fields': {'CNR Number': 'SCIN010147042025',
                                      'Case Number': 'SLP(C) No. 014217 / 2025'}})
        # A day's list, in the shape the scraper stores it.
        CauseListItem.objects.create(
            court='sci', list_date=TODAY, court_number='8', item_number='52',
            case_string='SLP(C) No. 14217/2025', case_type='SLP(C)',
            case_no='14217', case_year='2025')
        CauseListItem.objects.create(
            court='sci', list_date=TODAY, court_number='3', item_number='46',
            case_string='W.P.(Crl.) No. 289/2026', case_type='W.P.(CRL.)',
            case_no='289', case_year='2026')

    def test_our_case_is_found_with_its_courtroom_and_item(self):
        rows = find_listings(self.case, TODAY)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].item_number, '52')
        self.assertEqual(rows[0].court_number, '8')

    def test_a_diary_numbered_listing_matches_the_same_case(self):
        CauseListItem.objects.filter(court='sci', list_date=TODAY).delete()
        CauseListItem.objects.create(
            court='sci', list_date=TODAY, court_number='1', item_number='4',
            case_string='Diary No. 14704-2025', case_type='DIARY',
            case_no='14704', case_year='2025', diary_number='14704-2025')
        rows = find_listings(self.case, TODAY)
        self.assertEqual([r.item_number for r in rows], ['4'])

    def test_another_advocates_listing_is_not_ours(self):
        rows = find_listings(self.case, TODAY)
        self.assertNotIn('46', [r.item_number for r in rows])

    def test_no_listing_on_a_day_the_case_is_not_up(self):
        self.assertEqual(find_listings(self.case, TODAY + datetime.timedelta(days=1)), [])
