# Deploying AMS to a New Server

Step-by-step setup of AMS on a fresh server. **Windows Server is the primary
target**; Linux equivalents are given alongside each step.

For day-to-day development see `LOCAL_DEVELOPMENT.md`; for runtime behaviour
(background jobs, AI keys) see `docs/OPERATIONS.md`.

---

## 0. What you are deploying

| # | Component | Port | Source |
|---|-----------|------|--------|
| 1 | PostgreSQL 17 (+ `vector`, `pg_trgm`, `pgcrypto`) | 5432 | installed |
| 2 | Backend — Django 5.1 + DRF | 8080 (internal) | `Advocate-app-BE-Django/` |
| 3 | Frontend — static build of React/Vite | 80/443 via web server | `Advocate-app-FE-main/` |
| 4 | Court scraper — FastAPI | 8000 (internal) | **separate repo** |
| 5 | Scheduler (notifications, reminders) | — | `manage.py run_scheduler` |
| 6 | Redis + Celery worker (drafting AI jobs) | 6379 | recommended for production |

A reverse proxy (IIS on Windows, nginx on Linux) serves the frontend and
forwards `/api/` to the backend.

> **Critical:** most tables were created by the original Spring application and
> are `managed = False` in Django. `manage.py migrate` does **not** create them,
> and the repo contains no schema script. A new server's database **must be
> restored from a dump of the existing database** (step 2). Do not start from an
> empty database.

---

## 1. Install prerequisites

