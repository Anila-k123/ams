# Court Data Integration — Architecture

How the Advocate Management System connects to external court data. Three features,
all surfaced under **Cases** in the sidebar:

1. **Display Board** — what each courtroom is calling *right now*.
2. **Cause List** — the day's *published order of business*, and where this
   practice's own matters sit in it ("Your Item").
3. **Case Lookup** — official case-status lookup and import.

**One rule governs all three: no scraping code lives in the AMS backend.** Every
fetch and parse happens in the standalone scraper service; the backend proxies,
caches, stores and matches. `pdfplumber` / `beautifulsoup4` are the scraper's
dependencies, not the backend's.

---

## 1. Display Board (proxy to the scraper)

A board reports one row per courtroom: the item being called at this moment. It is
live state, so it is fetched on demand and never stored.

- **Backend:** `DisplayBoardView` (`workspace/views.py`) — a thin, cached proxy to
  the scraper's `/display-board`. (Historically the Madras scraper was vendored
  in-process; it is not any more.)
- **Endpoint:** `GET /api/workspace/display-board?bench=chennai`
- **Cache:** server-side, **1 hour** per bench (`BOARD_CACHE_TTL`).
- **Frontend:** `src/pages/DisplayBoard.jsx` → "Cases → Display Board". 26 courts
  in a lazy accordion; each panel scrapes on first open. Has a Refresh button.
- **Columns are data-driven.** `FIELD_CATALOG` lists every field the shared row
  shape can carry, and a column renders only when some row on the *currently
  loaded* board populates it. Never hardcode a court's column set.

### `yourItem` — the per-practice overlay

Board rows are enriched with `yourItem`, this practice's item number in that
courtroom today, sourced from the **stored cause list** (section 2), not the board.

The board cache is shared by every user, so the overlay is applied **after** the
cache read and the merged result is never written back. `_with_your_items()`
copies the payload and each row for the same reason. Getting this backwards would
show one practice another practice's listings.

---

## 2. Cause Lists (scraped daily, stored, then matched)

A display board cannot answer "how far away is my matter?". It publishes only the
current item — roughly 0.5% of a day's listings at any instant — and a match
against it can only ever fire at the moment your case is already being called.
The **cause list** is the whole day's order, so it is the only source for "the
court is on item 29, you are item 40".

### Flow

```
scraper repo (separate)                 AMS backend                    frontend
─────────────────────────────────       ───────────────────────        ─────────────
causelist.py  -- PDF fetch + parse
api/causelist_routes.py
  GET /causelist?court=sci&date=   -->  manage.py sync_causelist
                                          stores causelist_item
                                                  |
                                        courtsearch/matching.py
                                          case -> identity -> keys
                                                  |
                                        /api/causelist/my-listings --> "Your matters
                                        /api/causelist/my-forums         today" banner
                                        display-board yourItem           + My Forums tab
                                                                         + Your Item column
```

### Coverage, and why it is uneven

| Court | Cause list | Note |
|-------|-----------|------|
| Supreme Court | yes | PDFs published openly at `api.sci.gov.in/jonew/cl/<date>/<code>.pdf` |
| Kerala HC | investigated, not built | No CAPTCHA; per-courtroom PDFs, text-extractable |
| Madras HC (Chennai / Madurai) | blocked | **Every** access path is CAPTCHA-gated — all six search modes *and* the whole-list download. Not an effort problem; needs permission or an official feed. |

Verified against the live display board on the day this was written: SCI 3/3 and
Kerala 2/2 exact agreement between a cause-list item number and the board's.

### Ingest — `manage.py sync_causelist`

- `--court sci --date yyyy-mm-dd --days N`
- **Replaces** a day's rows rather than merging. Courts revise lists during the
  day, and a stale row surviving a re-fetch would put a client at the wrong
  position. Replacing also makes re-running safe at any time.
- Stores **DAILY** rows only. SCI also publishes an ADVANCE list explicitly
  headed *"matters which are LIKELY to be listed"* — an item number from a
  forecast is worse than none, so it is tagged and excluded.
