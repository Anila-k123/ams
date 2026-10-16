# Demo / test: the PactPro editor, desktop editing and task documents (dev instance)

An end-to-end test of everything built around ONLYOFFICE (docs/ONLYOFFICE_PLAN.md) and desktop editing
(docs/DESKTOP_EDITING.md):
- drafts in the editor;
- any document in the editor;
- opening in Word / LibreOffice;
- "only Save to PactPro makes a version";
- the PactPro add-ons;
- task documents from writing to approval.

For a single story-style demo of all of this, see `docs/DEMO_EDITORS_CLIENT_PORTAL.md`.

It runs on the **dev instance** only; the test instance (5173 / 8080) still uses the old editor. The whole guide
takes about 2½ hours, and each part can be run on its own. Tick each **Expect** as you go and note anything
different.

| Part | What | Time |
|---|---|---|
| A | Setup | 10 min |
| B | Drafts in the PactPro editor (1–13) | 75 min |
| C | Any document in the editor (14–15) | 20 min |
| D | Opening and saving: Open with, Save choice, working copies (16–19) | 25 min |
| E | The PactPro add-ons in LibreOffice / Word (20) | 15 min |
| F | Task documents, start to approval (21–23) | 25 min |
| H | Client review in the portal | 20 min |
| G | Not built yet, reporting | — |

---

# Part A. Setup

## 0. Before you start (10 minutes)

**Services.** All three must be up:

| What | Address | Check |
|---|---|---|
| PactPro (dev) | http://192.168.1.36:5174 | The login page opens |
| Backend (dev) | port 8081, database `pactpro_db1` | `http://192.168.1.36:8081/api/health` answers |
| ONLYOFFICE Community 9.4 | http://192.168.1.36:8085/healthcheck | Shows `true` |

Optional full check (backend folder): `venv\Scripts\python.exe manage.py check_onlyoffice` should say *"ONLYOFFICE is
ready for AMS."*

**Logins** (firm Kumar & Associates, password `Demo@1234`):

| Person | Login | Used for |
|---|---|---|
| Priya Nair (junior) | priya@kumar-associates.demo | Writes drafts and documents; does tasks |
| Rajesh Kumar (senior) | rajesh@kumar-associates.demo | Assigns tasks and reviews them. **On dev his password is not `Demo@1234`**: reset it first, or skip the review steps |
| Karthik (intern) | karthik.intern@kumar-associates.demo | Reviewer, **suggestions only** |
| Admin | admin@kumar-associates.demo | Reviewer who **may correct** |
| Arjun (another team) | arjun@kumar-associates.demo | Must **not** see Priya's work |

Use a separate browser profile or a private window per person, so two can be logged in at once.

**On the test computer:**
- **LibreOffice**, for desktop editing; it works over plain http.
- **Microsoft Word**, optional: over plain http it may only open read-only, which is expected until PactPro is on
  HTTPS.
- **A clean start:** to test the "Open with" and "Save" questions from scratch, clear the site's data in the
  browser (it remembers choices per computer).

**Files** (`docs/demo-files/`, plus your own):
- **Firm templates already uploaded:**
  - **Lease (Kumar & Associates letterhead)**;
  - **Vakalathnama**, with stamp boxes;
  - **Power of Attorney** (a PDF);
  - **Notice**.
- **`Draft126_Returned_By_Client.docx`:** a returned Word file for Compare.

**What is different on the free Community edition** (expected, not bugs):
- ONLYOFFICE's own logo, "About" and some toolbar items (Draw, References, the editor's own Save icon) stay.
- Filling placeholders and applying Lisa's change **reload** the editor, because there is no connector.
- Clicking a placeholder or "jump to clause" does **not** move the cursor in the document.

**The save rule to keep in mind:** only **Save to PactPro** makes a version. That means PactPro's **Save** button (with
*Save to PactPro* ticked), **Submit to task**, or **Save to PactPro** in the bottom-right box or an add-on.
Everything else only updates your **working copy**:
- the editor's own Save icon / Ctrl+S, and its autosave;
- closing the editor;
- saving in Word / LibreOffice;
- Download.