| Software | Version | Windows | Linux (Ubuntu 22.04+) |
|----------|---------|---------|------------------------|
| Python | 3.11 | python.org installer ("Add to PATH") | `apt install python3.11 python3.11-venv` |
| PostgreSQL | 17 | EDB installer | `apt install postgresql-17` (PGDG repo) |
| pgvector | ≥ 0.7 | prebuilt DLLs from the pgvector releases, copied into the PG install dir | `apt install postgresql-17-pgvector` |
| Node.js | 20.19+ / 22.12+ | nodejs.org (build machine only) | NodeSource |
| Git | any | git-scm.com | `apt install git` |
| Tesseract OCR | any | UB-Mannheim build (scraper host only) | `apt install tesseract-ocr` |
| Redis | 6+ | Memurai, or Redis in WSL/Docker | `apt install redis-server` |
| LibreOffice | 7.6+ | `winget install TheDocumentFoundation.LibreOffice` (draft PDF export; set `LIBREOFFICE_PATH` if not in Program Files) | `apt install libreoffice-writer` |
| Web server | — | IIS + URL Rewrite + ARR modules | `apt install nginx` |
| Service wrapper | — | [NSSM](https://nssm.cc) | systemd (built in) |

Allow ~5 GB disk for the Python venv (torch/transformers for drafting).

---

## 2. Database — move it from the current server

### 2a. On the **current** server: dump

```bat
"C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -U postgres -h localhost -Fc -f PactPro_db.dump "PactPro_db"
```
Linux: `pg_dump -U postgres -h localhost -Fc -f PactPro_db.dump PactPro_db`

This carries both schemas (`public` = AMS, `drf` = drafting), all data, and the
Django migration history. Copy `PactPro_db.dump` to the new server.

### 2b. On the **new** server: create and restore

```bat
psql -U postgres -c "CREATE DATABASE \"PactPro_db\";"
psql -U postgres -d PactPro_db -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS pgcrypto;"
pg_restore -U postgres -d PactPro_db --no-owner PactPro_db.dump
```
(The name has capitals — quote it as `"PactPro_db"` inside SQL.)

Create a dedicated DB user instead of using `postgres` in production:

```sql
CREATE USER ams WITH PASSWORD '...';
GRANT ALL PRIVILEGES ON DATABASE "PactPro_db" TO ams;
\c "PactPro_db"
GRANT ALL ON ALL TABLES IN SCHEMA public, drf TO ams;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public, drf TO ams;
GRANT USAGE, CREATE ON SCHEMA public, drf TO ams;
```

---

## 3. Get the code

```bat
git clone <repo-url> C:\apps\ams
```
Linux: `git clone <repo-url> /opt/ams`

Clone the scraper repo next to it (e.g. `C:\apps\scrap` / `/opt/scrap`).

---

## 4. Uploaded files — copy them over

| Setting | Holds | Default (change on a server) |
|---------|-------|------------------------------|
| `DOCUMENT_UPLOAD_DIR` | AMS case documents | `Advocate-app-BE-main/uploads` |
| `DRAFTING_MEDIA_ROOT` | drafting references, templates, playbooks | old InstaDraft checkout on the Desktop |
| `COURT_PDF_CACHE_DIR` | cached court PDFs (safe to leave empty) | `Advocate-app-BE-Django/court_pdf_cache` |

Copy the current folders to a permanent data location outside the code, e.g.
`D:\ams-data\uploads`, `D:\ams-data\drafting-media` (Linux: `/var/lib/ams/...`),
and set the paths in `.env` (step 5). The backend service account needs
read/write access. Include these folders in backups.

---

## 5. Backend

```bat
cd C:\apps\ams\Advocate-app-BE-Django
python -m venv venv
venv\Scripts\pip install -r requirements.txt
copy .env.example .env
```
Linux:
```bash
cd /opt/ams/Advocate-app-BE-Django
python3.11 -m venv venv
venv/bin/pip install -r requirements.txt
cp .env.example .env
```

### `.env` — production values

`.env.example` documents every key. Minimum for a server:

```ini
SECRET_KEY=<long random string>
DEBUG=False
ALLOWED_HOSTS=ams.example.com
CORS_ORIGINS=https://ams.example.com
CLIENT_APP_URL=https://ams.example.com

DB_NAME=PactPro_db
DB_USER=ams
DB_PASSWORD=...
DB_HOST=localhost
DB_PORT=5432

MAIL_HOST=...  MAIL_PORT=587  MAIL_USE_TLS=True  MAIL_USERNAME=...  MAIL_PASSWORD=...
OTP_SALT=<random>

DOCUMENT_UPLOAD_DIR=D:\ams-data\uploads
DRAFTING_MEDIA_ROOT=D:\ams-data\drafting-media
COURT_API_BASE=http://127.0.0.1:8000

LLM_PROVIDER=...            # AMS assistant + summaries
DRAFTING_LLM_ACTIVE=...     # drafting keys use the DRAFTING_ prefix
DRAFTING_GEMINI_API_KEY=...

REDIS_URL=redis://localhost:6379/0
CELERY_TASK_ALWAYS_EAGER=False
```

Generate a secret key:
`venv\Scripts\python -c "from django.core.management.utils import get_random_secret_key as k; print(k())"`

### Apply migrations and seed

The restored dump already has migration history; this only applies anything newer:

```bat
venv\Scripts\python manage.py migrate
venv\Scripts\python manage.py seed_drafting_permissions
venv\Scripts\python manage.py seed_invoice_permissions
venv\Scripts\python manage.py recalc_case_totals
venv\Scripts\python manage.py check --deploy
```

`recalc_case_totals` rebuilds every case's paid / expenses / balance / pending figures from the real payment, expense and invoice rows. Older databases have these at 0. It's safe to re-run.

### Smoke test

```bat
venv\Scripts\waitress-serve --listen=127.0.0.1:8080 --threads=8 advocate_backend.wsgi:application
```
Linux: `venv/bin/gunicorn advocate_backend.wsgi:application -b 127.0.0.1:8080 -w 3 --timeout 300`

Open `http://127.0.0.1:8080/api/health` — a response means it is up.

> With `CELERY_TASK_ALWAYS_EAGER=True` (the stopgap), each web process starts its
> own drafting worker — keep a **single** process in that mode (waitress is
> single-process; use `-w 1` for gunicorn). See `docs/OPERATIONS.md`.

---

## 6. Frontend — build and publish

`VITE_API_BASE` is baked in **at build time**. Build on any machine with Node:

```bat
cd Advocate-app-FE-main
npm ci
set VITE_API_BASE=https://ams.example.com
npm run build
```
Linux: `VITE_API_BASE=https://ams.example.com npm run build`

Copy `dist/` to the web root (`C:\inetpub\ams` / `/var/www/ams`). It is a
single-page app: unknown paths must fall back to `index.html`.

---

## 7. Web server / reverse proxy

### Windows — IIS

1. Install IIS, **URL Rewrite** and **Application Request Routing**; in ARR
   "Server Proxy Settings" tick *Enable proxy*.
2. Create a site pointing at `C:\inetpub\ams`, bind the hostname and an HTTPS
   certificate (e.g. win-acme for Let's Encrypt).
3. Put this `web.config` in the web root:

```xml
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="API" stopProcessing="true">
          <match url="^api/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:8080/api/{R:1}" />
        </rule>
        <rule name="SPA" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
    <security><requestFiltering><requestLimits maxAllowedContentLength="104857600" /></requestFiltering></security>
  </system.webServer>
</configuration>
```

Raise the ARR proxy timeout (e.g. 300 s) — cause-list and drafting calls are slow.

### Linux — nginx

```nginx
server {
    listen 443 ssl;
    server_name ams.example.com;
    ssl_certificate     /etc/letsencrypt/live/ams.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ams.example.com/privkey.pem;

    client_max_body_size 100M;
    root /var/www/ams;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
    location / { try_files $uri /index.html; }
}
```
Certificates: `certbot --nginx -d ams.example.com`.

---

## 8. Run everything as services

Every long-running process must survive reboots and restart on crash.

### Windows — NSSM

```bat
nssm install AMS-Backend   C:\apps\ams\Advocate-app-BE-Django\venv\Scripts\waitress-serve.exe --listen=127.0.0.1:8080 --threads=8 advocate_backend.wsgi:application
nssm set     AMS-Backend   AppDirectory C:\apps\ams\Advocate-app-BE-Django

nssm install AMS-Scheduler C:\apps\ams\Advocate-app-BE-Django\venv\Scripts\python.exe manage.py run_scheduler
nssm set     AMS-Scheduler AppDirectory C:\apps\ams\Advocate-app-BE-Django

nssm install AMS-Celery    C:\apps\ams\Advocate-app-BE-Django\venv\Scripts\celery.exe -A advocate_backend worker -l info --pool=solo
nssm set     AMS-Celery    AppDirectory C:\apps\ams\Advocate-app-BE-Django

nssm install AMS-Scraper   C:\apps\scrap\venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000
nssm set     AMS-Scraper   AppDirectory C:\apps\scrap
```
For each: `nssm set <name> AppStdout D:\ams-data\logs\<name>.log`, then
`nssm start <name>`.

### Linux — systemd

`/etc/systemd/system/ams-backend.service`:
```ini
[Unit]
Description=AMS backend
After=network.target postgresql.service

[Service]
User=ams
WorkingDirectory=/opt/ams/Advocate-app-BE-Django
ExecStart=/opt/ams/Advocate-app-BE-Django/venv/bin/gunicorn advocate_backend.wsgi:application -b 127.0.0.1:8080 -w 3 --timeout 300
Restart=always

[Install]
WantedBy=multi-user.target
```
Create `ams-scheduler`, `ams-celery` and `ams-scraper` the same way with
`ExecStart` = `venv/bin/python manage.py run_scheduler`,
`venv/bin/celery -A advocate_backend worker -l info`, and
`/opt/scrap/venv/bin/python -m uvicorn api.main:app --host 127.0.0.1 --port 8000`.
Then `systemctl daemon-reload && systemctl enable --now ams-backend ams-scheduler ams-celery ams-scraper`.

---

## 9. Scheduled jobs

`run_scheduler` (step 8) covers notification delivery and reminders. These
still need a scheduler entry (scripts in `Advocate-app-BE-Django/scripts/`):

| Job | Command | When |
|-----|---------|------|
| Appeal scan | `manage.py scan_appeals` | daily |
| Prune audit log | `manage.py prune_audit_log` | daily |
| Document summaries catch-up | `manage.py summarize_documents` | every 10 min |
| Cause list sync | `manage.py sync_causelist --court sci --days 2` | daily, after courts publish (morning) |

Windows (Task Scheduler), example:
```bat
schtasks /Create /TN "AMS Appeal Scan" /SC DAILY /ST 06:00 /RU SYSTEM ^
  /TR "C:\apps\ams\Advocate-app-BE-Django\scripts\scan_appeals.bat"
```
Linux (`crontab -e` as `ams`):
```cron
0 6 * * *    cd /opt/ams/Advocate-app-BE-Django && venv/bin/python manage.py scan_appeals
30 2 * * *   cd /opt/ams/Advocate-app-BE-Django && venv/bin/python manage.py prune_audit_log
*/10 * * * * cd /opt/ams/Advocate-app-BE-Django && venv/bin/python manage.py summarize_documents
30 7 * * *   cd /opt/ams/Advocate-app-BE-Django && venv/bin/python manage.py sync_causelist --court sci --days 2
```

---

## 10. Firewall

Expose only 80/443. Keep 5432, 6379, 8000 and 8080 bound to `127.0.0.1` /
blocked externally.

Windows: `New-NetFirewallRule -DisplayName "AMS HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow`
Linux: `ufw allow 'Nginx Full' && ufw enable`

---

## 11. Backups

- **Database:** nightly `pg_dump -Fc "PactPro_db"` to a separate disk/off-site, keep ≥ 14 days.
- **Files:** `DOCUMENT_UPLOAD_DIR` and `DRAFTING_MEDIA_ROOT`.
- **Config:** `.env` (store securely — it holds secrets).

---

## 12. Verification checklist

- [ ] `https://ams.example.com` loads the login page; refreshing a deep link (e.g. `/cases`) still works
- [ ] Login succeeds (API reachable through the proxy, CORS correct)
- [ ] Existing cases/clients visible (database restored)
- [ ] An old document downloads (upload folder copied and path set)
- [ ] Display board / cause list load (scraper running, `COURT_API_BASE` correct)
- [ ] A test email/invoice notification arrives (MAIL_* + scheduler)
- [ ] A drafting job completes (Celery + Redis + drafting keys)
- [ ] Services restart after a reboot

## Updating an existing deployment

```bat
git pull
venv\Scripts\pip install -r requirements.txt
venv\Scripts\python manage.py migrate
```
Rebuild the frontend with the same `VITE_API_BASE`, replace the web root's
contents (keep `web.config`), then restart `AMS-Backend`, `AMS-Scheduler`,
`AMS-Celery` (Linux: `systemctl restart ams-backend ams-scheduler ams-celery`).
