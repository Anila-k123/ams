# ONLYOFFICE editor: integration plan

Status: **phase 0 done, phases 1–3 built** (on the dev instance only, `DRAFT_EDITOR=onlyoffice`; test instance
still TipTap). Replaces the TipTap draft editor with **ONLYOFFICE Docs**, so a draft is
edited as the `.docx` itself and keeps every Word feature of its template (shapes, tab stops, text boxes,
sections, headers, numbering, bold words). Supersedes the earlier Collabora plan.

**Why:** TipTap edits HTML translated from Word (`drafting/wordform.py`). Every new kind of template found a
Word feature the translation loses (stamp boxes, `))` tab columns, bold words). HTML editors (CKEditor 5,
TinyMCE) have the same limit. A document server edits the Word file natively.

**Why ONLYOFFICE over Collabora:**
- the editor looks and works like modern Word;
- a documented JavaScript and server API that is easy to wire into Django;
- built-in editor modes that match our review roles (**review-only**, **comment-only**, **view-only**);
- a native **Windows installer** (Collabora needs Linux / WSL);
- a built-in **conversion service** (`.docx` → PDF) that can replace LibreOffice.

---

## 1. Target architecture

```
Browser: AMS draft page
 ├─ side panels (AMS React): Lisa, Placeholders, Reference documents, Case file, Review / task actions
 └─ ONLYOFFICE editor (api.js, iframe)  ── config signed with JWT ──  issued by AMS
                │ co-editing session
ONLYOFFICE Docs server ── GET file url (signed) ──►  AMS Django: serves the draft .docx
                       ── POST callback (signed) ─►  AMS Django: downloads the saved file, stores a version
AMS Django ── Command service (force save, info) / Conversion service (PDF) ──► ONLYOFFICE Docs
```

- **The `.docx` is the draft.** One current file per draft session; every save is a version.
- **ONLYOFFICE** loads the file from a signed AMS URL and, when the document is saved, calls AMS's callback
  with a link to the new file.
- **AMS keeps** AI drafting, firm / practice scope, permissions, tasks, who decides, Lisa, placeholders panel,
  versions, finalise / lock, case filing.
- **AI never edits inside the editor.** Agents work on the stored `.docx` on the server and write their
  proposals as **tracked changes**. The lawyer accepts or rejects them in the editor.

## 2. Editions and licence

| Stage | Edition | Notes |
|---|---|---|
| Development, internal testing | **Community Edition** (free, AGPL) | Limit on simultaneous connections (historically 20) |
| PactPro sold as SaaS / to firms | **Developer Edition** | Licensed for integration into our own product. Allows white-label (PactPro branding), and is priced by simultaneous connections or servers. |
| Optional | Automation API / plugins | Live in-editor actions (e.g. "rewrite the selected clause" without a reload). Check which edition includes them; not needed for this plan. |

**Action:** get a Developer Edition quote (for example 50 and 200 simultaneous editors), for hosted SaaS and
for on-premise installs, before the first paying firm. Verify current terms; they change.

## 3. SaaS design (multi-firm)

| Concern | Design |
|---|---|
| Firm isolation | ONLYOFFICE knows nothing about firms. AMS checks practice scope (`core.practice.practice_ids`) and draft access **before** signing an editor config, and checks again in the file and callback views. |
| Document keys | `f<firm>-d<draft>-v<version>`: unique per firm and draft, and **changes with every version** (a reused key shows a cached old copy). |
| Security | Every exchange is signed with JWT (shared secret `ONLYOFFICE_JWT_SECRET`, HS256): editor config, file download, callback, command and conversion calls. The file URL carries a short-lived signed token. The document server's admin pages are not public. |
| Storage | Files live only in AMS (media storage + DB rows). The document server holds no permanent data, so backups stay AMS backups. |
| Capacity | The licence counts **simultaneous open editors**. Size from peak active users; log the open-editor count; alert near the limit. |
| Performance | Memory-heavy under concurrent use: a dedicated server (or several behind a load balancer), not shared with the AMS backend or database. |
| Fonts | Install the fonts firms use on every document server: Times New Roman, Arial, Calibri, Cambria, Bookman, Britannic, etc., plus **Tamil, Malayalam, Telugu, Kannada and Devanagari** fonts. Missing fonts reflow layouts and bring the fidelity problem back. Same fonts on the LibreOffice/PDF server while it exists. |
| Data location | Self-hosted (India region for SaaS): client documents never leave our infrastructure. Relevant for the DPDP Act and firm confidentiality. |
| Two ways to sell | **Hosted SaaS:** one central document server (cluster) for all firms, one Developer licence. **On-premise:** each firm's server runs its own ONLYOFFICE; check per-installation licensing. |

## 4. Server setup (Phase 0)

- **Dev / test PC (Windows):** ONLYOFFICE Docs Community for Windows (native installer). It needs PostgreSQL
  (reuse the existing server with its own database `onlyoffice`), RabbitMQ and Erlang. The installer lists
  them; follow ONLYOFFICE's Windows guide. Run it on its own port, e.g. **8085**, so it doesn't clash with AMS
  (8080/8081), the frontend (5173/5174) or the scraper (8000).
- **Linux / production:** Docker `onlyoffice/documentserver` (Community) or the Developer image:
  ```bash
  docker run -d --name onlyoffice -p 8085:80 --restart always \
    -e JWT_ENABLED=true -e JWT_SECRET=<secret> \
    -v /opt/onlyoffice/fonts:/usr/share/fonts/truetype/custom \
    onlyoffice/documentserver
  ```
  Fonts are added by copying into the fonts folder and running the server's font-generation script.
