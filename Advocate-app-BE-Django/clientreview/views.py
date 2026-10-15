"""Firm side of client review (docs/CLIENT_REVIEW.md). Same access as the document: practice scope (via
documents.editor._document), DOCUMENT_VIEW to see the reviews. To send / reply / cancel: DOCUMENT_EDIT, or being the
person an open task is assigned to, for that task's document (documents.editor._task_worker)."""

import datetime

from django.http import FileResponse, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import RequirePermission

from . import service
from .models import ClientReview, ClientReviewFile, ClientReviewRound


def _doc(request, pk):
    from documents.editor import _document
    return _document(request.user, pk)


def _review(request, rid):
    review = get_object_or_404(ClientReview, id=rid)
    return review, _doc(request, review.document_id)          # 404 / 403 unless the document is theirs


def _can_send(request, doc):
    from documents.editor import _task_worker
    return 'DOCUMENT_EDIT' in request.user.permission_codes() or _task_worker(request.user, doc)


def _error(exc):
    return Response({'error': str(exc)}, status=exc.status)


class DocumentReviewsView(APIView):
    """GET documents/<id>/client-reviews: every review of this document (newest first), with rounds and thread.
    POST {message, questions[], replyBy}: send the document to its client for review (round 1)."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request, pk):
        doc = _doc(request, pk)
        client = service.client_of(doc)
        return Response({
            'reviews': [service.review_json(r) for r in ClientReview.objects.filter(document_id=doc.id)],
            'client': {'id': client.id, 'name': client.name, 'hasLogin': bool(service.client_logins(client.id))}
            if client else None,
            'canSend': bool(_can_send(request, doc)),
        })

    def post(self, request, pk):
        doc = _doc(request, pk)
        if not _can_send(request, doc):
            return Response({'error': 'You may not send documents to clients.'}, status=403)
        reply_by = request.data.get('replyBy') or None
        if reply_by:
            try:
                reply_by = datetime.date.fromisoformat(reply_by)
            except ValueError:
                return Response({'error': 'replyBy must be a date (YYYY-MM-DD).'}, status=400)
            if reply_by < datetime.date.today():
                return Response({'error': 'The reply-by date can\'t be in the past.'}, status=400)
        try:
            review = service.start_review(doc, request.user, request.data.get('message', ''),
                                          request.data.get('questions') or [], reply_by)
        except service.ReviewError as exc:
            return _error(exc)
        return Response(service.review_json(review), status=201)


class ReviewMessagesView(APIView):
    """POST client-reviews/<rid>/messages (multipart: text, files[]): the firm writes to the client."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def post(self, request, rid):
        review, doc = _review(request, rid)
        if not _can_send(request, doc):
            return Response({'error': 'You may not write to clients.'}, status=403)
        try:
            service.firm_message(review, doc, request.user, request.data.get('text', ''), request.FILES.getlist('files'))
        except service.ReviewError as exc:
            return _error(exc)
        return Response(service.review_json(review))


class ReviewRoundsView(APIView):
    """POST client-reviews/<rid>/rounds {message}: send the document's current version as the next round."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def post(self, request, rid):
        review, doc = _review(request, rid)
        if not _can_send(request, doc):
            return Response({'error': 'You may not send documents to clients.'}, status=403)
        try:
            service.send_revised(review, doc, request.user, request.data.get('message', ''))
        except service.ReviewError as exc:
            return _error(exc)
        return Response(service.review_json(review))


class ReviewCancelView(APIView):
    """POST client-reviews/<rid>/cancel: the client no longer sees it."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def post(self, request, rid):
        review, doc = _review(request, rid)
        if not _can_send(request, doc):
            return Response({'error': 'You may not change client reviews.'}, status=403)
        try:
            service.cancel(review, request.user)
        except service.ReviewError as exc:
            return _error(exc)
        return Response(service.review_json(review))


def _download(field, name):
    resp = FileResponse(field.open('rb'), as_attachment=True, filename=name)
    return resp


class RoundFileView(APIView):
    """GET client-reviews/<rid>/rounds/<n>/file: the client's copy of that round (with their tracked changes)."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request, rid, number):
        review, _ = _review(request, rid)
        rnd = get_object_or_404(ClientReviewRound, review=review, number=number)
        return _download(rnd.file, rnd.file_name)


class ReviewFileView(APIView):
    """GET client-review-files/<fid>: a file attached to the thread."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request, fid):
        row = get_object_or_404(ClientReviewFile.objects.select_related('message__review'), id=fid)
        _review(request, row.message.review_id)
        return _download(row.file, row.name)


# --- the client's copy for the document server (signed links, no login) --------------------------------------

class _Public(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]


class CopyFileView(_Public):
    """GET editor/clientcopy/file/<round>?t=: the client's copy, for the document server."""

    def get(self, request, round_id):
        if not service.link_ok(request.query_params.get('t'), round_id):
            return HttpResponse(status=404)
        rnd = ClientReviewRound.objects.filter(id=round_id).first()
        if rnd is None:
            return HttpResponse(status=404)
        with rnd.file.open('rb') as f:
            resp = HttpResponse(f.read(), content_type='application/octet-stream')
        resp['Content-Disposition'] = 'attachment; filename="copy"'
        return resp


class CopyCallbackView(_Public):
    """POST editor/clientcopy/callback/<round>?t=: the document server saving the client's copy."""

    def post(self, request, round_id):
        import requests

        from documents.editor import _callback_payload
        if not service.link_ok(request.query_params.get('t'), round_id):
            return HttpResponse(status=404)
        data = _callback_payload(request)
        if data is None:
            return JsonResponse({'error': 1, 'message': 'invalid token'}, status=403)
        rnd = ClientReviewRound.objects.filter(id=round_id).first()
        if rnd is None:
            return JsonResponse({'error': 1}, status=404)
        if data.get('key') and data['key'] != rnd.key:
            return JsonResponse({'error': 0})
        status = data.get('status')
        if status == 1:
            ClientReviewRound.objects.filter(pk=rnd.pk).update(editing=True)
        elif status in (2, 6):
            try:
                res = requests.get(data['url'], timeout=60)
                res.raise_for_status()
            except (requests.RequestException, KeyError):
                return JsonResponse({'error': 1})
            service.store_copy(rnd, res.content, rotate_key=status == 2)
        elif status == 4:
            ClientReviewRound.objects.filter(pk=rnd.pk).update(editing=False)
        return JsonResponse({'error': 0})
