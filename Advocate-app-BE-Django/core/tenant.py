"""SaaS tenancy: which firm a user acts for, and what that firm owns.

    Access = authorised ACTIVE membership of an ACTIVE firm
           + firm ownership of the row (firm_id)
           + role permissions (RequirePermission)
           + internal team / case scope (core/practice.py).

The tenant is never taken from the request (no firm_id parameter is trusted):
it comes from the authenticated identity's membership (firms.FirmMembership).

settings.TENANCY_MODE:
  legacy  practice/team scoping exactly as before; nothing here is consulted.
  shadow  legacy scoping is enforced; the firm scope is computed alongside and
          differences are logged (ids counts only) and classified.
  firm    the firm boundary is enforced.

settings.TENANCY_COLUMNS says whether this database has the firm_id columns;
shadow/firm need it. Ownership is stamped on every save of a tenant model
(`stamp_firm`, connected in core/apps.py) and cross-firm references are refused
there, so no view has to remember to do it.
"""
from __future__ import annotations

import logging

from django.conf import settings

log = logging.getLogger('core.tenant')

_FIRM_CACHE = '_tenant_firm_cache'


# ---------------------------------------------------------------- errors -----
class TenantError(Exception):
    """Base class: the request can't be served for tenancy reasons."""


class FirmNotFound(TenantError):
    """The user has no active firm membership."""


class TenantAccessDenied(TenantError):
    """The firm, membership or a referenced record is not usable here."""


def exception_handler(exc, context):
    """DRF exception handler: tenancy errors are 403s with a plain sentence."""
    from rest_framework import status
    from rest_framework.response import Response
    from rest_framework.views import exception_handler as drf_default
    if isinstance(exc, TenantError):
        return Response({'error': str(exc) or 'Not available in your firm.'},
                        status=status.HTTP_403_FORBIDDEN)
    return drf_default(exc, context)


# ------------------------------------------------------------------ modes -----
def mode():
    return settings.TENANCY_MODE


def columns():
    return bool(settings.TENANCY_COLUMNS)


def has_firm_column(model):
    return columns() and any(f.attname == 'firm_id' for f in model._meta.concrete_fields)


# ------------------------------------------------------------- membership -----
def _models():
    from firms.models import Firm, FirmMembership
    return Firm, FirmMembership


def active_membership(advocate_id):
    _, FirmMembership = _models()
    return (FirmMembership.objects.select_related('firm')
            .filter(advocate_id=advocate_id, status=FirmMembership.ACTIVE)
            .order_by('-is_default', 'id').first())


def firm_id_of_advocate(advocate_id):
    """The firm an identity's work belongs to: its active membership, else the
    most recent membership it had (a former member's rows stay with that firm)."""
    if not advocate_id:
        return None
    _, FirmMembership = _models()
    m = active_membership(advocate_id)
    if m is None:
        m = (FirmMembership.objects.filter(advocate_id=advocate_id)
             .order_by('-joined_at', '-id').first())
    return m.firm_id if m else None


def firm_active(firm_id):
    """Is this firm running? Unknown / no firm (legacy data) counts as running."""
    if not firm_id or not columns():
        return True
    Firm, _ = _models()
    firm = Firm.objects.filter(id=firm_id).only('status').first()
    return firm is None or firm.is_active


def can_receive(advocate_id, firm_id=None):
    """May this identity be told about work of `firm_id` now?

    Background jobs have no request, so they ask here instead of relying on a
    session: the person must not have left, and in firm mode must hold an
    ACTIVE membership of that (ACTIVE) firm. A suspended member, a suspended
    firm, or someone who moved to another firm gets nothing about it - even if
    they created the case. Legacy / shadow: the "has not left" rule only.
    """
    from core.models import Advocate
    if not Advocate.objects.filter(id=advocate_id, left_on__isnull=True).exists():
        return False
    if mode() != 'firm' or not columns():
        return True
    m = active_membership(advocate_id)
    if m is None or not m.firm.is_active:
        return False
    return not firm_id or m.firm_id == firm_id


