# PactPro (AMS) — UI Audit

Phase 1 of the redesign demo. Read-only discovery of `Advocate-app-FE-main/src` (branch `Developer-1`, 2026-10-01). No existing file was modified.

## 1. Stack

| Concern | Current |
|---|---|
| Framework | React 19.1 + Vite 7, mixed JSX/TSX |
| Router | react-router-dom 7.9 (BrowserRouter, lazy routes) |
| UI library | PrimeReact 10.9 + PrimeFlex 4, theme **Lara Blue** (light/dark `<link>` swap from `public/themes/`) |
| CSS | ~46 plain per-page CSS files in `src/assets/styles/`, tokens in `themes.css`, `prime-bridge.css`; separate `drafting.css` (51 KB) and `client/client.css` |
| Icons | PrimeIcons 7 (+ react-icons 5) |
| Charts | recharts 3.9 (dashboard, reports) |
| Calendar | react-big-calendar + moment |
| Editor | TipTap 3 (drafting), mammoth (DOCX), diff |
| Fonts | Inter 300–900 (Google Fonts); Georgia in document views |
| State | React Context only (Auth, Theme, Loading, Toast, Permission, Sidebar, Assistant, WebSocket, DashboardFilter) |
| Realtime | @stomp/stompjs WebSocket, 30–60 s polling |
| Dark mode | Yes, default **dark**; `data-theme` on `<html>`, stored in `localStorage.theme` and saved to the server |

## 2. Page inventory

Routes are under `/dashboard` unless shown otherwise. The permission is the route guard.

### Public / auth
| Page | Route | Purpose | Key components |
|---|---|---|---|
| Homepage | `/` | Splash with logo + LOGIN button (no self-registration) | Button |
| Login | `/login` | Email + password, two-column with illustration | InputText, Password(toggleMask), toast |
| Forgot password | `/forgot-password` | Send 6-digit code; "Check your email" success state | InputText |
| Verify OTP | `/verify-otp` | 6 single-digit boxes, auto-advance | inline error |
| Reset password | `/reset-password` | New + confirm, 5-rule checklist, strength bar | Password |
| Client set password | `/set-password?token=` | Client invite (72 h link) | inline errors |

### Shell (global)
| Element | Notes |
|---|---|
| Sidebar | 250 px / 72 px collapsed, always dark (own indigo palette), mobile overlay; grouped nav (see §2.1) |
| Topbar | Hamburger, page title (falls back to "Dashboard" on case pages), "Welcome back, {name}", "Live · hh:mm" pulse, Export Dashboard PDF, bell, theme toggle, avatar menu |
| Global search | Ctrl/Cmd+K dialog: recent searches, results grouped by Clients/Cases/Hearings/Invoices/Expenses/Documents/Payments, arrow keys |
| Quick Actions | Dialog: New Client, New Case, New Hearing, Generate Invoice, Upload Document, Add Expense, New Draft, Open Drafts |
| Notification bell | 360 px overlay, count badge (99+), "Got it" / dismiss / "Open >", "Nothing unread.", chime |
| User menu | Name/email header, Profile & Settings, Logout |
| Hearing alert popup | Imminent-hearing popup (EVENT_VIEW) |
| AI assistant panel | Side chat panel ("Lisa") |
| Error boundary | Full-screen "Something went wrong" + Reload/Dashboard |
| 404 | **None** — `*` → `/`; unknown `/dashboard/x` renders blank |
| 403 | **None** — silently redirects to dashboard |

### 2.1 Sidebar order
Dashboard · **Cases** ▸ (Workspace, Daily Causelist, Display Board) · Clients · Hearings & Events · Invoices · Expenses · Documents · Tasks · Reports · Notifications · Appeal Alert · Acts · Legal Dictionary · Law Codes · Assistant · Settings · Backup · **Administration** (System Activity, Users, Roles) · **Communication** (Overview, Settings, History) · **Drafting** (Drafts [+], Templates, Draft Documents, Playbooks)

