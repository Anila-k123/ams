import { useEffect, useRef, useState } from 'react'
import { DRAFTING } from './routes'
import { useParams, useNavigate } from 'react-router-dom'
import { ProgressSpinner } from 'primereact/progressspinner'
import { Message } from 'primereact/message'
import { Button } from 'primereact/button'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { Menu } from 'primereact/menu'
import { Dialog } from 'primereact/dialog'
import { InputTextarea } from 'primereact/inputtextarea'
import amsApi, { errorMessage } from '../../api/client'
import AmsCasePicker from './components/AmsCasePicker'
import { DOMSerializer } from '@tiptap/pm/model'
import { diffWords } from 'diff'
import { ClauseDocument, Clause, type Citation } from './editor/clause'
import { Placeholder } from './editor/placeholderNode'
import { EditHighlight } from './editor/editHighlight'
import { ParagraphStyle } from './editor/paragraphStyle'
import { Search } from './editor/search'
import { PlaceholderHighlight } from './editor/placeholder'
import { RiskHighlight } from './editor/riskHighlight'
import EditorToolbar from './components/EditorToolbar'
import DraftChat from './components/DraftChat'
import ConsistencyPanel from './components/ConsistencyPanel'
import PlaybookRiskPanel from './components/PlaybookRiskPanel'
import InlineDocViewer from './components/InlineDocViewer'
import DocumentPlaceholders from './components/DocumentPlaceholders'
import { draftingApi, type DraftSession, type DraftBlock, type AmsTaskReview } from './api/drafting'
import { RiskContext, type RiskMap } from './context/RiskContext'

// ── legacy blank detection (old ______ / dot-leader drafts) ────────────────────
const BLANK_SRC = '_{2,}|…{2,}|\\.{4,}|\\[[\\s_.•●…]*\\]'
const humanize = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase())
// Convert [[Label]] tokens into placeholder-node spans on load / insert.
const convertTokens = (html: string) =>
  html.replace(/\[\[([^\]]+)\]\]/g, (_, l: string) => `<span data-placeholder="${escAttr(l.trim())}"></span>`)
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
      const h = escText(text).replace(/\[\[([^\]]+)\]\]/g, (_m, l: string) => `<span data-placeholder="${escAttr(l.trim())}"></span>`)
      return added ? `<span data-edit-hl>${h}</span>` : h
    }).join('')
    return `<p>${inner}</p>`
  }).join('')
  return html || '<p></p>'
}
const BLANK_RE = new RegExp(BLANK_SRC, 'g')
const BLANK_SPLIT_RE = new RegExp(`(${BLANK_SRC})`, 'g')
const BLANK_TEST_RE = new RegExp(`^(?:${BLANK_SRC})$`)

function highlightBlanks(text: string, keyPrefix: string) {
  if (!text) return text
  return text.split(BLANK_SPLIT_RE).map((part, i) =>
    BLANK_TEST_RE.test(part)
      ? <mark key={`${keyPrefix}-${i}`} className="pp-blank" title="Unfilled placeholder — provide this value">{part}</mark>
      : part)
}

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

// Recognise a legal-document title (so we can promote it to the heading, not leave it in body).
const DOC_TITLE_RE = /\b(agreement|deed|nda|mou|memorandum|affidavit|vakalatnama|vakalathnama|contract|lease|power of attorney|undertaking)\b/i

/** The document's own title: the first non-empty line of the first block when it reads like a
 *  title — short and either mostly upper-case or containing a legal-doc keyword. Else ''. */
function extractDocTitle(blocks?: DraftBlock[]): string {
  const first = (blocks || [])[0]
  if (!first) return ''
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
  const div = document.createElement('div')
  div.innerHTML = html
  div.querySelectorAll('[data-edit-hl]').forEach(el => {
    while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el)
    el.parentNode?.removeChild(el)
  })
  return div.innerHTML
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
function buildContentHtml(blocks: DraftBlock[], docTitle = ''): string {
  return blocks.map(b => {
    const plain = stripDocTitle(stripLeadingHeading(b.text, b.heading || ''), docTitle)
    const body = convertTokens(b.content_html?.trim() ? b.content_html : textToHtml(plain))
    const hStyle = b.style_json?.heading
    const hAttr = hStyle ? ` data-heading-style="${escAttr(JSON.stringify(hStyle))}"` : ''
    return `<section data-clause data-block-id="${b.id}" data-heading="${escAttr(b.heading || '')}"${hAttr} `
      + `data-source="${b.source}" data-verified="${b.verified}">${body}</section>`
  }).join('')
}

