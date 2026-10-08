# Demo: senior assigns, junior drafts, senior reviews with a redline

A from-scratch run of the draft review loop: corrections, comments, accept / reject inside AMS, and redlines.
Feature reference: [DRAFT_EXPORT.md](DRAFT_EXPORT.md) and [DRAFT_REVIEW.md](DRAFT_REVIEW.md). Full test story
(every feature, every scenario): [REDLINE_TEST_PLAN.md](REDLINE_TEST_PLAN.md).

**Story:** the senior asks the junior to draft a lease deed for a client's case. The junior
drafts it with the AI and submits it. The senior **corrects** it directly and **asks** one question as a
comment, then sends it back. The junior acknowledges (or queries) the corrections, answers the question,
fixes what was asked and resubmits. The senior keeps or rejects each of the junior's changes, resolves the
comments and approves, all inside AMS. Finally the draft goes to the other side's lawyer as a Word redline.

> **The firm rule behind it:** whoever has authority over the draft decides. In a task the senior
> **corrects** (binding: the junior can only acknowledge or query) and, when unsure, **asks** in a comment;
> the junior **answers**; the senior **resolves** and keeps or rejects each of the junior's changes.
> Suggestions (accept / decline) are for **Request review**: a junior proofreading a senior's draft, or peers.

> **Which redline when.** Inside the firm, the senior edits the AMS draft directly, so the changes
> are already in it: the redline is a *"what changed"* report, and **Compare** (on screen) is the
> right one; a **PDF (read-only)** download is for keeping a copy. **Word (editable)**, where each
> change can be accepted or rejected, is for people **outside AMS** who will work on the document
> in Word: opposite counsel, the client. Inside the firm, accept / reject happens in AMS (Review);
> AMS can't yet read an outside party's Word file back in (planned: "Import changes from Word").

---

## Quick check: on-screen compare (5 minutes, no task needed)

