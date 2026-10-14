"""Firm workspace endpoints for the app shell and Firm Administration (Phase 6).

GET  /api/firm/current          any member: the firm's name, display name, logo (shell header)
GET  /api/firm/settings         SETTINGS_EDIT: the firm's settings (firms.FirmSettings)
PUT  /api/firm/settings         SETTINGS_EDIT: update them
POST/DELETE /api/firm/settings/logo   SETTINGS_EDIT: firm logo (PNG / JPEG / WebP, <= 2 MB)
GET  /api/firm/members          USER_MANAGE: staff memberships with status and firm roles

Settings live on the permanent FirmSettings record - never on the former root
advocate's profile.
"""
import os
import uuid

from django.conf import settings as dj
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from core import tenant
from core.models import Advocate, AdvocateRole, Role
from core.permissions import RequirePermission
from core.validators import check_payload

from .models import FirmInvitation, FirmMembership, FirmSettings

IMAGE_TYPES = {'.png', '.jpg', '.jpeg', '.webp'}
MAX_LOGO_BYTES = 2 * 1024 * 1024

FIELDS = {   # API name -> FirmSettings field
    'displayName': 'display_name', 'officeAddress': 'office_address', 'city': 'city', 'state': 'state',
    'country': 'country', 'pinCode': 'pin_code', 'officePhone': 'office_phone', 'officeEmail': 'office_email',
    'website': 'website', 'gstNumber': 'gst_number', 'panNumber': 'pan_number',
    'primaryBrandColor': 'primary_brand_color', 'secondaryBrandColor': 'secondary_brand_color',
    'timeZone': 'time_zone', 'currency': 'currency', 'dateFormat': 'date_format',
    'invoicePrefix': 'invoice_prefix', 'invoiceFyReset': 'invoice_fy_reset',
}


def logo_url(path):
    return '/api/profile/files/branding/' + os.path.basename(path) if path else None


def settings_map(firm, s):
    out = {k: getattr(s, f) for k, f in FIELDS.items()}
    out.update({'name': firm.name, 'publicId': str(firm.public_id), 'status': firm.status,
                'logoUrl': logo_url(s.logo_path), 'planCode': firm.plan_code})
    return out


def _settings(firm):
    s, _ = FirmSettings.objects.get_or_create(firm=firm, defaults={'display_name': firm.name})
    return s


class CurrentFirmView(APIView):
    """The shell header: which firm am I working in."""

    def get(self, request):
        firm = tenant.firm_of(request.user)
        if firm is None:
            return Response({'firm': None})
        s = _settings(firm)
        return Response({'firm': {'publicId': str(firm.public_id), 'name': firm.name,
                                  'displayName': s.display_name or firm.name, 'logoUrl': logo_url(s.logo_path),
                                  'status': firm.status, 'primaryBrandColor': s.primary_brand_color}})


class FirmSettingsView(APIView):
    permission_classes = [RequirePermission('SETTINGS_EDIT')]

    def get(self, request):
        firm = tenant.resolve_firm(request.user)
        return Response(settings_map(firm, _settings(firm)))

    def put(self, request):
        firm = tenant.resolve_firm(request.user)
        data, bad = check_payload(request.data, {'officeEmail': 'email', 'officePhone': 'landline',
                                                 'pinCode': 'pincode', 'gstNumber': 'gstin', 'panNumber': 'pan'})
        if bad is not None:
            return bad
        s = _settings(firm)
        changed = []
        for key, field in FIELDS.items():
            if key in data:
                value = data[key]
                if field == 'invoice_fy_reset':
                    value = bool(value)
                else:
                    value = '' if value is None else str(value).strip()
                    limit = s._meta.get_field(field).max_length
                    if limit and len(value) > limit:
                        return Response({'error': f'{key} is too long.', 'errors': {key: 'Too long.'}}, status=400)
                setattr(s, field, value)
                changed.append(field)
        if 'displayName' in data and not (data['displayName'] or '').strip():
            return Response({'error': 'Give the firm a display name.', 'errors': {'displayName': 'Required.'}},
                            status=400)
        if changed:
            s.save()
            from rbac.firm_roles import audit
            audit(request.user, firm, 'UPDATE', 'Firm settings updated', firm.id, {'fields': sorted(changed)})
        return Response(settings_map(firm, s))