### Practice pages
| Page | Route (perm) | Purpose | Key components / data |
|---|---|---|---|
| Dashboard | `/` | Firm overview | 5 KPI cards with CountUp (Total, Active, Clients, Upcoming Hearings 30 d, Pending Invoices); Case Status donut; Court Statistics bar; Income vs Expense area; Monthly Case Overview; Upcoming Hearings list; Recent Clients; Invoices Summary (Paid/Unpaid/Overdue + recent); Activity feed; Tasks checklist; Drafting card; Documents stats + recent |
| Cases (Workspace) | `/cases` (CASE_VIEW) | Case register | 5 stat cards; search; Status/Court/Sort filters; archived toggle; DataTable (Case No, Title, Type, Status, Next Hearing, Tags, Client, Amount, Actions: open/edit/archive/restore); 10 skeleton rows; add/edit dialog with "Add manually / Import from court records" |
| Add Case | `/cases/new` (CASE_CREATE) | Court-record import wizard | Quick Select + Available Courts; per-court search (Madras HC type/no./year; SCI tabs Diary/Case/CNR/AOR/Party; eCourts DC cascade State → District → Complex → Establishment with 7 search tabs); results table; CourtRecordView + client picker → "Save Case to Workspace"; manual form |
| Case Detail | `/cases/:id` (CASE_VIEW) | One matter, everything about it | Inline-editable header (title, status, client), CNR strip, tags, "Draft for this case", "Raise Invoice", Actions menu (Refresh court data, Transfer, Archive), Next Hearing box. **13 tabs:** Parties, Hearings (+ Court Hearing History table, Daily Status, Send Alert to Client), Events, Orders, Expenses, Invoices, Tasks (with review workflow), Notes, Documents (summary), Related Cases, Acts, Extra Details, Timeline (overlay). Dialogs: Transfer, Hearing/Event, Expense, Invoice (particulars + total), Upload Order |
| Daily Causelist | `/daily-causelist` | Your matters in today's cause lists | Date picker; per-court groups "Court n · Item n · case"; Send Alert to Client |
| Display Board | `/display-board` | Live court display boards | My Forums / All Forums; court accordion; dynamic columns (Item, Your Item, Case No, Judge, VC Link, Stage…); refresh; error + retry |
| Clients | `/clients` (CLIENT_VIEW) | Client register | Search; archived toggle; table (Name, Email, Phone, Advocate, GSTIN, City, State, Actions: edit, Logins, archive, PDF, documents); 720 px add/edit dialog (Basic Details, Handling Advocate, Address); portal-access dialog |
| Hearings & Events | `/hearings` (EVENT_VIEW) | Calendar | Week/Month/Agenda, Prev/Today/Next, colours by type; Add Event dialog (Hearing adds Purpose/stage, Court, Bench/Hall, Judge, Next date, Outcome) |
| Tasks | `/tasks` (TASK_VIEW) | Team tasks + review | Scope (Team / Assigned to me / Created by me), Status (In Progress / To review / Completed / Canceled), search; task cards (priority, case chip, assignee, review chip, reassign, Draft for this task, cancel/restore); New Task dialog; "Submit work → Approve / Request changes" |
| Documents | `/documents` (DOCUMENT_VIEW) | Document library | Search, Category/Status/Type filters, grid/list toggle, version badge "v n", share-with-client toggle, Summary (AI), versions, preview modal, upload dialog (multi-file, category, case, client) |
| Invoices | `/invoices` (INVOICE_VIEW) | GST billing | 3 cards (Paid, Unpaid, Overdue Dues); search; table (Invoice No, Client, Case No, Amount, Due, Status, Mark Paid, Export PDF); Generate Invoice dialog (case, particulars, GST treatment, billing address) |
| Expenses | `/expenses` (EXPENSE_VIEW) | Per-case money in/out | Case table (Title, Client, Status, Total Expense, Balance, View/Add/Payment); Case Financial Overview; Add Expense; Add Client Payment; Today's / Monthly report (print/PDF) |
| Reports | `/reports` (REPORT_VIEW) | Analytics | Date preset filter + custom range, Export PDF; Financial (Revenue, Expenses, Net, Outstanding with % deltas, cash-flow area), Case (Active/Pending/Closed/Dismissed, status donut, court bars, case-type bars), Client (new, pending payments, growth), Hearings (today/upcoming/missed, court-wise); CSV per section |
| Notifications | `/notifications` (comms) | Delivery log | Auto-email switch, Sync Now; 5 stats; filters (Channel, Status, Event type, dates); paged table; detail dialog; Resend |
| Appeal Alert | `/appeal-alert` | Appeals filed against your decided cases | Detected table (Your Case, Appeal Found, Forum, Parties, Filed, Matched On %, Status, "It is an appeal" / "Not related"); Dismissed table |
| Acts / Act detail | `/acts`, `/acts/:id` | Central & TN act library | Search + jurisdiction + field chips, cards, paginator; detail tabs Sections (chapters → expandable), Act Papers, Cases Linked; Link a Case dialog |
| Legal Dictionary | `/legal-dictionary` | 11,000+ terms, Hindi toggle | Search list + definition pane |
| Law Codes | `/law-codes` | IPC → BNS, CrPC → BNSS, IEA → BSA | Tab pairs, direction toggle, mapping list (Repealed/Changed) + side-by-side detail |
| Settings (Profile) | `/settings` | Profile & firm | Tabs: General, Office*, Branding*, Security (password rules), Preferences (theme, language, time zone, currency, date format, auto-logout) |
| System Activity | `/activity` (AUDIT_VIEW) | Audit log | Search + Module/Action/Status/Date filters; CSV/Excel/PDF export; table; 560 px "Event Details" drawer with before/after diff |
| Backup | `/backup` (BACKUP_MANAGE) | Backup & restore | Latest/Storage/Quick Actions cards; 4 backup types; ZIP drop zone, validate → health %, type-"RESTORE" confirm; history table with expandable sections; progress/success/error modals |
| Users | `/users` (USER_MANAGE) | Staff accounts | Table (Name, Email, Phone, Specialisation, Roles, Practice tags); 640 px dialog with role pills and "Reports to" |
| Roles | `/roles` (ROLE_MANAGE) | RBAC | 3-col role cards; 860 px dialog with permission checkbox grid by module |
| Communication | `/communication`, `/settings`, `/history` | Email/WhatsApp channels | Stats + channel status cards; SMTP / WhatsApp config + Test Email; history table |
| Drafting: Drafts | `/drafting/drafts` | AI drafts list | Table (ID, Template, Documents, Created, Citations verified/total, Status) |
| Drafting: New draft | `/drafting/new` | Begin chooser + wizards | "Upload reference files / Type facts directly"; 4-step (Documents, Template, Facts & Prompt, Review) or 3-step scratch (Setup, Key Terms with parties, Review) |
| Drafting: Editor | `/draft/:id` (full-screen) | TipTap drafting workspace | Top bar (N to fill, Save to PactPro, Download PDF/Word/letterhead, Re-draft, Edit/Preview); 3 panes: placeholders + references · paper with clauses, citations [n], risk shields · Chat (Lisa: More formal/concise/Fix grammar, diff Accept/Reject) / Review (Consistency, Playbook risk register) |
| Drafting: Templates / Documents / Playbooks | `/drafting/*` | Template cards, AMS docs for drafting (Summary, Translate), playbook clause rules (standard position, red lines, fallbacks) |
| Document Translate | `/samples/:id/translate` | Original vs translation side-by-side |

