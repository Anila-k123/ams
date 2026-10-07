# Demo: senior assigns, junior drafts, senior reviews with a redline

A from-scratch run of the draft review loop, ending with redlines.
Feature reference: [DRAFT_EXPORT.md](DRAFT_EXPORT.md).

**Story:** the senior asks the junior to draft a lease deed for a client's case. The junior
drafts it with the AI and submits it. The senior corrects it and sends it back. The junior
downloads a redline and sees exactly what the senior changed, fixes the rest and resubmits.
The senior checks the new round with a second redline and approves. Finally the draft goes to
the other side's lawyer as a Word redline.

> **Which redline when.** Inside the firm, the senior edits the AMS draft directly, so the changes
> are already in it: the redline is a *"what changed"* report, and the **PDF (read-only)** is
> the right one. **Word (editable)**, where each change can be accepted or rejected, is for
> people **outside AMS** who will work on the document in Word: opposite counsel, the client.
> AMS does not yet read their accepted / rejected Word file back in (planned: "Import changes from Word").

---

## 0. Before the demo (10 minutes)

| Check | How |
|---|---|
| Dev app is running | Open **http://192.168.1.36:5174**. If it doesn't load, double-click `run-dev.bat`. Versions and redline exist only here, not on the test app (5173). |
| Two logins in one firm | A **senior** (can assign tasks) and a **junior** on the senior's team, e.g. *Rajesh Kumar* (senior) and *Priya Nair* (junior). The junior needs drafting permission; the senior needs task-assign permission. |
| Two browser windows | **Window A** (normal) = senior, **Window B** (Incognito / another browser) = junior. Both logged in at the same time. |
| A case to work on | Any existing case of the senior's team, e.g. a client **Kannan** case. Note its case number. |
| Reference document | [`demo-files/Sample_Residential_Lease_Deed_Chennai.docx`](demo-files/Sample_Residential_Lease_Deed_Chennai.docx) (also `.pdf`): a Chennai residential lease, Lessor **K. Kannan**, Lessee R. Arun Prakash, rent Rs. 40,000, 11 months, fictional parties. It has three weak points on purpose for the senior to fix: **sub-letting allowed** (5.2), **one month's notice** (8.1), **no lock-in**. |
| Word or LibreOffice Writer | To open the redline. LibreOffice is installed on this machine. |
| Warm up the PDF | Download any draft as PDF once. The first PDF after a restart takes ~30 s, later ones ~7 s. |

> Tip: keep both windows side by side. The audience sees the senior on the left, the junior on the right.

---

## 1. Senior assigns the task (Window A — senior)

1. Go to **Tasks** → **Add Task**.
2. Fill in:
   - **Task:** `Draft lease deed for Kannan`
   - **Priority:** High · **Deadline:** a date this week
   - **Link Case:** pick Kannan's case (*required later to submit the draft*)
   - **Assign to:** the junior
3. Click **Add Task**. The task shows the junior's name and needs review, because it is assigned by one person to another.

> Say: *"The senior delegates. Because it's assigned to someone else, it comes back for review automatically."*

---

## 2. Junior drafts with the AI (Window B — junior)

1. Go to **Tasks**. The new task is there with **You** as assignee.
2. Click the **pencil icon** (*Draft for this task*). The new-draft screen opens already linked to the case and task.
3. **Documents:** click **Add Documents**, upload `docs/demo-files/Sample_Residential_Lease_Deed_Chennai.docx` (or pick it if already uploaded) → **Next**.
4. **Template:** pick a template, or **Skip — no template** → **Continue**.
5. **Details:** fill party names (*Kannan* / the tenant), rent, term, start date, and an instruction such as
   `Residential lease, 11 months, rent Rs. 40,000, 2 months' deposit, Chennai.` → **Review**.
6. **Generate Draft.** Wait for the draft to finish (about a minute).
7. Click **Versions**: there is already **v1 · AI draft**.

> Say: *"Every AI draft is kept as version 1, so we can always see what the AI wrote versus what people changed."*

8. Make a few junior edits so the draft is "theirs": correct the tenant's name, the start date, one clause. Click **Save**.
9. Click **Submit to task**, and add a short note if asked. The chip changes to *Submitted for review · v1*.
10. Click **Versions** again: **v2 · Submitted for review · filed as document v1** was saved automatically.

> **Reading the Versions list** (newest at the top):
> - **vN** is the draft's own version number: 1, 2, 3… in the order they were saved.
> - The label follows it: *AI draft* (the AI finished), *Submitted for review · filed as document vN* (Submit to task), *Saved to PactPro · filed as document vN* (Save to PactPro), or your own label (saved by hand).
> - "**filed as document vN**" is the AMS document version on the case (the "filed as version N" in the review banner), not the draft version.
> - Example: `v3 · Submitted for review · filed as document v2` = draft version 3, filed on the case as document version 2.
> - **Every** Submit adds a row. If the junior submits twice (e.g. fixes something a minute later), there are two *Submitted for review* rows. **The top one is what the senior is reviewing**, and the redline dialog picks it by default.

> Say: *"The moment it's submitted, AMS freezes exactly what the junior handed in."*

---

## 3. Senior reviews and corrects (Window A — senior)

1. Go to **Tasks**. The task shows **Submitted**. Click **Open draft**.
2. The banner reads *"Reviewing <junior>'s draft for task … — awaiting your review"*.
3. Make **3–4 clear corrections** (few and visible beats many). With the sample lease these are:
   - **Change a number:** rent `40,000` → `45,000`, and notice `one (1) month's` → `two (2) months'` (Termination).
   - **Delete** the sub-letting sentence (*"The Lessee may sub-let the Premises…"*): a landlord's lawyer wouldn't allow it.
   - **Add a sentence** to Termination: `Either Party may terminate forthwith on a material breach not remedied within 15 days of written notice.`
   - **Reword:** `shall be entitled to terminate` → `shall have the right to terminate`.
