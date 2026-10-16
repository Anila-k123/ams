"""The court order sync (courtsearch/order_sync.py, docs/ORDER_SYNC.md): orders read from every court's
record, a first look that alerts nobody, a new order saved to the case and announced once to the team and
the client, the page's Refresh doing the same, and the round's order and timetable."""
import datetime
import json
from unittest import mock

from django.test import TestCase

from core.models import Document, NotificationQueue
from core.testing import ALL_PERMISSIONS, auth, make_advocate, make_case, make_client

from .models import CaseOrderSync, ImportedCaseRecord
from .orders import label, order_entries

PDF = b'%PDF-1.4 a court order'


def hc_order(n, date, name):
    return {'order_number': str(n), 'order_date': date, 'order_on': 'CRL OP/1/2025',
            'pdf_url': f'https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php?filename={name}&cCode=1'}


def hc_raw(*orders):
    return {'cases': [{'view_token': 'vt', 'detail': {'orders': list(orders)}}]}


class OrderEntriesTest(TestCase):
    def test_each_court_gives_stable_keys_and_labels(self):
        hc = order_entries('ecourts_hc', hc_raw(hc_order(1, '21-01-2025', 'AAA'), hc_order(2, '03-02-2025', 'BBB')))
        self.assertEqual(len({e['key'] for e in hc}), 2)
        self.assertEqual(label(hc[0]), 'Order 1 dated 21-01-2025')       # the case number is not "details"
        self.assertEqual(order_entries('ecourts_hc', hc_raw(hc_order(1, '21-01-2025', 'AAA')))[0]['key'], hc[0]['key'])
        dc = order_entries('ecourts_dc', {'cases': [{'view_token': 'v', 'detail': {'orders': [
            {'order_number': '1', 'order_date': '08-10-2021', 'order_details': 'Judgment',
             'pdf': {'filename': 'xyz', 'case_val': 'c'}}]}}]})
        self.assertEqual((dc[0]['key'][:3], dc[0]['view_token'], label(dc[0])), ('dc:', 'v', 'Order 1 dated 08-10-2021 (Judgment)'))
        sci = order_entries('sci', {'sections': [{'html': '<td><strong>Date of Judgment/Order</strong></td>'
                                                          '<a target="_blank" href="https://api.sci.gov.in/x/Order_01-Apr-2026.pdf"> 01-04-2026 </a>'
                                                          '&nbsp&nbsp [ROP]'}]})
        self.assertEqual((sci[0]['date'], sci[0]['details'], sci[0]['url'][-4:]), ('01-04-2026', 'ROP', '.pdf'))


