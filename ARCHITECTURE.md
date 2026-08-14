# Court Data Integration — Architecture

How the Advocate Management System connects to external Madras High Court data. Two
independent features, both surfaced under **Cases** in the sidebar:

1. **Display Board** — live court display board (cause list). Scraped in-process.
2. **Case Lookup** — official case-status lookup via an external scraper microservice.

---

## 1. Display Board (in-process scrape)

The board scraper (`madras.py`) is vendored into the Django backend and called directly.

- **Backend:** `workspace/mhc_scraper.py` (vendored, unchanged) + `DisplayBoardView`
  (`workspace/views.py`).
- **Endpoint:** `GET /api/workspace/display-board?bench=chennai`
- **Cache:** server-side, **1 hour** per bench (`BOARD_CACHE_TTL`), via Django's cache.
- **Frontend:** `src/pages/DisplayBoard.jsx` → nav "Cases → Display Board"
  (`/dashboard/display-board`). No refresh button; auto-managed hourly refresh.

This feature has no external service dependency.

---

## 2. Case Lookup (external scraper microservice)

Official case status comes from a **standalone FastAPI scraper** (`scrap_court/`, see its
`INTEGRATION.md`). It performs live scraping + Tesseract CAPTCHA OCR, so it is slow
(~5–30s) and occasionally returns transient errors. **The browser never calls it directly**
(it has no auth and no CORS). Django proxies it.

### Topology

```
React  (Cases → Case Lookup)
  │  JWT · axios baseURL http://localhost:8080
  ▼
Django  "courtsearch" app        ── validate · cache · retry ──►  FastAPI scraper :8000  ──►  court website
  (proxy / gateway)                    COURT_API_BASE env             Tesseract OCR
```

### Backend — `courtsearch` app

| File | Responsibility |
|---|---|
| `courtsearch/client.py` | Only module that talks to the scraper. Timeouts + retry policy. |
| `courtsearch/views.py` | JWT-gated proxy views: validation, caching, error mapping. |
| `courtsearch/models.py` | `CourtCaseTypes` — persisted case-type map per court. |
| `courtsearch/urls.py` | Route table. |
| `courtsearch/management/commands/refresh_case_types.py` | Admin-only case-type refresh. |

Registered in `settings.INSTALLED_APPS` and `advocate_backend/urls.py` (`path('api/', include('courtsearch.urls'))`).

#### Endpoints (all require JWT)

