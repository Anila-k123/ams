# Local Development Guide

Three processes make up a working local system. The first two are this
repository; the third is a separate one.

| # | Service | Where | Port | Start |
|---|---------|-------|------|-------|
| 1 | Backend — Django 5.1 + DRF | `Advocate-app-BE-Django/` | **8080** | `venv\Scripts\python.exe manage.py runserver 0.0.0.0:8080` |
| 2 | Frontend — React 19 + Vite | `Advocate-app-FE-main/` | **5173** | `npm run dev` |
| 3 | Court scraper — FastAPI | `C:\Users\ANILA\scrap` (own repo) | **8000** | `venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000` |

Plus **PostgreSQL 17** on 5432, running as a Windows service.

> **The scraper does not auto-start, and nothing restarts it.** While it is down,
> every court feature fails — display boards, Daily Status ("View"), case import
> and cause lists. The backend returns a clean `503` and the UI shows an error
> toast, so the symptom is "court features are quiet", not a crash. If court data
> stops working, **check port 8000 first.**

---

## Prerequisites

| Software | Version | Check |
|----------|---------|-------|
| Python | 3.11 | `python --version` |
| PostgreSQL | 17 | service `postgresql-x64-17` running |
| Node.js | 20.19+ or 22.12+ | `node -v` |
| Tesseract OCR | any | only for eCourts CAPTCHA lookups (scraper host) |

> Node 20.13 works but Vite prints a version warning on every start. Anything
> below 20.19 is unsupported by Vite 7 and may break on `npm run build`.

---

## First-time setup

### Backend

```bat
cd Advocate-app-BE-Django
python -m venv venv
venv\Scripts\pip install -r requirements.txt
copy .env.example .env
```

