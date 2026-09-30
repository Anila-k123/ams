# AMS: Advocate Management System (PactPro)

Practice management for Indian law firms: clients, cases imported live from the courts, hearings, tasks with senior review, AI-assisted drafting, GST invoicing, a client portal, and role-based access for every person in the firm.

## What's in it

| Area | Highlights |
|---|---|
| **Cases** | Import from eCourts (district courts, High Courts, Supreme Court, CNR): parties, hearings, orders, interim applications. Refresh from court; appeal-deadline alerts; daily cause list and display board |
| **Clients** | Full client record with structured address, GSTIN and a **handling advocate** (who is notified on assignment); client portal logins |
| **Hearings & tasks** | Calendar, reminders, delegation to juniors/interns with **submit → review → approve / request changes** |
| **Drafting** | Precedent- and template-based AI drafting linked to cases and tasks; Word export on the firm letterhead; BNS/BNSS code updates |
| **Lisa (AI assistant)** | Case briefings from the court record; remembers the conversation; answers only from the firm's own data |
| **Finance** | GST tax invoices (recipient details pre-filled from the client), payments, expenses, reports |
| **Reference** | Acts library, legal dictionary (incl. Hindi), BNS law codes |
| **Control** | Roles and permissions per person, practice (team) scoping, audit trail, backup/restore |

The full feature list is in [FEATURES.md](FEATURES.md).

## Stack

| Part | Technology | Port |
|---|---|---|
| Backend: `Advocate-app-BE-Django/` | Python 3.11, Django 5.1 + DRF, PostgreSQL 17 (database `PactPro_db`, schemas `public` and `drf`), pgvector | 8080 |
| Frontend: `Advocate-app-FE-main/` | React 19, Vite 7, TypeScript, PrimeReact, TipTap | 5173 |
| Court scraper | FastAPI, in a **separate repository** (path set by `SCRAPER_DIR`) | 8000 |

LLMs are configured in `.env`: the assistant (`LLM_*`, OpenAI-compatible) and drafting (`DRAFTING_*`).

`Advocate-app-BE-main/` is what's left of the original Spring Boot backend. Only its `uploads/` folder is still used (runtime storage, not in git).

## Getting started

Full guide: **[LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md)**. In short:

1. **Database.** Most tables come from the original schema and are *unmanaged*, so `migrate` does not create them. Restore a dump of an existing database (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), step 2), then run `manage.py migrate` for the newer tables.
2. **Backend:**
   ```bat
   cd Advocate-app-BE-Django
   python -m venv venv
   venv\Scripts\pip install -r requirements.txt
   copy .env.example .env        &rem then fill in DB_*, MAIL_*, LLM_* and the drafting keys
   venv\Scripts\python.exe manage.py migrate
   venv\Scripts\python.exe manage.py runserver 0.0.0.0:8080
   ```
3. **Frontend:**
   ```bat
   cd Advocate-app-FE-main
   npm install
   npm run dev
   ```
   The API base is `VITE_API_BASE` (default `http://127.0.0.1:8080`).
4. **Scraper:** start it from its own repository on port 8000. While it's down, court features (import, cause lists, display board) return 503.

On Windows, **`run-project.bat`** starts all three in separate windows.

## Tests

```bat
cd Advocate-app-BE-Django
venv\Scripts\python.exe manage.py test
```
The test runner builds tables from the models, including the unmanaged ones. Live-database CHECK constraints are not reproduced.

Frontend: `npm run build` (type-checks) and `npm run lint`.

## Demo

- **[docs/DEMO_OS900_2025.md](docs/DEMO_OS900_2025.md)**: the end-to-end demo. One matter (Kannan vs Seetharaman) is built from scratch through every role. Reset it with:
  ```bat
  venv\Scripts\python.exe manage.py reset_demo_client --name Kannan --firm rajesh@kumar-associates.demo --yes
  ```
- [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md): demo logins, what each role can do, and a manual test checklist. Seed the demo logins with `manage.py seed_role_demo`.

## Documentation

| Doc | What |
|---|---|
| [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) | Setting up and running locally |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | New server setup (Windows and Linux), database restore |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Running it: processes, background jobs, AI keys, production checklist |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Court data integration (scraper ↔ backend) |
| [FEATURES.md](FEATURES.md) | Every feature and its endpoints |
| [CLAUDE.md](CLAUDE.md) | Conventions and gotchas for working in the code |
| `roadmap/`, `docs/merge-plan/` | The InstaDraft ↔ AMS merge plan and progress |

## Contributing

- Work on a `Developer-*` branch and open pull requests against `main`.
- Never commit secrets: configuration goes in `.env` (git-ignored); `.env.example` holds placeholders only.
- Uploaded files, database dumps, logs and build output are git-ignored. Keep it that way.
- Update the relevant doc in the same change as the code (see `CLAUDE.md`).
