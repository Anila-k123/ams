"""Tests for backup and restore.

Restore is the only action in the application that can destroy an advocate's
whole dataset with no undo: it DELETEs every row they own and re-inserts from an
uploaded archive. Two bugs in that path were found by reading the code rather
than by using the app, and both would have been silent:

  * a Documents-only archive restored as FULL erased the account and put
    nothing back, because the DELETE was unconditional and the re-insert was
    guarded by "if the file has this section"
  * inserted rows kept the advocate_id they were exported with, so an uploaded
    archive could write into somebody else's account

These tests exist so neither can come back.
"""

from __future__ import annotations

import io
import json
import shutil
import tempfile
import zipfile

from django.test import TestCase, override_settings

from backup import service
from core.models import Advocate, Case, Client


def make_advocate(email='owner@test.local', **extra):
    return Advocate.objects.create(
        full_name=extra.pop('full_name', 'Test Owner'), email=email,
        password='hashed', bar_council_id='BC-' + email[:6], role='ADVOCATE',
        theme='light', whatsapp_enabled=False,
        email_notifications_enabled=True, browser_notifications_enabled=True,
        **extra)


class BackupTestCase(TestCase):
    """Base class that keeps written archives out of the real uploads folder.

    create_backup writes to DOCUMENT_UPLOAD_DIR/backups. Without this the suite
    left 35 real backup ZIPs in the developer's uploads directory - test output
    is not something a run should leave lying around in the app's own storage.
    """

    def setUp(self):
        self._tmp = tempfile.mkdtemp(prefix='ams-backup-test-')
        self._override = override_settings(DOCUMENT_UPLOAD_DIR=self._tmp)
        self._override.enable()
        self.addCleanup(self._override.disable)
        self.addCleanup(shutil.rmtree, self._tmp, True)
        super().setUp()