### Client portal (CLIENT role, `/dashboard/*`)
Top-nav shell (firm logo, Sign out, footer): Home (greeting, 3 stats, upcoming hearings) · My cases (cards) · Case detail (fees, hearings, parties, documents, invoices) · Invoices & payments · Documents (shared) · Messages · Account (read-only contact + change password).

### Orphaned (not routed)
`AnalyticsPage`, `SettingsPage` (the only billing-profile editor: bank, IFSC, MICR, HSN 998212), `ChatbotWidget`, `UpcomingPanel`.

## 3. Current design tokens (`src/assets/styles/themes.css`)

| Token | Dark (default) | Light |
|---|---|---|
| bg-primary / secondary / tertiary | `#0B1020` / `#121A33` / `#1A2445` (animated 135° gradient) | `#F8FAFC` / `#EEF4FF` / `#FFFFFF` |
| card | `rgba(20,28,48,.75)` + 12 px blur | white |
| primary (hover) | `#4F7CFF` (`#3A5FE0`) | `#3B82F6` (`#2563EB`) |
| secondary / accent | `#7B5CFF` / `#8B5CF6` | `#6366F1` / `#8B5CF6` |
| success / warning / danger | `#22C55E` / `#F59E0B` / `#EF4444` | `#16A34A` / same / same |
| text 1/2/3 | `#FFFFFF` / `#CBD5E1` / `#94A3B8` | `#1E293B` / `#64748B` / `#94A3B8` |
| sidebar (hard-coded) | `linear-gradient(#111827,#0F172A)`, active `#4F46E5→#6366F1` | same — does not follow the theme |

