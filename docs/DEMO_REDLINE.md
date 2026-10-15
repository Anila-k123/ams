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
> in Word: opposite counsel, the client. Inside the firm, accept / reject happens in AMS (Review).
> When their marked-up Word file comes back, **Import changes** turns it into the same accept / decline
> review (sections 7D and 8A).

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
2. Click the **✨ icon** (*Draft with AI*). The new-draft screen opens already linked to the case and task.
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
**Agreement type** `Legal Notice` (the template is used by default) → **Continue**, then fill the brief:

| Field | Enter |
|---|---|
| **Parties** (party 1) | Name `K. Kannan` · Role `Landlord` · Address `No. 12, Anna Salai, Chennai 600002` |
| **Parties** (party 2, **+ Add party**) | Name `R. Arun Prakash` · Role `Tenant` · Address `Flat 3B, Lakshmi Apartments, T. Nagar, Chennai 600017` |
| **Purpose** (required) | `Demand payment of Rs. 80,000 rent arrears for August and September 2026 from the tenant, and give notice to vacate the premises by 31 October 2026 if the arrears are not paid within 15 days.` |
| **Extra instructions** (optional) | `Rent is Rs. 40,000 a month under the lease deed dated 1 April 2026. Send by registered post with acknowledgement due. Formal tone; refer to the Rent Authority and the competent court at Chennai.` |

**Purpose** tells the AI what the notice must achieve (the demand, the deadline, the consequence); every clause
is drafted towards it. **Extra instructions** add the specifics (lease date, monthly rent, mode of service).
→ **Generate draft**. Then fill a few blanks in the left panel (e.g. *Date of Notice*, *Arrears Amount*) so the
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
[`demo-files/Notice_Returned_By_Tenant_Counsel.docx`](demo-files/Notice_Returned_By_Tenant_Counsel.docx).
It was made from **draft #126** on the dev data, so the numbers below are exact there. On any other notice,
make your own returned file instead (8A.2 below): the import works the same, only the changes differ.

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

## 8. New in this round: test guide (Import, Restore, two people saving, template look, tables)

