# Phase 4 — Frontend unification

## Goal

One frontend: one PrimeReact-based shell, one API client, one auth context, covering both AMS's ~35 existing pages and InstaDraft's ~10 drafting pages.

## Background

AMS's frontend today has **no component library** (hand-rolled CSS per page), is plain JavaScript (no TypeScript), React 19, `react-router-dom` v7, and has **no single unified API client** — three places define `API_BASE` (`src/api.js`, `src/config.js`, `src/services/DashboardService.js`), mixed `fetch`/`axios`, no refresh-token flow, auth state scattered across raw `localStorage` keys (`token`, `email`, `role`, `fullName`) rather than one context object. Per the (rechecked) decision: **standardize on PrimeReact** — InstaDraft's existing choice, already proven on this exact React 19 version, with zero conflicting theme to fight since AMS has no library today. This means AMS's ~35 pages get rewritten onto PrimeReact just as much as InstaDraft's ~10 do — it is not a lopsided migration either direction.

## What happens

1. **Introduce TypeScript, without forcing a wholesale AMS conversion**: copy InstaDraft's `frontend/tsconfig.json` into `Advocate-app-FE-main/`, `allowJs: true` so existing `.jsx` files keep compiling untouched while new/rewritten pages become `.tsx`.

2. **One API client**: replace all three of `src/api.js`, `src/config.js`, and ad hoc per-service `fetch` calls (`src/services/DashboardService.js` and others) with a single axios instance modeled on InstaDraft's `frontend/src/api/client.ts` — Bearer token attach, base URL from `VITE_API_BASE` (keep AMS's existing env var name, since it's what real deployments already use — don't rename to InstaDraft's `VITE_API_URL`). **No refresh-token flow to add** — AMS's JWT has no refresh token at all (24h single token); on 401, redirect to `/login` exactly as `src/utils/auth.jsx`'s `logoutAndRedirect()` already does. This is simpler than InstaDraft's own interceptor, not harder — don't port InstaDraft's refresh logic in, it has nothing to refresh against.

3. **One auth context**: introduce a real `AuthContext` (AMS currently has none — identity is reconstructed ad hoc from scattered localStorage reads, per `src/pages/Dashboard.jsx`'s own "Profile sync" comment). Store `{ token, advocateId, email, role, fullName, permissions }` in one place; keep AMS's existing localStorage keys underneath for compatibility during the transition, but stop reading them ad hoc from every page. `PermissionContext.jsx` (RBAC permission strings) stays as its own context, unrelated to this — don't merge them, they answer different questions (who vs. what-can-they-do).

4. **Routing**: fold drafting routes into AMS's existing router. AMS's routing today is unusual — a top-level `App.jsx` route table plus a **second, nested** `<Routes>` block inside `Dashboard.jsx` itself (lines ~815–1249) that renders all `/dashboard/*` sub-pages inside the persistent sidebar shell. Add drafting routes as siblings inside that nested block: `dashboard/drafting/dashboard`, `dashboard/drafting/drafts`, `dashboard/drafting/new`, `dashboard/drafting/templates`, `dashboard/drafting/samples`, `dashboard/drafting/administration`, `dashboard/drafting/playbooks`, gated the same way other permission-sensitive sub-pages already are (`PermissionRoute` wrapper, checking the new `DRAFT_VIEW` permission from Phase 03). The standalone chromeless routes (`/draft/:sessionId`, `/samples/:id/summary`, `/samples/:id/translate`) sit **outside** `Dashboard.jsx`'s shell entirely, as top-level `App.jsx` routes with their own `ProtectedRoute` wrapper — same pattern AMS already uses, nothing new needed.

5. **Retire the InstaDraft launch integration in the frontend** — replace every `openInstaDraft(...)` call site with an in-app `navigate(...)` to the new routes: `src/pages/Dashboard.jsx` (sidebar link, ~L585-590), `src/components/QuickActionsModal.jsx` (~L18, L60), `src/pages/TasksPage.jsx` (~L434, pass `caseId`/`taskId` as route params or query string instead of into a launch token), `src/pages/CaseDetail.jsx` (~L1693). Delete `src/utils/instaDraft.js` once all four call sites are updated.

6. **Rebuild AMS's pages onto PrimeReact** — this is real, substantial work (~35 pages: ActDetail, Acts, AddCase, AnalyticsPage, AppealAlert, BackupPage, CaseDetail, Cases, ChatbotWidget, Clients, CommunicationDashboard, CommunicationHistory, CommunicationSettings, DailyCauselist, Dashboard, DisplayBoard, DocumentsPanel, Expenses, HearingsPage, InvoicesPanel, LawCodes, LegalDictionary, NotificationsCenter, ProfilePage, ReportsCenter, RoleManagement, SettingsPage, SystemActivity, TasksPage, UpcomingPanel, UserManagement, plus `src/client/`'s client-portal pages) — sequence this as its own sub-effort, not a single sitting: start with the shell (`Dashboard.jsx`'s sidebar + nested router) and the highest-traffic pages (Cases, Clients, Tasks, Dashboard home), and treat the rest as an incremental backlog that can proceed in parallel with Phases 05-07's drafting-specific work, since neither blocks the other.

7. **Rebuild InstaDraft's pages** — Dashboard/Drafts/Templates/Samples/Playbooks/Administration: near-identical port, since they're already PrimeReact; the main change is switching their API calls to the unified client and reading auth/role from the new shared `AuthContext` instead of InstaDraft's own retired one. NewDraft and the 3-pane editor are Phases 05-06, not this one.

## Files touched

- `Advocate-app-FE-main/tsconfig.json` (new)
- `Advocate-app-FE-main/src/api/client.ts` (new, replaces `api.js`/`config.js`)
- `Advocate-app-FE-main/src/context/AuthContext.tsx` (new)
- `Advocate-app-FE-main/src/App.jsx`, `src/pages/Dashboard.jsx` (routing)
- `Advocate-app-FE-main/src/pages/*.jsx` → `.tsx` (rewritten onto PrimeReact, incrementally)
- `Advocate-app-FE-main/src/pages/Drafting/*.tsx` (new, ported)
- Deleted: `src/utils/instaDraft.js`

## Risk/effort

Medium-high, mostly a volume/sequencing problem rather than a risky one. The API client and auth context unification are low-risk, mechanical, and should land first since everything else depends on them. The 35-page PrimeReact rewrite is the actual bulk of this phase's effort — track it as its own backlog, not a blocking gate on Phases 05-07.

## Done when

- One axios client, one `AuthContext`, no remaining references to `src/api.js`/`src/config.js`/`src/utils/instaDraft.js`.
- Drafting routes are reachable inside AMS's existing sidebar shell, gated by the new `DRAFT_VIEW` permission.
- Every rebuilt page (AMS's and InstaDraft's) is manually exercised in the browser — golden path plus at least one edge case — since type-checking alone doesn't verify feature correctness.
- No dev-port collision remains between the two apps' Vite configs (moot once merged into one server, but confirm the merged `vite.config.js` has no leftover dual-config artifacts).

## Next phase

`05-newdraft-and-async-pipeline.md`
