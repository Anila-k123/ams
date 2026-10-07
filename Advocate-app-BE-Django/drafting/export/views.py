"""GET /api/drafting/drafts/<id>/export/docx/[?branding=1][&output=pdf]: the draft as a real
.docx, or that same file as a PDF. Below it, the redline export (Word tracked changes)."""

import datetime
import logging
import re

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView

from core.permissions import RequirePermission


from .docx import render_session_docx, session_title

log = logging.getLogger(__name__)

DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'


def file_response(request, data, filename):
    """The .docx, or with ?output=pdf the same file converted by LibreOffice (export/pdf.py).
    503 when LibreOffice is missing, so the page can fall back to printing."""
    if request.query_params.get('output') == 'pdf':
        from rest_framework.response import Response

        from .pdf import PdfUnavailable, docx_to_pdf
        try:
            data = docx_to_pdf(data)
        except PdfUnavailable as exc:
            log.warning('PDF export unavailable: %s', exc)
            return Response({'error': 'PDF export is not available on this server.'}, status=503)
        resp = HttpResponse(data, content_type='application/pdf')
        filename = filename[:-len('.docx')] + '.pdf'
    else:
        resp = HttpResponse(data, content_type=DOCX_TYPE)
    resp['Content-Disposition'] = f'attachment; filename="{filename}"'
    return resp


def export_filename(session):
    stem = re.sub(r'[^\w.-]+', '_', session_title(session) or 'draft').strip('_')[:80] or 'draft'
    return f'{stem}_{datetime.date.today():%Y-%m-%d}.docx'


def branding_for(user):
    """The firm's letterhead, straight from AMS (drafting/branding.py)."""
    from drafting.branding import firm_branding
    return firm_branding(user)


class DraftDocxExportView(APIView):
    permission_classes = [RequirePermission('DRAFT_EXPORT')]

    def get(self, request, pk):
        # The author's drafts, and drafts submitted to this user for review.
        from drafting.access import viewable_sessions
        session = get_object_or_404(viewable_sessions(request.user).select_related('template'), pk=pk)
        branding = branding_for(request.user) if request.query_params.get('branding') == '1' else None
        return file_response(request, render_session_docx(session, branding), export_filename(session))


class DraftRedlineExportView(APIView):
    """GET drafts/<id>/export/redline/?from=<version id>&to=<version id|current>[&branding=1][&output=pdf]

    The draft as Word tracked changes between two saved versions (drafting.DraftVersion),
    or a version and the current draft. `from` defaults to the last version sent to
    AMS / for review, else the latest version; `to` defaults to the current draft."""
    permission_classes = [RequirePermission('DRAFT_EXPORT')]

    def get(self, request, pk):
        from drafting.access import viewable_sessions
        from drafting.models import DraftVersion
        from drafting.versions import snapshot_blocks
        from rest_framework.response import Response

        from .redline import render_redline_docx

        session = get_object_or_404(viewable_sessions(request.user).select_related('template'), pk=pk)
        versions = session.versions.all()

        def pick(param):
            value = request.query_params.get(param) or ''
            if not value.isdigit():
                return None
            return get_object_or_404(versions, pk=int(value))

        before = pick('from') or (versions.filter(kind=DraftVersion.Kind.SENT).order_by('-number').first()
                                  or versions.order_by('-number').first())
        if before is None:
            return Response({'error': 'Save a version of this draft first, to compare against.'}, status=400)
        after = pick('to')
        after_blocks = after.blocks if after else snapshot_blocks(session)
        after_name = f'v{after.number}' if after else 'current'

        branding = branding_for(request.user) if request.query_params.get('branding') == '1' else None
        data, stats = render_redline_docx(before.blocks, after_blocks, title=session_title(session),
                                          author=request.user.full_name or 'PactPro', branding=branding)
        stem = export_filename(session).rsplit('_', 1)[0]
        resp = file_response(request, data, f'{stem}_redline_v{before.number}-{after_name}_'
                                            f'{datetime.date.today():%Y-%m-%d}.docx')
        if resp.status_code != 200:
            return resp
        # For the page to say "12 words added, 4 removed" without opening the file.
        resp['X-Redline-Inserted'], resp['X-Redline-Deleted'] = stats['inserted'], stats['deleted']
        return resp
