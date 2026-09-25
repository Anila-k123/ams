import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { DRAFTING } from './routes'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Button } from 'primereact/button'
import { Dropdown } from 'primereact/dropdown'
import { Tag } from 'primereact/tag'
import { Message } from 'primereact/message'
import { ProgressSpinner } from 'primereact/progressspinner'
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

  if (!fileUrl) return <Message severity="warn" className="w-full" text="No file available." />
  if (loading) return <div className="flex flex-column align-items-center p-6 gap-3"><ProgressSpinner style={{ width: 40, height: 40 }} /><span className="text-color-secondary" style={{ fontSize: '0.85rem' }}>Loading document…</span></div>
  if (error) return <Message severity="error" className="w-full" text={error} />
  if (isPdf && pdfUrl) return <iframe title={name ?? 'document'} src={pdfUrl} style={{ width: '100%', height: '100%', border: 'none' }} />
  if (isDocx) return <div className="pp-docx-preview" style={{ fontSize: '0.85rem' }} dangerouslySetInnerHTML={{ __html: html }} />
  return <Message severity="warn" className="w-full" text="In-app preview isn't supported for this file type." />
}

// ── document-view renderer for the translation ────────────────────────────────
// Mimics a printed legal document: a centred white "page" with serif type, bold
// centred headings, and justified body paragraphs with real spacing between them.
const pageBackdrop: CSSProperties = { background: '#e9edf2', padding: '1.25rem 0.75rem', minHeight: '100%' }
const pageSheet: CSSProperties = {
  background: '#fff', maxWidth: 720, margin: '0 auto', padding: '3.25rem 3rem',
  boxShadow: '0 1px 6px rgba(0,0,0,0.14)', fontFamily: '"Times New Roman", Georgia, serif',
  color: '#1a1a1a', fontSize: '1.02rem', lineHeight: 1.7,
}
const docHeading: CSSProperties = { fontWeight: 700, textAlign: 'center', fontSize: '1.08rem', margin: '0 0 0.6rem', letterSpacing: '0.01em' }
const docPara: CSSProperties = { textAlign: 'justify', margin: '0 0 0.75rem', hyphens: 'auto' }

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
    <div style={pageBackdrop}>
      <div style={pageSheet}>
        {blocks?.length
          ? blocks.map((blk, i) => (
              <div key={i} style={{ marginBottom: blk.heading && !blk.body ? '0.2rem' : '1rem' }}>
                {blk.heading && <p style={docHeading}>{richNodes(blk.heading)}</p>}
                {blk.body && toParas(blk.body).map((p, j) => <p key={j} style={docPara}>{richNodes(p)}</p>)}
              </div>
            ))
          : toParas(text ?? '').map((p, j) => <p key={j} style={docPara}>{richNodes(p)}</p>)}
      </div>
    </div>
  )
}

const paneStyle: CSSProperties = { flex: 1, minWidth: 0, background: '#fff', border: '1px solid var(--surface-300, #e5e7eb)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
const paneHead: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.6rem 0.9rem', borderBottom: '1px solid var(--surface-300, #e5e7eb)', flexWrap: 'wrap' }
const paneTitle: CSSProperties = { color: 'var(--primary-color)', fontWeight: 600, fontSize: '0.95rem' }
const shell: CSSProperties = { height: '100vh', display: 'flex', flexDirection: 'column', padding: '0.9rem 1rem', boxSizing: 'border-box', background: '#f1f5f9' }

/**
 * Standalone full-screen translation view (no app sidebar): the original document
 * on the left, its translation on the right. The user picks a target language and
 * hits Translate; the source language is auto-detected on the server. Async with
 * polling, mirroring the summary view.
 */
export default function DocumentTranslate() {
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

  if (loading) return <div style={{ ...shell, alignItems: 'center', justifyContent: 'center' }}><ProgressSpinner style={{ width: 44, height: 44 }} /></div>
  if (!sample) return <div style={shell}><Message severity="error" className="w-full" text={error || 'Document not found.'} /></div>

  const ready = sample.translation_status === 'ready'

  return (
    <div style={shell}>
      {/* Top bar */}
      <div className="flex align-items-center gap-2 mb-2" style={{ flex: '0 0 auto' }}>
        <Button icon="pi pi-arrow-left" text rounded onClick={() => navigate(DRAFTING.samples)} tooltip="Back to Documents" />
        <span className="font-semibold" style={{ fontSize: '1.1rem', wordBreak: 'break-word' }}>{sample.name}</span>
      </div>

      {/* Split: document (left) · translation (right) */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 14 }}>
        {/* Left — original document */}
        <div style={paneStyle}>
          <div style={paneHead}>
            <span style={paneTitle}><i className="pi pi-file mr-2" />Original Document</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}><DocPanel fileUrl={sample.file} name={sample.name} /></div>
        </div>

        {/* Right — translation */}
        <div style={paneStyle}>
          <div style={paneHead}>
            <span style={paneTitle}><i className="pi pi-language mr-2" />Translation</span>
            <Button label="Download PDF" icon="pi pi-file-pdf" size="small" outlined
              disabled={!(sample.translation_json?.length || sample.translation)} onClick={downloadPdf} />
          </div>

          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Controls (padded) */}
            <div style={{ padding: '0.9rem', flex: '0 0 auto' }}>
              <div className="flex align-items-end gap-2">
                <div className="flex flex-column gap-1">
                  <label className="font-medium" style={{ fontSize: '0.78rem' }}>Translate to</label>
                  <Dropdown value={target} options={TRANSLATE_LANGUAGES} optionLabel="label" optionValue="value"
                    onChange={e => setTarget(e.value)} disabled={translating} style={{ fontSize: '0.82rem' }} />
                </div>
                <Button label={ready ? 'Re-translate' : 'Translate'} icon="pi pi-language" size="small"
                  onClick={() => runTranslate()} loading={translating} disabled={sample.status !== 'ready'} />
                {!translating && ready && (sample.translation_json?.length || sample.translation) && (
                  <Tag className="ml-1" value={`${langLabel(sample.translation_source)} → ${langLabel(sample.translation_target)}`} style={{ fontSize: '0.72rem' }} />
                )}
              </div>
              {sample.status !== 'ready' && (
                <Message severity="warn" className="w-full mt-3" text="Document is still being processed — translation unlocks when it's ready." />
              )}
              {error && <Message severity="warn" className="w-full mt-3" text={error} />}
            </div>

            {/* Document view (fills remaining height, scrolls) */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {translating && (
                <div className="flex flex-column align-items-center gap-3 p-5">
                  <ProgressSpinner style={{ width: 40, height: 40 }} />
                  <span className="text-color-secondary" style={{ fontSize: '0.85rem' }}>Translating…</span>
                </div>
              )}
              {!translating && ready && (sample.translation_json?.length || sample.translation) && (
                <TranslatedDocument blocks={sample.translation_json} text={sample.translation} />
              )}
              {!translating && !ready && !error && sample.status === 'ready' && (
                <span className="text-color-secondary" style={{ fontSize: '0.85rem', display: 'block', padding: '0.9rem' }}>
                  Pick a target language and click <strong>Translate</strong>.
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