@mock.patch('courtsearch.order_sync.fetch_pdf', return_value=PDF)
class TakeNewOrdersTest(TestCase):
    def setUp(self):
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        self.junior = make_advocate(permissions=ALL_PERMISSIONS, parent_advocate_id=self.senior.id)
        self.client_row = make_client(self.senior, 'Akshayam Traders', email='office@akshayam.test')
        self.case = make_case(self.senior, self.client_row, case_title='Akshayam vs UoI')
        self.rec = ImportedCaseRecord.objects.create(advocate_id=self.senior.id, case_id=self.case.id,
                                                     court_id='ecourts_hc', raw=hc_raw(hc_order(1, '21-01-2025', 'AAA')))

    def _queued(self):
        return list(NotificationQueue.objects.filter(type='COURT_ORDER_NEW'))

    def test_first_look_records_the_orders_and_alerts_nobody(self, _pdf):
        from .order_sync import take_new_orders
        self.assertEqual(take_new_orders(self.rec), [])
        self.assertEqual(len(CaseOrderSync.objects.get(case_id=self.case.id).known_keys), 1)
        self.assertEqual(self._queued(), [])

    def test_a_new_order_is_saved_shared_and_announced_once(self, _pdf):
        from .order_sync import take_new_orders
        take_new_orders(self.rec)                                       # baseline
        self.rec.raw = hc_raw(hc_order(1, '21-01-2025', 'AAA'), hc_order(2, '16-10-2026', 'BBB'))
        self.rec.save()
        found = take_new_orders(self.rec)
        self.assertEqual([f['label'] for f in found], ['Order 2 dated 16-10-2026'])
        doc = Document.objects.get(id=found[0]['documentId'])
        self.assertEqual((doc.case_id, doc.client_id, doc.client_visible, doc.category),
                         (self.case.id, self.client_row.id, True, 'Order'))
        rows = self._queued()
        payloads = [json.loads(r.payload_json) for r in rows]
        team = {r.advocate_id for r, p in zip(rows, payloads) if p.get('channel') == 'IN_APP'}
        self.assertEqual(team, {self.senior.id, self.junior.id})        # the advocate and their team
        client_mail = [p for p in payloads if p.get('clientId') == self.client_row.id and p.get('channel') == 'EMAIL']
        self.assertEqual(len(client_mail), 1)                           # the client (email = portal Messages)
        self.assertIn('Order 2 dated 16-10-2026', client_mail[0]['body'])
        self.assertEqual(CaseOrderSync.objects.get(case_id=self.case.id).recent[0]['documentId'], doc.id)
        # Seen now: nothing again, and the PDF isn't saved twice.
        self.assertEqual(take_new_orders(self.rec), [])
        self.assertEqual(len(self._queued()), len(rows))
        self.assertEqual(Document.objects.filter(case_id=self.case.id).count(), 1)

    def test_no_pdf_yet_still_announces(self, pdf):
        from .order_sync import take_new_orders
        take_new_orders(self.rec)
        pdf.return_value = None
        self.rec.raw = hc_raw(hc_order(1, '21-01-2025', 'AAA'), hc_order(2, '16-10-2026', 'BBB'))
        found = take_new_orders(self.rec)
        self.assertIsNone(found[0]['documentId'])
        self.assertTrue(self._queued())

    def test_the_pages_refresh_announces_a_new_order_too(self, _pdf):
        fresh = hc_raw(hc_order(1, '21-01-2025', 'AAA'), hc_order(2, '16-10-2026', 'BBB'))
        with mock.patch('courtsearch.refresh.fetch_fresh', return_value=fresh):
            resp = self.client.post(f'/api/courtsearch/cases/{self.case.id}/refresh', **auth(self.senior))
        self.assertEqual(resp.status_code, 200, resp.content)
        # Never looked at before: the record as it was is the baseline, so only order 2 is new.
        self.assertEqual(Document.objects.filter(case_id=self.case.id, category='Order').count(), 1)
        self.assertTrue(self._queued())

    def _due(self):
        from .order_sync import due_groups
        return [[r.case_id for r in g['records']] for g in due_groups()]

    def test_round_order_and_what_waits(self, _pdf):
        from core.models import CaseEvent
        now = datetime.datetime.now()
        disposed = make_case(self.senior, self.client_row, status='Closed')
        ImportedCaseRecord.objects.create(advocate_id=self.senior.id, case_id=disposed.id, court_id='ecourts_hc',
                                          raw=hc_raw(), query={'n': 2})
        hearing = CaseEvent.objects.create(case_id=self.case.id, advocate_id=self.senior.id, title='Hearing',
                                           event_type='HEARING', date=now.date() + datetime.timedelta(days=7))
        CaseOrderSync.objects.create(case_id=self.case.id, checked_at=now - datetime.timedelta(hours=1))
        self.assertEqual(self._due(), [[disposed.id], [self.case.id]])                   # never checked first
        CaseOrderSync.objects.create(case_id=disposed.id, checked_at=now - datetime.timedelta(days=2))
        self.assertEqual(self._due(), [[self.case.id]])                                  # disposed: weekly
        # Without a hearing near, no listing today and no recent order, an hour-old check waits for tomorrow.
        hearing.delete()
        self.assertEqual(self._due(), [])
        CaseOrderSync.objects.filter(case_id=self.case.id).update(checked_at=now - datetime.timedelta(hours=21))
        self.assertEqual(self._due(), [[self.case.id]])

    def test_a_stopped_firm_is_not_fetched(self, _pdf):
        with mock.patch('core.tenant.firm_active', return_value=False):
            self.assertEqual(self._due(), [])

    def test_one_court_case_tracked_by_two_firms_is_fetched_once_and_both_are_told(self, _pdf):
        from .order_sync import sync_cycle
        other_senior = make_advocate(permissions=ALL_PERMISSIONS)                         # another firm / team
        other_client = make_client(other_senior, 'Other side', email='legal@other.test')
        other_case = make_case(other_senior, other_client)
        raw = hc_raw(hc_order(1, '21-01-2025', 'AAA'))
        raw['cases'][0]['detail']['cnr_number'] = 'HCMA010015422025'
        for rec in (self.rec,):
            rec.raw = raw
            rec.save()
        ImportedCaseRecord.objects.create(advocate_id=other_senior.id, case_id=other_case.id,
                                          court_id='ecourts_hc', raw=raw)
        fresh = hc_raw(hc_order(1, '21-01-2025', 'AAA'), hc_order(2, '16-10-2026', 'BBB'))
        fresh['cases'][0]['detail']['cnr_number'] = 'HCMA010015422025'
        with mock.patch('courtsearch.refresh.fetch_fresh', return_value=fresh) as fetch:
            first = sync_cycle(pause=0, workers=1)                                       # first look: baseline
            for s in CaseOrderSync.objects.all():
                s.known_keys = s.known_keys[:1]                                          # order 2 not seen yet
                s.checked_at = datetime.datetime.now() - datetime.timedelta(hours=21)   # due again (quiet case)
                s.save()
            second = sync_cycle(pause=0, workers=1)
        self.assertEqual((first['court_cases'], first['checked']), (1, 2))
        self.assertEqual(fetch.call_count, 2)                                            # once per round, not per firm
        self.assertEqual(second['new_orders'], 2)                                        # each firm's case got it
        team = {r.advocate_id for r in self._queued()}
        self.assertTrue({self.senior.id, other_senior.id} <= team)