Use any draft that already has a few versions, e.g. **Draft #116** (the lease deed) on the dev app
(http://192.168.1.36:5174). Log in as the draft's author or its reviewing senior.

1. **Open the compare view.** Open the draft, then click **Compare** in the top bar (next to Edit / Preview).
   - The document is replaced by the compare view. Nothing downloads.
   - The bar shows **From:** the latest *Submitted for review* version and **To:** *Current draft (now)*.
   - The count reads like *"6 changes · 49 words added, 54 removed"*.
2. **Read the marks.**
   - Added words are **underlined in green**, removed words **struck through in red**.
   - Each changed paragraph has a **coloured bar** in the left margin.
   - Only the changed words are marked: e.g. the rent shows just `40` struck and `45` added, not the whole sentence.
3. **Use the change list** (left).
   - Each change is named by its section (*2. RENT*, *8. TERMINATION*) and tagged *Changed*, *Added* or *Removed*, with a snippet.
   - Click one: the document scrolls to it and outlines it in blue.
   - Use **▶** and **◀** to step through every change in order; after the last it wraps to the first.
4. **Switch the display.** Click **Final**: the removed text disappears, the added text looks normal, and only the margin bars remain. Click **All markup** to bring the marks back.
5. **Pick other versions.**
   - **From** → *v1 · AI draft*: shows everything people changed since the AI wrote it.
   - **To** → an older version: compares two saved versions.
   - Picking the same version on both sides shows *"No differences between these versions."*
6. **Compare from the version list.** **Close** the view, then **Versions** → **Compare** on any row. The compare view opens from that version to the current draft.
7. **From the review banners.**
   - **Senior** (draft awaiting review): **Show in document** next to *What changed*.
   - **Junior** (changes requested): **See what <senior> changed** in the orange notice.
8. **Unsaved edits are included.** In **Edit**, type a word, **don't** save, then click **Compare**. The draft is saved first and your new word shows as added.
9. **Download what you see.** In the compare bar, **Download** → **Word (editable)** or **PDF (read-only)**. The file shows the same changes as the screen, with the same counts.
10. **Close** returns to the editor exactly as it was.

**Expected on Draft #116** (*latest Submitted for review → now*), matching the senior's demo edits:

| # | Section | Change |
|---|---|---|
| 1 | 2. RENT | `40` → `45` |
| 2 | 5. USE OF THE PREMISES | sub-letting reworded (`may` → `shall not`) |
| 3 | 5. USE OF THE PREMISES | 5.3 (hazardous goods) removed |
| 4 | 8. TERMINATION | `one (1)` → `two (2)` months' notice |
| 5 | 8. TERMINATION | `be entitled to` → `have the right to` |
| 6 | 8. TERMINATION | new 8.3 breach sentence added |

(The exact numbers change as the draft is edited.)

---

## 0. Before the demo (10 minutes)

| Check | How |
|---|---|
| Dev app is running | Open **http://192.168.1.36:5174**. If it doesn't load, double-click `run-dev.bat`. Versions and redline exist only here, not on the test app (5173). |
| Two logins in one firm | A **senior** (can assign tasks) and a **junior** on the senior's team, e.g. *Rajesh Kumar* (senior) and *Priya Nair* (junior). The junior needs drafting permission; the senior needs task-assign permission. |
| Two browser windows | **Window A** (normal) = senior, **Window B** (Incognito / another browser) = junior. Both logged in at the same time. |
| A case to work on | Any existing case of the senior's team, e.g. a client **Kannan** case. Note its case number. |
| Notice template (for section 7) | [`demo-files/Template_Legal_Notice_Rent_Arrears.docx`](demo-files/Template_Legal_Notice_Rent_Arrears.docx): upload once under **Firm Templates** with Agreement type `Legal Notice` (see section 7). |
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
3. **First, a question.** Select *paid monthly* in the rent clause → **Comment** (top bar) → type
   `Did the client agree to rent in advance?` → **Comment**. The thread shows in the **Comments** tab and
   the words are marked in the document.

> Say: *"When the senior isn't sure, he asks, right on the words. No margin notes on paper, no WhatsApp."*

4. Now **3–4 clear corrections**, edited directly (few and visible beats many). With the sample lease these are:
   - **Change a number:** rent `40,000` → `45,000`, and notice `one (1) month's` → `two (2) months'` (Termination).
   - **Delete** the sub-letting sentence (*"The Lessee may sub-let the Premises…"*): a landlord's lawyer wouldn't allow it.
   - **Add a sentence** to Termination: `Either Party may terminate forthwith on a material breach not remedied within 15 days of written notice.`
   - **Reword:** `shall be entitled to terminate` → `shall have the right to terminate`.
5. Click **Save**, then **Versions** → label `My corrections` → **Save**.
6. *(Optional, the senior's own check)* Click **Compare** in the top bar. It opens on *latest Submitted for review → Current draft (now)* and shows e.g. *"5 changes · 14 words added, 9 removed"*. **Close** to go back.
7. Point at **Approve**: it's disabled while his question is open.
8. Click **Request changes** with a comment: `See my corrections. Also add a lock-in period of 6 months.`

> Say: *"The senior edits directly in the draft, no emailing Word files back and forth."*

---

## 4. Junior sees exactly what changed (Window B — junior)

1. A notification says changes were requested. Go to **Tasks**: the task shows **Changes requested** with the senior's comment.
2. Click **Open draft**.
3. In the orange notice, click **See what <senior> changed** (or **Compare** in the top bar). No download:
   - **From:** the **latest** *Submitted for review*, i.e. the junior's last submission (the default)
   - **To:** *Current draft (now)*
4. **The compare view — the key moment:**
   - Only the senior's corrections are coloured: additions underlined in green, removals struck through in red, a bar beside each changed paragraph.
   - The rent shows just `40` struck and `45` inserted, not the whole sentence.
   - The **change list** on the left names each change by its section (*2. RENT*, *8. TERMINATION*); **◀ ▶** jumps between them.
   - **Final** shows the clean text with just the bars; **All markup** shows the strike-throughs again.
   - Nothing to accept: the senior's changes are **already in the draft**. The view just shows what they were.
   - Need a file? **Download** in the same bar gives the Word or PDF redline of exactly this.

> Say: *"The junior doesn't reread 20 pages. They see the five things the senior expects, and learn from them."*

5. **Acknowledge or query the corrections.** On *Corrections by <senior> · n to acknowledge or query* click **Review**.
   Under each change there is only **OK** or **Query**: a senior's corrections stay. **Query** the rent
   (`Client agreed 40,000?`), then **OK all** for the rest. **Close**. Her query now shows in the
   **Comments** tab too, as a question to the senior on the corrected words.

> Say: *"The junior can't undo a senior's correction, but can raise a question about it, on the record."*

6. **Answer the senior's question.** In the **Comments** tab, reply to his thread: `Client agreed rent in
   arrears, see meeting note of 2 Oct.` There's no Resolve for her on his question: only he can close it.
7. Add the **lock-in clause** the senior asked for (e.g. `The tenant shall not terminate during the first 6 months (lock-in period).`). Click **Save**.
8. Click **Submit to task** (resubmit). In the note: `Added 6-month lock-in clause.` A new **Submitted for review** version is saved automatically.

---

## 5. Senior checks the new round and approves (Window A — senior)

1. **Tasks** → task shows **Submitted** again → **Open draft**.
2. One bar: *Changes by <junior> · 0 of 1 to decide* with **Review**. The **Comments** tab on the right reads
   *Comments (2)*.
3. Click **Review**: the junior's change (the lock-in clause) with **Keep** / **Reject**. Rejecting would put
   the old text back; here, **Keep** → **Finish review**.
4. **Comments** tab: read her reply and **Resolve** his question; reply to her query
   (`Yes, client confirmed 45,000 on 5 Oct.`) and **Resolve** it.

> Say: *"The senior checks the second round in seconds, and decides on each change: keep it or undo it."*

5. *(Optional)* **Versions** → **Compare** on *My corrections*: only the junior's new work is marked.
   **Download → PDF** keeps a copy for the file.
6. Click **Approve** (it was disabled until every change was decided and every comment resolved). The task is completed.
7. Finish on **Versions**: *v1 AI draft → Submitted for review → My corrections → Sent back for changes → Review: 4 acknowledged, 1 queried (the corrections, closed on resubmit) → Submitted for review → Review: 1 accepted*. The numbers depend on how many corrections were made.

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

## 7. Review without a task: Request review (10 minutes)

Not every draft comes from a task. A senior drafts a notice himself and wants a second pair of eyes;
a junior drafts something on her own and wants her senior to check it. **Request review** covers this,
with the same firm rule: **whoever has authority decides, everyone else suggests.**

| Who reviews | What they can do | Who decides |
|---|---|---|
| A **junior** checks a senior's draft | **Suggest only** (and comment) | The senior (owner) accepts or declines each suggestion |
| A **senior** checks a junior's draft | **Correct directly** (and suggest, comment) | His corrections are binding; the junior acknowledges or queries |
| A **peer** (same level) | Suggest only | The author |

> Say: *"AMS knows the hierarchy. Ask a junior to proofread and they can only suggest. Ask your senior and
> they can simply correct it. Nobody has to remember the rules; the screen enforces them."*

**One-time setup: the notice template.** *Type the facts directly* needs a template for the kind of
document. Upload [`demo-files/Template_Legal_Notice_Rent_Arrears.docx`](demo-files/Template_Legal_Notice_Rent_Arrears.docx)
once: **Drafting → Firm Templates → Upload template** → **Template name** `Legal Notice – Rent Arrears`,
**Agreement type** `Legal Notice` → **Choose the template file** → pick the file. Wait until it shows **Ready**
(it is split into 8 clauses: the header, The Tenancy, The Default, Interest and Charges, Breach of the Lease,
Demand, Notice to Vacate, Costs). Blanks like `[[Arrears Amount]]` become fields to fill.

**Making a notice** (used in 7A and 7B): **Drafting → Drafts → New draft → Type the facts directly** →
**Agreement type** `Legal Notice` (the template is used by default) → **Continue** → **Document title**
`Legal Notice – Rent Arrears`, **Parties**: `K. Kannan` (landlord) and `R. Arun Prakash` (tenant), and in the
instructions `Rent unpaid for August and September 2026, Rs. 80,000 arrears; pay within 15 days or vacate by
31 October 2026.` → **Generate draft**. Fill a few fields (e.g. *Date of Notice*, *Arrears Amount*) so the
reviewer has dates and amounts to check.

### 7A. The senior asks the junior to proofread his notice

**Window A — senior (Rajesh)**

1. Make the rent-arrears notice for Kannan as above (**New draft → Type the facts directly → Legal Notice**).
2. In the top bar click **Request review**. Open the **Reviewer** list: only his own team appears, each
   a senior marked *(can correct)*. Pick the junior: *Priya Nair*.
3. **Note:** `Please check the dates and the demand amount.` → **Send request**.
   - A slim bar: *With Priya Nair for review* with **Cancel request**.
   - **Versions** has *Sent for review to Priya Nair*: the fixed point her review is compared against.

> Say: *"One click to ask, and the request is on record: who, when, and what to look at."*

**Window B — junior (Priya)**

4. The **bell** shows *Please review: …* from Rajesh.
5. **Drafting → Drafts**: a **For my review** panel at the top lists the notice, who asked, when,
   and his note → **Review**.
6. The notice opens with a blue banner: *"Rajesh Kumar asked you to review this draft."* **Save** reads
   **Send suggestions**; no Save to case, Re-draft or Versions → Save.

> Say: *"She can't change her senior's notice directly, only propose."*

7. Change a **date** in one clause (e.g. the *Vacate By Date* in **6. Notice to Vacate**) and the **amount**
   in another (e.g. the arrears in **2. The Default**). Optionally select the tenant's address →
   **Comment** → `Is this the correct address for service?`
8. Click **Send suggestions**. The notice goes back to Rajesh's text; a banner shows *Suggestions from
   Priya Nair · waiting for Rajesh Kumar*.
9. Click **Done reviewing**. The banner goes, she can still read the notice but no longer suggest, and it
   leaves her *For my review* list.

**Window A — senior (Rajesh)**

10. Reload the notice. A notification *Review done: …*, and *Suggestions from Priya Nair · 0 of 2 to decide*
    → **Review**.
11. The review view shows her two changes word by word, named by clause (*6. NOTICE TO VACATE*, *2. THE
    DEFAULT*). **Accept** the date. **Decline** the amount:
    a box asks for a reason → `Amount is as per the client's ledger` → **Decline**.
12. **Finish review**. The date is in the notice, the amount is not; **Versions** shows
    *Review: 1 accepted, 1 declined*. If she commented, the **Comments** tab has her question to reply to
    and **Resolve**.
13. **Drafting → Drafts**: beside the notice the chip reads *Reviewed by Priya Nair* (before step 12 it said
    *Priya Nair's changes to decide*, and before she sent anything *With Priya Nair for review*).

**Window B — junior (Priya)**: the bell has *Your suggestions were decided: … 1 accepted, 1 declined*. If she
still has the notice open, within 30 seconds an **Updated · Reload** chip appears in the top bar → it shows
the accepted date. The right panel's **Activity** tab has a badge; under *History*, *Rajesh Kumar decided your
suggestions: 1 accepted, 1 declined* → **View** shows each change with ✓ / ✗ and his reason for the amount.

> Say: *"Every suggestion is decided, with a reason when declined, and the history shows it."*

### 7B. The junior asks her senior to check her notice (he may correct)

**Window B — junior (Priya)**

1. Make her own notice the same way (**New draft → Type the facts directly → Legal Notice**; e.g. for a
   different tenant or month) → **Request review** →
   pick **Rajesh Kumar**. He is marked *(can correct)*; the note reads *"…can correct it directly and
   suggest changes. Their corrections come back to you to acknowledge or query."* → **Send request**.

**Window A — senior (Rajesh)**

2. **Drafts → For my review → Review.** His banner says he *can correct it directly and suggest changes*;
   he has **Save** (and a **Suggest** toggle, for things he only wants to propose).
3. Correct one word directly → **Save** → **Done reviewing**. He can still read it, but not edit.

**Window B — junior (Priya)**

4. Reload. *Corrections by Rajesh Kumar · 0 of 1 to acknowledge or query* → **Review** → **OK**
   (or **Query** with a question, which also appears in **Comments**) → **Finish review**.
   The correction stays.

> Say: *"Same button, different power: because Rajesh is her senior, his edits are final."*

### 7C. Changing your mind (optional, 1 minute)

- **Owner cancels:** on a notice with an open request, **Cancel request**. The reviewer loses access at
  once (the draft disappears from their *For my review*), and their suggestions still waiting for a
  decision are withdrawn.
- **Reviewer withdraws:** on *Suggestions from <you> · waiting…* click **View → Withdraw** before the
  owner decides.
- **Outdated:** if the owner edits the very paragraph a suggestion touches, that suggestion shows
  **Outdated** and can't be applied blindly; suggestions on other paragraphs are unaffected.

### 7D. The notice comes back from the tenant's counsel (Import changes)

The notice was sent; the tenant's counsel replies by email with the notice marked up in Word. Use
[`demo-files/Notice_Returned_By_Tenant_Counsel.docx`](demo-files/Notice_Returned_By_Tenant_Counsel.docx)
(made from the rent-arrears notice; with your own notice, download it, edit it in Word with Track Changes on,
add a comment, save).

**Window A — Rajesh (owner)**

1. Open the notice → **Import changes** in the top bar.
2. Choose the file. Leave **From** empty (the file names *R. Arun Prakash (tenant counsel)*), note
   `Received by email`. → **Import**.
3. A message: *From R. Arun Prakash (tenant counsel): 3 changes and 1 comment*. The review opens:
   *Changes from R. Arun Prakash (tenant counsel)*:
   - **2. The Default**: the arrears Rs. 80,000 → Rs. 40,000, and a new paragraph claiming August was paid
     in cash;
   - **5. Demand**: 15 days → 30 days.
4. **Decline** the amount (`Client's ledger shows both months unpaid`), **Decline** the new paragraph
   (`No receipt; client denies`), **Accept** 30 days. **Finish review** → confirm.
5. The **Comments** tab: *R. Arun Prakash (tenant counsel) (in Notice_Returned_By_Tenant_Counsel.docx): My
   client needs until 30 November 2026…* on *Notice to Vacate* → reply `Client agrees to 15 November.` and
   edit the date, → **Resolve**.
6. **Versions** shows *Review: 1 accepted, 2 declined*. **Download → redline** against the version sent, to
   reply to the counsel.

> Say: *"Whatever comes back by email, every change they made is decided here, with reasons, and their
> questions sit beside the words they're about."*

## 8. Optional extras (if time allows)

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
| Compare says *No saved versions yet* | The draft predates versions. **Versions → Save** once, edit, then **Compare**. |
| Change list names every change after the document title | That draft has no section headings in capitals ("2. RENT"); the changes are still listed and marked. |
| Compare shows changes you didn't expect | Check **From**: by default it is the last version *sent out*, not the last one you saved. Pick the version you want. |
| PDF takes long | The first PDF after a restart takes ~30 s. Warm it up before the demo (step 0). |
| *PDF is not available on this server* | LibreOffice not found. Use the Word redline; see DRAFT_EXPORT.md → PDF. |
| Junior can't open the draft after approval | Expected: after approval the senior can only read it; the junior still owns it. |
| **Submit to task** is disabled | Only for drafts that still have open suggestions from before comments replaced them in tasks: **Review** → Accept / Decline → **Finish review**. |
| **Approve** is disabled | A round still waits for the senior (**Review** on the banner), or a comment is still open (**Comments** tab → **Resolve**). |
| No **Suggest** toggle for the senior | Expected in a task: he corrects and comments. Suggestions are for Request review. |
| A change shows **Outdated** | The paragraph it touches was edited since; it can't be applied blindly. Make the change by hand if still wanted. |
| No **Request review** button | The draft belongs to a task (use Submit to task), or you aren't its owner. |
| Pages fail with database errors | PostgreSQL is out of connections (the test app holds most). Restart the test backend, or try again shortly. |

## Reset for another run

Cancel or delete the demo task (Tasks → cancel icon) and delete the draft from **Drafting → Drafts**.
The case and client stay as they were.

