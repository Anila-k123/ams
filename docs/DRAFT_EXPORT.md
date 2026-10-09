# Draft export: versions, Word, PDF, redline

Status: **versions, Word / PDF redline, server PDF and on-screen compare done**; accept / reject inside AMS and Request review are done too ([DRAFT_REVIEW.md](DRAFT_REVIEW.md)).

## Versions (`drafting.DraftVersion`, table `drf.draft_version`)

A version is a frozen copy of every clause of a draft (heading, text, HTML, style) at one moment.
It is the fixed "before" a redline compares the current draft against. Blocks are copied, not
referenced, because `DraftBlock` rows are edited in place and replaced on re-draft.

Saved automatically:
- when the AI finishes a draft (`tasks.generate_draft`, kind `generated`, label "AI draft"), including after a re-draft;
- when the draft is sent to AMS or submitted to a task (`filing.py`, kind `sent`, labelled "Submitted for review · filed as document vN" or "Saved to PactPro · filed as document vN").

Saved by hand from the editor's **Versions** button (kind `manual`, optional label such as
"Sent to opposite counsel"). Unsaved editor changes are saved first.

API (`DraftSessionViewSet.versions`):
- `GET  /api/drafting/draft-sessions/<id>/versions/` → newest first, without content. Needs `DRAFT_VIEW`; reviewers of a submitted draft can list.
- `POST /api/drafting/draft-sessions/<id>/versions/ {label}` → 201 + the list. Needs `DRAFT_CREATE` and `access.can_write` (owner, or the reviewer while the task is SUBMITTED). An empty draft is a 400.

Helpers: `drafting/versions.py` (`snapshot_blocks`, `save_version`). Numbers are per draft (1, 2, 3…).

### Restore a version

**Versions → Restore** on any row puts the draft back to that version (after a confirm). Unsaved edits are
saved first, then the draft as it is is saved as *Before restoring vN*, and the result as *Restored vN*, so a
restore can itself be undone by restoring *Before restoring vN*. Clauses keep their ids where they still
exist, so comments and review rounds stay anchored; clauses added since are removed, removed ones come back.
`POST draft-sessions/<id>/versions/<version id>/restore/`, same rule as editing (`can_write`);
`versions.restore_version`.

### Two people saving the same draft

Every clause carries a revision (`rev`, `versions.block_rev`: a hash of heading + text). The editor sends the
revisions it loaded with each save (`save-blocks` body `{blocks, base}`):

- a clause nobody else changed is saved as usual;
- a clause only the *other* person changed is left as they saved it, and the answer has `merged: true`; the
  editor reloads its content and says *Changes a colleague made to other clauses are now shown too*;
- a clause **both** changed: nothing is saved, the answer is 409 with the clause headings, and a red bar says
  *Not saved: someone else changed Rent after you opened the draft…* with **Reload**.

A plain list body (older clients) saves without the check.

## Layout from the template or sample

A generated draft lays out like the template or sample it came from (`drafting/services/layout.py`):

- **Each clause's usual alignment** (justified body, left address block…) is the alignment most of its
  source lines have, not just the first paragraph's.
- **Lines that stand out** keep their own: a centred title, a right-aligned date or signature, a left
  "From: / To:" block inside justified text. A generated line takes it when it starts like that source line.
- **Word files**: alignment is read the way Word resolves it: the paragraph's own setting, else its style's
  (e.g. *Normal = Justified*). **PDFs** store none, so it is inferred from where each line sits between the
  page's text margins (centred, right, edge to edge = justified). Scanned PDFs give nothing.
- Template drafts take it from the template's slots (captured at upload), sample drafts from the base
  document at generation time.
- Templates uploaded before this: `manage.py refresh_template_layout` (or `--id N`) re-reads their layout
  into the existing slots without re-running the AI naming. It skips a template whose file is missing or
  now splits into a different number of clauses (re-upload that one). Existing drafts are not changed.

## Tables

The draft editor keeps tables (`@tiptap/extension-table`, ruled grid). The comparison engine reads a table
row as one line with its cells separated by tabs (style `Table Row`), so a changed cell shows as a change in
that row; when a clause is rebuilt (accepting some changes, importing a returned file) consecutive rows
become a table again (`export/htmlwrite.py`). Merged cells and column widths are not kept through a rebuild.

## Redline (.docx with tracked changes)

Editor: **Download → Redline (tracked changes)…** (`components/RedlineDialog.tsx`): pick "compare from"
and "compare to" (a version or "Current draft (now)": the editor as it is, unsaved edits saved first), Word (editable) or PDF (read-only). The letterhead comes from the Download panel's tick, not asked again.

`GET /api/drafting/drafts/<id>/export/redline/?from=<version id>&to=<version id>[&branding=1]`
(`drafting/export/views.py::DraftRedlineExportView`, needs `DRAFT_EXPORT`, same draft access as the Word export).
- `from` defaults to the last `sent` version, else the latest; no versions → 400. `to` omitted = current draft.
- Versions of another draft → 404.
- File name `<title>_redline_v<from>-<to|current>_<date>.docx`. Word counts in `X-Redline-Inserted` /
  `X-Redline-Deleted` (exposed through `CORS_EXPOSE_HEADERS`).