- **Type:** Inter only; no scale. th 11 px/700 uppercase, td 13 px, buttons 13 px/600, pills 10 px/700.
- **Spacing:** ad hoc px (cells 14×18, buttons 10×20).
- **Radius:** 8 / 16–18 / 20–24, pills 20, badges 6.
- **Shadows:** `0 2/8/16px …` at .2–.4 alpha, plus a blue glow.
- **Motion:** 300 ms ease-standard, 150 ms fast; hover lift 2 px.
- **Buttons:** 135° gradient primary (blue→violet), gradient success/danger, ghost. PrimeReact `.p-button` also used.
- **Status pills:** a 12 % `color-mix` tint, with three buckets: success (active, paid), warning (pending, unpaid) and danger (closed, overdue).
- **Responsive:** desktop-first `max-width`, with 12 different breakpoints (480–1280) and no shared tokens.
- **Debt:** ~275 hex literals in CSS, 110 in TSX, ~405 inline `style={{}}`. Two palettes compete (blue/violet vs indigo). Lara theme surfaces are not bridged.

## 4. Domain vocabulary (used verbatim in the demo)

- **Jurisdiction:** Tamil Nadu. The courts are:
  - Madras High Court (Principal Bench, Chennai; Madurai Bench)
  - City Civil Court, Chennai
  - Supreme Court of India
- **Court level:** District / High Court / Supreme Court.
- **Case numbers:** `O.S. No. 900/2025`, `A.S. No. 700/2025`, `C.M.A. No. 1200/2025`, `W.P. No. 14600/2026`, `SLP(C) No. 12710/2026`, `C.A. No. 5640/2026`; IA `IA/1/2025`.
- **CNR:** `TNCH010015532025`, `HCMA011266642024`.
- **Case status:** Active / Pending / Closed (court: Disposed). Tags: High Priority, Urgent, Follow Up, On Hold, Important, Awaiting Documents, For Argument, Reserved, For Orders, Appeal.
- **Party roles:** Petitioner, Respondent, Appellant, Complainant, Accused, Plaintiff, Defendant, Third Party, Witness. Relations: Appeal, Connected, Cross-Objection, Same Parties, Arising From, Other.
- **Hearing purpose/stage:** Arguments, Evidence, Framing of Issues, For Counter/Reply, For Orders, Interim Application, Mention, Cross-examination, Other. Event types: Hearing, Client Meeting, Payment Due, Document Filing.
- **Invoice:**
  - GST 18 % with a CGST+SGST / IGST split, HSN/SAC 998212 "LEGAL SERVICES".
  - Statuses: Paid / Unpaid / Overdue.
  - Amounts in Indian grouping (₹1,00,000).
