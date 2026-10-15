import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { DRAFTING } from './routes'
import { usePermission } from '../../contexts/PermissionContext'
import { useToast } from '../../contexts/ToastContext'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Chip, EmptyState, PopMenu, type MenuItem } from '../../ui/kit'
import { Modal, confirm } from '../../ui/overlays'
import { Field } from '../../ui/forms'
import Icon, { type IconName } from '../../ui/Icon'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { TableKit } from '@tiptap/extension-table'
import amsApi, { errorMessage } from '../../api/client'
import AmsCasePicker from './components/AmsCasePicker'
import { DOMSerializer } from '@tiptap/pm/model'
import { diffWords } from 'diff'
import { ClauseDocument, Clause, type Citation } from './editor/clause'
import { Placeholder, decodeEntities } from './editor/placeholderNode'
import { EditHighlight } from './editor/editHighlight'
import { ParagraphStyle } from './editor/paragraphStyle'
import { Search } from './editor/search'
import { PlaceholderHighlight } from './editor/placeholder'
import { RiskHighlight } from './editor/riskHighlight'
import { CommentHighlight } from './editor/commentHighlight'
import CommentsPanel, { type PendingComment } from './components/CommentsPanel'
import EditorToolbar from './components/EditorToolbar'
import DraftChat from './components/DraftChat'
import DraftVersions from './components/DraftVersions'
import RedlineDialog from './components/RedlineDialog'
import DownloadPanel from './components/DownloadPanel'
import CompareView from './components/CompareView'
import ReviewRoundView, { roundTitle } from './components/ReviewRoundView'
import ReviewActivity from './components/ReviewActivity'
import CaseFilePanel from './components/CaseFilePanel'
import ImportChangesDialog from './components/ImportChangesDialog'
import OnlyOfficeEditor, { loadOnlyOfficeApi, useStoredVersionWatch, type OfficeEditorHandle } from './components/OnlyOfficeEditor'
import { editsFor } from './utils/textEdits'
import type { OfficeBlank, OnlyOfficeSetup } from './api/drafting'
import RequestReviewDialog, { POWER } from './components/RequestReviewDialog'
import ConsistencyPanel from './components/ConsistencyPanel'
import PlaybookRiskPanel from './components/PlaybookRiskPanel'
import InlineDocViewer from './components/InlineDocViewer'
import DocumentPlaceholders from './components/DocumentPlaceholders'
import { useSaveChoice } from '../../components/SaveChoiceDialog'
import { useOpenWith } from '../../components/OpenWithDialog'
import { DESKTOP_SAVED_EVENT } from '../../components/DesktopEditsBar'
import { saveBlob } from '../../utils/openWith'
import { draftingApi, type DraftSession, type DraftBlock, type AmsTaskReview, type ReviewRoundSummary, type DraftReviewRequest, type DraftComments, type DraftCommentThread, type WordForm } from './api/drafting'
import DraftChanges, { changeSummary } from '../../components/DraftChanges'
import { RiskContext, type RiskMap } from './context/RiskContext'
import { sanitizeHtml } from '../../utils/sanitizeHtml'

// ── legacy blank detection (old ______ / dot-leader drafts) ────────────────────
const BLANK_SRC = '_{2,}|…{2,}|\\.{4,}|\\[[\\s_.•●…]*\\]'
const humanize = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase())
// Convert [[Label]] tokens into placeholder-node spans on load / insert.
const convertTokens = (html: string) =>
  html.replace(/\[\[([^\]]+)\]\]/g, (_, l: string) => `<span data-placeholder="${escAttr(decodeEntities(l.trim()))}"></span>`)
// Plain-text projection of a placeholder node (its value, or [[Label]] if empty).
const phLeafText = (node: { type?: { name?: string }; attrs?: { value?: string; label?: string } }) =>
  // Empty placeholders serialize as [[Label]] (NOT single-bracket) so they survive a
  // round-trip through the LLM (refine/chat) and are re-created as placeholder nodes on
  // the way back — single brackets read as ordinary prose and get flattened to text.
  node.type?.name === 'placeholder' ? (node.attrs?.value || `[[${node.attrs?.label}]]`) : ''

// Serialization for LLM round-trips (refine): EVERY placeholder → [[Label]], filled or
// not, so the model only ever sees a token it's told to preserve — it can't flatten a
// filled placeholder to prose. The filled value is restored from the editor after the
// patch (see patchClause), so values survive without ever passing through the model.
const phTokenText = (node: { type?: { name?: string }; attrs?: { label?: string } }) =>
  node.type?.name === 'placeholder' ? `[[${node.attrs?.label}]]` : ''

// Build the new clause HTML with the words that CHANGED wrapped in an edit-highlight
// span (so an accepted edit shows what was altered). Also converts [[Label]] tokens.
function highlightedHtml(before: string, after: string): string {
  const paras: { text: string; added: boolean }[][] = [[]]
  for (const part of diffWords(before, after)) {
    if (part.removed) continue
    part.value.split('\n').forEach((s, i) => {
      if (i > 0) paras.push([])
      if (s) paras[paras.length - 1].push({ text: s, added: !!part.added })
    })
  }
  const html = paras.map(segs => {
    if (!segs.length) return ''
    const inner = segs.map(({ text, added }) => {
      const h = escText(text).replace(/\[\[([^\]]+)\]\]/g, (_m, l: string) => `<span data-placeholder="${escAttr(decodeEntities(l.trim()))}"></span>`)
      return added ? `<span data-edit-hl>${h}</span>` : h
    }).join('')
    return `<p>${inner}</p>`
  }).join('')
  return html || '<p></p>'
}
const BLANK_RE = new RegExp(BLANK_SRC, 'g')
const BLANK_SPLIT_RE = new RegExp(`(${BLANK_SRC})`, 'g')
const BLANK_TEST_RE = new RegExp(`^(?:${BLANK_SRC})$`)

// ── HTML helpers to seed / read the editor ─────────────────────────────────────
const escAttr = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escText = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Drop the clause's first line ONLY when it duplicates the clause heading — either a
 *  numbered/section title (e.g. "1 DEFINITIONS", "ARTICLE II") or text matching the
 *  node's `heading`. Avoids deleting real leading content such as a preamble's
 *  agreement title (which is NOT the LLM-named heading). */
const _headNorm = (s: string) =>
  (s || '').toLowerCase()
    .replace(/^(?:\d+[.\d]*[.)]|[ivxlc]+[.)]|exhibit[-\s]*[a-z0-9]*)\s*/i, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()

function stripLeadingHeading(text: string, heading = ''): string {
  // Stripping only exists to avoid showing the heading TWICE (as the display heading AND
  // as the body's first line). With no display heading, keep the clause's own heading line.
  if (!heading.trim()) return text
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  if (i >= lines.length) return text
  const raw = lines[i].trim()
  const first = _headNorm(raw), head = _headNorm(heading)
  const rest = lines.slice(i + 1).join('\n').replace(/^\n+/, '')
  // Exact duplicate of the heading (e.g. a section-divider block whose only line IS the
  // heading) → strip it even if nothing remains, so the heading isn't shown twice.
  if (head.length >= 2 && first === head) return rest
  // A numbered title, or a line that merely CONTAINS the heading, → strip only when real
  // content remains (never empty a single-line clause like a "WHEREAS, …" recital).
  // The numbered line must be SHORT (heading-like) — otherwise a numbered SUB-CLAUSE that
  // carries real content (e.g. "5.1 The Consultant agrees to provide services…") would be
  // wrongly dropped as if it were a duplicate title.
  const numberedTitle = /^\s*(?:\d+[.\s)]|ARTICLE\s|SECTION\s|CLAUSE\s)/i.test(raw)
    && raw.trim().split(/\s+/).length <= 8
  const looseMatch = head.length >= 3 && first.length > 0 && (first.includes(head) || head.includes(first))
  if ((numberedTitle || looseMatch) && rest.trim()) return rest
  return text
}

