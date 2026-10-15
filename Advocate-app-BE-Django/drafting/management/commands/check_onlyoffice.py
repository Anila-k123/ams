"""Check that this backend and the ONLYOFFICE document server work together (docs/ONLYOFFICE_PLAN.md,
Phase 0): the server answers, it accepts our JWT, it can download a file from this machine, and it
converts Word to PDF. Run after installing / updating either side; exits non-zero on the first failure.

    manage.py check_onlyoffice
"""

import io
import socket
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import jwt
import requests
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


def _signed(payload):
    """A request body / header the document server accepts: the payload signed with the shared secret."""
    return jwt.encode(payload, settings.ONLYOFFICE_JWT_SECRET, algorithm='HS256')


class Command(BaseCommand):
    help = 'Check the ONLYOFFICE document server: health, JWT, reaching this machine, Word to PDF.'

    def handle(self, *args, **opts):
        base = settings.ONLYOFFICE_INTERNAL_URL
        if not base:
            raise CommandError('ONLYOFFICE_INTERNAL_URL / ONLYOFFICE_URL is not set in .env.')
        if not settings.ONLYOFFICE_JWT_SECRET:
            raise CommandError('ONLYOFFICE_JWT_SECRET is not set in .env (the server\'s '
                               'services.CoAuthoring.secret.inbox.string in config\\local.json).')
        self.stdout.write(f'Document server: {base} (browser: {settings.ONLYOFFICE_URL or "-"})')

        # 1. Alive.
        try:
            health = requests.get(f'{base}/healthcheck', timeout=10)
        except requests.RequestException as exc:
            raise CommandError(f'Document server not reachable: {exc}')
        if health.text.strip() != 'true':
            raise CommandError(f'/healthcheck answered {health.status_code} {health.text[:80]!r}, not "true". '
                               'If it is 404, check its internal port is not shared with another service '
                               '(docs/ONLYOFFICE_PLAN.md, section 4).')
        self.stdout.write('  healthcheck: ok')

        # 2. JWT: the command service refuses unsigned or wrongly signed requests.
        body = {'c': 'version'}
        res = requests.post(f'{base}/command', json={**body, 'token': _signed(body)},
                            headers={'Authorization': f'Bearer {_signed({"payload": body})}'}, timeout=15)
        data = res.json() if res.headers.get('content-type', '').startswith('application/json') else {}
        if data.get('error') != 0:
            raise CommandError(f'Command service refused the request ({res.status_code} {res.text[:120]!r}): '
                               'the JWT secret in .env must equal the server\'s.')
        self.stdout.write(f'  JWT: ok (server version {data.get("version", "?")})')

        # 3 + 4. The server downloads a Word file from this machine and converts it to PDF.
        pdf, seconds = self._convert(base)
        if not pdf.startswith(b'%PDF'):
            raise CommandError('The conversion returned something that is not a PDF.')
        self.stdout.write(f'  downloads from this machine: ok\n  Word to PDF: ok ({seconds:.1f} s)')
        self.stdout.write(self.style.SUCCESS('ONLYOFFICE is ready for AMS.'))

    def _convert(self, base):
        from docx import Document
        doc = Document()
        doc.add_paragraph('ONLYOFFICE check. Times New Roman, Arial and Indian scripts: '
                          'சென்னை हिन्दी മലയാളം')
        buf = io.BytesIO()
        doc.save(buf)
        data = buf.getvalue()

        # Served for this check only, on this machine's AMS_INTERNAL_URL host: the document server must
        # reach that address (its request filter blocks private addresses unless allowed).
        host = urlparse(settings.AMS_INTERNAL_URL).hostname if settings.AMS_INTERNAL_URL else None
        if not host:
            raise CommandError('AMS_INTERNAL_URL is not set in .env (this backend as the document server '
                               'reaches it, e.g. http://192.168.1.36:8081).')

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):                                     # noqa: N802 - http.server API
                self.send_response(200)
                self.send_header('Content-Type',
                                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        with socket.socket() as s:
            s.bind(('', 0))
            port = s.getsockname()[1]
        server = ThreadingHTTPServer(('0.0.0.0', port), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            payload = {'async': False, 'filetype': 'docx', 'outputtype': 'pdf', 'key': uuid.uuid4().hex,
                       'title': 'check.docx', 'url': f'http://{host}:{port}/check.docx'}
            started = time.monotonic()
            res = requests.post(f'{base}/converter', json={**payload, 'token': _signed(payload)},
                                headers={'Accept': 'application/json'}, timeout=120)
            out = res.json() if res.text.strip().startswith('{') else {}
            if out.get('error'):
                hint = {-4: 'it could not download the file from this machine: allow private addresses '
                            '(services.CoAuthoring.request-filtering-agent.allowPrivateIPAddress = true in its '
                            'local.json) and check the firewall',
                        -8: 'the JWT was refused'}.get(out['error'], 'see the document server logs')
                raise CommandError(f'Conversion failed (error {out["error"]}): {hint}.')
            if not out.get('endConvert') or not out.get('fileUrl'):
                raise CommandError(f'Conversion did not finish: {res.status_code} {res.text[:160]!r}')
            pdf = requests.get(out['fileUrl'], timeout=60).content
            return pdf, time.monotonic() - started
        finally:
            server.shutdown()
