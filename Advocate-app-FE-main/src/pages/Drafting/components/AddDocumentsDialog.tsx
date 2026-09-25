import { useEffect, useState } from 'react'
import CaseField from './CaseField'
import { Dialog } from 'primereact/dialog'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import { Checkbox } from 'primereact/checkbox'
import { FileUpload } from 'primereact/fileupload'
import { Message } from 'primereact/message'
import { Tag } from 'primereact/tag'
import { draftingApi, type Sample } from '../api/drafting'
import { amsDocumentsApi, amsDocName, type AmsDocument, type AmsCase } from '../api/ams'

interface Props {
  visible: boolean
  onHide: () => void
  onAdd: (samples: Sample[]) => void // called with the documents the user picked/uploaded
  alreadySelected: number[]          // ids already chosen in the wizard (shown as added)
}

/**
 * "Add Documents" picker: choose one or more existing documents (My Documents) or
 * upload a new one (Upload New). Multi-select. Returns the chosen documents to the
 * caller via onAdd; the wizard tracks readiness (a fresh upload starts processing).
 */
export default function AddDocumentsDialog({ visible, onHide, onAdd, alreadySelected }: Props) {
  // Signed in from AMS: "My Documents" are the user's AMS documents (never the shared library).
  // Everyone is an AMS user now: documents come from AMS.
  const fromAms = true
  const [tab, setTab] = useState<'existing' | 'upload'>('existing')
  const [amsDocs, setAmsDocs] = useState<AmsDocument[]>([])
  const [amsChecked, setAmsChecked] = useState<Set<number>>(new Set())  // AMS document ids

  // My Documents tab
  const [docs, setDocs] = useState<Sample[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set())

  // Upload New tab
  // Optional AMS case; the backend derives the drafting client/project from it.
  const [amsCase, setAmsCase] = useState<AmsCase | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Load documents + clients whenever the dialog opens; reset transient state.
  useEffect(() => {
    if (!visible) return
    setTab('existing'); setChecked(new Set()); setAmsChecked(new Set()); setQuery(''); setError('')
    if (!fromAms) {
      setLoading(true)
      draftingApi.getAllSamples().then(setDocs).finally(() => setLoading(false))
    }
  }, [visible, fromAms])

  // AMS documents are searched on the server (the list can be long); debounce typing.
  useEffect(() => {
    if (!visible || !fromAms) return
    setLoading(true); setError('')
    const t = setTimeout(() => {
      amsDocumentsApi.list(query)
        .then(r => setAmsDocs(r.content))
        .catch(() => setError('Could not load your AMS documents.'))
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(t)
  }, [visible, fromAms, query])

  const filtered = docs.filter(d => d.name.toLowerCase().includes(query.toLowerCase()))

  const toggle = (id: number) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const addExisting = () => {
    onAdd(docs.filter(d => checked.has(d.id)))
    onHide()
  }

  const toggleAms = (id: number) => setAmsChecked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // Picking an AMS document prepares it for drafting (imported once, refreshed when AMS
  // has a newer version); the wizard then polls it to ready like a fresh upload.
  const addAms = async () => {
    setBusy(true); setError('')
    try {
      const samples = await Promise.all([...amsChecked].map(id => amsDocumentsApi.prepare(id)))
      onAdd(samples)
      onHide()
    } catch {
      setError('Could not open one of those documents from AMS — try again.')
    } finally {
      setBusy(false)
    }
  }

  // Upload a new document under the chosen client/project, then hand it back
  // (it starts processing; the wizard polls it to ready).
  const handleUpload = async (event: { files: File[] }) => {
    const file = event.files[0]
    setBusy(true); setError('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('name', file.name)
    if (amsCase) fd.append('case_id', String(amsCase.id))
    try {
      const sample = await draftingApi.uploadSample(fd)
      onAdd([sample])
      onHide()
    } catch {
      setError('Upload failed — check the file is a PDF or DOCX.')
    } finally {
      setBusy(false)
    }
  }

  const nChecked = fromAms ? amsChecked.size : checked.size
  const footer = tab === 'existing' ? (
    <div className="flex align-items-center justify-content-between w-full">
      <span className="text-sm text-color-secondary">{nChecked} document{nChecked === 1 ? '' : 's'} selected</span>
      <div className="flex gap-2">
        <Button label="Cancel" icon="pi pi-times" text onClick={onHide} />
        <Button label={`Add Selected (${nChecked})`} icon="pi pi-check" disabled={nChecked === 0 || busy}
          loading={busy} onClick={fromAms ? addAms : addExisting} />
      </div>
    </div>
  ) : null

  return (
    <Dialog header="Add Documents" visible={visible} onHide={onHide} footer={footer}
      style={{ width: '46rem', maxWidth: '95vw' }} contentStyle={{ paddingTop: 0 }}>
      {/* Tabs */}
      <div className="flex gap-4 mb-3" style={{ borderBottom: '1px solid var(--surface-300, #e5e7eb)' }}>
        {(['existing', 'upload'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '0.6rem 0.2rem',
              fontWeight: 600, fontSize: '0.9rem',
              color: tab === t ? 'var(--primary-color)' : 'var(--text-color-secondary, #64748b)',
              borderBottom: `2px solid ${tab === t ? 'var(--primary-color)' : 'transparent'}`,
            }}>
            <i className={`mr-2 ${t === 'existing' ? 'pi pi-file' : 'pi pi-upload'}`} />
            {t === 'existing' ? (fromAms ? 'My AMS Documents' : 'My Documents') : 'Upload New'}
          </button>
        ))}
      </div>

      {tab === 'existing' && fromAms ? (
        <div>
          {error && <Message severity="error" className="w-full mb-2" text={error} />}
          <span className="p-input-icon-left w-full mb-3 block">
            <i className="pi pi-search" />
            <InputText value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search your AMS documents by name, case or client…" className="w-full" />
          </span>
          <div style={{ maxHeight: '46vh', overflow: 'auto' }}>
            {loading && <div className="text-color-secondary p-3">Loading…</div>}
            {!loading && amsDocs.length === 0 && (
              <div className="text-color-secondary p-3">No PDF or Word documents in your AMS yet.</div>
            )}
            {!loading && amsDocs.map(d => {
              const already = !!d.sample && alreadySelected.includes(d.sample.id)
              return (
                <label key={d.id} className="flex align-items-center gap-3 p-2"
                  style={{ borderBottom: '1px solid var(--surface-200, #f1f5f9)', cursor: already ? 'default' : 'pointer' }}>
                  <Checkbox checked={amsChecked.has(d.id) || already} disabled={already}
                    onChange={() => toggleAms(d.id)} />
                  <i className={`text-color-secondary ${/\.pdf$/i.test(d.originalName) ? 'pi pi-file-pdf' : 'pi pi-file-word'}`} />
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="font-medium" style={{ wordBreak: 'break-word' }}>{amsDocName(d)}</div>
                    <div className="text-xs text-color-secondary">
                      {[d.caseNumber, d.clientName, d.uploadedByName && `by ${d.uploadedByName}`, `v${d.version}`]
                        .filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {already && <Tag value="Added" severity="info" style={{ fontSize: '0.65rem' }} />}
                  {!already && d.sample?.status === 'ready' && d.sample.current && (
                    <Tag value="Ready" severity="success" style={{ fontSize: '0.65rem' }} />
                  )}
                </label>
              )
            })}
          </div>
          <p className="text-xs text-color-secondary mt-2 mb-0">
            Documents are read from AMS; the first time you use one it is prepared for drafting.
          </p>
        </div>
      ) : tab === 'existing' ? (
        <div>
          <span className="p-input-icon-left w-full mb-3 block">
            <i className="pi pi-search" />
            <InputText value={query} onChange={e => setQuery(e.target.value)} placeholder="Search documents…" className="w-full" />
          </span>
          <div style={{ maxHeight: '46vh', overflow: 'auto' }}>
            {loading && <div className="text-color-secondary p-3">Loading…</div>}
            {!loading && filtered.length === 0 && <div className="text-color-secondary p-3">No documents found.</div>}
            {filtered.map(d => {
              const already = alreadySelected.includes(d.id)
              const ready = d.status === 'ready'
              return (
                <label key={d.id}
                  className="flex align-items-center gap-3 p-2"
                  style={{ borderBottom: '1px solid var(--surface-200, #f1f5f9)', cursor: ready && !already ? 'pointer' : 'default', opacity: ready ? 1 : 0.6 }}>
                  <Checkbox checked={checked.has(d.id) || already} disabled={already || !ready}
                    onChange={() => toggle(d.id)} />
                  <i className="pi pi-file text-color-secondary" />
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="font-medium" style={{ wordBreak: 'break-word' }}>{d.name}</div>
                    <div className="text-xs text-color-secondary">
                      {(d.language ?? 'en').toUpperCase()} · {d.created_at ? new Date(d.created_at).toLocaleDateString() : '—'}
                    </div>
                  </div>
                  {already && <Tag value="Added" severity="info" style={{ fontSize: '0.65rem' }} />}
                  {!already && !ready && <Tag value={d.status} severity="warning" style={{ fontSize: '0.65rem' }} />}
                </label>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-column gap-3 pt-2">
          {error && <Message severity="error" className="w-full" text={error} />}
          <CaseField value={amsCase} onChange={setAmsCase} disabled={busy} />
          <div className="flex flex-column gap-2">
            <label className="font-medium text-sm">Document (PDF or DOCX)</label>
            <FileUpload mode="basic" accept=".pdf,.docx" maxFileSize={10000000}
              customUpload uploadHandler={handleUpload} auto chooseLabel="Choose & upload"
              disabled={busy} />
          </div>
          <p className="text-sm text-color-secondary m-0">
            On upload the document is processed; it'll be added to your selection and is ready to use once processing completes.
          </p>
        </div>
      )}
    </Dialog>
  )
}