How it compares (`drafting/export/compare.py`, shared with the on-screen view):
- Clauses are paired by block id; a block with a new id (re-draft) pairs with an unclaimed old clause of the
  same heading. Unpaired clauses are wholly inserted / deleted (the paragraph mark too, so Accept removes it).
- Paragraphs inside a clause are aligned with `difflib`; paired paragraphs are compared word by word
  (punctuation and spaces are their own tokens), written as `<w:ins>` / `<w:del>` runs with the advocate's
  name and the time. Accept / Reject works in Word and LibreOffice.
- **Storage differences are not changes.** A never-edited draft (the AI's plain text) and an edited one (editor HTML)
  store some things differently; both sides are normalised first (`export/compare.py`): an empty placeholder field
  counts as `[[Label]]` and a filled one as its value; a first line that only repeats the document title or the
  clause heading is ignored (the editor shows those above the text); a doubly escaped `&` in a placeholder name
  (`&amp;amp;`, from older saves) reads as `&`.
- Formatting-only changes (bold, alignment) are not marked. Tables are compared row by row as
  tab-separated text, so a changed table comes out as paragraphs, not a grid.
- Layout (A4, fonts, title, letterhead) is the plain export's (`export/docx.py::_setup`, `_branding`).

## On-screen compare (no download)

Editor: **Compare** in the top bar (or **Compare** on a row of **Versions**, or **Show in document** /
**See what … changed** in the review banners) replaces the document with the compare view
(`components/CompareView.tsx`). Read-only.
- **From / To** pickers: same defaults as the redline (last version sent out → current draft).
  Unsaved edits are saved first.
- **Change list** (left): every changed paragraph, named after the nearest section heading above it
  ("8. TERMINATION"), tagged Changed / Added / Removed, with a snippet. **◀ ▶** steps through them.
- **All markup** (additions underlined green, removals struck red, a bar beside changed paragraphs) or
  **Final** (clean text, bars only).
- **Download** → the Word or PDF redline of exactly what's on screen.

`GET /api/drafting/draft-sessions/<id>/compare/?from=<version id>&to=<version id>` (`DraftSessionViewSet.compare`,
`DRAFT_VIEW`; reviewers of a submitted draft can call it). Returns `{from, to (null = current), inserted,
deleted, changes, clauses: [{block_id, status, label, heading, body}]}`; each paragraph has `kind`
(same / changed / ins / del), `change_id` (1..n) and `segs` `[{op, text, fmt}]`.

**One engine:** `drafting/export/compare.py` decides what changed; `export/redline.py` only writes it as Word
XML and the endpoint returns it as data, so the screen, the Word redline and the PDF always agree (a test
checks the counts match). Version defaults live in `versions.pick_pair`, shared by both.

## PDF (plain draft and redline)

Add `&output=pdf` to either export (`export/docx/` or `export/redline/`). Not `format=`: DRF reserves
that name for its own response formats and answers 404. The server builds the same .docx and converts it with
LibreOffice headless (`drafting/export/pdf.py`), so the PDF matches the Word file, letterhead included. A
redline PDF shows insertions underlined and deletions struck through, in colour, with change bars.

- Editor: the **Download** panel (`components/DownloadPanel.tsx`): an **Add firm letterhead** tick (remembered per browser, off by default) and **PDF** / **Word (.docx)** / **Redline…** buttons; the redline dialog has its own Word / PDF switch. Letterhead = firm logo, address, GSTIN/PAN footer and signature block, for the office's own notices, opinions and letters, not deeds or pleadings (which the parties sign).
- LibreOffice: `LIBREOFFICE_PATH` in `.env`, else `soffice` on PATH, else the usual install folder.
  Windows: `winget install TheDocumentFoundation.LibreOffice`. Linux: `apt install libreoffice-writer`.
- Missing LibreOffice → 503; the plain-draft PDF then falls back to the browser print dialog, and
  the redline dialog suggests the Word file.
- Each conversion runs with its own temporary LibreOffice profile (safe for parallel requests and a
  LibreOffice the user has open), so it takes ~7 s (~30 s the very first time on a machine). Later
  speed-up if needed: a long-running LibreOffice listener (unoserver).

## Roadmap: review changes inside AMS

The detailed plan for step 2, and for **Request review** on common (non-task) drafts, is in
[DRAFT_REVIEW.md](DRAFT_REVIEW.md).

Agreed order (each step builds on the one before):

1. **On-screen compare** (done, see above): see the redline in the editor, no download. Compare toggle
   + "Compare" on each version, change list, next / previous, All markup / Final display.
2. **Accept / reject inside AMS: Option B (senior has the final word)** (done).
   - The senior's **corrections are binding**: applied to the draft, shown as changes.
   - The senior can also make **suggestions** (optional advice). The junior accepts a suggestion,
     or declines it **with a reason**.
   - On every resubmission the **senior** accepts or rejects the junior's changes and resolves any
     declined suggestions before **Approve**. Between equals (no task review) the author decides.
   - Not chosen: A (corrections only, no suggestions); C (author accepts / rejects everything,
     as in Word / Google Docs, wrong inside a chambers hierarchy).
3. **Incoming documents:** upload the client's / opposite counsel's edited file (their Word
   tracked changes read with their names), compare it with our draft, accept / reject into it.
   The advocate handling the matter decides; a junior's result goes through the task review.

## Planned
- **House style** in `drafting/export/docx.py`: fonts, spacing, margins, page numbers.