- **New `.env` settings** (python-decouple, also in `.env.example`):
  | Setting | Meaning |
  |---|---|
  | `ONLYOFFICE_URL` | Document server as the **browser** reaches it, e.g. `http://192.168.1.36:8085` |
  | `ONLYOFFICE_INTERNAL_URL` | Document server as the **backend** reaches it (often the same) |
  | `ONLYOFFICE_JWT_SECRET` | Shared JWT secret (same value as the server's) |
  | `AMS_INTERNAL_URL` | AMS backend as the **document server** reaches it, e.g. `http://192.168.1.36:8081` |
  | `DRAFT_EDITOR` | `onlyoffice` or `tiptap`: the rollout switch, removed at the end |
- **JWT secret length:** the installer generates a 30-character secret; PyJWT warns below 32 bytes for HS256.
  For production, set a longer random secret (64+ characters) in the server's `local.json` (inbox, outbox,
  session) and in `.env` together.
- **`manage.py check_onlyoffice`** (done, `drafting/management/commands/check_onlyoffice.py`):
  - the server answers (`/healthcheck`);
  - JWT works (a signed Command service `version` call);
  - the server can reach `AMS_INTERNAL_URL`;
  - a `.docx` → PDF conversion succeeds.

  Like `check_pdf_export`.
- **Windows install steps (dev PC):**
  1. Erlang (OTP 64-bit), then RabbitMQ, both with default settings.
  2. PostgreSQL database: `CREATE USER onlyoffice WITH PASSWORD '…'; CREATE DATABASE onlyoffice OWNER onlyoffice;`
  3. ONLYOFFICE Docs Community for Windows (onlyoffice.com → Docs → Community → Windows) as Administrator. Enter
     the PostgreSQL database / user, RabbitMQ (`guest`, `localhost`), and a JWT secret.
  4. Port 80 → 8085 in `C:\Program Files\ONLYOFFICE\DocumentServer\nginx\conf\ds.conf`. **Also move the internal
     document service off 8000**, the court scraper's port: in `config\local.json` set
     `services.CoAuthoring.server.port` to `8010`, and in `nginx\conf\includes\http-common.conf` change
     `localhost:8000` to `localhost:8010`. Restart `DsDocServiceSvc`, `DsConverterSvc` and `DsProxySvc`. If both
     use 8000, `/healthcheck` answers 404, because nginx reaches the scraper.
  5. JWT is on by default (installer 9.x); the generated secret is `services.CoAuthoring.secret.inbox.string`
     in `config\local.json`. Copy it to the backend `.env` as `ONLYOFFICE_JWT_SECRET`.
  6. Fonts:
     - ONLYOFFICE already ships Lohit / Samyak / Noto fonts for every Indian script, and reads the Windows fonts
       (Times New Roman, Arial, Calibri, Cambria, Bookman, Britannic, Nirmala UI).
     - Add the **Noto Sans / Serif Indic** fonts (Tamil, Malayalam, Telugu, Kannada, Devanagari, Gujarati,
       Bengali, Gurmukhi, Oriya) to `core-fonts\custom`.
     - Add **Windows' Indian supplemental fonts** (Latha, Mangal, Kartika, Gautami, Tunga, Shruti, Vrinda, Raavi:
       the Windows features `Language.Fonts.Taml/Deva/Mlym/Telu/Knda/Gujr/Beng/Guru/Orya`), since many Word
       documents typed in India use them.
     - Then run `bin\documentserver-generate-allfonts.bat` as Administrator.
     - A firm's own fonts go in `C:\Windows\Fonts` or `core-fonts\custom`, followed by the same script.
  7. Firewall: inbound TCP 8085 (document server) and 8081 (AMS dev backend).
  8. Check: `http://localhost:8085/healthcheck` returns `true`.
- Docs: a `DEPLOYMENT.md` section (Windows + Linux, fonts, firewall ports 8085 / 8081), `CLAUDE.md` notes.

## 5. Backend (Phase 1: open, edit, save)

New module `drafting/onlyoffice/` (config, views, jwt, services).

**Data**
- `DraftFile` (managed):
  - `session` (1:1);
  - `file` (`media/drafts/<session>/draft.docx`);
  - `version` (int);
  - `doc_key`;
  - `editing` (bool, set from callback status 1, cleared on 2 / 4);
  - `updated_at`, `updated_by`.
- Each saved file is also stored as a draft version (the existing versions table already holds Word files,
  `0012_word_version`), so Versions / Restore keep working.

