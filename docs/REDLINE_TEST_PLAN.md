# Redline features: test story (step by step)

One lease matter, followed from the first task to the copy sent to the other side's lawyer, then a
second matter where colleagues review each other's drafts without a task. Every feature added for
**versions, downloads, redlines, on-screen compare, comments, accept / reject, suggestions and Request review**
is tested at the moment it would really be used. Do the chapters **in order**: each one uses what the
one before created.

How to read a step:
- **Where:** the screen or window to be on.
- **Do:** exactly what to click or type.
- **✅ Expect:** what you should see. If you see something else, write it in the checklist at the end.
- **`[C3]`**: the scenario's ID, to tick in the checklist.

Feature reference: [DRAFT_EXPORT.md](DRAFT_EXPORT.md) (versions, redline, compare) · [DRAFT_REVIEW.md](DRAFT_REVIEW.md) (suggestions, accept / reject, Request review) · Short meeting script: [DEMO_REDLINE.md](DEMO_REDLINE.md)

---

## Before you start (10 minutes)

| # | Do | ✅ Expect |
|---|---|---|
| 0.1 | Open **http://192.168.1.36:5174** in Chrome. If it doesn't load, double-click `run-dev.bat` in the `ams-main` folder and wait ~15 s. | The PactPro sign-in page. (The test app on 5173 does **not** have these features.) |
| 0.2 | Make sure you know three logins: a **senior** (e.g. Rajesh Kumar), a **junior on his team** (e.g. Priya Nair) and an **outsider** from another team or firm. | — |
| 0.3 | **Window A:** sign in as the **senior**. **Window B:** open an **Incognito** window (Ctrl+Shift+N), go to the same address, sign in as the **junior**. Put them side by side. | Two sessions at once. |
| 0.4 | Check that Kannan's case exists: in Window A, sidebar **Cases** → search `Kannan`. | The case is listed. Note its number. |
| 0.5 | Have the sample file ready: `ams-main\docs\demo-files\Sample_Residential_Lease_Deed_Chennai.docx`. | — |
| 0.6 | Warm up the PDF converter: in Window A open any existing draft (sidebar **Drafting → Drafts** → any row) → **Download** → **PDF**. | A PDF downloads after up to ~30 s. Later PDFs take ~7 s. |

**The cast:** **Rajesh** = the senior (Window A) · **Priya** = the junior (Window B) · **Arjun** = the outsider
(chapter 9) · **Kannan** = the client (never logs in).

---

## Chapter 1 — Rajesh hands out the work

**Where:** Window A (Rajesh).

| # | Do | ✅ Expect |
|---|---|---|
| 1.1 | Sidebar **Tasks** → **New task** (top right). | A form opens. |
| 1.2 | **Task:** `Draft lease deed for Kannan` · **Priority:** High · **Deadline:** any date this week · **Link case:** Kannan's case · **Assign to:** Priya. | All fields filled. **Link case** matters: a draft can only be submitted to a task that has a case. |
| 1.3 | Click **Add task**. | The task appears in the list with Priya's name. |

---

## Chapter 2 — Priya drafts with the AI

**Where:** Window B (Priya).

### 2A. Create the draft

