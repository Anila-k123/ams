import { authHeaders } from '../../api/client'
import CaseField from './components/CaseField'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DRAFTING } from './routes'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../contexts/ToastContext'
import { Button, EmptyState, PageHead, PopMenu, Skel } from '../../ui/kit'
import { SearchInput, TextField } from '../../ui/forms'
import { Modal, confirm } from '../../ui/overlays'
import Icon from '../../ui/Icon'
import FilePick from './components/FilePick'
import { AxiosError } from 'axios'
import DocumentViewer from './components/DocumentViewer'
import DocumentSummaryModal from '../../components/DocumentSummaryModal'
import { draftingApi, TRANSLATE_LANGUAGES, type Sample } from './api/drafting'
import { amsDocumentsApi, amsDocName, type AmsDocument, type AmsCase } from './api/ams'

// All of the user's AMS documents (the endpoint is paginated).
async function allAmsDocuments(): Promise<AmsDocument[]> {
  const out: AmsDocument[] = []
  for (let page = 0; ; page += 1) {
    const r = await amsDocumentsApi.list('', page)
    out.push(...r.content)
    if (page + 1 >= (r.totalPages || 1)) break
  }
  return out
}

// Processing status as a Red Tape chip tone.
const STATUS_TONE: Record<string, string> = {
  ready: 'ok',
  processing: 'info',
  pending: 'warn',
  failed: 'bad',
}

const fmtDate = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

/** The "Documents" page: lists uploaded samples as cards, lets the user upload new ones
 *  (parsed and embedded asynchronously, with live status polling) and translate them.
 *  Summaries are AMS's own: the Summary button opens the AMS document's summary. */