| Method | Path | Upstream | Cache / storage |
|---|---|---|---|
| GET | `/api/courtsearch/courts` | `GET /courts` (scraper's local registry — not a court-site hit) | in-memory 24h |
| GET | `/api/courtsearch/courts/{court_id}/case-types` | `GET /courts/{id}/case-types` | **DB, fetch-once** (see below) |
| POST | `/api/courtsearch/search` | `POST /courts/{id}/cases:search` | in-memory 1h (success only) |

`POST /api/courtsearch/search` body: `{ court_id, case_type, case_number, case_year }`.

#### eCourts District Courts — stateful cascade

A second court, `ecourts_dc` (eCourts Services v6), is a **stateful cascade** rather than a
flat lookup: state → district → court complex → establishment* → case type → search
(*establishment only when the complex value ends in `@Y`). The Django proxy handles it
generically (no per-step code):

| Method | Path | Forwards to scraper |
|---|---|---|
| GET | `/api/courtsearch/ecourts/<step>` | `/courts/ecourts_dc/<step>` (step ∈ states, districts, complexes, establishments, case-types), query params passed through, cached 24h |
| POST | `/api/courtsearch/ecourts/search` | `/courts/ecourts_dc/cases:search`, retry-wrapped, success cached 1h |

- `court_complex` is an **opaque composite** (e.g. `1100261@12@N`) — passed verbatim; `requests`
  URL-encodes it in query strings automatically.
- Retryable statuses now include **504** (portal timeout) alongside 502/503.
- eCourts search returns a different shape — `{ cases: [ { case_number, parties,
  detail:{ fields, tables } } ] }` (one entry per match, each with full detail) — mapped and
  rendered separately in the frontend.

#### Case types — fetch-once persistence (Madras HC)

Case types are effectively static and expensive to fetch (a live court-site scrape of
~352 entries). They are stored in the DB (`CourtCaseTypes`: `court_id`, `types` JSON,
`fetched_at`) rather than re-fetched on a timer:

- **First request for a court** → not in DB → scrape once → persist. Every request after
  that is a **DB read; the court site is never hit again**.
- **No user-facing refresh** — deliberately, so nobody can spam the government site.
- **Refresh is admin-only**, via `python manage.py refresh_case_types [court_id]`, run
  server-side when a court is known to have changed its list.

#### Integration rules (enforced in `client.py` / `views.py`)

- **Timeout:** search uses a **60s** HTTP timeout (`COURT_API_SEARCH_TIMEOUT`); list calls 30s.
- **Retry:** `502` and `503` are retried **up to 3 attempts** with **1s, 2s** backoff.
  `400 / 404 / 422` are **terminal — never retried**.
- **Cache keys:** courts → `courtsearch:courts`; case-types → `courtsearch:case-types:{court}`;
  search → `courtsearch:search:{court}:{type}:{number}:{year}`. Successful searches only.
- **Error mapping → frontend:**
  - `404` → "No matching case found." (terminal)
  - `400` → scraper detail (bad/ambiguous case type)
  - `422` → field validation error (checked before calling upstream)
  - `502 / 503` (after retries) or scraper unreachable → `503` "court website is busy / service unavailable, try again"
- **Politeness:** no parallel fan-out; lookups are per-request and serialized by usage.

#### Config (env, via `python-decouple`)

| Var | Default | Meaning |
|---|---|---|
| `COURT_API_BASE` | `http://localhost:8000` | Scraper base URL |
| `COURT_API_SEARCH_TIMEOUT` | `60` | Seconds for `cases:search` |
| `COURT_API_LIST_TIMEOUT` | `30` | Seconds for courts / case-types |

### Frontend — full-page Add Case flow (`AddCase.jsx`)

Adding a case is a **full-page, Provakil-style flow** at `/dashboard/cases/new` (reached from
the "Add New Case" button; lazy-loaded and routed in `Dashboard.jsx`, before `/cases/:id`).
Case lookup is folded into this flow — there is no standalone lookup page and no cramped modal.

Steps:
1. **Select forum** — two panels ("Quick Select" with a search box + "Available Courts" list).
   The list is driven by `GET /courts` plus an **"Offline / Manual Entry"** option, so new
   courts appear automatically. Picking a court → step 2; picking manual → the blank form.
2. **Search the court record** — the form adapts per court:
   - **Madras HC**: Case Type (searchable) / Case Number / Case Year.
   - **eCourts District Courts**: the cascade — State → District → Court Complex →
     Establishment (only when the complex ends in `@Y`) → Case Type → Case Number → Year.
     Each dropdown loads the next from the proxy; downstream selections reset on change.
   Then a **Search For Case** button (long-wait state; inline errors).
3. **Review & save** — `mapCourtRecordToCase()` prefills the editable case form; the advocate
   picks a client and **Save Case to Workspace** → `POST /api/cases/create` → back to Workspace.

The manual path shows the same case form, blank. `Cases.jsx` still owns the **Edit Case**
modal (editing an existing case is unchanged).

Prefill mapping used in step 3:

  | Court record | → Add Case field |
  |---|---|
  | `fields.CNR` (16 chars) | Case Number |
  | searched case type (e.g. `WP`) | Case Type |
  | Petitioner vs Respondent | Case Title |
  | constant "High Court" (Madras HC) | Court Level |
  | `fields.Stage` → Disposed/Dismissed/Withdrawn ⇒ Closed, "pending" ⇒ Pending, else Active | Status |
  | Reg No / Subject / Nature / Stage summary | Description |
  | — | Amount, Client (advocate fills) |

- No `orders` PDF download — the court gates it behind a second CAPTCHA and there is no
  download endpoint today.

### Finalized decisions

- **Synchronous proxy** (Django holds the request up to 60s; frontend shows a spinner). Can
  migrate to an async job + polling model later if concurrency grows.
- **Full-page Add Case flow** (`/dashboard/cases/new`): select forum → search → review → save,
  with an "Offline / Manual Entry" option. Not a standalone lookup page, not a modal.
- **Display + cache only** — no looked-up *case* data is written to the app database.
- **Case types persisted in the DB, fetch-once**, with admin-only refresh and no user
  refresh button (avoids repeated court-site hits and any risk of user-triggered spam).

---

## 3. Operations

### Running the scraper microservice

```powershell
cd C:\Users\Sybrant\Desktop\scrap_court
.\venv\Scripts\activate
uvicorn api.main:app --host 0.0.0.0 --port 8000          # dev
uvicorn api.main:app --host 0.0.0.0 --port 8000 --workers 2   # prod (behind a process manager)
```

- **Tesseract OCR binary must be installed on the scraper host**, or every search returns 503.
  Verify: `python -c "import pytesseract; print(pytesseract.get_tesseract_version())"`.
- Point Django at it with `COURT_API_BASE` if not on `localhost:8000`.
- The scraper must be reachable from the Django host; keep it on a private network / behind a
  gateway (it has no auth of its own).

### Caching backend

Django currently uses the default in-process **LocMemCache** (per-process, not shared). For
production with multiple workers, configure a shared cache (**Redis**) so cache hits are shared
and TTLs are consistent. This benefits both the Case Lookup caches and the Display Board cache.

### Dependencies

Backend needs `requests` and `beautifulsoup4` (already in `requirements.txt`, installed in
`Advocate-app-BE-Django/venv`). The scraper service has its own venv and requirements
(`scrap_court/requirements.txt`, incl. `pytesseract`, `fastapi`, `uvicorn`).

---

## 4. Security

- All `courtsearch` and `workspace` endpoints are JWT-gated (`RequirePermission()`).
- The scraper service is **never** exposed to browsers; only Django calls it, server-to-server.
- If the scraper is deployed on a separate host/network, add an API key or network ACL in
  front of it and set `COURT_API_BASE` accordingly.
```