**Making the file**
- New drafts: after AI generation, `render_draft_docx(session)` (today's Download output, written into the
  template's own `.docx`) becomes the `DraftFile`. Each AI clause is wrapped in a **content control** tagged
  with its block id (`pactpro:block:<id>`), so per-clause features keep working.
- Drafts without a Word source: the house-style document (`export/docx.py`).
- Existing drafts: made the same way the first time they're opened.

**Endpoints**
| Endpoint | Who calls it | Does |
|---|---|---|
| `GET /api/drafting/sessions/<id>/editor` | AMS frontend | Permission checks, then returns the **signed editor config** (see below) |
| `GET /api/drafting/onlyoffice/file/<id>?t=<signed>` | Document server | Streams the current `.docx` (token checked: session, version, expiry) |
| `POST /api/drafting/onlyoffice/callback/<id>?t=<signed>` | Document server | JWT-verified callback; by `status`: 1 editing → mark `editing`; **2 ready to save** or **6 force save** → download `url`, store as the new version, bump `version` and `doc_key`, refresh the text copy, audit log; 3 / 7 errors → log + alert; 4 closed without changes → clear `editing`. Always answers `{"error": 0}` once handled. |

**Editor config** (signed with the JWT secret):
- `document`:
  - `fileType: "docx"`, `key: doc_key`, `title`, `url` (signed file URL);
  - `permissions`: `edit`, `review`, `comment`, `download`, `print`, `fillForms`, chosen per user (see 7).
- `editorConfig`:
  - `mode`: `edit` or `view`;
  - `callbackUrl` (signed);
  - `user: {id, name}`, `lang`;
  - `customization`: `forcesave: true`, PactPro branding with the Developer edition, autosave on.
- `token`: the JWT of the whole config.

**Command and conversion services (server to server, JWT)**
- `forcesave` before Download / Save to case / Submit to task / AI actions, so AMS has the latest edits.
- `info` to see who has the document open.
- Conversion `docx → pdf` for Download PDF and View. This replaces LibreOffice once tested: compare output on
  the Vakalatnama, Lease and a PDF-converted sample.

**Text copy**
After each save, extract the paragraphs (python-docx / lxml) into the session's plain text, and per content
control into each block's text. Search, Lisa context, task summaries and the on-screen compare read this.

## 6. Frontend (Phase 1)

- `src/pages/Drafting/OnlyOfficeEditor.tsx`:
  - loads `${ONLYOFFICE_URL}/web-apps/apps/api/documents/api.js` (or uses `@onlyoffice/document-editor-react`);
  - creates `new DocsAPI.DocEditor(id, config)` with the signed config from AMS;
  - handles `onDocumentReady`, `onDocumentStateChange` (the unsaved badge), `onRequestSaveAs` (off) and
    `onError`.
- `DraftPage.tsx`: when `DRAFT_EDITOR=onlyoffice`, the middle pane is `OnlyOfficeEditor` instead of
  `EditorToolbar` and `EditorContent`. The side panels stay. After AMS changes the file (placeholders, AI,
  restore), the editor is re-created with the new key.
- CSP / `frame-src` and `script-src` allow `ONLYOFFICE_URL`.

## 7. Roles and editor modes

| Who | ONLYOFFICE permissions | Result |
|---|---|---|
| Author / person with authority (`drafting/authority.py`) | `edit: true`, `review: true` | Edits directly; accepts / rejects tracked changes |
| Reviewer without authority | `edit: false`, `review: true` | **Review-only**: every edit is a tracked change |
| Comment-only reviewer | `edit: false`, `comment: true` | Comments only |
| Anyone else with view access, or a **finalised** draft | `mode: view` | Read-only |

## 8. AI: proposals as tracked changes

1. **No collision:** if the draft is open (`editing`), AMS first forces a save. The AI change then applies to the
   stored file, and the key changes so open editors reload. Simple rule for phase 1: AI actions wait until
   nobody else is editing, or the user confirms the reload.
2. Agents edit the stored `.docx` on the server (lxml on the Word XML), inside the clause's content control. They
   write `w:del` for removed text and `w:ins` for new text, author **"PactPro AI"**, with the date.
   On the draft page, Lisa's **Accept** only collects a change; **Update in document** (a bar above Lisa's
   message box, like the Placeholders panel's Apply) sends every accepted change at once: one version, one
   reload. `docfile.apply_tracked` looks only inside the clause's own marker (`blockId`), places the change
   line by line (a clause is several paragraphs), and reads `[[Label]]` blanks as the file shows them.
3. The editor reloads in review mode; the lawyer accepts or rejects with the standard Word controls.
4. Applies to:
   - Lisa's "rewrite clause";
   - playbook / risk suggestions;
   - "fill from case facts";
   - later, any agent.
5. First draft generation is not a tracked change. It is the starting document. Placeholders filled from the
   panel are written directly; they can be tracked if the firm wants.

## 9. Feature migration

| Feature today (TipTap) | With ONLYOFFICE | Phase |
|---|---|---|
| AI draft per clause | Unchanged backend; written into the template `.docx`, clauses as content controls | 1 |
| Download Word / Save to case / Submit to task | Force save, then the current file | 1 |
| Download PDF, View | Conversion service (LibreOffice until compared) | 1 |
| Versions / Restore | Each save = version; Restore copies it back as current (new key) | 1 |
| Letterhead option | Applied when the file is made, for drafts without their own letterhead | 1 |
| Reference documents, Case file panels | Unchanged side panels | 1 |
| Placeholders `[[Label]]` and heading blanks | Backend scans the file; the panel fills them in the file; editor reloads | 2 |
| Lisa: questions about the draft | Reads the text copy | 2 |
| Lisa: rewrite a clause, playbook suggestions | Tracked changes by "PactPro AI" (section 8) | 3 |
| Suggestions, accept / reject, who decides | Review-only mode + Word tracked changes; the person with authority accepts / rejects | 3 |
| Review rounds, review notifications, Approve blockers | Stay in AMS: a round = a version + its tracked changes; Approve is blocked while tracked changes or comments are open (read from the file) | 3 |
| Comment threads | ONLYOFFICE comments (in the `.docx`); AMS notifies on new comments found at save | 3 |
| Request review (task-less drafts) | Unchanged flow; the reviewer opens in review-only mode | 3 |
| Compare / redline | Server compare of two versions → a `.docx` with tracked changes (ONLYOFFICE / LibreOffice compare); redline PDF via conversion | 4 |
| Import changes (file returned by client / counsel) | Same compare: current file vs returned file → tracked changes to accept / reject | 4 |
| Finalise / lock | Final version + checksum; editor opens in view mode; Reopen by authority makes a new working version | 4 |
| Existing drafts | Converted on first open | 5 |
| Case documents workspace (open / edit any case `.docx`) | Same editor and callback for `documents` versions | 6 (optional, after drafts) |

Retired at the end:
- the TipTap editor and its extensions (`editor/`);
- `wordform.styled_lines_html`;
- the editor-only parts of `export/htmlwrite.py` and `html_to_blocks`;
- the Word-band rendering.

`render_into_original` stays to make the first file.

## 10. Rollout phases

| Phase | Scope | Done when |
|---|---|---|
| 0 ✅ | ONLYOFFICE Community on the dev PC (Windows) with fonts and JWT; settings; `check_onlyoffice`; docs | Check passes; a sample `.docx` opens in a test page |
| 1 🔧 built, testing | DraftFile, signed config, file + callback views, editor in the draft page (`DRAFT_EDITOR` switch), versions, Download / Save to case / PDF | Vakalatnama (stamp boxes, `))`), Lease (letterhead) and a converted PDF open, edit and save **exactly** as their templates |
| **1b: prototype loop** | Lisa "rewrite clause" → tracked change by PactPro AI → reviewer in review-only mode → author accepts / rejects | The full loop works end to end. **Go / no-go for the rest.** |
| 2 🔧 built, testing | Content controls, text copy, placeholders panel, Lisa read | Placeholders fill into the file; Lisa answers from the draft |
| 3 🔧 built, testing | Review: modes per role, rounds, comments, Approve blockers, notifications | Assign task → draft → review → approve, all in ONLYOFFICE |
| 4 | Compare / redline, Import changes, Finalise / lock | Redline PDF, returned-file import and locking work |
| 5 | Old drafts migrate; DEMO_REDLINE / DRAFT_REVIEW / DRAFT_EXPORT rewritten | Old drafts open; guides match |
| 6 | Optional: case documents workspace | Case `.docx` editable in AMS |
| 7 | Remove TipTap and the switch; Developer licence in production | No TipTap code left |

**Tests:**
- Django tests for the config signing, file and callback views (each status, bad or missing JWT, wrong firm →
  404, key changes), tracked-change writer, text copy, mode per role;
- the document server is mocked in tests;
- a manual test story per phase in `REDLINE_TEST_PLAN.md`.

## 10a. Phase 1 as built

- **Models** (`drafting/models.py`, migration `0014_draft_file`): `DraftFile` (the draft's Word file, `version`,
  ONLYOFFICE `key`, `editing`) and `DraftFileVersion` (every saved file). The key has a random part because the
  test and dev instances share one document server and their draft ids overlap.
- **`drafting/onlyoffice.py`:**
  - `ensure_file` makes the file from today's Download output the first time a draft opens;
  - `EditorConfigView` (`GET draft-sessions/<id>/onlyoffice/`) returns `{enabled: false}` unless
    `DRAFT_EDITOR=onlyoffice`, else the signed config. Access is `viewable_sessions`; edit vs view follows
    `access.can_write`;
  - `FileView` / `CallbackView` (`onlyoffice/file/<id>/`, `onlyoffice/callback/<id>/`) are public API views
    (`authentication_classes = []`, outside the client gate) checked by a signed link token (24 h), the callback
    also by the server's JWT. Statuses 2 / 6 store a new version and a new key; a callback for an old key is
    ignored.
  - `current_docx` / `force_save`: Download, Save to case and PDF (`wordform.render_draft_docx`) use the file,
    after a forced save when someone has it open.
- **Frontend:** `components/OnlyOfficeEditor.tsx` loads `api.js` from `ONLYOFFICE_URL` and mounts the editor;
  `DraftPage.tsx` shows it in the middle pane when the config is enabled (the Edit / Preview switch is hidden;
  viewers get the read-only editor).
- **Not yet (later phases):** Versions / Restore are still the block versions (phase 2 keeps the blocks in step
  with the file, see below).
- **Tests:** `drafting.tests.OnlyOfficeTest` (switch off, signed config, file link and forged link, other user
  404, callback saves and changes the key, wrong signature refused, Download uses the file).

## 10b. Phase 2 as built

- **Clause markers** (`drafting/docfile.py`): when the file is made, each clause becomes a block-level content
  control tagged `pactpro:block:<id>`, locked against deletion (`sdtLocked`; its text stays editable). The marker is
  invisible: Word's `w15:appearance="hidden"` and no `w:alias`, so users see no frame or "Clause 123" label. ONLYOFFICE keeps
  it when saving. Unedited files made with a visible frame are made again on the next open. Both
  renderers record which body elements each clause became: `wordform.render_into_original` and
  `export/docx.render_session_docx`, through the `docfile.building` context variable, set only by
  `onlyoffice.ensure_file`. Normal downloads are unchanged.
- **Placeholders in the file** are written as `[[Label]]` (an editor placeholder span: its value, or `[[Label]]`
  when empty).
- **Text copy:** every saved version runs `docfile.sync_blocks`. Each clause's text comes from its control (the
  heading paragraph is dropped, it stays `block.heading`); a changed clause gets new `text` / simple
  `content_html` and `is_edited`. Lisa, search, compare and review read the blocks, so they see what was typed.
  A clause whose marker was removed keeps its last text.
