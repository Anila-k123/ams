# UI redesign: Red Tape

The frontend is moving to the **Red Tape** design system: ink, bond paper and a single strand of red tape. The approved reference is `ams-redesign-demo/PactPro_UI_Redesign_Final.html`. It is a self-contained clickable prototype; open it in a browser. Its design notes are in `ams-redesign-demo/DESIGN_SYSTEM.md`.

The redesign is complete on the `dev3` branch. PrimeReact, PrimeFlex, PrimeIcons, react-big-calendar, react-select and all the old per-page CSS have been removed.

## Where things live

| Path | What |
|---|---|
| `src/ui/redtape.css` | Tokens (light and dark), base styles and every component class from the prototype. |
| `src/ui/Icon.tsx` | The prototype's stroke icon set: `<Icon name="case" size="sm" />`. |
| `src/ui/kit.tsx` | `Button`, `Chip`, `StatusChip`, `toneFor`, `titleCase`, `Avatar`, `PageHead`, `Panel`, `EmptyState`, `Skel`, `Spinner`, `PopMenu`. |
| `src/ui/forms.tsx` | `Field`, `TextField`, `TextArea`, `SelectField`, `SearchInput`, `Check`, `Switch`, `Segmented`, `FilterChip`, `Tabs`. |
| `src/ui/overlays.tsx` | `Modal`, `Drawer`, and an imperative `confirm({...})`. `<ConfirmHost/>` is mounted in `main.jsx`. |
| `src/ui/DataTable.tsx` | Sortable, paged table with loading and empty states. Supports client or server paging. |
| `src/ui/lisa.css` | Lisa, the AI assistant: the launcher (bottom right, Ctrl+J) and the docked panel. |
| `src/ui/legacy-bridge.css` | Maps the old variable names (`--primary`, `--card-bg`, `--text-muted` …) to Red Tape tokens, so pages that haven't been rebuilt yet still match. Delete it once nothing uses them. |
| `src/ui/pages/*.css` | Page-area styles (auth, portal, cases, casedetail, court, clients, finance, research, firm, drafting), built only from Red Tape tokens. |
| `src/layout/nav.ts` | Sidebar model (pinned, groups, bottom), permission rules and the "New" menu (`QUICK_CREATE`). |
| `src/layout/Sidebar.tsx`, `CommandPalette.tsx` | The ink sidebar (accordion groups, icon rail with flyouts, mobile drawer) and Ctrl+K search. |
| `src/pages/Dashboard.tsx` | Providers, the app shell (sidebar, top bar, bell, New menu, user menu) and the `/dashboard/*` routes. |
| `src/pages/Today.tsx` | The home page. |

## Sidebar

- **Workspace (always visible):** Today · Cases · Calendar · Tasks
- **Court Work:** Daily Cause List · Court Display Board · Appeal Alerts
- **Clients & Files:** Clients · Documents
- **Drafting:** Drafts · Firm Templates · Draft Documents · Clause Playbooks
- **Legal Research:** Bare Acts · Section Cross-Reference · Legal Dictionary
- **Finance & Reports:** Invoices · Expenses · Practice Reports
- **Communications:** Client Messages · Message History · Delivery Log · Communication Channels
- **Firm Administration:** Team Members · Roles & Permissions · Audit Log · Backup & Restore
- **Bottom:** Settings. The signed-in user, profile and sign-out live in the top bar only, and search is only in the top bar. Keyboard shortcuts (Ctrl+K search, Ctrl+J Lisa) work but are not printed in the UI.

How the groups behave:
- Only one group is open at a time.
- The group holding the current page opens itself, and the open group is remembered.
- A closed group shows its urgent count (for example, unpaid invoices).
- Items appear only for roles that hold their permission. The rules are in `nav.ts`, and the route guards in `Dashboard.tsx` match them.

## Rules for a rebuilt page

1. **Markup uses the prototype's classes.** Open the same page in the prototype and match its structure. Use `PageHead`, then a `toolbar`, then `DataTable`, `Panel` or `figures`. The class names are in `redtape.css`.
2. **No component libraries.** PrimeReact is gone; do not reintroduce it. Use the kit instead:

   | PrimeReact | Replacement |
   |---|---|
   | `Button` | `<button className="btn …">` or `Button` from the kit |
   | `Dialog` | `Modal` |
   | `Sidebar` | `Drawer` |
   | `confirmDialog` | `confirm` |
   | `DataTable`/`Column` | `DataTable` |
   | `Dropdown` | `SelectField` / `<select className="input">` |
   | `Calendar` | `<input type="date" className="input">` |
   | `Tag` | `StatusChip` / `Chip` |
   | `Skeleton` | `Skel` |
   | `ProgressSpinner` | `Spinner` |
   | `Message` | `<div className="callout warn">` |
   | `TabMenu`/`TabView` | `Tabs` |
   | `SelectButton` | `Segmented` |
   | `Checkbox` | `Check` |
   | `InputSwitch` | `Switch` |
   | `Menu` | `PopMenu` |
   | `pi pi-*` icons | `Icon` |

   PrimeFlex utility classes (`flex`, `grid`, `col-*`, `gap-*`, `p-*`, `m-*`) become Red Tape layout classes: `row`, `stack`, `cols g-2/g-3/g-4`, `split`, `form-grid`.
3. **Layout grids use `.cols`, not `.grid`.** `.grid` belongs to PrimeFlex until it is removed.
4. **Behaviour does not change.** Keep every API call, permission check, `usePageModal` hook, `location.state` search/highlight hand-off, validation and toast. Only the presentation changes.
5. **Delete the page's old CSS file** from `src/assets/styles/` once nothing imports it. Page-specific styles that the kit doesn't cover go in `src/ui/pages/<area>.css`, built only from Red Tape tokens (no hard-coded colours), so both themes work.
6. **Accessibility:**
   - Every control has a label.
   - Icon-only buttons have an `aria-label`.
   - Status is never shown by colour alone; the chips have text.
   - Tables have a header row.
   - Dialogs come from `Modal`/`Drawer`, which trap focus and close on Escape.
7. **Responsive:** check the page at 1440, 1024, 768 and 390 px. There should be no horizontal page scroll; wide tables scroll inside `.table-wrap`.

## Themes

Light is the default; dark comes from the user menu or the top-bar button.
- `ThemeContext` sets `data-theme` on `<html>`.
- A small script in `index.html` applies the saved theme before first paint.
- The sidebar stays ink in both themes.

## Status

- **Done:** foundation, shell, Today, Lisa, search palette, bell, toasts, loaders.
- **Done:** shared kit (forms, overlays, data table).
- **Done:** every page area: sign-in and the client portal, cases, the case page, court work and the calendar, tasks, clients and documents, finance, legal research and communications, firm administration and settings, drafting (including the editor).
- **Done:** PrimeReact, PrimeFlex, PrimeIcons, react-big-calendar and react-select are uninstalled, and the bridge and skin stylesheets are deleted.
- **Known gaps** (no backend support yet):
  - invoice payment reminders and payment links
  - a per-client API for the client drawer, which currently filters the full case and invoice lists
  - a case filter on the documents list API
  - a storage quota for the documents meter
