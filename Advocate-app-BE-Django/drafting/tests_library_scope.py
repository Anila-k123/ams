"""P1-11: a draft is filled only from its own practice's clause library.

drafting.LibraryClause rows have no owner column, and library-mode drafting
used to retrieve by contract type alone - so firm B's drafts were built from
firm A's sample clauses. library_for() limits retrieval to clauses whose
source sample belongs to the drafting advocate's practice.
"""
from django.test import TestCase

from core.testing import ALL_PERMISSIONS, make_advocate
from drafting.models import DraftSession, LibraryClause, Sample, Template
from drafting.tasks import library_for


class LibraryScopeTests(TestCase):
    def setUp(self):
        self.firm_a = make_advocate(permissions=ALL_PERMISSIONS)
        self.junior_a = make_advocate(permissions=ALL_PERMISSIONS, parent_advocate_id=self.firm_a.id)
        self.firm_b = make_advocate(permissions=ALL_PERMISSIONS)
        sample_a = Sample.objects.create(name='A NDA.pdf', file='a.pdf', uploaded_by_id=self.firm_a.id,
                                         contract_type='NDA')
        sample_b = Sample.objects.create(name='B NDA.pdf', file='b.pdf', uploaded_by_id=self.firm_b.id,
                                         contract_type='NDA')
        self.clause_a = LibraryClause.objects.create(contract_type='NDA', clause_type='confidentiality',
                                                     title='A', text='Firm A wording', source_sample=sample_a)
        self.clause_b = LibraryClause.objects.create(contract_type='NDA', clause_type='confidentiality',
                                                     title='B', text='Firm B wording', source_sample=sample_b)
        self.orphan = LibraryClause.objects.create(contract_type='NDA', clause_type='confidentiality',
                                                   title='?', text='Unknown origin', source_sample=None)
        self.template = Template.objects.create(name='Mutual NDA', document_type='NDA')

    def _session(self, who):
        return DraftSession.objects.create(template=self.template, created_by_id=who.id, facts={}, status='ready')

    def test_firm_b_draft_never_sees_firm_a_clauses(self):
        ids = set(library_for(self._session(self.firm_b)).values_list('id', flat=True))
        self.assertEqual(ids, {self.clause_b.id})

    def test_practice_members_share_their_library(self):
        ids = set(library_for(self._session(self.junior_a)).values_list('id', flat=True))
        self.assertEqual(ids, {self.clause_a.id})

    def test_clauses_without_a_source_are_not_used(self):
        for who in (self.firm_a, self.firm_b):
            self.assertNotIn(self.orphan.id, library_for(self._session(who)).values_list('id', flat=True))
