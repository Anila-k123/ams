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

## Headings: kept apart from the body, the AI never writes them

The same rule for every draft (Firm template, Type the facts directly, Start from reference documents,
Word or PDF) (`drafting/services/headings.py`):

1. **At upload each clause is split once into heading + body.** The heading is only what the parser
   *detected* as one: a Word heading, a bold numbered title, an ALL-CAPS title, or a PDF line the converter
   made a heading. A short first sentence is never guessed to be a heading. Stored on template slots
   (`heading`, `body`, `heading_kind`) and on reference-document clauses (`SampleClause.heading`).
2. **The AI gets only the body**, with the heading as a label it must not write (*"CLAUSE HEADING (a label
   only…): 1. PREMISES"*). A first line that repeats the heading anyway is dropped.
3. **The heading is decided by rule**:
   - **fixed** (no blanks or case details: *VERSUS*, *1. PREMISES*, *LEASE AGREEMENT*): exactly as the
     template has it, numbering included;
   - **variable** (a `[[blank]]`, a court, a case number, a name, a date: *IN THE COURT OF [[Court Name]],
     CHENNAI*): only its details are filled from the facts by a short separate AI step
     (`tasks._fill_variable_headings`); what can't be filled stays a `[[blank]]`.
4. **Editor:** the heading shows above the clause, the body below; a `[[blank]]` in a heading is listed in
   **Placeholders** and written into the heading when you leave the field. Download writes the heading into
   the template's heading paragraph (its format kept) and the body into its body paragraphs.
5. Templates / reference documents uploaded before this: `manage.py refresh_template_layout` re-splits
   templates; `--samples` re-splits PDF samples' clauses. A file that now splits differently is best
   uploaded again. Drafts already made don't change.

**Dotted leaders.** Dots attached to the text before them (*O.S. No. 145 of 2024………JURISDICTION*,
*Chennai………*) are a printed leader and stay as dots; dots after a space or a field word (*dated……*,
*No. ……*, *Rs. ……*, *on this……day*) and underscores are blanks to fill (`tasks._is_leader`).

## Template look: drafts that look like their Word template / sample

A draft made from a **Word template** or a **Word sample** looks like that file, in the editor and in every
download (`drafting/wordform.py`). The AI still writes the text; the file supplies the form.

**At upload** (or with `manage.py refresh_template_layout` for older templates) each clause is placed in the
file: which paragraphs and tables it covers, and how each of its paragraphs is formatted (font, size,
colour, alignment, indents, spacing before / after, line spacing, bold / italic / underline). Stored on the
template slot as `form` (`clause_forms`). Samples are placed when a draft is generated from them.

**Titles and headings are the template's own.** A clause shown under a heading shows the file's own heading
text (*LEASE AGREEMENT*, *1. PREMISES*), not the name the AI gave the slot at upload; the draft has no separate
title line (the template's title is the title). The *Document title* field was removed from **Type the facts
directly**; drafts made earlier keep their stored title.

**Lines: fixed wording kept, case details rewritten in place.** The AI is told to keep the clause's line
structure: lines without case details (*VAKALATNAMA*, *Dated:*, *Accepted by me:*, *Versus*) copied exactly,
once; lines with case details (court, place, case number, names, dates) rewritten in that same line, never
added as a second version (`tasks._LINE_RULE`). Nothing is put back by rule any more: a rule can't tell that
*JUNAGADH DISTRICT AT JUNAGADH* is a detail to replace, and it printed the old court next to the new one.

**Unchanged lines are the template's own.** A draft line with the same words as a template line (tabs and
spacing aside) shows in the editor with the template's runs (a few **bold** words inside the line, tab gaps)
and is written in the download as the template's paragraph itself, every run as the file has it. Changed lines
are rebuilt in their paragraph's look (whole-line bold, font, alignment); bold on a few words of a rewritten
line is not carried over (the words changed). Tabs typed or kept in the editor print as Word tab stops.

**Layout the editor can't show stays in the download.**
- Lines with no letters or digits (the `))` bracket column of a cause title, `-----` rules) are tab-stop layout:
  the AI's copies are dropped, the editor doesn't show them, and the download keeps the template's own, in
  their place (`wordform.is_layout_line`).
- Drawn shapes (stamp boxes, lines, pictures anchored in a clause's paragraphs) are kept in place in the download
  even when that paragraph's text was rewritten. The editor can't draw them: a note above the page says how many
  the template has (`style_json.src.shapes`).

**In the editor** the draft opens in that look:

- each generated line takes the formatting of the template paragraph it starts like, else of the body
  paragraph at its position (extra lines take the last one); a heading line takes the heading's look;
- the paper takes the file's page width and margins; the header sits **inside** the top margin (from Word's
  header distance), the text starts at the margin, as in print (no empty band above the header);
- the file's **header and footer** (logo, firm name, address, page note) show above and below the text, as
  in print. They are not editable in the draft: the file keeps them;