- **Payment modes:** UPI, Bank Transfer, Cash, Cheque, Card, Net Banking, Demand Draft (NEFT).
- **Expense categories:** Travel, Court Fees, Documents, Stationery, Miscellaneous.
- **Document categories:** Court Order, Petition, Evidence, Agreement, Affidavit, Notice, Judgment, Invoice, Payment Receipt, Identity Proof, Address Proof, Other (+ Draft).
- **Tasks:**
  - Priorities: High / Medium / Low.
  - Statuses: In Progress / To review / Completed / Canceled.
  - Review states: Awaiting review / Approved / Changes requested.
- **Roles:** Super Admin, Senior Advocate, Junior Advocate, Intern, Receptionist, Accountant, Client.
- **Firm and people:**
  - Firm: Kumar & Associates.
  - Staff: Rajesh Kumar (owner), Arjun Menon, Priya Nair, Karthik R., Lakshmi S., Suresh Kumar, Meena Iyer.
  - Clients: Kannan, R. Murugan, K. M. Anand Joshi, M/s. Akshayam Traders, HCL Technologies Ltd., Selvi Ramasamy…

## 5. Top 10 UX / visual weaknesses

1. **Generic "AI dashboard" look.** The blue→violet gradient on navy, with glassmorphism and an animated background, reads as a template rather than a law office. That works against trust, and the moving background tires the eye over long reading sessions.
2. **Two competing palettes.** The sidebar is hard-coded indigo slate and ignores light mode, while content uses blue/violet. Lara's own blue is a third.
3. **No type scale.** Inter sits at 10–13 px for dense legal data. There is no display/serif voice and no tabular or mono figures for case numbers, CNRs or amounts. Uppercase 10–11 px labels hurt legibility.
4. **Too many nav items, in a flat list.** The sidebar has ~30 items with weak grouping. Daily-work items (Cases, Hearings) sit next to rarely used ones (Backup, Law Codes), and Settings sits mid-list.
5. **Case Detail is overloaded.** It has 13 tabs in one TabMenu, and the header mixes edit controls, CNR, tags and actions. There is no persistent summary rail (next hearing, stage, dues).
6. **Missing system states.** There are no 404 or 403 pages, and several pages have silent, console-only fetch errors. The topbar title falls back to "Dashboard" on case pages.
7. **Inconsistent components.** There are two button systems, two table systems, ~405 inline styles, 12 ad hoc breakpoints, and radii from 6 to 24 px.
8. **Dashboard density without hierarchy.** It has 5 rows of equal-weight cards, and "today" (hearings in court this morning) gets no more weight than storage MB.
9. **The calendar is a stock react-big-calendar.** Its event colours (red/green/amber/brown) collide with status semantics, and there is no list of today's sittings by court hall.
10. **Status colour semantics are ambiguous.** "Closed" is shown as danger red. Pending and unpaid share amber, and case status, invoice status and task priority all share one 3-colour bucket.

## 6. Assumptions

- The demo targets the **staff** experience plus a short **client portal** preview, and is branded **PactPro**.
- Court-dependent screens (Display Board, Causelist, Add Case import) are shown with plausible sample data. The real app needs the scraper service.
- Orphaned pages are not reproduced. Their unique content, the billing profile (bank/IFSC/HSN), is folded into Settings, where it should live.
- Drafting is represented by a list, a wizard and a simplified editor view, not a working TipTap editor.

## 7. Phase 4 verification (2026-10-01)

Every checklist item below now exists in `index.html`. I checked this in headless Chrome over 42 routes and ran 34 scripted interactions.

