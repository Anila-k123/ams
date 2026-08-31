"""Tests for who can reach what.

Two things are pinned here.

Practice scoping, because it is new and it is the difference between a junior
seeing the chambers' cases and seeing an empty application. Getting it wrong in
one direction makes the app useless; in the other it leaks one firm's cases to
another.

And the authentication gate, because it was once genuinely open: 61 endpoints
returned data to an unauthenticated caller until RequirePermission was fixed to
check authentication before permissions. That must not come back.
"""

from __future__ import annotations

from django.test import TestCase

from core import practice
from core.testing import (ALL_PERMISSIONS, auth, make_advocate, make_case,
                          make_client)


class PracticeScopeTest(TestCase):
    """A practice shares data; anyone outside it sees none of it."""

    def setUp(self):
        self.owner = make_advocate('owner@test.local', ALL_PERMISSIONS)
        self.member = make_advocate('member@test.local', ALL_PERMISSIONS,
                                    parent_advocate_id=self.owner.id)
        self.outsider = make_advocate('outsider@test.local', ALL_PERMISSIONS)

        self.owner_client = make_client(self.owner, 'Owner Client')
        self.owner_case = make_case(self.owner, self.owner_client)
        make_case(self.outsider, make_client(self.outsider, 'Outsider Client'))

    # -- the scope function itself ----------------------------------------

    def test_owner_scope_includes_members(self):
        self.assertEqual(sorted(practice.practice_ids(self.owner)),
                         sorted([self.owner.id, self.member.id]))

    def test_member_scope_includes_the_owner(self):
        self.assertEqual(sorted(practice.practice_ids(self.member)),
                         sorted([self.owner.id, self.member.id]))

    def test_solo_advocate_scope_is_only_themselves(self):
        self.assertEqual(practice.practice_ids(self.outsider),
                         [self.outsider.id])

    def test_scope_is_cached_per_user_object(self):
        first = practice.practice_ids(self.member)
        self.assertIs(first, practice.practice_ids(self.member))

    # -- through the API ---------------------------------------------------

    def test_member_sees_the_practice_cases(self):
        res = self.client.get('/api/cases', **auth(self.member))
        self.assertEqual(res.status_code, 200)
        self.assertIn(self.owner_case.case_number, res.content.decode())

    def test_outsider_cannot_see_the_practice_cases(self):
        """The important direction: permissions alone must not grant reach."""
        res = self.client.get('/api/cases', **auth(self.outsider))
        self.assertEqual(res.status_code, 200)
        self.assertNotIn(self.owner_case.case_number, res.content.decode())

    def test_outsider_cannot_fetch_a_practice_case_by_id(self):
        res = self.client.get('/api/cases/%d' % self.owner_case.id,
                              **auth(self.outsider))
        self.assertIn(res.status_code, (403, 404),
                      'guessing an id must not return another practice case')

    def test_member_sees_the_practice_clients(self):
        res = self.client.get('/api/clients', **auth(self.member))
        self.assertEqual(res.status_code, 200)
        self.assertIn('Owner Client', res.content.decode())

    def test_outsider_cannot_see_the_practice_clients(self):
        res = self.client.get('/api/clients', **auth(self.outsider))
        self.assertEqual(res.status_code, 200)
        self.assertNotIn('Owner Client', res.content.decode())

    def test_a_member_creation_is_attributed_to_the_member(self):
        """Sharing must not blur who did what - it is why created_by is not needed."""
        case = make_case(self.member, self.owner_client)
        self.assertEqual(case.advocate_id, self.member.id)
        # ...and the owner can still see it.
        self.assertIn(case.advocate_id, practice.practice_ids(self.owner))


class NotificationsStayPersonalTest(TestCase):
    """A notification is addressed to one advocate, not to the practice."""

    def setUp(self):
        self.owner = make_advocate('n-owner@test.local', ALL_PERMISSIONS)
        self.member = make_advocate('n-member@test.local', ALL_PERMISSIONS,
                                    parent_advocate_id=self.owner.id)
        from django.utils import timezone
        from core.models import Notification
        Notification.objects.create(
            created_at=timezone.now(), message='Owner only reminder',
            read_status=False, advocate_id=self.owner.id)

    def test_member_does_not_see_the_owner_notification(self):
        res = self.client.get('/api/notifications/unread', **auth(self.member))
        self.assertEqual(res.status_code, 200)
        self.assertNotIn('Owner only reminder', res.content.decode(),
                         'a colleague must not read an alert raised for someone else')

    def test_owner_sees_their_own(self):
        res = self.client.get('/api/notifications/unread', **auth(self.owner))
        self.assertIn('Owner only reminder', res.content.decode())


class AuthenticationGateTest(TestCase):
    """No token, no data. This was once broken across 61 endpoints."""

    ENDPOINTS = [
        '/api/cases', '/api/clients', '/api/invoices', '/api/expenses',
        '/api/payments', '/api/documents', '/api/events', '/api/dashboard',
        '/api/notifications/unread', '/api/reports/cases', '/api/acts',
        '/api/audit', '/api/activities', '/api/backup/history',
        '/api/backup/stats',
        '/api/workspace/tasks/all',
    ]

    def test_every_endpoint_refuses_an_anonymous_request(self):
        for url in self.ENDPOINTS:
            with self.subTest(url=url):
                res = self.client.get(url)
                self.assertIn(res.status_code, (401, 403),
                              '%s answered %s to an anonymous caller'
                              % (url, res.status_code))

    def test_a_garbage_token_is_refused(self):
        res = self.client.get('/api/cases',
                              HTTP_AUTHORIZATION='Bearer not-a-real-token')
        self.assertIn(res.status_code, (401, 403))


