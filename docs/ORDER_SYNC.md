# Court order sync

New orders and judgments on imported cases come into PactPro by themselves: saved to the case, shown as
**New**, and announced to the advocate's team and the client.

## When it runs

The **PactPro Order Sync** task (`manage.py run_order_sync`, kept alive by `tools\keepalive.ps1`, log
`logs\OrderSync.log`) runs a round:

- every **30 minutes, Monday to Saturday, 10:00 to 18:00**;
- once more at **19:30**, for orders the courts upload after hours.

A round re-reads imported cases' court records through the scraper (`courtsearch/refresh.py`, the same
code as the case page's **Refresh**). It is built to grow with the number of firms:

- **One fetch per court case.** Cases are grouped by their court identity (CNR for eCourts, diary number for
  the Supreme Court; `order_sync.court_identity`). When several firms, teams or imports track the same court
  case, it is fetched once and every one of them is updated and told.
- **A few at a time.** `ORDER_SYNC_WORKERS` (default **3**) court cases are fetched in parallel, each with a
  short pause after it. Raise it slowly: the court sites rate-limit, and one scraper serves every firm.
- **Only what can have news, every round:**
  - cases in **today's cause lists** go first (their orders are the likeliest today), then the cases
    checked longest ago;
  - **quiet** cases (no hearing within two weeks either side, not listed today, no new order for a month)
    are checked **once a day**;
  - **disposed** cases (status Closed / Disposed / Decided) once a **week**;
  - cases of a **suspended firm**, or (in firm mode) a firm whose subscription is read-only (expired,
    cancelled, suspended, pending), are **skipped**.

A round stops starting new cases after 25 minutes; the rest go first next time. If the scraper is down,
the round ends early and the next one tries again. A District Court case takes about 20 seconds on its
own; with 3 workers a round of 8 took 72 seconds. A court error on one case (`last_error` on its
`courtsearch_order_sync` row) doesn't stop the others.

It is its own process, not part of `run_scheduler`, so a slow court never holds up reminders and emails.

## What happens with a new order

`courtsearch/orders.py` reads the orders out of each court's record (eCourts High Court, eCourts District
Court, Supreme Court), each with a stable key. `courtsearch/order_sync.py` compares them with the ones
already known for the case (`courtsearch_order_sync`, `CaseOrderSync.known_keys`). For each new order:

- **PDF saved:** fetched (scraper, or the Supreme Court's public link) and saved to the case's Documents as
  category **Order**, shared with the client (`client_visible`). Shown in the case's **Orders** tab under
  *Saved orders*. Saved once per order (`external_ref = court-order:<case>:<key>`). If the court has no
  PDF yet, or it can't be fetched, the alert still goes out.
- **Team:** one in-app alert to the case's advocate and their team (people with case alerts), plus email by
  each person's own email setting: type `COURT_ORDER_NEW`, *"New order - W.P. No. …"*. Once per person.
- **Client:** one email (which also shows in the client portal's Messages), when the client has an email
  address and client emails aren't switched off.
- **Case page:** the Orders tab shows *New from the court: …* and a **New** chip on that order for a week,
  and when the court record was last checked.

When the court record first shows the case **disposed**, the decision goes to **Appeal Alerts**
(`docs/APPEALS.md`); after the 19:30 round, the evening appeal watch runs.

The **first look** at a case only records the orders already there: no alerts or PDFs for old orders. The
page's **Refresh** runs the same check, so an order found by hand is saved and announced too.

## Offline cases (entered by hand)

A case entered by hand is monitored as soon as it is linked to its court record
(`courtsearch/linking.py`); from then on it is an imported case like any other.

- **Link to court record** (case page → Actions, or the **Not monitored · Link to court** mark next to the
  status): find it by **CNR** (District / High Court) or by **diary number and year** (Supreme Court; that
  site can take a minute or two). The dialog shows what was found (court, case number, parties, status);
  **Link this record** then adds the court record, the parties not already on the case and the upcoming
  hearings (the client and team are told of each, as on an import), and remembers the orders already there
  (no alerts for old ones). Notes, tasks, documents and bills stay. `POST /api/courtsearch/cases/<id>/link`
  `{cnr}` or `{diaryNo, diaryYear}`, then the same with `confirm: true`; 404 when the courts have no such case,
  409 when the case is linked already. Needs `CASE_EDIT`; another team's case is a 404.
- **Linked automatically:** each sync round first tries offline cases that have a **CNR** on their profile
  but no court record (not non-litigation, not disposed, firm running), each at most **once a day**, up to 10
  a round. A case the courts don't know yet (a CNR typed early, a new filing) is simply tried again the next
  day; the reason is kept in `courtsearch_order_sync.last_error`.
- **Not monitored:** the case header shows a **Not monitored · Link to court** mark (or *Linking by CNR…* when
  a CNR is saved and the sync will try it) on litigation / not-yet-filed cases with no court record, unless
  closed. Non-litigation matters never show it.
- Forums the scraper has no source for (tribunals such as NCLT, DRT, consumer commissions and RERA,
  arbitration) can't be linked; they stay manual.

## Commands

```bat
venv\Scripts\python.exe manage.py run_order_sync              REM the timer (the task runs this)
venv\Scripts\python.exe manage.py run_order_sync --now        REM one round straight away, then the timer
venv\Scripts\python.exe manage.py sync_case_orders            REM one round now
venv\Scripts\python.exe manage.py sync_case_orders --case 116 REM one case (testing)
venv\Scripts\python.exe manage.py job_status                  REM rounds: checked / new orders / failed
```

`tools\install-services.ps1` registers the task with the others (`-Status` shows it). `run-project.bat`
starts it in a window when it isn't already running.

## Limits

- Only cases with a court record are checked: imported ones, and offline ones once linked (above).
- "Within 30 minutes" means within 30 minutes of the court publishing the order, in the hours above; the
  courts often upload orders in the evening or the next day.
- Migrations: `courtsearch/0005_order_sync` (the table), `0006_court_order_notification_type` (widens the
  notification tables' type CHECK constraint), `0007_link_tried_at` (daily linking attempts).