You never lose work, but nothing becomes a version until you choose it.

---

# Part B. Drafts in the PactPro editor

## 1. A new draft opens in its template's look (Priya, 5 minutes)

| # | Do | Expect |
|---|---|---|
| 1.1 | Log in as **Priya** → **Drafting** → **New draft** → template **Lease (Kumar & Associates letterhead)**. Facts: Lessor *K. Kannan*, Lessee *R. Ravi*, premises *T. Nagar, Chennai*, rent *Rs. 40,000*, term *11 months from 1 November 2026*. Generate. | The draft is generated |
| 1.2 | When it's ready | The draft page opens with the **PactPro editor** (ONLYOFFICE) in the middle; placeholders, reference documents, Lisa and Review around it. **Open on desktop** is in the toolbar |
| 1.3 | Look at the document | Exactly the template: **K&A letterhead**, fonts, numbered maroon headings, justified clauses, page size. **No "Clause 123" boxes** around clauses |
| 1.4 | Look at the top bar | One line: **Compare**, **Download**, **Saved** (greyed), **Open on desktop**, **More**, **Request review**, **Save to case**. Not there any more (the editor has its own): Comment, Versions, Import changes, Suggest. The right side has **Ask Lisa**, **Review** (consistency / playbook) and **Activity**; no Comments tab |
| 1.4b | Click **More** | *Save options…*, *Finalise (lock the text)* and *Re-draft…* (red, at the bottom) |
| 1.4c | Click **Compare** in the top bar | PactPro's **Compare with…** dialog (an earlier version or a file you received back), the same as the editor's Collaboration → Compare → Document from storage |
| 1.5 | Drafting → **Drafts** → **Open** on this draft | The **Open with** dialog: *Desktop editor* / *PactPro editor*, *Remember my choice*. Pick **PactPro editor**: the draft page opens with the editor started |

## 2. Edit and save (Priya, 5 minutes)

