import os
import json
import logging
import datetime

from django.conf import settings
from django.db import transaction
from rest_framework.exceptions import AuthenticationFailed
from django.db.models import Q, Sum
from django.http import FileResponse, Http404
from rest_framework.views import APIView
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

from core.models import Document, Case, Client, Advocate
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import DocumentSerializer


# File-type filter. Browsers report the same kind of file under different MIME
# types (a ZIP from Windows is "application/x-zip-compressed", not
# "application/zip"; some uploads arrive as "application/octet-stream"), so a
# kind matches any of its MIME types or the file's extension.
FILE_KINDS = {
    'pdf': (['application/pdf'], ['.pdf']),
    'image': (['image/'], ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff']),
    'doc': (['application/msword'], ['.doc']),
    'docx': (['application/vnd.openxmlformats-officedocument.wordprocessingml'], ['.docx']),
    'zip': (['application/zip', 'application/x-zip', 'application/x-zip-compressed', 'multipart/x-zip'], ['.zip']),
}
# Older clients sent a MIME prefix; map the known ones onto their kind.
_MIME_TO_KIND = {'application/pdf': 'pdf', 'image/': 'image', 'application/msword': 'doc',
                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
                 'application/zip': 'zip'}


def filter_file_kind(qs, value):
    kind = _MIME_TO_KIND.get(value, value)
    if kind not in FILE_KINDS:
        return qs.filter(file_type__startswith=value)
    mimes, exts = FILE_KINDS[kind]
    q = Q()
    for m in mimes:
        q |= Q(file_type__istartswith=m)
    for e in exts:
        q |= Q(original_name__iendswith=e)
    return qs.filter(q)
from .models import DocumentSummary, DocumentVersion
from .storage import (FILE_UNAVAILABLE, UnsupportedFileType, add_version, create_document,
                      remove_stored_file, resolve_stored_file)
from core.practice import practice_ids
from core.tenant import owned
from django.utils.http import content_disposition_header

log = logging.getLogger(__name__)

SORT_MAP = {'uploadDate': 'upload_date', 'documentName': 'document_name',
            'fileSize': 'file_size', 'id': 'id'}


def _base(user):
    """Documents this user may read: everything in their practice. Documents belong
    to the matter, not the uploader, the same as cases/tasks; the views gate on
    DOCUMENT_VIEW."""
    return owned(Document.objects.select_related('case', 'client').filter(advocate_id__in=practice_ids(user)), user)


class DocumentListView(APIView):
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request):
        p = request.query_params
        qs = _base(request.user)
        if p.get('keyword'):
            kw = p['keyword']
            qs = qs.filter(Q(document_name__icontains=kw) | Q(original_name__icontains=kw) |
                           Q(category__icontains=kw) | Q(description__icontains=kw))
        if p.get('category'):
            qs = qs.filter(category=p['category'])
        if p.get('status'):
            qs = qs.filter(status=p['status'])
        if p.get('fileType'):
            qs = filter_file_kind(qs, p['fileType'])
        sort_by = SORT_MAP.get(p.get('sortBy', 'uploadDate'), 'upload_date')
        sort_dir = p.get('sortDir', 'desc')
        qs = qs.order_by(sort_by if sort_dir == 'asc' else '-' + sort_by, '-id')
        paginator = SpringStylePagination()
        page = paginator.paginate_queryset(qs, request, self)
        return paginator.get_paginated_response(DocumentSerializer(page, many=True).data)


