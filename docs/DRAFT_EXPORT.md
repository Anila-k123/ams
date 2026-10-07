# Draft export: versions, Word, PDF, redline

Status: **versions, Word redline and server PDF done**; house style is next.

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

## Redline (.docx with tracked changes)

Editor: **Download → Redline (tracked changes)…** (`components/RedlineDialog.tsx`): pick "compare from"
and "compare to" (a version or "Current draft (now)": the editor as it is, unsaved edits saved first), Word (editable) or PDF (read-only). The letterhead comes from the Download panel's tick, not asked again.

`GET /api/drafting/drafts/<id>/export/redline/?from=<version id>&to=<version id>[&branding=1]`
(`drafting/export/views.py::DraftRedlineExportView`, needs `DRAFT_EXPORT`, same draft access as the Word export).
- `from` defaults to the last `sent` version, else the latest; no versions → 400. `to` omitted = current draft.
- Versions of another draft → 404.
- File name `<title>_redline_v<from>-<to|current>_<date>.docx`. Word counts in `X-Redline-Inserted` /
  `X-Redline-Deleted` (exposed through `CORS_EXPOSE_HEADERS`).

How it compares (`drafting/export/redline.py`):
- Clauses are paired by block id; a block with a new id (re-draft) pairs with an unclaimed old clause of the
  same heading. Unpaired clauses are wholly inserted / deleted (the paragraph mark too, so Accept removes it).
- Paragraphs inside a clause are aligned with `difflib`; paired paragraphs are compared word by word
  (punctuation and spaces are their own tokens), written as `<w:ins>` / `<w:del>` runs with the advocate's
  name and the time. Accept / Reject works in Word and LibreOffice.
- Formatting-only changes (bold, alignment) are not marked. Tables are compared row by row as
  tab-separated text, so a changed table comes out as paragraphs, not a grid.
- Layout (A4, fonts, title, letterhead) is the plain export's (`export/docx.py::_setup`, `_branding`).

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

## Planned
- **House style** in `drafting/export/docx.py`: fonts, spacing, margins, page numbers.
