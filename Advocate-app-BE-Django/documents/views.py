import os
import json
import logging
import datetime

import jwt
from django.conf import settings
from django.db.models import Q, Sum
from django.http import FileResponse, Http404
from rest_framework.views import APIView
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

from core.models import Document, Case, Client, Advocate
from core.jwt import decode_token
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import DocumentSerializer
from .models import DocumentSummary, DocumentVersion
from .storage import add_version, create_document
from core.practice import practice_ids

log = logging.getLogger(__name__)

SORT_MAP = {'uploadDate': 'upload_date', 'documentName': 'document_name',
            'fileSize': 'file_size', 'id': 'id'}


def _base(user):
    """Documents this user may read: everything in their practice. Documents belong
    to the matter, not the uploader, the same as cases/tasks; the views gate on
    DOCUMENT_VIEW."""
    return Document.objects.select_related('case', 'client').filter(advocate_id__in=practice_ids(user))


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
            qs = qs.filter(file_type__startswith=p['fileType'])
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
            qs = qs.filter(file_type__startswith=p['fileType'])
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
        case = Case.objects.filter(id=case_id, advocate_id__in=practice_ids(request.user)).first() if case_id else None
        client = Client.objects.filter(id=client_id, advocate_id__in=practice_ids(request.user)).first() if client_id else None
        doc = create_document(
            request.user, f,
            document_name=request.data.get('documentName'),
            category=request.data.get('category'),
            description=request.data.get('description'),
            case=case, client=client,
        )
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
        doc = Document.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
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
        doc = Document.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if doc is None:
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)
        try:
            if doc.file_path and os.path.exists(doc.file_path):
                os.remove(doc.file_path)
        except OSError:
            pass
        doc.delete()
        # No DB foreign key to the summary/version tables, so clean up explicitly,
        # including the archived version files on disk.
        DocumentSummary.objects.filter(document_id=pk).delete()
        for v in DocumentVersion.objects.filter(document_id=pk):
            try:
                if v.file_path and os.path.exists(v.file_path):
                    os.remove(v.file_path)
            except OSError:
                pass
        DocumentVersion.objects.filter(document_id=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


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
        doc = Document.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
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
        doc = Document.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if doc is None:
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)
        f = request.FILES.get('file')
        if f is None:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        note = (request.data.get('note') or '').strip() or None

        add_version(doc, f, request.user, note)
        return Response(DocumentSerializer(doc).data, status=status.HTTP_201_CREATED)


def _advocate_name(advocate_id):
    if not advocate_id:
        return None
    a = Advocate.objects.filter(id=advocate_id).only('full_name').first()
    return a.full_name if a else None


# ---- download / preview: authenticate via Authorization header OR ?token= ----

def _advocate_from_request(request):
    token = None
    header = request.META.get('HTTP_AUTHORIZATION', '')
    if header.startswith('Bearer '):
        token = header[7:].strip()
    if not token:
        token = request.query_params.get('token')
    if not token:
        return None
    try:
        payload = decode_token(token)
    except jwt.PyJWTError:
        return None
    aid = payload.get('advocateId')
    advocate = Advocate.objects.filter(id=aid).first()
    # Same gate as AdvocateJWTAuthentication: someone who has left the practice
    # must not keep downloading its documents with an old ?token= link.
    if advocate is not None and getattr(advocate, 'left_on', None) is not None:
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
    doc = Document.objects.filter(id=pk, advocate_id__in=practice_ids(advocate)).first()
    if doc is None:
        return None
    if doc.advocate_id != advocate.id and 'DOCUMENT_VIEW' not in advocate.permission_codes():
        return None
    return doc


def _serve(request, pk, as_attachment):
    advocate = _advocate_from_request(request)
    if advocate is None:
        return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
    doc = _readable_file(advocate, pk)
    if doc is None or not doc.file_path or not os.path.exists(doc.file_path):
        raise Http404('Document file not found')
    if as_attachment:
        Document.objects.filter(id=pk).update(download_count=(doc.download_count or 0) + 1)
    resp = FileResponse(open(doc.file_path, 'rb'),
                        content_type=doc.file_type or 'application/octet-stream')
    disposition = 'attachment' if as_attachment else 'inline'
    resp['Content-Disposition'] = f'{disposition}; filename="{doc.original_name}"'
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
    advocate = _advocate_from_request(request)
    if advocate is None:
        return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
    doc = _readable_file(advocate, pk)
    if doc is None:
        raise Http404('Document not found')
    if version == (doc.version or 1):
        path, name, ftype = doc.file_path, doc.original_name, doc.file_type
    else:
        v = DocumentVersion.objects.filter(document_id=pk, version=version).first()
        if v is None:
            raise Http404('Version not found')
        path, name, ftype = v.file_path, v.original_name, v.file_type
    if not path or not os.path.exists(path):
        raise Http404('Version file not found')
    resp = FileResponse(open(path, 'rb'), content_type=ftype or 'application/octet-stream')
    resp['Content-Disposition'] = f'attachment; filename="{name}"'
    return resp
