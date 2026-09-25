import { authHeaders } from '../../api/client'
import CaseField from './components/CaseField'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DRAFTING } from './routes'
import { useNavigate } from 'react-router-dom'
import { Tag } from 'primereact/tag'
import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { FileUpload } from 'primereact/fileupload'
import { InputText } from 'primereact/inputtext'
import { Message } from 'primereact/message'
import { Toast } from 'primereact/toast'
import { Menu } from 'primereact/menu'
import { ProgressSpinner } from 'primereact/progressspinner'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
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

// Maps a sample's processing status to the PrimeReact Tag colour.
const STATUS_SEVERITY: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
  ready: 'success',
  processing: 'info',
  pending: 'warning',
  failed: 'danger',
}

// Picks a file-type icon from the filename extension.
function fileIcon(name?: string): string {
  const n = (name ?? '').toLowerCase()
  if (n.endsWith('.pdf')) return 'pi pi-file-pdf'
  if (n.endsWith('.docx') || n.endsWith('.doc')) return 'pi pi-file-word'
  return 'pi pi-file'
}

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

  const toast = useRef<Toast>(null)
  const langMenu = useRef<Menu>(null)                    // popup language menu for inline Translate
  const [langFor, setLangFor] = useState<Sample | null>(null)  // sample the language menu targets
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
        .catch(() => toast.current?.show({ severity: 'error', summary: 'Could not load your AMS documents', life: 5000 }))
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
      toast.current?.show({ severity: 'error', summary: 'Could not open it from AMS', detail: amsDocName(d), life: 5000 })
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
        toast.current?.show(s.translation_status === 'ready'
          ? { severity: 'success', summary: 'Translation ready', detail: `"${s.name}" — click Translation to view.`, life: 5000 }
          : { severity: 'error', summary: 'Translation failed', detail: s.name, life: 5000 })
      }
    })
    prevJob.current = Object.fromEntries(samples.map(s => [s.id, { t: s.translation_status }]))
  }, [samples])

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
      toast.current?.show({ severity: 'error', summary: 'Could not start translation', detail: s.name, life: 4000 })
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
      toast.current?.show({
        severity: 'success', summary: 'Document uploaded',
        detail: `"${file.name}" is being processed — status will update shortly.`, life: 5000,
      })
      load()
    } catch {
      setError('Upload failed — check the file is a PDF or DOCX.')
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
      toast.current?.show({ severity: 'error', summary: 'Download failed', life: 4000 })
    }
  }

  // Ask for confirmation, then delete the document (and its clauses) and reload.
  const confirmDelete = (s: Sample) => {
    confirmDialog({
      message: `Delete document "${s.name}"? Its extracted clauses will also be removed.`,
      header: 'Delete document',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await draftingApi.deleteSample(s.id)
          toast.current?.show({ severity: 'success', summary: 'Deleted', detail: `"${s.name}" removed.`, life: 3000 })
          load()
        } catch (err) {
          const ax = err as AxiosError<{ detail?: string }>
          toast.current?.show({
            severity: 'error', summary: 'Could not delete',
            detail: ax.response?.data?.detail ?? 'Delete failed.', life: 5000,
          })
        }
      },
    })
  }


  const actions = (s: Sample, canDelete: boolean) => (
    <div className="flex flex-wrap gap-2 mt-3">
      {/* Summaries are AMS's own (documents/summarizer.py): one per AMS document, made on
          upload. Drafting no longer runs a second summary of its own. */}
      {s.ams_document_id && (
        <Button label="Summary" icon="pi pi-align-left" size="small" outlined
          onClick={() => setSummaryFor({ id: s.ams_document_id, documentName: s.name })} />
      )}
      {s.translation_status === 'ready' ? (
        // Translation done — green, opens the panel (re-translate to other languages there).
        <Button label="Translation" icon="pi pi-check-circle" size="small" outlined severity="success"
          disabled={s.status !== 'ready'} onClick={() => navigate(DRAFTING.sampleTool(s.id, 'translate'))} />
      ) : (
        <Button label={s.translation_status === 'generating' ? 'Translating…' : 'Translate'} icon="pi pi-language" size="small" outlined
          loading={s.translation_status === 'generating'}
          disabled={s.status !== 'ready' || s.translation_status === 'generating'}
          onClick={e => { setLangFor(s); langMenu.current?.toggle(e) }} />
      )}
      <Button label="View" icon="pi pi-eye" size="small" outlined
        disabled={!s.file} onClick={() => setViewing(s)} />
      <Button label="Download" icon="pi pi-download" size="small" outlined
        disabled={!s.file} onClick={() => download(s)} />
      {canDelete && (
        <Button icon="pi pi-trash" size="small" text severity="danger"
          tooltip="Delete" tooltipOptions={{ position: 'top' }} onClick={() => confirmDelete(s)} />
      )}
    </div>
  )

  const statusTag = (st: Sample['status']) => (
    <Tag
      value={st.charAt(0).toUpperCase() + st.slice(1)}
      severity={STATUS_SEVERITY[st]}
      icon={st === 'processing' || st === 'pending' ? 'pi pi-spin pi-spinner' : undefined}
    />
  )

  return (
    <div>
      <Toast ref={toast} />
      <ConfirmDialog />
      {/* Popup language picker for inline Translate — targets the last-clicked card. */}
      <Menu popup ref={langMenu} model={TRANSLATE_LANGUAGES
        .filter(l => l.value !== (langFor?.language ?? 'en'))
        .map(l => ({ label: l.label, command: () => langFor && runTranslate(langFor, l.value) }))} />
      {summaryFor && <DocumentSummaryModal doc={summaryFor} onClose={() => setSummaryFor(null)} />}
      <DocumentViewer visible={!!viewing} onHide={() => setViewing(null)} fileUrl={viewing?.file} name={viewing?.name} />

      <div className="pp-page-head flex justify-content-end">
        <div className="flex align-items-center gap-2 flex-wrap">
          <span className="p-input-icon-left">
            <i className="pi pi-search" />
            <InputText value={query} onChange={e => setQuery(e.target.value)} placeholder="Search documents" />
          </span>
          <Button label="Upload Documents" icon="pi pi-upload" onClick={() => { setError(''); setContractType(''); setShowUpload(true) }} />
        </div>
      </div>

      {loading && <div className="flex justify-content-center p-5"><ProgressSpinner style={{ width: 44, height: 44 }} /></div>}

      {!loading && (fromAms ? amsCards.length === 0 : filtered.length === 0) && (
        <div className="pp-card text-center text-color-secondary">
          {fromAms
            ? <>No PDF or Word documents in your AMS yet — click <strong>Upload Documents</strong> to add one.</>
            : <>No documents yet — click <strong>Upload Documents</strong> to add a PDF or DOCX.</>}
        </div>
      )}

      {fromAms && (
        <div className="flex flex-column gap-3">
          {amsCards.map(({ doc: d, sample: s }) => {
            const current = !!s && s.ams_version === d.version
            return (
              <div key={d.id} className="pp-card">
                <div className="flex align-items-start justify-content-between gap-3 flex-wrap">
                  <div className="flex align-items-start gap-3">
                    <i className={fileIcon(d.originalName)} style={{ fontSize: '1.5rem', color: '#dc2626' }} />
                    <div>
                      <div className="font-semibold" style={{ wordBreak: 'break-word' }}>{amsDocName(d)}</div>
                      <div className="text-sm text-color-secondary mt-1 flex align-items-center gap-2 flex-wrap">
                        <span><i className="pi pi-calendar mr-1" />{d.uploadDate ? new Date(d.uploadDate).toLocaleDateString() : '—'}</span>
                        {d.caseNumber && <span>· {d.caseNumber}</span>}
                        {d.uploadedByName && <span>· by {d.uploadedByName}</span>}
                        <span>· v{d.version}</span>
                      </div>
                    </div>
                  </div>
                  {s && current ? statusTag(s.status)
                    : <Tag value={s ? `Update to v${d.version}` : 'In AMS'} severity={s ? 'warning' : 'info'} />}
                </div>
                {s && current && s.status !== 'failed' ? actions(s, false) : (
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button size="small" icon="pi pi-cog" loading={preparing.has(d.id)}
                      label={s ? (s.status === 'failed' ? 'Try again' : `Update to v${d.version}`) : 'Prepare for drafting'}
                      onClick={() => prepare(d)} />
                    <span className="text-xs text-color-secondary align-self-center">
                      Reads the file from AMS so you can translate and draft from it.
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex flex-column gap-3">
        {!fromAms && filtered.map(s => (
          <div key={s.id} className="pp-card">
            <div className="flex align-items-start justify-content-between gap-3 flex-wrap">
              <div className="flex align-items-start gap-3">
                <i className={fileIcon(s.name)} style={{ fontSize: '1.5rem', color: '#dc2626' }} />
                <div>
                  <div className="font-semibold" style={{ wordBreak: 'break-word' }}>{s.name}</div>
                  <div className="text-sm text-color-secondary mt-1 flex align-items-center gap-2 flex-wrap">
                    <span><i className="pi pi-calendar mr-1" />{s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</span>
                    <span>· {(s.language ?? 'en').toUpperCase()}</span>
                  </div>
                </div>
              </div>
              {statusTag(s.status)}
            </div>

            {actions(s, true)}
          </div>
        ))}
      </div>

      {/* Upload dialog */}
      <Dialog header="Upload Document" visible={showUpload} style={{ width: 460 }} onHide={() => setShowUpload(false)}>
        <div className="flex flex-column gap-3">
          {error && <Message severity="error" text={error} className="w-full" />}
          <CaseField value={amsCase} onChange={setAmsCase} disabled={busy} />
          {fromAms && (
            <Message severity="info" className="w-full"
              text="It is prepared for drafting here. (Filing uploads into AMS Documents comes with merge phase 07.)" />
          )}
          {!fromAms && <div className="flex flex-column gap-2">
            <label className="font-medium text-sm">Contract type</label>
            <InputText value={contractType} onChange={e => setContractType(e.target.value)} placeholder="e.g. NDA" />
            <small className="text-color-secondary">Its clauses are added to the clause library under this type (match your template's agreement type). Leave blank to skip the library.</small>
          </div>}
          <div className="flex flex-column gap-2">
            <label className="font-medium text-sm">Document (PDF or DOCX)</label>
            <FileUpload mode="basic" accept=".pdf,.docx" maxFileSize={10000000}
              customUpload uploadHandler={handleUpload} auto chooseLabel="Choose & upload"
              disabled={busy} />
          </div>
          <p className="text-sm text-color-secondary m-0">
            On upload, the document is processed (and added to the clause library if a contract type is set). Status updates automatically.
          </p>
        </div>
      </Dialog>

    </div>
  )
}
