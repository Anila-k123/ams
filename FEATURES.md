# Advocate Management System (AMS) — Complete Feature & Capability Reference

> A full-stack legal practice management platform for Indian advocates and law firms.
> **Backend:** Django 5.1 (REST, JWT auth, PostgreSQL) — a drop-in, contract-compatible replacement for an earlier Spring Boot backend on the same database.
> **Frontend:** React 19 + React Router 7, Recharts, Axios, the Red Tape design system (`src/ui`), STOMP WebSocket.

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
16. [AI Assistant](#16-ai-assistant) (and [16a. AI usage metering](#16a-ai-usage-metering))
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
1. **Court Record Import** — look up the official court database by court ID / case type / case number / year and **auto-prefill** the case. Parties and upcoming hearings come with it.
2. **Offline / Manual Entry** — for whatever the import can't fetch:
   - forums not on eCourts (tribunals such as NCLT, DRT, consumer commissions and RERA; revenue courts; arbitration);
   - matters **not filed yet**, and **non-litigation** work (notices, advisory, contracts);
   - records that aren't online;
   - cases with no CNR yet;
   - times when the court site is down.

   The form asks for:
   - **Matter type:** Litigation, Not filed yet, or Non-litigation. A case number is required only for litigation; the others get `PRE/<year>/0001` or `MAT/<year>/0001`.
   - **Our client is the** (Plaintiff / Petitioner / Appellant / Applicant / Complainant, or the opposite), plus the **opposite party** and their **counsel**.
   - **For litigation:** court / tribunal / forum, court hall, judge, filing date, case year, an optional **CNR**, and the **next hearing date and purpose**.
   - **Acts / sections**, and the **Agreed fee (₹)**, which drives "pending from client".

   On save, the client and the opposite party go on the Parties tab and the next hearing becomes an event, as an import would do. The extra details are stored in `workspace.CaseProfile` (`case_profile`), at `GET/PUT /api/workspace/cases/<id>/profile`.
3. **Link to court record** (Case Detail → Actions, for a case with no court record):
   - Enter the CNR, check the record that's found, then **Link this record**.
   - The court record, its parties (skipping ones already on the case) and its upcoming hearings are added to the **existing** case. Notes, tasks, documents and bills are kept.
   - The CNR is saved on the case, and **importing the same CNR again is refused** (409), so no duplicate is created.
   - Works for District and High Courts through the CNR lookup; Supreme Court CNRs aren't covered.

**Case list:**
- Columns: Case No., Title, Type, Status, Next Hearing, Tags, Client, Agreed fee, Actions.
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
- Create/Edit modal: name, description, website, GSTIN, email, phone, full structured address (building, street, city, district, **state from a list of Indian states and UTs**, pincode, country, which defaults to India). Billing currency is always INR, with no picker; it's set by the form.
  - The fields the Spring `clients` table has no columns for (description, website, billing currency, GSTIN and the address parts) are stored in the managed `client_profile` table (`clients.ClientProfile`). They used to be accepted and silently dropped. `clients.address` is rebuilt from the parts as one line (e.g. *No. 3, Gandhi Street, Tambaram, Chengalpattu, Tamil Nadu - 600045, India*), so reports, PDFs and the client portal keep reading it. A client saved before this keeps their old `address` when edited with empty parts; the edit form shows it as an editable *Saved address* field until the parts are filled in, which replaces it. An edit no longer wipes `address`, which it used to on every save.
- Real-time keyword search; soft archive + restore; pagination.
- **Handling advocate:** whoever adds or edits a client (the advocate who met them; there is no front-desk role) can name the advocate who will take the matter. Only active practice members with `CASE_CREATE` are offered (`GET /api/clients/handlers`). That advocate gets an immediate in-app notice, plus email if their email notifications are on: *"New client assigned to you - <name>"*, with the client's contact details and who added them. The case details reach them outside the app for now; no case is created. Re-saving the same pick sends nothing, and an edit that doesn't send `handlingAdvocateId` leaves the pick alone. Stored in the managed `client_handler` table (`clients.ClientHandler`, one row per client). The list shows it in an **Advocate** column.
- Inline document modal (view & upload documents for a client).
- Client-scoped and firm-scoped visibility.

**Endpoints:** `GET /api/clients`, `/my-clients`, `/archived`, `/search`, `/handlers`, `/<id>`; `POST /api/clients/create`, `/restore/<id>`; `PUT /api/clients/update/<id>`; `DELETE /api/clients/delete/<id>`. (Guarded by `CLIENT_VIEW`.)

---

## 5a. Format validation

Every form field that takes a structured value is checked in the browser (as you leave the field, and again on save) and again on the server. The rules are the same on both sides (`src/utils/validators.ts`, `core/validators.py`).

| Value | Rule | Where |
|---|---|---|
| **GSTIN** | 15 characters: state code, PAN, entity number, `Z`, check character. The state code must be real and the **check digit must match**. Saved uppercase | Client form, invoice recipient, firm GST number (Profile → Office) |
| **PAN** | 5 letters, 4 digits, 1 letter; saved uppercase | Profile → Office |
| **PIN code** | 6 digits, not starting with 0 | Client form, Profile → Office |
| **Phone** | 10-digit Indian number (`+91` or a leading `0` optional), or an international number with its country code | Client form, Profile, Settings, User Management |
| **Email** | A valid address; saved lowercase | Client form, Profile → Office, billing remittance email, User Management, client portal invite |
| **IFSC** | 4 letters, `0`, 6 letters or digits; saved uppercase | Settings → Invoice billing |

- **GSTIN fills in the state.** A valid GSTIN fills the State from its first two digits: on the client form, on the invoice (State and State Code), and for the office on the Profile page. If a different state is already chosen, an amber warning says the GSTIN belongs to another state.
- **Empty is always allowed.** Whether a field is required is decided by the form.
- **Server errors** come back as a 400 `{error, errors: {field: message}}`.

## 6. Hearings, Events & Calendar

- **Calendar** (Red Tape, the app's own grid) with **Day / Week / Month** views. The period on screen is shown between Prev and Next. There's no "Today" button and no Agenda view, by the firm's decision. Clicking an empty part of a day adds an event on it.
- Event types: Hearing, Client Meeting, Payment Due, Document Filing.
- Hearing metadata: title, **purpose** (Arguments, Evidence, Framing of Issues, For Orders, Interim Application, Mention, Cross-examination, Other), court, bench/hall, judge, date, time, next hearing date, outcome.
- Create/edit/delete events; each linked to a case.
- "Today" and "Upcoming (30 days)" server views.
- Deep-link navigation from global search to a specific date/view.
- **Task deadlines on the calendar:** open tasks the user can see (the Tasks page's own list, `/api/workspace/tasks/all`) appear on their deadline date as outlined "✓ Task: …" items, red when overdue; clicking one opens it on the Tasks page. They are shown, not stored as events, so they never go stale or raise hearing reminders. They show for users with `TASK_VIEW`. The type-filter chips above the calendar (Hearing, Client meeting, Payment due, Document filing, Task deadlines) can hide any type, tasks included.

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
- **Only the task's owner changes its terms.** The owner is the person who assigned it, or the creator for a task with no assigner (`workspace.views.task_owner_id`). Only they can change the **priority**, **cancel / restore** or delete it. The assignee and the rest of the team see the priority but can't change it. The server enforces this (403); the Tasks page and Case Detail → Tasks only show the dropdown and cancel button to the owner.
- Filters — status: In Progress / Completed / Canceled; scope: Team / Mine / Created.
- **What to do first:**
  - The deadline chip shows urgency on open tasks: **Overdue · N days** (red), **Due today** (orange), **Due tomorrow / in N days** within 3 days (amber), otherwise the date.
  - Each card has a coloured left edge and a flag for its priority: High red, Medium amber, Low green.
  - In Progress and To review list the most urgent first: overdue, today, soonest, then no deadline. Within a day, High comes before Medium before Low.
  - A row of counts sits above the list: *N overdue · N due today · N due this week · N high priority*. Clicking one narrows the list; **Show all** clears it. All of this is worked out in the browser (`TasksPage.tsx`, `deadlineState`), with no API change.
- Keyword search, pagination.
- Actions: toggle completion, change priority, cancel (soft), attach/detach documents.
- Task checklist surfaced on the dashboard and inside each case.
- **Submitted work** on a delegated task shows as one summary line (who, when, hours, number of submissions) with **View work**. That opens *Submitted work — {task}*: task facts, the reviewer's note, every submission's full report (newest first), attachments and the draft link, and, for the reviewer, **Approve** / **Request changes**. It's the same on the Tasks page and on Case Detail → Tasks (`SubmissionHistory` in `components/TaskReview.tsx`).
- **Client documents can be deleted from the client panel** (Clients → a client → Documents → ⋯ → **Delete**), for roles with `DOCUMENT_DELETE`, after the same confirmation as the Documents page (`DELETE /api/documents/{id}`).
- **Profile photo and branding images can be removed.** Settings → Profile has **Remove photo** (initials show again), and Branding has **Remove** on the office logo, signature and seal, each after a confirmation. `DELETE /api/profile/branding/{photo|logo|signature|seal}` clears the field and deletes the stored file. The top bar updates at once (the page fires `profile-updated`, which the shell listens for).
- **No duplicate events.** Creating an event that is already on the case (same date, type and title, case and spacing ignored; same time when both have one) is refused with the existing event (`events/views.py` `_find_duplicate`, HTTP 409). The Calendar and the case page's Add hearing then show *This event already exists* (`components/DuplicateEventDialog.tsx`): **Open existing**, **Cancel**, or **Add anyway** (`allowDuplicate`). A repeat would also notify the client and the team twice. Court-record imports skip a hearing that is already there.
- **Draft status on the Drafts list** is what the draft is ready for, not just whether the AI finished: **Generating** (queued or being written), **Failed**, **Incomplete** (generated, but fields are still empty, shown as "*n* fields empty"), **Complete** (every field filled) and **Filed** (saved to the case; a filed draft with blanks still shows how many). The stored `DraftSession.status` keeps tracking only the AI job; the count of empty fields comes from `unfilled_count` on the session (`drafting/serializers.py`), counted the way the editor counts them (each empty `[[Label]]` once, plus legacy `____` blanks).
- **Placeholder fields check their input by name** (`components/DocumentPlaceholders.tsx`, `fieldKind`). The model names the fields, so the type is inferred from the label: *Year* takes 4 digits only, *PIN code* 6 digits, *Phone / Mobile* digits with an optional leading +, *Amount / Fee / Rent / Price…* digits with commas and one decimal point, *Age / Days / Months / Percentage / Number of…* digits and one decimal point. Letters typed or pasted are dropped, and an incomplete year, PIN or phone shows a short note. Anything else, including *Case Number*, stays free text, as do *Financial / Assessment Year* and *Amount in words*.
- **Saving a draft with empty fields asks first.** In the editor, **Save to case** / **Submit to task** with blanks left opens *This draft still has n empty fields*, naming the first few. **Go back and fill** puts the cursor in the first empty field; **Save anyway** / **Submit anyway** files it as it is (for a partial draft a senior will finish).
- **Draft revisions show what changed.** Each draft filed to a task (**Submit to task**) stores a snapshot of its sections (`TaskSubmission.draft_snapshot`, server-side only). The next submission is compared with it section by section (`workspace/review.compare_drafts`: matched by heading, then position), and the result is saved as `changes`: *edited*, *added* or *removed*, with before and after text.
  - **For the junior:** resubmitting after **Changes requested** asks *What did you change?*, and the answer is added to the submission note.
  - **For the senior:** the changes appear as a word-level diff (`components/DraftChanges.tsx`; added words green and underlined, removed words red with strikethrough), in **View work** and in the drafting editor's review bar (*Changed since the last version: Reliefs claimed (edited)* with **What changed**). He can check a revision without rereading the whole draft.

**Endpoints:** `GET /api/workspace/tasks/all`, `/cases/<id>/tasks`, `/tasks/<id>/documents`, `/assignable-advocates`; `POST /api/workspace/tasks/create`, `/tasks/<id>/assign`, `/tasks/<id>/cancel`, `/tasks/<id>/toggle`; `PUT /api/workspace/tasks/<id>/priority`; `DELETE` for tasks and task documents.

---

## 9. Financials: Invoices, Expenses, Payments

**Case money totals.** Each case keeps running totals (`total_paid_by_client`, `total_expenses_so_far`, `balance_in_account`, `pending_from_client`), shown in the Expenses list, the case workspace, the client portal and the dashboard's outstanding total. `core/finance.recalc_case_totals` recomputes them after every payment, every expense created, edited, moved or deleted, every invoice, and every change to the case fee.
- balance = paid − expenses
- pending = owed − paid (never below 0), where owed is the agreed fee if one is set, otherwise the case's invoice total.

They were never updated before, so every case showed ₹0. `manage.py recalc_case_totals` rebuilds them for existing cases.

**Invoices**
- Create with line-item particulars (description + amount), invoice/due dates, case link.
- **Pre-fill from past hearing dates** (one-click appearance billing).
- List with status badges (Paid / Part-paid / Unpaid / Overdue / Cancelled), **Raised by** and **Handled by**. Summary cards show paid, unpaid and overdue amounts and counts, plus monthly revenue. Part-paid invoices count only their balance as outstanding.
- PDF invoice + payment receipt generation.
- **Recipient pre-fill:** picking the case in *Generate Invoice* fills the blank recipient fields from `GET /api/invoices/recipient-defaults?caseId=`. The client's record comes first: GSTIN, state, and the address from the client form, with the **state code taken from the GSTIN's first two digits** (33 = Tamil Nadu). The client's last invoice fills the rest (e.g. Kind Attn). Switching cases replaces the suggestions but keeps anything typed over them. `POST /create` applies the same defaults to blank fields, so API callers get them too.
- **Advocate raises, accounts issue.** Any advocate on the case's team, senior or not, can raise its invoice (`INVOICE_CREATE`). Issuing it takes `INVOICE_ISSUE`, which only the Accountant and Super Admin have, so every bill goes through accounts. Issuing is what numbers the invoice, counts it in the totals and sends it to the client.
  - With `INVOICE_ISSUE`, *Generate Invoice* (and the case page's *Raise Invoice*) issues straight away.
  - Without it, the button says **Send to Accounts**. The invoice is saved as an `invoice_request` (*With accounts*). It has no number and is not in any total, report, reminder or the client portal.
  - Accounts are notified (`INVOICE_SUBMITTED`). On the Invoices page under **Waiting to be issued** they **Review** it. That card is always shown to those who issue ("Nothing waiting" when empty). They can correct any field, then **Issue Invoice**, or **Return to Advocate** with a note (required).
  - A returned invoice notifies the advocate (`INVOICE_RETURNED`) and shows the note. The advocate uses **Edit & Resend**, which notifies accounts again. The advocate can also **Withdraw** it while it waits.
  - On issue, the invoice's advocate is the one who raised it ("raised by"). That advocate is told its number (`INVOICE_GENERATED`), the client gets the usual invoice email, and accounts get the "to collect" notice.
  - Setup: `manage.py seed_invoice_permissions` creates `INVOICE_ISSUE` and gives the Advocate role `INVOICE_VIEW` + `INVOICE_CREATE`.
- **After issue, accounts own the invoice.** Recording payments (`PAYMENT_CREATE`), Mark Paid and Cancel (`INVOICE_EDIT`) belong to the Accountant and Super Admin. A Senior Advocate can do none of these, nor issue (`seed_invoice_permissions` removes them).
  - **Record Payment** on an invoice row (`PAYMENT_CREATE`) records a client payment linked to that invoice (`payment_invoice`). The Expenses page's payment form can do the same with **Against invoice**. The amount defaults to the balance and can be lowered for a part-payment; more than the balance is refused.
  - The invoice moves **Unpaid -> Part-paid -> Paid** on its own (`core.finance.recalc_invoice_status`). The row shows *Paid X · Due Y*.
  - **Mark Paid** remains for money already recorded without a link. It is shown only while nothing has been paid against the invoice.
  - **Cancel** (`INVOICE_EDIT`, reason required): an issued GST invoice is never edited or deleted. A wrong one is cancelled and a new one raised. The cancelled invoice keeps its number and shows its reason, but is out of every total, report, reminder, Lisa answer and the client portal's dues (`Invoice.objects.billable()` / `.open()`). An invoice with money received on it cannot be cancelled.
  - **Issuing is what tells the client.** Under each invoice number: *Issued <date> · client emailed*, or *client not emailed* when the email was skipped (no email on file, or client email switched off). This is recorded in `invoice_handling.client_notified_at`.
  - **Raised by** is the invoice's advocate. **Handled by** is whoever issued it (`invoice_handling.issued_by_id`), i.e. whom to ask about collecting it. Invoices from before this show their advocate.
- **Endpoints:** `GET /api/invoices`, `/my-invoices`, `/summary`, `/recipient-defaults`; `POST /api/invoices/create` (`INVOICE_ISSUE`), `/pay/<id>`, `/<id>/cancel` (`INVOICE_EDIT`); `POST /api/payments/create` takes an optional `invoiceId`. Requests: `GET|POST /api/invoices/requests`, `PUT|DELETE /api/invoices/requests/<id>` (the raiser), `POST /api/invoices/requests/<id>/issue`, `/return` (`INVOICE_ISSUE`).

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

## 16a. AI usage metering

For future usage-based pricing, every LLM call is recorded (`metering` app, table `llm_usage`). Each row holds: user, firm, feature (`chat` / `summary` / `draft` / `translation`), operation (e.g. `draft.generate`, `draft.refine`), provider, model, input and output tokens, duration, success, and what it was for (draft session, document).

- **Where it's captured.** Every call goes through one of two wrappers, so both record usage:
  - `assistant/llm.py`: Lisa's streamed answers (with `stream_options.include_usage`), and `complete_text`, which document summaries use.
  - `drafting/providers/llm.py` `LLMProvider.complete`, for every drafting call: Anthropic `usage`, the OpenAI/Gemini stream's final usage chunk, or Ollama's counts.

  Sarvam translation is recorded in characters.
- **Who it's charged to.** Context comes from `metering.usage.metering(...)`, set where the work starts:
  - the chat view, as the signed-in user;
  - the summarizer, as the document's advocate;
  - each drafting background task, as the row's owner (the decorator in `drafting/tasks.py`);
  - drafting's edit, refine and consistency actions, as the signed-in user.
- **No usage from the provider.** Tokens are estimated (about 4 characters per token) and the row is flagged `estimated`.
- **Recording never breaks the call it measures.** Write errors are logged and dropped.
- **Reports:**
  - `manage.py llm_usage --by feature|operation|user|firm|model [--from --to]`;
  - `GET /api/usage/summary` (Super Admin).

  Both show calls, tokens and estimated cost from `LLM_PRICES` (per 1M tokens, by model).
- **Measured live** (gpt-4o): one Lisa answer used about 6,000 input tokens (the case-data context) and about 10 output tokens, so chat cost is dominated by input.

## 16. AI Assistant

A floating chat panel with two modes:

**How messages are routed:** every typed message goes to the AI (below), which can also open pages and forms itself through action tools (`open_page`, `open_form`, `search_in_page`, `open_case`; each permission-checked). The quick buttons send exact command names. The phrase matcher below is used only as **basic mode**, when the AI is not configured or unreachable — no typed message is matched by phrase first, so new wordings never need rules. Details: `docs/AI_ASSISTANT.md`.

**Rule-based command router — basic mode only** (`/api/assistant/query` with `{query}`; the quick buttons use `{command}`) — intent matching for:
- **Navigation:** open Cases, Dashboard, Clients, Expenses, Calendar, Documents, Invoices, Settings, Reports.
- **Data queries:** today's/upcoming hearings, pending invoices, today's/monthly expenses, monthly income, active-case count, client count, hearing counts.
- **Search:** find client / case / invoice X (with "X's cases" natural-language resolution).
- **Create modals:** create client, add case, new expense, schedule hearing, generate invoice.
- **Refresh dashboard.**

**LLM chat** (`/api/assistant/chat`) — streaming **SSE** conversation grounded strictly in the user's data. Full design: `docs/AI_ASSISTANT.md`.
- **Tool calling** (OpenAI / Gemini, `ASSISTANT_TOOL_CALLING=auto`): the model is offered only the tools the user's role may use (find a case, hearings between two dates, my tasks, overdue tasks, pending invoices, court record, ...) and fetches exactly what the question needs, up to 5 rounds. A local model, or a failed tool request, falls back to the pre-built context brief described below.
- **Case search** (`assistant/search.py`): one ranked PostgreSQL query per question - case/registration number on number boundaries, full-text words with stems, party and counsel names, and typo tolerance (`pg_trgm`). A named case number must match; noise words and bare years match nothing.
- Pluggable provider: **local** (ngrok-hosted), **Google Gemini**, or **OpenAI**.
- Temperature 0.2; system prompt forbids hallucination; context capped (≈2 cases/query) to stay within token budget.
- **Case briefings:** asking about a case or client ("what is the R. Murugan case") gets a prose summary, then *Where it stands* and *Follow-up*. The summary draws on the court record saved at import (`get_court_record`: acts, stage, coram, next date, hearing history, orders, interim applications). It reads both record layouts: High Court (`hearings`, flat case numbers) and district court (`history`, a `case_details` table, and extra tables such as IA status and transfers). It flags a court "next date" that has already passed, since `today` is in the context. Cases can be found by their court registration number (e.g. "AS 700/2025") even though an import stores the CNR as the case number.
- **Conversation memory (per browser, per user):** each question is sent with the last 3 exchanges with the model and the case ids its previous answer used (returned in the stream's final `done` frame). A follow-up that refers back ("its next hearing", "what did he file") and names no case number stays on that case. Naming another case switches to it. The server treats the history as untrusted: only user/assistant turns, at most 8 turns and 8,000 characters in total; every remembered case id is re-checked against the user's practice. Only the latest message carries case data, so facts always come from a fresh read. Short follow-ups after a model answer skip the keyword router. Chats are stored in the browser under `advocate-assistant-history:<advocateId>`, so a different login on the same browser never sees (or sends) someone else's chat. Nothing is stored on the server yet.
- **Access by role (both modes):** Lisa shows only what the person's own pages would show them. Each block of data needs the same permission as its page: cases/court record/parties/notes `CASE_VIEW`, hearings `EVENT_VIEW`, documents `DOCUMENT_VIEW`, invoices and dues `INVOICE_VIEW`, payments received `PAYMENT_VIEW`, expenses `EXPENSE_VIEW`, client details `CLIENT_VIEW`. What's withheld is listed to the model as `notPermitted`, so it answers "your role doesn't have access" instead of "there is none"; quick commands answer the same way. Scope is the person's team (the whole firm for Super Admin / Accountant), resolved on every request, so a team change applies at once.
- **Privacy masking** (`assistant/privacy.py`): before anything is sent to the model, people's names and personal identifiers are replaced with tokens - clients `[CLIENT_n]`, case parties and counsel `[PARTY_n]`, staff `[PERSON_n]`, and phone, email, PAN, GSTIN, Aadhaar, IFSC and stored client addresses. Names come from the firm's own records within the user's scope (including surname-only mentions); the same person gets the same token across the question, chat history and case data. Case numbers, courts, judges, dates, amounts and statutes are not masked. The reply is unmasked as it streams (a token split across pieces is held back until complete), so the user reads real names. Always on for OpenAI/Gemini; for the local model `ASSISTANT_MASK_LOCAL` (default on). Each call writes an `ASSISTANT_LLM_CALL` audit row with the provider, model and how many values of each kind were masked - never the values. Limit: a name that appears only in free text (a note, a court filing) and in no record is not caught.
- **"Me":** the context names who is asking and their own open tasks (`me.myOpenTasks`: assigned to them, or created by them with no assignee), so "anything I should worry about" means their items, not the whole team's.

---

## 17. Notifications & Communication (Email / WhatsApp / In-App)

**Notification engine:**
- Reminder types: hearings within next 2 days, overdue invoices, and task deadlines: an open task is flagged once when its deadline is `TASK_REMINDER_DAYS` away (default 2: "Task due in 2 day(s)"), again on the due date, then daily while overdue - to the assignee and whoever assigned it.
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
- **Quick Actions modal:** one-click create for Client, Case, Hearing, Invoice, Document upload and Expense, plus New Draft / Open Drafts.
  - **New Case** (and Lisa's "create case") opens the full **Add Case to Workspace** page (`/dashboard/cases/new`), which saves the court record, parties and upcoming hearings. The Cases-page pop-up only saves the case row, so it is kept for Edit Case only.
  - The other actions open the target page's form through `utils/pageModal.ts`. The request is parked until the lazy-loaded page mounts (`usePageModal`), so a first visit can't miss it. It used to be a window event on a 400–450 ms timer, which a slow page load silently missed.
  - **Add Expense** opened without a case shows a required case picker. Before, it saved the expense attached to no case.

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

### Teams within a firm

- A firm can have several seniors. Each senior heads a **team** (themselves + the juniors/interns whose `parent_advocate_id` is them). `firms.FirmTeam` (`firm_team`) records which teams make up one firm; a team with no row is a one-team firm.
- **Visibility:** advocates, juniors and interns see only their own team's cases, clients, hearings, bills and tasks; another senior's team does not see them. Firm-wide staff (Super Admin, Accountant — `FIRM_WIDE_SCOPE`) see every team of the firm. Another firm sees nothing. All of this comes from `core.practice.practice_ids()`.
- **Clients:** a client added by the Super Admin with a handling advocate belongs to that advocate's team. The Handling Advocate list covers the whole firm for firm-wide staff, otherwise the user's own team.
- **Transfers:** a senior can hand a matter to another senior **of the same firm** only; the case moves with its hearings, documents, bills, notes and tasks (`cases.views._move_matter`).
- **Adding a senior:** a user created as "Head / firm-wide" joins the creator's firm as a new team.
- **Splitting an existing team:** `manage.py make_team --senior <email> --firm <head email> [--yes]` (dry run by default; backup JSON under `uploads/demo-resets/`) makes a senior who reports to another senior head their own team and re-owns their cases' records.

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