class TimetableTest(TestCase):
    def test_mon_to_sat_every_half_hour_in_court_hours_and_once_in_the_evening(self):
        from .management.commands.run_order_sync import next_slot
        at = lambda s: next_slot(datetime.datetime.fromisoformat(s)).strftime('%a %H:%M')
        self.assertEqual(at('2026-10-16 09:12'), 'Fri 10:00')
        self.assertEqual(at('2026-10-16 10:00'), 'Fri 10:30')
        self.assertEqual(at('2026-10-16 18:10'), 'Fri 19:30')
        self.assertEqual(at('2026-10-17 19:31'), 'Mon 10:00')           # no Sunday rounds


def dc_record(cnr='TNCH010015532025', hearing='01-01-2099'):
    """A District Court record as the CNR search returns it: two parties, one upcoming hearing, one order."""
    return {'cases': [{'view_token': 'vt', 'case_number': 'OS 12/2025', 'detail': {
        'case_details': {'CNR Number': f'{cnr} (Note the CNR number for future reference)'},
        'petitioners': [{'name': 'Akshayam Traders', 'advocate': 'R. Kumar'}],
        'respondents': [{'name': 'The Deputy Commissioner', 'advocate': ''}],
        'history': [{'hearing_date': hearing, 'purpose': 'Arguments', 'judge': 'District Judge'}],
        'orders': [{'order_number': '1', 'order_date': '08-10-2025', 'order_details': 'Interim',
                    'pdf': {'filename': 'f1'}}]}}]}


