"""Acts are shared by every firm; links from acts to cases are not (Phase 9:
the act's "Cases Linked" tab listed every firm's linked cases, and any user
could unlink another firm's case)."""
from django.test import TestCase, override_settings

from acts.models import Act, ActCaseLink
from core.testing import auth, make_case, make_firm, make_firm_member


@override_settings(TENANCY_MODE='firm')
class ActLinkIsolationTests(TestCase):
    def setUp(self):
        self.a_user = make_firm_member(make_firm('A'))
        self.b_user = make_firm_member(make_firm('B'))
        import datetime
        self.act = Act.objects.create(title='Code of Civil Procedure', source_state_name='CENTRAL',
                                      source_uuid='e2e-cpc', created_at=datetime.datetime.now(),
                                      last_synced_at=datetime.datetime.now())
        self.a_case = make_case(self.a_user, case_title='A secret matter')
        self.b_case = make_case(self.b_user, case_title='B secret matter')
        for user, case in ((self.a_user, self.a_case), (self.b_user, self.b_case)):
            ActCaseLink.objects.create(act=self.act, case_id=case.id, advocate_id=user.id)

    def test_the_linked_cases_tab_shows_only_this_firms_cases(self):
        rows = self.client.get(f'/api/acts/{self.act.id}/cases', **auth(self.a_user)).json()
        self.assertEqual([r['caseId'] for r in rows], [self.a_case.id])
        self.assertNotIn('B secret matter', str(rows))

    def test_another_firms_link_cannot_be_removed(self):
        r = self.client.delete(f'/api/acts/{self.act.id}/cases/{self.b_case.id}', **auth(self.a_user))
        self.assertEqual(r.status_code, 404)
        self.assertTrue(ActCaseLink.objects.filter(case_id=self.b_case.id).exists())
        r = self.client.delete(f'/api/acts/{self.act.id}/cases/{self.a_case.id}', **auth(self.a_user))
        self.assertEqual(r.status_code, 204)
