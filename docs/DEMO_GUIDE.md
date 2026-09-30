# AMS demo guide and manual test checklist

This covers the demo data prepared on 25 Sep 2026: nine real, public court cases, with demo activity around them. Tick each box as you test it in the browser. The **Expect** line is what should happen.

## Before you start

- Services running:
  - backend `http://127.0.0.1:8080`;
  - frontend `http://localhost:5173`;
  - the court scraper on `http://localhost:8000` (needed only for Add Case court search and "Refresh from court").
- Hard-reload the browser (Ctrl+F5) once.
- Email: real SMTP is configured, and some actions below email the client (see "Emails" at the end). All demo addresses end in `.demo`, which can't be delivered.

## Logins (password `Demo@1234` for all)

Run `python manage.py seed_role_demo` once, from `Advocate-app-BE-Django`, to create or refresh these. It's safe to re-run: a second run changes nothing.

| Role | Who | Email |
|---|---|---|
| Super Admin | Meena Iyer (firm admin) | `admin@kumar-associates.demo` |
| Senior Advocate | Rajesh Kumar (practice owner) | `rajesh@kumar-associates.demo` |
| Senior Advocate | Arjun Menon (holds A.S. 700/2025 and C.M.A. 1200/2025) | `arjun@kumar-associates.demo` |
| Junior Advocate | Priya Nair | `priya@kumar-associates.demo` |
| Intern | Karthik R. | `karthik.intern@kumar-associates.demo` |
| Receptionist | Lakshmi S. | `lakshmi.reception@kumar-associates.demo` |
| Accountant (finance) | Suresh Kumar | `suresh@kumar-associates.demo` |
| Client | K. M. Anand Joshi (O.S. No. 150/2025) | `anand.joshi@clients.demo` |

Everyone works in one firm and one team, headed by Rajesh. The other logins in the database (for example `admin@advocate.local`, `seniora1@gmail.com`) are test accounts, not part of this demo.

## What each role can do

✔ = can open and use; 👁 = view only; — = hidden from the menu, and the API refuses it (403).

| Module | Admin | Senior | Junior | Intern | Reception | Accountant | Client |
|---|---|---|---|---|---|---|---|
| Cases | ✔ incl. delete | ✔ incl. delete | create / edit | 👁 | 👁 | 👁 | own case only (portal) |
| Clients | ✔ incl. delete | create / edit | 👁 | 👁 | create / edit | 👁 | — |
| Hearings & events | ✔ | ✔ | create | 👁 | create | — | own case only |
| Documents | ✔ | ✔ | upload | 👁 | — | — | shared documents only |
| Drafting | ✔ | ✔ incl. manage | create / export | create | — | — | — |
| Tasks | all, incl. assign | all, incl. assign / review | own: create / edit | own | — | — | — |
| Appeal Alert, Acts, Legal Dictionary, Law Codes | ✔ | ✔ | ✔ | ✔ | — | — | — |
| Hearing and cause-list alerts | ✔ | ✔ | ✔ | ✔ | — | — | email about own case |
| Invoice alerts ("to collect", overdue) | ✔ | ✔ | — | — | — | ✔ | own invoices |
| Invoices / payments / expenses | ✔ | ✔ | — | — | — | ✔ | own invoices only |
| Reports | ✔ | ✔ | — | — | — | ✔ | — |
| Dashboard finance widgets | ✔ | ✔ | hidden | hidden | hidden | ✔ | — |
| Users / roles / audit / backup | ✔ | — | — | — | — | — | — |

"Own" tasks are the ones assigned to you or created by you. Whoever holds TASK_ASSIGN (seniors, admin) sees every task. Who gets case alerts is set by the CASE_ALERTS permission, which you can change per role in Role Management.

## Role-by-role demo script

- **Meena (Admin):**
  - Show: the Users, Roles, System Activity and Backup pages.
  - Contrast: Rajesh doesn't have these pages.
