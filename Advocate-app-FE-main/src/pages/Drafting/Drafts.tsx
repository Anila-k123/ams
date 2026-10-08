import { useEffect, useMemo, useState } from 'react'
import { DRAFTING } from './routes'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../contexts/ToastContext'
import { Button, PageHead } from '../../ui/kit'
import { SearchInput } from '../../ui/forms'
import { DataTable, type Column } from '../../ui/DataTable'
import { confirm } from '../../ui/overlays'
import Icon from '../../ui/Icon'
import { draftingApi, type DraftReviewRequest, type DraftSession, type MyReviewStatus, type ReviewProgress } from './api/drafting'
import NewDraftDialog from './components/NewDraftDialog'

// Session status as a Red Tape chip tone.
const STATUS_TONE: Record<string, string> = {
  ready: 'ok',
  generating: 'warn',
  pending: 'warn',
  failed: 'bad',
}

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
  const [forReview, setForReview] = useState<DraftReviewRequest[]>([])  // colleagues' drafts waiting for my review
  const [reviewState, setReviewState] = useState<Record<string, MyReviewStatus>>({})  // my drafts' review state

  const load = () => draftingApi.getSessions().then(setSessions)

  // Load every draft once on mount, and the drafts colleagues asked me to review.
  useEffect(() => {
    load().finally(() => setLoading(false))
    draftingApi.forMyReview().then(setForReview).catch(() => setForReview([]))
    draftingApi.myReviewStatus().then(setReviewState).catch(() => setReviewState({}))
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
      (!status || s.status === status) && (!q ||
      String(s.id).includes(q) ||
      s.status.toLowerCase().includes(q) ||
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
      key: 'status', label: 'Status', sort: true, render: r => (<>
        <span className={`chip ${STATUS_TONE[r.status] ?? ''}${r.status === 'generating' ? ' plain' : ''}`}>
          {r.status === 'generating' && <span className="pp-spin" aria-hidden="true" />}
          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
        </span>
        <ReviewChip s={reviewState[String(r.id)]} />
      </>),
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

      {forReview.length > 0 && (
        <section className="panel" style={{ marginBottom: 16 }} aria-label="For my review">
          <div className="panel-head"><h3><Icon name="chat" size="sm" /> For my review</h3></div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {forReview.map(r => (
              <li key={r.id} className="row" style={{ gap: 10, padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
                <div className="grow">
                  <div><strong>{r.title}</strong> <span className="faint xs mono">#{r.session}</span></div>
                  <div className="small muted">
                    {r.requested_by_name || 'A colleague'} asked {fmtDateTime(r.created_at)}
                    {r.authority === 'binding' && ' · you can correct it'}
                    {r.note && <> · "{r.note}"</>}
                  </div>
                  {r.progress && <div className="small"><ProgressLine p={r.progress} author={r.requested_by_name} /></div>}
                </div>
                <button type="button" className="btn sm primary" onClick={() => navigate(DRAFTING.draft(r.session))}>Review</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search drafts by template or document" />
        <label className="sr-only" htmlFor="dr-status">Status</label>
        <select id="dr-status" className="input" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ready">Ready</option>
          <option value="generating">Generating</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
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

// My own draft's review state, beside its status (drafting/review_requests.py MyReviewStatusView).
function ReviewChip({ s }: { s?: MyReviewStatus }) {
  if (!s) return null
  if (s.state === 'to_decide') return <span className="chip warn" style={{ marginLeft: 6 }}>{s.who ? `${s.who}'s changes to decide` : 'Changes to decide'}</span>
  if (s.state === 'with_reviewer') return <span className="chip info" style={{ marginLeft: 6 }}>With {s.who || 'a colleague'} for review</span>
  return <span className="chip ok" style={{ marginLeft: 6 }} title={s.at ? fmtDateTime(s.at) : undefined}>Reviewed by {s.who || 'a colleague'}</span>
}

// Where a review I was asked for stands: nothing sent yet, waiting for the author, or what they decided.
function ProgressLine({ p, author }: { p: ReviewProgress; author: string | null }) {
  const who = author || 'the author'
  if (!p.sent) return <span className="faint">Not started</span>
  const decided = [p.accepted && `${p.accepted} accepted`, p.declined && `${p.declined} declined`, p.queried && `${p.queried} queried`]
    .filter(Boolean).join(', ')
  return (
    <span>
      {p.waiting > 0 && <span className="chip warn" style={{ marginRight: 6 }}>Waiting for {who}</span>}
      {decided && <span className="chip ok" style={{ marginRight: 6 }}>{who} decided: {decided}</span>}
      <span className="faint">{p.sent} {p.sent === 1 ? 'set' : 'sets'} of changes sent</span>
    </span>
  )
}
