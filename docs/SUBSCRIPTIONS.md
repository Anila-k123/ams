# SaaS subscriptions, entitlements and usage limits (Phase 8)

These are AMS's own plans for firms. They are **separate from the invoices a firm sends its clients** (the `invoices` app). Nothing here charges anyone: there is no payment gateway, and no prices are set.

Code: `Advocate-app-BE-Django/subscriptions/`:
- `catalogue.py`: keys and seed plans;
- `service.py`: checks, metering and lifecycle;
- `plans.py`: plan approval;
- `enforce.py`;
- `views.py`.

## Plans are unapproved until an owner publishes them

The seeded plans (Trial, Basic, Professional and Enterprise) are **examples**. Their limits and features have not been approved by the business, and they have no prices. Migration `subscriptions 0003` marks them **DRAFT**. Legacy is **SYSTEM**.

| Plan state | Meaning | Can be assigned to a firm? |
|------------|---------|----------------------------|
| DRAFT | Example, or being prepared. Only a draft can be edited. | Only a designated test firm, on a test install |
| APPROVED | Terms signed off and fixed. Not offered yet. | Only a designated test firm, on a test install |
| PUBLISHED | Offered to new firms. | Yes |
| RETIRED | No new subscriptions. Firms already on it keep it. | No (firms on it keep working) |
| SYSTEM | Legacy, for firms that used AMS before subscriptions. | Never by an operator |

How a plan moves through these states (`subscriptions/plans.py`):
- **Edit** works on a DRAFT only.
- **Approve** (DRAFT → APPROVED) records who approved it, when, and a reference such as a decision or minute.
- **Publish** (APPROVED → PUBLISHED) records who published it and when.
- **Retire** stops new subscriptions.
- **New revision** copies any non-system plan into a new DRAFT row (`<CODE>_R2`, ...).
- Publishing a revision retires the family's earlier published revision **for new firms only**. Firms are never moved to a new revision automatically.

All of these need operator permission `plan.publish` (platform **OWNER** only) and a reason. Every step is written to the platform audit (`PLAN_EDIT`, `PLAN_APPROVE`, `PLAN_PUBLISH`, `PLAN_RETIRE`, `PLAN_REVISE`). A request that includes a price is refused with 400 `NO_PRICES`.

A plan that is not published, retired or system is enforced as unusable: the refusal is 403 `ENTITLEMENT_PLAN_NOT_PUBLISHED`. A draft is never silently treated as a customer plan, even if it is written straight into the database.

**Test firms.** A firm marked `test_firm` may use DRAFT or APPROVED plans, but only while `SUBSCRIPTION_TEST_PLANS=True`. That setting only takes effect together with `DEBUG`, so it is never on in production. The E2E server turns it on, and E2E firms are created with `testFirm: true`. The flag is set either at provisioning or with the operator actions `mark_test_firm` / `clear_test_firm`.

## Every firm has an explicit subscription

| How the firm was created | Subscription |
|--------------------------|--------------|
| Existed before Phase 8 | LEGACY / ACTIVE (migration 0002, with a history row) |
| `apply_tenancy` (pre-SaaS practices brought into tenancy) | LEGACY / ACTIVE, recorded explicitly. This is the documented migration path. |
| Platform console / `POST /api/platform/firms` with a published `planCode` | That plan (TRIALING if it has trial days, else ACTIVE) |
| The same, without `planCode` | **PENDING**, with no plan: the firm can sign in but add nothing until an operator assigns a published plan |
| The same, with a draft, unknown or Legacy `planCode` | The whole provisioning is refused (409 `PLAN_NOT_PUBLISHED`, 404 `NO_PLAN`, or 409 `PLAN_NOT_ASSIGNABLE`) and nothing is created |
| `manage.py create_firm` | Refused unless `TENANCY_MODE=legacy`. It only builds pre-tenancy teams; with tenancy on, use the platform console. |
| Test fixtures (`core.testing.make_firm`) | LEGACY |

There is no silent trial and no silent Legacy. A firm **without** a subscription row is refused: 403 `ENTITLEMENT_SUBSCRIPTION_MISSING`. Reads keep working.

## Keys

