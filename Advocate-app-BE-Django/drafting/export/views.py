"""GET /api/drafting/drafts/<id>/export/docx/[?branding=1] — the draft as a real .docx."""

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
        resp = HttpResponse(render_session_docx(session, branding), content_type=DOCX_TYPE)
        resp['Content-Disposition'] = f'attachment; filename="{export_filename(session)}"'
        return resp