// Strip Markdown emphasis the LLM sometimes emits (the editor is not a Markdown
// renderer): unwrap **bold** / __bold__ (keep inner text) and drop leading # heading marks.
const stripMd = (s: string) =>
  (s || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')

const textToHtml = (t: string) =>
  stripMd(t || '').split(/\n+/).filter(Boolean).map(l => `<p>${escText(l)}</p>`).join('') || '<p></p>'

// Normalise a heading for matching: lower-case, collapsed spaces, trailing punctuation dropped.
const titleNorm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim()

/** A clause heading as shown: whitespace tidied (reference PDFs often space words with
 *  tabs, which render as wide gaps), and dropped when it only repeats the document title
 *  already shown above as the H1. */
function displayHeading(heading: string | null | undefined, docTitle = ''): string {
  const h = (heading || '').replace(/\s+/g, ' ').trim()
  return docTitle && titleNorm(h) === titleNorm(docTitle) ? '' : h
}

// Recognise a legal-document title (so we can promote it to the heading, not leave it in body).
const DOC_TITLE_RE = /\b(agreement|deed|nda|mou|memorandum|affidavit|vakalatnama|vakalathnama|contract|lease|power of attorney|undertaking)\b/i

/** The document's own title: the first non-empty line of the first block when it reads like a
 *  title — short and either mostly upper-case or containing a legal-doc keyword. Else ''. */
function extractDocTitle(blocks?: DraftBlock[]): string {
  const first = (blocks || [])[0]
  if (!first) return ''
  // A heading that names a document ("RESIDENTIAL LEASE DEED") is the title. Saving drops the
  // title line from the text (it's shown as the H1, not in the body), so after the first save
  // the heading is the only place it remains. Same rule as the Word export (export/docx.py).
  const heading = (first.heading || '').replace(/\s+/g, ' ').trim()
  if (heading && heading.split(' ').length <= 12 && DOC_TITLE_RE.test(heading)) return heading
  const line = (stripMd(first.text || '').split('\n').find(l => l.trim()) || '').trim()
  if (!line || line.split(/\s+/).length > 12) return ''
  const letters = line.replace(/[^a-z]/gi, '')
  const mostlyUpper = letters.length > 0 && letters === letters.toUpperCase()
  return (mostlyUpper || DOC_TITLE_RE.test(line)) ? line : ''
}

/** Drop the leading title line from a block's text when it matches the document title, so the
 *  title isn't shown twice (once as the H1, once in the body). */
function stripDocTitle(text: string, title: string): string {
  if (!title) return text
  const lines = (text || '').split('\n')
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  if (i < lines.length && titleNorm(lines[i]) === titleNorm(title)) {
    return lines.slice(i + 1).join('\n').replace(/^\n+/, '')
  }
  return text
}

// Captured heading style → inline CSS string (for the Word/PDF export heading).
function headingStyleCss(s: Record<string, unknown> | null | undefined): string {
  if (!s) return ''
  const css: string[] = []
  if (s.align) css.push(`text-align:${s.align}`)
  if (s.font) css.push(`font-family:'${s.font}'`)
  if (s.size) css.push(`font-size:${s.size}pt`)
  if (s.color) css.push(`color:${s.color}`)
  if (s.bold) css.push('font-weight:bold')
  if (s.italic) css.push('font-style:italic')
  if (s.underline) css.push('text-decoration:underline')
  if (s.caps) css.push('text-transform:uppercase')
  return css.join(';')
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Remove edit-highlight spans (unwrap, keep text) — used so downloads are clean.
function stripEditHl(html: string): string {
  // DOMParser builds an inert document: unlike innerHTML on an element of this
  // page, nothing in it loads or runs (an <img onerror> in stored draft HTML
  // would otherwise execute here).
  const body = new DOMParser().parseFromString(html, 'text/html').body
  body.querySelectorAll('[data-edit-hl]').forEach(el => {
    while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el)
    el.parentNode?.removeChild(el)
  })
  return body.innerHTML
}

// Print stylesheet used for the PDF export (rendered in a hidden iframe).
const PRINT_CSS = `
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; line-height: 1.6;
         max-width: 720px; margin: 36px auto; padding: 0 28px; }
  h1 { font-family: Arial, sans-serif; text-align: center; font-size: 20px; margin: 0 0 26px; }
  h3 { font-family: Arial, sans-serif; font-size: 14px; margin: 20px 0 6px; }
  p { margin: 0 0 10px; } ul, ol { margin: 0 0 10px 26px; }
  @page { size: legal; margin: 20mm; }  /* legal = 8.5in × 14in */
`

// Number the traceable blocks 1..N (document order) and map blockId → citation.
function buildCitations(blocks: DraftBlock[]): Record<number, Citation> {
  const map: Record<number, Citation> = {}
  let n = 0
  for (const b of blocks) {
    const d = b.source_clause_detail
    if (d) { n += 1; map[b.id] = { n, doc: d.sample_name, page: d.position, text: d.text, url: d.sample_url } }
  }
  return map
}

/** Build the editor's initial HTML: one <section data-clause> per DraftBlock.
 *  Body style (font/size/colour/alignment) rides on the stored content_html's <p>
 *  tags; the captured heading style is emitted as data-heading-style. */
// A clause shown under its heading whose formatted text also starts with that heading (sample
// drafts, where the AI writes it too): the repeated first paragraph is dropped, as the plain-text
// path (stripLeadingHeading) and the download do.
function dropHeadingParagraph(html: string, heading: string): string {
  const h = (heading || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!h || !html) return html
  const div = document.createElement('div')
  div.innerHTML = html
  const first = div.firstElementChild
  const t = (first?.textContent || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (first && first.tagName !== 'TABLE' && t === h) first.remove()
  return div.innerHTML
}

function buildContentHtml(blocks: DraftBlock[], docTitle = ''): string {
  return blocks.map(b => {
    const plain = stripDocTitle(stripLeadingHeading(b.text, b.heading || ''), docTitle)
    const body = convertTokens(b.content_html?.trim()
      ? dropHeadingParagraph(b.content_html, displayHeading(b.heading, docTitle)) : textToHtml(plain))
    const hStyle = b.style_json?.heading
    const hAttr = hStyle ? ` data-heading-style="${escAttr(JSON.stringify(hStyle))}"` : ''
    return `<section data-clause data-block-id="${b.id}" data-heading="${escAttr(displayHeading(b.heading, docTitle))}"${hAttr} `
      + `data-source="${b.source}" data-verified="${b.verified}">${body}</section>`
  }).join('')
}

// ── read-only Preview renderer: the document as it prints ─────────────────────
// The same formatted content as the editor (fonts, alignment, indents, tables, heading styles),
// read-only: a filled placeholder reads as its value, an empty one as a highlighted [Label].
// Edit highlights are dropped. What changed is Compare's job, not Preview's.
function previewHtml(block: DraftBlock, docTitle = ''): string {
  const heading = displayHeading(block.heading, docTitle)
  const hCss = headingStyleCss(block.style_json?.heading)
  const plain = stripDocTitle(stripLeadingHeading(block.text, block.heading || ''), docTitle)
  const div = document.createElement('div')
  div.innerHTML = stripEditHl(block.content_html?.trim()
    ? dropHeadingParagraph(block.content_html, heading) : textToHtml(stripMd(plain)))
  const blank = (label: string) => {
    const span = document.createElement('span')
    span.className = 'pp-blank'
    span.textContent = `[${label}]`
    return span
  }
  div.querySelectorAll('[data-placeholder]').forEach(el => {
    const value = el.getAttribute('data-value') || ''
    el.replaceWith(value ? document.createTextNode(value) : blank(decodeEntities(el.getAttribute('data-placeholder') || '')))
  })
  // Blanks still in the text ([[Label]] not yet a placeholder, or an old ____ line): highlighted.
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT)
  const hits: Text[] = []
  while (walker.nextNode()) {
    const v = walker.currentNode.nodeValue || ''
    if (v.split(BLANK_SPLIT_RE).some(part => BLANK_TEST_RE.test(part))) hits.push(walker.currentNode as Text)
  }
  hits.forEach(node => {
    const frag = document.createDocumentFragment()
    ;(node.nodeValue || '').split(BLANK_SPLIT_RE).forEach(part => {
      if (!BLANK_TEST_RE.test(part)) { frag.appendChild(document.createTextNode(part)); return }
      const m = part.match(/^\[\[([^\]]+)\]\]$/)
      const span = blank(m ? decodeEntities(m[1].trim()) : '')
      if (!m) span.textContent = part
      frag.appendChild(span)
    })
    node.replaceWith(frag)
  })
  return (heading ? `<h3 class="pp-clause-heading"${hCss ? ` style="${escAttr(hCss)}"` : ''}>${escText(heading)}</h3>` : '')
    + `<div class="pp-doc-html">${div.innerHTML}</div>`
}

function PreviewClause({ block, docTitle = '' }: { block: DraftBlock; docTitle?: string }) {
  return <div className="pp-doc-section" dangerouslySetInnerHTML={{ __html: previewHtml(block, docTitle) }} />
}

/** The draft workspace: a three-pane editor (provenance · editable document ·
 *  assistant stub) with a read-only Preview toggle and manual Save. Polls while
 *  the draft is still generating. */
// A draft from a Word template / sample sits on that file's page: its width and margins
// (drafting/wordform.py page_form). As in Word, a header prints INSIDE the top margin (from
// header_mm below the edge) and the text starts at the margin; a footer likewise at the bottom.
// Others keep the standard sheet.
function paperStyle(form?: WordForm | null): React.CSSProperties | undefined {
  const p = form?.page
  if (!p?.width_mm) return undefined
  const mm = (v: number | null | undefined, d: number) => `${v ?? d}mm`
  const top = form?.header_html ? mm(p.header_mm, 12.5) : mm(p.margin_top_mm, 20)
  const bottom = form?.footer_html ? mm(p.footer_mm, 12.5) : mm(p.margin_bottom_mm, 20)
  return {
    width: `min(${p.width_mm}mm, calc(100% - 32px))`,
    padding: `${top} ${mm(p.margin_right_mm, 20)} ${bottom} ${mm(p.margin_left_mm, 20)}`,
  }
}

// The header band fills the top margin (from the header line down to where the text starts);
// the footer band the bottom one. A taller header simply pushes the text down, as in Word.
function bandSpace(form: WordForm | null | undefined, where: 'head' | 'foot'): string | undefined {
  const p = form?.page
  if (!p) return undefined
  const space = where === 'head'
    ? (p.margin_top_mm ?? 20) - (p.header_mm ?? 12.5)
    : (p.margin_bottom_mm ?? 20) - (p.footer_mm ?? 12.5)
  return space > 0 ? `${space}mm` : undefined
}

// The template's header / footer (logo, firm name, address), shown where they print; not editable
// here: the draft's Download keeps them exactly as in the file. The HTML is built by the server
// from the Word file (text escaped, images as data: URIs).
function WordBand({ html, where, form }: { html?: string; where: 'head' | 'foot'; form?: WordForm | null }) {
  if (!html) return null
  return <div className={`pp-word-band ${where}`} title={where === 'head' ? "The template's header" : "The template's footer"}
    style={{ minHeight: bandSpace(form, where) }} dangerouslySetInnerHTML={{ __html: html }} />
}

