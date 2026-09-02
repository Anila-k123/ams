# Next Steps

Outstanding work, written to be picked up cold. Each item says *why* it matters
and where the code is, because the reason is usually the part that gets lost.

Companion docs: `ARCHITECTURE.md` (court-data design), `LOCAL_DEVELOPMENT.md`
(running it locally).

---

## 1. Blocking — the cause-list feature has no data without this

### 1.1 Schedule `sync_causelist`

Nothing runs it. Until it does, "Your matters today" and the `Your Item` column
are permanently empty — **and empty looks exactly like broken**, which cost real
time to diagnose more than once.

Register a Task Scheduler entry alongside the existing `AMS *` tasks (see
`Advocate-app-BE-Django/scripts/`), firing each morning **after the court
publishes** — around 06:30 is safe for SCI:

```bat
venv\Scripts\python.exe manage.py sync_causelist --court sci --days 2
```

`--days 2` keeps tomorrow ready, since courts publish a day or two ahead. Write a
`scripts/sync_causelist.bat` modelled on `process_notifications.bat` (same quiet
logging pattern) so it fits the existing set.

**Depends on the scraper being up** (port 8000) — the fetch takes ~47s.

### 1.2 Remove the synthetic demo rows

Two rows were inserted so the banner would render while nothing real was listed:

```bat
venv\Scripts\python.exe manage.py shell -c "from courtsearch.models import CauseListItem; print(CauseListItem.objects.filter(source='UIPROOF').delete())"
```

The next `sync_causelist` replaces the day's rows and wipes them anyway.

---

## 2. Asked for, not yet built

### 2.1 Dashboard widget — "listed today"

Surface the same information on the Dashboard so it is seen at login without
opening Display Board. The endpoint already exists and needs no new backend
work: `GET /api/causelist/my-listings` (reads stored rows, ~0.5s, no scraper).
Reuse the `ListedToday` component from `src/pages/DisplayBoard.jsx`.

### 2.2 Notification when your item is near

"Your matter is 3 items away." This is the feature that makes the whole cause-list
effort pay off, and it is the **hardest remaining piece**, because it needs
something that does not exist yet: *repeated* reading of the live display board
through the sitting day.

Think through before building:

- **Polling load.** Boards are currently fetched on demand and cached an hour.
  Polling every few minutes, per court, for every practice, is a different order
  of traffic against a government server. Poll once per court and fan out to
  subscribers; never poll per user.
- **Only while it matters.** Poll a courtroom only when someone has a matter
  listed there and it has not yet been called — outside sitting hours, not at all.
- **Fire once.** `notifications/events.py` shows the established pattern for
  idempotent producers (`_already_notified`), which exists precisely so a
  scheduler firing every few minutes does not send the same alert dozens of times.
- Delivery is solved — queue it through `notifications/service.notify()`.

---

## 3. Cause-list coverage

Only `sci` has a source today. Coverage is per court and each one is its own
small project; there is no "build once, get them all".

### 3.1 Kerala High Court — feasible, not built

Investigated and confirmed workable:

- No CAPTCHA anywhere in the path.
- Index: `POST https://hckinfo.keralacourts.in/digicourt/index.php/Casedetailssearch/clistbyDate`
  with `clist_date=DD-MM-YYYY`, returning an HTML table of per-courtroom PDFs
  (39 on the day checked), each tagged with bench, room, list type and time.
- PDFs are text, not scans. On a sample: **126 of 126 items parsed**.
- **Cross-checked against the live board: 2/2 exact** (room 1A item 29, room 1B
  item 38).
- The PDFs also carry advocate names, and there is a
  `Casedetailssearch/Advocatesearch` endpoint — a possible second matching route
  if case-number matching ever misses.

Add as a provider in the scraper's `causelist.py` (`PROVIDERS`), mirroring
`fetch_sci`. `KLHC01` already maps to `kochi` in `courtsearch/matching.CNR_COURT`.

### 3.2 Madras High Court — blocked, needs a decision

**7 of the 9 court-linked cases here are Madras**, so this is the court that
matters most and the one that is shut.

Every access path on `hcmadras.tn.gov.in` is CAPTCHA-gated — all six search modes
(court no, judge, AOR, advocate name, case no, party name) *and* the whole-list
download. It is an image CAPTCHA with an audio fallback, and the PDFs render
client-side only after a successful submit. There is no public PDF directory.

Options, in order of preference:

1. **Ask the Registry** for bulk or API access to the cause list. Slow, but it is
   the only route that stays stable.
2. **Test whether `hcservices.ecourts.gov.in` carries Madras cause lists.**
   *Unresolved experiment* — a plain GET returns 403; it needs the session
   warm-up that `hc_case_status.py` already performs. This is a day's work and
   decides whether Madras is a week or a standing burden. **Do this before
   anything else on Madras.**
3. **Manual item entry** for Madras matters — unsatisfying but honest.

