import { useEffect, useMemo, useState } from 'react'
import { DRAFTING } from './routes'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../contexts/ToastContext'
import { Button, PageHead } from '../../ui/kit'
import { SearchInput } from '../../ui/forms'
import { DataTable, type Column } from '../../ui/DataTable'
import { confirm } from '../../ui/overlays'
import Icon from '../../ui/Icon'
import { draftingApi, type DraftSession } from './api/drafting'
import NewDraftDialog from './components/NewDraftDialog'

// What a draft's status means to the user. The stored `status` only tracks the
// AI generation job ("ready" = the AI finished), so a finished draft is further
// split by its empty fields and by whether it was filed on the case:
//   Generating (queued or writing) · Failed · Incomplete (fields left) · Complete · Filed
type DraftState = 'generating' | 'failed' | 'incomplete' | 'complete' | 'filed'
const draftState = (s: DraftSession): DraftState => {
  if (s.status === 'failed') return 'failed'
  if (s.status !== 'ready') return 'generating'
  if (s.ams_document_id) return 'filed'
  return (s.unfilled_count ?? 0) > 0 ? 'incomplete' : 'complete'
}
const STATE_LABEL: Record<DraftState, string> = {
  generating: 'Generating', failed: 'Failed', incomplete: 'Incomplete', complete: 'Complete', filed: 'Filed',
}
const STATE_TONE: Record<DraftState, string> = {
  generating: 'plain', failed: 'bad', incomplete: 'warn', complete: 'ok', filed: 'tape',
}
// Order for sorting the Status column: work in progress first, filed last.
const STATE_ORDER: Record<DraftState, number> = { generating: 0, failed: 1, incomplete: 2, complete: 3, filed: 4 }

const fmtDateTime = (v?: string | null) => v
  ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '—'

/** The "Drafts" page: lists every draft session with a button to start a new one.
 *  Rows open into their DraftPage once generation has finished. */