class FirmLogoView(APIView):
    permission_classes = [RequirePermission('SETTINGS_EDIT')]

    def post(self, request):
        firm = tenant.resolve_firm(request.user)
        f = request.FILES.get('file')
        if f is None:
            return Response({'error': 'Choose an image file.'}, status=400)
        ext = os.path.splitext(f.name or '')[1].lower()
        if ext not in IMAGE_TYPES or f.size > MAX_LOGO_BYTES:
            return Response({'error': 'Use a PNG, JPEG or WebP image of at most 2 MB.'}, status=400)
        folder = os.path.join(dj.DOCUMENT_UPLOAD_DIR, 'branding')
        os.makedirs(folder, exist_ok=True)
        stored = f'firm-{firm.public_id.hex[:12]}-{uuid.uuid4().hex}{ext}'
        with open(os.path.join(folder, stored), 'wb') as out:
            for chunk in f.chunks():
                out.write(chunk)
        s = _settings(firm)
        old = s.logo_path
        s.logo_path = f'branding/{stored}'
        s.save(update_fields=['logo_path', 'updated_at'])
        _remove(old)
        return Response(settings_map(firm, s))

    def delete(self, request):
        firm = tenant.resolve_firm(request.user)
        s = _settings(firm)
        old = s.logo_path
        s.logo_path = ''
        s.save(update_fields=['logo_path', 'updated_at'])
        _remove(old)
        return Response(settings_map(firm, s))


def _remove(path):
    # Only a file this view stored (branding/firm-...), never anything else.
    name = os.path.basename(path or '')
    if path and path.startswith('branding/firm-') and '..' not in path:
        try:
            os.remove(os.path.join(dj.DOCUMENT_UPLOAD_DIR, 'branding', name))
        except OSError:
            pass


class FirmMembersView(APIView):
    """Staff of my firm: active, invited, suspended and former members."""
    permission_classes = [RequirePermission('USER_MANAGE')]

    def get(self, request):
        firm = tenant.resolve_firm(request.user)
        members = list(FirmMembership.objects.filter(firm=firm, kind=FirmMembership.STAFF).order_by('id'))
        people = {a.id: a for a in Advocate.objects.filter(id__in=[m.advocate_id for m in members])}
        roles = {r.id: r for r in Role.objects.filter(firm_id=firm.id)}
        held = {}
        for a, r in AdvocateRole.objects.filter(advocate_id__in=list(people), role_id__in=list(roles)) \
                .values_list('advocate_id', 'role_id'):
            held.setdefault(a, []).append(r)
        pending = {i.advocate_id: i for i in FirmInvitation.objects.filter(firm=firm, accepted_at__isnull=True,
                                                                          revoked_at__isnull=True)}
        out = []
        for m in members:
            p = people.get(m.advocate_id)
            if p is None:
                continue
            rids = held.get(m.advocate_id, [])
            inv = pending.get(m.advocate_id)
            out.append({
                'advocateId': p.id, 'fullName': p.full_name, 'email': p.email, 'status': m.status,
                'membershipId': m.id, 'joinedAt': m.joined_at, 'leftAt': m.left_at,
                'teamRootId': m.team_root_id, 'isSelf': p.id == request.user.id,
                'roles': [{'id': r, 'name': roles[r].name, 'isAdmin': roles[r].is_admin} for r in rids],
                'isAdmin': any(roles[r].is_admin and not roles[r].disabled for r in rids),
                'invitation': ({'id': inv.id, 'status': inv.status, 'deliveryStatus': inv.delivery_status,
                                'expiresAt': inv.expires_at} if inv else None),
            })
        return Response(out)