| # | Do | ✅ Expect |
|---|---|---|
| 2.1 | Sidebar **Tasks**. Click the task **Draft lease deed for Kannan**. | A side panel opens with the task's details. |
| 2.2 | In the panel click **Draft for this task**. | The new-draft screen opens, already linked to Kannan's case and the task. |
| 2.3 | If asked how to begin, pick **Start from reference documents** and continue. | The wizard's first step, *Documents*. |
| 2.4 | Click **Add documents** → tab **Upload new** → **Choose a file to upload** → pick `Sample_Residential_Lease_Deed_Chennai.docx`. | The dialog closes; the document is listed (it says it's processing, then ready). |
| 2.5 | Click **Continue**. On the template step click **Skip, no template**. | The details step. |
| 2.6 | Fill the required fields (parties: Kannan as lessor, R. Arun Prakash as lessee; rent `40,000`; 11 months). In **Instructions for the draft** type `Residential lease, Chennai, 2 months' deposit`. Click **Review**. | A summary of what you entered. |
| 2.7 | Click **Generate draft** (it's enabled once the document is ready). Wait about a minute. | The draft editor opens with the generated lease. The title **RESIDENTIAL LEASE DEED** is at the top. Note the draft's number (**#123** under the title). |

### 2B. The first version is automatic `[V1]`

| # | Do | ✅ Expect |
|---|---|---|
| 2.8 | Top bar **Versions**. | A small panel: a label box with **Save**, and the list. **v1 · AI draft**, kind *AI draft*, today's time. `[V1]` |
| 2.9 | Click outside the panel (or press Esc). | It closes. |

### 2C. The title survives saving `[F1]`

| # | Do | ✅ Expect |
|---|---|---|
| 2.10 | In the document change the tenant's name slightly (e.g. add a middle initial) and one date. | The **Save** button (top bar) is enabled. |
| 2.11 | Click **Save**, then reload the page (F5). | The title **RESIDENTIAL LEASE DEED** is still shown at the top of the document. `[F1]` |

### 2D. Saving versions by hand `[V2]` `[V3]` `[V4]`

| # | Do | ✅ Expect |
|---|---|---|
| 2.12 | **Versions** → type `Before rent changes` in the box → **Save**. | **v2 · Before rent changes** at the top of the list (newest first), kind *Saved*. `[V2]` |
| 2.13 | Close the panel. Change one more word in the document but **don't** click Save (the button still says *Save*). | — |
| 2.14 | **Versions** → leave the box **empty** → **Save**. | The top-bar button changes to **Saved** (your edit was saved first) and a new row **v3 · Saved** appears. `[V3]` `[V4]` |

### 2E. Downloading files `[D1]` `[D2]` `[D5]` `[D6]`

| # | Do | ✅ Expect |
|---|---|---|
| 2.15 | Top bar **Download**. | A panel: a tick **Add firm letterhead**, then **PDF**, **Word (.docx)**, **Redline (tracked changes)…**, and a note: letterhead is for notices, opinions and letters, not deeds or pleadings. |
| 2.16 | Make sure the tick is **off** → click **Word (.docx)**. Open the file. | A file named like `Residential_Lease_Deed_2026-10-08.docx`. In Word: the title, then every clause, A4 layout. `[D1]` |
| 2.17 | **Download** → **PDF**. Open it. | After ~7 s a `.pdf` downloads (not the browser's print window). Same content as the Word file. `[D2]` |
| 2.18 | **Download** → press **Esc**. **Download** again → click somewhere on the document. **Download** again → click the tick on and off. | The panel closes on Esc and on the outside click. Clicking the tick does **not** close it. Leave it **off**. `[D5]` |
| 2.19 | Type a new word in the document, **don't** save → **Download → Word (.docx)** → open the file. | The new word is in the file; the top bar shows **Saved**. `[D6]` |

### 2F. A first look at Compare `[C1]` `[C13]`

| # | Do | ✅ Expect |
|---|---|---|
| 2.20 | Top bar **Compare** (next to Edit / Preview). | The document is replaced by the compare view. The bar shows **From:** your newest version and **To:** *Current draft (now)*, and **0 changes** (nothing changed since that version). The Compare button looks pressed. `[C1]` |
| 2.21 | In the bar, **From** → choose **v1 · AI draft**. | The count changes (e.g. *3 changes*) and your edits since the AI draft are marked. |
| 2.22 | Click **Close** (right end of the bar). | Back in the editor, exactly as before, side panels intact. `[C13]` |

---

## Chapter 3 — Priya submits for review `[V5]` `[V12]` `[F3]`

**Where:** Window B (Priya).

| # | Do | ✅ Expect |
|---|---|---|
| 3.1 | Top bar **Submit to task**. | A success message. A green chip near the title: *Submitted for review · v1 · …*. |
| 3.2 | **Versions**. | A new top row **Submitted for review · filed as document v1**, kind *Sent*. `[V5]` |
| 3.3 | Read that row. | **vN** at the start (e.g. v4) is the draft's own version number. *filed as document v1* is the copy filed on Kannan's case. Two different numbers, by design. No bare "(v1)" anywhere. `[V12]` `[F3]` |

---

## Chapter 4 — Rajesh reviews and corrects

**Where:** Window A (Rajesh).

### 4A. Open the submitted draft `[R1]`

| # | Do | ✅ Expect |
|---|---|---|
| 4.1 | Sidebar **Tasks** → click **Draft lease deed for Kannan**. | The side panel shows it as *Submitted*, with **Open draft**. |
| 4.2 | Click **Open draft**. | The draft opens. A blue banner: *Reviewing Priya Nair's draft for task "Draft lease deed for Kannan": awaiting your review*, with **Request changes** and **Approve** on the right. `[R1]` |

### 4B. First a question: a comment `[K1]` `[K2]` `[K3]`

In a task the senior **corrects** (binding) and, when he isn't sure, **asks**. He doesn't suggest.

| # | Do | ✅ Expect |
|---|---|---|
| 4.2a | Look at the top bar. | **Comment** is there; there is **no Suggest** toggle (suggestions are only for Request review, chapter 8). `[K1]` |
| 4.2b | In **2. RENT** select the words *paid monthly* (or the payment sentence) → **Comment**. | The editor shows; the right panel switches to **Comments** with a new box quoting "paid monthly". |
| 4.2c | Type `Did the client agree to rent in advance?` → **Comment**. | The thread appears: the quote, *Rajesh Kumar · now*, the question, a Reply box and **Resolve**. The passage gets an amber marker in the document. The tab reads **Comments (1)**; a banner *Comments: 1 open* with **View**. `[K2]` |
| 4.2d | Click the quoted words in the thread. | The document scrolls to that clause and flashes it. `[K3]` |

### 4B2. The senior's corrections (edited directly)
### 4B2. The senior's corrections (edited directly)

| # | Do | ✅ Expect |
|---|---|---|
| 4.3 | In clause **2. RENT** change `40,000` to `45,000` (and "Forty" to "Forty-Five" if you like). | — |
| 4.4 | In **5. USE OF THE PREMISES** delete the whole sentence *"The Lessee may sub-let the Premises…"*. | — |
| 4.5 | In **8. TERMINATION** change `one (1) month's` to `two (2) months'`. | — |
| 4.6 | At the end of 8. TERMINATION add a new paragraph: `Either Party may terminate forthwith on a material breach not remedied within 15 days of written notice.` | — |
| 4.7 | Change `shall be entitled to terminate` to `shall have the right to terminate`. | — |
| 4.8 | Select one word anywhere (e.g. *Lessor*) and make it **bold** with the toolbar. Change nothing else about it. | — |
| 4.9 | Click **Save**. | Button shows **Saved**. |

### 4C. A marker for the next round `[R3]`

| # | Do | ✅ Expect |
|---|---|---|
| 4.10 | **Versions** → type `My corrections` → **Save**. | **My corrections** appears at the top. A reviewer **can** save versions while the draft awaits his review. `[R3]` |

### 4D. Rajesh checks his own work on screen `[C2]` `[C3]` `[C16]`

| # | Do | ✅ Expect |
|---|---|---|
| 4.11 | Close the panel → top bar **Compare**. | **From:** Priya's *Submitted for review* version · **To:** *Current draft (now)* · a line like *"5 changes · 14 words added, 9 removed"*. |
| 4.12 | Look at the document. | Added text **green and underlined**, removed text **red and struck through**, a coloured bar left of each changed paragraph, everything else plain. `[C2]` |
| 4.13 | Find the rent. | Only `40` struck and `45` added. `,000` and the rest of the sentence are plain. `[C3]` |
| 4.14 | Find the word you bolded. | It is **not** marked: formatting-only changes don't count. `[C16]` |

### 4E. A redline file for his records `[L1]` `[L2]` `[L5]`

| # | Do | ✅ Expect |
|---|---|---|
| 4.15 | **Close** → **Download** → **Redline (tracked changes)…**. | A dialog: **Compare from** = Priya's *Submitted for review* version, **Compare to** = *Current draft (now)*, **Word (editable)** selected. `[L1]` |
| 4.16 | Click **Download**. | A file named like `Residential_Lease_Deed_redline_v4-current_2026-10-08.docx`. The dialog says *"Downloaded: 14 word(s) added, 9 removed."* `[L2]` |
| 4.17 | Click **PDF (read-only)** → **Download**. Open the PDF. | The same changes in colour, with change bars in the margin. It can't be edited. `[L5]` |
| 4.18 | **Close** the dialog. | — |

### 4F. Send it back `[R4]` `[T1]` `[T2]`

| # | Do | ✅ Expect |
|---|---|---|
| 4.18a | Hover over **Approve** in the blue banner. | It is **disabled**: *Decide on every change first (Review) and resolve every comment* (his question is still open). `[T1]` |
| 4.19 | Click **Request changes**. Type `See my corrections. Also add a 6-month lock-in clause.` → **Send back**. | A confirmation. The banner now says *sent back for changes*. `[R4]` |
| 4.20 | **Versions**. | A new row **Sent back for changes** (kind *Sent back*): the fixed point Priya's next changes will be compared against. `[T2]` |

---

## Chapter 5 — Priya learns what changed

**Where:** Window B (Priya).

### 5A. Open the senior's changes `[R5]`

| # | Do | ✅ Expect |
|---|---|---|
| 5.1 | Reload the draft page (F5). | An orange notice: *Rajesh Kumar asked for changes: See my corrections. Also add a 6-month lock-in clause.* … with a button **See what Rajesh Kumar changed**. Also: *Corrections by Rajesh Kumar · 0 of 5 to acknowledge or query (they stay in the draft)* with **Review** (the number depends on how many paragraphs he changed), and *Comments: 1 open* with **View**. A notification *Comment on …* in the bell. |
| 5.2 | Click **See what Rajesh Kumar changed**. | The compare view, **From:** her submission · **To:** *Current draft (now)*. Exactly Rajesh's corrections are marked, nothing else. `[R5]` |

### 5B. Walk through the changes `[C4]` `[C5]` `[C6]` `[C15]` `[C7]`

| # | Do | ✅ Expect |
|---|---|---|
| 5.3 | Look at the **change list** on the left. | One entry per changed paragraph, named by its section: *2. RENT*, *5. USE OF THE PREMISES*, *8. TERMINATION*… Each has a tag **Changed**, **Added** or **Removed** and a snippet of the changed words. `[C4]` |
| 5.4 | Click an entry under *8. TERMINATION*. | The document scrolls to it and outlines it in blue; the entry is highlighted. `[C5]` |
| 5.5 | Press **▶** (next) repeatedly until the last change, then once more. Then press **◀** (previous). | It steps through every change in order; after the last it wraps to the first; ◀ goes backwards. `[C6]` |
| 5.6 | Find the sub-letting sentence and the new breach sentence. | Sub-letting: the whole sentence struck through, tagged **Removed**. Breach: the whole sentence underlined, tagged **Added**. `[C15]` |
| 5.7 | Click **Final** (in the bar). Then **All markup**. | Final: removed text disappears, added text looks normal, only the margin bars remain. All markup brings the marks back. `[C7]` |

### 5C. Keep a copy `[C12]`

| # | Do | ✅ Expect |
|---|---|---|
| 5.8 | In the compare bar **Download** → **Word (editable)**. Then **Download** → **PDF (read-only)**. | Both files show exactly the changes on screen, with the same counts. `[C12]` |

### 5D. Try Word's own review buttons `[L3]` `[L4]`

| # | Do | ✅ Expect |
|---|---|---|
| 5.9 | Open the Word file from 5.8 in Word or LibreOffice Writer. Hover over a change (or open the Review pane). | Each change shows a name and the time. **Today the name is the person who downloaded the file (Priya here), not who made the change**; recording the real author is planned (DRAFT_REVIEW.md). `[L3]` |
| 5.10 | **Review → Accept All**. Look. Undo (Ctrl+Z). **Review → Reject All**. Look. Close without saving. | Accept All = today's draft (Rajesh's text). Reject All = Priya's submission. (In AMS there is nothing to accept: Rajesh's changes are already in the draft. Accept / Reject matters for outside parties, chapter 7.) `[L4]` |

### 5E. Acknowledge or query the corrections `[T3]` `[S4]` `[K4]`

| # | Do | ✅ Expect |
|---|---|---|
| 5.10a | On the banner *Corrections by Rajesh Kumar* click **Review**. | The review view of Rajesh's direct corrections. Under each change: **OK** and **Query** only, no Reject (a senior's corrections are binding). `[T3]` |
| 5.10b | Under the rent change click **Query**. | A small box opens. **Query** stays disabled until you type. Type `Client agreed 40,000?` → **Query**. |
| 5.10c | Click **OK all** in the bar. | Every other change shows **Acknowledged**; the rent keeps **Queried: Client agreed 40,000?** ("all" never overwrites a decision already made). `[S4]` |
| 5.10d | **Close**, then open the **Comments** tab. | Two threads: Rajesh's question, and **her query** on the words "Rs. 45,000", from Priya. A query is a question to the senior too. `[K4]` |

### 5F. Answer the senior's question `[K5]` `[K6]`

| # | Do | ✅ Expect |
|---|---|---|
| 5.10e | In Rajesh's thread type `Client agreed rent in arrears, see meeting note of 2 Oct.` → **Reply**. | The reply appears under his question. There is **no Resolve** button for Priya on his question: only he can close it. `[K5]` |
| 5.10f | Look at **Submit to task**. | **Enabled**: open comments don't block a resubmission (a reply is enough). `[K6]` |

### 5G. Do what was asked and resubmit `[C11]` `[V6]` `[R6]`

| # | Do | ✅ Expect |
|---|---|---|
| 5.11 | **Close** the compare view. At the end of 8. TERMINATION type: `The Lessee shall not terminate this lease during the first six (6) months (lock-in period).` **Don't** save. | The Save button is enabled. |
| 5.12 | Click **Compare**. | The top bar turns to **Saved** (saved first), and the new lock-in sentence appears as an **Added** change at the end of the list. `[C11]` |
| 5.13 | **Close** → **Submit to task**. A box asks *What did you change?* → type `Added 6-month lock-in clause.` → **Submit**. | Success. **Versions** now has a second row **Submitted for review · filed as document v2**. `[V6]` `[R6]` |

---

## Chapter 6 — Rajesh checks round two and approves

**Where:** Window A (Rajesh).

### 6A. What changed this round `[R2]` `[C10]` `[R7]`

| # | Do | ✅ Expect |
|---|---|---|
| 6.1 | Reload the draft page (F5). | The blue banner says *awaiting your review* and also *Changed since the last version: …* with Priya's note, and two buttons: **What changed** and **Show in document**. Below it: *Changes by Priya Nair · 0 of 1 to decide* with **Review**, and *Comments: 2 open (1 answered)* with **View**. `[T5]` |
| 6.1a | Click **View** on the comments banner. | The Comments tab: his question with Priya's reply, and Priya's query on "Rs. 45,000". Both passages are marked in the document. `[T6]` |
| 6.2 | Click **What changed**. Close it. Then click **Show in document**. | **What changed:** a text list of changed sections. **Show in document:** the compare view from Priya's latest submission to now. It shows **0 changes**, because Rajesh hasn't edited since. `[R2]` |
| 6.3 | What Rajesh really wants is *what Priya did after his corrections*. **Close** → **Versions** → on the row **My corrections** click **Compare**. | The compare view opens with **From: My corrections**. Only the lock-in sentence is marked (Added). `[C10]` `[R7]` |

### 6B. Comparing any two versions `[C8]` `[C9]`

| # | Do | ✅ Expect |
|---|---|---|
| 6.4 | In the bar set **From** = **v1 · AI draft** (To stays *Current draft (now)*). | Everything people changed since the AI wrote it is marked. |
| 6.5 | Set **To** = **My corrections**. | Only the changes between v1 and *My corrections* (Priya's first edits + Rajesh's corrections, not the lock-in). `[C8]` |
| 6.6 | Set **From** = **My corrections** too (both the same). | *"No differences between these versions."* in the list, *0 changes*, the document plain. `[C9]` |

### 6C. The same in the download dialog `[L6]` `[L7]` `[L8]`

| # | Do | ✅ Expect |
|---|---|---|
| 6.7 | **Close** → **Download** → **Redline (tracked changes)…** → **Compare from** = *v1 · AI draft*, **Compare to** = *My corrections* → **Download**. | A file named like `…_redline_v1-v6_….docx`, with only those differences. `[L6]` |
| 6.8 | Set **Compare to** = *v1 · AI draft* as well. | The **Download** button is greyed out. `[L7]` |
| 6.9 | **Compare from** = the newest version in the list, **Compare to** = *Current draft (now)* → **Download**. | It downloads, and the dialog says *"Downloaded: no differences between these versions."* `[L8]` |
| 6.10 | **Close**. | — |

### 6D. Keep or reject Priya's changes `[T7]` `[S7]`

| # | Do | ✅ Expect |
|---|---|---|
| 6.10a | Hover over **Approve**. | **Disabled** until Priya's changes are decided. |
| 6.10b | On *Changes by Priya Nair* click **Review**. | One change, the lock-in clause, with **Keep** / **Reject**. `[T7]` |
| 6.10c | Click **Reject** under the lock-in clause. Then click **Change** next to it → **Keep**. | After a choice only its result shows (*Rejected*) with a **Change** link, not the buttons again. **Change** brings the buttons back; after **Keep** it shows *Kept*: a decision can be changed until the round is finished. `[S7]` |
| 6.10d | Click **Keep all** → **Finish review** → a dialog *Finish this review?* sums it up (e.g. *1 kept*), says it can't be undone → **Finish review**. *(Every Finish review in this story asks the same; Cancel leaves the round open.)* | The view closes; the change stays in the draft. **Versions** has **Review: 1 accepted**. **Approve** is still disabled: two comments are open. |
| 6.10e | **Comments** tab: on his question click **Resolve**; on Priya's query reply `Yes, the client confirmed 45,000 on 5 Oct.` → **Resolve**. | Both move under *Show 2 resolved*; the markers and the comments banner disappear; **Approve** is enabled. `[K7]` |
| 6.10f | *(Optional)* Under *Show 2 resolved* click **Reopen** on one, then **Resolve** again. | It returns to the open list, then back. `[K8]` |

### 6E. Approve `[R8]` `[P3]`

| # | Do | ✅ Expect |
|---|---|---|
| 6.11 | In the banner click **Approve**. | *Approved, task completed.* The banner says *approved by Rajesh Kumar*; **Request changes** / **Approve** are gone. |
| 6.12 | Click **Versions**. Then **Compare**. Then **Download**. | **Versions** lists everything but has **no Save box** (read-only for the reviewer after approval). **Compare** and **Download** still work. `[R8]` `[P3]` |

---

## Chapter 7 — The draft leaves the firm

**Where:** Window B (Priya).

### 7A. After approval `[R9]`

| # | Do | ✅ Expect |
|---|---|---|
| 7.1 | Reload the draft page. | A green notice: *Approved by Rajesh Kumar.* Priya can still edit, save versions and compare (she owns the draft). `[R9]` |

### 7B. Sending to the tenant's lawyer

| # | Do | ✅ Expect |
|---|---|---|
| 7.2 | **Versions** → `Sent to tenant's counsel` → **Save**. | The new row is at the top. |
| 7.3 | **Download** → letterhead tick **off** → **Word (.docx)**. | A clean Word copy: this is what would be emailed. (A deed is signed by the parties, so no letterhead.) |
| 7.4 | Two days later Kannan asks for a bigger deposit. In **3. SECURITY DEPOSIT** change `80,000` to `1,20,000` (and the words to match). **Save**. | — |
| 7.5 | **Download** → **Redline (tracked changes)…** → **Compare from** = *Sent to tenant's counsel*, **To** = *Current draft (now)*, **Word (editable)** → **Download**. Open it in Word. | Only the deposit is tracked, with **Priya's** name (she downloaded it, and here she also made the change). This is the file the other lawyer can accept or reject in Word. |

### 7C. The firm letterhead `[D3]` `[D4]` `[L10]`

| # | Do | ✅ Expect |
|---|---|---|
| 7.6 | **Download** → tick **Add firm letterhead** → **PDF**. Then **Download → Word (.docx)**. Open both. | Same content as before, plus the firm's logo / office name / address at the top, GSTIN · PAN at the bottom, and a signature block at the end (For <office>, signature, seal, name, enrolment number). Anything missing from the firm profile is simply left out. `[D3]` |
| 7.7 | Reload the page → **Download**. | The tick is still on (remembered in this browser). In Window A, Rajesh's **Download** panel still has it off (each browser remembers its own). `[D4]` |
| 7.8 | With the tick on → **Redline (tracked changes)…**. | No letterhead tick in the dialog; its note ends with *"With firm letterhead."* Download → the redline has the letterhead. `[L10]` |
| 7.9 | **Download** → untick **Add firm letterhead** → press Esc. | Off again, so the next deed isn't sent on letterhead. |

---

## Chapter 8 — Colleagues review each other (no task)

Drafts made directly in Drafting (not from a task) are reviewed with **Request review**. What the
reviewer may do follows the firm rule: *whoever has authority decides, everyone else suggests*. Rajesh
(team head) may correct his juniors' drafts; a junior or a peer may only suggest.

### 8A. Rajesh asks Priya to proofread his notice `[Q1]`–`[Q9]`

| # | Do | ✅ Expect |
|---|---|---|
| 8.0 | *(Once.)* **Window A (Rajesh):** **Drafting → Firm Templates → Upload template** → name `Legal Notice – Rent Arrears`, **Agreement type** `Legal Notice` → choose `docs/demo-files/Template_Legal_Notice_Rent_Arrears.docx`. | The template is listed and reaches **Ready**. |
| 8.1 | **Drafting → Drafts** → **New draft** → **Type the facts directly** → **Agreement type** `Legal Notice` → **Continue** → title `Legal Notice – Rent Arrears`, parties `K. Kannan` (role `Landlord`) and `R. Arun Prakash` (role `Tenant`), **Purpose** `Demand payment of Rs. 80,000 rent arrears for August and September 2026 from the tenant, and give notice to vacate the premises by 31 October 2026 if the arrears are not paid within 15 days.`, **Extra instructions** `Rent is Rs. 40,000 a month under the lease deed dated 1 April 2026. Send by registered post with acknowledgement due.` → **Generate draft** (full field list: DEMO_REDLINE.md, section 7, *Making a notice*). Fill *Date of Notice* and *Arrears Amount*. | A notice with clauses *1. The Tenancy* … *7. Costs*, and **Request review** in the top bar (it has no task). |
| 8.2 | Open the **lease draft** from chapters 2–7 instead, and look at its top bar. | **No** Request review button: a task's draft is reviewed through the task. `[Q1]` Go back to the notice. |
| 8.3 | Click **Request review**. Open the **Reviewer** list. | Colleagues of Rajesh's team only, e.g. *Priya Nair*; only a senior is marked *(can correct)*. Nobody from another team or firm. `[Q2]` |
| 8.4 | Pick **Priya Nair**. | A note: *Priya Nair can suggest changes; you accept or decline them.* |
| 8.5 | **Note:** `Please check the dates and the demand amount.` → **Send request**. | The dialog closes. A slim bar: *With Priya Nair for review* with **Cancel request**. **Versions** has **Sent for review to Priya Nair**. `[Q3]` |
| 8.6 | **Window B (Priya):** the bell (top bar). | A notification *Please review: …* from Rajesh. `[Q4]` |
| 8.7 | Sidebar **Drafting → Drafts**. | A **For my review** panel above the list: the notice, *Rajesh Kumar asked …*, his note, *Not started*, and **Review**. **Window A:** Rajesh's Drafts list shows *With Priya Nair for review* beside the notice. `[Q5]` |
| 8.8 | Click **Review**. | The notice opens. A blue banner: *Rajesh Kumar asked you to review this draft.* with **Done reviewing**. No **Save to case**, **Re-draft** or **Request review** buttons, and **Versions** has no Save box. `[Q6]` |
| 8.9 | Change the date in **6. Notice to Vacate** and the amount in **2. The Default**. Click **Send suggestions**. | The editor returns to Rajesh's text. A banner *Suggestions from Priya Nair · waiting for Rajesh Kumar*. `[Q7]` |
| 8.10 | Click **Done reviewing**. | The banner goes; Priya can still read the notice but no longer suggest. In **Drafts**, the *For my review* panel is gone (nothing left). Before Done, the row read *1 set of changes sent · Waiting for Rajesh Kumar*; Rajesh's list showed *Priya Nair's changes to decide*. `[Q8]` |
| 8.11 | **Window A (Rajesh):** reload the notice. | A notification *Review done: …*, and a banner *Suggestions from Priya Nair · 0 of 2 to decide* → **Review**. |
| 8.12 | **Accept** the date, **Decline** the amount with the reason `Amount is as per the client's ledger` → **Finish review**. | The date is in the notice, the amount is not. **Versions**: **Review: 1 accepted, 1 declined**. `[Q9]` |

### 8B. Priya asks Rajesh to check her notice (he may correct) `[Q10]`–`[Q12]`

| # | Do | ✅ Expect |
|---|---|---|
| 8.13 | **Window B (Priya):** make her own notice the same way (New draft → Type the facts directly → Legal Notice) → **Request review** → pick **Rajesh Kumar**. | He is listed as *(can correct)*; the note says *Rajesh Kumar can correct it directly and suggest changes. Their corrections come back to you to acknowledge or query.* **Send request**. `[Q10]` |
| 8.14 | **Window A (Rajesh):** **Drafts → For my review → Review**. | Banner: *…you can correct it directly and suggest changes.* He has **Save** and the **Suggest** toggle. `[Q11]` |
| 8.15 | Correct one word directly → **Save** → **Done reviewing**. | After Done he can still read it but not edit. |
| 8.16 | **Window B (Priya):** reload. | *Corrections by Rajesh Kumar · 0 of 1 to acknowledge or query* → **Review** → **OK** → **Finish review**. The correction stays. `[Q12]` |

### 8C. Cancelling, outdated suggestions, withdrawing `[Q13]` `[S8]` `[S9]`

| # | Do | ✅ Expect |
|---|---|---|
| 8.17 | **Window A (Rajesh):** on his notice, **Request review** from **Priya** again. **Window B (Priya):** open it, suggest a change to paragraph 1 and to paragraph 3 → **Send suggestions**. | Rajesh sees *Suggestions from Priya Nair · 0 of 2 to decide*. |
| 8.18 | **Window A (Rajesh):** edit **paragraph 1** himself → **Save** → **Review** on Priya's suggestions. | Paragraph 1's suggestion shows **Outdated** (no buttons): its paragraph changed since. Paragraph 3's suggestion still has **Accept / Decline**: edits elsewhere don't matter. `[S8]` |
| 8.19 | **Close**. **Window B (Priya):** **View** on her suggestions → **Withdraw**. | The round closes; Rajesh's banner for it disappears on reload. `[S9]` |
| 8.20 | **Window A (Rajesh):** click **Cancel request** on *Review requested from Priya Nair*. **Window B (Priya):** reload the notice. | Priya can no longer open it (not found) and it's not in her *For my review*. `[Q13]` |
| 8.21 | *(If you have a peer login: a colleague at Priya's level.)* Priya → **Request review** → the peer. | The peer is listed by name only (no *can correct*). `[Q14]` |

---

## Chapter 9 — Other drafts, other people, odd corners

### 9A. A draft without a task `[V7]` `[V8]` `[V9]`

**Where:** Window A (Rajesh).

| # | Do | ✅ Expect |
|---|---|---|
| 9.1 | Sidebar **Drafting → Drafts** → **New draft** → **Type the facts directly** → continue, and make a short legal notice (any facts). **Generate draft**. | A new draft, **not** linked to a task. Its top bar shows **Save to case** instead of *Submit to task*. |
| 9.2 | **Save to case** → pick Kannan's case if asked → wait for the success message → **Versions**. | A row **Saved to PactPro · filed as document v1**. `[V7]` |
| 9.3 | Top bar **Re-draft** → **Confirm**. Wait until the new text appears → **Versions**. | A new **AI draft** row is added; the earlier rows are still there. `[V8]` |
| 9.4 | **Compare** → **From** = the **first** *AI draft*. | The rewrite shows as changes: the old version kept its old text. `[V9]` |

### 9B. An old draft (made before versions existed) `[V10]` `[C14]` `[L9]`

| # | Do | ✅ Expect |
|---|---|---|
| 9.5 | **Drafting → Drafts** → open a draft created before this week. **Versions**. | *No versions saved yet.* `[V10]` |
| 9.6 | Top bar **Compare**. | *No saved versions yet. Use Versions → Save first, then compare.* `[C14]` |
| 9.7 | **Close** → **Download → Redline (tracked changes)…**. | *No saved versions yet. Use Versions → Save when you send the draft out…* `[L9]` |
| 9.8 | **Versions** → **Save**. Then **Compare**. | Saving works; Compare now opens (0 changes). |
| 9.9 | *(Only if you have one)* open a draft that has no clauses → **Versions → Save**. | *Could not save the version.* `[V11]` |

### 9C. People who shouldn't see it `[P1]` `[P4]` `[P2]`

| # | Do | ✅ Expect |
|---|---|---|
| 9.10 | **Window B:** sign out (top-right user menu) and sign in as **Arjun** (another firm). Type the lease draft's address: `http://192.168.1.36:5174/draft/<number from step 2.7>`. | A "not found" / empty page, and the lease isn't in his **Drafts** list. No versions, compare or downloads reachable. `[P1]` |
| 9.11 | Repeat as a **senior of another team** in the same firm, if you have one. | Not found. `[P4]` |
| 9.12 | Sign back in as **Priya**. Ask Rajesh (Window A) to give her another task linked to a case; Priya starts a draft from it (chapter 2 steps 2.1–2.7) and **doesn't submit**. In Window A, Rajesh types that draft's address. | Not found: a draft stays private to its author until it is submitted. `[P2]` |

### 9D. Optional checks `[D8]` `[D7]` `[L11]`

| # | Do | ✅ Expect |
|---|---|---|
| 9.13 | Sign in as a user whose role **doesn't** have the *Export drafts* permission (DRAFT_EXPORT) and open one of their drafts. | No **Download** button. **Compare** is still there (it needs only view permission). `[D8]` |
| 9.14 | Open `ams-main\Advocate-app-BE-Django\.env` in Notepad, add a line `LIBREOFFICE_PATH=C:\nowhere\soffice.exe`, save, wait ~5 s. In a draft: **Download → PDF**. | The browser's **print window** opens instead of a PDF download (the fallback). `[D7]` |
| 9.15 | Same setting: **Download → Redline… → PDF (read-only) → Download**. | *"PDF is not available on this server yet — download the Word redline instead."* `[L11]` |
| 9.16 | **Delete that line from `.env`** and save. **Download → PDF** again. | A normal PDF download again. |

### 9E. Screen size, theme and title `[C17]` `[C18]` `[F2]`

| # | Do | ✅ Expect |
|---|---|---|
| 9.17 | On the lease draft open **Compare**, then make the browser window narrow (drag its edge, or Ctrl+Shift+M in DevTools for a phone size). | The change list moves above the document; nothing scrolls sideways. `[C17]` |
| 9.18 | Switch to the **dark theme** (moon button in the top bar, or the user menu). | Green / red marks and the bars are still easy to read. Switch back afterwards. `[C18]` |
| 9.19 | **Compare** with **From** = *v1 · AI draft*. Look at the top of the document. | The title **RESIDENTIAL LEASE DEED** is never marked as a change. `[F2]` |

---

## Chapter 10 — For the developer *(optional)*

```bat
cd C:\Users\Sybrant\Downloads\ams-main\ams-main\Advocate-app-BE-Django
venv\Scripts\python.exe manage.py test drafting
```
✅ **Ran 50 tests … OK**.

```bat
cd C:\Users\Sybrant\Downloads\ams-main\ams-main\Advocate-app-FE-main
npx tsc --noEmit -p .
npm run lint
```
✅ No errors printed.

---

## Checklist

Tick each ID as its ✅ passes. The step number is where it's tested.

| Area | IDs (step) | Pass / Fail | Notes |
|---|---|---|---|
| Versions | V1 (2.8) · V2 (2.12) · V3, V4 (2.14) · V5 (3.2) · V6 (5.13) · V7 (9.2) · V8 (9.3) · V9 (9.4) · V10 (9.5) · V11 (9.9) · V12 (3.3) | | |
| Plain downloads | D1 (2.16) · D2 (2.17) · D3 (7.6) · D4 (7.7) · D5 (2.18) · D6 (2.19) · D7 (9.14) · D8 (9.13) | | |
| Redline download | L1 (4.15) · L2 (4.16) · L3 (5.9) · L4 (5.10) · L5 (4.17) · L6 (6.7) · L7 (6.8) · L8 (6.9) · L9 (9.7) · L10 (7.8) · L11 (9.15) | | |
| On-screen compare | C1 (2.20) · C2 (4.12) · C3 (4.13) · C4 (5.3) · C5 (5.4) · C6 (5.5) · C7 (5.7) · C8 (6.5) · C9 (6.6) · C10 (6.3) · C11 (5.12) · C12 (5.8) · C13 (2.22) · C14 (9.6) · C15 (5.6) · C16 (4.14) · C17 (9.17) · C18 (9.18) | | |
| Review loop | R1 (4.2) · R2 (6.2) · R3 (4.10) · R4 (4.19) · R5 (5.2) · R6 (5.13) · R7 (6.3) · R8 (6.12) · R9 (7.1) | | |
| Access | P1 (9.10) · P2 (9.12) · P3 (6.12) · P4 (9.11) | | |
| Comments | K1 (4.2a) · K2 (4.2c) · K3 (4.2d) · K4 (5.10d) · K5 (5.10e) · K6 (5.10f) · K7 (6.10e) · K8 (6.10f) | | |
| Decisions & suggestions | S4 (5.10c) · S7 (6.10c) · S8 (8.18) · S9 (8.19) · Q7 (8.9) and Q9 (8.12) for Accept / Decline | | |
| Task review loop | T1 (4.18a) · T2 (4.20) · T3 (5.10a) · T4 (5.10e) · T5 (6.1) · T6 (6.1a) · T7 (6.10b) | | |
| Request review | Q1 (8.2) · Q2 (8.3) · Q3 (8.5) · Q4 (8.6) · Q5 (8.7) · Q6 (8.8) · Q7 (8.9) · Q8 (8.10) · Q9 (8.12) · Q10 (8.13) · Q11 (8.14) · Q12 (8.16) · Q13 (8.20) · Q14 (8.21) | | |
| Fixes & labels | F1 (2.11) · F2 (9.19) · F3 (3.3) | | |

---

## Known limits (not failures)

- Formatting-only changes (bold, alignment) are not marked (`[C16]`, by design).
- Tables are compared row by row as text: a changed table shows as lines, not a grid.
- Accept / reject inside AMS works per **paragraph** (one change = one changed paragraph); word-by-word accept inside a paragraph is a later refinement.
- When a clause gets mixed decisions it is rebuilt from its paragraphs, so a table inside it comes back as plain lines.
- A file sent back by the client or opposite counsel can't be imported yet (roadmap step 3).
- PDFs take ~7 seconds each (~30 for the first after a restart).
- The name on Word tracked changes is whoever downloads the redline, not who made each change (`[L3]`); real authors are planned.
- Version numbers in the examples (v4, v6…) depend on how many versions you saved; yours may differ.