- **Slow: ~47s** (several multi-MB PDFs). Never call it from a request;
  `COURT_API_CAUSELIST_TIMEOUT` defaults to 300s for this reason.
- **Not yet on a schedule** — needs a morning task, after the court publishes.
  See `NEXT_STEPS.md` §1.1; without it these features have no data.

### Storage — `causelist_item` (Django-managed, `courtsearch/0003`)

One row per listed matter: `court`, `list_date`, `court_number` (`1`–`16`, or
`R1` for a Registrar's court), `item_number` (`35`, `35.1`), `case_string`,
the normalised join key, `diary_number`, `list_type`, `source`.

### Matching — `courtsearch/matching.py`

The hard part is not scraping, it is that the same matter is written three ways:

```
cause list      "SLP(C) No. 014217 / 2025"
display board   "SLP(C) No. 23953/2026"
our own record  "SLP(C) /14217/2025"       (eCourts registration format)
```

All three reduce to `(TYPE, number, year)`. Notes that cost real debugging time:

- **`cases.case_number` is the wrong column to match on.** For imported cases it
  usually holds the **CNR** (`SCIN010147042025`), which no cause list ever prints.
  Identifiers come from `courtsearch_imported_record.raw` instead.
- **A matter carries several identities.** SCI packs its whole history into one
  string, and lists a case under its **diary number** before registration and its
  case number after — 39% of one day's SCI list was diary-numbered. Case 37
  resolves to three keys: `(DIARY, 14704, 2025)`, `(CA, 5640, 2026)`,
  `(SLP(C), 14217, 2025)`.
- **Diary numbers use a hyphen** (`Diary No. 11682-2026`), not a slash.
- **The bench comes free from the CNR prefix** (`CNR_COURT`: `SCIN01 -> sci`,
  `HCMA01 -> chennai`, `HCMD01 -> madurai`, `KLHC01 -> kochi`), so nothing needs
  configuring per case.
- `normalise_case` is **duplicated across the service boundary** — the scraper
  normalises on ingest, the backend normalises our cases to look them up, and the
  two cannot share code. `courtsearch/tests.py` pins the shared examples. If they
  drift, every "Your Item" silently comes back empty, which looks exactly like
  "nothing of yours is listed".
- `identities_for()` resolves a whole practice in two queries; `case_identity()`
  is the single-case form.

### Endpoints (JWT-gated)

| Endpoint | Reads | Speed |
|----------|-------|-------|
| `GET /api/causelist/my-forums` | stored | instant |
| `GET /api/causelist/my-listings?date=` | stored | ~0.5s |

Both read **only** stored data — no scraper call — so they work even when the
scraper is down. `my-listings` also returns `coveredCourts`, which lets the UI
distinguish "nothing of yours is listed" from "no cause list collected for that
court yet". Those need different wording.

### Frontend

`src/pages/DisplayBoard.jsx`:

- **"Your matters today"** banner above everything — the only part of the page
  specific to the practice. Clicking a row opens that court's board.
- **My Forums / All Forums** tabs. My Forums is *derived* from each case's CNR,
  not configured, and collapses 26 courts to the few that matter.
- **`Your Item`** column, adjacent to `Item` so the two read against each other.

---

## 3. Case Lookup (external scraper microservice)

Official case status comes from a **standalone FastAPI scraper** (`C:\Users\ANILA\scrap`, see its
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

## 4. Operations

### Running the scraper microservice

```powershell
cd C:\Users\ANILA\scrap
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
(`requirements.txt` in the scraper repo, incl. `pytesseract`, `pdfplumber`, `fastapi`, `uvicorn`).

---

## 5. Security

- All `courtsearch` and `workspace` endpoints are JWT-gated (`RequirePermission()`).
- The scraper service is **never** exposed to browsers; only Django calls it, server-to-server.
- If the scraper is deployed on a separate host/network, add an API key or network ACL in
  front of it and set `COURT_API_BASE` accordingly.
```
