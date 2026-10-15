# Demo: the document editors and the client portal (one matter, start to finish)

A single story you can run (or present) in about **60 minutes** on the dev instance. It covers:
- the PactPro editor (ONLYOFFICE);
- desktop editing with the LibreOffice add-on;
- the task loop;
- the draft tools (placeholders, Lisa, compare, redline, finalise);
- the client portal's review loop.

Every step has a full test in `docs/DEMO_ONLYOFFICE.md` (step numbers in brackets).

**The story.** K. M. Anand Joshi has a suit, **O.S. No. 150/2025** (*K M Anand Joshi vs The Malayalee Club*):
1. The senior, Rajesh, asks the junior, Priya, to prepare a **list of dates** for it.
2. Priya writes it, partly in the browser and partly in her own LibreOffice.
3. Rajesh reviews and approves it.
4. Priya sends it to the client for review. The client corrects a date in his own Word and sends it back.
5. Priya takes the correction in, and the client approves.
6. Along the way: a lease drafted with AI, to show the draft tools.

---

## 0. Before the demo (10 minutes)

| Check | How |
|---|---|
| Services up | http://192.168.1.36:5174 opens; http://192.168.1.36:8081/api/health answers; http://192.168.1.36:8085/healthcheck shows `true` |
| The code | The dev app runs from the git clone `C:\Users\Sybrant\ams` (branch **Developer-1**), on the database `pactpro_db1` |
| LibreOffice | Installed, with the PactPro add-on **1.2.0** (Tools → Extension Manager). To install: open `http://192.168.1.36:5174/addins/pactpro.oxt` and double-click the file |
| Browser windows | Three profiles / private windows: **firm (Rajesh)**, **firm (Priya)**, **client (Anand)** |

| Who | Login | Role in the story |
|---|---|---|
| Rajesh Kumar (senior) | rajesh@kumar-associates.demo | Assigns, reviews, approves. **His dev password is not `Demo@1234`: reset it first** (or use admin@kumar-associates.demo, password `Demo@1234`) |
| Priya Nair (junior) | priya@kumar-associates.demo / `Demo@1234` | Does the work, sends to the client |
| K. M. Anand Joshi (client) | anand.joshi@clients.demo, at **http://192.168.1.36:5174/client/login** | Reviews in the portal. Check the password works; reset it if not |

Emails on dev are printed in the backend log, not sent; bell notifications work. Clear the browser's site data
first if you want to show the **Open with** and **Save** questions from scratch.

---

## Act 1. The task: one document, written in the browser and on the desktop (15 minutes)

1. **Rajesh** opens the case O.S. No. 150/2025 → Tasks → **assign Priya** *"Prepare list of dates and synopsis"*.
2. **Priya** → Tasks → the task → **Write in editor**:
   - **Open with** → *PactPro editor*;
   - a Word document named after the task opens, attached to the task;
   - she types a few dates. [21.2]
3. She presses **Ctrl+S**. Next to PactPro's button (which reads **Save to PactPro** while there are edits) a note
   appears: *"Your work is safe; not yet a PactPro version"*. The editor's own save only keeps a working copy. She
   clicks **Save to PactPro**: the **Save** dialog (*Save to PactPro*, *a copy to this computer*, *Remember*) → a new
   version, and the button reads **Saved**. [2.2–2.6, 14.2]
4. She closes it. Back on the task the button now reads **Continue document**, and it reopens the **same** document. [21.4]
5. **Open with → Desktop editor**: Windows asks which program → **LibreOffice**. She adds two dates and presses
   Ctrl+S twice. [16.2, 17.1]
   - Back in the browser, bottom right: **Edits not saved to PactPro** (no new version yet). [17.2]
   - Meanwhile Rajesh opens the document in the PactPro editor: a yellow **Read only** notice, *"Priya has this document
     open in a desktop editor"*. [18.1]
6. In LibreOffice: the **PactPro** button → the PactPro window (only her actions: *Save*, *Hand in for review*).
   **Save to PactPro** → *"Saved to PactPro as version N"*: one version for all her saves. [20.2–20.3]

## Act 2. Review inside the firm (10 minutes)

7. Priya, still in LibreOffice: PactPro window → **Hand in for review**: note *"First draft of the dates"*, 1.5 hours →
   *Save and submit to task*. [23.2] (In the browser the same is **Submit to task** in the editor, or **Submit work**
   on the task, with tick boxes for what goes to the reviewer. [22.1–22.3])
