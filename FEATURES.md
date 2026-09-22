# Advocate Management System (AMS) — Complete Feature & Capability Reference

> A full-stack legal practice management platform for Indian advocates and law firms.
> **Backend:** Django 5.1 (REST, JWT auth, PostgreSQL) — a drop-in, contract-compatible replacement for an earlier Spring Boot backend on the same database.
> **Frontend:** React 19 + React Router 7, Recharts, React Big Calendar, Axios, STOMP WebSocket.

This document catalogues **every** capability of the application — from the smallest UI affordance to the largest subsystem.

---

## Table of Contents

1. [Authentication, Accounts & Profile](#1-authentication-accounts--profile)
2. [Dashboard & Analytics](#2-dashboard--analytics)
3. [Case Management](#3-case-management)
4. [Case Workspace (Deep Case Tools)](#4-case-workspace-deep-case-tools)
5. [Client Management](#5-client-management)
6. [Hearings, Events & Calendar](#6-hearings-events--calendar)
7. [Documents & AI Summarization](#7-documents--ai-summarization)
8. [Tasks & Team Delegation](#8-tasks--team-delegation)
9. [Financials: Invoices, Expenses, Payments](#9-financials-invoices-expenses-payments)
10. [Reports Center & PDF Generation](#10-reports-center--pdf-generation)
11. [Court Integration (eCourts / High Court / Supreme Court)](#11-court-integration-ecourts--high-court--supreme-court)
12. [Cause Lists & Court Display Boards](#12-cause-lists--court-display-boards)
13. [Appeal Detection & Alerts](#13-appeal-detection--alerts)
14. [Legal Acts Library](#14-legal-acts-library)
15. [Legal Dictionary](#15-legal-dictionary)
16. [AI Assistant](#16-ai-assistant)
17. [Notifications & Communication (Email / WhatsApp / In-App)](#17-notifications--communication-email--whatsapp--in-app)
18. [Global Search & Quick Actions](#18-global-search--quick-actions)
19. [RBAC — Roles, Permissions & User Management](#19-rbac--roles-permissions--user-management)
20. [Multi-User Shared Practice (Firm Mode)](#20-multi-user-shared-practice-firm-mode)
21. [Audit Trail & System Activity](#21-audit-trail--system-activity)
22. [Backup & Restore](#22-backup--restore)
23. [Real-Time Updates (WebSocket)](#23-real-time-updates-websocket)
24. [UI/UX Platform Features](#24-uiux-platform-features)
25. [Administration & Operations (Management Commands)](#25-administration--operations-management-commands)
26. [Configuration & Environment](#26-configuration--environment)
27. [Technology Stack](#27-technology-stack)

---

## 1. Authentication, Accounts & Profile

**Login & session**
- Email + password login issuing a **JWT** (HS256, 24-hour expiry).
- Token stored in `localStorage`; sent as `Authorization: Bearer <token>` on every request.
- Automatic logout on `401` (Axios interceptor) and client-side JWT expiry check on load.
- Stateless logout endpoint.
- Public signup **disabled by default** (accounts created only via User Management).

**Password recovery flow**
- Forgot Password → email OTP → Verify OTP → Reset Password.
- OTP: salted SHA-256, 10-minute expiry, 5-attempt rate limit.

**User profile (5 tabs)**
1. **General** — full name, phone, specialization, experience, address, DOB, gender, enrollment date, bio, practice areas.
2. **Office** — office name, address, city/state/country/pincode, office phone/email, website, **GST number, PAN number**.
3. **Branding** — profile photo, office logo, signature image, office seal (uploads) + **primary/secondary brand colours** (used on PDF letterheads).
4. **Security** — password change with strength validation (8–32 chars, upper/lower/digit/special).
5. **Preferences** — theme (light/dark), language, time zone, currency, date format, auto-logout duration, default dashboard filter.

**Endpoints:** `POST /api/advocates/login`, `/signup`, `/logout`; `GET/PUT /api/advocates/profile`, `/settings`; `PATCH /api/advocates/notification-settings`; `GET /api/advocates/my-permissions`, `/my-roles`; `POST /api/auth/forgot-password`, `/verify-otp`, `/reset-password`; `GET/PUT /api/profile`, `/profile/preferences`; `POST /api/profile/change-password`, `/profile/branding/<type>`; asset serving via `/api/profile/files/...`.

---

## 2. Dashboard & Analytics

A single-shell dashboard with live-updating widgets.

**Statistics row (animated count-up):** Total Cases · Active Cases · Clients · Upcoming Hearings · Pending Invoices.

**Charts & widgets:**
- Case Status Overview (donut).
- Court Statistics (bar chart by court).
- Income vs Expense (area chart).
- Monthly Case Overview (area chart).
- Upcoming Hearings list.
- Recent Clients list.
- Invoices Summary with paid / unpaid / overdue breakdown.
- Activity Feed (recent actions).
- Tasks checklist.
- Documents statistics + recent documents.

**Live behaviour:**
- Auto-refresh every 30 seconds + refresh on window focus.
- "Live" indicator with last-updated timestamp.
- Client-side LRU cache (up to 20 entries) with request cancellation to avoid redundant calls.
- Permission-gated admin tiles (System Activity, User Management, Role Management, Backup) hidden when not permitted.

**Endpoint:** `GET /api/dashboard` (supports period filters).

---

## 3. Case Management

**Creating a case — two modes:**
1. **Manual entry** — type all details.
2. **Court Record Import** — look up the official court database by court ID / case type / case number / year and **auto-prefill** the case.

**Case list:**
- Columns: Case No., Title, Type, Status, Next Hearing, Tags, Client, Amount, Actions.
- Filters: status (Active/Pending/Closed), court level (District/High Court/Supreme Court), sort options.
- Real-time keyword search (case number, client name, email).
- Inline actions: View, Edit, Archive, Restore, Documents.
- Stat cards: Total, Active, Pending, Upcoming Hearings, Outstanding Dues.
- Pagination with adjustable page size.

**Case data model highlights:** case number, title, type, court level, status, description, and a full **financial ledger per case** — estimated amount, total client-agreed amount, total paid by client, total expenses so far, balance in account, pending from client. Case numbers are **unique per advocate** (not globally).

**Lifecycle:** soft-delete (archive) + restore; **transfer case** ownership to another advocate; **refresh court data** (re-scrape the latest record).

**Endpoints:** `GET /api/cases`, `/my-cases`, `/search`; `POST /api/cases/create`, `/restore/<id>`, `/transfer/<id>`; `PUT /api/cases/update/<id>`; `DELETE /api/cases/delete/<id>`; `GET /api/cases/transfer-targets`, `/<id>/hearing-alert`, `/<id>/timeline`.

---

## 4. Case Workspace (Deep Case Tools)

The Case Detail screen is a full workspace with an inline-editable header (title, status, type, court, client with auto-complete, invoiced amount) plus a **court identity strip** (CNR, Diary No., Registration No., stage, filing date, bench, coram). It exposes **13 tabs**:

1. **Parties** — add/edit/delete parties (Petitioner, Respondent, Appellant, etc.); mark opponents; track counsel & contact.
2. **Hearings** — manually-added upcoming hearings + imported **court hearing history**; purpose, court, bench/hall, judge, next date, outcome; daily court-business status viewer; copy listing to clipboard; SMS alert to client.
3. **Events** — non-hearing calendar entries (meetings, payment dues, document filings).
4. **Orders** — court orders imported from record (order number, date, judge, PDF download) + manual order upload.
5. **Expenses** — add/list case expenses.
6. **Invoices** — add invoices with line-item particulars; **one-click "bill from past hearing"** (appearance billing).
7. **Tasks** — create tasks (title, priority, deadline, assignee), attach documents, toggle completion, assign to team, cancel.
8. **Notes** — add/delete free-text case notes.
9. **Documents** — list/preview/download/version documents linked to case; bulk upload; AI summary modal.
10. **Related Cases** — link related cases (Appeal, Connected, Cross-Objection, Same Parties, Arising From, Other) with context notes.
11. **Acts** — view/link acts from the library; view **court-cited acts** auto-matched from the record; one-click link cited acts.
12. **Extra Details** — full court-record view (parties, orders, hearings, category breakdown) rendered per court system (eCourts / Madras / SCI).
13. **Timeline** — chronological visual timeline of hearings, orders, events, milestones.

**Workspace models:** CaseNote, CaseTag (labelled/coloured, unique per case), CaseTask (+ delegation), CaseTaskDocument, CaseParty, RelatedCase, HearingDetail (per-event metadata).

**Endpoints (selection):** `/api/workspace/cases/<id>/summary`, `/financials`, `/events`, `/parties`, `/notes`, `/tags`, `/related`, `/tasks`; `/api/workspace/stats`, `/next-hearings`, `/tags`, `/assignable-advocates`; plus delete endpoints for each child entity.

---

## 5. Client Management

- Client directory table: Name, Email, Phone, Address, City, GSTIN, Status, Actions.
- Create/Edit modal: name, description, website, billing currency, GSTIN, email, phone, full structured address (building, street, city, district, state, pincode, country).
- Real-time keyword search; soft archive + restore; pagination.
- Inline document modal (view & upload documents for a client).
- Client-scoped and firm-scoped visibility.

**Endpoints:** `GET /api/clients`, `/my-clients`, `/archived`, `/search`, `/<id>`; `POST /api/clients/create`, `/restore/<id>`; `PUT /api/clients/update/<id>`; `DELETE /api/clients/delete/<id>`. (Guarded by `CLIENT_VIEW`.)

---

## 6. Hearings, Events & Calendar

- **React Big Calendar** with Month / Week / Day / Agenda views.
- Event types: Hearing, Client Meeting, Payment Due, Document Filing.
- Hearing metadata: title, **purpose** (Arguments, Evidence, Framing of Issues, For Orders, Interim Application, Mention, Cross-examination, Other), court, bench/hall, judge, date, time, next hearing date, outcome.
- Create/edit/delete events; each linked to a case.
- "Today" and "Upcoming (30 days)" server views.
- Deep-link navigation from global search to a specific date/view.

**Endpoints:** `GET /api/events`, `/my-events`, `/today`, `/upcoming`; `POST /api/events/create`; `PUT /api/events/update/<id>`; `DELETE /api/events/delete/<id>`.

---

## 7. Documents & AI Summarization

**Centralized repository:**
- Multi-file drag-drop upload with **per-file progress**.
- Upload options: category (Court Order, Petition, Evidence, Agreement, Affidavit, Notice, Judgment, Invoice, Payment Receipt, Identity Proof, Address Proof, Other), link to case/client, name, description.
- Grid/list view toggle; search; filters by category, status (Active/Archived), file type (PDF, images, DOC, DOCX, ZIP).
- Document cards with thumbnail, category, version, and actions (preview, download, edit, delete).
- In-browser **preview** (PDF viewer, image viewer).
- **Version history** — old files preserved; any version downloadable.
- Download counter and storage stats.

**AI document summarization:**
- Triggered automatically on upload (background thread), with manual **regenerate**.
- Text extraction: PDF (pdfplumber), DOCX (python-docx), TXT — capped at ~24 KB.
- LLM produces a **12-field legal schema**: document type, summary, parties, court reference, key dates, reliefs sought, key facts, legal grounds, obligations, monetary amounts, action items, risks.
- Status lifecycle: PENDING → PROCESSING → READY / FAILED / UNSUPPORTED.
- Catch-up/backfill via `manage.py summarize_documents`.

**Endpoints:** `GET /api/documents` (+ `/list`, `/search`, `/filter`, `/stats`, `/by-case/<id>`, `/by-client/<id>`, `/<id>`); `POST /api/documents/upload`; `GET /api/documents/download/<id>`, `/preview/<id>`; `GET /api/documents/<id>/summary`, `/versions`, `/versions/<v>/download`; `POST /api/documents/<id>/summary/regenerate`.

---

## 8. Tasks & Team Delegation

- Create tasks with title, **priority (LOW/MEDIUM/HIGH)**, deadline, optional case link, and attached documents (with category picker).
- **Assign/delegate** to team members (gated by `TASK_ASSIGN`), with an assignable-advocate auto-complete.
- Filters — status: In Progress / Completed / Canceled; scope: Team / Mine / Created.
- Keyword search, pagination.
- Actions: toggle completion, change priority, cancel (soft), attach/detach documents.
- Task checklist surfaced on the dashboard and inside each case.

**Endpoints:** `GET /api/workspace/tasks/all`, `/cases/<id>/tasks`, `/tasks/<id>/documents`, `/assignable-advocates`; `POST /api/workspace/tasks/create`, `/tasks/<id>/assign`, `/tasks/<id>/cancel`, `/tasks/<id>/toggle`; `PUT /api/workspace/tasks/<id>/priority`; `DELETE` for tasks and task documents.

---

## 9. Financials: Invoices, Expenses, Payments

**Invoices**
- Create with line-item particulars (description + amount), invoice/due dates, case link.
- **Pre-fill from past hearing dates** (one-click appearance billing).
- List with status badges (Paid/Unpaid/Overdue); summary cards (paid, unpaid, overdue amounts & counts, monthly revenue).
- Mark invoice as paid; PDF invoice + payment receipt generation.
- **Endpoints:** `GET /api/invoices`, `/my-invoices`, `/summary`; `POST /api/invoices/create`, `/pay/<id>`.

**Expenses**
- Case-centric view: pick a case → see its expenses & payments.
- Create/edit/delete with title, amount, category, description, **payment mode** (Cash, Check, Transfer, Credit Card, Bank Deposit), status, reference number, payment date.
- Mark paid/unpaid; "Today's Summary" and "Monthly Report" modals; **CSV export**.
- Summary cards: total, pending, paid (case-wise).
- **Endpoints:** `GET /api/expenses`, `/my-expenses`, `/case/<id>`, `/search`, `/today`, `/monthly`; `POST /api/expenses/create`; `PUT /api/expenses/update/<id>`; `DELETE /api/expenses/delete/<id>`.

**Client Payments (income)**
- Record payments received per case/client with mode & reference.
- Today / monthly rollups.
- **Endpoints:** `GET /api/payments`, `/case/<id>`, `/today`, `/monthly`; `POST /api/payments/create`.

Together these feed a **per-case ledger** (agreed amount, paid, expenses, balance, pending).

---

## 10. Reports Center & PDF Generation

**Reports Center dashboard:**
- **Financial** — total income, total expenses, net profit, monthly revenue (with % change vs prior period); income-vs-expense and revenue-trend charts.
- **Cases** — totals by status (Active/Pending/Closed/Dismissed); status donut; court-wise distribution; creation/closure trend.
- **Clients** — total, new this month, status breakdown.
- **Hearings & Invoices** — upcoming hearings; invoice status breakdown; collection trend.
- Date filters: Today, Yesterday, Last 7/30 days, This Month, Last Month, This Year, Custom range.
- **Per-section CSV export** + full-dashboard **PDF export** (html2canvas + jsPDF client-side).

**Server-side PDF reports (ReportLab)** with firm-branded letterheads (logo, signature, seal, brand colours, ₹ formatting):
- Invoice PDF, Receipt PDF, Client detail PDF, Case detail PDF, Monthly summary PDF, filtered Expense PDF, Dashboard snapshot PDF.
- Data reports: cases, clients, expenses (CSV/JSON).

**Endpoints:** `GET /api/reports/cases`, `/clients`, `/expenses`; `/api/reports/invoice/<id>/pdf`, `/receipt/<id>/pdf`, `/client/<id>/pdf`, `/case/<id>/pdf`, `/monthly/pdf`, `/expense/pdf`, `/dashboard/pdf`; `/api/reports-center`, `/reports-center/export/csv`. (Guarded by `REPORT_VIEW`.)

---

## 11. Court Integration (eCourts / High Court / Supreme Court)

Deep integration with Indian court systems via an external scraper service, with caching.

**eCourts — District Courts (stateful cascade):** initial search, CNR lookup, cause-list search, full case detail, order/judgment document fetch (cached), generic cascade step router.

**eCourts — High Courts:** list high courts & benches, case types, act types, police stations, case search, cause-list search, case detail, CNR lookup, order-PDF (cached), hearing-business schedule.

**Supreme Court of India (SCI):** case-type lookup, case-number search, case detail, case section, **diary-number** search, CNR search, **AOR-code** search, party-name search; court types/states/benches/case-types and court search.

**Unified helpers:** cross-forum search and CNR search (tries District + High Court concurrently, returns whichever matches).

**Case import & refresh:** imported records are snapshotted (`ImportedCaseRecord` with the full raw API response); re-fetch a case's court data on demand. Case-type maps cached per court (`CourtCaseTypes`).

**Immutable PDF cache:** court orders/judgments cached by content hash.

**Endpoints:** under `/api/courtsearch/...` — `courts`, `courts/<id>/case-types`, `search`, `cnr`, `ecourts/*`, `sci/*`, `hc/*`, `imported-records`, `cases/<id>/refresh`.

---

## 12. Cause Lists & Court Display Boards

**Daily Cause List:** date picker (defaults to today, capped at today); listings grouped by court; shows case number/string, court, item number, "your item" position; SMS alert to client for a listing; indicator of which courts are covered.

**Live Display Board:** court selector (with bench toggle for multi-bench courts like Madras/Kerala; SCI merges Regular + Video Conferencing boards); dynamic columns (Item, Your Item, List Type, Case No., Title, Judges, Court Number, Status) shown only when data exists; **highlights cases belonging to the practice**; auto-refresh with last-fetched indicator.

**Endpoints:** `GET /api/causelist/my-forums`, `/my-listings`; `GET /api/workspace/display-board`, `/display-board/courts`. Synced by `manage.py sync_causelist`.

---

## 13. Appeal Detection & Alerts

- Nightly sweep (`manage.py scan_appeals`) that detects **appeals filed in higher courts** (High Court / Supreme Court) against the advocate's decided cases.
- Records matches with forum, appeal case number, CNR, parties, filed date, match score, and status (NEW / CONFIRMED / DISMISSED).
- Deduplicated per (advocate, source case, appeal CNR); notifies via in-app + email.
- Manual confirm/dismiss workflow in the UI (Appeal Alert page).

**Endpoints:** `GET /api/appeal-detections`; `GET/PUT /api/appeal-detections/<id>`.

---

## 14. Legal Acts Library

- Browse/search a large library of Indian **central + state acts** (read-only, sourced from a separate importer project).
- Search fields (selectable chips): All, Short Title, Long Title, Department, Section Title, Section Contents, Act Number, Act Year; jurisdiction filter (All / Central / Tamil Nadu); debounced input; year-parse validation.
- Act detail: metadata (title, year, jurisdiction, department), chapters & searchable **sections** (number, title, content, footnote); copy section text; link act to a case.
- **Cited acts:** acts referenced in a court record are auto-matched to the library and can be linked in one click.
- Advocate-created act↔case links (`ActCaseLink`), unique per (act, case).

**Endpoints:** `GET /api/acts`, `/acts/<id>`, `/acts/<id>/sections/<sid>`, `/acts/<id>/cases`; `GET /api/cases/<id>/acts`, `/cases/<id>/cited-acts`; `DELETE` unlink endpoints. Search index built by `manage.py index_acts_search`.

---

## 15. Legal Dictionary

- Searchable glossary of legal terms for Indian practice (term, normalized lookup key, refined definition, letter, source).
- Imported from public-domain sources (Black's 1910, IndiaCode, LawLexicon) and **LLM-refined** for clarity.
- `DefinableText` UI component surfaces click/hover definitions inline across the app.

**Endpoints:** `GET /api/dictionary/search?q=`, `/dictionary/term/<id>`. Data via `import_legal_terms`, `import_indiacode_terms`, `import_lawlexicon_terms`, `refine_definitions`.

---

## 16. AI Assistant

A floating chat panel with two modes:

**Rule-based command router** (`/api/assistant/query`) — intent matching for:
- **Navigation:** open Cases, Dashboard, Clients, Expenses, Calendar, Documents, Invoices, Settings, Reports.
- **Data queries:** today's/upcoming hearings, pending invoices, today's/monthly expenses, monthly income, active-case count, client count, hearing counts.
- **Search:** find client / case / invoice X (with "X's cases" natural-language resolution).
- **Create modals:** create client, add case, new expense, schedule hearing, generate invoice.
- **Refresh dashboard.**

**LLM chat** (`/api/assistant/chat`) — streaming **SSE** conversation grounded strictly in the logged-in advocate's data (read-only context: caseload, case details, invoices, payments, tasks).
- Pluggable provider: **local** (ngrok-hosted), **Google Gemini**, or **OpenAI**.
- Temperature 0.2; system prompt forbids hallucination; context capped (≈2 cases/query) to stay within token budget.

---

## 17. Notifications & Communication (Email / WhatsApp / In-App)

**Notification engine:**
- Reminder types: hearings within next 2 days, overdue invoices, overdue tasks.
- Channels: **Email (SMTP)**, **in-app/browser**, **WhatsApp** (Meta Business API — present but disabled by default).
- Asynchronous **queue** with retry/backoff and error tracking; idempotency (checks queue + history before duplicating).
- In-app notifications with read/unread state and a bell icon (unread count + dropdown); hearing alert popups.

**Notifications Center (UI):** stats (total sent, emails today, WhatsApp today, failed, pending); history table (timestamp, event type, channel, status, recipient, message) with filters; per-channel enable/disable settings.

**Communication module:**
- Dashboard with channel status indicators (Connected/Failing/Not Configured/Off) and quick stats.
- Settings: SMTP host/port/sender/password, signature, retry config, reply-to, office address; WhatsApp access token / phone number / business account IDs; enable toggles; **test email**.
- History, detailed logs, queue status, CSV export; manual send & **resend** of failed messages; WhatsApp webhook (HMAC-verified).

**Endpoints:** `GET /api/notifications`, `/unread`, `/history`, `/history/filter`, `/history/stats`; `PUT /api/notifications/<id>/read`; `POST /api/notifications/trigger-check`. `GET/PUT /api/communication/settings`; `/communication/history`, `/statistics`, `/logs`, `/queue/status`, `/export/csv`; `POST /api/communication/test`; `/api/whatsapp/webhook`, `/send-manual`, `/resend/<id>`.

**Ops:** `scan_notifications`, `process_notifications`, `run_scheduler` management commands.

---

## 18. Global Search & Quick Actions

- **Ctrl+K global search** across cases, clients, documents, invoices, expenses, tasks, events, hearings, and payments — up to 5 results per category, each navigating to the right screen.
- **Quick Actions modal:** one-click create for Case, Client, Invoice, Expense, Hearing, Task, and Document upload.

**Endpoints:** `GET /api/search?q=` (and `/search/global`).

---

## 19. RBAC — Roles, Permissions & User Management

**Roles & permissions:**
- Roles (name, description) with assignable permission sets; permissions are module-scoped.
- Permission codes include: `CASE_CREATE`, `CASE_EDIT/UPDATE`, `CASE_DELETE`, `CASE_VIEW`/`CASE_VIEW_ALL`, `CLIENT_VIEW`, `DOCUMENT_VIEW`, `DOCUMENT_UPLOAD`, `REPORT_VIEW`, `TASK_ASSIGN`, `AUDIT_VIEW`, `USER_MANAGE`, `ROLE_MANAGE`, `BACKUP_MANAGE`.
- Permission resolution: advocate → roles → role-permissions → permissions; enforced server-side via `RequirePermission` and client-side via `PermissionRoute` + hidden sidebar items.

**Role Management UI:** list/create/edit/delete roles; multi-select permission assignment.

**User Management UI:** list users (name, email, phone, Bar Council ID, specialization, experience, roles); create user (with initial password, roles, and **practice owner**); edit; soft-delete; assign/revoke roles.

**Endpoints:** `GET /api/roles`, `/roles/<id>`, `/roles/<id>/permissions`, `/permissions`; admin: `GET /api/admin/users`, `GET/PUT/DELETE /api/admin/users/<id>`, `GET/POST/DELETE /api/admin/users/<id>/roles`, `POST/DELETE /api/admin/users/<id>/roles/<role_id>`.

**Seed commands:** `seed_admin_permissions`, `seed_firm_wide_scope`, `seed_task_permissions`.

---

## 20. Multi-User Shared Practice (Firm Mode)

- Advocates can belong to a shared **practice/firm** via `parent_advocate_id` (owner = NULL parent); departures tracked with `left_on`.
- Firm-wide visibility: cases/clients/etc. are scoped to the set of practice member IDs, so senior advocates see the team's caseload; former members lose access while their data stays intact.
- Task delegation, case transfer, and "assignable advocates" all operate within the practice.
- Enabled/migrated via `enable_shared_practice`; case-number uniqueness scoped per advocate via `scope_case_numbers`.

---

## 21. Audit Trail & System Activity

- **Middleware** records every state-changing request (POST/PUT/DELETE) to an audit log: action type, module, entity type/id, status, user, IP, device, browser, OS, request method/URI, metadata, timestamp.
- Tracked actions include login/logout/failed-login, password/profile changes, CRUD on clients/cases/hearings/documents/expenses/invoices, email/WhatsApp sends, and exports.
- **System Activity UI:** filterable audit table (action, module, status, date range, user) with CSV export and device/browser detection.
- Separate lightweight per-user **Activity** feed.

**Endpoints:** `GET /api/audit`, `/activities`, `/activities/my-activities`. Retention via `prune_audit_log`.

---

## 22. Backup & Restore

- Backup types: **Quick, Full (data + documents), Database-only, Documents, Reports, Settings**.
- Restore from a backup file, validate integrity, view history & stats, download, delete.
- Backup records track file name, size, checksum, duration, metadata, and status.

**Endpoints:** `POST /api/backup/quick`, `/full`, `/database`, `/documents`, `/reports`, `/settings`, `/restore`, `/validate`; `GET /api/backup/history`, `/stats`, `/download/<id>`; `DELETE /api/backup/<id>`. (Guarded by `BACKUP_MANAGE`.)

---

## 23. Real-Time Updates (WebSocket)

- **STOMP over WebSocket** provider on the frontend with subscription hooks (`useWebSocket`, `useNotificationListener`).
- Drives live dashboard refresh, notification push, and case-change updates.
- Backend uses Django Channels (in-memory layer; full WS backend deferred), complemented by polling + on-focus refresh.

---

## 24. UI/UX Platform Features

- **Dark/light theme** toggle, persisted per user.
- **Responsive layout:** collapsible desktop sidebar, mobile drawer, horizontal-scroll tables.
- **Loading system:** global loader, inline/table/page loaders, button spinners, and rich **skeletons** (cards, charts, lists, hearing/task/invoice/doc placeholders).
- **Toasts** (success/error/warning/info) via global context.
- **Reusable modals, pagination controls, async searchable selects, loading buttons.**
- **Count-up animations** on metrics; smooth transitions; empty-state messaging.
- **Keyboard shortcuts:** Ctrl+K search, Esc to close modals/sidebar.
- **Error boundary** with fallback UI.
- **Context providers:** Theme, Loading, Toast, Permission, Sidebar, DashboardFilter, Search, Assistant, WebSocket.
- **Hooks:** debounced value, download state, pagination, notification listener, WebSocket.
- Consistent card patterns (stat/document/client/case/hearing cards) and chart set (pie/donut, bar, area) with tooltips and legends.

---

## 25. Administration & Operations (Management Commands)

| Command | Purpose |
|---|---|
| `seed_demo` | Seed the "Kumar & Associates" demo practice (users, clients, ~15 cases, hearings, tasks, notes, expenses, invoices). |
| `seed_demo_branding` | Add branding assets to the demo practice. |
| `seed_admin_permissions` | Initialize Super Admin / Accountant role permissions. |
| `seed_firm_wide_scope` | Grant firm-wide admin permission scope. |
| `seed_task_permissions` | Seed task-related permissions. |
| `scan_notifications` | Queue due reminders (hearings, overdue invoices/tasks). |
| `process_notifications` | Drain the notification queue (send emails, retry failures). |
| `run_scheduler` | Long-running scheduler daemon. |
| `summarize_documents` | Backfill/catch-up document AI summaries (+ `.bat` wrapper). |
| `scan_appeals` | Nightly appeal detection sweep. |
| `refresh_case_types` | Refresh cached court case-type maps. |
| `sync_causelist` | Sync court cause lists into the DB. |
| `backfill_court_data` | Import historical court data. |
| `index_acts_search` | Build the acts full-text search index. |
| `import_legal_terms` / `import_indiacode_terms` / `import_lawlexicon_terms` | Import dictionary terms. |
| `refine_definitions` | LLM-refine dictionary definitions. |
| `add_notification_links` | Backfill notification entity links. |
| `enable_shared_practice` | Add shared-practice columns (one-time). |
| `scope_case_numbers` | Add per-advocate case-number uniqueness constraint. |
| `prune_audit_log` | Enforce audit-log retention. |

Plus a **health check** endpoint: `GET /api/health`.

---

## 26. Configuration & Environment

- **Auth:** JWT (HS256), 24h expiry.
- **Pagination:** Spring-style, 20 items/page.
- **CORS:** configured for Vite dev servers (5173/5174).
- **Time zone:** Asia/Kolkata (naive local time).
- **Storage:** document upload dir (shared with the legacy Spring uploads) + content-addressed court-PDF cache; ~25 MB max upload.
- **Email:** SMTP (Gmail default), console backend for local dev; no default credentials.
- **LLM:** provider selectable (`local` / `gemini` / `openai`); configurable base URL, model, API keys, temperature, timeout.
- **Feature flags:** `ALLOW_PUBLIC_SIGNUP` (off), `WHATSAPP_ENABLED` (off), `SUMMARY_ENABLED` (on), `SUMMARY_MAX_CHARS` (~24000), OTP expiry/rate-limit.
- **Data model note:** most core tables are **unmanaged** (owned by the original Spring schema) for drop-in compatibility; new features (document summaries/versions, workspace notes/tags/tasks/parties/related cases, appeal detection, court-search caches, act links, dictionary) use Django-managed tables.

---

## 27. Technology Stack

**Backend:** Django 5.1 · Django REST Framework · Django Channels · PostgreSQL · custom JWT auth · bcrypt passwords · ReportLab (PDF) · pdfplumber / python-docx (text extraction) · pluggable LLM clients (local/Gemini/OpenAI).

**Frontend:** React 19.1 · React Router 7.9 · Axios · Recharts · React Big Calendar · React Select · React Icons · jsPDF + html2canvas · @stomp/stompjs (WebSocket) · jwt-decode · moment.

**Integrations:** eCourts (District & High Courts) · Supreme Court of India · court display boards & cause lists · SMTP email · WhatsApp Business API (optional) · LLM providers.

---

### One-line summary

AMS is an end-to-end legal practice platform: **case & client management, a 13-tab case workspace, hearings/calendar, AI-summarized documents, tasks & delegation, full financials (invoices/expenses/payments), branded PDF reports & analytics, live court integration (eCourts/HC/SCI) with cause lists, display boards and appeal detection, an acts library and legal dictionary, an AI assistant, multi-channel notifications, RBAC with shared-firm mode, audit logging, and backup/restore** — with a real-time, themeable React UI.