Then edit `.env` — see [Configuration](#configuration). The models that map onto
the original Spring-era tables are `managed = False`, so **no migrations are
needed for them**; the database is expected to exist already. Newer tables
(`acts_*`, `appeal_detection`, `case_note`, `courtsearch_*`, `causelist_item`)
*are* Django-managed:

```bat
venv\Scripts\python.exe manage.py migrate
```

### Frontend

```bat
cd Advocate-app-FE-main
npm install
```

### Scraper (separate repository)

```bat
cd C:\Users\ANILA\scrap
python -m venv venv
venv\Scripts\pip install -r requirements.txt
```

---

## Running

Each in its own terminal:

```bat
REM 1. backend
cd Advocate-app-BE-Django && venv\Scripts\python.exe manage.py runserver 0.0.0.0:8080

REM 2. frontend
cd Advocate-app-FE-main && npm run dev

REM 3. scraper
cd C:\Users\ANILA\scrap && venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000
```

Then open <http://localhost:5173>.

`run-django.bat` (backend) and `run-frontend.bat` (frontend) do the same thing
with a few environment checks.

> **`.env` is read once, at startup.** Editing it while the server is running
> changes nothing. Restart the backend after any change — and make sure the old
> process actually died: if it still holds port 8080, the new one fails to bind
> and the *old* configuration keeps serving, which looks exactly like the edit
> not working.

---

## Configuration

All backend config is `.env` (gitignored). `.env.example` documents every key.

### Database

```ini
DB_NAME=db_ams
DB_USER=postgres
DB_PASSWORD=...
DB_HOST=localhost
DB_PORT=5432
```

### Email — required for every outbound message

Password-reset OTPs, hearing alerts, invoice reminders, appeal alerts and all
**client notifications** use this. There are deliberately **no fallback
credentials** in `settings.py`; if these are unset the app does not attempt to
send and says so plainly (`503 Email is not configured on the server`).

```ini
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=True
MAIL_USERNAME=you@gmail.com
MAIL_PASSWORD=<16-char app password>
```

For Gmail, `MAIL_PASSWORD` must be a **16-character App Password** (Google
Account → Security → App Passwords, requires 2-Step Verification), with the
spaces stripped. An ordinary account password will not authenticate.

To develop without sending real mail:

```ini
MAIL_BACKEND=django.core.mail.backends.console.EmailBackend
```

`EMAIL_CONFIGURED` then reports true with no credentials at all, and messages
print to the backend console.

### Scraper

```ini
# COURT_API_BASE=http://localhost:8000
# COURT_API_SEARCH_TIMEOUT=60
# COURT_API_CAUSELIST_TIMEOUT=300   # cause lists parse several large PDFs
```

### Frontend

```ini
VITE_API_BASE=http://localhost:8080     # defaults to this
```

---

## Scheduled tasks (Windows Task Scheduler)

Registered tasks, each a `.bat` in `Advocate-app-BE-Django/scripts/`:

| Task | Script | Interval | What it does |
|------|--------|----------|--------------|
| AMS Notification Drain | `process_notifications.bat` | 5 min | Sends queued notifications |
| AMS Reminder Scan | `scan_notifications.bat` | daily | Raises hearing / invoice / task reminders |
| AMS Appeal Scan | `scan_appeals.bat` | daily | Detects appealable disposals (needs the scraper) |
| AMS Prune Audit Log | `prune_audit_log.bat` | daily | Trims `audit_log` |

**Not yet registered:** `manage.py sync_causelist`. It must run each morning
*after* the court publishes, or the cause-list features have no data:

```bat
venv\Scripts\python.exe manage.py sync_causelist --court sci --days 2
```

Check what is registered:

```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -like 'AMS*' }
```

### Notification delivery

`notifications/service.notify()` **enqueues**; the drain task sends. Two paths
exist deliberately:

- **Advocate reminders** — queued, delivered on the next 5-minute drain.
- **Client notifications** — queued *and then* sent inline by `send_now()`, so a
  client hears about an invoice immediately. If the inline send fails the row
  stays `PENDING` and the scheduled drain retries with backoff, so a mail outage
  delays a message rather than losing it.

Inline sending means an action that notifies a client **waits on SMTP** —
measured at ~5.5s for an invoice against Gmail.

---

## Ports

| Port | Service | Configurable |
|------|---------|--------------|
| 8080 | Django backend | `runserver` argument |
| 5173 | Vite dev server | `server.port` in `vite.config.js` |
| 8000 | Court scraper | uvicorn argument + `COURT_API_BASE` |
| 5432 | PostgreSQL | `DB_PORT` |

---

## Tests

```bat
cd Advocate-app-BE-Django
venv\Scripts\python.exe manage.py test
venv\Scripts\python.exe manage.py test courtsearch     # cause-list matching
```

A custom runner (`core/test_runner.py`) flips `managed = True` for the duration
of the run so the Spring-era tables get built in the test database. One
consequence: the tables come from the *models*, not the real schema, so live
Postgres CHECK constraints are not reproduced and a test cannot catch a
violation of them.

Frontend lint:

```bat
cd Advocate-app-FE-main && npm run lint
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Court features silently do nothing | Scraper down. Check port 8000 and restart it. |
| `.env` change had no effect | Backend not restarted, or the old process still owns 8080 — kill it and confirm the port is free. |
| `503 Email is not configured` | `MAIL_USERNAME` / `MAIL_PASSWORD` unset, or the server was not restarted after setting them. |
| Gmail rejects the login | Using the account password instead of a 16-character App Password. |
| Client emails never arrive | Check `notification_history` for `FAILED` rows and their `error_message`; check the client actually has an email on file. |
| "Your Item" always empty | `sync_causelist` has not run for today, or the case has no importable court record to match on. Only `sci` has a cause-list source. |
| Daily Status ("View") opens blank | That hearing row has no `businessDate`, so the court has no record to return. Handled — it now reports this instead of opening an empty modal. |
| Vite version warning | Node below 20.19. Works for `dev`, may break `build`. |
| Port already in use | `Get-NetTCPConnection -LocalPort 8080 -State Listen` then stop the owning process. |

---

## Outstanding work

`NEXT_STEPS.md` lists what is pending and why, including the one thing that must
be set up before the cause-list features have any data: **`sync_causelist` is not
yet scheduled.**

---

## Project layout

```
ams/
├── Advocate-app-BE-Django/     # Django 5.1 + DRF backend (port 8080)
│   ├── advocate_backend/       # settings, urls, asgi
│   ├── core/                   # shared models, auth, permissions, pagination
│   ├── courtsearch/            # scraper proxy + cause lists + matching
│   ├── notifications/          # queue, client_events, drain command
│   ├── workspace/              # case workspace + display-board proxy
│   ├── scripts/                # scheduled-task .bat files
│   └── venv/
├── Advocate-app-FE-main/       # React 19 + Vite frontend (port 5173)
│   └── src/{pages,components,contexts,services}
├── ARCHITECTURE.md             # court-data integration design
└── LOCAL_DEVELOPMENT.md        # this file

C:\Users\ANILA\scrap/           # separate repo — ALL scraping lives here
├── causelist.py                # daily cause lists (SCI)
├── display_board.py            # 26 live display boards
├── hc_case_status.py           # eCourts High Court (OCR CAPTCHA)
└── api/                        # FastAPI routes (port 8000)
```

**The boundary is deliberate: no scraping code in the AMS backend.** The backend
proxies, caches, stores and matches; the scraper fetches and parses. `pdfplumber`
and `beautifulsoup4` belong to the scraper's requirements, not the backend's.
