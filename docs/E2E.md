# Browser end-to-end tests (Phase 9)

Real browser (Playwright, Chromium) against a real backend and database. Nothing
in the browser run is mocked except two outside services, which are replaced by
local stand-ins.

| Piece | E2E run | Working instance |
|---|---|---|
| Backend | `:8090`, started by Playwright, `--noreload` | `:8080` |
| Frontend | `:5180` (Vite, `VITE_API_BASE=http://127.0.0.1:8090`) | `:5173` |
| Database | `pactpro_e2e` (schema of PactPro_db, no business data) | `PactPro_db` |
| Email | file backend -> `Advocate-app-FE-main/e2e/.mail/` (nothing sent) | SMTP |
| AI provider | `e2e/llm-stub.mjs` on `:8099` (OpenAI-compatible, canned "[E2E stub]" replies) | real provider |
| Court scraper | `COURT_API_BASE=http://127.0.0.1:9` (closed) - court features answer 503 | `:8000` |
| Uploads | `e2e/.uploads/` | `DOCUMENT_UPLOAD_DIR` |

All AI keys are blanked for the E2E backend (`e2e/env.ts`), so no test can reach
an outside service. Seeding helpers (`e2e/seed_operators.py`, `helpers.py()`)
refuse any database other than `pactpro_e2e`.

## Run

```bat
cd Advocate-app-FE-main
npx playwright install chromium        REM once
npm run e2e                            REM all specs, in order (01 -> 06)
npx playwright show-report             REM or e2e/.results/results.json
```

Each run seeds its own synthetic operators (OWNER, READONLY, a disabled SUPPORT)
with random passwords and authenticator seeds into the git-ignored
`e2e/.state/state.json`, runs the deploy-time permission seeds (idempotent), and
creates new firms with a run id, so runs don't collide. Specs depend on each
other in file order (01 creates firm A, 03 creates firms B and C).

## What each spec covers

| Spec | Covers |
|---|---|
| `01-onboarding` | operator MFA sign-in, dashboard, create firm, invitation email, accept, firm admin sign-in, firm settings, staff invitation + acceptance, junior limits, last-admin protection |
| `02-practice` | client (browser form), case, hearing, document upload (browser) + signed links, invoice -> part payment (browser) -> final payment -> balances, reminders queued once / processed once / bell, Lisa via the stand-in, client portal (set password, own cases only), logout revokes server-side |
| `03-isolation` | firms B and C; `idor_sweep.py` calls every API route with firm B's ids as firm A admin, firm A junior, firm C admin, a platform operator and a client; no response may contain B's marker and B's data must be unchanged; token audiences; browser deep links |
| `04-security` | TOTP replay, password-only and wrong code, READONLY operator, disabled operator, operators see no legal records, password reset and member/firm suspension end sessions, forged / `alg:none` tokens, cross-firm role assignment, junior restrictions, last admin via API, signed link purpose + expiry, CORS, concurrent invitation acceptance, concurrent uploads |
| `05-drafting-sessions` | edit in the editor, save, versions, restore, Word export, earlier versions kept, another firm can't open/save/export, session ended elsewhere -> sign-in |
| `06-reliability` | one payment under 5 identical requests, simultaneous payments vs balance, simultaneous invoice numbers, 3 queue processors at once, crashed-processor recovery, refused uploads leave no file |
| `07-subscriptions` | operator plan change and history, client limit with a clear message, expired trial read-only and restored by an extension, plans are unapproved drafts (a real firm can't get one: provisioning refused / plan pending), only owners approve, Plans screen, a Lisa request key can't be reused, firms can read but not change their plan |

E2E firms are synthetic: the E2E backend runs with `SUBSCRIPTION_TEST_PLANS=True` and creates firms with the "Synthetic test firm" box / `testFirm: true`, so they may use the unapproved example plans (`docs/SUBSCRIPTIONS.md`).

## Not covered by the browser run (and why)

- **AI draft generation**: the generation job loads a local embeddings model,
  downloaded from HuggingFace on first use - an outside service. Drafting is
  tested from a known draft onwards. Generation itself is covered by the backend
  tests with fake providers.
- **Court data** (scraper, cause lists, display board, case import).
- **Real email delivery, WhatsApp, Sarvam translation, real AI providers.**

## Database

`pactpro_e2e` was created from PactPro_db's schema with only system reference
rows (migration history, content types, the permission catalogue, system role
templates). It holds only synthetic E2E data. Dropping it needs approval.