8. **Rajesh**: the bell → the task → **View work**. The round shows *List of dates · submitted vN*. Clicking it opens
   **Open with**, not a download → PactPro editor. [22.4–22.5]
9. In the editor's top bar: **Request changes** → *"Add the date of the plaint"*. [22.6]
10. **Priya**: **Continue document** (same document) → adds the date → **Resubmit to task**. [22.7]
11. **Rajesh**: **Approve** → the task is done; only the handed-in document is marked Approved. [22.9]

## Act 3. The client reviews in the portal (15 minutes)

12. **Priya** (the person working on the task may send its document) → Documents → ⋯ on the list of dates →
    **Send to client for review…**:
    - message *"Please check the dates"*;
    - a question *"Date of the notice?"*;
    - reply-by in 3 days → **Send for review**.

    The Documents list's *Client* column: **With client**. [H.1, H.9b]
13. **Anand** (client window) logs in at `/client/login` → **For review** → the document: the question, then three
    steps:
    1. **Download**;
    2. edit in his own Word (Track Changes on): he corrects a date and saves;
    3. **upload** it, adds a note *"Notice was on 12 March"* → **Send back with my changes**. [H.3–H.4]
14. **Priya**: the bell (*"Anand Joshi sent changes back"*) → the document's **Client review** panel:
    - the thread and his file;
    - **Compare in editor** on his file → his changes appear as tracked changes → she accepts them → **Save**. [H.5]
15. Panel → **Send version N for review**: *"Updated the notice date"* → round 2. [H.6]
16. **Anand**: **No changes: approve this version**. **Priya / Rajesh**: *Client approved · vN · Anand Joshi · date*. [H.8]
17. Show what the client can't do:
    - another client's login sees nothing;
    - the client's copy never had the firm's internal comments (add one before step 12 to show it). [H.2, H.9]

## Act 4. Drafting with AI in the PactPro editor (20 minutes)

18. **Priya** → Drafting → New draft → **Lease (Kumar & Associates letterhead)** → generate. The draft opens in the
    template's own look: letterhead, headings, tables. The top bar fits on one line: Compare, Download, Save, Open on
    desktop, **More**, Request review, Save to case. [1.1–1.5]
19. **Placeholders**: fill a few, **Apply** → filled everywhere at once. [3.3–3.6]
20. **Lisa**:
    - *"Change the rent to Rs. 45,000"* → **Apply** → a **PactPro AI** tracked change; accept it. [5.1–5.3]
    - Then *Make the language more formal* → **Apply all** → one reload, one version. [5.6]
21. **Compare** (top bar): an earlier version → the differences as tracked changes. [12.5]
22. **Download → Redline**: from an earlier version to now → a Word file **in the draft's own look**, with the changes
    as tracked changes for the client to accept in Word. [7.6–7.7]
23. **More → Finalise**: refused while tracked changes are open; accept them → **Final** chip, read-only for
    everyone. **More → Reopen**. [13.1–13.5]

---

## Where everything is

| What | Where |
|---|---|
| Code (backend, frontend, add-ons) | The git clone `C:\Users\Sybrant\ams`, branch **Developer-1**: staged, **not committed yet** |
| This demo | `docs/DEMO_EDITORS_CLIENT_PORTAL.md` |
| Full step-by-step tests | `docs/DEMO_ONLYOFFICE.md` (Parts A–H) |
| Design notes | `docs/ONLYOFFICE_PLAN.md` (the editor), `docs/DESKTOP_EDITING.md` (Open with, save rule, add-ons, task documents), `docs/CLIENT_REVIEW.md` (client portal review) |
| Repo guidance | `CLAUDE.md` |
| LibreOffice add-on | source `desktop-addins/`, built file `Advocate-app-FE-main/public/addins/pactpro.oxt` |
| Dev database | `pactpro_db1` (PostgreSQL); a backup from before the merge exists (`pactpro_db1_before_merge.dump`) |
| Documents' files | `C:\Users\Sybrant\Downloads\ams-main\ams-main\Advocate-app-BE-main\uploads` (the dev app's documents folder) |
| Draft Word files, client copies | `C:\Users\Sybrant\Desktop\pact-pro-draft\backend\media` |
