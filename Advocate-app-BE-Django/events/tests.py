"""Creating an event refuses an exact repeat (which would also notify the client
and the team twice) unless the user chooses to add it anyway."""

from __future__ import annotations

import json

from django.test import TestCase

from core.models import CaseEvent
from core.testing import ALL_PERMISSIONS, auth, make_advocate, make_case


class DuplicateEventTest(TestCase):
    def setUp(self):
        self.adv = make_advocate('owner@test.local', ALL_PERMISSIONS)
        self.case = make_case(self.adv)

    def _create(self, **extra):
        body = {'caseId': self.case.id, 'title': 'Mediation', 'eventType': 'HEARING',
                'date': '2026-10-13', 'time': '11:00', **extra}
        return self.client.post('/api/events/create', data=json.dumps(body),
                                content_type='application/json', **auth(self.adv))

    def test_the_same_event_again_is_refused_with_the_existing_one(self):
        first = self._create()
        self.assertEqual(first.status_code, 201)
        again = self._create(title='  mediation ')          # case and spacing ignored
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()['duplicate']['id'], first.json()['id'])
        self.assertEqual(CaseEvent.objects.filter(case=self.case).count(), 1)

    def test_add_anyway_saves_the_repeat(self):
        self._create()
        resp = self._create(allowDuplicate=True)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(CaseEvent.objects.filter(case=self.case).count(), 2)

    def test_a_different_title_type_date_or_time_is_not_a_duplicate(self):
        self._create()
        for change in ({'title': 'Arguments'}, {'eventType': 'MEETING'},
                       {'date': '2026-10-14'}, {'time': '15:00'}):
            self.assertEqual(self._create(**change).status_code, 201, change)