4. Click **Save**, then **Versions** → label `My corrections` → **Save**. (This is what the second-round redline compares against in step 5.)
5. *(Optional, the senior's own check)* **Download → Redline (tracked changes)…** · From: the **latest** *Submitted for review* (the default) · To: *Current draft (now)* · **PDF (read-only)** → **Download**. The dialog says e.g. *"14 word(s) added, 9 removed"*.
6. Click **Request changes** with a comment: `See my corrections in the redline. Also add a lock-in period of 6 months.`

> Say: *"The senior edits directly in the draft, no emailing Word files back and forth."*

---

## 4. Junior sees exactly what changed (Window B — junior)

1. A notification says changes were requested. Go to **Tasks**: the task shows **Changes requested** with the senior's comment.
2. Click **Open draft**.
3. **Download → Redline (tracked changes)…** — leave the defaults:
   - **Compare from:** the **latest** *Submitted for review*, i.e. the junior's last submission (the default; v2 if the junior submitted once)
   - **Compare to:** *Current draft (now)*
   - **PDF (read-only)** → **Download**.
4. **Open the PDF — the key moment:**
   - Only the senior's corrections are coloured: new text underlined, removed text struck through.
   - The rent shows just `40,000` struck and `45,000` inserted, not the whole sentence.
   - The deleted sub-letting sentence is struck through; unchanged clauses are plain.
   - Nothing to accept: the senior's changes are **already in the draft**. The PDF just shows what they were.

> Say: *"The junior doesn't reread 20 pages. They see the five things the senior expects, and learn from them."*

5. Back in AMS, add the **lock-in clause** the senior asked for (e.g. `The tenant shall not terminate during the first 6 months (lock-in period).`). Click **Save**.
6. Click **Submit to task** (resubmit). In the note: `Added 6-month lock-in clause.` A new **Submitted for review** version is saved automatically.

---

## 5. Senior checks the new round and approves (Window A — senior)

1. **Tasks** → task shows **Submitted** again → **Open draft**.
2. **Download → Redline (tracked changes)…**
   - **Compare from:** *My corrections* (saved in step 3).
   - **Compare to:** *Current draft (now)*.
   - **PDF (read-only)** → **Download**.
3. The PDF shows only the junior's new lock-in clause, underlined in colour.

> Say: *"The senior checks the second round in seconds: did the junior do what I asked, and nothing else?"*

4. Click **Approve**. The task is completed.
5. Finish on **Versions**: *v1 AI draft → Submitted for review (one row per submission) → My corrections → Submitted for review …*

> Say: *"The whole history of the document is kept: what the AI wrote, what the junior submitted, what the senior changed."*

---

## 6. Send to the other side's lawyer (Word redline)

The approved draft now goes to the tenant's lawyer, who will negotiate it in Word.

1. Senior (or junior): **Versions** → label `Sent to tenant's counsel` → **Save**.
2. **Download** → **Word (.docx)**: this clean copy is what gets emailed for round one.
3. Show round two: make one change the client asked for (e.g. deposit `Rs. 80,000` → `Rs. 1,20,000`), **Save**.
4. **Download → Redline (tracked changes)…** · From: *Sent to tenant's counsel* · To: *Current draft (now)* · **Word (editable)** → **Download**.
5. Open it in Word / LibreOffice: the deposit change is tracked with the advocate's name and time.
   **Review → Accept / Reject** works on each change: this is what opposite counsel does on their side.

> Say: *"Inside the firm, AMS is the document, so a PDF of the changes is enough. When it goes
> outside, the other lawyer gets a proper Word redline they can accept, reject and answer, the
> way every law firm negotiates."*

Be honest if asked: when opposite counsel sends their Word file back, AMS can't yet read their
changes in; that's the next planned feature.

## 7. Optional extras (if time allows)

| Show | How |
|---|---|
| Letterhead copy | **Download** → tick **Add firm letterhead** → **PDF**. Only for the office's own letters/notices; a lease deed is signed by the parties, so use the plain PDF for it. |
| Redline for the client | **Versions → Save** `Sent to Kannan`, edit, then **Redline → PDF (read-only)**: the client just needs to see what changed. |
| Version history | **Versions** list with labels, kinds (AI draft / Sent / Saved) and times. |

---

## If something goes wrong

| Problem | Fix |
|---|---|
| **Submit to task** says *Link a case first* | The task had no linked case. Link one in the draft (case picker) or recreate the task with **Link Case**. |
| Redline dialog: *No saved versions yet* | The draft predates versions. **Versions → Save** once, edit, then redline. |
| Two *Submitted for review* rows | The junior submitted twice. Normal: compare from the top (latest) one. |
| **Download** button is grey | "From" and "To" are the same version. |
| PDF takes long | The first PDF after a restart takes ~30 s. Warm it up before the demo (step 0). |
| *PDF is not available on this server* | LibreOffice not found. Use the Word redline; see DRAFT_EXPORT.md → PDF. |
| Junior can't open the draft after approval | Expected: after approval the senior can only read it; the junior still owns it. |
| Pages fail with database errors | PostgreSQL is out of connections (the test app holds most). Restart the test backend, or try again shortly. |

## Reset for another run

Cancel or delete the demo task (Tasks → cancel icon) and delete the draft from **Drafting → Drafts**.
The case and client stay as they were.
