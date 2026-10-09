import { useEffect, useRef, useState } from 'react'
import { usePermission } from '../../contexts/PermissionContext'
import { useToast } from '../../contexts/ToastContext'
import { Button, EmptyState, PageHead, Skel } from '../../ui/kit'
import { FilterChip, SearchInput, TextField, TextArea } from '../../ui/forms'
import { Drawer, Modal, confirm } from '../../ui/overlays'
import Icon from '../../ui/Icon'
import { playbookApi, type PlaybookListItem, type Playbook, type PlaybookClause, type PlaybookLLMProvider } from './api/drafting'

// Processing status as a Red Tape chip tone.
const STATUS_TONE: Record<string, string> = {
  ready: 'ok',
  processing: 'warn',
  pending: 'warn',
  failed: 'bad',
}

const fmtDate = (v: string) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

type CreateMethod = 'scratch' | 'document' | null

// ── Clause editor ─────────────────────────────────────────────────────────────

type RedLine = { rule: string; rationale: string }
type Fallback = { text: string; condition: string }

interface ClauseEditorProps {
  clause: PlaybookClause
  playbookId: number
  onSaved: (updated: PlaybookClause) => void
  onDeleted: (id: number) => void
}

function ClauseEditor({ clause, onSaved, onDeleted }: ClauseEditorProps) {
  const { hasPermission } = usePermission() as any
  const [clauseType, setClauseType]         = useState(clause.clause_type)
  const [standardText, setStandardText]     = useState(clause.standard_text)
  const [redLines, setRedLines]             = useState<RedLine[]>(clause.red_lines)
  const [fallbacks, setFallbacks]           = useState<Fallback[]>(clause.fallback_positions)
  const [notes, setNotes]                   = useState(clause.notes)
  const [saving, setSaving]                 = useState(false)
  const [deleting, setDeleting]             = useState(false)
  const [error, setError]                   = useState('')

  const isDirty =
    clauseType !== clause.clause_type ||
    standardText !== clause.standard_text ||
    JSON.stringify(redLines) !== JSON.stringify(clause.red_lines) ||
    JSON.stringify(fallbacks) !== JSON.stringify(clause.fallback_positions) ||
    notes !== clause.notes

  async function save() {
    setSaving(true); setError('')
    try {
      const updated = await playbookApi.updateClause(clause.id, {
        clause_type: clauseType,
        standard_text: standardText,
        red_lines: redLines,
        fallback_positions: fallbacks,
        notes,
      })
      onSaved({ ...clause, ...updated })
    } catch {
      setError('Save failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      await playbookApi.deleteClause(clause.id)
      onDeleted(clause.id)
    } catch {
      setError('Delete failed. Please try again.')
      setDeleting(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <TextField label="Clause type" value={clauseType} onChange={e => setClauseType(e.target.value)}
        placeholder="confidentiality, governing_law" />

      <TextArea label="Standard position" rows={3} value={standardText} onChange={e => setStandardText(e.target.value)}
        placeholder="The firm's standard or preferred position for this clause type" />

      {/* Red lines: each a tape-edged rule, with an optional rationale. */}
      <div>
        <div className="label" style={{ marginBottom: 6 }}>Red lines</div>
        <div className="stack" style={{ gap: 6 }}>
          {redLines.map((r, i) => (
            <div key={i} className="row dr-redline" style={{ alignItems: 'flex-start' }}>
              <div className="grow stack" style={{ gap: 4 }}>
                <input className="input" aria-label={`Red line ${i + 1}`} value={r.rule} placeholder="Non-negotiable rule"
                  onChange={e => setRedLines(prev => prev.map((x, j) => j === i ? { ...x, rule: e.target.value } : x))} />
                <input className="input" aria-label={`Rationale for red line ${i + 1}`} value={r.rationale} placeholder="Rationale (optional)"
                  onChange={e => setRedLines(prev => prev.map((x, j) => j === i ? { ...x, rationale: e.target.value } : x))} />
              </div>
              <button type="button" className="btn ghost sm icon" aria-label="Remove red line"
                onClick={() => setRedLines(prev => prev.filter((_, j) => j !== i))}><Icon name="x" size="sm" /></button>
            </div>
          ))}
          <div><button type="button" className="btn ghost sm" onClick={() => setRedLines(prev => [...prev, { rule: '', rationale: '' }])}><Icon name="plus" size="sm" />Add red line</button></div>
        </div>
      </div>

      {/* Fallback positions, in order of preference. */}
      <div>
        <div className="label" style={{ marginBottom: 6 }}>Fallback positions</div>
        <div className="stack" style={{ gap: 6 }}>
          {fallbacks.map((f, i) => (
            <div key={i} className="row dr-fallback" style={{ alignItems: 'flex-start' }}>
              <div className="grow stack" style={{ gap: 4 }}>
                <input className="input" aria-label={`Fallback ${i + 1}`} value={f.text} placeholder="Acceptable alternative text"
                  onChange={e => setFallbacks(prev => prev.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
                <input className="input" aria-label={`When to accept fallback ${i + 1}`} value={f.condition} placeholder="When to accept this (optional)"
                  onChange={e => setFallbacks(prev => prev.map((x, j) => j === i ? { ...x, condition: e.target.value } : x))} />
              </div>
              <button type="button" className="btn ghost sm icon" aria-label="Remove fallback"
                onClick={() => setFallbacks(prev => prev.filter((_, j) => j !== i))}><Icon name="x" size="sm" /></button>
            </div>
          ))}
          <div><button type="button" className="btn ghost sm" onClick={() => setFallbacks(prev => [...prev, { text: '', condition: '' }])}><Icon name="plus" size="sm" />Add fallback</button></div>
        </div>
      </div>

      <TextArea label="Notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="When to escalate, who approves" />

      {error && <div className="callout bad" role="alert"><Icon name="warn" size="sm" /><div>{error}</div></div>}

      {hasPermission('DRAFT_MANAGE') && (
        <div className="row between" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <Button variant="danger" size="sm" icon="trash" loading={deleting} disabled={saving || deleting} onClick={remove}>Delete clause</Button>
          <Button variant="primary" size="sm" icon="check" loading={saving} disabled={!isDirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save clause'}</Button>
        </div>
      )}
    </div>
  )
}

// ── Add-clause inline form ─────────────────────────────────────────────────────

function AddClauseForm({ playbookId, onAdded }: { playbookId: number; onAdded: (c: PlaybookClause) => void }) {
  const { hasPermission } = usePermission() as any
  const [open, setOpen]           = useState(false)
  const [clauseType, setClauseType] = useState('')
  const [standardText, setStandard] = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  async function submit() {
    if (!clauseType.trim()) { setError('Clause type is required.'); return }
    setSaving(true); setError('')
    try {
      const clause = await playbookApi.createClause({
        playbook: playbookId,
        clause_type: clauseType.trim(),
        standard_text: standardText,
        red_lines: [],
        fallback_positions: [],
        notes: '',
      })
      onAdded(clause)
      setOpen(false); setClauseType(''); setStandard('')
    } catch {
      setError('Could not create the clause. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!hasPermission('DRAFT_MANAGE')) return null
  if (!open) {
    return <Button size="sm" icon="plus" onClick={() => setOpen(true)}>Add clause</Button>
  }

  return (
    <div className="panel tinted"><div className="panel-body stack" style={{ gap: 12 }}>
      <b className="small">New clause</b>
      <TextField label="Clause type" required value={clauseType} onChange={e => setClauseType(e.target.value)}
        placeholder="confidentiality, governing_law" error={error || undefined} />
      <TextArea label="Standard position (optional)" rows={3} value={standardText} onChange={e => setStandard(e.target.value)}
        hint="You can edit it after saving." />
      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
        <button type="button" className="btn ghost sm" disabled={saving} onClick={() => { setOpen(false); setError('') }}>Cancel</button>
        <Button variant="primary" size="sm" icon="check" loading={saving} disabled={saving} onClick={submit}>{saving ? 'Adding…' : 'Add'}</Button>
      </div>
    </div></div>
  )
}

// ── Playbook detail drawer ────────────────────────────────────────────────────

function PlaybookDetail({ playbook: initial, onClose }: { playbook: Playbook; onClose: () => void }) {
  const [clauses, setClauses] = useState<PlaybookClause[]>(initial.clauses)

  function handleSaved(updated: PlaybookClause) {
    setClauses(prev => prev.map(c => c.id === updated.id ? updated : c))
  }

  function handleDeleted(id: number) {
    setClauses(prev => prev.filter(c => c.id !== id))
  }

  function handleAdded(clause: PlaybookClause) {
    setClauses(prev => [...prev, clause])
  }

  return (
    <Drawer open onClose={onClose} wide
      title={initial.name}
      sub={[initial.category, `${clauses.length} clause${clauses.length === 1 ? '' : 's'}`].filter(Boolean).join(', ')}
      footer={<button type="button" className="btn ghost" onClick={onClose}>Close</button>}>
      {initial.description && <p className="muted small" style={{ marginBottom: 16 }}>{initial.description}</p>}

      {clauses.length === 0 ? (
        <EmptyState icon="shield" title="No clauses yet" text="Add the first clause below." />
      ) : (
        <div>
          {clauses.map((clause, i) => (
            <details key={clause.id} className="pp-acc" open={i === 0}>
              <summary>
                <Icon name="chevron" size="sm" className="chev" />
                <b style={{ textTransform: 'capitalize' }}>{clause.clause_type.replace(/_/g, ' ')}</b>
                <span className="faint xs" style={{ marginLeft: 'auto' }}>
                  {clause.red_lines.length} red line{clause.red_lines.length === 1 ? '' : 's'}
                  {clause.source_doc_count > 1 ? `, ${clause.source_doc_count} docs` : ''}
                </span>
              </summary>
              <div style={{ padding: '0 0 18px 26px' }}>
                <ClauseEditor clause={clause} playbookId={initial.id} onSaved={handleSaved} onDeleted={handleDeleted} />
              </div>
            </details>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <AddClauseForm playbookId={initial.id} onAdded={handleAdded} />
      </div>
    </Drawer>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Playbooks() {
  const { hasPermission } = usePermission() as any
  const toast = useToast()
  const [playbooks, setPlaybooks] = useState<PlaybookListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')  // search-box filter (name / category)
  const [showChooser, setShowChooser] = useState(false)
  const [createMethod, setCreateMethod] = useState<CreateMethod>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [llmProvider, setLlmProvider] = useState<PlaybookLLMProvider>('gemini')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [over, setOver] = useState(false)   // drag-over state of the drop zone
  // Detail view
  const [viewingPlaybook, setViewingPlaybook] = useState<Playbook | null>(null)
  const [detailLoading, setDetailLoading] = useState<number | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const playbooksRef = useRef<PlaybookListItem[]>([])
  playbooksRef.current = playbooks

  const [showArchived, setShowArchived] = useState(false)   // archived playbooks view (restore)
  const load = () => playbookApi.list(showArchived).then(setPlaybooks)

  // Playbooks whose name or category contains the query (case-insensitive).
  const filteredPlaybooks = playbooks.filter(pb => {
    const q = query.trim().toLowerCase()
    return !q || pb.name.toLowerCase().includes(q) || (pb.category || '').toLowerCase().includes(q)
  })

  useEffect(() => {
    load().finally(() => setLoading(false))
    const id = setInterval(() => {
      if (playbooksRef.current.some(p => p.status === 'pending' || p.status === 'processing')) load()
    }, 3000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when switching to/from the archived view
  }, [showArchived])

  async function handleViewPlaybook(pb: PlaybookListItem) {
    setDetailLoading(pb.id)
    try {
      const full = await playbookApi.get(pb.id)
      setViewingPlaybook(full)
    } catch {
      toast.error('Could not load the playbook details')
    } finally {
      setDetailLoading(null)
    }
  }

  function resetForm() {
    setName(''); setCategory(''); setDescription(''); setLlmProvider('gemini')
    setFiles([]); setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function openCreate(method: CreateMethod) {
    resetForm()
    setShowChooser(false)
    setCreateMethod(method)
  }

  const addFiles = (list: File[]) => setFiles(prev => {
    const existing = new Set(prev.map(f => f.name + f.size))
    return [...prev, ...list.filter(f => !existing.has(f.name + f.size))]
  })

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files ?? []))
    e.target.value = '' // reset so the same file can be re-added after removal
  }

  async function handleCreate() {
    if (!name.trim()) { setError('Name is required.'); return }
    if (createMethod === 'document' && files.length === 0) {
      setError('Upload at least one document.'); return
    }
    setBusy(true); setError('')
    try {
      const fd = new FormData()
      fd.append('name', name.trim())
      fd.append('category', category.trim())
      fd.append('description', description.trim())
      fd.append('method', createMethod!)
      fd.append('llm_provider', createMethod === 'document' ? llmProvider : 'gemini')
      files.forEach(f => fd.append('documents', f))
      const pb = await playbookApi.create(fd)
      setPlaybooks(prev => [pb as unknown as PlaybookListItem, ...prev])
      setCreateMethod(null)
      toast.success('Playbook created. Processing has started.')
    } catch {
      setError('Failed to create the playbook. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // "Delete" archives: hidden, not offered for new drafts, restorable by the
  // creator or a Super Admin (only they see the button; the server enforces it).
  function handleDelete(pb: PlaybookListItem) {
    confirm({
      title: 'Archive this playbook?',
      message: `${pb.name} will be hidden and can't be used to check new drafts. Drafts already checked against it keep their findings. You or a Super Admin can restore it from Show archived.`,
      confirmLabel: 'Archive playbook',
      danger: true,
      accept: async () => {
        try {
          await playbookApi.delete(pb.id)
          setPlaybooks(prev => prev.filter(p => p.id !== pb.id))
          toast.success(`${pb.name} archived`)
        } catch (e) {
          const status = (e as { response?: { status?: number } }).response?.status
          toast.error(status === 403 ? 'Only the person who created it or a Super Admin can archive it.' : 'Archive failed')
        }
      },
    })
  }

  async function handleRestore(pb: PlaybookListItem) {
    try {
      await playbookApi.restore(pb.id)
      setPlaybooks(prev => prev.filter(p => p.id !== pb.id))
      toast.success(`${pb.name} restored`)
    } catch {
      toast.error('Restore failed')
    }
  }


  async function handleReprocess(pb: PlaybookListItem) {
    try {
      await playbookApi.reprocess(pb.id)
      setPlaybooks(prev => prev.map(p => p.id === pb.id ? { ...p, status: 'processing' } : p))
      toast.info('Reprocessing started')
    } catch {
      toast.error('Failed to start reprocessing')
    }
  }

  const backToChooser = () => { setCreateMethod(null); resetForm(); setShowChooser(true) }
  const canManage = hasPermission('DRAFT_MANAGE')

  return (
    <div>
      {viewingPlaybook && (
        <PlaybookDetail playbook={viewingPlaybook} onClose={() => setViewingPlaybook(null)} />
      )}

      <PageHead title="Clause Playbooks"
        sub="Your firm's standard positions, red lines and fallbacks. Drafts are checked against them in the editor."
        actions={canManage && <Button variant="primary" icon="plus" onClick={() => setShowChooser(true)}>New playbook</Button>} />

      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search playbooks" />
        <FilterChip on={showArchived} onClick={() => setShowArchived(v => !v)}><Icon name="archive" size="sm" />Show archived</FilterChip>
      </div>

      <div className="doc-grid dr-card-grid">
        {loading && [1, 2, 3].map(i => (
          <div key={i} className="panel"><div className="panel-body stack" style={{ gap: 10 }}><Skel w={80} /><Skel h={22} /><Skel w="50%" /></div></div>
        ))}

        {!loading && filteredPlaybooks.map(pb => {
          const ready = pb.status === 'ready'
          const busyPb = pb.status === 'processing' || pb.status === 'pending'
          return (
            <div key={pb.id} className={`panel dr-pb-card${ready ? ' clickable' : ''}`}>
              <div className="panel-body dr-tile-body">
                <div className="row between">
                  <span className={`chip ${STATUS_TONE[pb.status] ?? ''}${busyPb ? ' plain' : ''}`}>
                    {busyPb && <span className="pp-spin" aria-hidden="true" />}
                    {pb.status.charAt(0).toUpperCase() + pb.status.slice(1)}
                  </span>
                  {pb.category && <span className="faint xs">{pb.category}</span>}
                </div>
                <h3 className="dr-tile-title">
                  {ready
                    ? <button type="button" className="dr-title-btn" onClick={() => handleViewPlaybook(pb)}>{pb.name}</button>
                    : pb.name}
                </h3>
                {pb.description && <p className="muted small pp-clamp">{pb.description}</p>}
                <div className="faint xs">
                  {pb.method === 'document'
                    ? `${pb.document_count} source document${pb.document_count !== 1 ? 's' : ''}`
                    : 'Written from scratch'}
                  {', '}{fmtDate(pb.created_at)}
                  {pb.created_by_name && <>{' · by '}{pb.created_by_name}</>}
                </div>
                <span className="grow" />
                <div className="row wrap" style={{ gap: 6 }}>
                  {ready && (
                    <Button size="sm" icon="eye" loading={detailLoading === pb.id} disabled={detailLoading === pb.id}
                      onClick={() => handleViewPlaybook(pb)}>Open</Button>
                  )}
                  {(pb.status === 'failed' || ready) && pb.method === 'document' && (
                    <Button size="sm" icon="refresh" onClick={() => handleReprocess(pb)}>{pb.status === 'failed' ? 'Retry' : 'Reprocess'}</Button>
                  )}
                  <span className="grow" />
                  {pb.can_archive && (showArchived
                    ? <Button size="sm" icon="restore" onClick={() => handleRestore(pb)}>Restore</Button>
                    : <button type="button" className="btn ghost sm icon" aria-label={`Archive ${pb.name}`} title="Archive"
                        onClick={() => handleDelete(pb)}><Icon name="archive" size="sm" /></button>)}
                </div>
              </div>
            </div>
          )
        })}

        {!loading && filteredPlaybooks.length === 0 && (
          <div className="panel" style={{ gridColumn: '1 / -1' }}>
            <EmptyState icon="shield"
              title={playbooks.length ? 'No playbooks match' : 'No playbooks yet'}
              text={playbooks.length ? `Nothing matches “${query}”.` : 'Write one from scratch or let PactPro build it from signed agreements.'}
              action={!playbooks.length && canManage ? <Button variant="primary" size="sm" icon="plus" onClick={() => setShowChooser(true)}>New playbook</Button> : undefined} />
          </div>
        )}
      </div>

      {/* Create method chooser */}
      <Modal title="New playbook" sub="How do you want to start?" open={showChooser} onClose={() => setShowChooser(false)} size="wide"
        footer={<button type="button" className="btn ghost" onClick={() => setShowChooser(false)}>Cancel</button>}>
        <div className="cols g-2 dr-begin">
          <button type="button" className="pp-opt" onClick={() => openCreate('scratch')}>
            <Icon name="pen" size="lg" />
            <h3>Write from scratch</h3>
            <span className="muted small">Define standard positions, red lines and fallbacks yourself.</span>
          </button>
          <button type="button" className="pp-opt" onClick={() => openCreate('document')}>
            <Icon name="upload" size="lg" />
            <h3>Build from documents</h3>
            <span className="muted small">Upload signed agreements and let PactPro extract the standard positions.</span>
          </button>
        </div>
      </Modal>

      {/* Configure playbook form */}
      <Modal
        title={createMethod === 'scratch' ? 'Write from scratch' : 'Build from documents'}
        open={createMethod === 'scratch' || createMethod === 'document'}
        onClose={backToChooser}
        dismissable={!busy}
        footer={<>
          <button type="button" className="btn ghost" onClick={backToChooser} disabled={busy}>Back</button>
          <Button variant="primary" icon="check" loading={busy} disabled={busy} onClick={handleCreate}>{busy ? 'Creating…' : 'Create playbook'}</Button>
        </>}
      >
        <div className="stack" style={{ gap: 14 }}>
          <TextField label="Name" required value={name} onChange={e => setName(e.target.value)} placeholder="NDA Playbook 2026" />
          <TextField label="Category" value={category} onChange={e => setCategory(e.target.value)} placeholder="NDA, MSA, Employment Agreement" />
          <TextArea label="Description" rows={3} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="What clauses or positions does this playbook cover?" />

          {createMethod === 'document' && (
            <div className="field">
              <span className="label">Source documents <span className="req" aria-hidden="true">*</span></span>
              <span className="hint">One or more past agreements (PDF or DOCX). Clause positions are extracted from each.</span>
              <label htmlFor="pb-files" className={`dropzone dr-drop${over ? ' over' : ''}`}
                onDragOver={e => { e.preventDefault(); setOver(true) }}
                onDragLeave={() => setOver(false)}
                onDrop={e => {
                  e.preventDefault(); setOver(false)
                  addFiles(Array.from(e.dataTransfer.files).filter(f => f.name.match(/\.(pdf|docx|doc)$/i)))
                }}>
                <Icon name="upload" />
                <span className="small" style={{ fontWeight: 500, color: 'var(--ink)' }}>Drop files here, or choose files</span>
                <span className="faint xs">PDF, DOCX, up to 20 MB each</span>
                <input ref={fileInputRef} id="pb-files" type="file" multiple accept=".pdf,.docx,.doc" className="sr-only" onChange={handleFileSelect} />
              </label>

              {files.length > 0 && (
                <div className="panel" style={{ padding: '4px 0', marginTop: 8 }}>
                  {files.map((f, i) => (
                    <div key={i} className="list-item">
                      <Icon name="file" size="sm" />
                      <span className="grow ellipsis small">{f.name}</span>
                      <span className="faint xs mono">{(f.size / 1024).toFixed(0)} KB</span>
                      <button type="button" className="btn ghost sm icon" aria-label={`Remove ${f.name}`}
                        onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}><Icon name="x" size="sm" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <div className="callout bad" role="alert"><Icon name="warn" size="sm" /><div>{error}</div></div>}
        </div>
      </Modal>
    </div>
  )
}