class DocumentSimpleListView(APIView):
    """GET /api/documents/list and /search -> plain array."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request):
        kw = request.query_params.get('keyword')
        qs = _base(request.user)
        if kw:
            qs = qs.filter(Q(document_name__icontains=kw) | Q(original_name__icontains=kw) |
                           Q(category__icontains=kw) | Q(description__icontains=kw))
        qs = qs.order_by('-upload_date', '-id')
        return Response(DocumentSerializer(qs, many=True).data)


class DocumentFilterView(APIView):
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request):
        p = request.query_params
        qs = _base(request.user)
        if p.get('category'):
            qs = qs.filter(category=p['category'])
        if p.get('status'):
            qs = qs.filter(status=p['status'])
        if p.get('fileType'):
            qs = filter_file_kind(qs, p['fileType'])
        return Response(DocumentSerializer(qs.order_by('-upload_date', '-id'), many=True).data)


class DocumentStatsView(APIView):
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request):
        qs = _base(request.user)
        total = qs.count()
        total_bytes = qs.aggregate(s=Sum('file_size'))['s'] or 0
        cat_counts = {}
        for row in qs.values('category'):
            c = row['category'] or 'Uncategorized'
            cat_counts[c] = cat_counts.get(c, 0) + 1
        return Response({
            'totalDocuments': total,
            'totalStorageBytes': int(total_bytes),
            'categoryCounts': cat_counts,
        })


class DocumentsByCaseView(APIView):
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request, case_id):
        qs = _base(request.user).filter(case_id=case_id).order_by('-upload_date')
        return Response(DocumentSerializer(qs, many=True).data)


class DocumentsByClientView(APIView):
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request, client_id):
        qs = _base(request.user).filter(client_id=client_id).order_by('-upload_date')
        return Response(DocumentSerializer(qs, many=True).data)


class UploadDocumentView(APIView):
    permission_classes = [RequirePermission('DOCUMENT_UPLOAD')]

    def post(self, request):
        f = request.FILES.get('file')
        if f is None:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)
        case_id = request.data.get('caseId') or None
        client_id = request.data.get('clientId') or None
        case = owned(Case.objects.filter(id=case_id, advocate_id__in=practice_ids(request.user)), request.user).first() if case_id else None
        client = owned(Client.objects.filter(id=client_id, advocate_id__in=practice_ids(request.user)), request.user).first() if client_id else None
        try:
            doc = create_document(
                request.user, f,
                document_name=request.data.get('documentName'),
                category=request.data.get('category'),
                description=request.data.get('description'),
                case=case, client=client,
            )
        except UnsupportedFileType as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(DocumentSerializer(doc).data, status=status.HTTP_201_CREATED)


class DocumentDetailView(APIView):
    """Handles GET/PUT/DELETE at /api/documents/{id} (no trailing slash)."""
    def get_permissions(self):
        m = self.request.method
        if m == 'DELETE':
            return [RequirePermission('DOCUMENT_DELETE')()]
        if m in ('PUT', 'PATCH'):
            return [RequirePermission('DOCUMENT_EDIT')()]
        return [RequirePermission('DOCUMENT_VIEW')()]

    def get(self, request, pk):
        doc = _base(request.user).filter(id=pk).first()
        if doc is None:
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response(DocumentSerializer(doc).data)

    def put(self, request, pk):
        doc = owned(Document.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)), request.user).first()
        if doc is None:
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)
        for attr, key in [('document_name', 'documentName'), ('category', 'category'),
                          ('description', 'description'), ('status', 'status')]:
            if key in request.data:
                setattr(doc, attr, request.data[key])
        doc.updated_at = datetime.datetime.now()
        doc.save()
        return Response(DocumentSerializer(doc).data)

    def delete(self, request, pk):
        doc = owned(Document.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)), request.user).first()
        if doc is None:
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)
        remove_document(doc)
        return Response(status=status.HTTP_204_NO_CONTENT)


def remove_document(doc):
    """Delete a document: its rows (summary, versions, and every side table keyed by its id: task
    attachments, the editor's state, desktop working copies / locks) in one transaction, then its files.
    Used by Delete and by the blank-document clean-up (documents/blank.py)."""
    from workspace.models import CaseTaskDocument
    from .dav import drop_work
    from .models import DesktopLock, DocumentEditState, DocumentVersionChanges
    pk = doc.id
    # Rows first, in one transaction; the files go only once that has
    # committed, so a failed delete never leaves a row without its file.
    # No DB foreign key to the summary/version tables, so clean up explicitly.
    files = [(doc.file_path, doc.stored_name)] + [
        (v.file_path, v.stored_name) for v in DocumentVersion.objects.filter(document_id=pk)]
    with transaction.atomic():
        doc.delete()
        DocumentSummary.objects.filter(document_id=pk).delete()
        DocumentVersion.objects.filter(document_id=pk).delete()
        CaseTaskDocument.objects.filter(document_id=pk).delete()
        DocumentEditState.objects.filter(document_id=pk).delete()
        DocumentVersionChanges.objects.filter(document_id=pk).delete()
        DesktopLock.objects.filter(kind='doc', obj_id=pk).delete()
        # remove_stored_file only ever deletes inside the documents folder.
        transaction.on_commit(lambda: [remove_stored_file(p, n) for p, n in files])
    drop_work('doc', pk)                               # a working copy in media storage, if any


def _summary_payload(row):
    """Shape a DocumentSummary row into the camelCase JSON the frontend expects."""
    key_points = None
    if row.key_points_json:
        try:
            key_points = json.loads(row.key_points_json)
        except ValueError:
            key_points = None
    return {
        'status': row.status,
        'summary': row.summary_text,
        'keyPoints': key_points,
        'modelUsed': row.model_used,
        'error': row.error,
        'updatedAt': row.updated_at,
    }


class DocumentSummaryView(APIView):
    """GET /api/documents/<id>/summary -> stored AI summary + key points.

    Returns {status: 'NONE'} when the document exists but has no summary row yet
    (e.g. a legacy upload), so the UI can offer to generate one."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request, pk):
        doc = _base(request.user).filter(id=pk).first()
        if doc is None:
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)
        row = DocumentSummary.objects.filter(document_id=pk).first()
        if row is None:
            return Response({'status': 'NONE'})
        return Response(_summary_payload(row))


