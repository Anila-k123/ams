# Desktop editing: open documents in Word / LibreOffice, or the PactPro editor

Status: **phase 1 built** (14 Oct 2026; Microsoft Office over http still to be tried on a hosted HTTPS server). Lets a user edit any PactPro document (a draft, a task's document, a case or
firm document) in the editor installed on their computer, with the PactPro editor (ONLYOFFICE,
docs/ONLYOFFICE_PLAN.md) as the fallback, and choose where a save goes.

## Decisions (13–14 Oct 2026)

| Question | Decision |
|---|---|
| How desktop editors open documents | **Option A: Office links + WebDAV.** No install on user PCs. A helper app (exact detection, any editor) may come later. |
| HTTPS | Comes when PactPro is hosted. Until then, test on the LAN: LibreOffice edits over http, while Microsoft Office may open read-only or refuse http WebDAV. |
| Default | **Open in the editor available on the user's system.** If several are known, the user **chooses** (desktop editors + the PactPro editor). If none opens, the **PactPro editor**. Phones / tablets: always the PactPro editor. |
| Save choice | **Asked every time**: *Save to PactPro* and / or *Save a copy to this computer*, with **Remember my choice** (then no question; changeable in the dialog's settings). |

**Only Save to PactPro makes a version** (decided 14 Oct 2026). Every other save, in any editor, goes to the
user's **working copy** (`documents.DesktopWork`, one per document / draft):
- Word / LibreOffice saves (WebDAV `PUT`);
- the PactPro editor's own Save icon, Ctrl+S and its autosave timer (callback status 6 without PactPro's
  `userdata: 'pactpro'`);
- closing the PactPro editor with unsaved edits (status 2), after which the next open gets a new key and loads
  the working copy (`&work=1` on the file link), editable for its owner;
- Download / *copy to this computer* (`force_save(userdata='work')`, `current_docx` returns the working copy).

PactPro's **Save** (the page button, or **Save to PactPro** in the bottom-right box for anything not open in the
PactPro editor) makes one version: what is open now (`force_save`, tagged `pactpro`), else the working copy.
PactPro actions that change or judge the file (Apply placeholders / Lisa, Restore, Finalise, Submit / Approve
checks) still force-save as a version first, as before. A version made from the editor drops the working copy.
While someone else's working copy or desktop lock exists, the PactPro editor is read-only.

## Tasks: one document, saved, then submitted

A task keeps its document, from first writing to approval:
- **Write in editor / Continue document** (`components/TaskDocument.tsx`, Tasks page and case task list): a task with no
  editable document gets a new Word document attached (`createTaskDocument`); with one, the button reads **Continue
  document** and opens that one (Open with: PactPro editor or desktop); with several, the user picks one or starts a
  new one. Going back to a task (also after *Request changes*) picks up the same document, so each round is a new
  version of it.
- **Task documents** in the task API (`workspace/serializers.py` `get_documents`): `version`, `editable` (opens in the
  editor), `pendingWork` (this user's edits not saved to PactPro). The task views pass the request to the
  serializer for that.
- **The assignee may edit the task's documents** (`documents.editor._task_worker` in `can_edit`): while a delegated
  task is open, the person it is assigned to edits its attached documents (PactPro editor and desktop) even without
  the general DOCUMENT_EDIT permission, so a junior's Write in editor / Continue document is never read-only.
- **Submit to task** in the document editor (`DocumentEditorPage.tsx`): shown to the assignee of a delegated task the
  document is attached to (`documents.editor._tasks_of`, `tasks` in the editor response). It saves to PactPro (open
  edits, else the working copy) and then submits the task (`POST /api/workspace/tasks/<id>/submit`, note + hours):
  the reviewer gets exactly that version.
- **Submit work** on the task (`components/TaskReview.tsx` `SubmitWork`) lists what goes to the reviewer (each
  attached document and its version); one with unsaved edits is flagged with **Save to PactPro** next to it
  (`POST /api/desktop-work/doc/<id>`), since unsaved edits are not submitted.
- **What is handed in is chosen per submission.** The Submit work dialog ticks every attached document; unticked ones
  stay on the task as **reference** (not reviewed, not approved). Submit to task in the editor hands in only that
  document; a draft's Submit to task only its filed document. Each submission records them with their versions
  (`TaskSubmission.documents` `[{id, version, name}]`, `POST …/submit` `documentIds`; default all attached), so the
  round history shows "Plaint · v3" and opens that exact version (an older one downloads via
  `documents/<id>/versions/<v>/download`). The reviewer's dialog lists the rest as *Reference*.
- **Opening a task's documents** (the task's Attached list, a submission in the history, the reviewer's dialog:
  `useTaskDocument().openAttached`): Word / Excel / PowerPoint files go through **Open with** (PactPro editor or
  desktop), not a download; PDFs and images open in the browser's viewer. In **View work**, a submitted document
  always opens this way; if it has changed since, the label says *submitted v2 · now v3* and a separate download
  button gives the exact submitted version (the editor's Version History shows it too).
- **The reviewer decides in the editor:** while the task is submitted, the document editor shows the reviewer
  **Approve / Request changes** (`ReviewActions`, from `tasks[].canReview` = `workspace.review.can_review`). Reviewing
  in Word / LibreOffice works too (below).
- **Approve marks only the latest submission's documents** Approved (older submissions without a record: all
  attached, as before). Request changes is unchanged.

