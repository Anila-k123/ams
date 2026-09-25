# Phase 04: brief for rewriting AMS pages onto PrimeReact

The AMS frontend is `C:\Users\Sybrant\ams\Advocate-app-FE-main` (React 19, Vite,
react-router v7). PrimeReact 10, PrimeIcons and PrimeFlex are installed and wired in
`src/main.jsx`. The PrimeReact theme is lara light or dark, swapped by
`contexts/ThemeContext.jsx`. TypeScript runs with `allowJs`, so `.jsx` and `.tsx` coexist.

## Goal
Rebuild each page you own onto PrimeReact components, **keeping behaviour identical**:
- the same features;
- the same API calls, URLs, payloads and response handling;
- the same permission checks and routes;
- the same window events, query params and localStorage keys (other than auth).

This is a UI-layer migration, not a redesign of features.

## Rules
1. **Files.** Rename each owned `X.jsx` to `X.tsx` (delete the `.jsx`).
   - Imports across the app are extensionless, so the rename breaks nothing.
   - Types can be loose: use `any` where a real type costs time. `strict` is off. `noUnusedLocals` / `noUnusedParameters` are on, so tsc must pass.
2. **HTTP.** Use only `src/api/client.ts`:
   - `import api, { apiUrl, authHeaders, errorMessage, API_BASE } from '../api/client'`, with the path relative to your file.
   - `api` is an axios instance on the AMS base URL: call `api.get('/api/cases/...')`.
   - Remove local `const API_BASE = ...` definitions and any `import.meta.env.VITE_API_BASE` reads.
   - Remove imports of `src/api.js` / `src/config.js` (these files are being deleted) and manual `Authorization` headers.
   - Keep `fetch` only where needed (streaming, blobs), and then use `apiUrl()` + `authHeaders()`.
   - Keep bare-`axios` calls only if switching them is risky. `api` is preferred.
3. **Identity.** Use `useAuth()` from `src/context/AuthContext.tsx`: `{ token, advocateId, email, role, fullName, isClient, login, updateProfile, logout }`.
   - Do not read `localStorage.getItem('token'|'role'|'fullName'|'email')` in pages.
   - Do not `jwtDecode` the token for the advocate id; use `advocateId`.
   - Login and set-password call `login(response.data, email)`. Profile edits call `updateProfile(...)`.
   - Permissions stay in `contexts/PermissionContext.jsx` (`usePermission()`). Do not merge the two.
4. **Components.** Use PrimeReact:
   - `DataTable`/`Column` for tables;
   - `Button`, `InputText`, `InputTextarea`, `InputNumber`, `Dropdown`, `MultiSelect`, `AutoComplete`, `Calendar` for dates, `Checkbox`, `InputSwitch`;
   - `Dialog` for modals, `ConfirmDialog`/`confirmDialog` instead of `window.confirm`;
   - `Tag` for status chips, `TabView`/`TabMenu`, `Card`/`Panel`, `Paginator`, `ProgressSpinner`, `Skeleton`, `Menu`, `Tooltip`, `FileUpload` (or a plain input if the current upload logic depends on it);
   - PrimeIcons (`pi pi-*`) instead of `react-icons` in the markup you rewrite;
   - PrimeFlex utilities (`flex`, `gap-2`, `p-3`, `grid`, `col-12 md:col-6`, ...) for layout.
   Charts stay on `recharts`, calendars on `react-big-calendar`, and PDF generation on `jspdf`. Only their surrounding chrome changes.
5. **Toasts.** Keep AMS's global toast (`useToast()` from `contexts/ToastContext.jsx`) so the whole app has one toast. Do not mount a PrimeReact `<Toast>` per page.
6. **Shared primitives you do NOT own** (`components/Modal`, `Pagination`, `Loader`, `Skeleton`, `DownloadLoader`, `LoadingButton`, `Toast`, `TimeSwitcher`):
   - don't edit them;
   - stop using them in your files, replacing them with the PrimeReact equivalents: `Dialog`, `Paginator` (keep the same 0-based/1-based page semantics your code sends to the API), `ProgressSpinner`, and PrimeReact `Skeleton`. `DownloadLoader` is global UI and can stay in use.
   
   They are deleted after all batches land.
7. **Styling.**
   - Must look right in **both** light and dark themes. Use AMS tokens from `src/assets/styles/themes.css` (`--text-primary`, `--text-secondary`, `--text-muted`, `--card-bg`, `--card-border`, `--primary`, `--success`, `--danger`, `--warning`, `--border-color`, `--radius`, …) for any custom CSS.
   - Never hard-code white or black backgrounds.
   - Trim the page's CSS file in `src/assets/styles/` down to what the new markup still uses, or delete it if unused.
   - Don't use Bootstrap classes (Bootstrap is being removed).
8. **Scope.** Only edit files in your batch.
   - If you must change a file you don't own, don't; note it in your report instead.
   - Don't touch the backend, `package.json`, `src/api/client.ts`, `src/context/AuthContext.tsx`, `src/main.jsx`, or `src/pages/Drafting/`.
   - No `npm install`, no git commits.
9. **Verify.** Run `npx tsc -p tsconfig.app.json --noEmit` from the frontend folder.
   - Errors in your own files must be zero. Other agents are editing concurrently, so ignore errors in files you don't own.
   - Do NOT run `vite build` (a shared `dist/` would clash).
   - Re-read your finished files once for behaviour parity against the originals. A pre-rewrite snapshot is `C:\Users\Sybrant\AppData\Local\Temp\claude\C--Users-Sybrant-ams\9dc39388-f508-4e5e-b8f7-cfaf11599b9f\scratchpad\fe-src-before-rewrite.tar` (tar with `--force-local`), and git HEAD also has the originals.
10. **Report.** Final message, short:
    - files rewritten or renamed or deleted;
    - anything you could not keep identical;
    - cross-file changes you needed but didn't make;
    - the tsc result for your files.

## Backend facts you may need
- API base: `http://localhost:8080`.
- Auth: `Authorization: Bearer <AMS JWT>`, with no refresh token. A 401 is handled globally by the client, which logs out.
- Spring-style pagination on most AMS lists: `?page=0&size=10` → `{content, totalElements, totalPages, number}`.
- Client-role users (`role === 'CLIENT'`) see only `src/client/*`.
