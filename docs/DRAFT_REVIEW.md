# Draft review: suggestions, accept / reject, request review

Status: phases 1–5 done; **revision (2026-10-08): in task reviews, comments replace suggestions** — all 4 steps done (backend; Suggest removed from tasks, queries become comments; the comment screens; demo and test story). See *Comments* below.
Builds on versions and the on-screen compare view ([DRAFT_EXPORT.md](DRAFT_EXPORT.md)).

## The rule

> **Whoever has authority over the draft decides. Everyone else can only suggest.**

| # | Situation | Started from | Reviewer | Reviewer can | Who accepts / rejects |
|---|---|---|---|---|---|
| 1 | Senior delegates to a junior | Task | The task's assigner | **Correct** (binding) + **suggest** | Junior: accepts or declines suggestions (decline needs a reason). Senior: accepts / rejects the junior's changes on each resubmission, then Approves. |
| 2 | Junior drafts alone, asks their senior | Common drafting → **Request review** | The junior's senior | Correct + suggest | Same as 1 |
| 3 | Senior drafts, asks a junior to proofread | Common drafting → Request review | A junior | **Suggest only** | The senior (the draft's owner) |
| 4 | Peers | Common drafting → Request review | A colleague at the same level | Suggest only | The author |
| 5 | Author alone | Either | — | — | Nothing to decide; edits apply, versions keep history |

**Who counts as senior over an author** (`drafting/authority.py`): the head of the author's team
(the practice root, `parent_advocate_id` NULL), or anyone in the same team who holds **TASK_ASSIGN**.
Never someone outside the team (`core.practice.practice_ids`).

**Who may edit directly:** the owner, and a reviewer with authority while the review is open.
A reviewer without authority is locked to **Suggest**.

## What a "change" is

A change is one entry of the compare view's change list: one changed paragraph (word changes inside it,
or a whole paragraph added / removed). Accept / reject works per change, plus Accept all / Reject all.
Word-by-word accept inside one paragraph is a later refinement.

## Two kinds of review round

Both reuse the comparison engine (`export/compare.py`) and the compare view.