## Save to PactPro inside Word / LibreOffice

Free add-ons put **Save to PactPro** (and **Discard edits**) in the desktop program itself. Source in
`desktop-addins/`; `python desktop-addins/build.py` builds them into `Advocate-app-FE-main/public/addins/`, so
PactPro serves them.

- **Backend:** `<file's folder>/.pactpro/status` (GET), `/.pactpro/save`, `/.pactpro/discard` (POST) under the same
  signed WebDAV token (`documents/dav.py` `_addin`, `finish_work`). No PactPro login: the token that opened the file is
  the key. Same rules as the browser box (own working copy only, edit right, 409 while open in the PactPro editor).
- **LibreOffice** (`desktop-addins/libreoffice/`, `pactpro.oxt`): a **PactPro** menu (Save to PactPro, Discard edits)
  and a toolbar button in Writer / Calc / Impress; a Python macro saves the file (working copy), then calls
  `.pactpro/save`. Works over plain http (LAN) today. Install once per PC: download it from PactPro's address
  `/addins/pactpro.oxt` (no link in the app yet) and double-click, or `unopkg add pactpro.oxt`. Keep the file name `pactpro.oxt`
  (the script URLs in `Addons.xcu` name it).
- **Word / Excel / PowerPoint** (`desktop-addins/word/manifest.template.xml`, task pane
  `public/addins/word/taskpane.html|js`): a **Save to PactPro** button on the Home tab opens a pane with Save to PactPro /
  Discard edits. It saves the file first (Word; Excel 2021+ / 365; PowerPoint: press Ctrl+S first). **Needs HTTPS**
  (Office loads add-ins only from https), so it is built when PactPro is hosted:
  `build.py --web https://<frontend> --api https://<backend>` writes `public/addins/word/manifest.xml`; deploy it in
  the **Microsoft 365 admin centre → Integrated apps → Upload custom apps** (or a shared-folder Trusted Add-in
  Catalog). The backend's `CORS_ORIGINS` must include the frontend address (it already does for the app).
- **The task loop in the add-ons** (documents only; a draft hands in from its draft page):
  - `GET .pactpro/status` also returns `tasks` (`documents.editor._tasks_of`: `canSubmit`, `canReview`).
  - `POST .pactpro/submit {taskId, note, hours}`: the assignee hands **this** document in; edits not saved to
    PactPro are saved first. `POST .pactpro/review {taskId, action: approve | request_changes, note}`: the reviewer.
    Both run the same code as the PactPro pages (`workspace.views.submit_task` / `review_task`: same permissions,
    comment required to send back, approve blockers).
  - Approving with edits made while reviewing returns 409 `unsaved`: the add-on asks *save my edits, then approve*
    or *approve the version handed in* (`unsaved_ok`).
  - LibreOffice: the **PactPro** toolbar button opens one **PactPro window** (`pactpro_window`) that shows only what
    applies to this person and file: the name and state (version, read only, unsaved edits), **Save to PactPro /
    Discard edits** (may edit), **Hand in for review** with note / hours (the assignee), **Review** with a comment,
    Approve / Request changes (the reviewer). A quick **Save to PactPro** button sits beside it; the **PactPro**
    menu has the same actions one by one (*PactPro window…, Save to PactPro, Discard edits, Submit to task…,
    Approve task…, Request changes…*). `.pactpro/status` returns the version for the window. Word: the side panel's **Hand in** and **Review** sections, shown
    only to whoever may use them.
- Both are free (no store, no fee). The bottom-right browser box stays as the fallback for anyone without them.

## The browser can't see installed programs