- **Rajesh (Senior):**
  - Show: the full practice (9 cases, finances, reports).
  - Show: assign a task, and review Priya's submitted draft (see "Reviewing a junior's draft").
  - Contrast: no Users or Roles pages.
- **Arjun (Senior):** A.S. 700/2025 and C.M.A. 1200/2025 are his. Show case transfer from Case Detail.
- **Priya (Junior):**
  - Show: her tasks, drafting, uploading documents, adding a hearing.
  - Show blocked: no Invoices, Expenses or Reports in the menu, and no money on the dashboard. Typing `/dashboard/invoices` sends her back to the dashboard.
- **Karthik (Intern):**
  - Show: the research task on SLP(C) 12710/2026; he can read cases and documents and draft.
  - Show blocked: he can't upload, edit or delete, and has no finance.
- **Lakshmi (Reception):**
  - Show: the walk-in client "Selvi Ramasamy" and the consultation she booked on C.M.A. 1200/2025. She can add clients and schedule events.
  - Show blocked: no Documents, no money, no Tasks, and no legal reference (Appeal Alert, Acts, Dictionary, Law Codes).
- **Suresh (Accountant):**
  - Show: all 5 invoices, and the ₹1,00,000 NEFT part-payment he recorded against the SLP. He can raise a new invoice (the case and client pickers work), and he sees expenses and reports.
  - Show blocked: no Documents, Drafting, Hearings, Tasks or legal reference; cases and clients are view-only.
- **Anand Joshi (Client):**
  - Show: he sees only his own case, invoices and shared documents. After the O.S. 900/2025 demo, sign in as Kannan too, to show that two clients never see each other's matters.
  - Show blocked: firm URLs return 403.

## The demo cases (all real, from the courts)

| Case | Court | Client (our side) | State | Demo activity |
|---|---|---|---|---|
| SLP(C) No. 12710/2026 | Supreme Court | Ravinder Singh Chaddha | pending | Priya's task: **changes requested**; invoice due; travel and AoR expenses; paper-book deadline 1 Oct |
| CONMT.PET.(C) Diary No. 8000/2026 | Supreme Court | Mohabul Shaikh & Ors. | pending | task |
| C.A. No. 5640/2026 | Supreme Court | Shashidhar Reddy Beeravolu (respondent) | disposed | full court record |
| A.S. No. 700/2025 | Madras High Court | R. Murugan | removed 30 Sep 2026 | recreated live in the demo: see `DEMO_AS700_2025.md` |
| C.M.A. No. 1200/2025 | Madras High Court | Mathankumar | pending | task; counter-affidavit deadline |
| W.P. No. 14600/2026 | Madras High Court | M/s. Akshayam Traders | disposed | invoice **paid**; note |
| O.S. No. 150/2025 | City Civil Court, Chennai | K. M. Anand Joshi | part heard, **hearing 30 Sep** | Priya's task **approved**; invoice paid; meeting 28 Sep; status note **shared with client**; client login |
| O.S. No. 900/2025 | City Civil Court, Chennai | Kannan | mediation 13 Oct | **Not in the database.** Created live from scratch in the demo; see [DEMO_OS900_2025.md](DEMO_OS900_2025.md). Reset it with `manage.py reset_demo_client --name Kannan --firm rajesh@kumar-associates.demo --yes` |
| O.S. No. 101/2020 | City Civil Court, Chennai | HCL Technologies Ltd. | decided | invoice **overdue**; task |

## 1. Firm side: sign in as Rajesh (as Meena for the admin pages)

- [ ] **Dashboard.**
  - Expect: counts for 9 cases; upcoming hearings and meetings (28 Sep, 30 Sep, 1 Oct, 11 Oct, 13 Oct); recent activity.
- [ ] **Cases / Workspace.**
  - Expect: 9 cases, with status, court, client, next hearing and tags.
  - Search "Joshi" to filter; the status and court filters work.
