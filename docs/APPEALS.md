# Appeal Alerts

When a case is decided, PactPro works out what it means for an appeal and puts it on the **Appeal Alerts**
page (sidebar → Appeal Alerts). The advocate and their team are alerted in-app; **the client is never told**
(what to say about an appeal is the advocate's call). No limitation date is calculated yet: periods differ by
subject, forum and who appeals, so that is separate work, to be reviewed by an advocate.

## Where decisions come from

The order sync (`docs/ORDER_SYNC.md`), and the case page's **Refresh**, re-read each case's court record.
When the record first shows the case **disposed**, `appeals/decisions.py` (`record_decision`):

1. reads the decision date and the court's own wording (`Nature of Disposal`, via `appeals/detection.py`);
2. turns the wording into **who won** (`outcome_of`):

   | Court's wording | Outcome |
   |---|---|
   | Allowed, Decreed, Granted, Final decree passed, Convicted | the petitioner / plaintiff side won |
   | Dismissed, Rejected, Acquitted, Discharged | the respondent / defendant side won |
   | Partly allowed | partly |
   | Withdrawn, Settled, Compromise, Satisfaction recorded, Closed, Infructuous | no appeal (nothing contested) |
   | Disposed of, Leave granted & disposed off, anything else | unclear |

3. works out **our client's side**: the case profile (*Our client is the …*), else the client's name among the
   case's parties, else among the court record's parties. If both sides match, or neither, it is unknown;
4. files the case (`appeal_case_decision`, one row per case) and alerts the advocate and team (case-alert
   holders):

| Our client | Section on Appeal Alerts | Alert |
|---|---|---|
| lost (or partly) | **You can appeal**: *We will appeal* / *No appeal* | `APPEAL_POSSIBLE` *Appeal possible - …* |
| won (or partly) | **The other side may appeal**: watched every evening; *Stop watching* | `APPEAL_WATCH` *The other side may appeal - …* |
| unclear wording, or side unknown | **Needs a look**: *Our client is the Petitioner / Respondent* (saved on the case profile, never asked again), or *We will appeal* / *No appeal* | `APPEAL_POSSIBLE` *Case decided - …* |
| withdrawn / settled / satisfied | not listed | none |

Each row shows the decision date, the court's words, and the **usual next forum** (from a District Court: the
High Court, or the District Court for smaller suits and criminal appeals; from a High Court: a Division Bench
by writ / Letters Patent appeal, or the Supreme Court by SLP; from the Supreme Court: a review petition). The
*Limitation* column says *Coming soon*.

**Old decisions:** a decision older than a year is past any appeal and isn't listed. One between 45 days and a
year old, seen for the first time (a case imported or linked after its judgment), is listed without an alert.
`manage.py backfill_decisions` (deploy step, safe to repeat) lists the last year's decisions quietly.

## Appeals found (the evening appeal watch)

After the 19:30 order-sync round, `run_order_sync` runs `scan_appeals --watching --limit 25`: for each case
decided for our client in the last ~13 months and still watched, it searches the next court up (High Court or
Supreme Court) by party name for an appeal filed after the judgment (`appeals/appeal_scan.py`). A match is a
**candidate** under **Appeals found** (*It's an appeal* / *Not related*), with an in-app and email alert; the
row's *Appeal watch* shows when it was last checked. `scan_appeals` without `--watching` still sweeps every
decided case (by hand).

## API

- `GET /api/appeal-decisions`: the practice's decisions with `position` (`lost` / `won` / `partly` / `look` /
  `none`), status, next forum, last watched.
- `PATCH /api/appeal-decisions/<id>` `{status}` (`open`, `appealing`, `no_appeal`, `watching`,
  `watch_stopped`) or `{ourSide: petitioner | respondent}`. Needs `CASE_EDIT`; another team's is a 404.
- `GET /api/appeal-detections`, `PUT /api/appeal-detections/<id>`: appeals found (unchanged).

Migrations: `appeals/0004_case_decision`, `0005_appeal_notification_types` (widens the notification tables'
type CHECK constraint).
