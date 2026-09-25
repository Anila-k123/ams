# 06 — InstaDraft: Real .docx export on the server

**Codebase:** InstaDraft
**Depends on:** nothing (can be built in parallel)

## Context
Today, export happens only in the browser: HTML is saved as a Blob with type `application/msword` (a `.doc`), and PDF is just `window.print()`
(`frontend/src/pages/DraftPage.tsx`). A draft is a `DraftSession` plus its ordered `DraftBlock`s
(`heading`, `text`, `content_html`).

## Tasks
1. Add `python-docx`, plus `htmldocx` or a small custom converter for the HTML TipTap produces:
   headings, paragraphs, bold/italic/underline, ordered and unordered lists, tables.
2. `drafting/export/docx.py::render_session_docx(session, branding=None) -> bytes`:
   - Blocks go in `position` order. `heading` becomes a Heading style; `content_html` becomes converted runs.
   - A4 page, sensible margins, a legal font (e.g. Times New Roman 12).
   - `branding` is an optional dict from the AMS `me` endpoint:
     - header: office logo, office name and address;
     - footer: GST/PAN, if present;
     - end of the document: a signature block with the signature and seal images.
     Missing images are simply skipped.
3. `GET /api/drafts/<id>/export/docx/`: a file download, with a `Content-Disposition` filename built from
   the template name and date. With `?branding=1`, it pulls branding via AMS `get_me` when the
   user has an `ams_advocate_id`.
4. Frontend: point "Download .docx" at this endpoint. Keep print for PDF for now.
5. Tests: a session with headings, lists and a table renders, and the file opens with python-docx
   with the expected paragraph count.

## Done when
- The downloaded file opens in Word as a real `.docx` with correct formatting.
