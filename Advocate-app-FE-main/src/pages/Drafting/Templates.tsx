import { useEffect, useState } from 'react'
import { DRAFTING } from './routes'
import { usePermission } from '../../contexts/PermissionContext'
import { useToast } from '../../contexts/ToastContext'
import { useNavigate } from 'react-router-dom'
import { AxiosError } from 'axios'
import { Button, EmptyState, PageHead, Skel, Spinner } from '../../ui/kit'
import { FilterChip, SearchInput, TextField } from '../../ui/forms'
import { Modal, confirm } from '../../ui/overlays'
import Icon from '../../ui/Icon'
import DocumentViewer from './components/DocumentViewer'
import FilePick from './components/FilePick'
import { draftingApi, type Template } from './api/drafting'

/** Firm Templates: a card grid of uploaded clause skeletons. Supports uploading a new
 *  template (which the backend splits into clauses and names via the LLM, shown behind a
 *  processing status), viewing a template's source document, and deleting. */
export default function Templates() {
  const navigate = useNavigate()
  const toast = useToast()
  const { hasPermission } = usePermission() as any
  const [templates, setTemplates] = useState<Template[]>([])  // the card grid contents
  const [loading, setLoading] = useState(true)                // true until the initial fetch resolves (shows skeletons)
  const [showUpload, setShowUpload] = useState(false)         // upload dialog open/closed
  const [name, setName] = useState('')                        // upload form: template name field
  const [docType, setDocType] = useState('')                  // upload form: optional document-type field
  const [error, setError] = useState('')                      // upload form: parse-failure message
  const [busy, setBusy] = useState(false)                     // true while the upload request runs
  const [viewing, setViewing] = useState<Template | null>(null)    // template whose source document is shown in DocumentViewer
  const [query, setQuery] = useState('')                      // search-box filter (name / type)

  const [showArchived, setShowArchived] = useState(false)    // archived templates view (restore)
  const load = () => draftingApi.getTemplates(showArchived).then(setTemplates)

  // Templates whose name or document type contains the query (case-insensitive).
  const filtered = templates.filter(t => {
    const q = query.trim().toLowerCase()
    return !q || t.name.toLowerCase().includes(q) || (t.document_type || '').toLowerCase().includes(q)
  })

  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when switching to/from the archived view
  useEffect(() => { load().finally(() => setLoading(false)) }, [showArchived])

  // Poll while any template is still processing, so its card flips to Ready/Failed
  // automatically without the user waiting on a modal.
  useEffect(() => {
    if (!templates.some(t => t.status === 'processing')) return
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-armed whenever the list changes
  }, [templates])

  // Upload a template file (name defaults to the filename). Parsing + naming run in the
  // BACKGROUND, so the request returns immediately; we close the dialog and the new card
  // shows a "Processing" status that the poller above flips to Ready when it's done.
  const handleUpload = async (event: { files: File[] }) => {
    const file = event.files[0]
    setBusy(true)
    setError('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('name', name.trim() || file.name)
    if (docType.trim()) fd.append('document_type', docType.trim())
    try {
      await draftingApi.uploadTemplate(fd)
      setShowUpload(false)
      setName(''); setDocType('')
      toast.info('Template uploaded. Finding its fields; the status will update shortly.')
      load()
    } catch {
      setError('Could not upload that template. Use a PDF or DOCX file.')
    } finally {
      setBusy(false)
    }
  }

  // "Delete" archives: hidden and not offered for new drafts, restorable by the
  // creator or a Super Admin (only they see the button; the server enforces it).
  const confirmDelete = (t: Template) => {
    confirm({
      title: 'Archive this template?',
      message: `${t.name} will be hidden and can't be used for new drafts. Drafts already made from it are kept. You or a Super Admin can restore it from Show archived.`,
      confirmLabel: 'Archive template',
      danger: true,
      accept: async () => {
        try {
          await draftingApi.deleteTemplate(t.id)
          toast.success(`${t.name} archived`)
          load()
        } catch (err) {
          const ax = err as AxiosError<{ detail?: string }>
          toast.error(ax.response?.data?.detail ?? 'Archive failed.')
        }
      },
    })
  }

  const restore = async (t: Template) => {
    try {
      await draftingApi.restoreTemplate(t.id)
      toast.success(`${t.name} restored`)
      load()
    } catch {
      toast.error('Restore failed.')
    }
  }

  const canManage = hasPermission('DRAFT_MANAGE')

  return (
    <div>
      <DocumentViewer visible={!!viewing} onHide={() => setViewing(null)} fileUrl={viewing?.file} name={viewing?.name} />

      <PageHead title="Firm Templates"
        sub="Your firm's own formats. Upload a PDF or Word file and PactPro finds the fields to fill."
        actions={canManage && (
          <Button variant="primary" icon="upload" onClick={() => { setError(''); setShowUpload(true) }}>Upload template</Button>
        )} />

      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search templates" />
        <FilterChip on={showArchived} onClick={() => setShowArchived(v => !v)}><Icon name="archive" size="sm" />Show archived</FilterChip>
      </div>

      <div className="doc-grid dr-card-grid">
        {loading && [1, 2, 3].map(i => (
          <div key={i} className="panel"><div className="panel-body stack" style={{ gap: 10 }}><Skel w={90} /><Skel h={22} /><Skel w="60%" /></div></div>
        ))}

        {!loading && filtered.map(t => {
          const processing = t.status === 'processing'
          const failed = t.status === 'failed'
          return (
            <div key={t.id} className="panel">
              <div className="panel-body dr-tile-body">
                <div className="row between">
                  {processing ? <span className="chip warn plain"><span className="pp-spin" aria-hidden="true" />Processing</span>
                    : failed ? <span className="chip bad">Failed</span>
                    : <span className="chip ok">Ready</span>}
                  <span className="faint xs">{t.language.toUpperCase()}</span>
                </div>
                <h3 className="serif dr-tile-title">{t.name}</h3>
                {(t.document_type || t.created_by_name) && (
                  <div className="faint xs">{[t.document_type?.toUpperCase(), t.created_by_name && `by ${t.created_by_name}`].filter(Boolean).join(' · ')}</div>
                )}
                {processing && <p className="faint small">Finding the fields. This will be ready shortly.</p>}
                {failed && (
                  <div className="callout bad"><Icon name="warn" size="sm" /><div>Couldn’t process this file. Archive it and upload a PDF or DOCX.</div></div>
                )}
                <span className="grow" />
                <div className="row wrap" style={{ gap: 6 }}>
                  {!showArchived && <Button variant="primary" size="sm" disabled={processing || failed} onClick={() => navigate(DRAFTING.newDraft)}>Use template</Button>}
                  {t.file && <Button size="sm" icon="eye" onClick={() => setViewing(t)}>View</Button>}
                  <span className="grow" />
                  {t.can_archive && (showArchived
                    ? <Button size="sm" icon="restore" onClick={() => restore(t)}>Restore</Button>
                    : <button type="button" className="btn ghost sm icon" aria-label={`Archive ${t.name}`} title="Archive"
                        onClick={() => confirmDelete(t)}><Icon name="archive" size="sm" /></button>)}
                </div>
              </div>
            </div>
          )
        })}

        {!loading && filtered.length === 0 && (
          <div className="panel" style={{ gridColumn: '1 / -1' }}>
            <EmptyState icon="template"
              title={templates.length ? 'No templates match' : 'No templates yet'}
              text={templates.length ? `Nothing matches “${query}”. Try another word.` : 'Upload your firm’s own format (PDF or DOCX) to draft from it.'}
              action={!templates.length && canManage ? <Button variant="primary" size="sm" icon="upload" onClick={() => setShowUpload(true)}>Upload template</Button> : undefined} />
          </div>
        )}
      </div>

      <Modal
        title={busy ? 'Uploading…' : 'Upload template'}
        sub="PDF or Word, up to 10 MB."
        open={showUpload}
        dismissable={!busy}
        onClose={() => { if (!busy) setShowUpload(false) }}
        footer={<button type="button" className="btn ghost" disabled={busy} onClick={() => setShowUpload(false)}>Cancel</button>}
      >
        {busy ? (
          <div className="row" style={{ justifyContent: 'center', padding: 32 }}><Spinner label="Uploading" /></div>
        ) : (
          <div className="stack" style={{ gap: 14 }}>
            {error && <div className="callout bad" role="alert"><Icon name="warn" size="sm" /><div>{error}</div></div>}
            <TextField label="Template name" value={name} onChange={e => setName(e.target.value)} placeholder="Mutual NDA (firm standard)" hint="Leave blank to use the file name." />
            <TextField label="Agreement type (optional)" value={docType} onChange={e => setDocType(e.target.value)} placeholder="NDA, SHA, MSA" />
            <FilePick label="Choose the template file" onUpload={handleUpload} disabled={busy} />
          </div>
        )}
      </Modal>
    </div>
  )
}