Each part says what to do and what you should see. Run them on the dev instance (http://localhost:5174)
after the one-time setup.

### 8.0 One-time setup (already done on dev; do it on any other install after pulling)

```bat
cd Advocate-app-FE-main
npm install                                                     :: new package @tiptap/extension-table
cd ..\Advocate-app-BE-Django
venv\Scripts\python.exe manage.py migrate                       :: drafting up to 0012_word_version
venv\Scripts\python.exe manage.py refresh_template_layout       :: existing templates: clause places + look
```

The last command prints one line per template, e.g. *#70 Notice: 8 slots refreshed, 8 placed in the Word
file*, then *N template(s) refreshed, M skipped*. A PDF template also gets its Word version
(*"… (Word version made from the PDF)"*). A template is skipped when its file isn't on that machine, or when
it now splits into a different number of clauses (re-upload that one). Restart the backend after `migrate`, and
hard-refresh the browser (Ctrl+F5) so the new screens load.

Logins: **Rajesh Kumar** (senior, owner of the notice) and **Priya Nair** (junior), as in sections 1–7. Use
two browsers (or one normal + one private window) when a step needs both.

---

### 8A. Import changes: the draft comes back from outside

**What it is.** The client or the other side sends your draft back by email as a Word file: with Track
Changes, with Word comments, or just edited. You upload it, and every change they made becomes a suggestion
you accept or decline; their comments become comment threads. Nothing in the draft changes until you
finish deciding.

**8A.1 With the demo file (draft #126)** follow section 7D above. Check in particular:

| Step | Expected |
|---|---|
| Top bar of the draft | **Import changes** (upload icon) is there for Rajesh, the owner. Log in as Priya and open the same draft: no Import changes button. |
| Import with **From** empty | Message *From R. Arun Prakash (tenant counsel): 3 changes and 1 comment*; the review opens by itself. |
| Review title | *Changes from R. Arun Prakash (tenant counsel)*, not "Suggestions from Rajesh" (he only uploaded it). |
| Blanks such as `[Court Place]` | Not listed as changes: untouched blanks stay as they are. |
| Decline | Asks for a reason; the reason shows on the change afterwards. |
| Finish review | Confirm dialog with the counts; then the accepted change (30 days) is in the text, the declined ones are not. |
| Activity tab (right panel) | *History*: *Changes from R. Arun Prakash (tenant counsel): decided* with the counts (1 accepted, 2 declined) → **View** shows each decision and reason. |
| Comments tab | The counsel's comment, quoting the *Notice to Vacate* sentence, with Reply / Resolve. |
| Drafts list (sidebar → Drafting → Drafts) | Before you finish: the notice shows the chip *R. Arun Prakash (tenant counsel)'s changes to decide*. |

**8A.1b The client's reply (draft #126)**: clients rarely use Track Changes; they edit the text and add
comments. Use [`demo-files/Draft126_Returned_By_Client.docx`](demo-files/Draft126_Returned_By_Client.docx)
(from *K. Kannan (client)*):

1. **Import changes** → choose the file → **From**: `K. Kannan (client)` (the file has no tracked changes,
   so no name is read from it) → note `Client's corrections by email` → **Import**.
2. Expected message: *From K. Kannan (client): 3 changes and 2 comments (no tracked changes; compared with
   the draft)*. The review *Changes from K. Kannan (client)* lists:
   - **The Default**: Rs. 80,000 → Rs. 90,000, and a new paragraph *The tenant has also not paid the
     electricity charges for the same period.*;
   - **Demand**: 15 days → 7 days.
3. **Comments** tab, two threads: on *The Default* (*Please check this part. The tenant paid Rs. 10,000 in
   August by UPI; I have the screenshot.*) and on *Interest and Charges* (*Can we also ask for interest on the
   late payment?*).
4. A realistic decision: **Decline** 90,000 (`Client's UPI payment of 10,000 to be checked first`), **Accept**
   the electricity paragraph, **Decline** 7 days (`Statutory notice needs 15 days`). Reply to both comments.

**A returned file for any other draft** (the demo files above only line up with draft #126): make one with

```bat
cd Advocate-app-BE-Django
venv\Scripts\python.exe manage.py make_returned_file --draft <id> --sender counsel   :: Track Changes + a comment
venv\Scripts\python.exe manage.py make_returned_file --draft <id> --sender client    :: plain edits + 2 comments
```

It writes `docs/demo-files/Draft<id>_Returned_By_Counsel.docx` (or `_Client`) and prints exactly what it
changed: the first amount, the first "N days", a new paragraph, and where the comments are. Use those lines
as the expected result when you import it. The draft itself is not touched.

**8A.2 With your own file (any draft)**

1. On the draft: **Download → Word (.docx)** (plain draft). Open the file in Word.
2. **Review → Track Changes** on. Change a number, delete a sentence, add a new paragraph. Select a few words
   → **New Comment** → type a question. Save. (Word puts your name on the changes.)
3. Back in AMS: **Import changes** → choose the file → leave **From** empty → **Import**.
4. Expected: the message names your Word user name; the review lists exactly your edits, each under the
   clause it belongs to; the comment is in the Comments tab on that clause.

**8A.3 A file edited without Track Changes**

Same as 8A.2 but with Track Changes **off**. Expected: the edits are still found (the file is compared with
the draft); the message ends with *(no tracked changes; compared with the draft)*.

**8A.4 What is refused (each shows a clear message in the dialog)**

| Try | Message |
|---|---|
| Upload a PDF | *Only Word .docx files can be read. Ask for a .docx, or save the file as .docx.* |
| Upload the draft's own download, unchanged | *No changes or comments found: the file reads the same as the draft.* |
| Upload a renamed non-Word file as .docx | *That is not a Word (.docx) file.* |

**8A.5 Formatting they used is kept** (in the paragraphs they changed or added)

In 8A.2, also: centre one new paragraph, make two new lines a bulleted list, put a word in bold. After
accepting them: the paragraph is centred, the list is a list, the word is bold. Font, size and colour they
chose are dropped on purpose (the firm's formatting stays).

---

### 8B. Restore an older version

**What it is.** Put the draft back to any saved version, e.g. *"go back to Tuesday's wording"*. It can be
undone.

1. Open a draft you own → **Versions** (clock icon in the top bar). Note the latest version number, e.g. v5.
2. Change a sentence in the editor → **Save**.
3. **Versions** → on an older row (e.g. *v2 · AI draft*) click **Restore**.
4. Expected: a confirm box *Put the draft back to v2 …? The draft as it is now is saved as a version first,
   so you can come back to it.* → **OK**.
5. Expected: the editor shows v2's text; your sentence from step 2 is gone. **Versions** has two new rows on
   top: *Before restoring v2* and *Restored v2*.
6. Undo it: **Versions** → **Restore** on *Before restoring v2*. Expected: your sentence from step 2 is back.
7. With unsaved edits: type something, don't save, click **Restore** on any row. Expected: your edit is saved
   first (it's in *Before restoring …*), then the restore happens.
8. Rights: log in as Priya on a draft she was only asked to **suggest** on: the **Restore** buttons are not
   shown (only **Compare**). The owner, a task reviewer while the task is submitted, or a senior asked to
   review see them.
9. Comments and open suggestions on a clause that still exists stay attached to it after a restore.

---

### 8C. Two people saving the same draft

**What it is.** Two people have the same draft open. If they changed **different** clauses, both changes are
kept. If they changed the **same** clause, the later save is refused instead of silently wiping the other's
work.

Set-up: one draft that both can edit. Easiest: Priya's task draft while the task is **submitted** to Rajesh
(he may edit it then), or open the same draft as Rajesh in two browser windows.

**8C.1 Different clauses: both kept**

1. Window A and Window B: open the same draft (both load it now).
2. Window A: change a word in clause **1** → **Save**.
3. Window B (still showing the old text): change a word in clause **3** → **Save**.
4. Expected in Window B: a message *Saved. Changes a colleague made to other clauses are now shown
   too.*; clause 1 now shows A's change, clause 3 shows B's.
5. Reload Window A: both changes are there.

**8C.2 Same clause: refused, nothing lost**

1. Both windows: reload the draft.
2. Window A: change clause **2** → **Save**.
3. Window B: change clause **2** differently → **Save**.
4. Expected in Window B: a red bar *Not saved: someone else changed **<clause 2 heading>** after you opened the
   draft. Copy your wording, reload to see theirs, then make your change again.* with **Reload**. Your text is
   still in the editor (copy it now).
5. **Reload** → it asks before dropping your unsaved edits → OK → you see A's version of clause 2. Make your
   change again → **Save** → saved.

**8C.3 The "Updated" chip** (from the review features, still applies)

While a review is open on the draft, the window that did *not* save gets an **Updated · Reload** chip in the
top bar within about 30 seconds.

---

### 8D. Drafts look like their Word template (letterhead, fonts, layout)

**What it is.** A draft made from a Word template now **opens in the template's own look** (fonts, sizes,
colours, alignment, indents, spacing, tables, the template's header and footer with its logo, the page
size) and **Download / Save to case write the draft into the original Word file**, so the downloaded file
is the template itself with the new text: letterhead, footer, numbering, table styles and signature
block exactly as the firm made them. The AI only writes the text.

**Demo template:** [`demo-files/Template_Lease_With_Letterhead.docx`](demo-files/Template_Lease_With_Letterhead.docx)
(a lease on *Kumar & Associates* letterhead):

| In the file | Look |
|---|---|
| Header | maroon **K&A** seal (logo) on the left; **KUMAR & ASSOCIATES** (Georgia, 18 pt, maroon), *Advocates & Legal Consultants*, address line, all right-aligned |
| Footer | *Kumar & Associates, Advocates · Privileged & Confidential*, small, grey, centred |
| Title | **LEASE AGREEMENT**, 16 pt bold maroon, centred; *(Residential premises, Chennai)* italic, centred |
| Opening paragraph | Times New Roman 12, justified, `[[blanks]]` for names and addresses |
| Clause headings | **1. PREMISES** … **6. TERMINATION**, bold maroon, left |
| Clause bodies | justified, indented 0.75 cm, 1.15 line spacing |
| 4. Schedule of payments | a 3-column table *Period / Rent (Rs.) / Due on*, bold header row |
| End | *IN WITNESS WHEREOF…*, then the two signature lines right-aligned, bold |

**8D.1 Upload the template** (Window A, Rajesh)

1. **Drafting → Firm Templates → Upload template**.
2. **Template name:** `Lease (Kumar & Associates letterhead)` · **Agreement type:** `Lease Agreement` ·
   **Choose the template file:** `docs/demo-files/Template_Lease_With_Letterhead.docx`.
3. Wait until the row shows **Ready** (a few seconds; the AI names the clauses).
4. Click **View** on the row. Expected: the template **as it prints**, a PDF page view with the K&A seal and
   letterhead at the top, the footer at the bottom, maroon headings, justified text, the table, every page
   (not a plain-text version). The first View of a Word template takes a few seconds (it is made into a
   PDF once); later Views are instant.
5. In the same dialog, **Download original** saves the Word file you uploaded.
6. Same on **Drafting → Samples**: **View** a Word
   sample shows it as it prints too.

**8D.2 Make a draft from it**

1. **Drafting → Drafts → New draft → Type the facts directly**.
2. **Agreement type:** `Lease Agreement` (the template above is used by default; or pick it under *Follow a
   specific template?*) → **Continue**.
3. Fill the brief:

   | Field | Enter |
   |---|---|
   | Party 1 | Name `K. Kannan` · Role `Lessor` · Address `No. 12, Anna Salai, Chennai 600002` |
   | Party 2 | Name `R. Arun Prakash` · Role `Lessee` · Address `Flat 3B, Lakshmi Apartments, T. Nagar, Chennai 600017` |
   | Purpose | `Lease of the flat at T. Nagar for residence, 11 months from 1 November 2026, rent Rs. 40,000 a month, deposit Rs. 2,40,000.` |
   | Extra instructions | `Two months' notice to terminate. Rent by bank transfer by the 5th.` |

4. **Generate draft** and wait for it to open.

**8D.3 Check the editor** (expected)

| Where | You should see |
|---|---|
| Top of the paper | the template's **header**: the maroon K&A seal and *KUMAR & ASSOCIATES* with the address, set apart by a dashed line. Hover: *"The template's header"*. You can't click into it or edit it. |
| Bottom of the paper | the **footer** *Privileged & Confidential* line, below a dashed line |
| The paper | A4 width with the template's margins (wider than other drafts) |
| First clause | the template's own title **LEASE AGREEMENT** as its heading (centred, bold, maroon), then *(Residential premises, Chennai)* (centred, italic: a fixed line, kept as in the template), then the opening paragraph with the parties filled in. **No other title** above it, and no AI-made heading like *"Lease Agreement Introduction"* |
| Clause headings | the template's own, with their numbers: **1. PREMISES**, **2. TERM** … bold, maroon, left |
| Clause bodies | Times New Roman, justified, indented, slightly wider line spacing |
| 4. Schedule of payments | a grid with *Period / Rent (Rs.) / Due on*, bold header row |
| Signature lines | right-aligned, bold |

Click into a body paragraph: the **Justify** button in the toolbar is lit. Type in a body paragraph: the new
words keep the paragraph's font and indent.

**Save**, then click **Preview** (top bar, next to Edit). Expected: the same page read-only: header and footer,
**LEASE AGREEMENT** centred and maroon, the subtitle, numbered maroon headings, justified indented bodies, the
schedule as a grid; filled blanks show their values, empty ones a highlighted `[Label]`. (Preview shows the
saved draft: save first to see unsaved edits.)

**8D.4 Download keeps the template exactly**

1. **Download** (top bar). Expected: **no "Add firm letterhead" tick** in the menu (the template has its own
   letterhead), and the note *"PDF and Word keep the template's own letterhead, fonts and layout."*
2. **Word (.docx)** → open the file in Word (or LibreOffice). Expected:
   - the **header** is the template's (seal + firm name + address), on **every page**; the footer on every
     page;
   - the same page size and margins as the template;
   - the title, headings, fonts, colours, indents, spacing and table style exactly as in the template;
   - the **new text** (names, addresses, rent Rs. 40,000, 11 months…) in place of the template's wording;
     blanks you did not fill still show as `[Label]`;
   - nothing printed twice (no second heading, no "1. 1."), and no firm letterhead added on top.
3. **PDF** → the same, as a PDF.
4. Compare side by side with `Template_Lease_With_Letterhead.docx`: only the clause text differs.

**8D.5 Edits carry into the download**

1. In the editor: change the rent in *3. Rent and deposit*, make one word **bold**, centre one paragraph →
   **Save**.
2. **Download → Word**: the new rent, the bold word and the centred paragraph are there, still in the
   template's font and indent.
3. Delete a whole paragraph of a clause → Save → Download: it is gone from the file too (and the rest of
   the clause keeps its look).

**8D.6 Save to case / Submit to task**

**Save to case** (or *Submit to task* on a task draft) files the same template-form Word file on the case:
open it from the case's **Documents**: letterhead, footer and layout as in 8D.4.

**8D.6b Headings are the template's own, once**

Every clause heading is the template's own text, numbering included (*1. PREMISES*), shown once above the
clause, never repeated as the body's first line and never an AI-made name. A heading that carries case
details (e.g. a court line *IN THE COURT OF [[Court Name]], CHENNAI* in a Vakalathnama) is filled with your
case's details (*IN THE COURT OF THE CITY CIVIL COURT, CHENNAI*); a detail the facts don't give stays a
blank listed in **Placeholders**: type it there and leave the field to put it into the heading. Dotted
leaders after a filled value (*…of 2025………JURISDICTION*) stay dots, not `[[Details]]` fields.

**8D.7 Fixed lines, boxes and bracket columns (test with a Vakalatnama .docx with stamp boxes)**

1. Upload a Word Vakalatnama with stamp boxes and a `))` cause-title column as a firm template; draft from it
   with your case facts (court, suit number, parties).
2. Editor:
   - fixed wording (*VAKALATNAMA*, *Accepted by me:*, *Versus*) appears **once**, exactly as the template;
   - the court / place lines show **your** court only: the template's old court (*JUNAGADH…*) is not kept beside it;
   - *Dated:* / *Place:* appear once, filled;
   - no lines made only of `))`; party lines keep their tab gap (*K. Kannan )) &nbsp;&nbsp; PLAINTIFF*);
   - lines kept word for word show the template's bold words;
   - above the page: *"The template has 2 drawn boxes or shapes … stay in place in Download"*.
3. Download → open in Word: the stamp boxes and the `))` bracket column are where the template has them, the
   Place / Signature line keeps its tab gap, unchanged lines keep their bold words.

**8D.8 Old templates and old drafts**

- A template uploaded **before** this change gets the look after `manage.py refresh_template_layout`
  (8.0); new drafts from it then follow it. The **Notice** template (#70) on dev is already refreshed: a new
  notice draft opens with the title centred, the address block left and the clauses justified.
- Drafts made **before** this change don't change: they keep the plain editor and the house-style download
  with the optional firm letterhead.

---

### 8E. Drafts made from a Word sample look like the sample

**What it is.** The same for **Start from reference documents**: the first (base) Word document's look is
used for the draft and its download.

1. **Drafting → Drafts → New draft → Start from reference documents**.
2. **Add Documents** → upload `docs/demo-files/Template_Lease_With_Letterhead.docx` (any Word agreement with a
   letterhead works) → wait for **Ready** → select it (if you pick several, the **first** one picked is the
   base whose look is used) → **Next**.
3. **Template:** **Skip — no template** → **Continue** → **Parties** (same cards as *Type the facts
   directly*: Name, Entity type, **Role**, Represented by, Address; **+ Add party** for more): `K. Kannan` ·
   Individual · Role `Lessor`, and `R. Arun Prakash` · Individual · Role `Lessee` → an instruction (as in
   8D.2) → **Generate draft**. The **Role** tells the AI who is who, whatever order the reference names the
   parties in; the **Review** step lists each party with its role.
4. Expected: the same checks as **8D.3** and **8D.4**: header and footer around the paper, the sample's
   fonts, alignment, indents, table, and Download written into the sample file with its letterhead (no
   firm-letterhead tick).

---

### 8F. PDF templates and samples (converted to Word in the background)

**What it is.** A PDF has no styles, only positioned text. When a PDF template or sample is uploaded, AMS now
**makes a Word version of it in the background** (no message, no extra step) and uses that for everything
in 8D / 8E: the clauses, the look in the editor and the download. The original PDF is kept as uploaded.

**Demo file:** [`demo-files/Template_Lease_With_Letterhead.pdf`](demo-files/Template_Lease_With_Letterhead.pdf)
(the same lease as a PDF).

**8F.1 PDF template**

1. **Firm Templates → Upload template** → name `Lease (PDF letterhead)`, Agreement type `Lease Agreement (PDF)`
   → choose `Template_Lease_With_Letterhead.pdf` → wait for **Ready** (longer than a Word file: about a
   minute; the PDF is read and converted).
2. New draft → Type the facts directly → **Agreement type** `Lease Agreement (PDF)` → same brief as 8D.2 →
   **Generate draft**.
3. Expected, as in 8D.3:
   - the header with the **K&A seal** and *KUMAR & ASSOCIATES / Advocates & Legal Consultants / address*
     (taken from the top of the PDF's pages), and the footer line;
   - the title centred and bold; clause headings bold; bodies justified and indented; the schedule as a
     grid; signature lines right-aligned;
   - **no clause called "Advocates & Legal Consultants"**: letterhead text is header, not a clause;
   - the header as in the PDF: the seal on the left, *KUMAR & ASSOCIATES* (maroon) / *Advocates & Legal
     Consultants* / the address on the right, each on one line; no empty band above it;
   - the title and clause headings **maroon** as in the PDF, each heading **once** (not repeated as the
     first line);
   - a signature **row** in the PDF (*Sd/- … Advocate | Sd/- … Client*) comes out as side-by-side columns (a
     borderless table), not one merged line; no empty band at the top of the page;
   - the signature lines at the end right-aligned as two blocks (*[[Lessor Name]] / LESSOR*, *[[Lessee Name]]
     / LESSEE*), part of the last clause, not clauses of their own.
4. **Download → Word / PDF**: the Word version filled in, with that header and footer (no firm-letterhead
   tick).

**8F.2 PDF sample**: as 8E, uploading the `.pdf` instead of the `.docx`. Same expectations.

**8F.3 What to expect from other PDFs** (e.g. your own agreements)

| PDF | Result |
|---|---|
| Made from Word (text you can select) | Good: paragraphs, alignment, indents, bold headings, bordered tables, a logo at the top |
| Fonts | The PDF's font family and sizes where it names them (Times, Arial…); others fall back to the document's main font |
| Tables **without borders** | Not recognised as tables (they come out as lines of text) |
| **Scanned** (an image; text not selectable) | No Word version: the draft keeps the editor default look and the old alignment guess; Download gives the house style with the optional firm letterhead |
| Very complex layouts (columns, text boxes, watermarks) | Approximate: text and order are right, layout is simplified |

For an exact look, ask the client / colleague for the **Word** file and upload that.

---

### 8G. Tables stay tables

**What it is.** The editor keeps tables (a ruled grid). Tables in **Word** templates / samples now reach the
draft as tables too (before, only PDF tables did; Word tables became lines like *Month — Rent*).

1. Draft from the lease template (8D) or any template / sample with a table. Expected: *Schedule of
   payments* shows as a grid in the editor.
2. **Save**, reload the page. Expected: still a grid.
3. Edit a cell (e.g. a rent figure) → Save → **Compare** with the previous version. Expected: the change is
   shown in that table row.
4. **Download → Word (.docx)**: on a template-look draft (8D) the table is the **template's** table (same
   style, header row, borders) with the new cells; on other drafts a plain ruled Word table.
5. Suggestions keep it: as a reviewer in suggest mode, change one cell → **Send suggestions**; as the owner,
   **Accept** it → **Finish review**. Expected: still a grid, only that cell changed.
6. Import keeps it: in a downloaded Word copy change one cell (8A.2), import, accept. Expected: still a grid.
7. Known limits: merged cells and column widths are not kept when a clause is rebuilt in the editor (the
   download into the template keeps the template's own widths); no "insert table" button yet.

---

### 8H. Quick checklist

| # | Feature | Pass when |
|---|---|---|
| 1 | Import with tracked changes | Exact changes listed, sender's name on the review |
| 2 | Import with comments | Comment thread on the right clause, quoting their words |
| 3 | Import without tracked changes | Edits still found, "(no tracked changes…)" note |
| 4 | Import refused | PDF / unchanged / non-Word each show their message |
| 5 | Restore | Old text back; *Before restoring* + *Restored* versions; undo works |
| 6 | Save, different clauses | Both changes kept, "colleague's changes" message |
| 7 | Save, same clause | Red "Not saved" bar, nothing overwritten |
| 7a | View on Firm Templates | Word template shown as it prints (letterhead, logo, layout); Download original saves the .docx |
| 8 | Word template look (editor) | Header with logo, footer, fonts, colours, alignment, indents, table as in the template |
| 9 | Word template download | Downloaded Word / PDF = the template file with the new text; no firm-letterhead tick |
| 10 | Edits in the download | Changed text, bold, alignment and deleted paragraphs carried into the file |
| 11 | Word sample look | 8D checks pass for a draft from a Word sample |
| 12 | PDF template / sample | Logo + letterhead in the header, layout as the PDF, no letterhead "clause" |
| 13 | Scanned PDF | Still works, plain look, firm-letterhead tick offered |
| 14 | Old template refreshed | Notice (#70): new draft opens centred / left / justified as the template |
| 15 | Tables | Grid survives save, compare, suggestions, import, Word download |

## 9. Optional extras (if time allows)

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

