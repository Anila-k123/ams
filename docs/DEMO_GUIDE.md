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

| Who | Email | What they are |
|---|---|---|
| Rajesh Kumar | `rajesh@kumar-associates.demo` | Senior advocate, practice owner (all permissions) |
| Priya Nair | `priya@kumar-associates.demo` | Junior advocate in Rajesh's chambers |
| K. M. Anand Joshi | `anand.joshi@clients.demo` | **Client** login (client role) for O.S. No. 150/2025 |

## The demo cases (all real, from the courts)

| Case | Court | Client (our side) | State | Demo activity |
|---|---|---|---|---|
| SLP(C) No. 12710/2026 | Supreme Court | Ravinder Singh Chaddha | pending | Priya's task: **changes requested**; invoice due; travel and AoR expenses; paper-book deadline 1 Oct |
| CONMT.PET.(C) Diary No. 8000/2026 | Supreme Court | Mohabul Shaikh & Ors. | pending | task |
| C.A. No. 5640/2026 | Supreme Court | Shashidhar Reddy Beeravolu (respondent) | disposed | full court record |
| A.S. No. 700/2025 | Madras High Court | R. Murugan | pending | task assigned to Priya; invoice **unpaid** (₹40,000 received so far, under Payments); expense; note |
| C.M.A. No. 1200/2025 | Madras High Court | Mathankumar | pending | task; counter-affidavit deadline |
| W.P. No. 14600/2026 | Madras High Court | M/s. Akshayam Traders | disposed | invoice **paid**; note |
| O.S. No. 150/2025 | City Civil Court, Chennai | K. M. Anand Joshi | part heard, **hearing 30 Sep** | Priya's task **approved**; invoice paid; meeting 28 Sep; status note **shared with client**; client login |
| O.S. No. 900/2025 | City Civil Court, Chennai | Kannan | **mediation 13 Oct** | Priya's task **submitted, awaiting review**; court fee receipt; meeting 11 Oct |
| O.S. No. 101/2020 | City Civil Court, Chennai | HCL Technologies Ltd. | decided | invoice **overdue**; task |

## 1. Firm side: sign in as Rajesh

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
- [ ] **Tasks.** Check the three review states:
  - O.S. 900/2025 mediation brief: **Submitted**, with an **Open draft** chip. See "Reviewing a junior's draft" below.
  - O.S. 150/2025 cross-examination: **Approved**, completed.
  - SLP list of dates: **Changes requested**, with Rajesh's note.
- [ ] **Invoices.** Expect: 5 GST invoices: 2 paid, 2 due, 1 overdue (HCL). A.S. 700/2025 has ₹40,000 received so far, shown under Payments.
  - Open one and download the PDF. Expect: GST lines and the firm's billing details.
- [ ] **Expenses.** Expect: travel, AoR, court fee, copies and certified-copy expenses.
  - The monthly report and PDF download work, and the PDF filters by case.
- [ ] **Documents.** Expect: the uploaded Word and PDF files.
  - Preview one and download one.
  - "Share with client" is on for "Case status note for client".
- [ ] **Reports / Analytics.** Expect: the charts show the invoice and payment totals.
- [ ] **Legal reference.** Acts, Law Codes (IPC → BNS lookup), Legal Dictionary: search works.
- [ ] **Settings / Profile.** Change the display name and save. Expect: the top bar updates. Then change it back.
- [ ] **User Management / Role Management.**
  - Only Rajesh's chambers staff are listed, with no clients.
  - The "Client" role can't be edited or assigned.
- [ ] **Light / dark theme.** Toggle it on a few pages. Expect: readable in both.

## 2. Drafting: as Rajesh

- [ ] **Drafting → Documents.** Pick an AMS document and click **Prepare for drafting**.
  - Expect: it goes processing → ready in about 30–60 s.
  - The other pages stay responsive meanwhile.
- [ ] **Summary** on a prepared document. Expect: the same AMS summary window as on the Documents page opens. Drafting has no separate summarizer any more.
- [ ] **New draft**, from a case: open O.S. No. 900/2025 → Tasks → **Draft for this task**.
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
- [ ] **Open it.** Tasks → O.S. 900/2025 "Prepare mediation brief" (Submitted) → **Open draft**. Case Detail → Tasks has the same button.
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

- [ ] Clients → Kannan → **Client logins** → create a login with a `.demo` email.
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
