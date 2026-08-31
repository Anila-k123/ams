"""Tests for the appeal-detection pipeline.

Written after a live run against the real portals, which failed on five of
eight cases with:

    502: Upstream error: Party Name - Please enter only alphabets

Both eCourts portals validate the party-name box, and "T.KANNAN" - initials
with stops, which is how a large share of names appear on the register - was
refused outright, so those cases were never searched at all. A whole class of
Indian names could not be checked for appeals and the only sign was a warning
line in a log.
"""

from __future__ import annotations

import datetime

from django.test import SimpleTestCase

from appeals.appeal_scan import is_candidate, portal_search_term, searchable_names
from appeals.detection import parse_court_date
from appeals.forums import high_court_for_state, next_forum, state_from_cnr


class PortalSearchTermTest(SimpleTestCase):
    """What goes in the search box must be something the portal accepts."""

    def test_initials_become_the_substantive_name(self):
        self.assertEqual(portal_search_term('T.KANNAN'), 'KANNAN')
        self.assertEqual(portal_search_term('K.Pushpa'), 'Pushpa')

    def test_punctuation_never_fuses_words(self):
        """T.KANNAN must not become TKANNAN, which matches nothing."""
        self.assertNotIn('TKANNAN', portal_search_term('T.KANNAN'))
        self.assertEqual(portal_search_term('A.Lalitha M.Thamizhavel'),
                         'Lalitha Thamizhavel')

    def test_company_punctuation_is_stripped(self):
        self.assertEqual(portal_search_term('M/s. Foo & Bar Co.'), 'Foo Bar Co')
        self.assertEqual(portal_search_term('MANAGEMENT OF E.I.D. PARRY INDIA LTD'),
                         'MANAGEMENT OF PARRY INDIA LTD')

    def test_output_is_only_letters_and_spaces(self):
        for raw in ['T.KANNAN', 'M/s. Foo & Bar', 'A-1 Traders', "O'Brien",
                    'Rani (deceased)', '123/2024 Ltd']:
            term = portal_search_term(raw)
            self.assertTrue(all(c.isalpha() or c == ' ' for c in term),
                            'unacceptable characters in %r from %r' % (term, raw))

    def test_nothing_searchable_returns_empty(self):
        for raw in ['X.Y.', '123', '', None, '...', 'A B C']:
            self.assertEqual(portal_search_term(raw), '',
                             'expected no term for %r' % raw)

    def test_searchable_names_only_yields_portal_safe_terms(self):
        terms = searchable_names(['T.KANNAN', 'The State of Kerala', 'K.Pushpa'])
        self.assertTrue(terms)
        for term in terms:
            self.assertTrue(all(c.isalpha() or c == ' ' for c in term), term)
            self.assertNotIn('.', term)


class ForumEscalationTest(SimpleTestCase):
    def test_district_goes_to_its_high_court(self):
        forum = next_forum('ecourts_dc', state_code=4)     # Kerala
        self.assertEqual(forum['court_id'], 'ecourts_hc')
        self.assertEqual(forum['state_code'], 4)

    def test_high_court_goes_to_the_supreme_court(self):
        forum = next_forum('ecourts_hc', state_code=10)
        self.assertEqual(forum['court_id'], 'sci')

    def test_supreme_court_has_nowhere_above_it(self):
        self.assertIsNone(next_forum('sci'))

    def test_a_state_without_its_own_high_court_is_redirected(self):
        self.assertEqual(high_court_for_state(14), 22)     # Haryana -> P&H
        self.assertEqual(high_court_for_state(35), 10)     # Puducherry -> Madras

    def test_state_is_recovered_from_a_cnr_when_absent(self):
        self.assertEqual(state_from_cnr('KLML010012342025'), 4)
        forum = next_forum('ecourts_dc', state_code=None, cnr='KLML010012342025')
        self.assertEqual(forum['state_code'], 4)

    def test_no_state_means_no_search_rather_than_a_guess(self):
        self.assertIsNone(next_forum('ecourts_dc', state_code=None, cnr=None))


class CandidateMatchingTest(SimpleTestCase):
    OURS = ['Muhammed Unneenutty', 'The State of Kerala']

    def test_a_shared_private_name_matches(self):
        ok, score, matched = is_candidate(
            self.OURS, 'Muhammed Unneenutty Vs State of Kerala',
            datetime.date(2025, 8, 1), datetime.date(2025, 6, 17))
        self.assertTrue(ok)
        self.assertGreater(score, 0)

    def test_an_appeal_cannot_predate_the_judgment(self):
        ok, _, _ = is_candidate(
            self.OURS, 'Muhammed Unneenutty Vs State of Kerala',
            datetime.date(2025, 1, 1), datetime.date(2025, 6, 17))
        self.assertFalse(ok, 'filed before the judgment it would challenge')

    def test_an_institutional_name_alone_is_not_evidence(self):
        """This produced 79 false positives on 'The State of Tamil Nadu'."""
        ok, _, _ = is_candidate(
            self.OURS, 'Somebody Else Vs The State of Kerala',
            datetime.date(2025, 8, 1), datetime.date(2025, 6, 17))
        self.assertFalse(ok)


class CourtDateParsingTest(SimpleTestCase):
    def test_the_formats_the_portals_actually_return(self):
        self.assertEqual(parse_court_date('17th June 2025'),
                         datetime.date(2025, 6, 17))
        self.assertEqual(parse_court_date('10-04-2026'),
                         datetime.date(2026, 4, 10))

    def test_junk_is_none_not_an_exception(self):
        for raw in ['', None, 'not a date', '--']:
            self.assertIsNone(parse_court_date(raw))