def firm_of(user):
    """The Firm this user currently acts for, or None. Cached per request object."""
    if user is None or getattr(user, 'id', None) is None:
        return None
    cached = getattr(user, _FIRM_CACHE, False)
    if cached is not False:
        return cached
    m = active_membership(user.id)
    firm = m.firm if m else None
    try:
        setattr(user, _FIRM_CACHE, firm)
    except Exception:                                          # noqa: BLE001
        pass
    return firm


def resolve_firm(user):
    """The firm the user may act for now, or raise."""
    firm = firm_of(user)
    if firm is None:
        raise FirmNotFound('You are not an active member of any firm.')
    if not firm.is_active:
        raise TenantAccessDenied('Your firm\'s access is suspended. Contact AMS support.'
                                 if firm.status == firm.SUSPENDED else 'Your firm is not active.')
    return firm


def validate_firm_membership(user, firm):
    """Raise unless `user` is an ACTIVE member of `firm` and the firm is ACTIVE."""
    current = resolve_firm(user)
    if current.id != getattr(firm, 'id', firm):
        raise TenantAccessDenied('Not available in your firm.')
    return current


def firm_member_ids(firm, kinds=None):
    """Identities whose work belongs to `firm`: every STAFF membership whatever
    its status, so a former member's rows stay with the firm (they lose access
    at authentication, not by having their rows hidden - the legacy rule)."""
    _, FirmMembership = _models()
    kinds = kinds or (FirmMembership.STAFF,)
    fid = getattr(firm, 'id', firm)
    return set(FirmMembership.objects.filter(firm_id=fid, kind__in=kinds)
               .values_list('advocate_id', flat=True))


# ------------------------------------------------------------------ scope -----
def team_scope(user, firm):
    """Advocate ids this user reaches INSIDE `firm`: their team, or every team
    of the firm for firm-wide roles - always limited to the firm's members."""
    from core.models import Advocate
    from core.practice import has_firm_wide_scope, practice_root
    members = firm_member_ids(firm)
    if user.id not in members:
        return []
    if has_firm_wide_scope(user):
        return sorted(members)
    root = practice_root(user)
    team = {root, user.id}
    team.update(Advocate.objects.filter(parent_advocate_id=root).values_list('id', flat=True))
    return sorted(team & members)


def firm_scope_ids(user):
    """team_scope for the user's own firm, or [] when they have no usable firm."""
    try:
        firm = resolve_firm(user)
    except TenantError:
        return []
    return team_scope(user, firm)


def scoped(queryset, firm):
    """Rows of `queryset` owned by `firm` (firm_id), or by records owned by it
    for child tables that inherit ownership from a parent."""
    fid = getattr(firm, 'id', firm)
    model = queryset.model
    if has_firm_column(model):
        return queryset.filter(firm_id=fid)
    parent = INHERITED.get(model._meta.label)
    if parent:
        field, parent_label = parent
        from django.apps import apps
        parent_model = apps.get_model(parent_label)
        return queryset.filter(**{f'{field}__in': parent_model.objects.filter(firm_id=fid).values('id')})
    raise TenantAccessDenied(f'{model._meta.label} has no firm ownership.')


def owned(queryset, user):
    """The central filter for tenant-owned querysets in views.

    legacy / shadow: unchanged (callers already scope by practice_ids()).
    firm: limited to the user's firm by row ownership as well - so a row whose
    creator later moved firm, or a misattributed row, is still not served."""
    if mode() != 'firm':
        return queryset
    return scoped(queryset, resolve_firm(user))


# Child tables without their own firm_id: (reference column, parent model).
INHERITED = {
    'workspace.CaseParty': ('case_id', 'core.Case'),
    'workspace.CaseTag': ('case_id', 'core.Case'),
    'workspace.HearingDetail': ('event_id', 'core.CaseEvent'),
    'workspace.CaseProfile': ('case_id', 'core.Case'),
    'workspace.RelatedCase': ('case_id', 'core.Case'),
    'documents.DocumentVersion': ('document_id', 'core.Document'),
    'documents.DocumentSummary': ('document_id', 'core.Document'),
    'clientaccess.ClientUser': ('client_id', 'core.Client'),
    'clients.ClientHandler': ('client_id', 'core.Client'),
}


# ----------------------------------------------------------- shadow mode -----
EXPECTED, EXPANSION, LOSS, ANOMALY = ('expected_authorized', 'unexpected_expansion',
                                      'unexpected_loss', 'ownership_anomaly')


