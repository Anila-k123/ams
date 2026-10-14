"""Phase 6 backend additions: firm shell/settings/members APIs, platform stats
and audit filters, invitation delivery status, encrypted operator MFA seeds."""
import json
import os
import re
import shutil
import tempfile
from unittest import mock

from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from core.models import Advocate, AdvocateRole
from core.testing import auth, make_advocate
from firms.models import Firm, FirmInvitation, FirmMembership, FirmSettings
from platform_admin.tests import _Base, bearer, make_operator
from rbac import firm_roles as fr
from rbac.tests_firm_rbac import make_templates


def member(firm, role_name=None):
    adv = make_advocate()
    m = FirmMembership.objects.create(firm=firm, advocate_id=adv.id, status=FirmMembership.ACTIVE)
    if role_name:
        AdvocateRole.objects.create(advocate_id=adv.id, role_id=fr.firm_roles(firm).get(name=role_name).id,
                                    firm_id=firm.id, membership_id=m.id)
    return adv


@override_settings(TENANCY_MODE='firm')
class FirmAdminApiTests(TestCase):
    def setUp(self):
        make_templates()
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        self._s = override_settings(DOCUMENT_UPLOAD_DIR=self.dir)
        self._s.enable()
        self.addCleanup(self._s.disable)
        self.f = {}
        for k in 'ABC':
            self.f[k] = Firm.objects.create(name=f'Firm {k}', slug=f'f-{k.lower()}', status=Firm.ACTIVE)
            FirmSettings.objects.create(firm=self.f[k], display_name=f'{k} Associates')
            fr.provision_default_roles(self.f[k])
        self.admin_a = member(self.f['A'], 'Super Admin')
        self.junior_a = member(self.f['A'], 'Advocate')
        self.admin_b = member(self.f['B'], 'Super Admin')

    def put(self, url, body, who):
        return self.client.put(url, data=json.dumps(body), content_type='application/json', **auth(who))

    def test_each_member_sees_their_own_firm_in_the_shell(self):
        a = self.client.get('/api/firm/current', **auth(self.junior_a)).json()['firm']
        b = self.client.get('/api/firm/current', **auth(self.admin_b)).json()['firm']
        self.assertEqual((a['displayName'], b['displayName']), ('A Associates', 'B Associates'))

    def test_settings_are_firm_settings_and_need_settings_edit(self):
        self.assertEqual(self.client.get('/api/firm/settings', **auth(self.junior_a)).status_code, 403)
        r = self.put('/api/firm/settings', {'displayName': 'ABC Associates', 'city': 'Chennai',
                                            'officeEmail': 'office@abc.test'}, self.admin_a)
        self.assertEqual(r.status_code, 200, r.content)
        s = FirmSettings.objects.get(firm=self.f['A'])
        self.assertEqual((s.display_name, s.city), ('ABC Associates', 'Chennai'))
        self.admin_a.refresh_from_db()
        self.assertNotEqual(self.admin_a.office_name, 'ABC Associates')   # not the advocate profile
        self.assertEqual(FirmSettings.objects.get(firm=self.f['B']).display_name, 'B Associates')
        self.assertEqual(self.put('/api/firm/settings', {'officeEmail': 'not-an-email'}, self.admin_a).status_code, 400)
        self.assertEqual(self.put('/api/firm/settings', {'displayName': '  '}, self.admin_a).status_code, 400)

    def test_logo_upload_accepts_images_only(self):
        svg = SimpleUploadedFile('x.svg', b'<svg onload=alert(1)>', content_type='image/svg+xml')
        r = self.client.post('/api/firm/settings/logo', {'file': svg}, **auth(self.admin_a))
        self.assertEqual(r.status_code, 400)
        png = SimpleUploadedFile('logo.png', b'\x89PNG\r\n\x1a\nfake', content_type='image/png')
        r = self.client.post('/api/firm/settings/logo', {'file': png}, **auth(self.admin_a))
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['logoUrl'].startswith('/api/profile/files/branding/firm-'))
        self.assertEqual(self.client.get(r.json()['logoUrl']).status_code, 200)
        r = self.client.post('/api/firm/settings/logo', {'file': png}, **auth(self.junior_a))
        self.assertEqual(r.status_code, 403)

    def test_profile_branding_refuses_scriptable_files(self):
        html = SimpleUploadedFile('x.html', b'<script>alert(1)</script>', content_type='text/html')
        r = self.client.post('/api/profile/branding/logo', {'file': html}, **auth(self.admin_a))
        self.assertEqual(r.status_code, 400)

    def test_members_list_is_the_firms_only(self):
        self.assertEqual(self.client.get('/api/firm/members', **auth(self.junior_a)).status_code, 403)
        rows = self.client.get('/api/firm/members', **auth(self.admin_a)).json()
        ids = {r['advocateId'] for r in rows}
        self.assertEqual(ids, {self.admin_a.id, self.junior_a.id})
        me = next(r for r in rows if r['advocateId'] == self.admin_a.id)
        self.assertTrue(me['isAdmin'] and me['isSelf'])
        self.assertNotIn(self.admin_b.id, ids)


