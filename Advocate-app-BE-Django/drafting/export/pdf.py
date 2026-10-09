"""PDF of a draft: the Word export converted by LibreOffice (headless).

Converting the .docx, rather than laying the PDF out a second time, keeps one
layout for both formats: the PDF is exactly the Word file, letterhead included. A
redline .docx converts with its tracked changes shown (insertions underlined,
deletions struck through, in colour).

LibreOffice is found from settings.LIBREOFFICE_PATH, else `soffice` on PATH, else
the usual install folders. Without it, PdfUnavailable is raised and the API answers
503 (the editor then falls back to the browser's print dialog).
"""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from django.conf import settings

TIMEOUT = 120   # seconds; a long draft converts in a few

_CANDIDATES = (
    r'C:\Program Files\LibreOffice\program\soffice.exe',
    r'C:\Program Files (x86)\LibreOffice\program\soffice.exe',
    '/usr/bin/soffice', '/usr/lib/libreoffice/program/soffice', '/opt/libreoffice/program/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
)


class PdfUnavailable(Exception):
    """LibreOffice is not installed or failed to convert."""


def soffice_path():
    configured = getattr(settings, 'LIBREOFFICE_PATH', '')
    if configured:
        return configured if os.path.isfile(configured) else None
    return shutil.which('soffice') or next((p for p in _CANDIDATES if os.path.isfile(p)), None)


def docx_to_pdf(data):
    exe = soffice_path()
    if not exe:
        raise PdfUnavailable('LibreOffice is not installed on the server.')
    with tempfile.TemporaryDirectory(prefix='draft-pdf-') as tmp:
        src = Path(tmp) / 'draft.docx'
        src.write_bytes(data)
        # A profile of its own per call: two conversions at once (or a LibreOffice the
        # user has open) would otherwise share one profile and the second would fail.
        profile = (Path(tmp) / 'profile').as_uri()
        try:
            subprocess.run(
                [exe, f'-env:UserInstallation={profile}', '--headless', '--norestore', '--nologo',
                 '--convert-to', 'pdf', '--outdir', tmp, str(src)],
                capture_output=True, timeout=TIMEOUT, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise PdfUnavailable(f'LibreOffice could not convert the draft: {exc}') from exc
        out = Path(tmp) / 'draft.pdf'
        if not out.is_file():
            raise PdfUnavailable('LibreOffice could not convert the draft.')
        return out.read_bytes()
