"""Check that this server can make PDFs (Download -> PDF, View print preview): LibreOffice is found and
really converts a Word file. Run after installing / updating a server (docs/DEPLOYMENT.md); exits
non-zero when PDF export would fail, so a setup script can stop on it.

    manage.py check_pdf_export
"""

import io
import time

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Check that LibreOffice is installed and converts Word to PDF (draft PDF export, View).'

    def handle(self, *args, **opts):
        from docx import Document
        from drafting.export.pdf import PdfUnavailable, docx_to_pdf, soffice_path

        exe = soffice_path()
        if not exe:
            raise CommandError(
                'LibreOffice not found. Install it (tools\\install-libreoffice.ps1 on Windows, '
                'tools/install-libreoffice.sh on Linux) or set LIBREOFFICE_PATH in .env to soffice.')
        self.stdout.write(f'LibreOffice: {exe}')
        doc = Document()
        doc.add_paragraph('PDF export check. Times New Roman, Arial and Indian scripts: '
                          'சென்னை हिन्दी')
        buf = io.BytesIO()
        doc.save(buf)
        started = time.monotonic()
        try:
            pdf = docx_to_pdf(buf.getvalue())
        except PdfUnavailable as exc:
            raise CommandError(f'LibreOffice is installed but could not convert: {exc}')
        if not pdf.startswith(b'%PDF'):
            raise CommandError('LibreOffice returned something that is not a PDF.')
        self.stdout.write(self.style.SUCCESS(
            f'PDF export works ({time.monotonic() - started:.1f} s for a test page; the first one after a '
            f'restart is the slowest).'))