Note for the decision: this codebase **already** solves eCourts `securimage`
CAPTCHAs with Tesseract OCR (`hc_case_status.py`, `ecourts_case_status.py`), so
the precedent exists. But that use is user-initiated, one case at a time. A
nightly bulk pull is unattended, high-volume and repeats daily from one IP —
which is the shape that gets blocked. If that route is taken, rate-limit it and
run off-peak.

### 3.3 TN district courts — only half the feature

Cause lists are probably reachable via the district eCourts portal (already
OCR'd here). But **no district court display board exists** — none of the
scraper's 26 providers is a district court. So there would be a `Your Item` with
no `Item` beside it to compare against. Worth knowing before scoping it in.

---

## 4. Data quality — why nothing matched during development

The join was proved by unit tests and a synthetic row, never by a live listing.
That gap is data, not code.

| | |
|---|---|
| Active cases | 37 |
| Demo seed (`DEMO-1-100xx`) | 21 |
| Real | 16 |
| Mapped to a court | **9** (chennai 5, madurai 2, kochi 1, sci 1) |
| Not `Closed` | **0** of those 9 |

Every court-linked case is closed, and the four genuinely active cases are all
**district courts**, which have no board. So the correct output today is an empty
column — indistinguishable from a bug.

**To validate for real:** import one live, pending Supreme Court matter and watch
it on a hearing morning. Cheapest alternative: take a case actually on today's SCI
list, import it properly, and the banner should light up immediately — a ten-minute
end-to-end test of the whole path.

Also worth clearing out the 21 demo cases at some point; they dilute every
count and every list.

### Cases with no join keys

Cases 22 and 23 were hand-entered with a CNR in `case_number` and have no
imported court record, so there is nothing to match on (`case_identity` returns
an empty key set — correctly, since guessing would be worse). Re-import them
through the court lookup to populate `courtsearch_imported_record`.

---

## 5. Known debt

### 5.1 Root `README.md` is for a system that no longer exists

It describes **Java 21 · Spring Boot 3.5 · MySQL** — 24 Spring/Maven references,
zero mentions of Django or PostgreSQL. It was left untouched deliberately:
bolting new features onto a document describing the wrong stack would make it
worse. It needs its own rewrite.

### 5.2 The scraper has no supervision

`C:\Users\ANILA\scrap` is started by hand and nothing restarts it. **It died once
unnoticed during development**, which silently disabled display boards, Daily
Status, case import and cause lists — the backend returned a clean 503 the whole
time. Options: a Task Scheduler entry at logon with restart-on-failure, or run it
as a service (NSSM). `run-project.bat` now launches it, which helps only if that
is how it gets started.

### 5.3 Node is below Vite's minimum

Node 20.13.1 installed; Vite 7 requires 20.19+ or 22.12+. `npm run dev` works
with a warning on every start; `npm run build` is the risk.

### 5.4 Cache is per-process

Django uses the default `LocMemCache`, which is not shared between workers. With
more than one worker, board and lookup caches diverge and TTLs are inconsistent.
Redis before any multi-worker deployment.

### 5.5 Dead code

`src/components/Toast.jsx` and `src/assets/styles/Toast.css` are unreachable —
nothing imports `Toast.jsx`, and it is the only thing referencing the stylesheet.
`GlobalToast.jsx` was rewritten to depend on neither. Safe to delete.

### 5.6 Pre-existing lint errors

`npm run lint` reports ~50 errors repo-wide (mostly unused `err` bindings in
catch blocks). None were introduced by recent work — the baseline was 52 and is
now 50 — but the noise makes lint useless as a gate. Worth one clean-up pass.

### 5.7 `SECRET_KEY` is still the dev default

`.env` carries `django-insecure-...`. Fine locally, must be replaced before this
is exposed to anything real. `OTP_SALT` is blank and falls back to `SECRET_KEY`,
so rotating the key also rotates OTP hashing.

---

## 6. Smaller items

- **"Raise Invoice" in the hearing-history rows ignores the row.** Every button
  opens the same blank modal (`CaseDetail.jsx`), so the per-row placement implies
  a link to that hearing that does not exist. Either pass the hearing context or
  move the button out of the row.
- **Payments still exist in the API and database** (`client_payments`,
  `/api/payments/*`, and the totals `totalPaymentsReceived` / `paymentCount`)
  although the workspace tab was removed. The Expenses page still reads and
  creates them. Decide whether to retire them properly or fold the received-money
  figures into the Expenses tab's summary cards.
- **Client notifications only fire on creation.** No email on update or delete —
  deliberate, since one per field edit would train clients to ignore them. If
  reschedules should notify, `HEARING_RESCHEDULED` already exists as an event
  type in `notifications/service.EVENT_TYPES`.
- **Expenses deliberately do not notify the client** — they are the practice's own
  costs and would expose an internal ledger. If wanted, gate it on the expense
  being client-billable rather than sending for all.
- **Immediate client mail costs ~5.5s per action** (Gmail SMTP, measured on
  invoice create). If that becomes annoying: a persistent SMTP connection, or
  revert the slower actions to queued-only delivery.
- **`window.__toast`** is a `import.meta.env.DEV`-only debug hook in
  `ToastContext.jsx`. It vanishes from production builds; remove it if unwanted.