class DocumentSummaryRegenerateView(APIView):
    """POST /api/documents/<id>/summary/regenerate -> (re)queue summarization."""
    permission_classes = [RequirePermission('DOCUMENT_EDIT')]

    def post(self, request, pk):
        doc = owned(Document.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)), request.user).first()
        if doc is None:
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)
        from .summarizer import enqueue_and_run
        row = enqueue_and_run(doc)
        if row is None:
            return Response({'status': 'DISABLED'}, status=status.HTTP_202_ACCEPTED)
        return Response({'status': row.status}, status=status.HTTP_202_ACCEPTED)


# ---- versioning ----------------------------------------------------------

class DocumentVersionsView(APIView):
    """GET  /api/documents/<id>/versions  -> version history (newest first).
    POST /api/documents/<id>/versions  -> upload a new version of this document."""

    def get_permissions(self):
        if self.request.method == 'POST':
            return [RequirePermission('DOCUMENT_UPLOAD')()]
        return [RequirePermission('DOCUMENT_VIEW')()]

    def get(self, request, pk):
        doc = _base(request.user).filter(id=pk).first()
        if doc is None:
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)
        rows = {v.version: v for v in DocumentVersion.objects.filter(document_id=pk)}
        cur = rows.get(doc.version)
        # Current version — note comes from its version row (if this doc has ever
        # been re-versioned); the original v1 upload has no note.
        out = [{
            'version': doc.version,
            'originalName': doc.original_name,
            'fileSize': doc.file_size,
            'fileType': doc.file_type,
            'note': cur.note if cur else None,
            'uploadedByName': _advocate_name(cur.uploaded_by_id if cur else doc.advocate_id),
            'createdAt': cur.created_at if cur else (doc.updated_at or doc.upload_date),
            'isCurrent': True,
        }]
        for v in rows.values():
            if v.version == doc.version:
                continue  # already emitted as the current entry above
            out.append({
                'version': v.version,
                'originalName': v.original_name,
                'fileSize': v.file_size,
                'fileType': v.file_type,
                'note': v.note,
                'uploadedByName': _advocate_name(v.uploaded_by_id),
                'createdAt': v.created_at,
                'isCurrent': False,
            })
        out.sort(key=lambda x: x['version'], reverse=True)
        return Response(out)

    def post(self, request, pk):
        doc = owned(Document.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)), request.user).first()
        if doc is None:
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)
        f = request.FILES.get('file')
        if f is None:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        note = (request.data.get('note') or '').strip() or None

        try:
            add_version(doc, f, request.user, note)
        except UnsupportedFileType as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(DocumentSerializer(doc).data, status=status.HTTP_201_CREATED)


def _advocate_name(advocate_id):
    if not advocate_id:
        return None
    a = Advocate.objects.filter(id=advocate_id).only('full_name').first()
    return a.full_name if a else None


# ---- download / preview: Authorization header, or a short-lived signed link ----
#
# A raw login token in a URL leaks into server/proxy logs, browser history and
# Referer headers, so ?token= is no longer accepted. Where the browser needs a
# plain URL (a new tab, an <iframe>), the app asks for a SIGNED LINK:
# POST /api/documents/<id>/link {purpose} -> a URL valid for DOCUMENT_LINK_SECONDS,
# bound to that document, that user, that purpose and the user's current
# session version (signing out kills unused links too). Every use re-checks the
# user, membership, firm and document permission exactly like a header request.

_LINK_SALT = 'ams.document-link'


def _link_value(advocate, pk, purpose):
    from core import tenant
    from core.session import token_version
    m = tenant.active_membership(advocate.id) if settings.TENANCY_COLUMNS else None
    return '|'.join(str(x) for x in (pk, purpose, advocate.id, token_version(advocate.id),
                                     m.id if m else '', str(m.firm.public_id) if m else ''))


def make_document_link(advocate, pk, purpose):
    from django.core import signing
    return signing.TimestampSigner(salt=_LINK_SALT).sign(_link_value(advocate, pk, purpose))


def _advocate_from_link(sig, pk, purpose):
    from django.core import signing
    try:
        value = signing.TimestampSigner(salt=_LINK_SALT).unsign(sig, max_age=settings.DOCUMENT_LINK_SECONDS)
    except signing.BadSignature:
        return None
    parts = value.split('|')
    if len(parts) != 6 or parts[0] != str(pk) or parts[1] != purpose:
        return None                       # another document or another purpose
    payload = {'advocateId': int(parts[2]), 'tv': int(parts[3])}
    if parts[4]:
        payload.update({'mid': int(parts[4]), 'fid': parts[5]})
    from core.auth import validate_claims
    try:
        advocate, _m, _f = validate_claims(payload)
    except AuthenticationFailed:
        return None
    return advocate


