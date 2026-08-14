import os
import uuid
import datetime
import mimetypes

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

SORT_MAP = {'uploadDate': 'upload_date', 'documentName': 'document_name',
            'fileSize': 'file_size', 'id': 'id'}


def _base(request_user_id):
    return Document.objects.select_related('case', 'client').filter(advocate_id=request_user_id)


class DocumentListView(APIView):
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request):
        p = request.query_params
        qs = _base(request.user.id)
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
        qs = _base(request.user.id)
        if kw:
            qs = qs.filter(Q(document_name__icontains=kw) | Q(original_name__icontains=kw) |
                           Q(category__icontains=kw) | Q(description__icontains=kw))
        qs = qs.order_by('-upload_date', '-id')
        return Response(DocumentSerializer(qs, many=True).data)


class DocumentFilterView(APIView):
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request):
        p = request.query_params
        qs = _base(request.user.id)
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
        qs = _base(request.user.id)
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
        qs = _base(request.user.id).filter(case_id=case_id).order_by('-upload_date')
        return Response(DocumentSerializer(qs, many=True).data)


class DocumentsByClientView(APIView):
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request, client_id):
        qs = _base(request.user.id).filter(client_id=client_id).order_by('-upload_date')
        return Response(DocumentSerializer(qs, many=True).data)


class UploadDocumentView(APIView):
    permission_classes = [RequirePermission('DOCUMENT_UPLOAD')]

    def post(self, request):
        f = request.FILES.get('file')
        if f is None:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)
        original_name = f.name
        ext = os.path.splitext(original_name)[1]
        stored_name = f"{uuid.uuid4()}{ext}"
        docs_dir = os.path.join(settings.DOCUMENT_UPLOAD_DIR, 'documents')
        os.makedirs(docs_dir, exist_ok=True)
        abs_path = os.path.join(docs_dir, stored_name)
        with open(abs_path, 'wb') as out:
            for chunk in f.chunks():
                out.write(chunk)

        case_id = request.data.get('caseId') or None
        client_id = request.data.get('clientId') or None
        case = Case.objects.filter(id=case_id, advocate_id=request.user.id).first() if case_id else None
        client = Client.objects.filter(id=client_id, advocate_id=request.user.id).first() if client_id else None
        file_type = f.content_type or mimetypes.guess_type(original_name)[0] or 'application/octet-stream'
        now = datetime.datetime.now()
        doc = Document.objects.create(
            document_name=request.data.get('documentName') or original_name,
            original_name=original_name,
            stored_name=stored_name,
            file_path=abs_path,
            file_size=f.size,
            file_type=file_type,
            category=request.data.get('category') or None,
            description=request.data.get('description') or None,
            version=1,
            download_count=0,
            status='ACTIVE',
            upload_date=now,
            updated_at=now,
            advocate_id=request.user.id,
            case=case,
            client=client,
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
        doc = _base(request.user.id).filter(id=pk).first()
        if doc is None:
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response(DocumentSerializer(doc).data)

    def put(self, request, pk):
        doc = Document.objects.filter(id=pk, advocate_id=request.user.id).first()
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
        doc = Document.objects.filter(id=pk, advocate_id=request.user.id).first()
        if doc is None:
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)
        try:
            if doc.file_path and os.path.exists(doc.file_path):
                os.remove(doc.file_path)
        except OSError:
            pass
        doc.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


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
    return Advocate.objects.filter(id=aid).first()


def _serve(request, pk, as_attachment):
    advocate = _advocate_from_request(request)
    if advocate is None:
        return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
    doc = Document.objects.filter(id=pk, advocate_id=advocate.id).first()
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