- [ ] **Case detail**, O.S. No. 150/2025: open each tab.
  - Parties: the plaintiff, the Malayalee Club, and counsel.
  - Hearings, and the court hearing history from the court record.
  - Orders.
  - Tasks (the approved task); Documents (3); Invoices (paid); Expenses; Notes; Tags "Evidence stage".
- [ ] **Court record view**, C.A. No. 5640/2026 (Supreme Court).
  - Expect: listing dates, judgment/orders and the other sections from the Supreme Court site.
- [ ] **Refresh from court** on a case (scraper needed).
  - Expect: the stored court record updates; there's no error text on screen.
- [ ] **Add Case → court search** (scraper needed): search a real case, for example Supreme Court diary 14705/2025.
  - Expect: the result appears, and saving adds the case with its parties and upcoming hearings.
  - Delete the test case afterwards.
- [ ] **Clients.** Expect: 9 clients with phone and address.
  - Open K. M. Anand Joshi, then **Client logins**. Expect: one login, `anand.joshi@clients.demo`, with a last sign-in time.
- [ ] **Hearings & Events calendar.** Expect: the hearings and meetings above on their dates; month and week views.
- [ ] **Tasks.** Check the two review states (the Submitted state is created live in the O.S. 900/2025 demo):
  - O.S. 150/2025 cross-examination: **Approved**, completed.
  - SLP list of dates: **Changes requested**, with Rajesh's note.
- [ ] **Invoices.** Expect: 4 GST invoices: 2 paid, 1 due, 1 overdue (HCL). (The A.S. 700/2025 invoice was removed with the case; the live demo raises a new one.)
  - Open one and download the PDF. Expect: GST lines and the firm's billing details.
- [ ] **Expenses.** Expect: travel, AoR, court fee, copies and certified-copy expenses.
  - The monthly report and PDF download work, and the PDF filters by case.
- [ ] **Documents.** Expect: the uploaded Word and PDF files.
  - Preview one and download one.
  - "Share with client" is on for "Case status note for client".
- [ ] **Reports / Analytics.** Expect: the charts show the invoice and payment totals.
- [ ] **Legal reference.** Acts, Law Codes (IPC → BNS lookup), Legal Dictionary: search works.
- [ ] **Settings / Profile.** Change the display name and save. Expect: the top bar updates. Then change it back.
- [ ] **User Management / Role Management** (as Meena; Rajesh no longer has these pages).
  - Client logins aren't listed.
  - The "Client" role can't be edited or assigned.
  - Note: every staff login in the database is listed, including the test accounts. The app currently runs as one firm.
- [ ] **Light / dark theme.** Toggle it on a few pages. Expect: readable in both.

## 2. Drafting: as Rajesh

- [ ] **Drafting → Documents.** Pick an AMS document and click **Prepare for drafting**.
  - Expect: it goes processing → ready in about 30–60 s.
  - The other pages stay responsive meanwhile.
- [ ] **Summary** on a prepared document. Expect: the same AMS summary window as on the Documents page opens. Drafting has no separate summarizer any more.
- [ ] **New draft**, from a case: open SLP(C) No. 12710/2026 → Tasks → **Draft for this task**.
  - Expect: the wizard opens with the case already linked.
  - Pick a reference document, then a template (optional), facts, and Generate. Expect: the editor opens after about 40 s.
- [ ] **Editor.** Edit a block; use Chat / Refine; check the citations; Save.
- [ ] **Download → Word on AMS letterhead.** Expect: a `.docx` with the firm's letterhead.
- [ ] **Submit to task.**
  - Expect: the draft appears in AMS Documents on the case (category Draft).
  - The task moves to Submitted.
  - Submitting again adds version 2 of the same document.
- [ ] **Templates / Playbooks.** Open, view and upload.

### Reviewing a junior's draft (in the drafting editor)
- [ ] **Open it.** First run steps 2 and 5 of [DEMO_OS900_2025.md](DEMO_OS900_2025.md), which create the task and submit the brief. Then Tasks → "Prepare mediation brief" (Submitted) → **Open draft**. Case Detail → Tasks has the same button.
  - Expect: the editor opens **read-only**, with the banner "Reviewing Priya Nair's draft for task … — awaiting your review".
  - Submit to task and Re-draft are hidden.