export default function Drafts() {
  const navigate = useNavigate()
  const toast = useToast()
  const [sessions, setSessions] = useState<DraftSession[]>([])  // all draft sessions
  const [loading, setLoading] = useState(true)                  // true until the initial fetch resolves
  const [query, setQuery] = useState('')                        // free-text filter (id / status)
  const [status, setStatus] = useState('')                      // status filter
  const [showBegin, setShowBegin] = useState(false)             // "How would you like to begin?" chooser

  const load = () => draftingApi.getSessions().then(setSessions)

  // Load every draft once on mount.
  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [])

  // Confirm, then delete the draft session (its blocks cascade) and reload.
  const confirmDelete = (row: DraftSession) => {
    confirm({
      title: `Delete draft #${row.id}?`,
      message: 'This removes the draft and all its clauses. Documents saved to the case are kept. This cannot be undone.',
      confirmLabel: 'Delete draft',
      danger: true,
      accept: async () => {
        try {
          await draftingApi.deleteSession(row.id)
          // Drop the draft's persisted chat transcript so a reused id can't inherit it.
          localStorage.removeItem(`pp_chat_${row.id}`)
          localStorage.removeItem(`pp_chat_model_${row.id}`)
          toast.success(`Draft #${row.id} deleted`)
          load()
        } catch {
          toast.error('Could not delete the draft. Please try again.')
        }
      },
    })
  }

  // Rows matching the query on id, status, template name, or document names.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '')
    return sessions.filter(s =>
      (!status || draftState(s) === status) && (!q ||
      String(s.id).includes(q) ||
      STATE_LABEL[draftState(s)].toLowerCase().includes(q) ||
      (s.template_name || '').toLowerCase().includes(q) ||
      (s.sample_names || []).some(n => n.toLowerCase().includes(q))),
    )
  }, [sessions, query, status])

  const columns: Column<DraftSession>[] = [
    { key: 'id', label: 'Draft #', sort: true, width: 90, render: r => <span className="mono">#{r.id}</span> },
    { key: 'template_name', label: 'Template', sort: r => r.template_name || '', render: r => r.template_name || <span className="faint">No template</span> },
    { key: 'docs', label: 'Reference docs', hideSm: true, render: r => r.sample_names?.length ? <span className="pp-clamp small">{r.sample_names.join(', ')}</span> : <span className="faint">—</span> },
    { key: 'created_at', label: 'Created', sort: true, hideSm: true, render: r => <span className="nowrap">{fmtDateTime(r.created_at)}</span> },
    {
      key: 'cited', label: 'Citations', hideSm: true, render: r => {
        // "verified / total cited": how many blocks have a verified citation.
        const total = r.blocks?.length ?? 0
        const verified = r.blocks?.filter(b => b.verified).length ?? 0
        if (r.status !== 'ready' || !total) return <span className="faint">—</span>
        return (
          <div className="row nowrap">
            <span className="small">{verified} of {total} verified</span>
            <span className="bar-track cite-bar" aria-hidden="true"><i style={{ width: `${verified / total * 100}%`, background: `var(${verified === total ? '--ok' : '--warn'})` }} /></span>
          </div>
        )
      },
    },
    {
      key: 'status', label: 'Status', sort: r => STATE_ORDER[draftState(r)], render: r => {
        const st = draftState(r)
        const left = r.unfilled_count ?? 0
        return (
          <div>
            <span className={`chip ${STATE_TONE[st]}`}>
              {st === 'generating' && <span className="pp-spin" aria-hidden="true" />}
              {STATE_LABEL[st]}
            </span>
            {/* How much is missing: on Incomplete, and on a Filed draft saved with blanks. */}
            {(st === 'incomplete' || st === 'filed') && left > 0 && (
              <div className="cell-sub" style={{ color: 'var(--warn)' }}>{left} field{left === 1 ? '' : 's'} empty</div>
            )}
          </div>
        )
      },
    },
    {
      key: 'act', label: <span className="sr-only">Actions</span>, align: 'right', render: r => (
        <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }} onClick={e => e.stopPropagation()}>
          {r.status === 'ready' && <button type="button" className="btn sm" onClick={() => navigate(DRAFTING.draft(r.id))}>Open</button>}
          <button type="button" className="btn ghost sm icon" aria-label={`Delete draft ${r.id}`} title="Delete"
            onClick={() => confirmDelete(r)}><Icon name="trash" size="sm" /></button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHead title="Drafts"
        sub="Drafts generated from your case documents and templates. Every citation links back to its source."
        actions={<>
          <Button icon="template" onClick={() => navigate(DRAFTING.templates)}>Templates</Button>
          <Button variant="primary" icon="plus" onClick={() => setShowBegin(true)}>New draft</Button>
        </>} />

      <NewDraftDialog visible={showBegin} onHide={() => setShowBegin(false)} />

      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search drafts by template or document" />
        <label className="sr-only" htmlFor="dr-status">Status</label>
        <select id="dr-status" className="input" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="generating">Generating</option>
          <option value="failed">Failed</option>
          <option value="incomplete">Incomplete</option>
          <option value="complete">Complete</option>
          <option value="filed">Filed</option>
        </select>
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={r => r.id}
        loading={loading}
        pageSize={10}
        initialSort={{ key: 'id', dir: 'desc' }}
        caption="Drafts"
        onRow={r => {
          if (r.status === 'ready') navigate(DRAFTING.draft(r.id))
          else toast.info(r.status === 'failed' ? `Draft #${r.id} failed.` : `Draft #${r.id} is still generating.`)
        }}
        empty={{
          icon: 'pen', title: query || status ? 'No drafts match' : 'No drafts yet',
          text: 'Start from a case’s documents or type the facts directly.',
          action: <Button variant="primary" size="sm" onClick={() => setShowBegin(true)}>New draft</Button>,
        }}
      />
    </div>
  )
}