| Key | Kind | Notes |
|-----|------|-------|
| `feature.drafting`, `feature.assistant`, `feature.client_portal`, `feature.document_summary` | feature | on / off |
| `seats.staff` | stock | see the seat policy below |
| `cases.total`, `clients.total` | stock | live (not deleted) rows |
| `storage.bytes` | stock | current files plus kept earlier versions |
| `ai.requests.month` | metered | Lisa chat requests |
| `drafting.operations.month` | metered | Draft create and regenerate; edit, refine, consistency check and risk analysis |
| `ai.summaries.month` | metered | AI document summaries. Counted, with no limit in any seed plan. |

A `null` limit means unlimited. Per-firm `EntitlementOverride` rows (reason required, optional expiry in the future) take precedence over the plan.

## Statuses

The status rules are defined in one place: `service.USABLE`, `READ_ONLY` and `TRANSITIONS`.

| Status | Effect |
|--------|--------|
| TRIALING, ACTIVE, PAST_DUE | Everything the plan allows |
| EXPIRED, CANCELLED, SUSPENDED, PENDING | **Read-only.** Nothing new can be added: cases, clients, invitations, member reactivation, uploads, client-portal logins, AI or drafting. Everything existing stays readable and downloadable, people can sign in, and **nothing is deleted**. |

Further rules:
- A trial past its end date counts as EXPIRED straight away. `subscription_sweep` records the change.
- PENDING is left only by being assigned a plan (`change_plan`).
- A billing SUSPENDED is not the security suspension of a firm (`/api/platform/firms/<id>/suspend`). The two are independent.
- The subscription never bypasses authentication, RBAC or tenancy. It only takes things away: a plan never grants a permission.
- Stock use is always counted live and metered counters are per month, so a status or plan change cannot leave stale quota state.

## Where it is enforced (server side)

| Operation | Check |
|-----------|-------|
| Create or restore a case | `@entitled(cases.total)`: atomic, locks the firm's counter row |
| Create or restore a client; a client copied by a matter move | `clients.total` |
| Staff invitation; re-sending a non-pending one; reactivating a STAFF member | `seats.staff` |
| Accepting an invitation | No check: a live invitation already holds its seat |
| Client-portal login creation | `feature.client_portal` |
| Document upload or new version (every path goes through `documents.storage`) | `storage.bytes`, reserved by file size under the lock |
| Lisa chat | `feature.assistant` + `ai.requests.month` |
| Draft create / regenerate / edit / refine / consistency check / analyse risks | `feature.drafting` + `drafting.operations.month` |
| Drafting set-up: templates, samples, playbooks (create, reprocess, add documents), translation | `feature.drafting` only. Not counted: which operations count is a business decision. |
| Document summary: upload, Regenerate, and the scheduled `summarize_documents` | `feature.document_summary` + `ai.summaries.month`, checked inside `summarize()` |

Refusals are 403 `{error, code: ENTITLEMENT_<reason>, entitlement}`. The reason is one of `FEATURE_NOT_IN_PLAN`, `LIMIT_REACHED`, `SUBSCRIPTION_INACTIVE`, `SUBSCRIPTION_MISSING` or `PLAN_NOT_PUBLISHED`.

**Authorised bypasses:** demo seed commands (`seed_demo`, `seed_role_demo`), backup restore of a practice's own data, and migrations / repair commands. These put back or create controlled data and are not customer additions. Whether a restore should count against limits is listed under the open questions below.

## Seats and storage

**Seats:** active STAFF members, plus distinct people holding a live invitation (pending and not expired) who are not active yet.
- Suspended and former members do not count, and reactivating one needs a free seat.
- CLIENT (portal) memberships never count.
- An expired invitation stops holding a seat as soon as it expires.

**Storage:** current file sizes plus kept earlier versions. Not counted:
- deleted rows (their files are removed);
- `.part` temporary files;
- downloads and exports generated on the fly.

A draft filed to a case (`drafting/filing.py`) is an ordinary document and counts.

Concurrency: stock checks lock the firm's `firm_usage` row inside the request's transaction, so parallel requests cannot overshoot. This is tested for seats, cases, uploads and AI requests.

## Metering: request quota versus provider tokens

Each metered operation is a `metered_request` row:

| State | Meaning | Quota |
|-------|---------|-------|
| RESERVED | Counted and running | Counted |
| SUCCEEDED | Done | Kept |
| FAILED | Nothing usable came back (provider error or timeout before any answer, an exception, an error response, or a final generation failure) | Given back with a compensating `usage_event` in the request's own month |
| CANCELLED | The browser went away after the work started | Kept (the provider was already asked) |

