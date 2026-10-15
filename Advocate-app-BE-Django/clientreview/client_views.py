"""Client portal side of client review (docs/CLIENT_REVIEW.md), under /api/client/ (the portal gate allows only
that). A client sees only reviews of their own client record that the firm hasn't cancelled."""

from django.conf import settings
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework.response import Response

from clientaccess.views import _ClientView, _audit

from . import service
from .models import ClientReview, ClientReviewFile, ClientReviewRound


def _doc(review):
    from core.models import Document
    return Document.objects.filter(id=review.document_id).first()


def _summary(review, doc):
    current = review.current_round()
    return {'id': review.id, 'name': service._doc_name(doc) if doc else 'Document', 'status': review.status,
            'replyBy': review.reply_by.isoformat() if review.reply_by else None,
            'sentAt': current.sent_at.isoformat() if current else None,
            'round': current.number if current else None,
            'waiting': bool(current and current.status == ClientReviewRound.SENT and review.status == ClientReview.OPEN)}


class _ReviewView(_ClientView):
    def reviews(self):
        return ClientReview.objects.filter(client_id=self.client_id).exclude(status=ClientReview.CANCELLED)

    def review(self, rid):
        review = get_object_or_404(self.reviews(), id=rid)
        doc = _doc(review)
        if doc is None:
            from django.http import Http404
            raise Http404
        return review, doc


class ClientReviewsView(_ReviewView):
    """GET client/reviews: the documents sent to this client for review, waiting ones first."""

    def get(self, request):
        rows = [(r, _doc(r)) for r in self.reviews()]
        items = [_summary(r, d) for r, d in rows if d is not None]
        items.sort(key=lambda i: (not i['waiting'], i['sentAt'] or ''), reverse=False)
        return Response({'items': items})


class ClientReviewView(_ReviewView):
    """GET client/reviews/<rid>: the review: the firm's message and questions, rounds, thread."""

    def get(self, request, rid):
        review, doc = self.review(rid)
        data = service.review_json(review, for_client=True)
        data.update(_summary(review, doc))
        current = review.current_round()
        # Editing in the portal (CLIENT_REVIEW_EDITOR, off for now): otherwise download, edit, upload back.
        editor_on = bool(settings.CLIENT_REVIEW_EDITOR and settings.ONLYOFFICE_URL and settings.ONLYOFFICE_JWT_SECRET
                         and settings.AMS_INTERNAL_URL)
        data['canEdit'] = bool(editor_on and current and current.editable and data['waiting'])
        data['editorAvailable'] = editor_on
        return Response(data)


class ClientReviewEditorView(_ReviewView):
    """GET client/reviews/<rid>/editor: the editor config for the current copy (review mode while waiting)."""

    def get(self, request, rid):
        review, doc = self.review(rid)
        current = review.current_round()
        if current is None or not (settings.CLIENT_REVIEW_EDITOR and settings.ONLYOFFICE_URL
                                   and settings.ONLYOFFICE_JWT_SECRET):
            return Response({'enabled': False})
        name = getattr(request.user, 'full_name', None) or getattr(self.client(), 'name', None) or 'Client'
        return Response({'enabled': True, 'url': settings.ONLYOFFICE_URL,
                         'config': service.editor_config(current, request.user, name)})


class ClientReviewCopyView(_ReviewView):
    """GET client/reviews/<rid>/file: download the current copy (to edit in Word and upload back)."""

    def get(self, request, rid):
        review, doc = self.review(rid)
        current = review.current_round()
        if current is None:
            return Response({'error': 'Nothing to download.'}, status=404)
        current = service.save_copy_now(current)
        _audit(request, self.client(), 'DOWNLOAD', f'Downloaded review copy of {current.file_name}', 'Document', doc.id)
        return FileResponse(current.file.open('rb'), as_attachment=True, filename=current.file_name)


class ClientReviewAttachmentView(_ReviewView):
    """GET client/reviews/files/<fid>: a file in the thread of one of this client's reviews."""

    def get(self, request, fid):
        row = get_object_or_404(ClientReviewFile.objects.select_related('message'), id=fid)
        self.review(row.message.review_id)
        return FileResponse(row.file.open('rb'), as_attachment=True, filename=row.name)


class ClientReviewReplyView(_ReviewView):
    """POST client/reviews/<rid>/reply (multipart: action = changes | approve | message, note, files[])."""

    def post(self, request, rid):
        review, doc = self.review(rid)
        action = request.data.get('action')
        if (action == 'changes' and not settings.CLIENT_REVIEW_EDITOR and not request.FILES.getlist('files')
                and not (request.data.get('note') or '').strip()):
            # Without the portal editor the changes come as a file or a note: nothing else reaches the firm.
            return Response({'error': 'Upload your edited document, or write what should change.'}, status=400)
        try:
            service.client_reply(review, doc, request.user, action, request.data.get('note', ''),
                                 request.FILES.getlist('files'))
        except service.ReviewError as exc:
            return Response({'error': str(exc)}, status=exc.status)
        verb = {'changes': 'REVIEW_CHANGES', 'approve': 'REVIEW_APPROVED'}.get(action, 'REVIEW_MESSAGE')
        _audit(request, self.client(), verb, f'{verb.replace("_", " ").title()}: {service._doc_name(doc)}',
               'Document', doc.id)
        review.refresh_from_db()
        data = service.review_json(review, for_client=True)
        data.update(_summary(review, doc))
        return Response(data)