def classify(user, legacy_ids, firm_ids):
    """Compare the two scopes for one user. Returns a list of
    (classification, count) - metadata only, never names or row contents."""
    from core.practice import has_firm_wide_scope
    legacy_ids, firm_ids = set(legacy_ids), set(firm_ids)
    out = []
    extra, lost = firm_ids - legacy_ids, legacy_ids - firm_ids
    firm = firm_of(user)
    if extra:
        members = firm_member_ids(firm) if firm else set()
        if firm and extra <= members and has_firm_wide_scope(user):
            out.append((EXPECTED, len(extra)))       # e.g. a firm-wide accountant now sees the whole firm
        else:
            out.append((EXPANSION, len(extra)))
    if lost:
        if firm is None:
            out.append((LOSS, len(lost)))             # the user has no membership yet
        else:
            _, FirmMembership = _models()
            other = set(FirmMembership.objects.filter(advocate_id__in=lost)
                        .exclude(firm_id=firm.id).values_list('advocate_id', flat=True))
            unmapped = lost - set(FirmMembership.objects.filter(advocate_id__in=lost)
                                  .values_list('advocate_id', flat=True))
            if lost <= (other | unmapped):
                out.append((ANOMALY, len(lost)))      # those ids belong elsewhere or are unmapped
            else:
                out.append((LOSS, len(lost)))
    return out


def report_shadow_difference(user, legacy_ids, firm_ids):
    if set(legacy_ids) == set(firm_ids):
        return []
    result = classify(user, legacy_ids, firm_ids)
    for kind, count in result:
        level = logging.ERROR if kind == EXPANSION else logging.WARNING
        log.log(level, 'tenancy-shadow user=%s %s ids=%d', user.id, kind, count)
    return result


# ------------------------------------------------- ownership on every save -----
# Reference columns checked for cross-firm links, per target model.
_REFERENCES = {
    'case_id': 'core.Case', 'related_case_id': 'core.Case',
    'document_id': 'core.Document', 'ams_document_id': 'core.Document',
    'invoice_id': 'core.Invoice', 'ams_client_id': 'core.Client',
    'task_id': 'workspace.CaseTask',
    'session_id': 'drafting.DraftSession', 'source_sample_id': 'drafting.Sample',
    'template_id': 'drafting.Template', 'project_id': 'drafting.Project',
    'playbook_id': 'drafting.Playbook',
}
_OWNER_COLUMNS = ('advocate_id', 'created_by_id', 'uploaded_by_id', 'requested_by_id')


def _reference_target(model, column):
    if column == 'client_id':
        return 'drafting.Client' if model._meta.app_label == 'drafting' else 'core.Client'
    return _REFERENCES.get(column)


def _firm_of_reference(label, pk):
    from django.apps import apps
    target = apps.get_model(label)
    if not has_firm_column(target):
        return None
    return target.objects.filter(pk=pk).values_list('firm_id', flat=True).first()


def stamp_firm(sender, instance, raw=False, **kwargs):
    """pre_save: give a new tenant row its owning firm, and refuse a row that
    links records of two different firms (a case of firm A with a client of
    firm B, a document on another firm's case, ...)."""
    if raw or not has_firm_column(sender):
        return
    names = {f.attname for f in sender._meta.concrete_fields}
    refs = {}
    for column in names:
        label = _reference_target(sender, column)
        value = getattr(instance, column, None)
        if label and value not in (None, ''):
            refs[column] = _firm_of_reference(label, value)
    if instance.firm_id is None:
        owner = next((getattr(instance, c) for c in _OWNER_COLUMNS
                      if c in names and getattr(instance, c, None)), None)
        instance.firm_id = (firm_id_of_advocate(owner)
                            or next((f for f in refs.values() if f), None))
    for column, other in refs.items():
        if other and instance.firm_id and other != instance.firm_id:
            raise TenantAccessDenied('That record belongs to another firm.')


def connect():
    """Wire stamp_firm to every model that has a firm_id column."""
    from django.apps import apps
    from django.db.models.signals import pre_save
    if not columns():
        return
    for model in apps.get_models():
        if has_firm_column(model):
            pre_save.connect(stamp_firm, sender=model, dispatch_uid=f'tenant-stamp-{model._meta.label}')
