"""AMS documents as drafting references, in-process (merge phase 04).

Replaces InstaDraft's /api/ams/documents/ proxy, which called AMS over HTTP. The
Documents page lists the practice's AMS documents (PDF/DOCX) and "prepares" one for
drafting by importing it once as a Sample: parsing and embedding need a Sample row.
An import is shared across the practice, like the AMS document itself, and is
redone when AMS has a newer version of that document.

Files are copied under random names: the drafting media folder is served without a
per-document permission check.
"""

import os
import uuid

from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Q
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Document
from core.permissions import RequirePermission
from core.practice import practice_ids

from .access import visible_samples
from .models import Sample
from .serializers import SampleSerializer

DRAFTABLE = Q(original_name__iendswith='.pdf') | Q(original_name__iendswith='.docx')
PAGE_SIZE = 50


def _practice_documents(user):
    return (Document.objects.select_related('case', 'client', 'advocate')
            .filter(advocate_id__in=practice_ids(user)).filter(DRAFTABLE))


def _display_name(doc):
    """Keep the file extension in the name: the Documents page picks its icon from it."""
    name = (doc.document_name or doc.original_name or f'Document {doc.id}').strip()
    ext = os.path.splitext(doc.original_name or '')[1].lower()
    return name if name.lower().endswith(ext) else f'{name}{ext}'


def _row(doc, sample):
    return {
        'id': doc.id,
        'documentName': doc.document_name,
        'originalName': doc.original_name,
        'version': doc.version or 1,
        'category': doc.category,
        'caseNumber': doc.case.case_number if doc.case_id else None,
        'clientName': doc.client.name if doc.client_id else None,
        'uploadedByName': doc.advocate.full_name if doc.advocate_id else None,
        'uploadDate': doc.upload_date.isoformat() if doc.upload_date else None,
        'sample': ({'id': sample.id, 'status': sample.status,
                    'current': sample.ams_version == (doc.version or 1)} if sample else None),
    }


class AmsDocumentsView(APIView):
    """GET /api/drafting/ams-documents/?search=&page=  (page is 0-based, AMS style)."""
    permission_classes = [RequirePermission('DRAFT_VIEW')]

    def get(self, request):
        qs = _practice_documents(request.user)
        search = (request.query_params.get('search') or '').strip()
        if search:
            qs = qs.filter(Q(document_name__icontains=search) | Q(original_name__icontains=search)
                           | Q(case__case_number__icontains=search) | Q(client__name__icontains=search))
        try:
            page = max(int(request.query_params.get('page', 0)), 0)
        except ValueError:
            page = 0
        total = qs.count()
        docs = list(qs.order_by('-upload_date', '-id')[page * PAGE_SIZE:(page + 1) * PAGE_SIZE])
        samples = {s.ams_document_id: s for s in visible_samples(request.user)
                   .filter(ams_document_id__in=[d.id for d in docs]).order_by('id')}
        return Response({'content': [_row(d, samples.get(d.id)) for d in docs],
                         'totalElements': total, 'totalPages': (total + PAGE_SIZE - 1) // PAGE_SIZE})


class AmsDocumentImportView(APIView):
    """POST /api/drafting/ams-documents/<id>/import/ -> the Sample for that document,
    imported (and processing) if needed."""
    permission_classes = [RequirePermission('DRAFT_CREATE')]

    def post(self, request, pk):
        doc = _practice_documents(request.user).filter(id=pk).first()
        if doc is None:
            return Response({'detail': 'Document not found.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            sample = import_document(request.user, doc)
        except FileNotFoundError:
            return Response({'detail': 'The file for this document is missing.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(SampleSerializer(sample, context={'request': request}).data)


def import_document(user, doc):
    version = doc.version or 1
    existing = visible_samples(user).filter(ams_document_id=doc.id).order_by('id').first()
    # Reuse a good or in-flight import. A failed one, or one still "pending" (its job
    # never started, e.g. the processing stack was missing), is imported again.
    if (existing and existing.ams_version == version
            and existing.status in (Sample.Status.READY, Sample.Status.PROCESSING)):
        return existing
    if not doc.file_path or not os.path.exists(doc.file_path):
        raise FileNotFoundError(doc.file_path)
    with open(doc.file_path, 'rb') as fh:
        data = fh.read()
    from .tasks import process_sample
    from .views import _dispatch
    ext = os.path.splitext(doc.original_name or '')[1].lower() or '.pdf'
    with transaction.atomic():
        sample = existing or Sample(uploaded_by_id=user.id, ams_document_id=doc.id)
        sample.name = _display_name(doc)
        sample.ams_version = version
        sample.status = Sample.Status.PENDING
        # No contract_type: client documents must not feed the shared clause library.
        old_file = sample.file.name if sample.file else None
        sample.file.save(f'ams/{uuid.uuid4().hex}{ext}', ContentFile(data), save=False)
        sample.save()
    if old_file:
        sample.file.storage.delete(old_file)
    _dispatch(process_sample, sample.id)
    return sample