| Round | Base → target | Accept means | Reject / decline means |
|---|---|---|---|
| **Suggestions** (not applied yet) | current draft → proposed text | Apply the paragraph's new text | Keep the current text (a reason is required) |
| **Changes to review** (already applied: a junior's resubmission, situation 1–2) | last submitted version → current draft | Keep it | Put the paragraph's old text back |

A version is saved when a round is finished, so the history shows every decision's result.

## Data (managed tables, schema `drf`)

- **`DraftReviewRequest`** (common drafts only; task drafts use the task's review state):
  draft, requested by, reviewer, note, `authority` (`binding` / `suggest`), status (open / done / cancelled), times.
- **`DraftReviewRound`**: draft, kind (`suggestions` / `changes`), author of the changes, who decides,
  `base_blocks` and `target_blocks` (frozen snapshots, like versions), status (open / finished), times.
- **`DraftChangeDecision`**: round, `change_id` (the change's number in the round's comparison, 1..n),
  decision (`accepted` / `declined` / `rejected` / `queried` / `acknowledged`), reason or comment, by whom, when.
  The frozen snapshots keep each change's number stable while the round is open.

Applying decisions rebuilds each touched clause from its paragraphs (base or target per decision); this
needs a paragraph → HTML writer next to `html_to_blocks` (bold / italic / underline / strike, headings,
alignment, lists).

**Outdated changes:** if the paragraph a pending change touches is edited in the draft afterwards, that change
is marked *outdated* (it no longer applies cleanly) and is never applied blindly. Edits to other paragraphs
don't affect it.

## Screens

- **Editor, reviewer:** a switch **Edit | Suggest**. Suggest-only reviewers are locked to Suggest. Saving in
  Suggest mode creates a suggestions round instead of changing the draft; the editor shows the draft
  unchanged, with a note *"3 suggestions waiting for <owner>"*.
- **Review changes** (the compare view with decisions):
  - each change shows **who · when · Correction / Suggestion / Change**;
  - ✓ **Accept** / ✗ **Decline** (reason required) on suggestions; ✓ **Keep** / ✗ **Reject** on a junior's changes;
    💬 **Query** on a senior's binding corrections (a comment, not a rejection);
  - **Accept all / Reject all**, a counter *"5 to decide"*, and **Finish review**, which asks first (*Finish this review?*:
    the counts, what will happen, "can't be undone") because a finished round is final; the draft before it stays in Versions.
  - After a decision only its result shows, with a **Change** link (the choices come back only on Change).
- **Approve** (task) and **Done reviewing** (request) stay disabled while anything is pending.
- **Common drafts:** a **Request review** button (pick a colleague from the team, add a note). The reviewer gets
  a notification and the draft appears under **Drafts → For my review**. **Done reviewing** hands it back.
  The author can **cancel** an open request.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `draft-sessions/<id>/reviewers/` | Colleagues in the owner's team who could review, each with `binding` / `suggest` |
| POST | `draft-sessions/<id>/review-requests/` | Request review `{reviewer, note}` |
| GET | `draft-sessions/<id>/review-requests/` | Open / past requests |
| POST | `review-requests/<id>/done/` · `…/cancel/` | Reviewer done / author cancels |
| GET | `drafts/for-review/` | Drafts waiting for me |
| POST | `draft-sessions/<id>/suggest/` | Save editor content as a suggestions round |
| GET | `draft-sessions/<id>/rounds/` · `rounds/<id>/` | Rounds, with the comparison and decisions |
| POST | `rounds/<id>/decide/` | `{change, decision, reason}` (or `all`) |
| POST | `rounds/<id>/finish/` | Apply decisions, save a version, close the round |
| POST | `rounds/<id>/cancel/` | The author withdraws open suggestions |

All gated by `drafting/access.py` (who may see / decide) and `RequirePermission('DRAFT_VIEW' / 'DRAFT_CREATE')`.

## Phase 1: what exists (backend)

| Piece | File |
|---|---|
| Authority rule (`is_senior_over`) | `drafting/authority.py` |
| Tables `draft_review_request`, `draft_review_round`, `draft_change_decision`; version kind `review` | `drafting/models.py`, migration `0005_review_rounds` |
| Access: requested reviewers can read the draft; `can_write` (owner, task reviewer while submitted, binding requested reviewer); `can_suggest` (any open reviewer, never the owner) | `drafting/access.py` |
| Rounds: create suggestions / changes rounds, decide (with the allowed choices and required reasons), outdated clauses, finish (apply, save a *Review: …* version), withdraw | `drafting/review.py` |
| Paragraphs back to editor HTML (for clauses with mixed decisions) | `drafting/export/htmlwrite.py` |
| Engine keeps each changed paragraph's old / new text | `drafting/export/compare.py` |
| API views | `drafting/review_views.py`, `drafting/urls.py` |
| Tests (authority, HTML round trip, suggest → decide → finish, mixed decisions, accept-all keeps HTML, outdated, formatting-only refused, permissions, withdraw, changes round reject, binding query) | `drafting/tests.py` |

Rules enforced on the server: "all" only fills in changes not decided yet (never overwrites one);
only the round's decider decides or finishes; a decline or a query needs a
text; a binding round only takes *acknowledged* / *queried*; finishing a non-binding round needs every
non-outdated change decided; suggestions that change only formatting are refused; the owner can't suggest
on their own draft.

Known limit: a clause with mixed decisions is rebuilt from its paragraphs, so a table inside it comes back
as tab-separated lines. Clauses where every change got the same answer keep their exact HTML.

## Phase 2: what exists (screens)

- **Draft page, reviewer:** a reviewer who may also edit directly gets a **Suggest** toggle; a suggest-only
  reviewer can only suggest. While suggesting, a note says the draft won't change
  until the owner decides, and **Save** becomes **Send suggestions**. Other actions that save first (Compare,
  downloads, Versions) ask to send the suggestions first.
- **Draft page, everyone:** a banner per open round: *Suggestions from Rajesh Kumar · 2 of 2 to decide*
  with **Review** for the person it waits for, *waiting for Priya Nair* with **View** for others.
- **Review view** (`components/ReviewRoundView.tsx`, sharing `compareParts.tsx` with Compare): the changes
  marked as in Compare, a change list with each decision, ◀ ▶, and under every change the allowed buttons:
  **Accept / Decline** (suggestions), **Keep / Reject** (changes), **OK / Query** (binding corrections).
  Decline and Query open a small box for the reason. **Accept all / Decline all**, *n of N decided*,
  **Finish review** (enabled when everything is decided), **Withdraw** for the author, **Close**.
  An *Outdated* tag replaces the buttons where the draft moved on.
- The draft page now reads its rights from `session.access` (`DraftSessionSerializer.get_access`), so a
  reviewer who came through a review request is no longer treated as the owner.

## Phase 3: the task loop (`drafting/task_review.py`)

| Moment | What happens |
|---|---|
| Senior suggests while reviewing | A suggestions round for the junior (phase 2). |
| Senior clicks **Request changes** | The draft is saved as a **Sent back for changes** version (kind `returned`). The senior's corrections since the junior's last submission become a **binding** round for the junior: **OK / Query** only, never undone. |
| Junior clicks **Submit to task** | Refused while the senior's suggestions still wait for the junior (*"Accept or decline the suggestions first"*). The junior's open binding round is closed (acknowledgements and queries are kept). After filing, everything the junior changed since *Sent back* becomes a **Keep / Reject** round for the task's reviewer. A newer resubmission replaces an older open one. |
| Senior opens the resubmitted draft | Banner *Changes by Priya Nair · n of N to decide* → **Review**; and, if the junior queried corrections, *Priya Nair queried 1 of your corrections: "…"* → **View**. |
| Senior clicks **Approve** | Refused while a round waits for the senior, or while the senior's own suggestions are undecided (server: `ReviewTaskView` + `task_review.approve_blockers`; the button is disabled with a hint). |

**Applying decisions works paragraph by paragraph on the draft as it is now** (`drafting/review_apply.py`):
a change is *outdated* only if the paragraph it touches changed since the round was made. Edits elsewhere,
even in the same clause (a whole deed is often one clause), don't block it. When every change in a clause
got the same decision and the clause wasn't touched since, the other side's HTML is used exactly.

## Phase 4: Request review (`drafting/review_requests.py`)

| Who | Where | What |
|---|---|---|
| Owner of a draft **without a task** | Top bar **Request review** | Pick a colleague of the same team (a senior is marked *can correct*, from the authority rule), add a note, **Send request**. A version **Sent for review to …** is saved; the colleague gets a bell notification (`DRAFT_REVIEW_REQUESTED`; clicking it opens the draft — review, done and comment notifications all link to `/draft/<id>`. They are delivered by the scheduler, so on the dev instance run `manage.py process_notifications` to see them). A banner shows *Review requested from … · waiting* with **Cancel request**. Task drafts are refused (they use Submit to task). |
| Reviewer | **Drafts → For my review** panel | Lists drafts waiting for them, with who asked, when, their power and the note, and a progress line: *Not started*, or *N sets of changes sent* with *Waiting for Rajesh* and/or *Rajesh decided: 2 accepted, 1 declined*. **Review** opens the draft. |
| Owner | **Drafts** list, Status column | A review chip next to the draft's status (`drafts/review-status/`): *With Priya for review*, *Priya's changes to decide* (a round is waiting for the owner), or *Reviewed by Priya* (the last request is done). |
| Author of suggestions / corrections | Draft page, **Activity** tab | Under *History*: *Rajesh Kumar decided your suggestions: 1 accepted, 1 declined* → **View** opens the round read-only, each change marked with the decision and the reason. The tab shows a badge until it is opened. |
| Both sides, while a review is open | Draft page | Every 30 s (tab visible) the page re-reads the draft and the rounds. If the text changed since it was opened, an **Updated · Reload** chip appears in the top bar (asks first when there are unsaved edits). It never reloads by itself. Not live co-editing. |
| Author of suggestions / corrections | Bell | When the decider finishes a round, its author gets *Your suggestions were decided: …* with the counts (`DRAFT_REVIEW_DONE`). |
| Reviewer | Draft page | A banner: *Priya Nair asked you to review this draft: you can correct it directly and suggest changes* (or just *… asked you to review this draft.*), with **Done reviewing**. A senior gets Edit + the **Suggest** toggle; anyone else gets suggest mode only. |
| Reviewer | **Done reviewing** | Closes the request (the reviewer can still read, no longer edit), notifies the owner (`DRAFT_REVIEW_DONE`). A senior's direct corrections since *Sent for review* come back as an **OK / Query** round. |
| Owner | **Cancel request** | Closes it; the reviewer loses access and their open suggestions are withdrawn. |

The two notification types needed widening the live CHECK constraint on `notification_queue` /
`notification_history` (migration `0007_review_notification_types`, which reads the current list and adds to it).

## Revision: comments instead of suggestions in task reviews

**Why (agreed 2026-10-08):** in a real task review the senior corrects, and when unsure he *asks*
("Did the client agree to rent in advance?"). A junior "declining" a senior's wording doesn't fit the
hierarchy. So in a **task**: the senior corrects (binding) and **comments**; the junior **replies** (or fixes
the text); the senior **resolves**. Suggestions + Accept / Decline stay for **Request review** (a junior
proofreading a senior's draft, peers) and, later, outside markups. The junior's *Query* on a correction
becomes a comment too.

| Step | What | Status |
|---|---|---|
| 1 | Backend: `DraftComment` (thread = top comment + replies; `block_id` + `quote` anchor), API, who may resolve, Approve blocked while any thread is unresolved, `DRAFT_COMMENT` notification, migrations `0008` / `0009`, tests | ✅ done |
| 2 | Remove Suggest from task reviews (`access.can_suggest`: only an open Request review); the junior's **Query** on a correction also opens a comment thread on the corrected words (`review._query_as_comments`), which the senior must resolve before Approve | ✅ done |
| 3 | ✅ Editor: **Comment** button in the top bar (takes the selected words, in Edit or Preview, and their clause), open comments' passages marked in the document (`editor/commentHighlight.ts`), a **Comments** tab in the right panel with the open count (`components/CommentsPanel.tsx`: open threads first, the quoted words jump to the passage, the conversation, Reply, **Resolve** / **Reopen** for whoever may, **Remove** for your own while unanswered; resolved threads folded under *Show n resolved*), a banner *Comments: n open (m answered)* → **View**, and **Approve** disabled while any is open. The old "queried your corrections" banner is gone: queries are comments now | done |
| 4 | ✅ Demo ([DEMO_REDLINE.md](DEMO_REDLINE.md) steps 3–5: the senior comments; the junior replies; the senior resolves) and test story ([REDLINE_TEST_PLAN.md](REDLINE_TEST_PLAN.md) chapters 4–6, IDs K1–K8) | done |

**API (`drafting/comments.py`):**

| Method | Path | Purpose |
|---|---|---|
| GET | `draft-sessions/<id>/comments/` | Threads (oldest first) with replies, plus `open` / `answered` counts |
| POST | `draft-sessions/<id>/comments/` | `{block_id, quote, body}`: start a thread |
| POST | `comments/<id>/reply/` | `{body}` |
| POST | `comments/<id>/resolve/` · `reopen/` | Close / reopen a thread |
| DELETE | `comments/<id>/` | The author removes their own comment while nobody has replied |

**Rules:** anyone who may see the draft may comment and reply. **Resolve**: the person who asked, someone
senior over the draft's author, or the author when the question came from a peer or a junior (so a junior
can't close her senior's question). In a task, **Approve** is refused while any thread is unresolved.
Notifications (`DRAFT_COMMENT`, in-app) go to the draft's author, the thread's participants and the task's
reviewer, never to the person who wrote it.

## Build order

| Phase | What | Size |
|---|---|---|
| 1 | ✅ Backend core: authority rule, the three tables + migration, paragraph → HTML writer, rounds, decide / finish, outdated detection, tests | done |
| 2 | ✅ Suggest mode in the editor; decisions in the review view (Accept / Decline / Keep / Reject / OK / Query, all, counter, Finish, Withdraw) | done |
| 3 | ✅ Task flow (situation 1): binding round of the senior's corrections on Request changes; Keep / Reject round on resubmission; Submit / Approve blocked while pending; queries shown to the senior | done |
| 4 | ✅ Request review for common drafts (situations 2–4): request, notification, *For my review* list, done / cancel | done |
| 5 | ✅ Demo ([DEMO_REDLINE.md](DEMO_REDLINE.md) steps 3–5 and 7) and test story ([REDLINE_TEST_PLAN.md](REDLINE_TEST_PLAN.md) chapters 4–6 and 8, IDs S / T / Q) | done |

Then: who-changed-what attribution in the compare view and in Word redlines (per-save author records),
and importing an outside party's Word file into a suggestions round.

## Where review shows on the draft page

Above the document there is **at most one slim bar**, for the thing to act on now, in this order:

1. changes waiting for my decision: *Suggestions from Priya Nair · 2 of 2 to decide* → **Review**;
2. I was asked to review: *Rajesh Kumar asked you to review · "note"* → **Done reviewing**;
3. my draft is out for review: *With Priya Nair for review* → **Cancel request**.

If there is more than one, the bar shows the first and a **+N more** link to the Activity tab. A task's own
review bar (reviewer) or *Changes requested* / *Approved* notice (author) takes the bar's place.

Everything else lives elsewhere:

| What | Where |
|---|---|
| Open rounds, open requests, decided rounds, finished requests | Right panel → **Activity** tab (*Waiting* and *History*, newest first). Badge = rounds waiting for me + my decided rounds not yet opened (remembered per browser). |
| Suggesting mode | **Suggesting** chip in the top bar; the explanation is its hover hint. |
| Someone else changed the draft | **Updated · Reload** chip in the top bar. |
| Open comments | **Comments** tab, with the count in its label. |

## Case file beside the draft

A draft is checked against its source: names and addresses against the lease or ID papers, amounts
against the ledger, case number and court against the record. So the draft page's left panel shows a
**Case file** section (under Placeholders) whenever the draft is linked to a case: a task draft (the
task's case) or a draft saved to a case (its project's case). Drafts typed from facts and not yet saved
to a case show nothing; linking at creation is not done yet.

- **Summary:** case number and title, court and judge, CNR, next hearing, the client's name, address and
  phone, and the parties (opponents marked). The ↗ button opens the full case in a new tab.
- **Documents:** every document on the case, plus the client's own documents not filed on a case
  (marked *client*), newest first, with a search box past six. Clicking one opens it in the right pane's
  viewer (PDF, Word, images), the same way reference documents open.
- **Rights:** `GET draft-sessions/<id>/case-file/` (`drafting/casefile.py`) only answers for drafts the
  viewer can open, only for a case in their practice scope, the summary only with `CASE_VIEW` and the
  documents only with `DOCUMENT_VIEW`, so nobody sees more here than on the Cases and Documents pages.

## Upgrading an existing install (migrations)

Pulling this work (branch `Developer-1`, and `main` once merged) needs the drafting migrations **0005–0009**
on top of 0004 (draft versions). Run them once per database, with the backend stopped or idle:

```bat
cd Advocate-app-BE-Django
venv\Scripts\python.exe manage.py migrate drafting
venv\Scripts\python.exe manage.py showmigrations drafting   :: 0004 … 0009 all [X]
```

| Migration | What it does |
|---|---|
| `0005_review_rounds` | Tables for review requests, rounds and per-change decisions (`drf.draft_review_request`, `draft_review_round`, `draft_change_decision`). |
| `0006_version_kind_returned` | Adds the `returned` kind to draft versions. |
| `0007_review_notification_types` | Widens the live `notification_queue` / `notification_history` type CHECK constraint with `DRAFT_REVIEW_REQUESTED` and `DRAFT_REVIEW_DONE`. Without it these notifications are silently dropped. |
| `0008_draft_comment` | Table for comment threads (`drf.draft_comment`). |
| `0009_comment_notification_type` | Same constraint widening for `DRAFT_COMMENT`. |

0007 and 0009 read the constraint's current list and add to it, so they are safe on a database that
already has extra types. No data is changed; nothing else (frontend, `.env`) needs a step beyond
`npm install` if dependencies changed. Each database (`PactPro_db` for test, `pactpro_db1` for dev,
production) needs its own `migrate`. Bell notifications are delivered by the scheduler
(`run_scheduler`); on an instance without it, run `manage.py process_notifications`.