class PermissionGateTest(TestCase):
    """A signed-in advocate without the right permission is still refused."""

    def setUp(self):
        # Authenticated, but granted nothing.
        self.nobody = make_advocate('nobody@test.local')
        self.reader = make_advocate('reader@test.local', ('CASE_VIEW',))

    def test_no_permission_is_refused(self):
        res = self.client.get('/api/cases', **auth(self.nobody))
        self.assertEqual(res.status_code, 403)

    def test_the_right_permission_is_allowed(self):
        res = self.client.get('/api/cases', **auth(self.reader))
        self.assertEqual(res.status_code, 200)

    def test_backup_needs_its_own_permission(self):
        """CASE_VIEW must not open the page that can delete an account."""
        res = self.client.get('/api/backup/history', **auth(self.reader))
        self.assertEqual(res.status_code, 403)
        granted = make_advocate('backup@test.local', ('BACKUP_MANAGE',))
        self.assertEqual(
            self.client.get('/api/backup/history', **auth(granted)).status_code,
            200)

    def test_audit_needs_its_own_permission(self):
        res = self.client.get('/api/audit', **auth(self.reader))
        self.assertEqual(res.status_code, 403)


class DepartedMemberTest(TestCase):
    """Work done in a practice stays with the practice after someone leaves.

    Visibility is derived from who is currently in the practice, so removing a
    member used to make every row they created invisible - the rows survived in
    the database and nobody could reach them. A chambers losing its own case
    files because a junior moved on is not an acceptable outcome.
    """

    def setUp(self):
        self.owner = make_advocate('dep-owner@test.local', ALL_PERMISSIONS)
        self.member = make_advocate('dep-member@test.local', ALL_PERMISSIONS,
                                    parent_advocate_id=self.owner.id)
        self.member_case = make_case(self.member,
                                     make_client(self.member, 'Member Client'))

    def _owner_sees_member_case(self):
        from core.models import Advocate, Case
        owner = Advocate.objects.get(id=self.owner.id)   # fresh, uncached
        return Case.objects.filter(
            id=self.member_case.id,
            advocate_id__in=practice.practice_ids(owner)).exists()

    def test_owner_sees_member_work_while_they_are_there(self):
        self.assertTrue(self._owner_sees_member_case())

    def test_owner_still_sees_member_work_after_they_leave(self):
        practice.mark_left(self.member)
        self.assertTrue(
            self._owner_sees_member_case(),
            'the case must stay with the practice after the member leaves')

    def test_a_departed_member_cannot_sign_in(self):
        from core.models import Advocate
        practice.mark_left(self.member)
        res = self.client.get('/api/cases', **auth(self.member))
        self.assertIn(res.status_code, (401, 403),
                      'a departed member must lose access, not keep it')
        self.assertIsNotNone(Advocate.objects.get(id=self.member.id).left_on)


class UserDeletionTest(TestCase):
    """Removing a user must never take the practice's records with them."""

    def setUp(self):
        self.admin = make_advocate('del-admin@test.local', ALL_PERMISSIONS)
        self.member = make_advocate('del-member@test.local', ALL_PERMISSIONS,
                                    parent_advocate_id=self.admin.id)

    def test_a_user_with_records_is_closed_not_deleted(self):
        from core.models import Advocate
        make_case(self.member, make_client(self.member, 'Kept Client'))
        res = self.client.delete('/api/admin/users/%d' % self.member.id,
                                 **auth(self.admin))
        self.assertEqual(res.status_code, 200, res.content[:200])
        self.assertTrue(res.json()['closed'])
        self.assertFalse(res.json()['deleted'])
        still_there = Advocate.objects.filter(id=self.member.id).first()
        self.assertIsNotNone(still_there, 'the row must survive')
        self.assertIsNotNone(still_there.left_on)
        self.assertEqual(still_there.parent_advocate_id, self.admin.id,
                         'membership is kept so their work stays reachable')

    def test_an_empty_account_is_actually_deleted(self):
        from core.models import Advocate
        empty = make_advocate('empty@test.local')
        res = self.client.delete('/api/admin/users/%d' % empty.id,
                                 **auth(self.admin))
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()['deleted'])
        self.assertIsNone(Advocate.objects.filter(id=empty.id).first())

    def test_a_practice_owner_with_members_is_refused(self):
        res = self.client.delete('/api/admin/users/%d' % self.admin.id,
                                 **auth(self.admin))
        # Refused for owning a practice, or for being yourself - either way
        # not destroyed.
        self.assertIn(res.status_code, (400, 409))

    def test_you_cannot_remove_your_own_account(self):
        other = make_advocate('self-admin@test.local', ALL_PERMISSIONS)
        res = self.client.delete('/api/admin/users/%d' % other.id,
                                 **auth(other))
        self.assertEqual(res.status_code, 400)
