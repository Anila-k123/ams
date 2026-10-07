import { useEffect, useRef, useState } from 'react'
import { DRAFTING } from './routes'
import { usePermission } from '../../contexts/PermissionContext'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Button, Spinner, EmptyState } from '../../ui/kit'
import Icon from '../../ui/Icon'
import '../../ui/pages/drafting.css'
import * as mammoth from 'mammoth'
import { draftingApi, TRANSLATE_LANGUAGES, type Sample } from './api/drafting'

const langLabel = (code?: string) =>
  TRANSLATE_LANGUAGES.find(l => l.value === code)?.label ?? (code || '—')

// ── inline document renderer (PDF via blob iframe, DOCX via mammoth) ───────────
function DocPanel({ fileUrl, name }: { fileUrl?: string | null; name?: string }) {
  const [html, setHtml] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const isPdf = !!fileUrl && /\.pdf(\?|$)/i.test(fileUrl)
  const isDocx = !!fileUrl && /\.docx?(\?|$)/i.test(fileUrl)

  useEffect(() => {
    if (!fileUrl || (!isPdf && !isDocx)) return
    let cancelled = false
    let objectUrl = ''
    setLoading(true); setError(''); setHtml(''); setPdfUrl('')
    fetch(fileUrl)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer() })
      .then(async buf => {
        if (cancelled) return
        if (isDocx) {
          const res = await mammoth.convertToHtml({ arrayBuffer: buf })
          if (!cancelled) setHtml(res.value || '<p>(empty document)</p>')
        } else {
          objectUrl = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }))
          if (!cancelled) setPdfUrl(objectUrl)
        }
      })
      .catch(() => { if (!cancelled) setError('Could not load this document.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [fileUrl, isPdf, isDocx])

  if (!fileUrl) return <div className="callout warn" style={{ margin: 16 }}><Icon name="warn" size="sm" /><div>No file available.</div></div>
  if (loading) return <div className="row" style={{ justifyContent: 'center', padding: 48 }}><Spinner label="Loading document" /></div>
  if (error) return <div className="callout bad" style={{ margin: 16 }}><Icon name="warn" size="sm" /><div>{error}</div></div>
  if (isPdf && pdfUrl) return <iframe title={name ?? 'document'} src={pdfUrl} style={{ width: '100%', height: '100%', minHeight: '70vh', border: 'none' }} />
  if (isDocx) return <div className="paper-sheet pp-docx-preview" dangerouslySetInnerHTML={{ __html: html }} />
  return <div className="callout warn" style={{ margin: 16 }}><Icon name="warn" size="sm" /><div>In-app preview isn't supported for this file type.</div></div>
}

// ── document-view renderer for the translation ────────────────────────────────
// The translation is set on a Red Tape paper sheet (Newsreader, justified body,
// centred bold headings), like a printed legal document.
// Split a clause body into display paragraphs (numbered sub-clauses stay separate).
const toParas = (text: string) => text.split(/\n+/).map(s => s.trim()).filter(Boolean)

// Render markdown-bold (**…**) inline: odd split segments are the bold runs.
const richNodes = (text: string) =>
  text.split(/\*\*(.+?)\*\*/g).map((seg, i) => (i % 2 ? <strong key={i}>{seg}</strong> : <span key={i}>{seg}</span>))

// Same, but as an HTML string for the print/PDF window.
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const richHtml = (s: string) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

function TranslatedDocument({ blocks, text }: { blocks?: { heading?: string; body?: string }[]; text?: string }) {
  return (
    <article className="paper-sheet dr-tr-sheet" aria-label="Translation">
      {blocks?.length
        ? blocks.map((blk, i) => (
            <div key={i} style={{ marginBottom: blk.heading && !blk.body ? 4 : 16 }}>
              {blk.heading && <p className="dr-tr-h">{richNodes(blk.heading)}</p>}
              {blk.body && toParas(blk.body).map((p, j) => <p key={j} className="dr-tr-p">{richNodes(p)}</p>)}
            </div>
          ))
        : toParas(text ?? '').map((p, j) => <p key={j} className="dr-tr-p">{richNodes(p)}</p>)}
    </article>
  )
}

/**
 * Standalone full-screen translation view (no app sidebar): the original document
 * on the left, its translation on the right. The user picks a target language and
 * hits Translate; the source language is auto-detected on the server. Async with
 * polling, mirroring the summary view.
 */
export default function DocumentTranslate() {
  const { hasPermission } = usePermission() as any
  const { id } = useParams()
  const sampleId = Number(id)
  const navigate = useNavigate()
  const location = useLocation()

  const [sample, setSample] = useState<Sample | null>(null)
  const [loading, setLoading] = useState(true)
  const [target, setTarget] = useState('en')
  const [translating, setTranslating] = useState(false)
  const [error, setError] = useState('')
  const activeId = useRef<number | null>(null)
  const autoRan = useRef(false)   // guard the one-shot auto-run from the dashboard dialog

  useEffect(() => {
    activeId.current = sampleId
    setLoading(true)
    draftingApi.getSample(sampleId)
      .then(s => { setSample(s); if (s.translation_target) setTarget(s.translation_target) })
      .catch(() => setError('Could not load this document.'))
      .finally(() => setLoading(false))
    return () => { activeId.current = null }
  }, [sampleId])

  const runTranslate = async (t = target) => {
    setError(''); setTranslating(true)
    try {
      await draftingApi.translateSample(sampleId, t)
    } catch {
      setError('Could not start translation — please try again.')
      setTranslating(false); return
    }
    const poll = async () => {
      if (activeId.current !== sampleId) return
      try {
        const fresh = await draftingApi.getSample(sampleId)
        if (activeId.current !== sampleId) return
        setSample(fresh)
        if (fresh.translation_status === 'ready') setTranslating(false)
        else if (fresh.translation_status === 'failed') { setError('Translation failed — try again.'); setTranslating(false) }
        else setTimeout(poll, 2500)
      } catch { setTimeout(poll, 2500) }
    }
    setTimeout(poll, 2500)
  }

  // Arriving from the dashboard "Upload & Translate" dialog: auto-start once loaded.
  useEffect(() => {
    const st = location.state as { autoRun?: boolean; target?: string } | null
    if (st?.autoRun && !autoRan.current && sample && sample.status === 'ready') {
      autoRan.current = true
      const t = st.target || target
      setTarget(t)
      runTranslate(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample, location.state])

  // Export the translation as a PDF via the browser's print engine — it shapes
  // Indic scripts correctly (Devanagari/Tamil/… conjuncts) using system fonts,
  // which client-side PDF libraries do poorly. The user picks "Save as PDF".
  const downloadPdf = () => {
    if (!sample) return
    const blocks = sample.translation_json
    const title = sample.name.replace(/\.[^.]+$/, '')
    const paras = (s: string) => s.split(/\n+/).map(t => t.trim()).filter(Boolean).map(p => `<p>${richHtml(p)}</p>`).join('')
    const bodyHtml = blocks?.length
      ? blocks.map(b => `<section>${b.heading ? `<h2>${richHtml(b.heading)}</h2>` : ''}${b.body ? paras(b.body) : ''}</section>`).join('')
      : paras(sample.translation || '')
    const html =
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<style>@page{margin:25mm 20mm}` +
      `body{font-family:"Times New Roman",Georgia,serif;color:#111;font-size:12pt;line-height:1.7}` +
      `h2{text-align:center;font-size:13pt;font-weight:700;margin:0 0 .5rem}` +
      `p{text-align:justify;margin:0 0 .6rem}section{margin-bottom:1rem}</style></head><body>` +
      bodyHtml +
      `<script>window.onload=function(){window.focus();window.print()}<\/script></body></html>`
    const win = window.open('', '_blank')
    if (!win) return
    win.document.open(); win.document.write(html); win.document.close()
  }

  if (loading) return <div className="dr-fs dr-center"><Spinner label="Loading document" /></div>
  if (!sample) return (
    <div className="dr-fs dr-center">
      <EmptyState icon="file" title="Document not found" text={error || 'It may have been deleted.'}
        action={<button type="button" className="btn" onClick={() => navigate(DRAFTING.samples)}>Back to documents</button>} />
    </div>
  )

  const ready = sample.translation_status === 'ready'
  const hasText = !!(sample.translation_json?.length || sample.translation)

  return (
    <div className="dr-fs">
      <div className="ed-top">
        <button type="button" className="btn ghost sm" onClick={() => navigate(DRAFTING.samples)}><Icon name="chevronLeft" size="sm" />Documents</button>
        <div className="grow" style={{ minWidth: 200 }}>
          <h1 className="serif" style={{ wordBreak: 'break-word' }}>{sample.name}</h1>
          <div className="faint xs">Translation</div>
        </div>
        {hasPermission('DRAFT_EXPORT') && (
          <Button size="sm" icon="download" disabled={!hasText} onClick={downloadPdf}>Download PDF</Button>
        )}
      </div>

      <div className="row wrap toolbar" style={{ gap: 8, alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="tr-target">Translate to</label>
          <select id="tr-target" className="input" value={target} onChange={e => setTarget(e.target.value)} disabled={translating}>
            {TRANSLATE_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <Button variant="primary" icon="translate" onClick={() => runTranslate()} loading={translating} disabled={sample.status !== 'ready' || translating}>
          {ready ? 'Re-translate' : 'Translate'}
        </Button>
        {!translating && ready && hasText && (
          <span className="chip info">{`${langLabel(sample.translation_source)} → ${langLabel(sample.translation_target)}`}</span>
        )}
      </div>
      {sample.status !== 'ready' && (
        <div className="callout warn" style={{ marginBottom: 12 }}><Icon name="warn" size="sm" /><div>The document is still being processed. Translation unlocks when it is ready.</div></div>
      )}
      {error && <div className="callout warn" role="alert" style={{ marginBottom: 12 }}><Icon name="warn" size="sm" /><div>{error}</div></div>}

      <div className="pp-two dr-tr-two">
        <section className="panel dr-tr-pane" aria-label="Original document">
          <div className="panel-head"><h2 className="small"><Icon name="file" size="sm" /> Original document</h2></div>
          <div className="dr-tr-body"><DocPanel fileUrl={sample.file} name={sample.name} /></div>
        </section>
        <section className="panel dr-tr-pane" aria-label="Translation">
          <div className="panel-head"><h2 className="small"><Icon name="translate" size="sm" /> Translation</h2></div>
          <div className="dr-tr-body">
            {translating && <div className="row" style={{ justifyContent: 'center', padding: 48 }}><Spinner label="Translating" /></div>}
            {!translating && ready && hasText && (
              <TranslatedDocument blocks={sample.translation_json} text={sample.translation} />
            )}
            {!translating && !ready && !error && sample.status === 'ready' && (
              <p className="faint small" style={{ padding: 16 }}>Pick a target language and choose <strong>Translate</strong>.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
