"""Drafting files behind the AMS login (merge phase 04).

InstaDraft served uploaded files from /media with no permission check. Inside AMS
those files include client documents, and a direct upload keeps its original name,
so a URL could be guessed. Files are now served through the viewset that owns them:

    GET /api/drafting/<samples|templates>/<id>/file/?name=<file name>

That goes through the normal JWT authentication, the client gate, DRAFT_VIEW and the
viewset's own queryset scope (a sample outside your practice is a 404). `name` is only
there so the URL ends in the file's extension, which the viewers use to pick PDF or DOCX.
"""

import os
from urllib.parse import quote

from django.http import FileResponse, Http404
from django.urls import reverse
from rest_framework.decorators import action


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


class FileUrlSerializerMixin:
    """Replaces the model's /media URL for `file` with the authenticated one."""
    file_basename = None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if 'file' in data:
            data['file'] = file_url(self.context.get('request'), self.file_basename, instance)
        return data
