import { useEffect, useRef, useState } from 'react'
import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { InputTextarea } from 'primereact/inputtextarea'
import { Tag } from 'primereact/tag'
import { Toast } from 'primereact/toast'
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog'
import { ProgressSpinner } from 'primereact/progressspinner'
import { Accordion, AccordionTab } from 'primereact/accordion'
import { playbookApi, type PlaybookListItem, type Playbook, type PlaybookClause, type PlaybookLLMProvider } from './api/drafting'

const STATUS_SEVERITY: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
  ready: 'success',
  processing: 'info',
  pending: 'warning',
  failed: 'danger',
}

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
      setError('Save failed — please try again.')
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
      setError('Delete failed — please try again.')
      setDeleting(false)
    }
  }

  const fieldLabel = (text: string, color = 'var(--pp-slate-400)') => (
    <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color, marginBottom: '0.35rem' }}>
      {text}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Clause type */}
      <div>
        {fieldLabel('Clause type')}
        <InputText
          value={clauseType}
          onChange={e => setClauseType(e.target.value)}
          style={{ width: '100%', fontSize: '0.85rem' }}
          placeholder="e.g. confidentiality, governing_law"
        />
      </div>

      {/* Standard position */}
      <div>
        {fieldLabel('Standard position', 'var(--primary-color)')}
        <InputTextarea
          value={standardText}
          onChange={e => setStandardText(e.target.value)}
          rows={4}
          autoResize
          style={{ width: '100%', fontSize: '0.83rem', lineHeight: 1.6,
            borderLeft: '3px solid var(--primary-color)', borderRadius: '6px' }}
          placeholder="Describe the firm's standard / preferred position for this clause type…"
        />
      </div>

      {/* Red lines */}
      <div>
        {fieldLabel('Red lines', 'var(--red-500)')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {redLines.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
              background: '#fff5f5', borderRadius: '6px', padding: '0.6rem 0.75rem',
              borderLeft: '3px solid var(--red-400)' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <InputText
                  value={r.rule}
                  onChange={e => setRedLines(prev => prev.map((x, j) => j === i ? { ...x, rule: e.target.value } : x))}
                  placeholder="Non-negotiable rule…"
                  style={{ fontSize: '0.82rem', fontWeight: 600 }}
                />
                <InputText
                  value={r.rationale}
                  onChange={e => setRedLines(prev => prev.map((x, j) => j === i ? { ...x, rationale: e.target.value } : x))}
                  placeholder="Rationale (optional)…"
                  style={{ fontSize: '0.78rem' }}
                />
              </div>
              <Button icon="pi pi-times" text rounded size="small" severity="danger"
                style={{ flexShrink: 0, marginTop: '0.15rem' }}
                onClick={() => setRedLines(prev => prev.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button label="Add red line" icon="pi pi-plus" text size="small" severity="danger"
            style={{ alignSelf: 'flex-start', fontSize: '0.8rem' }}
            onClick={() => setRedLines(prev => [...prev, { rule: '', rationale: '' }])} />
        </div>
      </div>

      {/* Fallback positions */}
      <div>
        {fieldLabel('Fallback positions', 'var(--orange-600)')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {fallbacks.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
              background: '#fff8f0', borderRadius: '6px', padding: '0.6rem 0.75rem',
              borderLeft: '3px solid var(--orange-400)' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <InputText
                  value={f.text}
                  onChange={e => setFallbacks(prev => prev.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                  placeholder="Acceptable alternative text…"
                  style={{ fontSize: '0.82rem' }}
                />
                <InputText
                  value={f.condition}
                  onChange={e => setFallbacks(prev => prev.map((x, j) => j === i ? { ...x, condition: e.target.value } : x))}
                  placeholder="When to accept this (optional)…"
                  style={{ fontSize: '0.78rem' }}
                />
              </div>
              <Button icon="pi pi-times" text rounded size="small" severity="secondary"
                style={{ flexShrink: 0, marginTop: '0.15rem' }}
                onClick={() => setFallbacks(prev => prev.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button label="Add fallback" icon="pi pi-plus" text size="small" severity="warning"
            style={{ alignSelf: 'flex-start', fontSize: '0.8rem' }}
            onClick={() => setFallbacks(prev => [...prev, { text: '', condition: '' }])} />
        </div>
      </div>

      {/* Notes */}
      <div>
        {fieldLabel('Notes')}
        <InputTextarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          autoResize
          style={{ width: '100%', fontSize: '0.8rem', fontStyle: 'italic' }}
          placeholder="Internal notes for this clause…"
        />
      </div>

      {error && <div style={{ fontSize: '0.8rem', color: 'var(--red-500)' }}>{error}</div>}

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderTop: '1px solid var(--pp-border)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
        <Button label="Delete clause" icon="pi pi-trash" text size="small" severity="danger"
          loading={deleting} disabled={saving}
          onClick={remove} />
        <Button label={saving ? 'Saving…' : 'Save'}
          icon={saving ? 'pi pi-spin pi-spinner' : 'pi pi-check'}
          size="small" disabled={!isDirty || saving} loading={saving}
          onClick={save} />
      </div>
    </div>
  )
}

// ── Add-clause inline form ─────────────────────────────────────────────────────

function AddClauseForm({ playbookId, onAdded }: { playbookId: number; onAdded: (c: PlaybookClause) => void }) {
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
      setError('Could not create clause — please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div style={{ textAlign: 'center', paddingTop: '0.5rem' }}>
        <Button label="Add clause" icon="pi pi-plus" outlined size="small"
          onClick={() => setOpen(true)} />
      </div>
    )
  }

  return (
    <div style={{ border: '2px dashed var(--primary-color)', borderRadius: '8px',
      padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--primary-color)' }}>
        New clause
      </div>
      <InputText value={clauseType} onChange={e => setClauseType(e.target.value)}
        placeholder="Clause type (e.g. confidentiality, governing_law)" style={{ width: '100%', fontSize: '0.85rem' }} />
      <InputTextarea value={standardText} onChange={e => setStandard(e.target.value)}
        rows={3} autoResize placeholder="Standard position text (optional — you can edit after saving)…"
        style={{ width: '100%', fontSize: '0.83rem' }} />
      {error && <div style={{ fontSize: '0.8rem', color: 'var(--red-500)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button label="Cancel" severity="secondary" text size="small"
          disabled={saving} onClick={() => { setOpen(false); setError('') }} />
        <Button label={saving ? 'Adding…' : 'Add'} icon="pi pi-check" size="small"
          loading={saving} onClick={submit} />
      </div>
    </div>
  )
}

// ── Playbook detail dialog ────────────────────────────────────────────────────

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
    <Dialog
      header={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span>{initial.name}</span>
          {initial.category && (
            <span style={{ fontSize: '0.75rem', color: 'var(--pp-slate-400)', fontWeight: 400 }}>
              {initial.category}
            </span>
          )}
        </div>
      }
      visible
      style={{ width: '720px', maxWidth: '95vw' }}
      onHide={onClose}
      footer={<Button label="Close" severity="secondary" text onClick={onClose} />}
      maximizable
    >
      {initial.description && (
        <p style={{ margin: '0 0 1rem', color: 'var(--pp-slate-500)', fontSize: '0.85rem', lineHeight: 1.6 }}>
          {initial.description}
        </p>
      )}

      {clauses.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem 2rem 1rem', color: 'var(--pp-slate-400)', fontSize: '0.875rem' }}>
          No clauses yet — add one below.
        </div>
      ) : (
        <Accordion multiple>
          {clauses.map(clause => (
            <AccordionTab
              key={clause.id}
              header={
                <span style={{ textTransform: 'capitalize', fontWeight: 600, fontSize: '0.875rem' }}>
                  {clause.clause_type.replace(/_/g, ' ')}
                  <span style={{ fontWeight: 400, color: 'var(--pp-slate-400)', marginLeft: '0.5rem', fontSize: '0.75rem' }}>
                    {clause.source_doc_count > 1 ? `${clause.source_doc_count} docs` : ''}
                  </span>
                </span>
              }
            >
              <ClauseEditor
                clause={clause}
                playbookId={initial.id}
                onSaved={handleSaved}
                onDeleted={handleDeleted}
              />
            </AccordionTab>
          ))}
        </Accordion>
      )}

      <div style={{ marginTop: '1rem' }}>
        <AddClauseForm playbookId={initial.id} onAdded={handleAdded} />
      </div>
    </Dialog>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Playbooks() {
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
  // Detail view
  const [viewingPlaybook, setViewingPlaybook] = useState<Playbook | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const toast = useRef<Toast>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const playbooksRef = useRef<PlaybookListItem[]>([])
  playbooksRef.current = playbooks

  const load = () => playbookApi.list().then(setPlaybooks)

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
  }, [])

  async function handleViewPlaybook(pb: PlaybookListItem) {
    setDetailLoading(true)
    try {
      const full = await playbookApi.get(pb.id)
      setViewingPlaybook(full)
    } catch {
      toast.current?.show({ severity: 'error', summary: 'Could not load playbook details', life: 3000 })
    } finally {
      setDetailLoading(false)
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

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size))
      return [...prev, ...selected.filter(f => !existing.has(f.name + f.size))]
    })
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
      toast.current?.show({ severity: 'success', summary: 'Playbook created — processing started', life: 4000 })
    } catch {
      setError('Failed to create playbook. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function handleDelete(pb: PlaybookListItem) {
    confirmDialog({
      message: `Delete playbook "${pb.name}"? This cannot be undone.`,
      header: 'Delete Playbook',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await playbookApi.delete(pb.id)
          setPlaybooks(prev => prev.filter(p => p.id !== pb.id))
          toast.current?.show({ severity: 'success', summary: 'Deleted', life: 2000 })
        } catch {
          toast.current?.show({ severity: 'error', summary: 'Delete failed', life: 3000 })
        }
      },
    })
  }

  async function handleReprocess(pb: PlaybookListItem) {
    try {
      await playbookApi.reprocess(pb.id)
      setPlaybooks(prev => prev.map(p => p.id === pb.id ? { ...p, status: 'processing' } : p))
      toast.current?.show({ severity: 'info', summary: 'Reprocessing started', life: 2000 })
    } catch {
      toast.current?.show({ severity: 'error', summary: 'Failed to start reprocessing', life: 3000 })
    }
  }

  return (
    <div className="pp-page">
      <Toast ref={toast} />
      <ConfirmDialog />

      {/* Detail dialog */}
      {viewingPlaybook && (
        <PlaybookDetail playbook={viewingPlaybook} onClose={() => setViewingPlaybook(null)} />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <span className="p-input-icon-left">
          <i className="pi pi-search" />
          <InputText value={query} onChange={e => setQuery(e.target.value)} placeholder="Search playbooks" />
        </span>
        <Button label="Create New" icon="pi pi-plus" onClick={() => setShowChooser(true)}
          style={{ flexShrink: 0 }} />
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <ProgressSpinner style={{ width: '40px', height: '40px' }} />
        </div>
      )}

      {/* Empty state */}
      {!loading && playbooks.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--pp-slate-400)' }}>
          <i className="pi pi-shield" style={{ fontSize: '2.5rem', marginBottom: '1rem', display: 'block' }} />
          <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>No playbooks yet</div>
          <div style={{ fontSize: '0.875rem' }}>Create a playbook to start analysing draft risks.</div>
        </div>
      )}

      {/* No search matches */}
      {!loading && playbooks.length > 0 && filteredPlaybooks.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem 2rem', color: 'var(--pp-slate-400)' }}>
          No playbooks match “{query}”.
        </div>
      )}

      {/* Playbook cards */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
          {filteredPlaybooks.map(pb => (
            <div
              key={pb.id}
              style={{
                padding: '1.25rem', borderRadius: '8px',
                border: '1px solid var(--pp-border)', background: 'var(--pp-surface)',
                cursor: pb.status === 'ready' ? 'pointer' : 'default',
                transition: 'box-shadow 0.15s, border-color 0.15s',
              }}
              onClick={() => pb.status === 'ready' && handleViewPlaybook(pb)}
              onMouseEnter={e => { if (pb.status === 'ready') (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 10px rgba(0,0,0,0.08)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{pb.name}</div>
                  {pb.category && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--pp-slate-400)', marginTop: '0.1rem', display: 'block' }}>
                      {pb.category}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexShrink: 0 }}>
                  <Tag value={pb.status.charAt(0).toUpperCase() + pb.status.slice(1)} severity={STATUS_SEVERITY[pb.status] ?? 'info'} />
                </div>
              </div>

              {pb.description && (
                <p style={{ fontSize: '0.8rem', color: 'var(--pp-slate-500)', margin: '0 0 0.75rem', lineHeight: 1.5 }}>
                  {pb.description}
                </p>
              )}

              <div style={{ fontSize: '0.75rem', color: 'var(--pp-slate-400)', marginBottom: '0.75rem' }}>
                {pb.method === 'document'
                  ? `${pb.document_count} source document${pb.document_count !== 1 ? 's' : ''}`
                  : 'Written from scratch'}
                {' · '}{new Date(pb.created_at).toLocaleDateString('en-GB')}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
                onClick={e => e.stopPropagation()} // don't open detail when clicking buttons
              >
                {pb.status === 'ready' && (
                  <Button size="small" label="View" icon="pi pi-eye" severity="secondary"
                    outlined onClick={() => handleViewPlaybook(pb)}
                    loading={detailLoading} />
                )}
                {(pb.status === 'failed' || pb.status === 'ready') && pb.method === 'document' && (
                  <Button size="small"
                    label={pb.status === 'failed' ? 'Retry' : 'Reprocess'}
                    icon="pi pi-refresh"
                    severity={pb.status === 'failed' ? 'warning' : 'secondary'}
                    onClick={() => handleReprocess(pb)} outlined />
                )}
                <Button size="small" icon="pi pi-trash" severity="danger" text
                  tooltip="Delete" tooltipOptions={{ position: 'top' }}
                  onClick={() => handleDelete(pb)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create method chooser */}
      <Dialog
        header="Create New Playbook"
        visible={showChooser}
        style={{ width: '480px' }}
        onHide={() => setShowChooser(false)}
        footer={<Button label="Cancel" severity="secondary" text onClick={() => setShowChooser(false)} />}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingTop: '0.5rem' }}>
          <div
            onClick={() => openCreate('scratch')}
            style={{ padding: '1rem 1.25rem', border: '2px solid var(--pp-border)', borderRadius: '8px',
              cursor: 'pointer', transition: 'border-color 0.15s', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary-color)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--pp-border)')}
          >
            <i className="pi pi-pencil" style={{ fontSize: '1.5rem', color: 'var(--primary-color)', marginTop: '0.15rem' }} />
            <div>
              <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>Write from Scratch</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--pp-slate-500)' }}>
                Manually define standard positions, red lines, and fallback clauses.
              </div>
            </div>
          </div>

          <div
            onClick={() => openCreate('document')}
            style={{ padding: '1rem 1.25rem', border: '2px solid var(--pp-border)', borderRadius: '8px',
              cursor: 'pointer', transition: 'border-color 0.15s', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary-color)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--pp-border)')}
          >
            <i className="pi pi-upload" style={{ fontSize: '1.5rem', color: 'var(--primary-color)', marginTop: '0.15rem' }} />
            <div>
              <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>Generate from Documents</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--pp-slate-500)' }}>
                Upload past agreements and let AI extract standard positions automatically.
              </div>
            </div>
          </div>
        </div>
      </Dialog>

      {/* Configure playbook form */}
      <Dialog
        header={createMethod === 'scratch' ? 'Write from Scratch' : 'Generate from Documents'}
        visible={createMethod === 'scratch' || createMethod === 'document'}
        style={{ width: '520px' }}
        onHide={() => { setCreateMethod(null); resetForm(); setShowChooser(true) }}
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button label="Back" severity="secondary" text
              onClick={() => { setCreateMethod(null); resetForm(); setShowChooser(true) }} disabled={busy} />
            <Button label={busy ? 'Creating…' : 'Create'} icon={busy ? 'pi pi-spin pi-spinner' : 'pi pi-check'}
              onClick={handleCreate} disabled={busy} />
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingTop: '0.25rem' }}>
          <div className="p-field">
            <label style={{ fontWeight: 500, marginBottom: '0.4rem', display: 'block', fontSize: '0.875rem' }}>
              Name <span style={{ color: 'red' }}>*</span>
            </label>
            <InputText value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. NDA Playbook 2024" style={{ width: '100%' }} />
          </div>

          <div className="p-field">
            <label style={{ fontWeight: 500, marginBottom: '0.4rem', display: 'block', fontSize: '0.875rem' }}>
              Category
            </label>
            <InputText value={category} onChange={e => setCategory(e.target.value)}
              placeholder="e.g. NDA, MSA, Employment Agreement" style={{ width: '100%' }} />
          </div>

          <div className="p-field">
            <label style={{ fontWeight: 500, marginBottom: '0.4rem', display: 'block', fontSize: '0.875rem' }}>
              Description
            </label>
            <InputTextarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="What should this playbook do? What clauses or positions does it cover?"
              rows={3} style={{ width: '100%', resize: 'vertical' }} autoResize />
          </div>

          {createMethod === 'document' && (
            <div className="p-field">
              <label style={{ fontWeight: 500, marginBottom: '0.4rem', display: 'block', fontSize: '0.875rem' }}>
                Upload Documents <span style={{ color: 'red' }}>*</span>
              </label>
              <p style={{ fontSize: '0.8rem', color: 'var(--pp-slate-500)', margin: '0 0 0.75rem' }}>
                Upload one or more past agreements (PDF or DOCX). The AI will extract clause positions from each.
              </p>

              {/* Simple file drop zone — avoids PrimeReact FileUpload's confusing "Pending" badge */}
              <div
                style={{
                  border: '2px dashed var(--pp-border)', borderRadius: '8px', padding: '1.25rem',
                  textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.15s',
                  background: 'var(--surface-50)',
                }}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--primary-color)' }}
                onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--pp-border)' }}
                onDrop={e => {
                  e.preventDefault()
                  e.currentTarget.style.borderColor = 'var(--pp-border)'
                  const dropped = Array.from(e.dataTransfer.files).filter(
                    f => f.name.match(/\.(pdf|docx|doc)$/i)
                  )
                  setFiles(prev => {
                    const existing = new Set(prev.map(f => f.name + f.size))
                    return [...prev, ...dropped.filter(f => !existing.has(f.name + f.size))]
                  })
                }}
              >
                <i className="pi pi-upload" style={{ fontSize: '1.25rem', color: 'var(--pp-slate-400)', marginBottom: '0.4rem', display: 'block' }} />
                <div style={{ fontSize: '0.85rem', color: 'var(--pp-slate-500)' }}>
                  Drag & drop files here, or <span style={{ color: 'var(--primary-color)', fontWeight: 500 }}>click to browse</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--pp-slate-400)', marginTop: '0.25rem' }}>
                  PDF, DOCX — up to 20 MB each
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.doc"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />

              {/* Selected file list */}
              {files.length > 0 && (
                <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {files.map((f, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: '0.6rem',
                      fontSize: '0.82rem', padding: '0.4rem 0.75rem', borderRadius: '6px',
                      background: 'var(--surface-100)', color: 'var(--pp-slate-700)',
                    }}>
                      <i className={f.name.endsWith('.pdf') ? 'pi pi-file-pdf' : 'pi pi-file-word'}
                        style={{ color: f.name.endsWith('.pdf') ? 'var(--red-500)' : 'var(--blue-500)' }} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.name}
                      </span>
                      <span style={{ color: 'var(--pp-slate-400)', fontSize: '0.75rem', flexShrink: 0 }}>
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                      <Button icon="pi pi-times" text rounded size="small" severity="secondary"
                        style={{ width: '1.5rem', height: '1.5rem', flexShrink: 0 }}
                        onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={{ color: 'var(--red-500)', fontSize: '0.85rem' }}>{error}</div>
          )}
        </div>
      </Dialog>
    </div>
  )
}
