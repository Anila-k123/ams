#!/usr/bin/env bash
# Install LibreOffice (Writer, no GUI) and the fonts firm templates use on a Linux server, for AMS's PDF
# export (Download -> PDF, View print preview of Word templates / samples), then check that the backend
# can really make a PDF. Part of server set-up: docs/DEPLOYMENT.md, step 1. Safe to run again.
#
#     sudo bash tools/install-libreoffice.sh                 # install + check
#     sudo bash tools/install-libreoffice.sh --ms-fonts      # also Microsoft's Times New Roman / Arial
#     bash tools/install-libreoffice.sh --check              # only report
#
# Debian / Ubuntu (apt). LibreOffice is free (MPL 2.0) and runs as a separate program; AMS starts it per
# conversion (Advocate-app-BE-Django/drafting/export/pdf.py), found on PATH (/usr/bin/soffice).
#
# Fonts: Liberation (same widths as Times New Roman / Arial / Courier, so line breaks match Word),
# DejaVu, and Noto (Tamil, Hindi and other Indian scripts). --ms-fonts adds Microsoft's own core fonts
# (ttf-mscorefonts-installer, accepting its EULA) for the closest match to Word.
set -euo pipefail

CHECK=0
MS_FONTS=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --ms-fonts) MS_FONTS=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BE="$REPO/Advocate-app-BE-Django"
PY="$BE/venv/bin/python"

if command -v soffice >/dev/null 2>&1; then
  echo "LibreOffice found: $(command -v soffice)"
elif [ "$CHECK" = 1 ]; then
  echo "LibreOffice is NOT installed: Download -> PDF and the View print preview will not work."
  echo "Run: sudo bash tools/install-libreoffice.sh"
  exit 1
else
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "This script uses apt (Debian / Ubuntu). On other systems install LibreOffice Writer and fonts" >&2
    echo "(Liberation, DejaVu, Noto) with the system's package manager, then run with --check." >&2
    exit 1
  fi
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  # Writer without the desktop parts; older releases have no -nogui package.
  apt-get install -y -q --no-install-recommends libreoffice-writer-nogui \
    || apt-get install -y -q --no-install-recommends libreoffice-writer
  # Python bridge: the ONLYOFFICE draft redline in its own look runs LibreOffice's Compare Document from Python.
  apt-get install -y -q --no-install-recommends python3-uno || true
  apt-get install -y -q --no-install-recommends fonts-liberation fonts-liberation2 fonts-dejavu-core fonts-noto-core \
    || apt-get install -y -q --no-install-recommends fonts-liberation fonts-dejavu-core
  if [ "$MS_FONTS" = 1 ]; then
    echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections
    apt-get install -y -q ttf-mscorefonts-installer
  fi
  fc-cache -f >/dev/null 2>&1 || true
  echo "LibreOffice installed: $(command -v soffice)"
fi

# The real test: the backend makes a PDF with it.
if [ -x "$PY" ]; then
  (cd "$BE" && "$PY" manage.py check_pdf_export)
else
  echo "Backend venv not set up yet ($PY). After step 5 of docs/DEPLOYMENT.md run:"
  echo "    venv/bin/python manage.py check_pdf_export"
fi