def zip_with(entries):
    """A ZIP containing exactly the given {path: text} entries."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        for path, text in entries.items():
            z.writestr(path, text)
    return buf.getvalue()


class RestoreRefusalTest(BackupTestCase):
    """A restore that cannot put data back must not take it away."""

    def setUp(self):
        super().setUp()
        self.advocate = make_advocate()
        for i in range(3):
            Client.objects.create(name='Client %d' % i, deleted=False,
                                  advocate_id=self.advocate.id)

    def test_documents_only_archive_does_not_wipe_records(self):
        # The exact shape that used to erase everything: no data/ section, but
        # asked for as a FULL restore.
        archive = zip_with({
            'documents/brief.pdf': 'x',
            'metadata.json': json.dumps({'backupType': 'DOCUMENTS'}),
        })
        result = service.restore_backup(self.advocate, archive, 'FULL')

        self.assertEqual(result['status'], 'FAILED')
        self.assertIn('no database records', result['message'])
        self.assertEqual(
            Client.objects.filter(advocate_id=self.advocate.id).count(), 3,
            'a refused restore must leave every row untouched')

    def test_database_restore_of_dataless_archive_also_refuses(self):
        archive = zip_with({'documents/x.pdf': 'x'})
        result = service.restore_backup(self.advocate, archive, 'DATABASE')
        self.assertEqual(result['status'], 'FAILED')
        self.assertEqual(
            Client.objects.filter(advocate_id=self.advocate.id).count(), 3)

    def test_invalid_zip_refuses_without_taking_a_rollback(self):
        result = service.restore_backup(self.advocate, b'not a zip at all', 'FULL')
        self.assertEqual(result['status'], 'FAILED')
        # No rollback file: reading the archive happens first, so a mis-drop
        # does not litter the disk with pointless backups.
        self.assertIsNone(result['rollbackFile'])
        self.assertEqual(
            Client.objects.filter(advocate_id=self.advocate.id).count(), 3)


class RestoreOwnershipTest(BackupTestCase):
    """An uploaded archive must not be able to write into another account."""

    def setUp(self):
        super().setUp()
        self.owner = make_advocate('owner@test.local')
        self.other = make_advocate('other@test.local', full_name='Other')

    def test_rows_are_forced_to_the_restoring_advocate(self):
        # An archive whose rows claim to belong to `other`.
        rows = [{'id': 9001, 'name': 'Injected Client', 'deleted': False,
                 'advocate_id': self.other.id}]
        archive = zip_with({
            'data/clients.json': json.dumps(rows),
            'metadata.json': json.dumps({'backupType': 'FULL'}),
        })

        result = service.restore_backup(self.owner, archive, 'FULL')
        self.assertEqual(result['status'], 'SUCCESS', result.get('message'))

        injected = Client.objects.filter(id=9001).first()
        self.assertIsNotNone(injected)
        self.assertEqual(
            injected.advocate_id, self.owner.id,
            'the row must belong to whoever ran the restore, not to the id in the file')
        self.assertEqual(
            Client.objects.filter(advocate_id=self.other.id).count(), 0,
            'nothing may be written into the other advocate account')


class BackupRoundTripTest(BackupTestCase):
    """A backup restored over its own account must change nothing."""

    def setUp(self):
        super().setUp()
        self.advocate = make_advocate()
        self.client_row = Client.objects.create(
            name='Round Trip', email='rt@test.local', phone='999',
            deleted=False, advocate_id=self.advocate.id)
        Case.objects.create(
            case_number='RT/1/2026', case_title='Round Trip Case',
            status='Active', deleted=False, advocate_id=self.advocate.id,
            client=self.client_row)

    def _counts(self):
        return (Client.objects.filter(advocate_id=self.advocate.id).count(),
                Case.objects.filter(advocate_id=self.advocate.id).count())

    def test_full_backup_then_restore_preserves_every_row(self):
        before = self._counts()
        created = service.create_backup(self.advocate, 'FULL')
        self.assertEqual(created['status'], 'SUCCESS')

        import os
        path = os.path.join(service._backup_dir(), created['fileName'])
        with open(path, 'rb') as f:
            archive = f.read()

        result = service.restore_backup(self.advocate, archive, 'FULL')
        self.assertEqual(result['status'], 'SUCCESS', result.get('message'))
        self.assertEqual(self._counts(), before)
        # And the values, not just the counts.
        self.assertEqual(
            Client.objects.get(id=self.client_row.id).name, 'Round Trip')

    def test_two_backups_in_the_same_second_do_not_collide(self):
        # Names are stamped to the second, and a restore takes its rollback
        # backup immediately before writing - so these used to overwrite each
        # other while backup_history kept two rows pointing at one file.
        a = service.create_backup(self.advocate, 'SETTINGS')
        b = service.create_backup(self.advocate, 'SETTINGS')
        self.assertNotEqual(a['fileName'], b['fileName'])


class BackupContentTest(BackupTestCase):
    def setUp(self):
        super().setUp()
        self.advocate = make_advocate()

    def test_settings_backup_excludes_the_password(self):
        service.create_backup(self.advocate, 'SETTINGS')
        import os
        # Read the newest archive back and check the advocate password is gone.
        d = service._backup_dir()
        newest = max((os.path.join(d, f) for f in os.listdir(d)),
                     key=os.path.getmtime)
        with zipfile.ZipFile(newest) as z:
            settings_json = json.loads(z.read('settings/settings.json'))
        self.assertNotIn('password', settings_json)

    def test_backup_reports_sections_and_counts(self):
        Client.objects.create(name='Counted', deleted=False,
                              advocate_id=self.advocate.id)
        result = service.create_backup(self.advocate, 'FULL')
        # The page shows these instead of an invented progress animation, so
        # they have to actually be there.
        self.assertTrue(result['sections'])
        self.assertEqual(result['recordCounts']['clients'], 1)
        self.assertEqual(result['healthScore'], 100)