@override_settings(TENANCY_MODE='firm')
class PlatformAdditionsTests(_Base):
    def setUp(self):
        super().setUp()
        self.token = self.op_token()

    def create(self, slug, **extra):
        body = {'name': f'Firm {slug}', 'slug': slug, 'adminEmail': f'admin@{slug}.test', **extra}
        return self.jpost('/api/platform/firms', body, **bearer(self.token))

    def test_stats_come_from_the_database(self):
        self.create('aaa')
        self.create('bbb')
        stats = self.client.get('/api/platform/stats', **bearer(self.token)).json()
        self.assertEqual(stats['firms']['total'], 2)
        self.assertEqual(stats['firms']['PROVISIONING'], 2)
        self.assertEqual(stats['pendingAdminInvitations'], 2)
        self.assertEqual(stats['createdLast7Days'], 2)

    def test_contact_metadata_on_create_and_detail(self):
        r = self.create('ccc', contact={'officeEmail': 'office@ccc.test', 'city': 'Madurai'})
        pid = r.json()['firm']['publicId']
        detail = self.client.get(f'/api/platform/firms/{pid}', **bearer(self.token)).json()
        self.assertEqual((detail['contact']['officeEmail'], detail['contact']['city']), ('office@ccc.test', 'Madurai'))
        self.assertEqual(detail['adminInvitation']['deliveryStatus'], 'SENT')
        r = self.client.patch(f'/api/platform/firms/{pid}', data=json.dumps({'contact': {'officeEmail': 'bad'}}),
                              content_type='application/json', **bearer(self.token))
        self.assertEqual(r.status_code, 400)

    def test_audit_filters(self):
        self.create('ddd')
        self.op_login(password='Wrong#Guess999')
        rows = self.client.get('/api/platform/audit?action=FIRM_CREATE', **bearer(self.token)).json()['results']
        self.assertTrue(rows and all('FIRM_CREATE' in r['action'] for r in rows))
        rows = self.client.get('/api/platform/audit?success=false', **bearer(self.token)).json()['results']
        self.assertTrue(rows and all(not r['success'] for r in rows))
        self.assertEqual(self.client.get('/api/platform/audit?firm=not-a-uuid', **bearer(self.token)).json()['results'], [])

    def test_audit_pages_say_when_older_events_exist(self):
        for slug in ('pga', 'pgb', 'pgc'):
            self.create(slug)
        first = self.client.get('/api/platform/audit?limit=2', **bearer(self.token)).json()
        self.assertEqual(len(first['results']), 2)
        self.assertTrue(first['hasMore'])
        second = self.client.get(f"/api/platform/audit?limit=2&before={first['nextBefore']}",
                                 **bearer(self.token)).json()
        self.assertTrue(all(r['id'] < first['nextBefore'] for r in second['results']))
        self.assertFalse({r['id'] for r in first['results']} & {r['id'] for r in second['results']})
        # Bounded whatever is asked for.
        self.assertLessEqual(len(self.client.get('/api/platform/audit?limit=100000',
                                                 **bearer(self.token)).json()['results']), 200)
        self.assertEqual(self.client.get('/api/platform/audit?limit=abc', **bearer(self.token)).status_code, 200)

    def test_failed_invitation_delivery_is_recorded_and_retryable(self):
        with mock.patch('firms.invitations.send_mail', side_effect=ConnectionRefusedError('smtp down')):
            r = self.create('eee')
        inv = FirmInvitation.objects.get(firm__slug='eee')
        self.assertEqual(inv.delivery_status, 'FAILED')
        self.assertIn('ConnectionRefusedError', inv.delivery_error)
        self.assertNotRegex(inv.delivery_error, r'token=')
        self.assertEqual(self.client.get('/api/platform/stats', **bearer(self.token)).json()
                         ['failedInvitationDeliveries'], 1)
        pid = r.json()['firm']['publicId']
        self.jpost(f'/api/platform/firms/{pid}/invitations/{inv.id}/resend', **bearer(self.token))
        inv.refresh_from_db()
        self.assertEqual((inv.delivery_status, inv.send_count), ('SENT', 2))

    def test_mfa_seed_is_encrypted_and_login_fails_closed_without_the_key(self):
        stored = PlatformOperator_mfa(self.op)
        self.assertTrue(stored.startswith('f1:'))
        self.assertNotIn(self.op.seed, stored)
        with override_settings(PLATFORM_MFA_KEY=''):
            r = self.op_login()
        self.assertEqual((r.status_code, r.json()['code']), (503, 'MFA_UNAVAILABLE'))
        from cryptography.fernet import Fernet
        with override_settings(PLATFORM_MFA_KEY=Fernet.generate_key().decode()):
            self.assertEqual(self.op_login().status_code, 503)   # wrong key: refused, never plaintext


def PlatformOperator_mfa(op):
    from platform_admin.models import PlatformOperator
    return PlatformOperator.objects.values_list('mfa_secret', flat=True).get(id=op.id)


class ConsoleMailDeliveryTests(TestCase):
    """With the console mail backend nothing is emailed: the invitation says so."""

    def test_console_backend_is_not_reported_as_sent(self):
        from django.test import override_settings
        from firms.invitations import _send
        from firms.models import Firm, FirmInvitation
        import datetime
        firm = Firm.objects.create(name='Console Firm', slug='console-firm', status=Firm.PROVISIONING)
        inv = FirmInvitation.objects.create(firm=firm, email='x@console.test', kind=FirmInvitation.FIRM_ADMIN,
                                            token_hash='h' * 64, role_ids=[],
                                            expires_at=datetime.datetime.now() + datetime.timedelta(hours=1))
        with override_settings(EMAIL_BACKEND='django.core.mail.backends.console.EmailBackend'),                 self.captureOnCommitCallbacks(execute=True), mock.patch('sys.stdout'):
            _send(inv, 'tok')
        inv.refresh_from_db()
        self.assertEqual(inv.delivery_status, 'CONSOLE')