- [ ] **Edit.** Click **Edit**, change a sentence, then **Save**. Expect: saved.
- [ ] **Download.** Word works, including on the letterhead.
- [ ] **Request changes.** Enter a note, then **Send back**. Expect:
  - the banner shows "sent back for changes" with the note;
  - Edit and Save disappear, because the reviewer can edit only while the task awaits review.
- [ ] **As Priya:** open the same draft from her task. Expect:
  - the note appears as "Rajesh Kumar asked for changes: …";
  - she revises it and clicks **Submit to task**, which files version 2 and sets the task back to Submitted.
- [ ] **As Rajesh:** **Open draft** again, then **Approve**. Expect: the task completes, and the draft is read-only for him.
- [ ] **Isolation:** another staff member who didn't assign the task, and has no TASK_ASSIGN right, can't open it (404).

## 3. Delegated work: sign in as Priya

- [ ] **Tasks → Assigned to me.** Expect: her 4 tasks. The one Rajesh requested changes on shows his note.
- [ ] **Resubmit:** attach a document to the changes-requested task (SLP list of dates).
  - Expect: it goes back to Submitted.
  - As Rajesh, it shows for review again.
- [ ] Priya can't open User Management or Role Management.

## 4. Client side: sign in as K. M. Anand Joshi

- [ ] **Signing in** at the normal `/login`. Expect: the client screens, with no firm sidebar.
- [ ] **Home.** Expect: 1 active case; upcoming items 28 Sep (meeting) and 30 Sep (hearing).
- [ ] **My cases.** Expect: only O.S. No. 150/2025, with its parties and hearings.
- [ ] **Invoices.** Expect: his invoice (paid), and the PDF downloads.
- [ ] **Documents.** Expect: only "Case status note for client"; the firm's other documents on the case are not visible.
- [ ] **Messages.** Expect: the notices the firm's system sent him (case opened, payment received).
- [ ] **Blocked:** type `/dashboard/cases` or `/dashboard/drafting/samples` in the address bar.
  - Expect: sent back to his home. The firm's API refuses him (403).
- [ ] **Change password** under Account, then sign in again.

## 5. Client login lifecycle (as Rajesh)

- [ ] Clients → Mathankumar → **Client logins** → create a login with a `.demo` email.
  - Expect: it's listed, and an invite email is sent (to a `.demo` address, so it isn't delivered).
  - The invite link is valid for 72 hours.
- [ ] **Switch off** Anand Joshi's login.
  - Expect: he can no longer sign in.
  - Switch it back on after the check.

## Emails during testing

These actions send email through the real SMTP account:
- creating a case, invoice or payment;
- marking an invoice paid;
- assigning a task;
- inviting a client login.

With the demo data they only go to `.demo` addresses, which can't be delivered. To avoid any sending while you test, set `MAIL_BACKEND=django.core.mail.backends.console.EmailBackend` in the backend `.env` and restart the backend. Emails are then printed in the server window instead.

## Known limits

- **Court search** depends on the live court sites through the scraper, and they can be slow or overloaded (for example eCourts High Court answering "too many clients"). Just retry later.
- **Drafting AI** (processing, summaries, generation) needs the drafting AI keys in `.env`. The first job loads the models (about a minute).
- **Background jobs** run in a stopgap worker process. See the "PERMANENT SOLUTION" section of `docs/OPERATIONS.md` before production.

## Restoring the old demo data

These backups were taken before the real-case import:
- `backup-advocate_db-before-real-demo.dump`, `backup-pactpro-before-real-demo.dump` (`pg_restore`);
- `backup-uploads-before-real-demo.tar`.

They're in the Claude session scratchpad folder. Copy them somewhere permanent if you want to keep them.
