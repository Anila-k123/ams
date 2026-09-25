import { useEffect, useRef, useState } from 'react'
import { DRAFTING } from './routes'
import { useNavigate } from 'react-router-dom'
import { Button } from 'primereact/button'
import { Tag } from 'primereact/tag'
import { Skeleton } from 'primereact/skeleton'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { FileUpload } from 'primereact/fileupload'
import { Message } from 'primereact/message'
import { Toast } from 'primereact/toast'
import { ProgressSpinner } from 'primereact/progressspinner'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { AxiosError } from 'axios'
import DocumentViewer from './components/DocumentViewer'
import { draftingApi, type Template } from './api/drafting'

/** Templates page: a card grid of uploaded clause skeletons. Supports uploading a new
 *  template (which the backend splits into clauses and names via the LLM, shown behind a
 *  processing spinner), viewing a template's extracted clauses or its source document,
 *  and deleting. */
export default function Templates() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<Template[]>([])  // the card grid contents
  const [loading, setLoading] = useState(true)                // true until the initial fetch resolves (shows skeletons)
  const [showUpload, setShowUpload] = useState(false)         // upload dialog open/closed
  const [name, setName] = useState('')                        // upload form: template name field
  const [docType, setDocType] = useState('')                  // upload form: optional document-type field
  const [error, setError] = useState('')                      // upload form: parse-failure message
  const [busy, setBusy] = useState(false)                     // true while the upload+extraction request runs (swaps dialog to spinner)
  const [viewing, setViewing] = useState<Template | null>(null)    // template whose source document is shown in DocumentViewer
  const [query, setQuery] = useState('')                      // search-box filter (name / type)
  const toast = useRef<Toast>(null)

  const load = () => draftingApi.getTemplates().then(setTemplates)

  // Templates whose name or document type contains the query (case-insensitive).
  const filtered = templates.filter(t => {
    const q = query.trim().toLowerCase()
    return !q || t.name.toLowerCase().includes(q) || (t.document_type || '').toLowerCase().includes(q)
  })

  useEffect(() => { load().finally(() => setLoading(false)) }, [])

  // Poll while any template is still processing, so its card flips to Ready/Failed
  // automatically without the user waiting on a modal.
  useEffect(() => {
    if (!templates.some(t => t.status === 'processing')) return
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
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
      toast.current?.show({ severity: 'info', summary: 'Template uploaded', detail: 'Processing — status will update shortly.', life: 4000 })
      load()
    } catch {
      setError('Could not upload that template. Use a PDF or DOCX file.')
    } finally {
      setBusy(false)
    }
  }

  const view = (t: Template) => setViewing(t)

  // Ask for confirmation, then delete and reload. Surfaces the backend's detail message on failure.
  const confirmDelete = (t: Template) => {
    confirmDialog({
      message: `Delete template "${t.name}"? This cannot be undone.`,
      header: 'Delete template',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await draftingApi.deleteTemplate(t.id)
          toast.current?.show({ severity: 'success', summary: 'Deleted', detail: `"${t.name}" removed.`, life: 3000 })
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

  return (
    <div>
      <Toast ref={toast} />
      <ConfirmDialog />
      <DocumentViewer visible={!!viewing} onHide={() => setViewing(null)} fileUrl={viewing?.file} name={viewing?.name} />

      <div className="pp-page-head flex align-items-center justify-content-between gap-2 flex-wrap">
        <span className="p-input-icon-left">
          <i className="pi pi-search" />
          <InputText value={query} onChange={e => setQuery(e.target.value)} placeholder="Search templates" />
        </span>
        <Button label="Upload Template" icon="pi pi-upload" onClick={() => { setError(''); setShowUpload(true) }} />
      </div>

      <div className="grid">
        {loading && [1, 2].map(i => (
          <div key={i} className="col-12 md:col-6"><div className="pp-card"><Skeleton height="8rem" /></div></div>
        ))}

        {!loading && filtered.map(t => {
          const processing = t.status === 'processing'
          const failed = t.status === 'failed'
          return (
          <div key={t.id} className="col-12 md:col-6">
            <div className="pp-card h-full flex flex-column">
              <div className="flex align-items-start justify-content-end mb-2">
                <div className="flex gap-2">
                  {processing && <Tag value="Processing" severity="warning" icon="pi pi-spin pi-spinner" />}
                  {failed && <Tag value="Failed" severity="danger" />}
                  {t.document_type && <Tag value={t.document_type.toUpperCase()} />}
                  <Tag value={t.language.toUpperCase()} severity="info" />
                </div>
              </div>
              <h3 className="mb-1 mt-2">{t.name}</h3>
              {processing ? (
                <p className="text-color-secondary text-sm mt-0 mb-3 flex-1">
                  Processing — this will be ready shortly.
                </p>
              ) : failed ? (
                <p className="text-color-secondary text-sm mt-0 mb-3 flex-1">
                  Couldn’t process this file. Delete it and upload a PDF or DOCX.
                </p>
              ) : (
                <div className="flex-1" />
              )}
              <div className="flex align-items-center justify-content-between mt-auto">
                <Button label="Use template" icon="pi pi-arrow-right" iconPos="right" size="small"
                  disabled={processing || failed} onClick={() => navigate(DRAFTING.newDraft)} />
                <div className="flex gap-1">
                  {t.file && (
                    <Button icon="pi pi-eye" rounded text severity="secondary" tooltip="View document"
                      tooltipOptions={{ position: 'top' }} onClick={() => view(t)} />
                  )}
                  <Button icon="pi pi-trash" rounded text severity="danger" tooltip="Delete"
                    tooltipOptions={{ position: 'top' }} onClick={() => confirmDelete(t)} />
                </div>
              </div>
            </div>
          </div>
          )
        })}

        {!loading && templates.length === 0 && (
          <div className="col-12">
            <div className="pp-card text-center text-color-secondary">
              No templates yet — click <strong>Upload Template</strong> to add your own (PDF or DOCX).
            </div>
          </div>
        )}

        {!loading && templates.length > 0 && filtered.length === 0 && (
          <div className="col-12">
            <div className="pp-card text-center text-color-secondary">No templates match “{query}”.</div>
          </div>
        )}
      </div>

      <Dialog
        header={busy ? 'Uploading…' : 'Upload Template'}
        visible={showUpload}
        style={{ width: 460 }}
        closable={!busy}
        onHide={() => { if (!busy) setShowUpload(false) }}
      >
        {busy ? (
          <div className="flex flex-column align-items-center justify-content-center gap-3 py-5">
            <ProgressSpinner style={{ width: 46, height: 46 }} strokeWidth="4" />
            <div className="font-medium">Uploading…</div>
          </div>
        ) : (
          <div className="flex flex-column gap-3">
            {error && <Message severity="error" text={error} className="w-full" />}
            <div className="flex flex-column gap-2">
              <label className="font-medium text-sm">Template name</label>
              <InputText value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mutual NDA (firm standard)" />
            </div>
            <div className="flex flex-column gap-2">
              <label className="font-medium text-sm">Agreement type <span className="text-color-secondary">(optional)</span></label>
              <InputText value={docType} onChange={e => setDocType(e.target.value)} placeholder="e.g. NDA, SHA, MSA" />
            </div>
            <div className="flex flex-column gap-2">
              <label className="font-medium text-sm">Template file (PDF or DOCX)</label>
              <FileUpload mode="basic" accept=".pdf,.docx" maxFileSize={10000000}
                customUpload uploadHandler={handleUpload} auto chooseLabel="Choose & upload" disabled={busy} />
            </div>
            <p className="text-sm text-color-secondary m-0">
              The file is processed to define what the draft will contain.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  )
}