// ── read-only Preview renderer (the filled document, diff-highlighted) ─────────
function PreviewClause({ block, docTitle = '' }: { block: DraftBlock; docTitle?: string }) {
  const heading = block.heading?.trim()
  const body = stripMd(stripDocTitle(stripLeadingHeading(block.text, block.heading || ''), docTitle))
  const source = block.source_clause_detail?.text
  const rendered = source
    ? diffWords(stripMd(stripLeadingHeading(source, block.heading || '')), body)
        .filter(p => !p.removed)
        .map((p, i) => (p.added
          ? <mark key={i} className="pp-fill">{highlightBlanks(p.value, `f${i}`)}</mark>
          : <span key={i}>{highlightBlanks(p.value, `s${i}`)}</span>))
    : highlightBlanks(body, 'b')
  return (
    <div className="pp-doc-section">
      {heading && <h3 className="pp-clause-heading">{heading}</h3>}
      <div className="pp-doc-text pp-doc-flow">{rendered}</div>
    </div>
  )
}

/** The draft workspace: a three-pane editor (provenance · editable document ·
 *  assistant stub) with a read-only Preview toggle and manual Save. Polls while
 *  the draft is still generating. */
export default function DraftPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<DraftSession | null>(null)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(false)      // read-only filled-document view
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
  const [refDoc, setRefDoc] = useState<{ name: string; url: string } | null>(null)  // reference doc open in the right pane
  const [rightTab, setRightTab] = useState<'chat' | 'review'>('chat')  // right-pane tab (Chat | Review)
  const [reviewTopH, setReviewTopH] = useState(220)  // px height of Consistency panel in Review tab
  const [riskMap, setRiskMap] = useState<RiskMap>({})
  const [confirmRedraft, setConfirmRedraft] = useState(false)  // inline confirm toggle
  const [redrafting, setRedrafting] = useState(false)
  // Draggable side-pane widths (persisted).
  const [leftW, setLeftW] = useState(() => Number(localStorage.getItem('pp_editor_left_w')) || 244)
  const [rightW, setRightW] = useState(() => Number(localStorage.getItem('pp_editor_right_w')) || 300)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const downloadMenu = useRef<Menu>(null)   // popup for PDF / Word export
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
        onCite: (url: string, name?: string) => { setRefDoc({ name: name || 'Reference document', url }); setRightW(w => Math.max(w, 440)) },
      }),
      Placeholder,
      EditHighlight,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      ParagraphStyle,
      Search,
      PlaceholderHighlight,
      RiskHighlight,
    ],
    content: '',
    onUpdate: ({ editor }) => {
      if (!suppressRef.current) setDirty(true)
      setBlankCount(editor.getText().match(BLANK_RE)?.length ?? 0)
      // Placeholder fields come from the placeholder nodes (one field per label).
      const map = new Map<string, string>()
      editor.state.doc.descendants(node => {
        if (node.type.name === 'placeholder') {
          const l = node.attrs.label as string
          if (!map.has(l)) map.set(l, (node.attrs.value as string) || '')
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

  useEffect(() => {
    fetchSession()
    startPolling()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Seed the editor once the draft is ready (don't clobber edits on later polls).
  useEffect(() => {
    if (editor && session?.status === 'ready' && !loadedRef.current && (session.blocks?.length ?? 0) > 0) {
      citationsRef.current = buildCitations(session.blocks)  // ready before the NodeViews render
      suppressRef.current = true
      editor.commands.setContent(buildContentHtml(session.blocks, resolveDocTitle()))
      suppressRef.current = false
      loadedRef.current = true
      setDirty(false)
    }
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

  // Returns false if the save failed (so an export can stop instead of using stale content).
  const save = async (): Promise<boolean> => {
    if (!editor || !sessionId) return false
    // Edit highlights persist through Save (they round-trip via <span data-edit-hl>);
    // they're only stripped from the downloaded PDF/Word.
    const serializer = DOMSerializer.fromSchema(editor.schema)
    const updates: { id: number; heading: string; content_html: string; text: string }[] = []
    editor.state.doc.forEach(node => {
      if (node.type.name !== 'clause' || node.attrs.blockId == null) return
      const div = document.createElement('div')
      div.appendChild(serializer.serializeFragment(node.content))
      updates.push({
        id: Number(node.attrs.blockId),
        heading: (node.attrs.heading as string) || '',
        content_html: div.innerHTML,
        text: node.textBetween(0, node.content.size, '\n', phLeafText),
      })
    })
    setSaving(true); setError('')
    try {
      const fresh = await draftingApi.saveBlocks(Number(sessionId), updates)
      setSession(fresh)
      setDirty(false)
      return true
    } catch {
      setError('Could not save changes — please try again.')
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

  // Build the export document HTML (title + each clause) from the live editor
  // (falling back to saved blocks). Shared by the Word and PDF exports.
  const buildExportBody = () => {
    const dTitle = resolveDocTitle()
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
          + (b.content_html?.trim() ? b.content_html : textToHtml(stripDocTitle(stripLeadingHeading(b.text, b.heading || ''), dTitle))))
      })
    }
    return stripEditHl(parts.join('\n'))
  }

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
  const isReviewer = !!review && !review.isOwner
  // Approve / request changes from the editor (backend: workspace/review.py).
  const submitReview = async (action: 'approve' | 'request_changes', note = '') => {
    if (!review) return
    setReviewing(true); setError('')
    try {
      await amsApi.post(`/api/workspace/tasks/${review.taskId}/review`, { action, note })
      setAskChanges(false)
      setPreview(true)
      await fetchSession()
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
  const sendToAms = async (caseId?: number) => {
    if (!sessionId) return
    if (!session?.case_id && !caseId) { setPickAmsCase(true); return }
    setPickAmsCase(false)
    if (dirty && !(await save())) return
    setSendingAms(true); setError('')
    try {
      const r = await draftingApi.sendToAms(Number(sessionId), caseId)
      setSession(prev => prev && ({
        ...prev, case_id: r.amsCaseId, ams_document_id: r.documentId,
        ams_document_version: r.version, ams_synced_at: r.syncedAt,
      }))
      if (r.reviewStatus) setAmsTask(prev => prev && ({ ...prev, reviewStatus: r.reviewStatus }))
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error
      setError(msg || 'Could not save to AMS — your draft is safe here; please try again.')
    } finally {
      setSendingAms(false)
    }
  }
  const amsSyncedLabel = session?.ams_synced_at
    ? `${amsTask?.reviewStatus === 'SUBMITTED' ? 'Submitted for review' : 'Saved to AMS'}`
      + `${session.ams_document_version ? ` · v${session.ams_document_version}` : ''} · `
      + new Date(session.ams_synced_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : ''

  // Word: a real .docx rendered by the server from the SAVED draft, so unsaved edits
  // are saved first. `branding` = on the AMS letterhead (AMS-linked accounts only).
  const [exporting, setExporting] = useState(false)
  const downloadDocx = async (branding = false) => {
    if (!sessionId) return
    if (dirty && !(await save())) return
    setExporting(true); setError('')
    try {
      const { blob, filename } = await draftingApi.exportDocx(Number(sessionId), branding)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = filename
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href)
    } catch {
      setError('Could not create the Word file — please try again.')
    } finally {
      setExporting(false)
    }
  }

  // PDF: render into a hidden iframe and open the browser's print dialog
  // (defaults to "Save as PDF") — vector, selectable text, proper pagination.
  const downloadPdf = () => {
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
  const patchClause = (blockId: number, beforeText: string, afterText: string, heading?: string) => {
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
    if (!editor) return (session?.blocks ?? []).map(b => ({ block_id: b.id, heading: b.heading || '', text: b.text }))
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

  // Jump to a clause from a review finding: leave Preview, scroll it into view, flash it.
  const scrollToClause = (blockId: number) => {
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
  const blurPlaceholder = (label: string) =>
    placeholderEls(label).forEach(el => el.classList.remove('pp-ph-active'))

  // Live-fill a placeholder: set the value attr on every placeholder node with this
  // label. The nodes persist, so the field stays editable in the panel.
  const setPlaceholderValue = (label: string, value: string) => {
    if (!editor) return
    const tr = editor.state.tr
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'placeholder' && node.attrs.label === label) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, value })
      }
    })
    if (tr.docChanged) editor.view.dispatch(tr)
  }

  if (error && !session) {
    return <div className="pp-editor-fs pp-editor-center"><Message severity="error" text={error} /></div>
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
        <div className="flex flex-column align-items-center">
          <ProgressSpinner style={{ width: 54, height: 54 }} strokeWidth="4" />
          <h3 className="mt-4 mb-1">{heading}</h3>
          <p className="text-color-secondary m-0">{sub}</p>
        </div>
      </div>
    )
  }

  if (session.status === 'failed') {
    return (
      <div className="pp-editor-fs pp-editor-center">
        <div style={{ maxWidth: 520 }} className="flex flex-column gap-3">
          <Message severity="error" className="w-full"
            text="Draft generation failed. Please try again — if it keeps failing, make sure your documents finished processing." />
          <div className="flex gap-2">
            <Button label="Back to Drafts" icon="pi pi-arrow-left" severity="secondary" outlined onClick={() => navigate(DRAFTING.drafts)} />
            <Button label="Re-draft" icon="pi pi-refresh" loading={redrafting} onClick={triggerRedraft} />
          </div>
        </div>
      </div>
    )
  }

  const title = session.mode === 'library'
    ? (session.document_type || 'Draft Document')
    : (session.template_name ?? 'Draft Document')
  // The document's own title heading (same resolution as the exports).
  const docTitle = resolveDocTitle()
  // Count still-to-fill: empty placeholder fields + any legacy ______ blanks.
  const toFill = placeholders.filter(p => !p.value.trim()).length + blankCount

  return (
    <RiskContext.Provider value={riskMap}>
    <div className="pp-editor-fs">
      {/* Top bar */}
      <div className="pp-editor-topbar">
        <div className="flex align-items-center gap-2" style={{ minWidth: 0 }}>
          <Button icon="pi pi-arrow-left" text rounded severity="secondary" onClick={() => navigate(DRAFTING.drafts)} tooltip="Drafts" tooltipOptions={{ position: 'bottom' }} />
          <div style={{ minWidth: 0 }}>
            <div className="pp-editor-title" title={title}>{title}</div>
            <span className="text-sm text-color-secondary">Draft #{session.id}</span>
          </div>
        </div>
        <div className="flex align-items-center gap-2 flex-wrap justify-content-end">
          {toFill > 0 && (
            <span className="pp-chip review" title="Values left blank — fill these in before use">
              <i className="pi pi-exclamation-triangle" /> {toFill} to fill
            </span>
          )}
          <Menu popup ref={downloadMenu} model={[
            { label: 'Download PDF', icon: 'pi pi-file-pdf', command: downloadPdf },
            { label: 'Download Word (.docx)', icon: 'pi pi-file-word', command: () => downloadDocx() },
            { label: 'Word on AMS letterhead', icon: 'pi pi-id-card', command: () => downloadDocx(true) },
          ]} />
          {/* File on the AMS case / task (drafting/filing.py). Author only. */}
          {!isReviewer && <>
              {amsSyncedLabel && (
                <span className="pp-chip verified" title="Last copy filed in AMS">
                  <i className="pi pi-check" /> {amsSyncedLabel}
                </span>
              )}
              <Button label={session?.ams_task_id ? 'Submit to task' : 'Save to AMS'} icon="pi pi-send"
                size="small" outlined loading={sendingAms} onClick={() => sendToAms()}
                tooltip={session?.case_id ? undefined : 'Pick the AMS case to file this draft on'} />
          </>}
          <Button label="Download" icon="pi pi-download" size="small" outlined severity="secondary"
            loading={exporting}
            onClick={e => downloadMenu.current?.toggle(e)} />
          {isReviewer ? null : confirmRedraft ? (
            <div className="flex align-items-center gap-1">
              <span className="text-sm text-color-secondary">Re-draft? Existing content will be replaced.</span>
              <Button label="Confirm" icon="pi pi-check" size="small" severity="danger"
                loading={redrafting} onClick={triggerRedraft} />
              <Button label="Cancel" size="small" text severity="secondary"
                onClick={() => setConfirmRedraft(false)} />
            </div>
          ) : (
            <Button label="Re-draft" icon="pi pi-refresh" size="small" outlined severity="secondary"
              tooltip="Wipe this draft and regenerate with the same inputs"
              tooltipOptions={{ position: 'bottom' }}
              onClick={() => setConfirmRedraft(true)} />
          )}
          {(!isReviewer || review?.canEdit) && (
            <Button label={preview ? 'Edit' : 'Preview'} icon={preview ? 'pi pi-pencil' : 'pi pi-eye'}
              size="small" outlined onClick={() => setPreview(p => !p)} />
          )}
          {(!isReviewer || review?.canEdit) && (
            <Button label={dirty ? 'Save' : 'Saved'} icon="pi pi-save" size="small"
              badge={dirty ? '●' : undefined} loading={saving} disabled={!dirty} onClick={save} />
          )}
        </div>
      </div>
      {error && <Message severity="warn" className="w-full" text={error} />}
      {isReviewer && review && (
        <div className="pp-review-bar">
          <div>
            <i className="pi pi-user-edit" />{' '}
            Reviewing <strong>{session.created_by_name || 'the junior'}</strong>'s draft for task
            {' '}<strong>"{review.taskTitle}"</strong> —{' '}
            {review.status === 'SUBMITTED' ? 'awaiting your review'
              : review.status === 'APPROVED' ? `approved${review.reviewedByName ? ` by ${review.reviewedByName}` : ''}`
              : 'sent back for changes'}
            {review.note && review.status !== 'SUBMITTED' && <span className="text-color-secondary"> · "{review.note}"</span>}
          </div>
          {review.canReview && review.status === 'SUBMITTED' && (
            <div className="flex gap-2">
              <Button label="Request changes" icon="pi pi-replay" size="small" severity="warning" outlined
                disabled={reviewing || dirty} tooltip={dirty ? 'Save your edits first' : undefined}
                onClick={() => { setReviewNote(''); setAskChanges(true) }} />
              <Button label="Approve" icon="pi pi-check" size="small" severity="success"
                loading={reviewing} disabled={dirty} tooltip={dirty ? 'Save your edits first' : undefined}
                onClick={() => submitReview('approve')} />
            </div>
          )}
        </div>
      )}
      <Dialog header="Request changes" visible={askChanges} style={{ width: 'min(520px, 95vw)' }}
        onHide={() => setAskChanges(false)}
        footer={<div className="flex justify-content-end gap-2">
          <Button label="Cancel" text onClick={() => setAskChanges(false)} />
          <Button label="Send back" icon="pi pi-send" severity="warning" loading={reviewing}
            disabled={!reviewNote.trim()} onClick={() => submitReview('request_changes', reviewNote)} />
        </div>}>
        <label className="font-medium text-sm block mb-2">What should {session?.created_by_name || 'the junior'} change?</label>
        <InputTextarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} rows={4}
          autoResize className="w-full" placeholder="e.g. Add the limitation calculation and cite the trial court order." />
      </Dialog>
      {/* The senior's review of this draft's AMS task (as seen by the author). */}
      {!isReviewer && amsTask?.needsReview && amsTask.reviewStatus === 'CHANGES_REQUESTED' && (
        <Message severity="warn" className="w-full" text={
          `${amsTask.reviewedByName || 'Your senior'} asked for changes: ${amsTask.reviewNote || ''}`
          + ' — edit the draft and click "Submit to task" again.'} />
      )}
      {!isReviewer && amsTask?.needsReview && amsTask.reviewStatus === 'APPROVED' && (
        <Message severity="success" className="w-full" text={
          `Approved by ${amsTask.reviewedByName || 'your senior'}${amsTask.reviewNote ? `: ${amsTask.reviewNote}` : ''}.`} />
      )}

      {preview && (
        /* Read-only filled document */
        <div className="pp-editor-preview-scroll">
          <div className="pp-paper">
            {docTitle && <h1 className="pp-doc-title">{docTitle}</h1>}
            {session.blocks.map(b => <PreviewClause key={b.id} block={b} docTitle={docTitle} />)}
          </div>
        </div>
      )}
      {/* Three-pane editor — kept MOUNTED while previewing (just hidden) so the chat /
          review panels and their state survive the Preview → Edit toggle. */}
      <div className="pp-editor-shell" style={{ display: preview ? 'none' : 'grid', gridTemplateColumns: `${leftW}px 6px minmax(0, 1fr) 6px ${rightW}px` }}>
          {/* Left — document placeholders + reference documents */}
          <aside className="pp-editor-side pp-editor-left">
            <div className="pp-editor-side-head">Document placeholders</div>
            <div className="pp-editor-side-body">
              <DocumentPlaceholders items={placeholders} onChange={setPlaceholderValue}
                onFocus={focusPlaceholder} onBlur={blurPlaceholder} />

              {(session.reference_documents?.length ?? 0) > 0 && (
                <div className="pp-ref-docs">
                  <div className="pp-ref-docs-head">Reference documents</div>
                  {session.reference_documents!.map(d => (
                    <button key={`${d.kind}-${d.id}`} type="button" className="pp-ref-doc"
                      onClick={() => { setRefDoc({ name: d.name, url: d.url }); setRightW(w => Math.max(w, 440)) }}>
                      <i className="pi pi-file" />
                      <span className="pp-ref-doc-name">{d.name}</span>
                      <i className="pi pi-chevron-right pp-ref-doc-arrow" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <div className="pp-gutter" onMouseDown={startDrag('left')} title="Drag to resize" />

          {/* Middle — the editable document */}
          <div className="pp-editor-main">
            <EditorToolbar editor={editor} />
            <div className="pp-editor-scroll">
              <div className="pp-paper pp-editor-paper">
                {docTitle && <h1 className="pp-doc-title">{docTitle}</h1>}
                <EditorContent editor={editor} />
              </div>
            </div>
          </div>

          <div className="pp-gutter" onMouseDown={startDrag('right')} title="Drag to resize" />

          {/* Right — a reference document (if opened), else the tabbed Chat / Review pane */}
          <aside className="pp-editor-side pp-editor-right">
            {refDoc ? (
              <div className="pp-refview">
                <div className="pp-refview-head">
                  <div className="pp-refview-title" title={refDoc.name}>
                    <span className="truncate"><i className="pi pi-file mr-2" />{refDoc.name}</span>
                    <div className="pp-refview-sub">Reference document</div>
                  </div>
                  <Button icon="pi pi-times" text rounded severity="secondary"
                    onClick={() => setRefDoc(null)} tooltip="Close" tooltipOptions={{ position: 'left' }} />
                </div>
                <div className="pp-refview-body"><InlineDocViewer fileUrl={refDoc.url} name={refDoc.name} /></div>
              </div>
            ) : (
              <div className="pp-rpane">
                <div className="pp-rtabs" role="tablist">
                  <button type="button" role="tab" className={`pp-rtab ${rightTab === 'review' ? 'active' : ''}`}
                    aria-selected={rightTab === 'review'} onClick={() => setRightTab('review')}>
                    <i className="pi pi-verified" /> Review
                  </button>
                  <button type="button" role="tab" className={`pp-rtab ${rightTab === 'chat' ? 'active' : ''}`}
                    aria-selected={rightTab === 'chat'} onClick={() => setRightTab('chat')}>
                    <i className="pi pi-comments" /> Chat
                  </button>
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
                <div className={`pp-rtab-slot ${rightTab === 'review' ? '' : 'pp-hidden'}`}
                  style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {/* Consistency panel — height controlled by drag handle */}
                  <div style={{ height: reviewTopH, minHeight: 80, flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <ConsistencyPanel
                      sessionId={session.id}
                      model={session.llm ?? 'local'}
                      getClauses={currentClauses}
                      onJump={scrollToClause}
                    />
                  </div>
                  {/* Drag handle */}
                  <div
                    style={{ height: 6, cursor: 'row-resize', flexShrink: 0, background: 'var(--pp-slate-200)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
                  >
                    <div style={{ width: 32, height: 2, borderRadius: 2, background: 'var(--pp-slate-400)' }} />
                  </div>
                  {/* Playbook panel — takes remaining height */}
                  <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
      <Dialog header="Save to AMS — pick the case" visible={pickAmsCase} style={{ width: 'min(560px, 95vw)' }}
        onHide={() => setPickAmsCase(false)}>
        <p className="mt-0 text-color-secondary text-sm">
          This draft isn't linked to an AMS case yet. Choose the case to file it on.
        </p>
        <AmsCasePicker onPick={c => sendToAms(c.id)} />
      </Dialog>
    </div>
    </RiskContext.Provider>
  )
}
