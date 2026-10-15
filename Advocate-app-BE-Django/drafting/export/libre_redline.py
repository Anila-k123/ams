"""Redline in the draft's own look: LibreOffice's "Compare Document" on two versions of the Word file.

compare_docx(older, newer, author) -> (bytes, {'inserted': words, 'deleted': words})

The newer file comes back unchanged in look (letterhead, fonts, numbering, tables, stamp boxes) with every
difference from the older one as a tracked change by `author`, so the other side can accept or reject each
in Word. The comparison runs in LibreOffice's own Python (lo_compare.py), which talks to a hidden LibreOffice
with a profile of its own per call. Raises RedlineUnavailable when LibreOffice (or its Python) is missing or
the comparison fails; the caller then falls back to the standard-layout redline (export/redline.py).
"""

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from django.conf import settings

from .pdf import soffice_path

TIMEOUT = 150   # seconds; LibreOffice starts (a few s) and compares (a long draft: seconds)


class RedlineUnavailable(Exception):
    """LibreOffice could not compare the two files."""


def lo_python():
    """LibreOffice's own Python (it can `import uno`): beside soffice on Windows / macOS; on Linux the
    system python3 with python3-uno. settings.LIBREOFFICE_PYTHON overrides."""
    configured = getattr(settings, 'LIBREOFFICE_PYTHON', '')
    if configured:
        return configured if os.path.isfile(configured) else None
    exe = soffice_path()
    if exe:
        for name in ('python.exe', 'python', 'python3'):
            candidate = Path(exe).parent / name
            if candidate.is_file():
                return str(candidate)
    return shutil.which('python3')


def compare_docx(older, newer, author='PactPro'):
    soffice, python = soffice_path(), lo_python()
    if not soffice or not python:
        raise RedlineUnavailable('LibreOffice is not installed on the server.')
    script = Path(__file__).with_name('lo_compare.py')
    with tempfile.TemporaryDirectory(prefix='draft-compare-') as tmp:
        old_path, new_path, out_path = Path(tmp) / 'older.docx', Path(tmp) / 'newer.docx', Path(tmp) / 'redline.docx'
        old_path.write_bytes(older)
        new_path.write_bytes(newer)
        profile = (Path(tmp) / 'profile').as_uri()
        try:
            run = subprocess.run([python, str(script), soffice, profile, str(old_path), str(new_path), str(out_path),
                                  author or 'PactPro'], capture_output=True, timeout=TIMEOUT, check=False, text=True)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RedlineUnavailable(f'LibreOffice could not compare the versions: {exc}') from exc
        if run.returncode != 0 or not out_path.is_file():
            raise RedlineUnavailable(f'LibreOffice could not compare the versions: {(run.stderr or run.stdout)[-500:]}')
        try:
            stats = json.loads((run.stdout or '').strip().splitlines()[-1])
        except (ValueError, IndexError):
            stats = {'inserted': 0, 'deleted': 0}
        return out_path.read_bytes(), stats
