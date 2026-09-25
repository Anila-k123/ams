import { useEffect, useMemo, useRef, useState } from 'react'
import { DRAFTING } from './routes'
import { useNavigate } from 'react-router-dom'
import { Button } from 'primereact/button'
import { DataTable } from 'primereact/datatable'
import { Column } from 'primereact/column'
import { Tag } from 'primereact/tag'
import { InputText } from 'primereact/inputtext'
import { Toast } from 'primereact/toast'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { draftingApi, type DraftSession } from './api/drafting'
import NewDraftDialog from './components/NewDraftDialog'

// Maps a session status to the PrimeReact Tag colour used to display it.
const STATUS_SEVERITY: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
  ready: 'success',
  generating: 'info',
  pending: 'warning',
  failed: 'danger',
}

/** The "Drafts" page: lists every draft session with a button to start a new one.
 *  Rows open into their DraftPage once generation has finished. */
export default function Drafts() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<DraftSession[]>([])  // all draft sessions
  const [loading, setLoading] = useState(true)                  // true until the initial fetch resolves
  const [query, setQuery] = useState('')                        // free-text filter (id / status)
  const [showBegin, setShowBegin] = useState(false)             // "How would you like to begin?" chooser
  const toast = useRef<Toast>(null)

  const load = () => draftingApi.getSessions().then(setSessions)

  // Load every draft once on mount.
  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [])

  // Confirm, then delete the draft session (its blocks cascade) and reload.
  const confirmDelete = (row: DraftSession) => {
    confirmDialog({
      message: `Delete draft #${row.id}? This removes the draft and all its clauses. This can't be undone.`,
      header: 'Delete draft',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await draftingApi.deleteSession(row.id)
          // Drop the draft's persisted chat transcript so a reused id can't inherit it.
          localStorage.removeItem(`pp_chat_${row.id}`)
          localStorage.removeItem(`pp_chat_model_${row.id}`)
          toast.current?.show({ severity: 'success', summary: 'Deleted', detail: `Draft #${row.id} removed.`, life: 3000 })
          load()
        } catch {
          toast.current?.show({ severity: 'error', summary: 'Could not delete', detail: 'Delete failed — please try again.', life: 5000 })
        }
      },
    })
  }

  // Rows matching the query on id, status, template name, or document names.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(s =>
      String(s.id).includes(q) ||
      s.status.toLowerCase().includes(q) ||
      (s.template_name || '').toLowerCase().includes(q) ||
      (s.sample_names || []).some(n => n.toLowerCase().includes(q)),
    )
  }, [sessions, query])

  // Column renderer: status as a colour-coded Tag.
  const statusTemplate = (row: DraftSession) => (
    <Tag value={row.status.charAt(0).toUpperCase() + row.status.slice(1)} severity={STATUS_SEVERITY[row.status]} />
  )

  // Column renderer: "verified / total cited" — how many blocks have a verified citation.
  const blocksTemplate = (row: DraftSession) => {
    const total = row.blocks?.length ?? 0
    const verified = row.blocks?.filter(b => b.verified).length ?? 0
    return total ? (
      <span className="text-sm">
        <span style={{ color: 'var(--pp-verified)', fontWeight: 600 }}>{verified}</span>
        <span style={{ color: 'var(--pp-slate-400)' }}> / {total} cited</span>
      </span>
    ) : <span className="text-sm text-color-secondary">—</span>
  }

  // Column renderer: "Open" + delete, per row. Open is enabled once ready.
  const actionsTemplate = (row: DraftSession) => (
    <div className="flex align-items-center justify-content-end gap-1">
      <Button
        icon="pi pi-arrow-right"
        label="Open"
        size="small"
        text
        disabled={row.status !== 'ready'}
        onClick={() => navigate(DRAFTING.draft(row.id))}
      />
      <Button
        icon="pi pi-trash"
        size="small"
        text
        severity="danger"
        aria-label="Delete draft"
        tooltip="Delete"
        tooltipOptions={{ position: 'top' }}
        onClick={() => confirmDelete(row)}
      />
    </div>
  )

  return (
    <div>
      <Toast ref={toast} />
      <ConfirmDialog />
      <div className="pp-page-head flex justify-content-end">
        <Button label="New Draft" icon="pi pi-plus" onClick={() => setShowBegin(true)} />
      </div>

      <NewDraftDialog visible={showBegin} onHide={() => setShowBegin(false)} />

      <div className="pp-card">
        <div className="flex align-items-center justify-content-end mb-3">
          <span className="p-input-icon-left">
            <i className="pi pi-search" />
            <InputText value={query} onChange={e => setQuery(e.target.value)} placeholder="Search drafts…" />
          </span>
        </div>
        <DataTable
          value={filtered}
          loading={loading}
          emptyMessage="No drafts yet — click New Draft to begin."
          paginator
          rows={10}
          stripedRows
        >
          <Column field="id" header="ID" style={{ width: '5rem' }} body={(r: DraftSession) => `#${r.id}`} />
          <Column header="Template" body={(r: DraftSession) => r.template_name || '—'} />
          <Column header="Documents" body={(r: DraftSession) => r.sample_names?.join(', ') || '—'} />
          <Column header="Created" body={(r: DraftSession) => r.created_at ? new Date(r.created_at).toLocaleString() : '—'} />
          <Column header="Citations" body={blocksTemplate} />
          <Column header="Status" body={statusTemplate} />
          <Column header="" body={actionsTemplate} style={{ width: '11rem' }} />
        </DataTable>
      </div>
    </div>
  )
}