A web page can't list installed programs or run an `.exe`. So:
- **Launching:** the page opens an Office / LibreOffice link (`ms-word:ofe|u|<url>`,
  `vnd.libreoffice.command:ofe|u|<url>`). If the program exists, Windows starts it. If the page loses focus within a
  few seconds, it worked; if not, the program isn't there and the page opens the **PactPro editor**.
- **Two steps:** PactPro asks only *Desktop editor* or *PactPro editor*. For the desktop editor it opens the file's
  Office link (`ms-word:` / `ms-excel:` / `ms-powerpoint:`, else LibreOffice's); when several programs are
  registered for it (Word and LibreOffice both are), **Windows shows its own app picker** (*Just once* /
  *Always*). So PactPro never lists programs it can't see.
- **Knowing what's there:** each computer (browser storage) remembers whether a desktop editor opened last
  time; if not, the button says *"didn't open last time"*.

## How it works

```
"Open" (document / task document / case document / draft)
   └─ Open with: Desktop editor | PactPro editor (or the remembered choice)
        │      Desktop editor → Windows' app picker when several programs can open it (Word, LibreOffice)
        ├─ Desktop: ms-word:ofe|u|https://<pactpro>/dav/<signed token>/<file>.docx
        │      Word opens the file FROM PactPro (WebDAV); Word's Save = PUT = overwrite a working copy.
        │      "Save to PactPro" (bar, bottom right of every page) = ONE new PactPro version.
        │      Not launched within ~3 s → the PactPro editor opens instead.
        └─ PactPro editor (ONLYOFFICE): Save → save-choice dialog (PactPro / this computer, remember)
```

### WebDAV (backend, `documents/dav.py`)
- `/dav/<token>/<file name>`: `OPTIONS`, `HEAD`, `GET`, `PROPFIND` (the file), `LOCK`, `UNLOCK`, `PUT`.
- The **token** is signed and expiring (8 h), with no AMS login (desktop programs can't use it). It holds
  `{kind: doc | draft, id, user, edit}`.
- **Read-only** (view-only users, a finalised draft) → no `PUT`; Word opens read-only.
- **PUT** only overwrites a **working copy** (`documents.DesktopWork`, table `desktop_work`, one per document /
  draft). Users save in Word / LibreOffice as often as they like (and those programs send several PUTs per save)
  without touching the version history. Word reopening the file gets the working copy back (`GET`).
- **Save to PactPro** (`POST /api/desktop-work/<kind>/<id>` `{action: save}`) turns the working copy into one
  version through the same save path as the PactPro editor, then drops it:
  - a document → a new document version (`documents.editor._store`);
  - a draft → `drafting.onlyoffice.store_version` (clause markers / fields kept, text copied back for Lisa / review).
- `{action: discard}` drops it; `GET` downloads it (the *copy to this computer* of the save choice);
  `GET /api/desktop-work` lists the user's own. Only the user who made a working copy sees or saves it.
- While a working copy waits, the PactPro editor is **read-only** for everyone ("Desktop edits by Priya not saved
  to PactPro yet") and another user's desktop `LOCK` / `PUT` is refused, so nothing overwrites anything.
- **Lock:**
  - Office's `LOCK` is held for the document (table `desktop_lock`, model `documents.DesktopLock`, 30 min, refreshed by Office).
  - While a desktop lock is held, the PactPro editor opens **read-only** with *"Open in Microsoft Word by Priya"*.
  - A PactPro-editor session open (`editing`) makes a desktop `LOCK` fail, so Word opens read-only.
- **Links:** `GET /api/desktop-links?kind=doc|draft&id=` returns the WebDAV URL and the Word / Excel / PowerPoint /
  LibreOffice links (`ofe` edit or `ofv` view).

### Frontend
- `utils/openWith.ts`: device preferences (try/catch browser storage), desktop launch with the focus-loss
  check, fallback.
- `components/OpenWithDialog.tsx`: the chooser (*Remember my choice*).
- `components/SaveChoiceDialog.tsx`: the save choice (*Remember my choice*), used by the PactPro editor's Save on
  drafts and documents, and by Save to PactPro below.
- `components/DesktopEditsBar.tsx` (in `App.tsx`, every page): **Desktop edits not saved to PactPro**, bottom right,
  one row per working copy (*Still open* / *Closed in the desktop editor*) with **Save to PactPro** (asks the save
  choice: PactPro and / or a copy to this computer) and **Discard**. Refreshed when the page gets focus back
  (returning from Word) and every 20 s. A saved draft / document page reloads its editor (`DESKTOP_SAVED_EVENT`).
- Entry points:
  - Documents page (⋯ → **Open**);
  - a case's documents (✏);
  - a task's **Write in editor**;
  - the draft page's **Open on desktop** button.
- **Opening a draft:** the **Open** buttons (Drafts list Open / row click, a task's or case task's **Open draft**)
  show the chooser right there, like documents. Choosing the PactPro editor (or a desktop editor that didn't
  start) goes to the draft page with `?editor=1` (`DRAFTING.draftEditor`), which starts the PactPro editor at once.
- **Arriving at the draft page any other way** (right after a draft is generated, Review, a link): the PactPro
  editor opens directly; **Open on desktop** in the toolbar moves it to Word / LibreOffice. (Review through the
  chooser: later.)
- **Draft page, later:** the page itself has the draft open in the PactPro editor, and a desktop `LOCK` fails while
  that session is open. So *Open on desktop* saves, closes the PactPro editor, waits until its session has ended
  (`onlyoffice/state/` → `editing: false`, up to ~30 s), then shows **Open in desktop editor** (a click, so
  the browser lets the page start the program) and **Back to the PactPro editor** (reloads it; read-only while
  the desktop program still holds the lock).
- **Save choice** (`useSaveChoice`): PactPro's Save on the draft page and the document editor asks *Save to
  PactPro* / *Save a copy to this computer* / *Remember my choice*; **Save options** next to Save always asks
  (to change a remembered choice). A copy alone takes what is on screen through the working copy, without a
  version (`POST …/save` `{to: 'work'}`).
- **Device memory** (browser storage, keys `pactpro.openWith`, `pactpro.saveChoice`): the remembered opener,
  which desktop editors launched here, the remembered save choice. Clearing site data resets them.
- **Choosing:** the remembered choice (Desktop editor / PactPro editor) is used without asking; otherwise the
  two-choice dialog. Choices remembered by earlier builds (Word / LibreOffice) count as *Desktop editor*.

## Phases
1. **This build:**
   - WebDAV + links;
   - the chooser with fallback;
   - the save-choice dialog;
   - locks between desktop and PactPro editor;
   - read-only rules;
   - tests and docs.
2. **With hosting:** HTTPS so Microsoft Office edits (not only views) over WebDAV; test Word, Excel and PowerPoint.
3. **Later, optional:** the PactPro Desktop helper app (exact detection, any editor, Mac).

## Limits
- **Not detectable** before trying: the first attempt on a computer may take ~3 s before falling back.
- **Panels only in PactPro:** the drafting panels (placeholders, Lisa Apply, review buttons) are in PactPro; in Word
  the user edits. Saves keep everything in step.
- **Microsoft Office over plain http:** may be read-only or blocked until HTTPS. LibreOffice works over http.
- **Just closed in the PactPro editor:** for a few seconds after leaving the document editor page its session is
  still open, so Word opening it right then gets it read-only. Reopen after a moment.
- **`AMS_PUBLIC_URL`** must be the address users' computers reach PactPro on (the WebDAV links use it; else
  the request's own host).
- **Windows' app picker cancelled:** the page already lost focus to the picker, so PactPro takes it as opened and
  doesn't fall back; open again and choose the PactPro editor.

## Review requests, drafts in the add-ons, blank documents (15 Oct 2026)

- **Review** (Drafts page, a colleague's review request) goes through **Open with** like Open. A reviewer who may only
  suggest gets the draft read-only on the desktop (suggestions need the PactPro editor's review mode); one who may
  correct edits it there.
- **Drafts in the add-ons:** a draft drafted for a task now shows that task in the LibreOffice window / Word panel
  (`dav._draft_tasks`). The draft's author hands it in (`.pactpro/submit`): edits saved to PactPro first, then
  `drafting.filing.file_draft`, the same as the page's **Submit to task** (filed on the case as a document version,
  then submitted with the note and hours). The task's reviewer approves / requests changes there too.
- **Blank documents are removed** (`documents/blank.py`): New Word / Excel / PowerPoint and a task's Write in editor
  create the document at once (`DocumentEditState.blank`). While it has never been saved (version 1, no working copy,
  not open anywhere, not handed in on a task), closing it removes it with its task link:
  - the PactPro editor closed unchanged (callback status 4);
  - the desktop program closed without saving (WebDAV `UNLOCK`).

  The scheduler runs `manage.py remove_blank_documents` with each reminder scan to catch any left for over a day.
  Uploaded documents are never touched. Removal uses the same code as Delete (`documents.views.remove_document`).
