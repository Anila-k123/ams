import { useEffect, useState } from 'react'
import CaseField from './CaseField'
import FilePick from './FilePick'
import { Modal } from '../../../ui/overlays'
import { Button } from '../../../ui/kit'
import { SearchInput, Tabs } from '../../../ui/forms'
import Icon from '../../../ui/Icon'
import { draftingApi, type Sample } from '../api/drafting'
import { amsDocumentsApi, amsDocName, type AmsDocument, type AmsCase } from '../api/ams'

interface Props {
  visible: boolean
  onHide: () => void
  onAdd: (samples: Sample[]) => void // called with the documents the user picked/uploaded
  alreadySelected: number[]          // ids already chosen in the wizard (shown as added)
}

const fmtDate = (s?: string | null) => s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

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
        .catch(() => setError('Could not load your PactPro documents.'))
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
      setError('Could not open one of those documents. Try again.')
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
      setError('Upload failed. Check the file is a PDF or DOCX.')
    } finally {
      setBusy(false)
    }
  }

  const nChecked = fromAms ? amsChecked.size : checked.size
  const footer = tab === 'existing' ? (
    <>
      <span className="faint small grow">{nChecked} document{nChecked === 1 ? '' : 's'} selected</span>
      <button type="button" className="btn ghost" onClick={onHide}>Cancel</button>
      <Button variant="primary" icon="check" disabled={nChecked === 0 || busy} loading={busy}
        onClick={fromAms ? addAms : addExisting}>Add selected ({nChecked})</Button>
    </>
  ) : undefined

  const errBox = error && <div className="callout bad" role="alert"><Icon name="warn" size="sm" /><div>{error}</div></div>

  return (
    <Modal title="Add documents" sub="Reference documents the draft is built from." open={visible} onClose={onHide} footer={footer} size="wide">
      <Tabs<'existing' | 'upload'> value={tab} onChange={setTab} label="Add documents" tabs={[
        { value: 'existing', label: fromAms ? 'Case documents' : 'My documents' },
        { value: 'upload', label: 'Upload new' },
      ]} />

      {tab === 'existing' && fromAms ? (
        <div className="stack" style={{ gap: 10 }}>
          {errBox}
          <SearchInput value={query} onChange={setQuery} placeholder="Search documents by name, case or client" />
          <div className="panel dr-pick-list" style={{ maxHeight: '46vh', overflow: 'auto' }}>
            {loading && <p className="faint small" style={{ padding: 12 }}>Loading…</p>}
            {!loading && amsDocs.length === 0 && (
              <p className="faint small" style={{ padding: 12 }}>No PDF or Word documents in PactPro yet.</p>
            )}
            {!loading && amsDocs.map(d => {
              const already = !!d.sample && alreadySelected.includes(d.sample.id)
              return (
                <label key={d.id} className="list-item check" style={{ cursor: already ? 'default' : 'pointer' }}>
                  <input type="checkbox" checked={amsChecked.has(d.id) || already} disabled={already}
                    onChange={() => toggleAms(d.id)} />
                  <Icon name="file" size="sm" />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="small" style={{ display: 'block', fontWeight: 500, wordBreak: 'break-word' }}>{amsDocName(d)}</span>
                    <span className="faint xs">
                      {[d.caseNumber, d.clientName, d.uploadedByName && `by ${d.uploadedByName}`, `v${d.version}`]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {already && <span className="chip info">Added</span>}
                  {!already && d.sample?.status === 'ready' && d.sample.current && <span className="chip ok">Ready</span>}
                </label>
              )
            })}
          </div>
          <p className="faint xs">
            Documents come from your case files. The first time you use one it is prepared for drafting.
          </p>
        </div>
      ) : tab === 'existing' ? (
        <div className="stack" style={{ gap: 10 }}>
          <SearchInput value={query} onChange={setQuery} placeholder="Search documents" />
          <div className="panel" style={{ maxHeight: '46vh', overflow: 'auto' }}>
            {loading && <p className="faint small" style={{ padding: 12 }}>Loading…</p>}
            {!loading && filtered.length === 0 && <p className="faint small" style={{ padding: 12 }}>No documents found.</p>}
            {filtered.map(d => {
              const already = alreadySelected.includes(d.id)
              const ready = d.status === 'ready'
              return (
                <label key={d.id} className="list-item check"
                  style={{ cursor: ready && !already ? 'pointer' : 'default', opacity: ready ? 1 : 0.6 }}>
                  <input type="checkbox" checked={checked.has(d.id) || already} disabled={already || !ready}
                    onChange={() => toggle(d.id)} />
                  <Icon name="file" size="sm" />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="small" style={{ display: 'block', fontWeight: 500, wordBreak: 'break-word' }}>{d.name}</span>
                    <span className="faint xs">{(d.language ?? 'en').toUpperCase()} · {fmtDate(d.created_at)}</span>
                  </span>
                  {already && <span className="chip info">Added</span>}
                  {!already && !ready && <span className="chip warn">{d.status}</span>}
                </label>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {errBox}
          <CaseField value={amsCase} onChange={setAmsCase} disabled={busy} />
          <FilePick label={busy ? 'Uploading…' : 'Choose a file to upload'} onUpload={handleUpload} disabled={busy} />
          <p className="faint small">
            The document is processed after upload. It is added to your selection and is ready to use once processing completes.
          </p>
        </div>
      )}
    </Modal>
  )
}