export default function Samples() {
  const navigate = useNavigate()
  // Signed in from AMS: the page lists the user's AMS documents (never the shared library);
  // `samples` then holds only their imports of those documents.
  // Everyone is an AMS user now: documents come from AMS.
  const fromAms = true
  const [amsDocs, setAmsDocs] = useState<AmsDocument[]>([])
  const [preparing, setPreparing] = useState<Set<number>>(new Set())   // AMS ids being imported
  const [samples, setSamples] = useState<Sample[]>([])  // the document cards
  const [loading, setLoading] = useState(true)          // true until the initial fetch resolves
  const [query, setQuery] = useState('')                // search-box filter (matches document name)
  const [showUpload, setShowUpload] = useState(false)   // upload dialog open/closed
  // Optional AMS case; the backend derives the drafting client/project from it.
  const [amsCase, setAmsCase] = useState<AmsCase | null>(null)
  const [error, setError] = useState('')                // upload dialog: error message
  const [busy, setBusy] = useState(false)               // true while the upload request is in flight
  const [viewing, setViewing] = useState<Sample | null>(null)  // sample shown in DocumentViewer
  // The AMS document whose (AMS) summary is open.
  const [summaryFor, setSummaryFor] = useState<{ id: number; documentName: string } | null>(null)
  // Upload dialog: clause-library tagging (populated automatically on upload).
  const [contractType, setContractType] = useState('')        // e.g. 'nda'

  const toast = useToast()
  // Popup language menu for inline Translate: the button it hangs off and its sample.
  const [langFor, setLangFor] = useState<{ s: Sample; anchor: HTMLElement } | null>(null)
  // Mirror of `samples` in a ref so the polling interval (set up once) always sees the
  // latest list without being re-created on every render.
  const samplesRef = useRef<Sample[]>([])
  samplesRef.current = samples
  // Previous translation statuses, to fire a completion toast when one flips
  // from 'generating' to a settled state (regardless of which tab started it).
  const prevJob = useRef<Record<number, { t?: string }>>({})

  const load = () => fromAms
    ? Promise.all([draftingApi.getAllSamples(), allAmsDocuments()])
        .then(([s, d]) => { setSamples(s); setAmsDocs(d) })
        .catch(() => toast.error('Could not load your PactPro documents'))
    : draftingApi.getAllSamples().then(setSamples)

  // A sample has background work in flight if it's still parsing, or a translation
  // is generating — poll while either is true.
  const anyInFlight = (list: Sample[]) => list.some(s =>
    s.status === 'pending' || s.status === 'processing' ||
    s.translation_status === 'generating')

  // On mount: load samples + clients, then poll every 3s while any job is in flight.
  useEffect(() => {
    load().finally(() => setLoading(false))
    const id = setInterval(() => { if (anyInFlight(samplesRef.current)) load() }, 3000)
    return () => clearInterval(id)
  }, [fromAms])  // eslint-disable-line react-hooks/exhaustive-deps

  // Import (or refresh to AMS's latest version) so the document can be translated
  // and drafted from. Processing then runs in the background.
  const prepare = async (d: AmsDocument) => {
    setPreparing(prev => new Set(prev).add(d.id))
    try {
      await amsDocumentsApi.prepare(d.id)
      await load()
    } catch {
      toast.error(`Could not open the document: ${amsDocName(d)}`)
    } finally {
      setPreparing(prev => { const next = new Set(prev); next.delete(d.id); return next })
    }
  }

  // Fire a toast when a translation finishes (generating → ready/failed).
  useEffect(() => {
    const prev = prevJob.current
    samples.forEach(s => {
      const p = prev[s.id] || {}
      if (p.t === 'generating' && s.translation_status !== 'generating') {
        if (s.translation_status === 'ready') toast.success(`Translation ready for ${s.name}. Open Translation to view it.`)
        else toast.error(`Translation failed: ${s.name}`)
      }
    })
    prevJob.current = Object.fromEntries(samples.map(s => [s.id, { t: s.translation_status }]))
  }, [samples])  // eslint-disable-line react-hooks/exhaustive-deps

  // Optimistically flip a sample's job status locally so the button shows a spinner
  // immediately, before the next poll confirms it server-side.
  const markJob = (id: number, patch: Partial<Sample>) =>
    setSamples(prev => prev.map(x => (x.id === id ? { ...x, ...patch } : x)))

  // Inline kickoff — Translate into `target`, chosen from the card's language menu.
  const runTranslate = async (s: Sample, target: string) => {
    try {
      await draftingApi.translateSample(s.id, target)
      markJob(s.id, { translation_status: 'generating', translation_target: target })
    } catch {
      toast.error(`Could not start translation: ${s.name}`)
    }
  }

  // Documents whose name contains the search query (case-insensitive).
  const filtered = useMemo(
    () => samples.filter(s => s.name.toLowerCase().includes(query.toLowerCase())),
    [samples, query],
  )
  // AMS mode: one card per AMS document, with its import (if prepared).
  const amsCards = useMemo(() => {
    const q = query.toLowerCase()
    return amsDocs
      .filter(d => [amsDocName(d), d.caseNumber, d.clientName].some(x => (x || '').toLowerCase().includes(q)))
      .map(d => ({ doc: d, sample: samples.find(x => x.ams_document_id === d.id) }))
  }, [amsDocs, samples, query])

  // Upload a document under the chosen client/project. Parsing + embedding run server-side
  // afterward, so we just close the dialog and let the status poller pick up the progress.
  const handleUpload = async (event: { files: File[] }) => {
    const file = event.files[0]
    setBusy(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('name', file.name)
    if (amsCase) fd.append('case_id', String(amsCase.id))
    if (contractType.trim()) fd.append('contract_type', contractType.trim())
    try {
      await draftingApi.uploadSample(fd)
      setShowUpload(false)
      setError('')
      toast.success(`${file.name} uploaded. It is being processed; the status will update shortly.`)
      load()
    } catch {
      setError('Upload failed. Check the file is a PDF or DOCX.')
    } finally {
      setBusy(false)
    }
  }

  // Fetch the file as a blob and trigger a browser download via a temporary anchor element.
  const download = async (s: Sample) => {
    if (!s.file) return
    try {
      const resp = await fetch(s.file, { headers: authHeaders() })
      const blob = await resp.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = s.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(a.href)
    } catch {
      toast.error('Download failed')
    }
  }

  // Ask for confirmation, then delete the document (and its clauses) and reload.
  const confirmDelete = (s: Sample) => {
    confirm({
      title: 'Delete this document?',
      message: `${s.name} will be deleted. Its extracted clauses are also removed.`,
      confirmLabel: 'Delete document',
      danger: true,
      accept: async () => {
        try {
          await draftingApi.deleteSample(s.id)
          toast.success(`${s.name} deleted`)
          load()
        } catch (err) {
          const ax = err as AxiosError<{ detail?: string }>
          toast.error(ax.response?.data?.detail ?? 'Delete failed.')
        }
      },
    })
  }


  const actions = (s: Sample, canDelete: boolean) => (
    <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
      {/* Summaries are AMS's own (documents/summarizer.py): one per AMS document, made on
          upload. Drafting no longer runs a second summary of its own. */}
      {s.ams_document_id && (
        <Button size="sm" icon="note" onClick={() => setSummaryFor({ id: s.ams_document_id!, documentName: s.name })}>Summary</Button>
      )}
      {s.translation_status === 'ready' ? (
        // Translation done: opens the side-by-side view (re-translate to other languages there).
        <Button size="sm" icon="ok" disabled={s.status !== 'ready'} onClick={() => navigate(DRAFTING.sampleTool(s.id, 'translate'))}>Translation</Button>
      ) : (
        <Button size="sm" icon="translate" aria-haspopup="menu"
          loading={s.translation_status === 'generating'}
          disabled={s.status !== 'ready' || s.translation_status === 'generating'}
          onClick={e => setLangFor({ s, anchor: e.currentTarget })}>
          {s.translation_status === 'generating' ? 'Translating…' : 'Translate'}
        </Button>
      )}
      <Button size="sm" icon="eye" disabled={!s.file} onClick={() => setViewing(s)}>View</Button>
      <Button size="sm" icon="download" disabled={!s.file} onClick={() => download(s)}>Download</Button>
      {canDelete && (
        <button type="button" className="btn ghost sm icon" aria-label={`Delete ${s.name}`} title="Delete" onClick={() => confirmDelete(s)}>
          <Icon name="trash" size="sm" />
        </button>
      )}
    </div>
  )

  const statusTag = (st: Sample['status']) => (
    <span className={`chip ${STATUS_TONE[st] ?? ''}${st === 'processing' || st === 'pending' ? ' plain' : ''}`}>
      {(st === 'processing' || st === 'pending') && <span className="pp-spin" aria-hidden="true" />}
      {st.charAt(0).toUpperCase() + st.slice(1)}
    </span>
  )

  const docRow = (key: number, name: string, meta: React.ReactNode, right: React.ReactNode, body: React.ReactNode) => (
    <div key={key} className="panel">
      <div className="panel-body">
        <div className="row between wrap" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
            <span className="dr-file-ic"><Icon name="file" /></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500, wordBreak: 'break-word' }}>{name}</div>
              <div className="faint xs" style={{ marginTop: 2 }}>{meta}</div>
            </div>
          </div>
          {right}
        </div>
        {body}
      </div>
    </div>
  )

  return (
    <div>
      {/* Popup language picker for inline Translate: targets the last-clicked card. */}
      {langFor && (
        <PopMenu anchor={langFor.anchor} onClose={() => setLangFor(null)} width={200}
          items={TRANSLATE_LANGUAGES
            .filter(l => l.value !== (langFor.s.language ?? 'en'))
            .map(l => ({ label: l.label, onClick: () => runTranslate(langFor.s, l.value) }))} />
      )}
      {summaryFor && <DocumentSummaryModal doc={summaryFor} onClose={() => setSummaryFor(null)} />}
      <DocumentViewer visible={!!viewing} onHide={() => setViewing(null)} fileUrl={viewing?.file} name={viewing?.name} />

      <PageHead title="Draft Documents"
        sub="Case documents prepared for drafting. Translate them, read their summaries, or draft from them."
        actions={<Button variant="primary" icon="upload" onClick={() => { setError(''); setContractType(''); setShowUpload(true) }}>Upload document</Button>} />

      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search documents by name, case or client" />
      </div>

      {loading && (
        <div className="stack" style={{ gap: 12 }}>
          {[1, 2, 3].map(i => <div key={i} className="panel"><div className="panel-body stack" style={{ gap: 8 }}><Skel w="40%" h={16} /><Skel w="25%" /></div></div>)}
        </div>
      )}

      {!loading && (fromAms ? amsCards.length === 0 : filtered.length === 0) && (
        <div className="panel">
          <EmptyState icon="folder" title={query ? 'No documents match' : 'No documents yet'}
            text={fromAms ? 'No PDF or Word documents in PactPro yet. Upload one to draft from it.' : 'Upload a PDF or DOCX to begin.'}
            action={<Button variant="primary" size="sm" icon="upload" onClick={() => setShowUpload(true)}>Upload document</Button>} />
        </div>
      )}

      {!loading && fromAms && (
        <div className="stack" style={{ gap: 12 }}>
          {amsCards.map(({ doc: d, sample: s }) => {
            const current = !!s && s.ams_version === d.version
            return docRow(d.id, amsDocName(d),
              <>{fmtDate(d.uploadDate)}{d.caseNumber && <> · <span className="mono">{d.caseNumber}</span></>}{d.uploadedByName && <> · by {d.uploadedByName}</>} · v{d.version}</>,
              s && current ? statusTag(s.status) : <span className={`chip ${s ? 'warn' : 'info'}`}>{s ? `Update to v${d.version}` : 'In PactPro'}</span>,
              s && current && s.status !== 'failed' ? actions(s, false) : (
                <div className="row wrap" style={{ gap: 10, marginTop: 12 }}>
                  <Button size="sm" variant="primary" icon="cog" loading={preparing.has(d.id)} disabled={preparing.has(d.id)}
                    onClick={() => prepare(d)}>
                    {s ? (s.status === 'failed' ? 'Try again' : `Update to v${d.version}`) : 'Prepare for drafting'}
                  </Button>
                  <span className="faint xs">Reads the file from your documents so you can translate and draft from it.</span>
                </div>
              ))
          })}
        </div>
      )}

      {!loading && !fromAms && (
        <div className="stack" style={{ gap: 12 }}>
          {filtered.map(s => docRow(s.id, s.name,
            <>{fmtDate(s.created_at)} · {(s.language ?? 'en').toUpperCase()}</>,
            statusTag(s.status), actions(s, true)))}
        </div>
      )}

      {/* Upload dialog */}
      <Modal title="Upload document" sub="PDF or Word, up to 10 MB." open={showUpload} onClose={() => setShowUpload(false)}
        footer={<button type="button" className="btn ghost" onClick={() => setShowUpload(false)}>Cancel</button>}>
        <div className="stack" style={{ gap: 14 }}>
          {error && <div className="callout bad" role="alert"><Icon name="warn" size="sm" /><div>{error}</div></div>}
          <CaseField value={amsCase} onChange={setAmsCase} disabled={busy} />
          {fromAms && (
            <div className="callout info"><Icon name="info" size="sm" /><div>The document is prepared for drafting here.</div></div>
          )}
          {!fromAms && (
            <TextField label="Contract type" value={contractType} onChange={e => setContractType(e.target.value)} placeholder="NDA"
              hint="Its clauses are added to the clause library under this type (match your template's agreement type). Leave blank to skip the library." />
          )}
          <FilePick label={busy ? 'Uploading…' : 'Choose a file to upload'} onUpload={handleUpload} disabled={busy} />
          <p className="faint small">
            The document is processed after upload (and added to the clause library if a contract type is set). Status updates automatically.
          </p>
        </div>
      </Modal>
    </div>
  )
}