class LinkOfflineCaseTest(TestCase):
    def setUp(self):
        from workspace.models import CaseParty, CaseProfile
        self.senior = make_advocate(permissions=ALL_PERMISSIONS)
        self.client_row = make_client(self.senior, 'Akshayam Traders', email='office@akshayam.test')
        self.case = make_case(self.senior, self.client_row)                 # entered by hand: no court record
        CaseParty.objects.create(advocate_id=self.senior.id, case_id=self.case.id, name='Akshayam Traders')
        CaseProfile.objects.create(case_id=self.case.id, matter_type='litigation')
        self.url = f'/api/courtsearch/cases/{self.case.id}/link'

    def test_find_then_link_by_cnr(self):
        from core.models import CaseEvent
        from workspace.models import CaseParty, CaseProfile
        found = ('ecourts_dc', dc_record(), {'cnr': 'TNCH010015532025'})
        with mock.patch('courtsearch.linking.find_by_cnr', return_value=found):
            preview = self.client.post(self.url, {'cnr': 'tnch 0100 1553 2025'}, content_type='application/json',
                                       **auth(self.senior))
            self.assertEqual(preview.status_code, 200, preview.content)
            self.assertEqual(preview.json()['summary']['title'], 'Akshayam Traders vs The Deputy Commissioner')
            self.assertFalse(ImportedCaseRecord.objects.filter(case_id=self.case.id).exists())   # nothing yet
            done = self.client.post(self.url, {'cnr': 'TNCH010015532025', 'confirm': True},
                                    content_type='application/json', **auth(self.senior))
        self.assertEqual(done.status_code, 200, done.content)
        self.assertTrue(ImportedCaseRecord.objects.filter(case_id=self.case.id, court_id='ecourts_dc').exists())
        self.assertEqual(sorted(CaseParty.objects.filter(case_id=self.case.id).values_list('name', flat=True)),
                         ['Akshayam Traders', 'The Deputy Commissioner'])                  # not added twice
        self.assertEqual(CaseEvent.objects.filter(case_id=self.case.id, date=datetime.date(2099, 1, 1)).count(), 1)
        self.assertEqual(CaseProfile.objects.get(case_id=self.case.id).cnr, 'TNCH010015532025')
        self.assertEqual(len(CaseOrderSync.objects.get(case_id=self.case.id).known_keys), 1)  # old order: no alert
        self.assertFalse(NotificationQueue.objects.filter(type='COURT_ORDER_NEW').exists())
        again = self.client.post(self.url, {'cnr': 'TNCH010015532025'}, content_type='application/json', **auth(self.senior))
        self.assertEqual(again.status_code, 409)

    def test_supreme_court_by_diary_number_and_refusals(self):
        sci = {'fields': {'Petitioner(s)': '1 ITO WARD 15(1)', 'Respondent(s)': '1 S. REDDY',
                          'Case Number': 'C.A. No. 5640 / 2026 Registered on 23-04-2026'}, 'sections': []}
        with mock.patch('courtsearch.client.sci_case_detail', return_value=sci) as detail:
            resp = self.client.post(self.url, {'diaryNo': '14704', 'diaryYear': '2025'}, content_type='application/json',
                                    **auth(self.senior))
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual((resp.json()['courtId'], resp.json()['summary']['caseNumber']), ('sci', 'C.A. No. 5640 / 2026'))
        self.assertEqual(detail.call_args[0][:2], ('14704', '2025'))
        bad = self.client.post(self.url, {'cnr': 'ABC'}, content_type='application/json', **auth(self.senior))
        self.assertEqual(bad.status_code, 400)
        from .linking import NotFound
        with mock.patch('courtsearch.linking.find_by_cnr', side_effect=NotFound('x')):
            none = self.client.post(self.url, {'cnr': 'TNCH010015532025'}, content_type='application/json', **auth(self.senior))
        self.assertEqual(none.status_code, 404)
        stranger = make_advocate(permissions=ALL_PERMISSIONS)                              # another team
        self.assertEqual(self.client.post(self.url, {'cnr': 'TNCH010015532025'}, content_type='application/json',
                                          **auth(stranger)).status_code, 404)

    def test_the_sync_links_offline_cases_with_a_cnr_once_a_day(self):
        from workspace.models import CaseProfile
        from .linking import NotFound
        from .order_sync import link_pending
        CaseProfile.objects.filter(case_id=self.case.id).update(cnr='TNCH010015532025')
        advisory = make_case(self.senior, self.client_row)
        CaseProfile.objects.create(case_id=advisory.id, matter_type='non_litigation', cnr='TNCH010015532026')
        with mock.patch('courtsearch.linking.find_by_cnr', side_effect=NotFound('x')) as find:
            self.assertEqual(link_pending(), 0)
            self.assertEqual(find.call_count, 1)                   # the advisory matter isn't looked up
            link_pending()
            self.assertEqual(find.call_count, 1)                   # tried today already
        self.assertIn('no case', CaseOrderSync.objects.get(case_id=self.case.id).last_error)
        CaseOrderSync.objects.filter(case_id=self.case.id).update(
            link_tried_at=datetime.datetime.now() - datetime.timedelta(hours=21))
        with mock.patch('courtsearch.linking.find_by_cnr',
                        return_value=('ecourts_dc', dc_record(), {'cnr': 'TNCH010015532025'})):
            self.assertEqual(link_pending(), 1)
        self.assertTrue(ImportedCaseRecord.objects.filter(case_id=self.case.id).exists())