- the editor cannot show page breaks or a header repeating on every page; Download / PDF show those;
- **Preview** (every draft) shows the same formatted content read-only: fonts, alignment, indents, tables,
  heading styles; a filled blank reads as its value, an empty one as a highlighted `[Label]`. (The old
  "filled-in" word highlight was dropped: **Compare** shows exactly what changed.)

Each block remembers its place: `style_json.src = {file: 'template:<id>' | 'sample:<id>', range: [first,
last], heading}`. The session's `word_form` (serializer) gives the page, header / footer HTML and
`has_letterhead`.

**Download (Word / PDF) and Save to case** open the **original file** and write each clause's final text into
that clause's own paragraphs (`render_into_original`, via `render_draft_docx`):

- the *n*-th draft paragraph is written into the template paragraph it starts like, else the one at its
  position, keeping that paragraph's style, numbering, indents and first-run font; the editor's bold /
  italic / underline / alignment are applied on top. A typed number is dropped where Word numbers the
  paragraph itself, so "1.1" never prints twice;
- a table is written into the template's table (its style, header row, borders), rows added or removed;
- everything outside the clauses is untouched: title, logo, header, footer, page size and margins,
  signature images, section breaks;
- a clause added in the draft goes after the one before it, in the body look; a clause deleted from the
  draft leaves the file too;
- if writing into the original ever fails, the house-style document is produced instead (logged), so a
  download never fails.

**Letterhead.** The firm letterhead stays an optional tick at Download for drafts without a Word source. A
draft whose template / sample has its **own letterhead** (anything in the file's header) keeps that one,
and Download does not offer the firm letterhead (it would print two); Save to case also skips it.

**View on Firm Templates / Samples** shows the uploaded file **as it prints** (`GET templates|samples/<id>/preview/`,
`drafting/files.py`): a PDF as it is; a Word file made into a PDF by LibreOffice once and kept under
`MEDIA_ROOT/previews/` (made again only when the file changes), so the letterhead, logo, fonts and layout are
seen. Without LibreOffice it falls back to the old text view (with a note). **Download original** saves the
uploaded file itself. The draft page's **Reference documents** list and the clause **citation markers** ([1], [2]…)
open the same way in the side panel: through the logged-in file / print-view links (uploads are never
served from `/media`), a Word source shown as it prints.

**Not covered:** the **redline** download (tracked changes) stays in house style; drafts made before this
keep the old behaviour; the editor shows one long page.

## PDF templates and samples

A PDF has no paragraphs or styles, only positioned text. At upload it is converted to **Word in the
background** (`services/pdf2word.py`, `Template.word_file` / `Sample.word_file`); nothing is shown to the
user. From then on the Word version drives everything above: clauses, the template look, Download.

- Lines are joined into paragraphs (a gap clearly bigger than the document's normal line gap starts a new
  one); each gets the alignment, indent, font, size, weight and **colour** its lines have on the page
  (justified = lines run to the right edge; centred = middle of the text block).
- Right-aligned lines that follow each other stay one block with line breaks (a signature: *name ↵ role*)
  and are never headings; nor is a line with a `[[blank]]` or a signature label (*LESSOR*, *For …*,
  *Witness*, *Authorised Signatory*), so a signature block doesn't become clauses of its own.
- **Side-by-side columns** (a signature row: *advocate | client | client*, name over role; *Date | Place*)
  are found from the wide gaps inside the lines and the word groups lining up over consecutive lines, and
  become a borderless table, one column each.
- The top margin is where the first line that isn't header text starts (a title near the top counts).
- A line starting in lower case carries on the sentence before it (never a new paragraph or a heading); a
  signature label (*Sd/-*, *LESSOR*, *For …*) is never a heading.
- A logo with the firm's details beside it becomes a two-column header (logo cell + text cell), lines the
  PDF wrapped joined again (*KUMAR & ASSOCIATES* on one line), with their size, weight and colour.
- Short bold or larger lines become headings (in the document's own font), so clauses split as in a Word
  upload; tables become Word tables; an image at the top of the first page becomes the header logo; text
  repeating at the same place at the top / bottom of the pages becomes the header / footer (on a one-page
  PDF: text beside the logo, and the bottom band).
- Clauses are read from the Word version (the page's own text; Docling is the fallback when it splits
  into no clauses).
- A **scanned PDF** (no text layer) gets no Word version and keeps the alignment-only behaviour.
- After the converter improves: `manage.py refresh_template_layout --rebuild-word` makes PDF templates'
  Word versions again, `--samples` PDF samples' (upload a sample again if its clauses now split differently).
- A clause shown under its heading never repeats the heading as its first line (`wordform.drop_leading_heading`;
  the editor and Preview drop such a first paragraph from older drafts too).
- Borderless tables in a PDF are not detected as tables (they stay text).

## Layout from the template or sample (alignment only)

Drafts without a Word form (older drafts, scanned PDFs) still get the alignment pass below.

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

Word tables reach the AI as table rows (`| a | b |`, `services/parser.py`), like a PDF's tables from
Docling, and generated table rows become a table again (`tasks._table_html`). The draft editor keeps tables (`@tiptap/extension-table`, ruled grid). The comparison engine reads a table
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
