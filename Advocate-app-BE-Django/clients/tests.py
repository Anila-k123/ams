"""Handling advocate on a new client: who may be picked, the notice they get,
and that editing a client neither re-sends it nor wipes the pick."""

from __future__ import annotations

import json
from unittest import mock

from django.test import TestCase

from core.models import Notification
from core.testing import ALL_PERMISSIONS, auth, make_advocate, make_client

from .models import ClientHandler


class ClientHandlerTest(TestCase):
    def setUp(self):
        self.owner = make_advocate('owner@test.local', ALL_PERMISSIONS)
        self.arjun = make_advocate('arjun@test.local', ['CASE_CREATE', 'CLIENT_VIEW'],
                                   parent_advocate_id=self.owner.id, full_name='Arjun Menon')
        self.desk = make_advocate('desk@test.local', ['CLIENT_CREATE', 'CLIENT_VIEW', 'CLIENT_EDIT'],
                                  parent_advocate_id=self.owner.id, full_name='Front Desk')
        self.outsider = make_advocate('outsider@test.local', ALL_PERMISSIONS)

    def _create(self, **extra):
        body = {'name': 'R. Murugan', 'email': 'r.murugan@test.local', 'phone': '9444000700', **extra}
        return self.client.post('/api/clients/create', data=json.dumps(body),
                                content_type='application/json', **auth(self.desk))

    def test_the_front_desk_sees_only_people_who_can_take_a_case(self):
        resp = self.client.get('/api/clients/handlers', **auth(self.desk))
        self.assertEqual(resp.status_code, 200)
        ids = {p['id'] for p in resp.json()}
        self.assertIn(self.arjun.id, ids)
        self.assertNotIn(self.desk.id, ids)        # no CASE_CREATE
        self.assertNotIn(self.outsider.id, ids)    # another practice

    def test_adding_a_client_notifies_the_handling_advocate(self):
        resp = self._create(handlingAdvocateId=self.arjun.id)
        self.assertEqual(resp.status_code, 201, resp.content[:300])
        self.assertEqual(resp.json()['handlingAdvocate'],
                         {'id': self.arjun.id, 'name': 'Arjun Menon'})
        self.assertTrue(ClientHandler.objects.filter(
            client_id=resp.json()['id'], advocate_id=self.arjun.id).exists())
        note = Notification.objects.filter(advocate_id=self.arjun.id).first()
        self.assertIsNotNone(note, 'the advocate got no in-app notice')
        self.assertIn('R. Murugan', note.message)

    def test_someone_outside_the_practice_is_refused(self):
        resp = self._create(handlingAdvocateId=self.outsider.id)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(ClientHandler.objects.count(), 0)
        self.assertFalse(Notification.objects.filter(advocate_id=self.outsider.id).exists())

    def test_the_handler_is_optional(self):
        resp = self._create()
        self.assertEqual(resp.status_code, 201)
        self.assertIsNone(resp.json()['handlingAdvocate'])

    def test_editing_other_fields_keeps_the_handler_and_sends_nothing(self):
        cid = self._create(handlingAdvocateId=self.arjun.id).json()['id']
        with mock.patch('notifications.internal_events.client_assigned') as sent:
            # An older caller that doesn't send the field at all.
            resp = self.client.put(f'/api/clients/update/{cid}',
                                   data=json.dumps({'name': 'R. Murugan', 'phone': '9444000701'}),
                                   content_type='application/json', **auth(self.desk))
            self.assertEqual(resp.status_code, 200)
            # The form re-sending the same pick.
            self.client.put(f'/api/clients/update/{cid}',
                            data=json.dumps({'name': 'R. Murugan', 'handlingAdvocateId': self.arjun.id}),
                            content_type='application/json', **auth(self.desk))
        sent.assert_not_called()
        self.assertEqual(ClientHandler.objects.get(client_id=cid).advocate_id, self.arjun.id)

    def test_clearing_the_pick_on_edit(self):
        cid = self._create(handlingAdvocateId=self.arjun.id).json()['id']
        self.client.put(f'/api/clients/update/{cid}',
                        data=json.dumps({'name': 'R. Murugan', 'handlingAdvocateId': None}),
                        content_type='application/json', **auth(self.desk))
        self.assertFalse(ClientHandler.objects.filter(client_id=cid).exists())


class ClientProfileTest(TestCase):
    """The form's address/GSTIN fields used to be accepted and thrown away."""

    FORM = {'name': 'R. Murugan', 'email': 'r.murugan@test.local', 'phone': '9444000700',
            'description': 'Walk-in, first appeal', 'website': '', 'billingCurrency': 'INR',
            'gstin': '33ABCDE1234F1Z5', 'building': 'No. 3', 'street': 'Gandhi Street',
            'city': 'Tambaram', 'district': 'Chengalpattu', 'state': 'Tamil Nadu',
            'pincode': '600045', 'country': 'India'}

    def setUp(self):
        self.adv = make_advocate('profile@test.local', ALL_PERMISSIONS)

    def _put(self, cid, body):
        return self.client.put(f'/api/clients/update/{cid}', data=json.dumps(body),
                               content_type='application/json', **auth(self.adv))

    def test_the_form_fields_are_saved_and_read_back(self):
        resp = self.client.post('/api/clients/create', data=json.dumps(self.FORM),
                                content_type='application/json', **auth(self.adv))
        self.assertEqual(resp.status_code, 201, resp.content[:300])
        got = self.client.get(f"/api/clients/{resp.json()['id']}", **auth(self.adv)).json()
        for key in ('gstin', 'building', 'street', 'city', 'district', 'state', 'pincode',
                    'country', 'description'):
            self.assertEqual(got[key], self.FORM[key], key)
        self.assertEqual(got['address'], 'No. 3, Gandhi Street, Tambaram, Chengalpattu, '
                                         'Tamil Nadu - 600045, India')

    def test_the_list_carries_city_and_gstin(self):
        self.client.post('/api/clients/create', data=json.dumps(self.FORM),
                         content_type='application/json', **auth(self.adv))
        rows = self.client.get('/api/clients', **auth(self.adv)).json()['content']
        self.assertEqual((rows[0]['city'], rows[0]['gstin']), ('Tambaram', '33ABCDE1234F1Z5'))

    def test_editing_an_old_client_keeps_their_address(self):
        """Clients from before profiles have only clients.address."""
        client = make_client(self.adv, 'Old Client', address='12 Anna Salai, Chennai')
        form = {k: '' for k in self.FORM}
        form.update({'name': 'Old Client', 'phone': '9000000000', 'billingCurrency': 'INR'})
        self.assertEqual(self._put(client.id, form).status_code, 200)
        client.refresh_from_db()
        self.assertEqual(client.address, '12 Anna Salai, Chennai')

    def test_an_older_caller_can_still_set_address_directly(self):
        client = make_client(self.adv, 'Plain Client')
        self._put(client.id, {'name': 'Plain Client', 'address': '5 Mount Road, Chennai'})
        client.refresh_from_db()
        self.assertEqual(client.address, '5 Mount Road, Chennai')