def _advocate_from_request(request, pk=None, purpose=None):
    header = request.META.get('HTTP_AUTHORIZATION', '')
    advocate = None
    if header.startswith('Bearer '):
        from core.auth import resolve_token
        try:
            advocate, _m, _f = resolve_token(header[7:].strip())
        except AuthenticationFailed:
            return None
    elif request.query_params.get('sig') and pk is not None:
        advocate = _advocate_from_link(request.query_params['sig'], pk, purpose)
    if advocate is None:
        return None
    # Client users download through /api/client/documents, never these firm endpoints.
    from clientaccess.gate import is_client
    if is_client(advocate):
        return None
    return advocate


def _readable_file(advocate, pk):
    """The document if `advocate` may download it: in their practice, and their own
    upload or they hold DOCUMENT_VIEW. These endpoints are AllowAny (token may be in
    the query string), so the permission is checked here rather than by DRF."""
    doc = owned(Document.objects.filter(id=pk, advocate_id__in=practice_ids(advocate)), advocate).first()
    if doc is None:
        return None
    if doc.advocate_id != advocate.id and 'DOCUMENT_VIEW' not in advocate.permission_codes():
        return None
    return doc


def _serve(request, pk, as_attachment):
    advocate = _advocate_from_request(request, pk, 'download' if as_attachment else 'preview')
    if advocate is None:
        return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
    doc = _readable_file(advocate, pk)
    if doc is None:
        raise Http404('Document not found')
    path = resolve_stored_file(doc.file_path, doc.stored_name)
    if path is None:
        return Response({'error': FILE_UNAVAILABLE}, status=status.HTTP_404_NOT_FOUND)
    if as_attachment:
        Document.objects.filter(id=pk).update(download_count=(doc.download_count or 0) + 1)
    from core.session import security_event
    security_event('DOCUMENT_DOWNLOAD' if as_attachment else 'DOCUMENT_PREVIEW', request, actor=advocate,
                   detail={'document': doc.id})
    resp = FileResponse(open(path, 'rb'),
                        content_type=doc.file_type or 'application/octet-stream')
    # Encoded by Django: a name with quotes or non-ASCII can't break the header.
    resp['Content-Disposition'] = content_disposition_header(as_attachment, doc.original_name or 'document')
    return resp


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def download_document(request, pk):
    return _serve(request, pk, as_attachment=True)


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def preview_document(request, pk):
    return _serve(request, pk, as_attachment=False)


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def download_document_version(request, pk, version):
    """Download a specific version's file (current version or an archived one)."""
    advocate = _advocate_from_request(request, pk, f'version:{version}')
    if advocate is None:
        return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
    doc = _readable_file(advocate, pk)
    if doc is None:
        raise Http404('Document not found')
    if version == (doc.version or 1):
        stored, name, ftype = (doc.file_path, doc.stored_name), doc.original_name, doc.file_type
    else:
        v = DocumentVersion.objects.filter(document_id=pk, version=version).first()
        if v is None:
            raise Http404('Version not found')
        stored, name, ftype = (v.file_path, v.stored_name), v.original_name, v.file_type
    path = resolve_stored_file(*stored)
    if path is None:
        return Response({'error': FILE_UNAVAILABLE}, status=status.HTTP_404_NOT_FOUND)
    from core.session import security_event
    security_event('DOCUMENT_DOWNLOAD', request, actor=advocate, detail={'document': doc.id, 'version': version})
    resp = FileResponse(open(path, 'rb'), content_type=ftype or 'application/octet-stream')
    resp['Content-Disposition'] = content_disposition_header(True, name or 'document')
    return resp


@api_view(['POST'])
def document_link(request, pk):
    """POST /api/documents/<id>/link {purpose: download | preview | version:<n>}
    -> a short-lived signed URL for a browser tab / iframe (no token in it)."""
    purpose = (request.data.get('purpose') or 'download').strip()
    if purpose not in ('download', 'preview') and not (purpose.startswith('version:') and purpose[8:].isdigit()):
        return Response({'error': 'Unknown purpose.'}, status=status.HTTP_400_BAD_REQUEST)
    if _readable_file(request.user, pk) is None:
        return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)
    from urllib.parse import quote
    base = {'download': f'/api/documents/download/{pk}', 'preview': f'/api/documents/preview/{pk}'}.get(
        purpose, f'/api/documents/{pk}/versions/{purpose[8:]}/download')
    sig = make_document_link(request.user, pk, purpose)
    return Response({'url': f'{base}?sig={quote(sig)}', 'expiresIn': settings.DOCUMENT_LINK_SECONDS})
