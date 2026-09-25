# 02 — AMS: Launch endpoint + "InstaDraft" buttons

**Codebase:** AMS, `Advocate-app-BE-Django/` and `Advocate-app-FE-main/`
**Depends on:** 01

## Goal
AMS can open InstaDraft with a short-lived launch token from (a) a sidebar/dashboard button
and (b) a button on each task.

## Backend
1. Create a new Django app, `integrations`. Add it to `INSTALLED_APPS` and include its urls under `/api/`.
2. `POST /api/integrations/instadraft/launch`, protected by normal AMS auth (`AdvocateJWTAuthentication`).
   - Body: `{ "caseId"?: int, "taskId"?: int }`.
   - If `taskId` is given: the task must exist with `advocate_id in practice_ids(user)`. Take
     `caseId` from the task if it wasn't sent. If the task has `assigned_to_id`, the caller must be
     the assignee or the assigner (otherwise 403).
   - If `caseId` is given: the case must be in `practice_ids(user)` (otherwise 404).
   - Returns `{ "url": "<INSTADRAFT_BASE_URL>/sso?token=<launch token>" }`.
     `caseId` and `taskId` travel **inside** the token, not as extra query params.
   - Returns 503 `{error}` if `INSTADRAFT_SHARED_SECRET` is empty.
3. Add InstaDraft's origin to `CORS_ORIGINS` in `.env` / `.env.example`. This is only needed if the
   InstaDraft frontend ever calls AMS directly, and harmless otherwise.
4. Tests: direct launch; task launch; task from another practice → 404; secret missing → 503.

## Frontend (`Advocate-app-FE-main/src`)
Use the existing API helper in `src/api.js` / `src/services`.
1. Add a helper, `openInstaDraft({ caseId, taskId } = {})`. To avoid popup blockers, open the tab
   synchronously first (`const w = window.open('', '_blank')`), then POST to the launch
   endpoint and set `w.location = url`. On error, close the tab and show the existing toast.
2. **Direct button:** add an "InstaDraft" item to the main navigation/sidebar (see
   `contexts/SidebarContext.jsx` and the layout that renders the nav items) and to Quick Actions
   (`components/QuickActionsModal.jsx`). It calls `openInstaDraft()`.
3. **Task button:** wherever tasks are listed (the case workspace task list and the "my tasks" page),
   add a "Draft in InstaDraft" action on each task. It calls `openInstaDraft({ caseId, taskId })`.
   Hide it on completed or cancelled tasks.
4. Match the existing styles. Don't add a new CSS framework.

## Done when
- Clicking either button opens a new tab at `…/sso?token=…`.
- Decoding that token with the shared secret shows the right `advocateId`, `caseId` and `taskId`.