| # | Do | Expect |
|---|---|---|
| 2.1 | Change a word in clause 2 (e.g. *renewable* → *extendable*) | PactPro's button turns to **Save** |
| 2.2 | Click **Save** | The **Save** dialog: *Save to PactPro (a new version)* ticked, *Save a copy to this computer*, *Remember my choice*. Click Save: toast *"Saved."*, the button shows **Saved** |
| 2.3 | Edit again, **Save**, tick **both** boxes | A new version **and** a Word file downloaded |
| 2.4 | Edit, **Save to PactPro**, tick only *Save a copy to this computer* | The file downloads with your edit; **no** new version (the button still reads **Save to PactPro**) |
| 2.5 | Edit, **Save**, tick *Remember my choice* | Later Saves don't ask. **More → Save options…** always asks, to change it |
| 2.6 | Edit and press **Ctrl+S** (or the editor's own Save icon) | **No** new version: PactPro's button still reads **Save to PactPro**, with the note *"Your work is safe; not yet a PactPro version"*. Typing again hides the note until the next Ctrl+S |
| 2.7 | Edit and **close the tab without saving**. Wait 15 seconds, reopen | The edit is still there and **Save** is enabled (kept as your working copy, not a version). Click Save to make it one |
| 2.8 | Before 2.7's reopen, open any other PactPro page | Bottom right: **Edits not saved to PactPro** lists the draft with **Save to PactPro** / **Discard** |

## 3. Placeholders (Priya, 5 minutes)

| # | Do | Expect |
|---|---|---|
| 3.1 | In the document, look at a blank (e.g. the lessor's address) | A **form field** showing its name (*Lessor Address*) in **grey on a light grey background**; once filled, the value takes the normal text look |
| 3.2 | Left panel **Placeholders** | Every blank is listed |
| 3.3 | Type values in **some** blanks, pressing **Enter** to move to the next | Nothing changes in the document yet; the button reads **Apply 2 to document** |
| 3.4 | **Apply 2 to document** | Toast *Applied 2 placeholders…*; the editor **reloads once** with each value **everywhere** it appeared |
| 3.5 | Fill the rest, **Apply** | Every field shows a ✓ with its value (filled fields stay listed so they can be changed) |
| 3.6 | **Change** a filled value, **Apply** | Updated in **every** place it appears |
| 3.7 | Click a field **in the document**, type a value, Save | The panel shows the new value |
| 3.8 | An **older** draft (made before form fields) | Its blanks are `[[…]]` text; the panel fills them the same way |

## 4. Lisa reads what you saved (Priya, 3 minutes)

| # | Do | Expect |
|---|---|---|
| 4.1 | Save to PactPro (2.2), then ask Lisa: *"What does the term clause say?"* | Lisa quotes your edited wording (*extendable*) |

## 5. Lisa's change as a tracked change (Priya, 5 minutes)

| # | Do | Expect |
|---|---|---|
| 5.1 | Ask Lisa: *"Change the monthly rent to Rs. 45,000"* | One card: every place the rent appears, each with a tick box and the old value struck through / the new one highlighted; places found by search say *also found here* |
| 5.1a | Untick one place, then **Accept** | Only the ticked places are kept |
| 5.1b | On a Vakalathnama with two advocates, ask *"Change the enrolment number to MS/3333/2026"* | Lisa asks **which one**, with one button per advocate's number and *All of them*; pick one → a card with that advocate's places only |
| 5.2 | **Accept** | Nothing changes in the document yet: a bar above Lisa's message box says *N accepted changes not in the document yet* |
| 5.2a | **Update in document** | The editor **reloads**; *40,000* struck through, *45,000* inserted, marked as **PactPro AI**'s change; only the changed digits are marked |
| 5.3 | Editor **Review** tab → **Accept** | The redline disappears |
| 5.4 | Another change, then **Reject** it | The clause stays as it was |
| 5.5 | Ask Lisa for a change, but type into that sentence yourself before **Update in document** | *"…changed since Lisa read it…"*; nothing changes |
| 5.6 | Save to PactPro first, then Lisa → **Make the language more formal** (or *More concise* / *Fix grammar*) → **Apply all** (or Accept some, Reject others) → **Update in document** | The editor reloads **once**; every changed clause shows as **PactPro AI** tracked changes; one new version (File → Version History). Toast: *N of Lisa's changes are in the document…* |
| 5.7 | As 5.6, but edit one of those clauses yourself before **Update in document** | The others are placed; a second toast names the clause that couldn't be placed |
| 5.8 | A clause over several lines with a blank (e.g. a Vakalathnama's party block) or a line repeated elsewhere (a signature line) → **Fix grammar** → **Update in document** | Placed: the change is matched line by line inside that clause only, with blanks as the document shows them |

## 6. Comments and @mentions (Priya + Karthik, 5 minutes)

| # | Do | Expect |
|---|---|---|
| 6.1 | Select a phrase → **Review** → **Comment** → *"Check stamp duty"* | The comment shows beside the text |
| 6.2 | Reply, then **Resolve** | Marked resolved |
| 6.3 | With Karthik as a reviewer (step 9), add a comment and type **@** | Only people on this draft are offered (Karthik); post it |
| 6.4 | Karthik: the bell | *"Priya … mentioned you on …"* with the comment |

## 7. Download, PDF, Save to case (Priya, 5 minutes)

| # | Do | Expect |
|---|---|---|
| 7.1 | Make an edit, **don't save**, **Download → Word** | The file includes that edit and looks like the editor. **No** new version is made (the button still reads **Save to PactPro**) |
| 7.2 | **Download → PDF** | The same look as a PDF |
| 7.3 | **Save to case** | Filed on the case as a document version |
| 7.4 | The editor's own File menu | No Download / Print (files leave only through PactPro) |
| 7.5 | Download while the draft isn't final | A light diagonal **DRAFT** watermark on every page |
| 7.6 | Save to PactPro, change a clause (e.g. the rent), Save to PactPro again. **Download → Redline** | *Compare from*: the Word file's versions (*v3 · Priya Nair · date*); *Compare to*: *Current draft (now)* or a version. **Download** (a few seconds): *"N word(s) added, M removed"* and a Word file **in the draft's own look** (letterhead, headings, tables) with your changes as **tracked changes** (Word: Review → accept / reject) |
| 7.7 | The same with **PDF (read-only)** | Additions underlined, deletions struck through, in colour |
| 7.8 | Compare two versions with no changes between them | *"no differences between these versions"* |

## 8. Hard templates keep their layout (Priya, 10 minutes)

| # | Do | Expect |
|---|---|---|
| 8.1 | New draft from **Vakalathnama** | The **stamp boxes** show; the `))` cause-title column, **bold words** and tab gaps are as in the template |
| 8.2 | Download → Word, open in Word | Identical to the editor |
| 8.3 | New draft from **Power of Attorney** (a PDF template) | An editable Word document close to the PDF's look |

## 9. Reviewer who may only suggest (Priya + Karthik, 10 minutes)

| # | Do | Expect |
|---|---|---|
| 9.1 | Priya: **Request review** → **Karthik**, **Suggestions only** | Request sent |
| 9.2 | Karthik opens the draft (Drafts for review) | Chip **"Suggesting: your edits are tracked"**; every edit is a tracked change; he can comment |
| 9.3 | Karthik edits and clicks **Save** | Saved |
| 9.4 | Priya reopens | Karthik's tracked changes show; she accepts one and rejects one |
| 9.5 | Karthik marks the review **Done**, reopens | **Read only** |

## 10. Reviewer who may correct, and access (Admin + Arjun, 5 minutes)

| # | Do | Expect |
|---|---|---|
| 10.1 | Priya: **Request review** → **Admin**, **May correct** | — |
| 10.2 | Admin opens it | Edits **directly**; can accept / reject tracked changes |
| 10.3 | **Arjun** opens the draft's address (copied from Priya) | It doesn't open |

## 11. Draft task: Submit and Approve are checked against the document (Rajesh + Priya, 10 minutes)

| # | Do | Expect |
|---|---|---|
| 11.1 | **Rajesh**: assign Priya *"Draft the lease"* on a case | Task created |
| 11.2 | **Priya**: on the task, **Draft with AI**; then Lisa **Apply** (5.2) but **don't** accept it. **Submit to task** | **Refused**: *"Accept or reject the 1 tracked change(s)…"* |
| 11.3 | Accept the change, add a comment for Rajesh, **Submit** | Submitted |
| 11.4 | **Rajesh** opens the task → **Open draft** | The **Open with** choice; in the PactPro editor he edits directly |
| 11.5 | Rajesh **Approve** while Priya's comment is open | **Refused**: *"Resolve the 1 open comment(s)…"* |
| 11.6 | Resolve it → **Approve** | Approved |

## 12. Versions, compare, re-draft (Priya + Karthik, 10 minutes)

| # | Do | Expect |
|---|---|---|
| 12.1 | Editor **File → Version History** | One entry per Save to PactPro (not per Ctrl+S), with date and who |
| 12.2 | Click an older version | Read-only, with that save's changes **highlighted** |
| 12.3 | **Restore** an older one, close the history | The document is that version; the history keeps every version |
| 12.4 | As **Karthik** (suggestions only) | Can look, **no Restore** |
| 12.5 | **Collaboration → Compare → Document from storage** | PactPro's **Compare with…**: pick `Draft126_Returned_By_Client.docx` or an earlier version; differences appear as **tracked changes** |
| 12.6 | **Compare → File from your computer** | ONLYOFFICE's own picker, same result |
| 12.7 | **More → Re-draft…**, then **Confirm** in the bar | When ready, the editor shows the **new** AI text |

## 13. Finalise (Priya + Karthik, 5 minutes)

| # | Do | Expect |
|---|---|---|
| 13.1 | Leave a tracked change open, **More → Finalise** | Refused, with the count of open changes / comments |
| 13.2 | Accept / reject all, resolve comments, **More → Finalise** | Chip **Final · Priya · date**; read-only for everyone; Save / Apply / placeholders refused |
| 13.3 | **Download** | No watermark |
| 13.5 | **More → Reopen for editing** | Editable again |

---

# Part C. Any document in the editor

## 14. New and existing documents (Priya, 15 minutes)

| # | Do | Expect |
|---|---|---|
| 14.1 | **Documents** → **Add document** → **New Word document**, name *Reply to legal notice*, link a case → **Create and open** | The **Open with** dialog; pick **PactPro editor**: a full-page editor, name, case, **v1** |
| 14.2 | Type, **Save** → *Save to PactPro* | *Saved as a new version*: **v2** |
| 14.3 | **New Excel** / **New PowerPoint** | A spreadsheet / presentation, editable |
| 14.4 | An uploaded **.docx** → ⋯ → **Open in editor** → PactPro editor | Editable; Save makes a new version of that document |
| 14.5 | ⋯ → **Open in editor** on a **PDF** | Read-only |
| 14.6 | **File → Version History** → **Restore** | Restored as a new version |
| 14.7 | **Compare → Document from storage** | An earlier version, or a file received back; differences as tracked changes |
| 14.8 | **Download** after an unsaved edit | Includes the edit; **no** new version |
| 14.9 | A comment with **@** → Karthik | His bell: **Document Comment** *"Priya … mentioned you on …"* |
| 14.10 | A user with view-only document rights opens one | Read-only, no Save |
| 14.11 | A **case** → Documents tab → **Add document → New Word document**; the **pencil** on a Word document | Created on the case / opened, through **Open with** |

## 15. Trimmed editor, Indian scripts, access (Priya + Arjun, 5 minutes)

| # | Do | Expect |
|---|---|---|
| 15.1 | Look for **Plugins**, **AI**, **Macros**, **Chat**, **Help** | None of them |
| 15.2 | Type a line in **Tamil** (*சென்னை உயர் நீதிமன்றம்*) and **Hindi** (*उच्च न्यायालय*), Save, **Download → PDF** | Both correct in the editor and the PDF |
| 15.3 | The font list | *Noto Sans Tamil*, *Noto Sans Malayalam*, *Noto Sans Devanagari*, *Nirmala UI* |
| 15.4 | **Arjun** opens `/dashboard/documents/<id>/edit` of Priya's document | It doesn't open |

---

# Part D. Opening and saving

## 16. Open with: desktop editor or PactPro editor (Priya, 10 minutes)

| # | Do | Expect |
|---|---|---|
| 16.1 | (Clean browser data.) **Documents** → ⋯ on a Word document → **Open in editor** | **Open with**: **Desktop editor**, **PactPro editor**, *Remember my choice* (no other text) |
| 16.2 | **Desktop editor** | With Word and LibreOffice both installed, **Windows asks which app** (pick LibreOffice, *Just once*); the file opens there. Toast: save there as often as you like, then Save to PactPro |
| 16.3 | Close it. Open again → **PactPro editor** | The PactPro editor page |
| 16.4 | Open again, tick **Remember my choice** → Desktop editor | Later opens go straight to the desktop editor, no dialog |
| 16.5 | The same chooser from: a case's document ✏, **Drafting → Drafts → Open**, a task's **Open draft**, a task's attached document | All ask (or follow the remembered choice) |
| 16.6 | On a draft page in the PactPro editor: **Open on desktop** | *"Closing the PactPro editor…"*, then **Open in desktop editor** / **Back to the PactPro editor** |
| 16.7 | On a computer with no desktop editor | After ~3 s *"No desktop editor opened…"* and the PactPro editor opens; next time the button says *didn't open last time* |
| 16.8 | On a phone | Always the PactPro editor |

## 17. Desktop saves are a working copy (Priya, 10 minutes)

| # | Do | Expect |
|---|---|---|
| 17.1 | In LibreOffice (16.2), edit and **Ctrl+S**; edit again, Ctrl+S | **No** new version in PactPro |
| 17.2 | Back in the browser (any page) | Bottom right: **Edits not saved to PactPro**, this file, *Still open in the desktop editor* |
| 17.3 | **Save to PactPro** | The Save dialog (PactPro / copy to this computer); the version goes up by **one** for all those saves |
| 17.4 | Edit + Ctrl+S again, then **Discard** in the box (confirm) | The edits are dropped; the version stays |
| 17.5 | Close LibreOffice after saving there, reopen the file on the desktop | You get your working copy back, not the older version |
| 17.6 | A draft on the desktop (16.6): edit, save there, **Save to PactPro** | The draft page reloads its editor with the change; Lisa / compare read it |

## 18. Locks: one place edits at a time (Priya + Admin, 5 minutes)

| # | Do | Expect |
|---|---|---|
| 18.1 | Priya has a document open in LibreOffice. **Admin** opens it in the PactPro editor | **Read only**: *"Open in a desktop editor by Priya Nair…"* |
| 18.2 | Priya saves there but not to PactPro, closes LibreOffice. Admin reopens | Still read-only: *"Desktop edits by Priya… not saved to PactPro yet"* |
| 18.3 | Priya **Save to PactPro** (or Discard). Admin reopens | Editable again |
| 18.4 | Priya opens it in the PactPro editor; Admin tries the desktop editor | It opens read-only in LibreOffice |
| 18.5 | Priya reopens her own document with unsaved edits in the PactPro editor | Editable, with her edits and **Save** enabled |

## 19. Read-only users (Karthik, 2 minutes)

| # | Do | Expect |
|---|---|---|
| 19.1 | A user with view-only document rights → Open → Desktop editor | Opens read-only; nothing can be saved back |

---

# Part E. The PactPro add-ons

## 20. Save to PactPro inside LibreOffice (Priya, 15 minutes)

Install once per computer: download `http://192.168.1.36:5174/addins/pactpro.oxt`, then double-click
`pactpro.oxt` (LibreOffice: OK / Add) and restart LibreOffice. The current version is **1.2.0** (Tools → Extension
Manager); install over an older one the same way. The Word add-in needs HTTPS hosting, so test it after hosting with the same steps from its side panel.

| # | Do | Expect |
|---|---|---|
| 20.1 | Open a document on the desktop (LibreOffice) | Toolbar: a **PactPro** button and a **Save to PactPro** button. Menu **PactPro**: PactPro window…, Save to PactPro, Discard edits, Submit to task…, Approve task…, Request changes… |
| 20.2 | Click the **PactPro** button | The **PactPro window**: the file name, *Version N in PactPro*, and a **Save** section (Save to PactPro, Discard edits). No task sections on a document that isn't on a task for you |
| 20.3 | Edit, then in the window **Save to PactPro** (no Ctrl+S needed) | *"Saved to PactPro as version N."*; the window closes; the browser's bottom-right box no longer lists it |
| 20.3b | Edit, Ctrl+S, open the window again | The state line says *you have edits not saved to PactPro* |
| 20.3c | **Save to PactPro** (toolbar button) with nothing changed | *"Nothing new to save to PactPro."* |
| 20.4 | Edit, Ctrl+S, **PactPro → Discard edits** → Yes | The file reloads as the PactPro version |
| 20.5 | Any file not opened from PactPro → PactPro menu | *"This file was not opened from PactPro…"* |
| 20.6 | Menu **Submit to task… / Approve task… / Request changes…** on a document not on a task | A short message that it isn't waiting for you (the task items are tested in 23) |
| 20.7 | A user with view-only rights opens it on the desktop → **PactPro** window | *Read only for you*, no Save section: *"Nothing to do here…"* |

---

# Part F. Task documents, start to approval

## 21. One document per task (Rajesh + Priya, 10 minutes)

| # | Do | Expect |
|---|---|---|
| 21.1 | **Rajesh**: assign Priya *"Prepare the plaint"* on a case | — |
| 21.2 | **Priya**: Tasks → the task → **Write in editor** | A Word document **named after the task**, on its case, **attached to the task**; **Open with** → PactPro editor |
| 21.3 | Write, **Save** (to PactPro), close | — |
| 21.4 | Back on the task | The button now reads **Continue document**; clicking it opens the **same** document (no second one) |
| 21.4b | Open the task's document (Continue document, or the task's Attached list) as **Priya** | Editable, with **Submit to task** in the top bar, even though Priya has no general "edit documents" permission |
| 21.5 | A case → Tasks tab: the ✏ icon on that task | The same (*Continue document*) |
| 21.6 | Attach a second Word document to the task; **Continue document** | *"Continue which document?"*: pick one, or **Start a new document for this task** |
| 21.7 | The task's **Attached** list: click a Word document | **Open with** (not a download); a PDF opens in the browser's viewer |
| 21.8 | On a task with no document: **Write in editor** → PactPro editor, **close without typing**; wait ~15 s, reload the task | The empty document is gone: the button reads **Write in editor** again and Documents doesn't list it |
| 21.9 | Same, but choose **Desktop editor**, close LibreOffice **without saving** | Removed the same way |
| 21.10 | **Write in editor**, type a line, close without Save to PactPro | **Kept** (your edits wait as a working copy); Continue document opens them |

## 22. Submit, review, resubmit, approve in PactPro (Rajesh + Priya, 10 minutes)

| # | Do | Expect |
|---|---|---|
| 22.1 | **Priya**, in the editor: edit, then **Submit to task** | Dialog: *What was done?*, hours; it says the document is saved to PactPro first and only this document is handed in. *Save and submit*: a new version, task **Submitted**, Rajesh notified |
| 22.2 | Or from the task: edit on the desktop, Ctrl+S, then **Submit work** | The dialog lists each attached document (ticked) with its version; this one shows *edits not saved to PactPro* and **Save to PactPro** next to it. Save, then submit |
| 22.3 | Attach a client letter, **Submit work**, **untick** the letter | Submitted without it |
| 22.4 | **Rajesh**: **View work** on the task | The round shows **Plaint · submitted vN** (what was handed in); the letter under **Reference**. Clicking either closes View work and shows **Open with**, never a download |
| 22.5 | Rajesh clicks the plaint | **Open with**; in the PactPro editor the top bar has **Approve** and **Request changes** |
| 22.6 | **Request changes** with *"Add the prayer"* | Task back to Priya with the comment |
| 22.7 | **Priya**: **Continue document** (same document), edit, **Resubmit to task** | A new round; version history shows each round |
| 22.8 | Rajesh, **View work** → the earlier round's plaint (edited since) | The label reads *submitted vN · now vM*; clicking it gives **Open with** (the current document); the small download button next to it downloads vN exactly as submitted |
| 22.9 | Rajesh **Approve** | Task done; **only the plaint** is marked Approved, not the letter |

## 23. The same loop in Word / LibreOffice (Rajesh + Priya, 5 minutes)

| # | Do | Expect |
|---|---|---|
| 23.1 | Rajesh assigns a new task; Priya writes its document and opens it on the desktop | — |
| 23.2 | Priya: edit (no Ctrl+S), click the **PactPro** button | The window shows **Save** and **Hand in for review** (no Review section). Fill *What was done?* and hours → **Save and submit to task**: *"Saved to PactPro and submitted … for review."* (saved first). The menu's *Submit to task…* does the same |
| 23.3 | Rajesh opens it on the desktop → **PactPro** button | The window shows **Review** (Approve task / Request changes) and no Hand-in section. **Request changes** with an empty comment: *"Say what needs to change."*; with a comment: sent back |
| 23.4 | Priya resubmits (23.2). Rajesh edits a word, then **PactPro → Approve task…** | Asked: save your edits to PactPro and approve that version? **Yes**: saved then approved; **No**: the handed-in version is approved and his edits stay unsaved |
| 23.5 | Priya tries **Approve task…** on her own task | *"This document isn't waiting for your review."* |
| 23.6 | A document on two submitted tasks | The dialog asks which task |
| 23.7 | A **draft** (Draft with AI on a task) opened on the desktop by its author → **PactPro** window | **Hand in for review**: note, hours → *Save and submit*: the draft is filed on the case as a document and the task is Submitted (as the page's Submit to task) |
| 23.8 | The senior opens that draft on the desktop → **PactPro** window | **Review**: Approve / Request changes |
| 23.9 | Drafts → **Review** on a colleague's review request | **Open with** first, like Open |

---

# Part H. Client review (docs/CLIENT_REVIEW.md)

Needs a client with a **portal login** (client's page → portal login) and a Word document on that client's case.
Log in as the client in a private window at `http://192.168.1.36:5174/client/login`.

| # | Do | Expect |
|---|---|---|
| H.1 | Documents → ⋯ on the Word document → **Send to client for review…**: a message, a question, a reply-by date → **Send for review** | The panel shows *Waiting on the client*, Round 1; the Documents list's *Client* column says **With client**; the client gets an email |
| H.2 | Before sending, add a comment in the firm's editor and leave a tracked change | In the client's copy (H.3) neither is visible: comments removed, changes accepted |
| H.3 | **Client:** portal → **For review** → the document | Your advocate's question and three steps: **1. Download**, **2. Make your changes**, **3. Upload it and send it back** |
| H.4 | Client: **Download**, change the rent in Word (Track Changes on), save; upload it, write a note, **Send back with my changes** | *Sent to your advocate*. **Send back** stays disabled until a file or a note is given. The firm's bell + email: *… sent changes back* |
| H.5 | Firm: the document's **Client review** panel | The thread (note, the uploaded .docx); Round 1 *changes sent back*; **Compare in editor** on the file opens your document with the differences as tracked changes to accept / reject |
| H.6 | Firm: accept, Save, **Send version N for review** with "Rent updated" | Round 2 for the client; round 1 *replaced* |
| H.7 | Client: a photo of handwritten corrections + a note, **Send back** | The firm sees the photo and the note; edits the document by hand |
| H.8 | Client: **Approve this version** | Firm: **Client approved · vN · name · date**; the list shows *Client approved* |
| H.9 | Another client's login | Sees nothing of it; firm pages refuse client logins |
| H.9b | **Priya** (no edit-documents permission): **Client review…** on a document that isn't on her task | *Only colleagues allowed to edit documents, or the person working on this document's open task…*; on her open task's document (Continue document) she can send it |
| H.10 | A reply-by date of today, then `manage.py remind_client_reviews` | The client gets a reminder (not again for 3 days) |

# Part G

## Not built yet (don't test as failures)

- **The Word / Excel / PowerPoint add-in:** built but needs HTTPS hosting (`desktop-addins/build.py --web … --api …`, then upload
  the manifest in the Microsoft 365 admin centre).
- **Redline without LibreOffice:** if the server can't run LibreOffice's compare, the redline falls back to PactPro's
  standard layout and the dialog says so.
- **Things that need the PactPro plugin (planned) or a paid edition:**
  - no-reload placeholder filling;
  - jump to a blank or clause;
  - Lisa following the cursor.
- **Fill from case:** paused.

## Reporting

For anything that differs from **Expect**, send:
- the step number;
- what you saw, with a screenshot;
- the page address.

Nothing in this test touches the test instance or its database.
