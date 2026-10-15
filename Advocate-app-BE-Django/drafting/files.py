"""Drafting files behind the AMS login (merge phase 04).

InstaDraft served uploaded files from /media with no permission check. Inside AMS
those files include client documents, and a direct upload keeps its original name,
so a URL could be guessed. Files are now served through the viewset that owns them:

    GET /api/drafting/<samples|templates>/<id>/file/?name=<file name>
    GET /api/drafting/<samples|templates>/<id>/preview/     the file as a PDF, to view it as it prints

That goes through the normal JWT authentication, the client gate, DRAFT_VIEW and the
viewset's own queryset scope (a sample outside your practice is a 404). `name` is only
there so the URL ends in the file's extension, which the viewers use to pick PDF or DOCX.
"""

import os
from urllib.parse import quote

from django.http import FileResponse, Http404
from django.urls import reverse
from rest_framework.decorators import action


def preview_url(request, basename, obj):
    """The authenticated URL of the file's print view (FileDownloadMixin.preview), or None."""
    if not obj.file:
        return None
    path = reverse(f'{basename}-preview', kwargs={'pk': obj.pk}) + '?name=preview.pdf'
    return request.build_absolute_uri(path) if request else path


def file_url(request, basename, obj):
    """The authenticated URL for obj.file, or None when there is no file."""
    if not obj.file:
        return None
    path = reverse(f'{basename}-file', kwargs={'pk': obj.pk})
    path += '?name=' + quote(os.path.basename(obj.file.name))
    return request.build_absolute_uri(path) if request else path


class FileDownloadMixin:
    @action(detail=True, methods=['get'], url_path='file', url_name='file')
    def file(self, request, pk=None):
        obj = self.get_object()
        if not obj.file or not obj.file.storage.exists(obj.file.name):
            raise Http404('No file.')
        return FileResponse(obj.file.open('rb'), as_attachment=False,
                            filename=os.path.basename(obj.file.name))

    @action(detail=True, methods=['get'], url_path='preview', url_name='preview')
    def preview(self, request, pk=None):
        """The file as it prints: a PDF is sent as it is; a Word file is turned into a PDF once by
        LibreOffice (drafting/export/pdf.py) and kept next to the uploads, made again only when the
        file changes. So View shows the letterhead, logo, fonts and layout, not just the text.
        503 when LibreOffice isn't available (the viewer then falls back to a text view)."""
        from django.conf import settings
        from django.http import JsonResponse
        from .export.pdf import PdfUnavailable, docx_to_pdf
        obj = self.get_object()
        if not obj.file or not obj.file.storage.exists(obj.file.name):
            raise Http404('No file.')
        name = obj.file.name.lower()
        if name.endswith('.pdf'):
            return FileResponse(obj.file.open('rb'), as_attachment=False, content_type='application/pdf',
                                filename=os.path.basename(obj.file.name))
        if not name.endswith('.docx'):
            raise Http404('No print view for this file type.')
        stamp = int(os.path.getmtime(obj.file.path))
        folder = os.path.join(settings.MEDIA_ROOT, 'previews', type(obj).__name__.lower())
        target = os.path.join(folder, f'{obj.pk}-{stamp}.pdf')
        if not os.path.exists(target):
            try:
                with obj.file.open('rb') as f:
                    pdf = docx_to_pdf(f.read())
            except PdfUnavailable as exc:
                return JsonResponse({'error': str(exc)}, status=503)
            os.makedirs(folder, exist_ok=True)
            for old in os.listdir(folder):                        # an older print view of this file
                if old.startswith(f'{obj.pk}-') and old.endswith('.pdf'):
                    try:
                        os.remove(os.path.join(folder, old))
                    except OSError:
                        pass
            with open(target, 'wb') as f:
                f.write(pdf)
        base = os.path.splitext(os.path.basename(obj.file.name))[0]
        return FileResponse(open(target, 'rb'), as_attachment=False, content_type='application/pdf',
                            filename=f'{base}.pdf')


class FileUrlSerializerMixin:
    """Replaces the model's /media URL for `file` with the authenticated one."""
    file_basename = None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if 'file' in data:
            data['file'] = file_url(self.context.get('request'), self.file_basename, instance)
            data['preview'] = preview_url(self.context.get('request'), self.file_basename, instance)
        return data