- **Console:** 0 errors and 0 uncaught exceptions on every route and interaction.
- **Interactions confirmed working:**
  - Sign-in, including the wrong-password error.
  - Ctrl+K palette search, then Enter to open a case.
  - Case-detail tabs.
  - Modals open and close on Esc.
  - New-client validation (3 required errors plus the email message).
  - Table search, sort ascending/descending, and the table/board switch.
  - Calendar month/week/agenda views and month paging.
  - Event and document drawers.
  - Theme toggle, notifications panel with "Mark all read", and toasts.
  - GST invoice totals (₹25,000 → CGST ₹2,250 + SGST ₹2,250 = ₹29,500) and the amount in words.
  - Drafting placeholders updating live, and the chat's Accept/Reject change.
  - Role switch (Super Admin sees Roles and Backup; Intern sees a 403 on Invoices and a 13-item nav), the 404 page, and the client portal.
  - Mobile drawer nav open/close, and sign-out.
- **Responsive:** the page never scrolls sideways at 1440, 1024, 768 or 390 px. Wide tables, the board, the week grid and tabs scroll inside their own containers.
- **Contrast:** every text/background token pair meets WCAG AA in both themes. Measured values are in DESIGN_SYSTEM.md §1.
- **Not reproduced (by design):**
  - The orphaned `AnalyticsPage` and `ChatbotWidget`. Their content is covered by Reports and the drafting assistant.
  - The live court-scraper data. The court screens use sample data.
  - A fully editable TipTap editor. The demo editor supports formatting, find, placeholders and AI suggestions.

## 8. Demo coverage checklist

**Auth**
- [ ] Splash/Login
- [ ] Forgot password
- [ ] Verify OTP
- [ ] Reset password (rules + strength)
- [ ] Client set-password

**Shell**
- [ ] Sidebar (grouped, collapsible, mobile drawer)
- [ ] Topbar with breadcrumbs
- [ ] Command palette (Ctrl/Cmd+K)
- [ ] Quick Actions
- [ ] Notification panel
- [ ] User menu
- [ ] Theme toggle
- [ ] Hearing alert toast
- [ ] AI assistant panel
- [ ] Toasts

**Practice**
- [ ] Dashboard: KPIs, today's hearings, deadlines/tasks, status breakdown, court stats, revenue snapshot, recent activity, quick actions
- [ ] Cases list: search, filter, sort, chips, table/board toggle, archived
- [ ] Add Case (import wizard + manual)
- [ ] Case detail: overview, parties, hearings, events, orders, expenses, invoices, tasks, notes, documents, related, acts, timeline
- [ ] Daily Causelist
- [ ] Display Board
- [ ] Clients list
- [ ] Client detail
- [ ] Hearings calendar (month/week/agenda) + add event
- [ ] Tasks with review workflow
- [ ] Documents (grid/list, filters, preview drawer, versions, share)
- [ ] Invoices (GST) + generate
- [ ] Payments
- [ ] Expenses + case financial overview
- [ ] Reports/analytics
- [ ] Notifications log
- [ ] Appeal Alert
- [ ] Acts + act detail
- [ ] Legal Dictionary
- [ ] Law Codes

**Drafting**
- [ ] Drafts
- [ ] New draft chooser/wizard
- [ ] Editor
- [ ] Templates
- [ ] Playbooks
- [ ] Translate

**Admin**
- [ ] Settings/Profile (General, Office, Branding, Security, Preferences, Billing)
- [ ] Users
- [ ] Roles
- [ ] System Activity + drawer
- [ ] Backup
- [ ] Communication (overview/settings/history)

**Client portal preview**
- [ ] Home, cases, invoices, documents

**States**
- [ ] Loading skeletons
- [ ] Empty states
- [ ] 404
- [ ] 403
- [ ] Error
- [ ] Modals
- [ ] Drawers
- [ ] Form validation
- [ ] Hover/focus/active