`usage_event` rows are immutable. Refunds and operator corrections are new events.

**Idempotency-Key** (scoped per user):
- the same key while the request is still running gets 409 `REQUEST_IN_PROGRESS`;
- the same key after success or cancellation gets 409 `IDEMPOTENCY_KEY_USED` (there is no stored reply to replay, and reuse must never be free);
- the same key after a failure is counted again as a new attempt.

Background jobs (draft generation, risk analysis) settle the request by `ref` when they finish. A Celery retry keeps the reservation; only the final failure releases it.

`subscription_sweep` releases requests left RESERVED for more than 2 hours, because a process died partway through.

**Provider tokens** are separate: `metering.llm_usage`, with `firm_id`. They are recorded exactly when the provider reports them, otherwise marked *estimated*, and are **never refunded**. Cost is `null`: there is no price list, and none is ever invented. The summary shows request outcomes by state alongside the tokens.

## APIs

- `GET /api/platform/plans`: every plan with `state`, `revision`, approval details, `subscribers`, and `assignable` (`yes` / `test` / `no`).
- `POST /api/platform/plans/<code>` with `{action: edit|approve|publish|retire|revise, reason, ...}`. Needs `plan.publish`.
- `GET /api/platform/subscription-policy`: returns `{testPlansEnabled}`.
- `GET /api/platform/firms/<publicId>/subscription`, and `POST` to the same URL. The POST needs `subscription.manage` and a reason, and is platform-audited. Actions:
  - `start`, `change_plan` {planCode, status}, `extend_trial`;
  - `activate`, `past_due`, `suspend`, `cancel`, `expire`;
  - `set_override`, `clear_override`, `correct_usage`;
  - `mark_test_firm`, `clear_test_firm`.
- `GET /api/firm/subscription`: the caller's own firm, needs `SETTINGS_EDIT`, read-only (POST is 405). It takes no firm id.
- `PATCH /api/platform/firms/<id>` with `planCode` returns 400 `USE_SUBSCRIPTION`.

## Screens

- **Platform → Plans** (`/platform/plans`): each plan's state, features and limits, approval details and the number of firms on it. Owners get Edit, Approve, Publish, Retire and New revision.
- **Firm page → Subscription**:
  - plan, status, use, overrides and history;
  - *Assign plan* for a PENDING firm; only published plans are offered (drafts only for a test firm);
  - *Mark / Clear test firm* where test plans are enabled.
- **New firm form:** the Plan choice offers only published plans, with "Choose later (plan pending)" as the default. On test installs a "Synthetic test firm" box unlocks the draft plans.
- **Firm → Plan & Usage**: read-only, including the pending and unapproved-plan messages.

## Commands

```bat
manage.py seed_plans                        REM deploy step; adds missing draft plans/keys, never changes approved terms
manage.py subscription_sweep                REM ended trials -> EXPIRED; releases stale reservations (run_scheduler runs it)
manage.py reconcile_usage                   REM REPORT ONLY: counters vs events, stale requests, stock over limit
manage.py reconcile_usage --storage         REM + document rows vs files on disk (missing, size, orphan, .part) - report only
manage.py reconcile_usage --apply           REM correct counters / release stale requests (never deletes data or files)
manage.py reconcile_usage --backfill-ai --apply   REM give pre-Phase-8 llm_usage rows their firm
```

## Decisions that need business approval

1. Every plan's limits and features, its trial length and whether a trial is offered at all, and the prices. They are not set; publish them through the Plans page once agreed.
2. Which drafting operations count: currently generate, regenerate, edit, refine, consistency check and risk analysis. Template, sample and playbook processing and translation are feature-gated but not counted.
3. Whether a summary limit should exist (`ai.summaries.month` is counted, unlimited).
4. Whether a backup restore or a matter move may exceed a firm's limits (the matter move currently counts).
5. Whether a PENDING firm should be kept from activating at all (today it can sign in, read-only).
6. Whether approving and publishing a plan should need two different owners (today one owner may do both; both steps are audited).
7. The read-only policy for each status (today all four non-usable statuses behave the same), and whether PAST_DUE should get a grace end date.
8. Whether CANCELLED Lisa requests (the browser closed mid-answer) should be given back.