export default function DraftPage() {
  const { hasPermission } = usePermission() as any
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const [session, setSession] = useState<DraftSession | null>(null)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(false)      // read-only filled-document view
  // On-screen compare (components/CompareView.tsx): null = off; `from` = a version picked in the
  // Versions list, else the server's default (last version sent out).
  const [compare, setCompare] = useState<{ from?: number } | null>(null)
  // Review rounds (docs/DRAFT_REVIEW.md): the draft's rounds, the one open on screen, and whether
  // a reviewer who may also edit directly is typing suggestions instead (Suggest toggle).
  const [rounds, setRounds] = useState<ReviewRoundSummary[]>([])
  const [reviewRoundId, setReviewRoundId] = useState<number | null>(null)
  const [suggestMode, setSuggestMode] = useState(false)
  // Request review on drafts without a task (drafting/review_requests.py).
  const [requests, setRequests] = useState<DraftReviewRequest[]>([])
  const [askReview, setAskReview] = useState(false)
  const [reviewDone, setReviewDone] = useState(false)
  // Senior review mode: a reviewer (not the author) opens the draft from the task.
  // Read-only by default; Edit only while the task awaits their review.
  const [askChanges, setAskChanges] = useState(false)
  const [reviewNote, setReviewNote] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const reviewOpened = useRef(false)
  const [dirty, setDirty] = useState(false)          // unsaved editor changes
  const [saving, setSaving] = useState(false)
  const [focusedId, setFocusedId] = useState<number | null>(null)  // clause under the cursor (for provenance)
  const [blankCount, setBlankCount] = useState(0)    // unfilled placeholders in the live doc
  const [placeholders, setPlaceholders] = useState<{ label: string; display: string; value: string }[]>([])  // placeholder-node fields
  const headingFill = useRef<Record<string, string>>({})   // values typed for blanks in clause headings
  const [refDoc, setRefDoc] = useState<{ name: string; url: string; preview?: string | null; amsDocId?: number; fileName?: string } | null>(null)  // reference doc open in the right pane
  const [rightTab, setRightTab] = useState<'chat' | 'review' | 'comments' | 'activity'>('chat')  // right-pane tab
  // Decided rounds of mine already looked at in the Activity tab (per draft, this browser only).
  const [seenRounds, setSeenRounds] = useState<number[]>([])
  // Comments on passages (drafting/comments.py), and a passage picked with Comment, waiting for text.
  const [comments, setComments] = useState<DraftComments | null>(null)
  const [pendingComment, setPendingComment] = useState<PendingComment | null>(null)
  const [reviewTopH, setReviewTopH] = useState(220)  // px height of Consistency panel in Review tab
  const [riskMap, setRiskMap] = useState<RiskMap>({})
  const [confirmRedraft, setConfirmRedraft] = useState(false)  // inline confirm toggle
  const [redrafting, setRedrafting] = useState(false)
  // Draggable side-pane widths (persisted).
  const [leftW, setLeftW] = useState(() => Number(localStorage.getItem('pp_editor_left_w')) || 244)
  const [rightW, setRightW] = useState(() => Number(localStorage.getItem('pp_editor_right_w')) || 300)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [dlAnchor, setDlAnchor] = useState<HTMLElement | null>(null)   // Download panel anchor (PDF / Word / redline)
  const loadedRef = useRef(false)   // seeded the editor once
  const citationsRef = useRef<Record<number, Citation>>({})  // blockId → citation (for the [N] markers)
  const suppressRef = useRef(false) // ignore the update fired by programmatic setContent

  const editor = useEditor({
    editable: true,
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ document: false }),
      ClauseDocument,
      Clause.configure({
        getCitation: (id: number) => citationsRef.current[id],
        // A citation opens its source document; a drafting file link (…/file/?name=) has a print view
        // next to it (…/preview/), so a Word source shows its letterhead and layout too.
        onCite: (url: string, name?: string) => {
          const preview = /\/file\/(\?.*)?$/.test(url) ? url.replace(/\/file\/(\?.*)?$/, '/preview/?name=preview.pdf') : null
          setRefDoc({ name: name || 'Reference document', url, preview }); setRightW(w => Math.max(w, 440))
        },
      }),
      Placeholder,
      EditHighlight,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      // Tables from templates, samples and imported files stay tables (not lines of text).
      TableKit.configure({ table: { resizable: false } }),
      ParagraphStyle,
      Search,
      PlaceholderHighlight,
      RiskHighlight,
      CommentHighlight,
    ],
    content: '',
    onUpdate: ({ editor }) => {
      if (!suppressRef.current) setDirty(true)
      setBlankCount(editor.getText().match(BLANK_RE)?.length ?? 0)
      // Placeholder fields come from the placeholder nodes (one field per label), and from blanks in
      // clause headings ("IN THE COURT OF [[Court Name]], CHENNAI": services/headings.py).
      const map = new Map<string, string>()
      editor.state.doc.descendants(node => {
        if (node.type.name === 'placeholder') {
          const l = node.attrs.label as string
          if (!map.has(l)) map.set(l, (node.attrs.value as string) || '')
        }
        if (node.type.name === 'clause') {
          for (const m of ((node.attrs.heading as string) || '').matchAll(/\[\[([^\]]+)\]\]/g)) {
            const l = m[1].trim()
            if (!map.has(l)) map.set(l, headingFill.current[l] || '')
          }
        }
      })
      setPlaceholders(Array.from(map, ([label, value]) => ({ label, display: humanize(label), value })))
    },
    onSelectionUpdate: ({ editor }) => {
      const $from = editor.state.selection.$from
      for (let d = $from.depth; d > 0; d--) {
        const n = $from.node(d)
        if (n.type.name === 'clause') { setFocusedId(Number(n.attrs.blockId)); return }
      }
      setFocusedId(null)
    },
  })

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(fetchSession, 3000)
  }

  const fetchSession = async () => {
    if (!sessionId) return
    try {
      const data = await draftingApi.getSession(Number(sessionId))
      setSession(data)
      if (data.review && !data.review.isOwner && !reviewOpened.current) {
        reviewOpened.current = true
        setPreview(true)
      }
      if (data.status === 'ready' || data.status === 'failed') {
        if (pollRef.current) clearInterval(pollRef.current)
        setRedrafting(false)   // re-draft finished — drop the "Re-drafting…" screen
      }
    } catch {
      setError('Failed to load draft session.')
      if (pollRef.current) clearInterval(pollRef.current)
      setRedrafting(false)
    }
  }

  // ONLYOFFICE as the editor (docs/ONLYOFFICE_PLAN.md): when the server has it switched on, the Word
  // file is edited there and saved back by ONLYOFFICE itself; the TipTap editor stays unused.
  const [office, setOffice] = useState<OnlyOfficeSetup | null>(null)
  // Changes made since PactPro last stored the document (the editor keeps them on its own server as
  // they are typed; PactPro's Save, Download, Submit or closing the draft store them).
  const [officeDirty, setOfficeDirty] = useState(false)
  // The editor's own Save / Ctrl+S / autosave keeps the edits safe as a working copy; only PactPro's Save makes a
  // version (docs/DESKTOP_EDITING.md). `officeSafe`: the unsaved edits are already kept (shown next to Save).
  const [officeSafe, setOfficeSafe] = useState(false)
  // Desktop editing (docs/DESKTOP_EDITING.md): where Save goes, and opening the draft in Word / LibreOffice.
  // 'closing': the PactPro editor is closed and its session ending (a desktop lock waits for that);
  // 'ready': free to open on the desktop; 'away': opened there (back here reloads the editor).
  const saveChoice = useSaveChoice()
  const openWith = useOpenWith()
  const [desktop, setDesktop] = useState<null | 'closing' | 'ready' | 'away'>(null)
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null)   // the top bar's "More" menu
  // Lisa's changes for an ONLYOFFICE draft go to the server; ones arriving together ("Apply all") are sent
  // as one request, and requests never overlap, so they can't overwrite each other.
  const officeQueue = useRef<{ before: string; after: string }[]>([])
  const officeTimer = useRef<number | null>(null)
  const officeChain = useRef<Promise<void>>(Promise.resolve())
  // A save from the editor itself (its Save, Ctrl+S, closing) also turns PactPro's button to "Saved".
  const officeVersion = useCallback(() => draftingApi.officeVersion(Number(sessionId)), [sessionId])
  const officeStored = useCallback(() => { setOfficeDirty(false); toast.success('Saved.'); fetchSession() },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchSession reads the current session id
    [sessionId])
  useStoredVersionWatch(officeVersion, !!office && officeDirty, officeStored)
  const sessionReady = session?.status === 'ready'
  useEffect(() => {
    if (!sessionId || !sessionReady) return
    let gone = false
    draftingApi.getOnlyOffice(Number(sessionId))
      .then(s => {
        if (gone) return
        // Start loading the editor's script right away, while the page lays out (faster open).
        if (s.enabled) loadOnlyOfficeApi(s.url).catch(() => { /* the editor shows the error */ })
        setOffice(s.enabled ? s : null)
        // Own edits not saved to PactPro yet: the editor opens them, and Save is there to keep them.
        if (s.enabled && s.pendingWork) { setOfficeDirty(true); setOfficeSafe(true) }
      })
      .catch(() => { if (!gone) setOffice(null) })
    return () => { gone = true }
  }, [sessionId, sessionReady])

  // Placeholders of the Word file (phase 2): typed here, written into the file when the field is left;
  // the editor then reloads with the filled document (its key changed).
  const [officeBlanks, setOfficeBlanks] = useState<OfficeBlank[]>([])
  const [officeValues, setOfficeValues] = useState<Record<string, string>>({})
  const [officeFilling, setOfficeFilling] = useState(false)
  const officeKey = (office?.config.document as { key?: string } | undefined)?.key
  useEffect(() => {
    if (!sessionId || !officeKey) return
    let gone = false
    draftingApi.getOfficePlaceholders(Number(sessionId))
      .then(list => { if (!gone) setOfficeBlanks(list) })
      .catch(() => { if (!gone) setOfficeBlanks([]) })
    return () => { gone = true }
  }, [sessionId, officeKey])
  const officeRef = useRef<OfficeEditorHandle>(null)
  // Finalise (lock the approved text) / Reopen, and the archival PDF/A.
  const [finalising, setFinalising] = useState(false)
  const toggleFinal = async (lock: boolean) => {
    if (!office) return
    setFinalising(true)
    try {
      const r = lock ? await draftingApi.finaliseOffice(Number(sessionId)) : await draftingApi.reopenOffice(Number(sessionId))
      setOffice({ ...office, config: r.config, final: r.final, canFinalise: r.canFinalise, role: lock ? 'view' : 'decide' })
      setOfficeDirty(false)
      toast.success(lock ? 'Finalised: the draft is locked.' : 'Reopened for editing.')
    } catch (e) {
      toast.error(errorMessage(e, lock ? 'Could not finalise the draft.' : 'Could not reopen the draft.'))
    } finally {
      setFinalising(false)
    }
  }
  const [pdfaBusy, setPdfaBusy] = useState(false)
  const downloadPdfa = async () => {
    setPdfaBusy(true)
    try {
      const { blob, filename } = await draftingApi.officePdfa(Number(sessionId))
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = filename
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href)
    } catch (e) {
      toast.error(errorMessage(e, 'Could not make the PDF/A file.'))
    } finally {
      setPdfaBusy(false)
    }
  }
  // The editor's Compare > "Document from storage": an earlier version of this draft, or a Word file
  // returned by the client / the other side. The editor shows the differences as tracked changes.
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareVersions, setCompareVersions] = useState<{ version: number; created: string; name: string }[]>([])
  const [comparing, setComparing] = useState(false)
  const openOfficeCompare = () => {
    setCompareOpen(true)
    draftingApi.getOfficeHistory(Number(sessionId)).then(h => {
      const items = ((h as { history?: { version: number; created: string; user?: { name?: string } }[] }).history || [])
      setCompareVersions(items.map(v => ({ version: v.version, created: v.created, name: v.user?.name || '' })).reverse())
    }).catch(() => setCompareVersions([]))
  }
  const compareWith = async (source: { version: number } | File) => {
    setComparing(true)
    try {
      officeRef.current?.compareWith(await draftingApi.compareSource(Number(sessionId), source))
      setCompareOpen(false)
    } catch (e) {
      toast.error(errorMessage(e, 'Could not open that document for comparison.'))
    } finally {
      setComparing(false)
    }
  }
  // PactPro's Save for the Word document: the editor stores it in PactPro now, as a new version.
  const [officeSaving, setOfficeSaving] = useState(false)
  const saveOffice = async (force = false) => {
    const choice = await saveChoice.ask(force)
    if (!choice) return
    setOfficeSaving(true)
    try {
      // The editor's text reaches the file only by a save, so a copy alone still stores it first.
      // Only "Save to PactPro" makes a version; a copy alone takes what is on screen without one.
      if (choice.pactpro) {
        await draftingApi.saveOffice(Number(sessionId))
        setOfficeDirty(false)
        await fetchSession()
      }
      if (choice.copy) {
        // The download is what is on screen (unsaved edits via the working copy, no version).
        const { blob, filename } = await draftingApi.exportDocx(Number(sessionId), false, 'docx')
        saveBlob(blob, filename)
      }
      toast.success(choice.pactpro ? 'Saved.' : 'Copy saved to this computer.')
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save the document.'))
    } finally {
      setOfficeSaving(false)
    }
  }
  // "Open on desktop": save, close the PactPro editor, wait for its session to end, then offer the desktop
  // editor (a click, so the browser lets the page start it).
  const closeForDesktop = async () => {
    if (!sessionId) return
    try {
      // Unsaved edits go to the working copy (not a version); the desktop editor opens that.
      if (officeDirty) await draftingApi.saveOfficeWork(Number(sessionId))
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save the document.'))
      return
    }
    setDesktop('closing')
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1500))
      if (!(await draftingApi.officeEditing(Number(sessionId)).catch(() => false))) break
    }
    setDesktop('ready')
  }
  const backToEditor = () => {
    setDesktop(null)
    draftingApi.getOnlyOffice(Number(sessionId)).then(s => setOffice(s.enabled ? s : null))
      .catch(() => { /* keeps the previous setup */ })
    fetchSession()
  }
  // Desktop edits saved to PactPro (DesktopEditsBar): back to the PactPro editor on the new version.
  const backRef = useRef(backToEditor)
  backRef.current = backToEditor
  useEffect(() => {
    const onSaved = (e: Event) => {
      const d = (e as CustomEvent<{ kind: string; id: number }>).detail
      if (d?.kind === 'draft' && d.id === Number(sessionId)) backRef.current()
    }
    window.addEventListener(DESKTOP_SAVED_EVENT, onSaved)
    return () => window.removeEventListener(DESKTOP_SAVED_EVENT, onSaved)
  }, [sessionId])
  const openOnDesktop = () => {
    void openWith.openDocument('draft', Number(sessionId), backToEditor).then(() => setDesktop(d => (d === 'ready' ? 'away' : d)))
  }
  // "Apply to document": every value typed so far, written in one go. With the connector (paid
  // editions) straight into the open document; otherwise on the server, one version, one editor reload.
  // Changed values only: a form field may be changed (or emptied); a [[Label]] text blank needs a value.
  const officeReady = Object.entries(officeValues).filter(([label, v]) => {
    const blank = officeBlanks.find(b => b.label === label)
    if (!blank) return false
    return blank.kind === 'field' ? v.trim() !== (blank.value || '') : !!v.trim()
  })
  const applyOfficeBlanks = async () => {
    if (!office || officeFilling || officeReady.length === 0) return
    setOfficeFilling(true)
    const values = Object.fromEntries(officeReady.map(([label, v]) => [label, v.trim()]))
    try {
      // On the server (form fields and [[Label]] text alike), one version and one editor reload.
      const res = await draftingApi.fillOfficePlaceholders(Number(sessionId), values)
      setOffice({ ...office, config: res.config })
      setOfficeDirty(false)
      setOfficeValues(v => Object.fromEntries(Object.entries(v).filter(([label]) => !(label in values))))
      const n = Object.keys(values).length
      toast.success(`Applied ${n} placeholder${n > 1 ? 's' : ''} to the document.`)
    } catch (e) {
      toast.error(errorMessage(e, 'Could not apply the placeholders.'))
    } finally {
      setOfficeFilling(false)
    }
  }

  useEffect(() => {
    fetchSession()
    startPolling()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const loadRounds = useCallback(() => {
    if (!sessionId) return
    draftingApi.getRounds(Number(sessionId)).then(setRounds).catch(() => setRounds([]))
    draftingApi.getReviewRequests(Number(sessionId)).then(setRequests).catch(() => setRequests([]))
    draftingApi.getComments(Number(sessionId)).then(setComments).catch(() => setComments(null))
  }, [sessionId])
  useEffect(() => { loadRounds() }, [loadRounds])

  // While a review is going on, someone else may change the draft. Check every 30 s and offer a
  // reload; never reload by itself, so nobody loses what they are typing.
  const [staleDraft, setStaleDraft] = useState(false)
  // A save refused because someone else changed the same clause(s) meanwhile: their headings.
  const [conflict, setConflict] = useState<string[] | null>(null)
  const [showImport, setShowImport] = useState(false)   // "Import changes" dialog
  const loadedPrint = useRef('')
  const blocksPrint = (blocks: { id: number; heading?: string; content_html?: string }[] = []) =>
    JSON.stringify(blocks.map(b => [b.id, b.heading, b.content_html]))
  useEffect(() => { loadedPrint.current = blocksPrint(session?.blocks); setStaleDraft(false) }, [session])
  const reviewGoingOn = rounds.some(r => r.status === 'open') || requests.some(r => r.status === 'open')
    || !!session?.access?.request
  useEffect(() => {
    if (!sessionId || !reviewGoingOn) return
    const t = setInterval(() => {
      if (document.hidden) return
      draftingApi.getSession(Number(sessionId)).then(fresh => {
        if (blocksPrint(fresh.blocks) !== loadedPrint.current) setStaleDraft(true)
      }).catch(() => {})
      loadRounds()
    }, 30000)
    return () => clearInterval(t)
  }, [sessionId, reviewGoingOn, loadRounds])
  const reloadStale = () => {
    if (dirty && !window.confirm('Reloading drops the edits you have not saved or sent. Reload anyway?')) return
    reloadDraft()
  }

  // Seed the editor once the draft is ready (don't clobber edits on later polls).
  useEffect(() => {
    if (editor && session?.status === 'ready' && !loadedRef.current && (session.blocks?.length ?? 0) > 0) {
      citationsRef.current = buildCitations(session.blocks)  // ready before the NodeViews render
      suppressRef.current = true
      editor.commands.setContent(buildContentHtml(session.blocks, pageTitle()))
      suppressRef.current = false
      loadedRef.current = true
      setDirty(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeds once (loadedRef); resolveDocTitle is re-created every render
  }, [editor, session])

  // Underline the verbatim excerpts that playbook findings point at (omission
  // findings, whose quote isn't in the text, produce no underline — the gutter
  // shield marks those clauses instead).
  useEffect(() => {
    if (!editor) return
    const quotes = Object.values(riskMap)
      .flatMap(info => info.findings.map(f => f.quote))
      .filter(q => q && q.trim().length >= 4)
    editor.commands.setRiskQuotes(quotes)
  }, [editor, riskMap])

  // Mark the passages open comments are about.
  useEffect(() => {
    if (!editor) return
    editor.commands.setCommentQuotes((comments?.threads ?? []).filter(t => !t.resolved && t.quote).map(t => t.quote))
  }, [editor, comments])

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const triggerRedraft = async () => {
    setRedrafting(true)
    setConfirmRedraft(false)
    setError('')
    try {
      await draftingApi.regenerateSession(Number(sessionId))
      // Reset so the editor re-seeds with the fresh blocks when ready.
      loadedRef.current = false
      setDirty(false)
      setRefDoc(null)
      // Optimistically flip to a generating state so the full-screen
      // "Re-drafting…" spinner shows immediately (don't wait for the 3s poll).
      setSession(s => (s ? { ...s, status: 'generating', blocks: [] } : s))
      // Polling was stopped when the previous draft became ready — restart it
      // so pending → generating → ready is picked up and the new result renders.
      startPolling()
      fetchSession()
      // `redrafting` stays true until fetchSession sees status ready/failed.
    } catch {
      setError('Failed to start re-draft. Try again.')
      setRedrafting(false)
    }
  }

  // Persist the pane widths.
  useEffect(() => { localStorage.setItem('pp_editor_left_w', String(leftW)) }, [leftW])
  useEffect(() => { localStorage.setItem('pp_editor_right_w', String(rightW)) }, [rightW])

  // Drag a gutter to resize a side pane (left grows with the cursor; right grows
  // as the cursor moves left).
  const startDrag = (side: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX, startLeft = leftW, startRight = rightW
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      if (side === 'left') setLeftW(clamp(startLeft + dx, 180, 460))
      else setRightW(clamp(startRight - dx, 220, 720))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''; document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // The editor's clauses as {id, heading, content_html, text}, for saving or suggesting.
  const collectBlocks = () => {
    if (!editor) return []
    // Edit highlights persist through Save (they round-trip via <span data-edit-hl>);
    // they're only stripped from the downloaded PDF/Word.
    const serializer = DOMSerializer.fromSchema(editor.schema)
    const updates: { id: number; heading: string; content_html: string; text: string }[] = []
    const title = pageTitle()
    const stored = new Map((session?.blocks ?? []).map(b => [b.id, b.heading || '']))
    editor.state.doc.forEach(node => {
      if (node.type.name !== 'clause' || node.attrs.blockId == null) return
      const div = document.createElement('div')
      div.appendChild(serializer.serializeFragment(node.content))
      const id = Number(node.attrs.blockId)
      // The editor hides a heading that only repeats the document title (displayHeading).
      // Write the stored one back, or saving would delete the title for good.
      const prev = stored.get(id) || ''
      const hidden = !node.attrs.heading && prev && displayHeading(prev, title) === ''
      updates.push({
        id,
        heading: hidden ? prev : ((node.attrs.heading as string) || ''),
        content_html: div.innerHTML,
        text: node.textBetween(0, node.content.size, '\n', phLeafText),
      })
    })
    return updates
  }

  // Who may do what (drafting/access.py via session.access); older servers send no access block.
  const access = session?.access ?? null
  const canEditDirect = access ? access.canWrite : (!session?.review || session.review.isOwner || session.review.canEdit)
  const canSuggest = !!access?.canSuggest
  // A suggest-only reviewer always suggests; one who may also edit chooses with the toggle.
  const suggesting = canSuggest && (!canEditDirect || suggestMode)

  // Reload the draft from the server and re-seed the editor (after suggestions or a finished review).
  const reloadDraft = async () => {
    if (!sessionId) return
    const fresh = await draftingApi.getSession(Number(sessionId))
    loadedRef.current = false
    setSession(fresh)
    setDirty(false)
  }

  // Suggest mode: the edits go to the owner as suggestions; the draft itself is not changed.
  const sendSuggestions = async () => {
    if (!editor || !sessionId) return
    setSaving(true); setError('')
    try {
      await draftingApi.suggest(Number(sessionId), collectBlocks())
      await reloadDraft()
      loadRounds()
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error
        || 'Could not send the suggestions. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // The requested reviewer hands the draft back (their direct corrections reach the owner as a round).
  const finishRequestedReview = async () => {
    const req = session?.access?.request
    if (!req) return
    if (dirty && !suggesting && !(await save())) return
    if (dirty && suggesting) { setError('Send your suggestions first, then click Done reviewing.'); return }
    setReviewDone(true); setError('')
    try {
      await draftingApi.reviewRequestDone(req.id)
      await reloadDraft()
      loadRounds()
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not finish the review.')
    } finally {
      setReviewDone(false)
    }
  }
  const cancelRequest = async (id: number) => {
    try { await draftingApi.cancelReviewRequest(id); loadRounds() } catch { setError('Could not cancel the request.') }
  }

  // Returns false if the save failed (so an export can stop instead of using stale content).
  const save = async (): Promise<boolean> => {
    if (!editor || !sessionId) return false
    if (suggesting) {
      // Not saved as the draft: unsent suggestions stay in the editor until sent.
      setError('Send your suggestions first (or discard them by reloading the page).')
      return false
    }
    const updates = collectBlocks()
    const base = Object.fromEntries((session?.blocks ?? []).filter(b => b.rev).map(b => [b.id, b.rev as string]))
    setSaving(true); setError(''); setConflict(null)
    try {
      const fresh = await draftingApi.saveBlocks(Number(sessionId), updates, base)
      // Someone else's changes to other clauses were kept: re-seed the editor so it shows them
      // (otherwise the next save would send this copy's older wording of those clauses).
      if (fresh.merged) {
        loadedRef.current = false
        toast.info('Saved. Changes a colleague made to other clauses are now shown too.')
      }
      setSession(fresh)
      setDirty(false)
      return true
    } catch (e) {
      const data = (e as { response?: { status?: number; data?: { conflicts?: string[] } } })?.response
      if (data?.status === 409) setConflict(data.data?.conflicts ?? [])
      else setError('Could not save changes — please try again.')
      return false
    } finally {
      setSaving(false)
    }
  }

  // The document's display title: user-entered title → the agreement's OWN title from the
  // generated content (e.g. "MUTUAL NON-DISCLOSURE AGREEMENT") → the template name (hidden in
  // Mode 3) → the document type upper-cased (never a bare lower-case code like "nda"). Shared by
  // the editor heading, the exports and the filename; the matching line is stripped from the body.
  const resolveDocTitle = () =>
    (session?.facts?.document_title || '').trim()
    || extractDocTitle(session?.blocks)
    || (session?.mode === 'library' ? '' : (session?.template_name || ''))
    || (session?.document_type ? session.document_type.toUpperCase() : '')

  // The title the page shows above the clauses. A draft from a Word template / sample has none: the
  // template's own title is its first clause heading (as in the download), so nothing is shown twice
  // and no clause heading is hidden for repeating it.
  const pageTitle = () => (session?.word_form ? '' : resolveDocTitle())

  // Build the export document HTML (title + each clause) from the live editor
  // (falling back to saved blocks). Shared by the Word and PDF exports.
  const buildExportBody = () => {
    const dTitle = pageTitle()
    const parts: string[] = []
    if (dTitle) parts.push(`<h1>${escText(dTitle)}</h1>`)
    if (editor) {
      const serializer = DOMSerializer.fromSchema(editor.schema)
      editor.state.doc.forEach(node => {
        if (node.type.name !== 'clause') return
        const heading = (node.attrs.heading as string) || ''
        const hCss = headingStyleCss(node.attrs.headingStyle as Record<string, unknown> | null)
        const div = document.createElement('div')
        div.appendChild(serializer.serializeFragment(node.content))
        parts.push((heading ? `<h3${hCss ? ` style="${hCss}"` : ''}>${escText(heading)}</h3>` : '') + div.innerHTML)
      })
    } else {
      (session?.blocks || []).forEach(b => {
        const hCss = headingStyleCss(b.style_json?.heading)
        parts.push((b.heading ? `<h3${hCss ? ` style="${hCss}"` : ''}>${escText(b.heading)}</h3>` : '')
          + (b.content_html?.trim() ? sanitizeHtml(b.content_html) : textToHtml(stripDocTitle(stripLeadingHeading(b.text, b.heading || ''), dTitle))))
      })
    }
    return stripEditHl(parts.join('\n'))
  }

  // Drawn shapes in the Word source (wordform._drawings): kept by Download, not drawable in the editor.
  const shapeCount = (session?.blocks || []).reduce((n, b) => n + (b.style_json?.src?.shapes || 0), 0)

  const exportName = () =>
    ((resolveDocTitle() || 'draft')
      .replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'draft')

  // Save to AMS / Submit to task: saves pending edits, then the server renders the
  // .docx and files it on the AMS case (and task). Unlinked drafts pick a case first.
  const [sendingAms, setSendingAms] = useState(false)
  const [pickAmsCase, setPickAmsCase] = useState(false)
  // The senior's review of the AMS task this draft belongs to (changes requested / approved).
  const [amsTask, setAmsTask] = useState<AmsTaskReview | null>(null)
  const hasAmsTask = !!session?.ams_task_id
  const review = session?.review ?? null
  // Anyone but the owner: a task's reviewer, or a colleague who was asked to review (access.request).
  const isReviewer = (!!review && !review.isOwner) || (!!session?.access && !session.access.isOwner)
  // ONLYOFFICE drafts: occasional actions in one "More" menu, so the top bar fits on one line.
  const officeMore: MenuItem[] = !office ? [] : [
    ...(office.role !== 'view' ? [{ label: 'Save options…', icon: 'check' as const, meta: 'PactPro / this computer',
      onClick: () => void saveOffice(true) }] : []),
    ...(office.canFinalise ? [office.final
      ? { label: 'Reopen for editing', icon: 'edit' as const, onClick: () => void toggleFinal(false) }
      : { label: 'Finalise (lock the text)', icon: 'check' as const, onClick: () => void toggleFinal(true) }] : []),
    { label: 'PDF/A for filing', icon: 'download' as const, onClick: () => void downloadPdfa() },
    ...(!isReviewer ? ['-' as const,
      { label: 'Re-draft…', icon: 'refresh' as const, danger: true, meta: 'regenerate with the same inputs',
        onClick: () => setConfirmRedraft(true) }] : []),
  ]
  // Approve / request changes from the editor (backend: workspace/review.py).
  const submitReview = async (action: 'approve' | 'request_changes', note = '') => {
    if (!review) return
    setReviewing(true); setError('')
    try {
      await amsApi.post(`/api/workspace/tasks/${review.taskId}/review`, { action, note })
      setAskChanges(false)
      setPreview(true)
      await fetchSession()
      loadRounds()
    } catch (e) {
      setError(errorMessage(e, 'Could not record the review.'))
    } finally {
      setReviewing(false)
    }
  }
  useEffect(() => {
    if (!hasAmsTask || !sessionId) return
    draftingApi.getAmsTask(Number(sessionId)).then(setAmsTask).catch(() => setAmsTask(null))
  }, [hasAmsTask, sessionId])
  // Resubmitting after changes were requested asks what was changed, so the
  // reviewer gets the author's own account alongside the automatic diff.
  const [askResubmit, setAskResubmit] = useState(false)
  const [resubmitNote, setResubmitNote] = useState('')
  const [showChanges, setShowChanges] = useState(false)
  const submitToTask = () => {
    if (amsTask?.needsReview && amsTask.reviewStatus === 'CHANGES_REQUESTED') {
      setResubmitNote(''); setAskResubmit(true)
    } else {
      sendToAms()
    }
  }
  const sendToAms = async (caseId?: number, note?: string) => {
    if (!sessionId) return
    if (!session?.case_id && !caseId) { setPickAmsCase(true); return }
    setPickAmsCase(false)
    if (dirty && !(await save())) return
    setSendingAms(true); setError('')
    try {
      const r = await draftingApi.sendToAms(Number(sessionId), caseId, note)
      setAskResubmit(false)
      setSession(prev => prev && ({
        ...prev, case_id: r.amsCaseId, ams_document_id: r.documentId,
        ams_document_version: r.version, ams_synced_at: r.syncedAt,
      }))
      if (r.reviewStatus) setAmsTask(prev => prev && ({ ...prev, reviewStatus: r.reviewStatus }))
      loadRounds()
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error
      setError(msg || 'Could not save to PactPro — your draft is safe here; please try again.')
    } finally {
      setSendingAms(false)
    }
  }
  const amsSyncedLabel = session?.ams_synced_at
    ? `${amsTask?.reviewStatus === 'SUBMITTED' ? 'Submitted for review' : 'Saved to PactPro'}`
      + `${session.ams_document_version ? ` · v${session.ams_document_version}` : ''} · `
      + new Date(session.ams_synced_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : ''

  // Word: a real .docx rendered by the server from the SAVED draft, so unsaved edits
  // are saved first. `branding` = on the AMS letterhead (AMS-linked accounts only).
  const [exporting, setExporting] = useState(false)
  const [showRedline, setShowRedline] = useState(false)
  const [redlineLetterhead, setRedlineLetterhead] = useState(false)
  // PDF goes the same way (the Word file converted on the server), so both match.
  const downloadDocx = async (branding = false, format: 'docx' | 'pdf' = 'docx') => {
    if (!sessionId) return
    if (dirty && !(await save())) return
    setExporting(true); setError('')
    try {
      const { blob, filename } = await draftingApi.exportDocx(Number(sessionId), branding, format)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = filename
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href)
    } catch (e) {
      // No LibreOffice on this server: fall back to the browser's print dialog.
      if (format === 'pdf' && (e as { response?: { status?: number } })?.response?.status === 503) printPdf()
      else setError(`Could not create the ${format === 'pdf' ? 'PDF' : 'Word file'} — please try again.`)
    } finally {
      setExporting(false)
    }
  }

  // Compare against the current draft: save unsaved edits first, so "now" is what's on screen.
  const openCompare = async (from?: number) => {
    if (dirty && !(await save())) return
    setCompare({ from })
  }
  // The redline of what the compare view shows, as Word or PDF.
  const downloadRedline = async (from: number, to: number | undefined, format: 'docx' | 'pdf') => {
    if (!sessionId) return
    setError('')
    try {
      const r = await draftingApi.exportRedline(Number(sessionId), from, to, false, format)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(r.blob); a.download = r.filename
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href)
    } catch (e) {
      setError((e as { response?: { status?: number } })?.response?.status === 503
        ? 'PDF is not available on this server. Download the Word redline instead.'
        : 'Could not create the redline. Please try again.')
    }
  }

  // Fallback PDF: render into a hidden iframe and open the browser's print dialog
  // (defaults to "Save as PDF") — vector, selectable text, proper pagination.
  const printPdf = () => {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
    document.body.appendChild(iframe)
    const win = iframe.contentWindow
    if (!win) { iframe.remove(); return }
    win.document.open()
    win.document.write(`<html><head><meta charset="utf-8"><title>${escText(exportName())}</title>`
      + `<style>${PRINT_CSS}</style></head><body>${buildExportBody()}</body></html>`)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); setTimeout(() => iframe.remove(), 1000) }, 250)
  }

  // Apply an accepted chat edit to the editor: replace the target clause node's
  // body with the new text, wrapping the CHANGED words in a green highlight so the
  // lawyer can see what was altered. Marks the doc dirty so it can be Saved.
  const applyInOffice = async (beforeText: string, afterText: string) => {
    const all = (session?.blocks ?? []).map(b => b.text || '').join('\n')
    const edits = editsFor(beforeText, afterText, all)
    const ed = officeRef.current
    const fail = () => toast.warning('Couldn\'t place this change in the document automatically. Copy the new text into the clause.')
    if (!ed?.live()) {
      // No connector (Community edition): the server writes it into the Word file as a tracked change by
      // "PactPro AI", and the editor reloads with the redline.
      if (!office) return
      officeQueue.current.push({ before: beforeText, after: afterText })
      if (officeTimer.current == null) officeTimer.current = window.setTimeout(flushOfficeChanges, 0)
      return
    }
    if (!edits) { fail(); return }
    // As a tracked change: the person who decides accepts or rejects it in the document (Review tab).
    const wasTracking = await ed.setTracking(true)
    try {
      for (const e of edits) {
        if (!(await ed.replaceText(e.find, e.replace))) { fail(); return }
      }
    } finally {
      if (wasTracking === false) await ed.setTracking(false)
    }
    toast.success('Lisa\'s change is in the document as a tracked change: accept or reject it there.')
  }

  // Send the collected changes in one request, after any request still running.
  const flushOfficeChanges = () => {
    officeTimer.current = null
    const changes = officeQueue.current.splice(0)
    if (!changes.length) return
    officeChain.current = officeChain.current.then(async () => {
      try {
        const res = await draftingApi.applyOfficeMany(Number(sessionId), changes)
        setOffice(o => (o ? { ...o, config: res.config } : o))
        setOfficeDirty(false)
        const what = changes.length === 1 ? 'Lisa\'s change is' : `${res.applied} of Lisa's changes are`
        toast.success(`${what} in the document as tracked changes: accept or reject them there.`)
        if (res.skipped) {
          toast.warning(`${res.skipped} change${res.skipped === 1 ? '' : 's'} couldn't be placed (the clause changed since Lisa read it). Copy the new text in yourself.`)
        }
      } catch (e) {
        toast.warning(errorMessage(e, 'Couldn\'t place this change in the document automatically. Copy the new text into the clause.'))
      }
    })
  }
  const patchClause = (blockId: number, beforeText: string, afterText: string, heading?: string) => {
    if (office) {
      // Into the open Word document: only the words Lisa changed, so the clause keeps its formatting.
      // Tracked changes (accept / reject in the document) come in phase 3 (docs/ONLYOFFICE_PLAN.md).
      void applyInOffice(beforeText, afterText)
      return
    }
    if (!editor) return
    // Capture the filled placeholder values BEFORE patching — refine round-trips every
    // placeholder as [[Label]] (re-inserted empty), so we restore the value afterwards.
    const filled = new Map(placeholders.filter(p => p.value.trim()).map(p => [p.label, p.value]))
    let pos = -1
    editor.state.doc.descendants((node, p) => {
      if (pos >= 0) return false
      if (node.type.name === 'clause' && Number(node.attrs.blockId) === blockId) { pos = p; return false }
      return undefined
    })
    if (pos < 0) return
    const node = editor.state.doc.nodeAt(pos)
    if (!node) return
    editor.chain().focus().insertContentAt({ from: pos + 1, to: pos + node.nodeSize - 1 }, highlightedHtml(beforeText, afterText)).run()
    if (heading != null && heading !== node.attrs.heading) {
      editor.state.doc.descendants((n, p) => {
        if (n.type.name === 'clause' && Number(n.attrs.blockId) === blockId) {
          editor.chain().command(({ tr }) => { tr.setNodeMarkup(p, undefined, { ...n.attrs, heading }); return true }).run()
          return false
        }
        return undefined
      })
    }
    // Re-fill any placeholder that was re-inserted empty but had a value before.
    if (filled.size) {
      const tr = editor.state.tr
      editor.state.doc.descendants((n, p) => {
        if (n.type.name === 'placeholder' && !n.attrs.value && filled.has(n.attrs.label)) {
          tr.setNodeMarkup(p, undefined, { ...n.attrs, value: filled.get(n.attrs.label) })
        }
      })
      if (tr.docChanged) editor.view.dispatch(tr)
    }
  }

  // The editor's live clauses ({block_id, heading, text}). `phLeafText` renders a filled
  // placeholder as its value and an empty one as [[Label]] — used by the consistency
  // check (which must see real values and flag only the still-empty [[Label]] ones).
  const currentClauses = () => clausesWith(phLeafText)
  // For refine: EVERY placeholder → [[Label]] so the model can't flatten a filled one;
  // the value is restored on patch.
  const refineClauses = () => clausesWith(phTokenText)
  const clausesWith = (leaf: (n: { type?: { name?: string }; attrs?: { value?: string; label?: string } }) => string) => {
    // In ONLYOFFICE the server copies each saved file's clause text into the blocks (docfile.sync_blocks).
    if (!editor || office) return (session?.blocks ?? []).map(b => ({ block_id: b.id, heading: b.heading || '', text: b.text }))
    const out: { block_id: number; heading: string; text: string }[] = []
    editor.state.doc.forEach(node => {
      if (node.type.name !== 'clause' || node.attrs.blockId == null) return
      out.push({
        block_id: Number(node.attrs.blockId),
        heading: (node.attrs.heading as string) || '',
        text: node.textBetween(0, node.content.size, '\n', leaf),
      })
    })
    return out
  }

  // Comment button: the selected words (in Edit or Preview) and their clause become the new comment's anchor.
  const startComment = () => {
    const sel = window.getSelection()
    const quote = (sel?.toString() || '').replace(/\s+/g, ' ').trim().slice(0, 2000)
    const node = sel?.anchorNode || null
    const el = node ? (node.nodeType === 3 ? node.parentElement : node as HTMLElement) : null
    const fromSel = el?.closest('[data-block-id]')?.getAttribute('data-block-id')
    const blockId = fromSel ? Number(fromSel) : focusedId
    setPreview(false); setCompare(null); setReviewRoundId(null); setRefDoc(null)
    setPendingComment({ blockId: blockId ?? null, quote })
    setRightTab('comments')
  }
  const jumpToComment = (t: DraftCommentThread) => { if (t.block_id) scrollToClause(t.block_id) }
  const seenKey = `pp_seen_rounds_${sessionId}`
  useEffect(() => {
    try { setSeenRounds(JSON.parse(localStorage.getItem(seenKey) || '[]')) } catch { setSeenRounds([]) }
  }, [seenKey])
  // Opening the tab marks every decided round as seen.
  useEffect(() => {
    if (rightTab !== 'activity') return
    const ids = rounds.filter(r => r.status === 'finished').map(r => r.id)
    if (ids.every(id => seenRounds.includes(id))) return
    setSeenRounds(ids)
    try { localStorage.setItem(seenKey, JSON.stringify(ids)) } catch { /* private window: the badge just stays */ }
  }, [rightTab, rounds, seenRounds, seenKey])
  const openComments = () => { setPreview(false); setCompare(null); setReviewRoundId(null); setRefDoc(null); setRightTab('comments') }
  const openActivity = () => { setPreview(false); setCompare(null); setReviewRoundId(null); setRefDoc(null); setRightTab('activity') }

  // Jump to a clause from a review finding: leave Preview, scroll it into view, flash it.
  const scrollToClause = (blockId: number) => {
    if (office) { officeRef.current?.gotoClause(blockId); return }
    setPreview(false)
    requestAnimationFrame(() => {
      const el = document.querySelector(`.pp-editor-paper [data-block-id="${blockId}"]`) as HTMLElement | null
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('pp-clause-flash')
      setTimeout(() => el.classList.remove('pp-clause-flash'), 1600)
    })
  }

  // Placeholder nodes in the live document matching a label (safe attr matching,
  // no selector-escaping needed for labels with spaces/punctuation).
  const placeholderEls = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('.pp-editor-paper [data-ph-label]'))
      .filter(el => el.dataset.phLabel === label)

  // Focusing a placeholder field: scroll the document to its first occurrence,
  // flash it, and highlight EVERY occurrence of that label so multi-use fields
  // are all visible while editing.
  const focusPlaceholder = (label: string) => {
    const els = placeholderEls(label)
    els.forEach(el => el.classList.add('pp-ph-active'))
    const first = els[0]
    if (first) {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' })
      first.classList.add('pp-ph-flash')
      setTimeout(() => first.classList.remove('pp-ph-flash'), 1600)
    }
  }
  // Leaving a field: a value typed for a blank that sits in a clause heading is written into the
  // heading now (not per keystroke, which would remove the field after the first letter).
  const blurPlaceholder = (label: string) => {
    placeholderEls(label).forEach(el => el.classList.remove('pp-ph-active'))
    const value = (headingFill.current[label] || '').trim()
    if (!editor || !value) return
    const token = `[[${label}]]`
    const tr = editor.state.tr
    editor.state.doc.descendants((node, pos) => {
      const h = node.type.name === 'clause' ? ((node.attrs.heading as string) || '') : ''
      if (h.includes(token)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, heading: h.split(token).join(value) })
    })
    delete headingFill.current[label]
    if (tr.docChanged) editor.view.dispatch(tr)
  }

  // Live-fill a placeholder: set the value attr on every placeholder node with this
  // label. The nodes persist, so the field stays editable in the panel.
  const setPlaceholderValue = (label: string, value: string) => {
    if (!editor) return
    // A blank in a heading: kept here while typing, written into the heading on leaving the field.
    headingFill.current[label] = value
    setPlaceholders(ps => ps.map(p => (p.label === label ? { ...p, value } : p)))
    const tr = editor.state.tr
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'placeholder' && node.attrs.label === label) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, value })
      }
    })
    if (tr.docChanged) editor.view.dispatch(tr)
  }

  if (error && !session) {
    return (
      <div className="pp-editor-fs pp-editor-center">
        <EmptyState icon="pen" title="This draft could not be opened" text={error}
          action={<button type="button" className="btn" onClick={() => navigate(DRAFTING.drafts)}>Back to drafts</button>} />
      </div>
    )
  }

  if (!session || session.status === 'pending' || session.status === 'generating') {
    const heading = redrafting
      ? 'Re-drafting your document…'
      : session?.status === 'generating' ? 'Drafting your document…' : 'Starting…'
    const sub = redrafting
      ? 'Regenerating the draft with your inputs. This replaces the previous version.'
      : 'Assembling the draft from your brief.'
    return (
      <div className="pp-editor-fs pp-editor-center">
        <div className="stack" style={{ alignItems: 'center', gap: 8, textAlign: 'center' }} role="status">
          <span className="pp-spin" style={{ width: 28, height: 28, borderWidth: 3 }} aria-hidden="true" />
          <h2 className="serif" style={{ fontSize: 'var(--t-xl)', marginTop: 8 }}>{heading}</h2>
          <p className="muted small">{sub}</p>
        </div>
      </div>
    )
  }

  if (session.status === 'failed') {
    return (
      <div className="pp-editor-fs pp-editor-center">
        <EmptyState icon="pen" title={`Draft #${session.id} failed`}
          text="Draft generation failed. Try again. If it keeps failing, make sure your documents finished processing."
          action={<div className="row" style={{ gap: 8, justifyContent: 'center' }}>
            <button type="button" className="btn" onClick={() => navigate(DRAFTING.drafts)}>Back to drafts</button>
            <Button variant="primary" icon="refresh" loading={redrafting} disabled={redrafting} onClick={triggerRedraft}>Re-draft</Button>
          </div>} />
      </div>
    )
  }

  const title = session.mode === 'library'
    ? (session.document_type || 'Draft Document')
    : (session.template_name ?? 'Draft Document')
  // The document's own title heading (same resolution as the exports).
  const docTitle = resolveDocTitle()
  const shownTitle = pageTitle()
  // Count still-to-fill: empty placeholder fields + any legacy ______ blanks.
  const toFill = placeholders.filter(p => !p.value.trim()).length + blankCount
  const canEdit = canEditDirect
  // Review rounds that hold up the task loop (drafting/task_review.py enforces the same).
  const openRounds = rounds.filter(r => r.status === 'open')
  const suggestionsToDecide = openRounds.some(r => r.can_decide && r.kind === 'suggestions' && !r.binding)
  const approveBlocked = openRounds.some(r => !r.binding && (r.can_decide || r.mine)) || (comments?.open ?? 0) > 0

  // Task review notices for the author already take the bar's place.
  const taskBar = !isReviewer && !!amsTask?.needsReview && ['CHANGES_REQUESTED', 'APPROVED'].includes(amsTask.reviewStatus || '')
  const toDecide = openRounds.filter(r => r.can_decide)
  const myOpenRequests = access?.isOwner ? requests.filter(r => r.status === 'open') : []
  const barItems: { tone: string; icon: IconName; text: ReactNode; hint?: string; action: ReactNode }[] = []
  for (const r of toDecide) {
    barItems.push({ tone: 'info', icon: 'chat', hint: r.note || undefined,
      text: <><strong>{roundTitle(r)}</strong> · {r.binding ? `${r.pending} of ${r.changes} to acknowledge or query` : `${r.pending} of ${r.changes} to decide`}</>,
      action: <button type="button" className="btn sm primary" onClick={() => { setCompare(null); setReviewRoundId(r.id) }}>Review</button> })
  }
  if (access?.request) {
    barItems.push({ tone: 'info', icon: 'users', hint: access.request.note || undefined,
      text: <><strong>{session?.created_by_name || 'A colleague'}</strong> asked you to review
        {access.request.authority === 'binding' ? ` · you ${POWER.binding}` : ''}
        {access.request.note && <span className="muted"> · "{access.request.note}"</span>}</>,
      action: <Button size="sm" variant="primary" icon="check" loading={reviewDone} disabled={reviewDone}
        title="Hand the draft back to its author" onClick={finishRequestedReview}>Done reviewing</Button> })
  }
  for (const r of myOpenRequests) {
    barItems.push({ tone: '', icon: 'users', hint: r.note || undefined,
      text: <>With <strong>{r.reviewer_name || 'a colleague'}</strong> for review{r.authority === 'binding' ? ' (can correct)' : ''}</>,
      action: <button type="button" className="btn ghost sm" onClick={() => cancelRequest(r.id)}>Cancel request</button> })
  }
  const reviewBar = barItems.length ? { ...barItems[0], more: barItems.length - 1 } : null
  // Activity tab badge: changes waiting for me, plus my decided rounds not looked at yet.
  const unseenDone = rounds.filter(r => r.mine && !r.external_from && r.status === 'finished' && !seenRounds.includes(r.id))
  const activityBadge = toDecide.length + unseenDone.length

  // Save to case / Submit to task with empty fields asks first: "Go back and fill"
  // jumps to the first empty field; "Save anyway" files it as it is (a partial
  // draft can be filed deliberately, e.g. for a senior to finish).
  const fileOrSubmit = () => (session?.ams_task_id ? submitToTask() : sendToAms())
  const focusFirstEmpty = () => {
    setPreview(false)
    requestAnimationFrame(() => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('aside[aria-label="Placeholders and references"] input'))
      const first = inputs.find(i => !i.value.trim())
      first?.focus()
      first?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }
  const saveToCaseClick = () => {
    if (toFill === 0) { fileOrSubmit(); return }
    const empty = placeholders.filter(p => !p.value.trim()).map(p => p.display)
    const named = empty.slice(0, 3).join(', ')
    const more = toFill - Math.min(empty.length, 3)
    const toTask = !!session?.ams_task_id
    confirm({
      title: `This draft still has ${toFill} empty field${toFill === 1 ? '' : 's'}`,
      message: <>
        {named ? <><b>{named}</b>{more > 0 ? ` and ${more} more` : ''} {empty.length + (more > 0 ? more : 0) === 1 ? 'is' : 'are'} still blank. </> : 'Some blanks are still unfilled. '}
        {toTask ? 'The draft goes to the reviewer as it is.' : 'A draft saved with blanks goes to the case as it is.'}
      </>,
      cancelLabel: 'Go back and fill',
      confirmLabel: toTask ? 'Submit anyway' : 'Save anyway',
      accept: () => { fileOrSubmit() },
      reject: focusFirstEmpty,
    })
  }

  return (
    <RiskContext.Provider value={riskMap}>
    <div className="pp-editor-fs">
      {/* Top bar */}
      <div className="ed-top">
        <button type="button" className="btn ghost sm" onClick={() => navigate(DRAFTING.drafts)}><Icon name="chevronLeft" size="sm" />Drafts</button>
        <div className="grow" style={{ minWidth: 200 }}>
          <h1 className="serif ellipsis" title={title}>{title}</h1>
          <div className="faint xs"><span className="mono">#{session.id}</span></div>
        </div>
        {toFill > 0
          ? <span title="Values left blank. Fill these in before use."><Chip tone="warn">{toFill} to fill</Chip></span>
          : placeholders.length > 0 && <Chip tone="ok">All filled</Chip>}
        {suggesting && (
          <span className="chip info" title={`Your edits go to ${session.created_by_name || 'the owner'} to accept or decline; the draft stays as it is until then. Click Send suggestions when done.`}>
            <Icon name="chat" size="sm" />Suggesting</span>
        )}
        {staleDraft && !reviewRoundId && (
          <button type="button" className="chip warn dr-chip-btn" title="Someone has updated this draft since you opened it" onClick={reloadStale}>
            <Icon name="refresh" size="sm" />Updated · Reload</button>
        )}
        {/* File on the AMS case / task (drafting/filing.py). Author only. */}
        {!isReviewer && amsSyncedLabel && (
          <span className="chip ok" title="Last copy filed in PactPro"><Icon name="check" size="sm" />{amsSyncedLabel}</span>
        )}
        {office?.role === 'suggest' && (
          <span className="chip warn" title="The author accepts or rejects each change">Suggesting: your edits are tracked</span>
        )}
        {office?.final ? (
          <span className="chip ok" title={`Locked. sha256 ${office.final.sha256.slice(0, 12)}…`}>
            <Icon name="check" size="sm" />{`Final${office.final.by ? ` · ${office.final.by}` : ''} · ${new Date(office.final.at).toLocaleDateString()}`}
          </span>
        ) : office?.role === 'view' && <span className="chip" title="You can read this draft">Read only</span>}
        {(canEdit || canSuggest) && !office && (
          <div className="seg" role="group" aria-label="Mode">
            <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}><Icon name="edit" size="sm" />Edit</button>
            <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}><Icon name="eye" size="sm" />Preview</button>
          </div>
        )}
        {canSuggest && canEditDirect && !office && (
          <button type="button" className="btn sm" aria-pressed={suggestMode} disabled={dirty}
            title={dirty ? 'Save or send your edits first' : 'Type suggestions for the owner to accept or decline, instead of changing the draft'}
            onClick={() => setSuggestMode(m => !m)}><Icon name="chat" size="sm" />Suggest</button>
        )}
        {!office && (
          <button type="button" className="btn sm" title="Select some words, then comment on them (a question or a note)"
            onMouseDown={e => e.preventDefault()} onClick={startComment}><Icon name="chat" size="sm" />Comment</button>
        )}
        {office ? (
          <button type="button" className="btn sm"
            title="Compare with an earlier version or a file you received back: differences show as tracked changes"
            onClick={openOfficeCompare}><Icon name="swap" size="sm" />Compare</button>
        ) : (
          <button type="button" className="btn sm" aria-pressed={!!compare}
            title="See what changed between two versions, in the document"
            onClick={() => (compare ? setCompare(null) : openCompare())}><Icon name="swap" size="sm" />Compare</button>
        )}
        {!office && (
          <DraftVersions sessionId={session.id} canSave={!!canEdit}
            beforeSave={async () => !dirty || !!(await save())} onCompare={id => openCompare(id)}
            onRestored={fresh => { loadedRef.current = false; setSession(fresh); setDirty(false); loadRounds() }} />
        )}
        {hasPermission('DRAFT_EXPORT') && (
          <Button size="sm" icon="download" aria-haspopup="menu" loading={exporting} disabled={exporting}
            onClick={e => setDlAnchor(dlAnchor ? null : e.currentTarget)}>Download</Button>
        )}
        {dlAnchor && (
          <DownloadPanel anchor={dlAnchor} onClose={() => setDlAnchor(null)} ownLetterhead={!!session.word_form?.has_letterhead}
            onDownload={(letterhead, format) => downloadDocx(letterhead, format)}
            onRedline={letterhead => { setRedlineLetterhead(letterhead); setShowRedline(true) }} />
        )}
        <RedlineDialog sessionId={session.id} visible={showRedline} onHide={() => setShowRedline(false)}
          office={!!office}
          beforeExport={async () => !!office || !dirty || !!(await save())} letterhead={redlineLetterhead} />
        {isReviewer || (office && !confirmRedraft) ? null : confirmRedraft ? (
          <div className="row wrap" style={{ gap: 4 }}>
            <span className="small muted">Re-draft? Existing content will be replaced.</span>
            <Button variant="danger" size="sm" icon="check" loading={redrafting} disabled={redrafting} onClick={triggerRedraft}>Confirm</Button>
            <button type="button" className="btn ghost sm" onClick={() => setConfirmRedraft(false)}>Cancel</button>
          </div>
        ) : (
          <Button size="sm" icon="refresh" title="Wipe this draft and regenerate with the same inputs"
            onClick={() => setConfirmRedraft(true)}>Re-draft</Button>
        )}
        {/* PactPro's Save is the one that makes a version (a suggester's tracked changes included). The editor's
            own Save / Ctrl+S only keeps a working copy: say so, so nobody thinks Ctrl+S was enough. */}
        {office && office.role !== 'view' && officeDirty && officeSafe && (
          <span className="small muted" title="Saved by the editor (Ctrl+S, its Save icon or autosave): kept for you, but not yet a PactPro version">
            Your work is safe; not yet a PactPro version
          </span>
        )}
        {office ? (office.role !== 'view' && (
          <Button size="sm" icon="check" loading={officeSaving} disabled={officeSaving || !officeDirty}
            title={office.role === 'suggest' ? 'Save your tracked changes for the author' : 'Save the document'}
            onClick={() => void saveOffice()}>{officeDirty ? 'Save to PactPro' : 'Saved'}</Button>
        )) : suggesting ? (
          <Button size="sm" variant="primary" icon="send" loading={saving} disabled={!dirty || saving}
            title="Send your edits to the owner as suggestions" onClick={sendSuggestions}>Send suggestions</Button>
        ) : canEdit && (
          <Button size="sm" icon="check" loading={saving} disabled={!dirty || saving} onClick={save}>{dirty ? 'Save' : 'Saved'}</Button>
        )}
        {office && office.role !== 'view' && !desktop && (
          <Button size="sm" icon="file" title="Edit this draft in Word / LibreOffice on this computer"
            onClick={() => void closeForDesktop()}>Open on desktop</Button>
        )}
        {office && officeMore.length > 0 && (
          <Button size="sm" icon="more" aria-haspopup="menu" aria-expanded={!!moreAnchor} title="More actions"
            loading={finalising || pdfaBusy} onClick={e => setMoreAnchor(moreAnchor ? null : e.currentTarget)}>More</Button>
        )}
        {moreAnchor && <PopMenu anchor={moreAnchor} items={officeMore} align="right" width={250} onClose={() => setMoreAnchor(null)} />}
        {office?.desktopLock && !desktop && (
          <span className="small muted">{office.desktopLock.pending
            ? `Desktop edits by ${office.desktopLock.by} not saved to PactPro yet: read only here.`
            : `Open in a desktop editor by ${office.desktopLock.by}: read only here.`}</span>
        )}
        {saveChoice.dialog}
        {openWith.dialog}
        {access?.isOwner && canEditDirect && !office && (
          <Button size="sm" icon="upload" title="Upload a Word file you received back (client or other side) to review its changes"
            onClick={() => setShowImport(true)}>Import changes</Button>
        )}
        {access?.isOwner && !session.ams_task_id && (
          <Button size="sm" icon="users" title="Ask a colleague in your team to review this draft"
            onClick={() => setAskReview(true)}>Request review</Button>
        )}
        {!isReviewer && (
          <Button variant="primary" size="sm" icon="folder" loading={sendingAms} disabled={sendingAms || suggestionsToDecide}
            title={suggestionsToDecide ? 'Accept or decline the suggestions first (Review)'
              : session?.case_id ? undefined : 'Pick the PactPro case to file this draft on'}
            onClick={saveToCaseClick}>
            {session?.ams_task_id ? 'Submit to task' : 'Save to case'}
          </Button>
        )}
      </div>
      {error && <div className="callout warn" role="alert" style={{ marginBottom: 12 }}><Icon name="warn" size="sm" /><div>{error}</div></div>}
      {isReviewer && review && (
        <div className="pp-review-bar">
          <div>
            <Icon name="user" size="sm" />{' '}
            Reviewing <strong>{session.created_by_name || 'the advocate'}</strong>'s draft for task
            {' '}<strong>"{review.taskTitle}"</strong>:{' '}
            {review.status === 'SUBMITTED' ? 'awaiting your review'
              : review.status === 'APPROVED' ? `approved${review.reviewedByName ? ` by ${review.reviewedByName}` : ''}`
              : 'sent back for changes'}
            {review.note && review.status !== 'SUBMITTED' && <span className="muted"> · "{review.note}"</span>}
            {review.status === 'SUBMITTED' && review.lastChanges != null && (
              <div className="pp-review-changes">
                <Icon name="history" size="sm" />{' '}
                {review.lastChanges.length
                  ? <>Changed since the last version: <strong>{changeSummary(review.lastChanges)}</strong></>
                  : 'No text changes since the last version.'}
                {review.lastNote && <div className="muted pp-review-changes-note">"{review.lastNote}"</div>}
                {review.lastChanges.length > 0 && <>
                  <button type="button" className="btn ghost sm" onClick={() => setShowChanges(true)}><Icon name="eye" size="sm" />What changed</button>
                  <button type="button" className="btn ghost sm" onClick={() => openCompare()}><Icon name="swap" size="sm" />Show in document</button>
                </>}
              </div>
            )}
          </div>
          {review.canReview && review.status === 'SUBMITTED' && (
            <div className="row" style={{ gap: 6 }}>
              <Button size="sm" icon="restore" disabled={reviewing || dirty} title={dirty ? 'Save your edits first' : undefined}
                onClick={() => { setReviewNote(''); setAskChanges(true) }}>Request changes</Button>
              <Button variant="primary" size="sm" icon="check" loading={reviewing} disabled={dirty || reviewing || approveBlocked}
                title={dirty ? 'Save your edits first' : approveBlocked ? 'Decide on every change first (Review) and resolve every comment' : undefined}
                onClick={() => submitReview('approve')}>Approve</Button>
            </div>
          )}
        </div>
      )}
      <Modal title="Compare with…" open={compareOpen} onClose={() => setCompareOpen(false)}
        sub="The differences show in the document as tracked changes you accept or reject.">
        <div className="stack" style={{ gap: 12 }}>
          <Field label="A Word file you received back (client, other side)">
            {id => (
              <input id={id} type="file" accept=".docx" disabled={comparing}
                onChange={e => { const f = e.target.files?.[0]; if (f) void compareWith(f) }} />
            )}
          </Field>
          <div>
            <p className="small muted">Or an earlier version of this draft</p>
            {compareVersions.length === 0 ? <p className="faint small">No saved versions yet.</p> : (
              <div className="stack" style={{ gap: 6 }}>
                {compareVersions.map(v => (
                  <Button key={v.version} size="sm" disabled={comparing} onClick={() => void compareWith({ version: v.version })}>
                    {`Version ${v.version} · ${v.created}${v.name ? ` · ${v.name}` : ''}`}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
      <Modal title="What changed since the last version" open={showChanges} size="wide" onClose={() => setShowChanges(false)}>
        {review?.lastNote && <p className="muted" style={{ marginBottom: 12 }}>"{review.lastNote}"</p>}
        <DraftChanges changes={review?.lastChanges} />
      </Modal>
      <Modal title="Submit to task" open={askResubmit} onClose={() => setAskResubmit(false)}
        footer={<>
          <button type="button" className="btn ghost" onClick={() => setAskResubmit(false)}>Cancel</button>
          <Button variant="primary" icon="send" loading={sendingAms} disabled={!resubmitNote.trim() || sendingAms}
            onClick={() => sendToAms(undefined, resubmitNote.trim())}>Submit</Button>
        </>}>
        {amsTask?.reviewNote && (
          <div className="callout warn" style={{ marginBottom: 12 }}><Icon name="warn" size="sm" /><div>
            <strong>{amsTask.reviewedByName || 'Your senior'} asked:</strong> {amsTask.reviewNote}
          </div></div>
        )}
        <Field label="What did you change?" required hint="Your reviewer also sees exactly which sections changed.">
          {(id, d) => <textarea id={id} aria-describedby={d} className="input" rows={3} autoFocus value={resubmitNote}
            onChange={e => setResubmitNote(e.target.value)}
            placeholder="Added the arrears figure Rs. 3,15,000 in Reliefs claimed; kept the fallback." />}
        </Field>
      </Modal>
      <Modal title="Request changes" open={askChanges} onClose={() => setAskChanges(false)}
        footer={<>
          <button type="button" className="btn ghost" onClick={() => setAskChanges(false)}>Cancel</button>
          <Button variant="primary" icon="send" loading={reviewing} disabled={!reviewNote.trim() || reviewing}
            onClick={() => submitReview('request_changes', reviewNote)}>Send back</Button>
        </>}>
        <Field label={`What should ${session?.created_by_name || 'the advocate'} change?`} required>
          {id => <textarea id={id} className="input" rows={4} value={reviewNote} onChange={e => setReviewNote(e.target.value)}
            placeholder="Add the limitation calculation and cite the trial court order." />}
        </Field>
      </Modal>
      {/* The senior's review of this draft's AMS task (as seen by the author). */}
      {!isReviewer && amsTask?.needsReview && amsTask.reviewStatus === 'CHANGES_REQUESTED' && (
        <div className="callout warn" style={{ marginBottom: 12 }}><Icon name="warn" size="sm" /><div>
          {`${amsTask.reviewedByName || 'Your senior'} asked for changes: ${amsTask.reviewNote || ''}`} Edit the draft and choose <b>Submit to task</b> again.
          {' '}<button type="button" className="btn ghost sm" onClick={() => openCompare()}>
            <Icon name="swap" size="sm" />See what {amsTask.reviewedByName || 'your senior'} changed</button>
        </div></div>
      )}
      {!isReviewer && amsTask?.needsReview && amsTask.reviewStatus === 'APPROVED' && (
        <div className="callout ok" style={{ marginBottom: 12 }}><Icon name="ok" size="sm" /><div>
          {`Approved by ${amsTask.reviewedByName || 'your senior'}${amsTask.reviewNote ? `: ${amsTask.reviewNote}` : ''}.`}
        </div></div>
      )}

      {conflict && !reviewRoundId && (
        <div className="callout bad dr-bar" role="alert">
          <Icon name="warn" size="sm" />
          <div className="grow">
            Not saved: someone else changed <strong>{conflict.join(', ') || 'the same clause'}</strong> after you
            opened the draft. Copy your wording, reload to see theirs, then make your change again.
          </div>
          <button type="button" className="btn sm" onClick={() => { setConflict(null); reloadStale() }}>Reload</button>
        </div>
      )}
      <ImportChangesDialog sessionId={session.id} open={showImport} onClose={() => setShowImport(false)}
        onImported={r => {
          loadRounds()
          if (r.round) { setCompare(null); setReviewRoundId(r.round) } else openComments()
        }} />
      <RequestReviewDialog sessionId={session.id} open={askReview} onClose={() => setAskReview(false)} onSent={loadRounds} />
      {/* At most one review bar: the thing to act on now. The rest is in the Activity tab. */}
      {!reviewRoundId && !taskBar && reviewBar && (
        <div className={`callout dr-bar ${reviewBar.tone}`}>
          <Icon name={reviewBar.icon} size="sm" />
          <div className="grow ellipsis" title={reviewBar.hint}>{reviewBar.text}</div>
          {reviewBar.more > 0 && (
            <button type="button" className="btn ghost sm" onClick={openActivity}>+{reviewBar.more} more</button>
          )}
          {reviewBar.action}
        </div>
      )}
      {reviewRoundId && (
        <ReviewRoundView key={reviewRoundId} roundId={reviewRoundId} docTitle={docTitle}
          onClose={() => setReviewRoundId(null)}
          onDone={async () => { setReviewRoundId(null); await reloadDraft(); loadRounds() }} />
      )}
      {compare && !reviewRoundId && (
        <CompareView key={compare.from ?? 'default'} sessionId={session.id} docTitle={docTitle}
          initialFrom={compare.from} onClose={() => setCompare(null)} onDownload={downloadRedline} />
      )}
      {preview && !compare && !reviewRoundId && (
        /* Read-only filled document */
        <div className="ed-mid dr-preview">
          <article className="paper-sheet preview" aria-label="Draft preview" style={paperStyle(session.word_form)}>
            <WordBand html={session.word_form?.header_html} where="head" form={session.word_form} />
            {shownTitle && <h1 className="pp-doc-title">{shownTitle}</h1>}
            {session.blocks.map(b => <PreviewClause key={b.id} block={b} docTitle={shownTitle} />)}
            <WordBand html={session.word_form?.footer_html} where="foot" form={session.word_form} />
          </article>
        </div>
      )}
      {/* Three-pane editor — kept MOUNTED while previewing (just hidden) so the chat /
          review panels and their state survive the Preview → Edit toggle. Pane widths
          are user-resizable (drag handles) and fed in as CSS variables. */}
      <div className="editor-shell dr-ed-shell"
        style={{ display: (preview && !office) || compare || reviewRoundId ? 'none' : undefined, ['--dr-l' as string]: `${leftW}px`, ['--dr-r' as string]: `${rightW}px` }}>
          {/* Left — document placeholders + reference documents */}
          <aside className="ed-pane ed-side dr-ed-pane" aria-label="Placeholders and references">
            <div className="ed-sec">
              <h3>Placeholders</h3>
              {office ? (
                <DocumentPlaceholders
                  items={officeBlanks.map(b => ({ label: b.label, display: b.label,
                    value: officeValues[b.label] ?? b.value ?? '' }))}
                  onChange={(label, value) => setOfficeValues(v => ({ ...v, [label]: value }))}
                  onFocus={label => { officeRef.current?.findPlaceholder(label) }}
                  footer={officeBlanks.length > 0 && (
                    <Button size="sm" variant="primary" icon="check" loading={officeFilling}
                      disabled={officeFilling || officeReady.length === 0} onClick={() => void applyOfficeBlanks()}>
                      {officeReady.length ? `Apply ${officeReady.length} to document` : 'Apply to document'}
                    </Button>
                  )}
                  note={officeFilling ? 'Writing into the document…'
                    : 'Fill or change any you want (Enter moves to the next), then Apply: each value goes into every place it appears. You can also type straight into a field in the document.'} />
              ) : (
                <DocumentPlaceholders items={placeholders} onChange={setPlaceholderValue}
                  onFocus={focusPlaceholder} onBlur={blurPlaceholder} />
              )}
            </div>

            <CaseFilePanel sessionId={session.id} onOpen={d => {
              setRefDoc({ name: d.name, url: '', amsDocId: d.id, fileName: d.fileName }); setRightW(w => Math.max(w, 440))
            }} />

            {(session.reference_documents?.length ?? 0) > 0 && (
              <div className="ed-sec">
                <h3>Reference documents</h3>
                {session.reference_documents!.map((d, i) => (
                  <button key={`${d.kind}-${d.id}`} type="button" className="pp-ref-doc"
                    onClick={() => { setRefDoc({ name: d.name, url: d.url, preview: d.preview }); setRightW(w => Math.max(w, 440)) }}>
                    <span className="mono faint xs" style={{ width: 22 }}>[{i + 1}]</span>
                    <span className="pp-ref-doc-name">{d.name}</span>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <div className="pp-gutter" onMouseDown={startDrag('left')} title="Drag to resize" aria-hidden="true" />

          {/* Middle — the editable document */}
          <div className="ed-mid dr-ed-mid">
            {office && desktop ? (
              <div className="dr-desktop">
                {desktop === 'closing' ? <p className="muted">Closing the PactPro editor…</p> : desktop === 'ready' ? (<>
                  <p>Open this draft in the editor on your computer, or work on it here.</p>
                  <div className="row wrap" style={{ gap: 8, justifyContent: 'center' }}>
                    <Button variant="primary" icon="file" onClick={openOnDesktop}>Open in desktop editor</Button>
                    <Button variant="ghost" onClick={backToEditor}>Back to the PactPro editor</Button>
                  </div>
                </>) : (<>
                  <p>Open in your desktop editor. Save there as often as you like; when done, <strong>Save to PactPro</strong> (bottom right) makes it a new version here.</p>
                  <Button icon="refresh" onClick={backToEditor}>Back to the PactPro editor</Button>
                </>)}
              </div>
            ) : office ? (
              <OnlyOfficeEditor ref={officeRef} setup={office} sessionId={session.id}
                canRestore={office.role === 'decide'}
                onConfig={config => { setOffice(o => (o ? { ...o, config } : o)); setOfficeDirty(false); fetchSession() }}
                onCompareRequest={openOfficeCompare}
                onModified={m => {
                  // Typing: unsaved. The editor saving its working copy (modified -> false): safe, not a version yet.
                  if (m) { setOfficeDirty(true); setOfficeSafe(false) } else if (officeDirty) setOfficeSafe(true)
                }}
                onSaved={fetchSession} onClause={setFocusedId} />
            ) : (<>
            <EditorToolbar editor={editor} />
            {shapeCount > 0 && (
              <p className="dr-shapes-note muted xs" role="note">
                The template has {shapeCount === 1 ? 'a drawn box or shape' : `${shapeCount} drawn boxes or shapes`} (e.g.
                stamp boxes) the editor can't show. They stay in place in Download, Save to case and View.
              </p>
            )}
            <div className="paper-sheet pp-editor-paper" style={paperStyle(session.word_form)}>
              <WordBand html={session.word_form?.header_html} where="head" form={session.word_form} />
              {shownTitle && <h1 className="pp-doc-title">{shownTitle}</h1>}
              <EditorContent editor={editor} />
              <WordBand html={session.word_form?.footer_html} where="foot" form={session.word_form} />
            </div>
            </>)}
          </div>

          <div className="pp-gutter" onMouseDown={startDrag('right')} title="Drag to resize" aria-hidden="true" />

          {/* Right — a reference document (if opened), else the tabbed Lisa / Review pane */}
          <aside className="ed-pane ed-side dr-ed-pane" aria-label="Assistant">
            {refDoc ? (
              <div className="pp-refview">
                <div className="pp-refview-head">
                  <div style={{ minWidth: 0 }} title={refDoc.name}>
                    <div className="small ellipsis" style={{ fontWeight: 500 }}>{refDoc.name}</div>
                    <div className="faint xs">Reference document</div>
                  </div>
                  <button type="button" className="btn ghost sm icon" aria-label="Close reference document" title="Close"
                    onClick={() => setRefDoc(null)}><Icon name="x" size="sm" /></button>
                </div>
                <div className="pp-refview-body"><InlineDocViewer fileUrl={refDoc.url} previewUrl={refDoc.preview} name={refDoc.name} amsDocId={refDoc.amsDocId} fileName={refDoc.fileName} /></div>
              </div>
            ) : (
              <div className="pp-rpane">
                <div className="tabs dr-rtabs" role="tablist" aria-label="Assistant">
                  <button type="button" role="tab" aria-selected={rightTab === 'chat'} onClick={() => setRightTab('chat')}>
                    <Icon name="chat" size="sm" /> Ask Lisa
                  </button>
                  <button type="button" role="tab" aria-selected={rightTab === 'review'} onClick={() => setRightTab('review')}>
                    <Icon name="shield" size="sm" /> Review
                  </button>
                  <button type="button" role="tab" aria-selected={rightTab === 'activity'} onClick={() => setRightTab('activity')}>
                    <Icon name="history" size="sm" /> Activity{activityBadge > 0 && <span className="dr-badge">{activityBadge}</span>}
                  </button>
                  {/* ONLYOFFICE drafts keep comments in the Word file (the editor's own Comments). */}
                  {!office && (
                    <button type="button" role="tab" aria-selected={rightTab === 'comments'} onClick={() => setRightTab('comments')}>
                      <Icon name="chat" size="sm" /> Comments{(comments?.open ?? 0) > 0 ? ` (${comments!.open})` : ''}
                    </button>
                  )}
                </div>
                <div className={`pp-rtab-slot ${rightTab === 'activity' ? '' : 'pp-hidden'}`}>
                  <ReviewActivity rounds={rounds} requests={requests} isOwner={!!access?.isOwner}
                    onOpenRound={id => { setCompare(null); setReviewRoundId(id) }} onCancelRequest={cancelRequest} />
                </div>
                <div className={`pp-rtab-slot ${rightTab === 'comments' ? '' : 'pp-hidden'}`}>
                  <CommentsPanel sessionId={session.id} data={comments} onChange={setComments}
                    pending={pendingComment} onCancelPending={() => setPendingComment(null)} onJump={jumpToComment} />
                </div>
                {/* Both mounted; inactive one is hidden so its state (chat thread / findings) persists. */}
                <div className={`pp-rtab-slot ${rightTab === 'chat' ? '' : 'pp-hidden'}`}>
                  <DraftChat
                    sessionId={session.id}
                    model={session.llm ?? 'local'}
                    docTitle={docTitle || title}
                    clauseCount={session.blocks.length}
                    focusedId={focusedId}
                    facts={session.facts}
                    getClauses={refineClauses}
                    onApply={patchClause}
                  />
                </div>
                <div className={`pp-rtab-slot dr-review-slot ${rightTab === 'review' ? '' : 'pp-hidden'}`}>
                  {/* Consistency panel — height controlled by drag handle */}
                  <div style={{ height: reviewTopH, minHeight: 80, flexShrink: 0, overflow: 'auto' }}>
                    <ConsistencyPanel
                      sessionId={session.id}
                      model={session.llm ?? 'local'}
                      getClauses={currentClauses}
                      onJump={scrollToClause}
                    />
                  </div>
                  {/* Drag handle */}
                  <div
                    className="dr-row-handle"
                    aria-hidden="true"
                    onMouseDown={e => {
                      e.preventDefault()
                      const startY = e.clientY
                      const startH = reviewTopH
                      const onMove = (ev: MouseEvent) => {
                        const next = Math.max(80, Math.min(startH + ev.clientY - startY, 600))
                        setReviewTopH(next)
                      }
                      const onUp = () => {
                        window.removeEventListener('mousemove', onMove)
                        window.removeEventListener('mouseup', onUp)
                      }
                      window.addEventListener('mousemove', onMove)
                      window.addEventListener('mouseup', onUp)
                    }}
                  />
                  {/* Playbook panel — takes remaining height */}
                  <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                    <PlaybookRiskPanel
                      sessionId={session.id}
                      initialPlaybookId={session.playbook ?? null}
                      initialRiskStatus={session.risk_status ?? 'idle'}
                      initialReport={session.risk_report ?? null}
                      onJump={scrollToClause}
                      onRisksLoaded={setRiskMap}
                    />
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      <Modal title="Save to case" sub="This draft isn't linked to a PactPro case yet. Choose the case to file it on." open={pickAmsCase}
        size="wide" onClose={() => setPickAmsCase(false)}>
        <AmsCasePicker inline onPick={c => sendToAms(c.id)} label="Case" />
      </Modal>
    </div>
    </RiskContext.Provider>
  )
}