- **Form fields (new drafts).** When the Word file is made (`ensure_file` → `docfile.tokens_to_fields`), every
  `[[Label]]` blank becomes a Word plain-text content control tagged `pactpro:field:<Label>`:
  - named after the label (`w:alias`), locked against deletion (`sdtLocked`), showing the label as a grey hint
    while empty (`w:showingPlcHdr`);
  - users can fill it by typing **in the document** or from the panel, and **change it later** (the panel lists
    fields with their current value, `docfile.fields`);
  - Apply sets every field with that label (`docfile.fill_fields`; `''` empties it again, an unchanged value is
    no change);
  - for Lisa, search and compare an empty field reads as `[[Label]]` (`docfile._para_text`);
  - checked against the real document server: fields, values and empty hints survive its saves;
  - older drafts keep `[[Label]]` text: `GET …/placeholders/` lists both (`kind: field | text`) and Apply fills both.
- **Placeholders: fill any, apply once.** In the panel you type values into whichever blanks you want (**Enter**
  moves to the next field); nothing changes until **Apply N to document**. That sends `{values: {label: value}}`
  in one POST: one version, **one** editor reload. Empty fields stay blanks; a label no longer in the document
  comes back in `missing`. With the connector (paid editions) the values go straight into the open document.
- **Placeholders panel** (`PlaceholdersView`, `GET/POST draft-sessions/<id>/onlyoffice/placeholders/`):
  - lists the `[[Label]]` blanks in the file;
  - filling one: forced save if someone has it open, then every `[[Label]]` in the body and header is replaced
    (also when Word split the token across runs; the value takes the first run's formatting);
  - the result is stored as a new version with a new key, and the page re-creates the editor with the returned
    config.
- **Files made in phase 1** (no markers) that were never edited are made again on the next open; one that was
  edited or is open keeps its file (no markers: its text isn't copied back).
- **Checked against the real server:** ONLYOFFICE keeps every marker and the clause text when it saves the file.
- **Tests:** `drafting.tests.OnlyOfficePhase2Test`:
  - markers and placeholder tokens;
  - editor placeholder spans;
  - text copied back with the heading apart;
  - a token split across runs;
  - the placeholder endpoints (stranger 404);
  - an unmarked file made again.

## 10a-0. Edition decision (13 Oct 2026): Community 9.4

PactPro runs on **ONLYOFFICE Docs Community Edition 9.4.0** (free, AGPL v3); the Developer Edition trial was
removed. From 9.4 Community has **no 20-connection limit** (ONLYOFFICE's 9.4 release notes). What it lacks:
- **Automation API (connector).** Its `api.js` has no `createConnector`. `OnlyOfficeEditor.tsx` then reports
  `live() === false` and the page falls back:
  - placeholders are filled on the server, then the editor reloads;
  - jump to a blank or clause does nothing;
  - Lisa's Apply is written **on the server** as tracked changes by "PactPro AI"
    (`POST draft-sessions/<id>/onlyoffice/apply/`, `docfile.apply_tracked`), then the editor reloads with the redline:
    - open edits are saved first;
    - only the differing characters are marked (`w:del` / `w:ins`, the run's formatting kept, runs split as needed);
    - each change must sit in one paragraph and be unique in the document (`docfile.edits_for`, the same rule as
      the page's `utils/textEdits.ts`), else 409 "copy the new text".
    - Tests: `drafting.tests.ServerTrackedChangeTest`.

  A **PactPro plugin** (plugins are allowed in Community) is the planned way to do these in the open document
  without a reload.
- **White label.** `ONLYOFFICE_WHITE_LABEL` stays False, so no PactPro logo / name / loading screen in the editor.
  The AGPL terms (9.4) require ONLYOFFICE's "About" attribution to stay; its trademarks aren't ours to use. Our
  own loading screen still covers the opening.
- **Toolbar / menu hiding** (`customization.layout`) and the admin panel are not honoured or included.
- **Support:** community only.

**Licence rules we follow:**
- run ONLYOFFICE **unmodified**, as a separate service PactPro talks to over its API;
- keep its About attribution;
- have a lawyer confirm the AGPL position before the first commercial firm.

Version 10.0.0 appeared on 12 Oct 2026; we stay on 9.4.0 until it has been tested.

## 10b-1. Developer Edition (trial) on the dev PC (history)

Installed over the Community server (the DE installer removes it), version 9.4.1. Problems met:
- The installer's PostgreSQL check fails against PostgreSQL 18 ("PSQL return code 2"), and its RabbitMQ check
  wants Python. Both can be skipped (OK).
- Because the check was skipped, it **stored a wrong database password** and **created no tables**. Fix:
  - set `services.CoAuthoring.sql.dbPass` in `config\local.json`;
  - run `server\schema\postgresql\createdb.sql` as the `onlyoffice` user;
  - restart `DsDocServiceSvc` / `DsConverterSvc` / `DsProxySvc`.

  Symptom: `/healthcheck` answers 502, and `Log\docservice\DocService_*.out.log` says "password authentication
  failed" or "table … does not exist".
- **It resets our settings:**
  - port 80, and the internal service back on 8000;
  - the plugins return.

  Reapply section 4 step 4 and section 10c after every install or upgrade. The JWT secret was kept.
- **Licence file:** `C:\ProgramData\ONLYOFFICE\Data\license.lic`. Without it the server logs a warning on
  start. Put the trial / purchased licence there and restart `DsDocServiceSvc`.

## 10b-2. Phase 3 as built: review in the editor

- **Roles** (`onlyoffice.editor_role`, the same rule as `drafting/authority.py`):

  | Role | Who | Editor |
  |---|---|---|
  | `decide` | `access.can_write`: the owner; a task reviewer while the task awaits review; a requested reviewer with binding authority | edits, accepts / rejects tracked changes, comments |
  | `suggest` | `access.can_suggest`: a requested reviewer with "suggestions only" | **review-only** (`edit: false, review: true`): every edit is a tracked change; comments |
  | `view` | anyone else who may open the draft | read only |

  The Review tab (track changes, comments) shows for `decide` and `suggest`. The draft page shows a chip:
  "Suggesting: your edits are tracked" or "Read only".
- **Lisa's Apply** is now a **tracked change**: track changes is switched on for the replacement
  (`setTracking` through `connector.callCommand`, `Api.GetDocument().SetTrackRevisions`) and back off if it was
  off. The person who decides accepts or rejects it in the document.
- **Approve / Submit:**
  - `docfile.review_state` counts the file's undecided tracked changes (`w:ins`, `w:del`, moves, format
    changes) and open comment threads (top comments not marked done in `commentsExtended.xml`).
  - `onlyoffice.file_review_blockers` (open edits saved first) feeds `task_review.approve_blockers`: open
    changes or threads block **Approve**.
  - `submit_blocker`: open **changes** block **Submit**; open comments don't (a question for the reviewer may
    stay open).
- **The draft's clause text** (`sync_blocks`) reads the document as if every open change were accepted
  (inserted text in, deleted text out).
- **Not yet:**
  - notifications for new comments made in the editor;
  - the old review-round screens (Review tab on the right) still work on the clause text. With ONLYOFFICE, review
    happens in the document, and the rounds panel is mostly for history;
  - "Request changes" still creates a block round for the author.
- **Tests:** `drafting.tests.OnlyOfficeReviewTest`:
  - roles and permissions (decide / suggest / binding reviewer / stranger 404);
  - counting open changes and threads;
  - Submit blocked only by changes, Approve by both.

## 10b-3. Using ONLYOFFICE's own screens: version history and compare (built)

Both are in the Docs API of every edition, Community included.
- **Version history** (editor: File → Version History):
  - `onRequestHistory` → `GET draft-sessions/<id>/onlyoffice/history/` → `refreshHistory`;
  - `onRequestHistoryData` → `GET …/history/<version>/` → `setHistoryData` (signed; with `previous` and, when the
    save reported them, `changesUrl` so the editor **highlights** the changes);
  - `onRequestHistoryClose` re-creates the editor.
  - Each `DraftFileVersion` now keeps its document `key` and the callback's `changesurl` zip and `history`
    (migration `0015_draft_file_history`).
- **Restore** (the History panel's Restore button, shown only to whoever decides): `POST …/restore/ {version}`.
  Open edits are saved first; that version becomes the current file **as a new version** (nothing lost); the page
  reopens the editor.
- **Compare** (editor: Collaboration → Compare):
  - "File from your computer" works by itself;
  - "Document from storage" fires `onRequestSelectDocument` (c=compare), and the page opens **Compare with…**:
    upload a returned Word file, or pick an earlier version;
  - `POST …/compare/` returns the signed `{c, fileType, url, token}` for `setRequestedDocument`;
  - the differences show as tracked changes to accept or reject.

  This replaces the old **Import changes** for ONLYOFFICE drafts.
- Files the document server fetches for these (`onlyoffice/version/…`, `onlyoffice/changes/…`,
  `onlyoffice/compare/…`) are public views behind the signed link, like the draft file.
- **Tests:** `drafting.tests.OnlyOfficeHistoryTest`.
- **@mentions** (built): typing "@" in a comment lists the people who can open the draft
  (`onRequestUsers` → `GET …/onlyoffice/users/`: author, task assigner, requested reviewers). Mentioning one sends
  a PactPro notification (`onRequestSendNotify` → `POST …/notify/`, type `DRAFT_COMMENT`, so no new type is
  needed); people without access are never notified.
- **Finalise / lock** (built):
  - `POST …/finalise/`: who decides; refused while tracked changes or comments are open; open edits are saved
    first.
  - It stores `final_at` / `final_by_id` / `final_sha256` on `DraftFile` (migration `0016_draft_file_final`) and
    audits it. Everyone then gets the **view** role; saves arriving afterwards are ignored.
  - `DELETE …/finalise/` reopens it, with a new key.
  - The page shows a **Final · name · date** chip; **Finalise** / **Reopen** are in the top bar's **More** menu.
- **PDF/A** (built): `GET …/onlyoffice/pdfa/` has the document server convert the current file to PDF/A (checked:
  the file carries the PDF/A id). **Removed** (15 Oct 2026): not needed for now; Download → PDF covers sharing.
  If court filing needs PDF/A later, it is a document-server conversion (`outputtype: 'pdfa'`).
- **DRAFT watermark** (built): Download (Word / PDF) of an ONLYOFFICE draft that isn't final carries a diagonal
  DRAFT watermark (VML in every section header, `docfile.add_watermark`; Word and LibreOffice both draw it).
  `?watermark=0` leaves it out. The editor itself shows no watermark.
- **Tests:** `drafting.tests.OnlyOfficeFinaliseTest`.
- **Later:** form fields instead of `[[blanks]]`.

## 10b-4. General document editor (built): any AMS document, not only drafts

`documents/editor.py`, the same document server and signing as the draft editor:
- **Open in editor** (Documents page, a document's ⋯ menu) opens `/dashboard/documents/<id>/edit`, a full page:
  PactPro's bar (name, case, version, Save, Download, Close) and the editor below.
  - Word / ODT / RTF / TXT, Excel / ODS / CSV, PowerPoint / ODP are editable;
  - .doc / .xls / .ppt and **PDF** open read-only;
  - other types are refused.
- **Add document** (Documents page and a case's Documents tab, `components/AddDocumentButton.tsx`): **Upload a file**
  (the existing upload) or **New Word / Excel / PowerPoint** (create in the editor). New: a blank Word / Excel / PowerPoint file, optionally linked to a case, created
  like an upload (`POST /api/documents/new`; blanks made with python-docx / openpyxl / python-pptx, or a copy of a
  firm template's Word file with `template_id`), then opened in the editor.
- **PactPro's Save** becomes a **new document version** through `documents.storage.add_version`; the editor's own
  Save and closing only update the working copy (docs/DESKTOP_EDITING.md, "Only Save to PactPro makes a version"). History, downloads, client sharing and the AI summary work as for an uploaded
  version.
- **Version History / Restore / Compare:** the editor's own screens, from the document's versions. The editor's
  key per document and the change data per version are in side tables `document_edit_state` and
  `document_version_changes` (migration `documents/0006_editor_state`; `documents` itself is a Spring table).
- **Access:**
  - the documents' own rules: practice scope (another team → 404), `DOCUMENT_VIEW` to open, `DOCUMENT_EDIT` (or
    your own upload) to edit, `DOCUMENT_UPLOAD` for New document;
  - the document server uses signed links `/api/editor/file|callback|version|changes|compare/<id>…` (public views);
  - on only when the document server is configured (independent of `DRAFT_EDITOR`).
- **Shared code:** the frontend `OnlyOfficeEditor` takes an `EditorBackend` (history, restore, mentions), drafts by
  default, documents in `DocumentEditorPage.tsx`.
- **Tests:** `documents.tests.DocumentEditorTest`.
- **Case page** (Documents tab): an **Open in editor** icon on each editable document, and **New document**
  (Word / Excel / PowerPoint, linked to that case).
- **Tasks:** "Draft for this task" is now **Draft with AI** (unchanged), next to **Write in editor**
  (`utils/taskDocument.ts`): a blank Word document named after the task, on the task's case, attached to the task
  (`POST /api/workspace/tasks/<id>/documents`, `submit: false`), opened in the editor. It goes to the reviewer with
  the task. On the Tasks page drawer and the case page's task rows.
- **@mentions on documents:** "@" offers the practice's members who can open documents
  (`GET …/editor/users`); mentioning one sends a **DOCUMENT_COMMENT** notification (`POST …/editor/notify`). It's a
  new notification type: `service.EVENT_TYPES`, the Notifications Center label "Document Comment", and migration
  `documents/0007_document_comment_notification_type`, which widens the live-DB CHECK constraint.
- **Not yet:** Lisa on documents.

## 10c. Editor as ours: only what PactPro uses

**Editor settings** (`onlyoffice.editor_config`, all editions):
- **Off:**
  - plugins (including the built-in **AI** plugin) and macros;
  - chat;
  - help, feedback and "go back";
  - the editor's own **Download / Print** (files leave only through AMS's audited Download / Save to case);
  - changing content-control settings (protects the clause markers);
  - comments and track changes, until phase 3 moves review into the editor.
- **One save: PactPro's.**
  - Co-editing is "fast": the editor keeps changes as typed (strict mode would make users press its Save).
  - **The editor's own Save** (toolbar icon, File → Save, Ctrl+S) can't be hidden on Community (`customization.layout` is
    paid). With `forcesave: true` it saves into the user's **working copy** (status 6 without PactPro's
    `userdata`), not a version; only PactPro's Save makes a version (docs/DESKTOP_EDITING.md). Hiding it by patching ONLYOFFICE's files was rejected: AGPL publish and mark duties, redone on every
    upgrade.
  - **The draft page's own Save** stays the save. For an ONLYOFFICE draft it calls
    `POST draft-sessions/<id>/onlyoffice/save/` (`SaveView`: force save, stored as a new version) and shows
    Save / Saved from "changed since PactPro last stored it".
  - A save made **in the editor itself** (its Save, Ctrl+S, closing) is not a PactPro save, so the page's button
    stays **Save to PactPro**. Next to it the note *"Your work is safe; not yet a PactPro version"* appears once the
    editor has saved (its "modified" flag drops back: `safe` / `officeSafe`), so nobody takes Ctrl+S for a PactPro
    save (decided 15 Oct 2026). Reopening with such unsaved work starts with the button enabled and the note shown
    (`pendingWork`). The page still polls the stored version (`useStoredVersionWatch`), so a version made elsewhere
    turns it to **Saved**.
  - For a suggest-only reviewer it saves their tracked changes; the old "Send suggestions" button belongs to the
    old editor.
  - Download and Save to case take what is on screen via the working copy (no version); Submit / Approve checks
    and Apply / Restore / Finalise force-save a version first. Closing only updates the working copy.
  - **Re-draft** discards the Word file with the old clauses; the new draft gets a new one.
- **Look:** compact header, file name hidden, classic light theme.
- Toolbar tabs (Collaboration, Plugins, Protect) are hidden through `customization.layout`, which some editions
  ignore.

**Server:**
- The plugin folders (`{GUID}` folders and `marketplace`) were moved from `DocumentServer\sdkjs-plugins` to
  `DocumentServer\sdkjs-plugins-disabled`, and `plugin-list-default.json` set to `[]`, so they can't be loaded
  at all.
- **An ONLYOFFICE upgrade reinstalls them:** repeat the move after every upgrade (a step for `DEPLOYMENT.md` /
  the Linux image).

**PactPro look (built, Developer Edition trial):**
- **Logo and name are on; only the loading screen waits for a licence:** the trial refuses `loaderLogo` / `loaderName` with a "Paid feature" warning on every
  open. Set `ONLYOFFICE_WHITE_LABEL=True` in `.env` once the licensed Developer Edition is in. With it,
  `customization.logo` / `loaderLogo` / `loaderName` / `customer` show PactPro's mark (the
  sidebar's red "P" seal + wordmark, served as SVG by `onlyoffice/logo.svg`, a public view) and name, not
  ONLYOFFICE's. `AMS_PUBLIC_URL` (default `AMS_INTERNAL_URL`) is the backend address browsers load it from.
- **Toolbar:** `customization.layout` keeps the tabs a drafting lawyer needs (Home, Insert, Layout, View with
  navigation) and hides References, Draw, Collaboration, Plugins, Protect, the File menu's close / info / save, the
  header's users / mode / save, and the status bar's language pickers.
- **Our loading screen:** the page covers the editor with a Red Tape page skeleton until `onDocumentReady`
  (`OnlyOfficeEditor.tsx`).
- **Faster open:** the editor script loads as soon as the editor settings arrive (`loadOnlyOfficeApi`).

**Automation API (built, Developer Edition trial):** `OnlyOfficeEditor.tsx` opens a connector
(`docEditor.createConnector()`) once the document is ready and exposes `OfficeEditorHandle` to the page:
- **Find a blank:** `findPlaceholder(label)` (`SearchNext` on `[[Label]]`). Focusing a field in the
  Placeholders panel selects that blank in the document.
- **Fill a blank:** `fillPlaceholder(label, value)` (`SearchAndReplace`). Leaving a filled field writes it into the
  **open** document, with no reload. ONLYOFFICE saves it back like any edit, and the server copies the text into
  the blocks. Without a connector (Community), the page falls back to the server route (`onlyoffice/placeholders/`,
  which reloads).
- **Go to a clause:** `gotoClause(blockId)` (`GetAllContentControls` + `MoveCursorToContentControl` on the
  `pactpro:block:<id>` control), used by the review panel's "jump to clause".
- **Clause under the cursor:** `onFocusContentControl` / `onBlurContentControl` set the page's `focusedId`, so
  Lisa and provenance follow the cursor.
- **Saves:** when the editor goes from unsaved to saved, the page reloads the draft, so the clause text Lisa
  and the review panels read is current. In ONLYOFFICE mode they read the blocks, not TipTap.
- **Lisa's Apply:** `replaceText(find, replace)` (`SearchAndReplace`). `utils/textEdits.editsFor` works out only
  the words Lisa changed (a word diff, nearby changes merged), widened word by word until each searched text occurs
  **once** in the whole draft. They are replaced in the open document, so the clause keeps its formatting. When a
  change can't be pinned to one place, the page says so and nothing is changed. It is a direct edit (the user
  accepted it in the Lisa panel); phase 3 makes it a tracked change instead.

**Branding on Community:** the ONLYOFFICE logo, "About" and loading screen stay. **PactPro logo / name
(`customization.logo`, `customer`) need the Developer Edition.** Ask in the quote which customization options
(logo, layout / toolbar tabs, about / help) it includes. Our page can't restyle the editor: it runs in an iframe
from the document server.

## 11. Risks and open points

- **Licence cost** (Developer Edition) is the main budget item. Quote first.
- **Windows install dependencies** (RabbitMQ, Erlang, PostgreSQL) on every Windows server; Docker on Linux is
  simpler for SaaS.
- **Save timing:** saves arrive by callback (after editors close, or on force save), not per keystroke.
  Every AMS action that needs the latest text must force save first.
- **Content controls** can be deleted by users. That clause then becomes ordinary text (still editable, no
  per-clause Lisa / citation).
- **AI vs live editing:** the reload after an AI change interrupts open editors. Phase 1b decides whether this
  is acceptable, or whether the Automation API (edition-dependent) is worth it for in-editor changes.
- **PDF quality** of the conversion service vs LibreOffice: compare before retiring LibreOffice.
- **Fonts** on every server (Indian scripts included).
- **Mobile:** works in mobile browsers but heavier than TipTap.

## The draft page around the editor (tidied 15 Oct 2026)

For a draft in ONLYOFFICE the page no longer shows the old editor's own tools, which duplicated the editor's:
- **Hidden:** the page's Comment button and Comments tab (comments live in the Word file), Versions (the clause versions;
  use File → Version History), Import changes (use Compare → a file you received back) and the Suggest switch (a
  suggest-only reviewer is in review mode in the editor).
- **Compare** in the top bar opens PactPro's *Compare with…* (`openOfficeCompare`), the same as the editor's Collaboration →
  Compare → Document from storage.
- **More** (`PopMenu`) holds the occasional actions so the bar fits on one line: Save options…, Finalise / Reopen,
  Re-draft… (its Confirm still shows in the bar).
- **Kept:** Download, Save, Open on desktop, Request review, Save to case / Submit to task; on the right Ask Lisa, Review
  (Lisa's consistency check and playbook risks) and Activity (review requests).
Drafts still on the old TipTap editor keep every button as before.

## Lisa's whole-document actions on an ONLYOFFICE draft (15 Oct 2026)

*Make the language more formal / more concise / fix grammar* refine every clause and offer **Apply all**. Each change
goes into the Word file as **PactPro AI** tracked changes on the server (`ApplyView`). Changes arriving together are
collected on the page (`officeQueue`) and sent as **one** request (`{changes: [...]}`); requests run one after another
(`officeChain`). So *Apply all* makes one version and one editor reload, and changes can't overwrite each other. A
clause edited since Lisa read it is skipped and counted (`skipped`), and the page says so. Lisa reads the clause text as
last saved to PactPro, so Save to PactPro before asking her.

## Redline download for ONLYOFFICE drafts (15 Oct 2026)

**Download → Redline** on an ONLYOFFICE draft compares two versions of its **Word file** (each Save to PactPro is one;
the editor's Version History lists them), or a version and what is on screen now (the default "to"; no version is
made, `current_docx` reads the working copy). `GET draft-sessions/<id>/onlyoffice/redline/?from=<v>[&to=<v>][&branding=1]
[&output=pdf]` (`onlyoffice.RedlineView`): each version's clause text is read from the file (`docfile.file_blocks`,
the same rule as `sync_blocks`) and written by the old editor's redline writer (`export/redline.py`), so the result is
a Word file of real tracked changes (accept / reject in Word) or a PDF, with the counts in `X-Redline-Inserted` /
`X-Redline-Deleted`. `from` defaults to the version before the latest. Needs DRAFT_EXPORT; practice scope as for
opening the draft.

**In the draft's own look** (the normal case): LibreOffice's **Compare Document** runs on the two Word files
(`export/libre_redline.py` → `export/lo_compare.py`, run by LibreOffice's own Python with a hidden LibreOffice and a
profile of its own per call, about 8 s). The result is the newer file itself (letterhead, fonts, numbering, tables,
stamp boxes) with every difference, word-level where LibreOffice can, as a tracked change; added / removed paragraphs
and clauses are marked too. LibreOffice credits the changes to the newer version's author. `X-Redline-Layout:
template`.

**Fallback** (`X-Redline-Layout: standard`; the dialog says so): when LibreOffice or its Python is missing or the
comparison fails, the old editor's writer (`export/redline.py`) builds a plain-layout redline from each version's
clause text (`docfile.file_blocks`), with the firm letterhead if ticked.
