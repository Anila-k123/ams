import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import api, { errorMessage } from '../api/client'
import { useToast } from '../contexts/ToastContext'
import { Button, Chip, EmptyState, Icon, PageHead } from '../ui/kit'
import { Field, TextArea, TextField } from '../ui/forms'
import { Modal } from '../ui/overlays'
import OnlyOfficeEditor, { loadOnlyOfficeApi, useStoredVersionWatch, type EditorBackend, type OfficeEditorHandle }
  from './Drafting/components/OnlyOfficeEditor'
import type { OnlyOfficeSetup } from './Drafting/api/drafting'
import { useSaveChoice } from '../components/SaveChoiceDialog'
import { ReviewActions } from '../components/TaskReview'
import { DESKTOP_SAVED_EVENT } from '../components/DesktopEditsBar'
import { saveBlob } from '../utils/openWith'
import '../ui/pages/drafting.css'

// Any AMS document in the ONLYOFFICE editor (documents/editor.py, docs/ONLYOFFICE_PLAN.md): a case or firm
// document, or a new blank one. Each save becomes a new document version. The editor's own Version
// History, Restore and Compare work against the document's versions.

type DocInfo = { id: number; name: string; version: number; case: { id: number; title: string } | null }
type EditorState =
  | { enabled: true; url: string; editable: boolean; document: DocInfo; config: Record<string, unknown>
      desktopLock?: { by: string; since: string; pending?: boolean } | null; pendingWork?: boolean
      tasks?: { id: number; title: string; reviewStatus: string | null; canSubmit: boolean; canReview: boolean
        assignedToId: number | null; assignedById: number | null; assignedToName: string | null }[] }
  | { enabled: false; reason?: string }

export default function DocumentEditorPage() {
  const { id } = useParams()
  // Opened from Client review (docs/CLIENT_REVIEW.md) to take in the client's changes: compare with their
  // copy (?compareRound=) or a Word file they sent back (?compareFile=) once the document is open.
  const [search] = useSearchParams()
  const reviewCompare = search.get('compareRound') ? { reviewRound: Number(search.get('compareRound')) }
    : search.get('compareFile') ? { reviewFile: Number(search.get('compareFile')) } : null
  const reviewCompareDone = useRef(false)
  const docId = Number(id)
  const navigate = useNavigate()
  const toast = useToast()
  const [state, setState] = useState<EditorState | null>(null)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  // The editor's own Save / Ctrl+S / autosave keeps the edits safe as a working copy, but only PactPro's
  // Save makes a version (docs/DESKTOP_EDITING.md): `safe` says the unsaved edits are already kept.
  const [safe, setSafe] = useState(false)
  const [saving, setSaving] = useState(false)
  const editorRef = useRef<OfficeEditorHandle>(null)
  // A version made elsewhere (Save to PactPro from the desktop add-on, the bottom-right box) turns the button to "Saved".
  const storedVersion = useCallback(() => api.get<{ version: number }>(`/api/documents/${docId}/editor/state`)
    .then(r => r.data.version), [docId])
  const onStored = useCallback(() => {
    setDirty(false); setSafe(false)
    toast.success('Saved as a new version.')
    storedVersion().then(v => setState(s => (s && s.enabled ? { ...s, document: { ...s.document, version: v } } : s)))
      .catch(() => { /* the chip catches up on the next save */ })
  }, [storedVersion, toast])
  useStoredVersionWatch(storedVersion, dirty, onStored)

  const load = useCallback(() => {
    api.get<EditorState>(`/api/documents/${docId}/editor`).then(r => {
      if (r.data.enabled) loadOnlyOfficeApi(r.data.url).catch(() => { /* the editor shows the error */ })
      setState(r.data)
      // Own edits not saved to PactPro yet: the editor opens them, and Save is there to keep them.
      if (r.data.enabled && r.data.pendingWork) { setDirty(true); setSafe(true) }
    }).catch(e => setError(errorMessage(e, 'This document could not be opened.')))
  }, [docId])
  useEffect(() => { load() }, [load])
  // Desktop edits saved to PactPro (DesktopEditsBar): reload, now editable on the new version.
  useEffect(() => {
    const onSaved = (e: Event) => {
      const d = (e as CustomEvent<{ kind: string; id: number }>).detail
      if (d?.kind === 'doc' && d.id === docId) load()
    }
    window.addEventListener(DESKTOP_SAVED_EVENT, onSaved)
    return () => window.removeEventListener(DESKTOP_SAVED_EVENT, onSaved)
  }, [docId, load])

  const backend = useMemo<EditorBackend>(() => ({
    history: () => api.get(`/api/documents/${docId}/editor/history`).then(r => r.data),
    historyData: v => api.get(`/api/documents/${docId}/editor/history/${v}`).then(r => r.data),
    restore: v => api.post<{ config: Record<string, unknown>; document: DocInfo }>(
      `/api/documents/${docId}/editor/restore`, { version: v }).then(r => {
      setState(s => (s && s.enabled ? { ...s, document: r.data.document } : s))
      return r.data
    }),
    // "@" in a comment: colleagues who can open this document; mentioning one notifies them.
    users: () => api.get<{ users: { id: string; name: string; email: string }[] }>(
      `/api/documents/${docId}/editor/users`).then(r => r.data.users),
    notify: (emails, message) => api.post(`/api/documents/${docId}/editor/notify`, { emails, message }),
  }), [docId])

  // PactPro's Save: to PactPro and / or a copy on this computer, asked each time unless remembered
  // (docs/DESKTOP_EDITING.md). "Save options" always asks, to change a remembered choice.
  const saveChoice = useSaveChoice()
  const save = async (force = false) => {
    const choice = await saveChoice.ask(force)
    if (!choice) return
    setSaving(true)
    try {
      // Only "Save to PactPro" makes a version; a copy alone takes what is on screen without one.
      if (choice.pactpro) {
        await api.post(`/api/documents/${docId}/editor/save`)
        setDirty(false); setSafe(false)
      }
      if (choice.copy) await copyToComputer(!choice.pactpro)
      toast.success(choice.pactpro ? 'Saved as a new version.' : 'Copy saved to this computer.')
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save the document.'))
    } finally {
      setSaving(false)
    }
  }

  // What is on screen, to this computer: unsaved edits come from the working copy (no version made).
  const copyToComputer = async (fromScreen: boolean) => {
    const work = fromScreen
      && (await api.post<{ work: boolean }>(`/api/documents/${docId}/editor/save`, { to: 'work' })).data.work
    const r = await api.get<Blob>(work ? `/api/desktop-work/doc/${docId}` : `/api/documents/download/${docId}`,
      { responseType: 'blob' })
    const m = /filename="([^"]+)"/.exec(r.headers['content-disposition'] || '')
    saveBlob(r.data, m ? m[1] : (state && state.enabled ? state.document.name : 'document'))
  }

  const download = async () => {
    try {
      await copyToComputer(true)
    } catch (e) {
      toast.error(errorMessage(e, 'Could not download the document.'))
    }
  }

  // Compare > "Document from storage": an earlier version, or a file received back.
  // "Submit to task": this document belongs to a delegated task the user hands in. Saves to PactPro first
  // (the reviewer sees that version), then the task's usual submission (note + hours).
  const [submitTask, setSubmitTask] = useState<{ id: number; title: string; reviewStatus: string | null } | null>(null)
  const [submitNote, setSubmitNote] = useState('')
  const [submitHours, setSubmitHours] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const submitToTask = async () => {
    if (!submitTask) return
    setSubmitting(true)
    try {
      await api.post(`/api/documents/${docId}/editor/save`)   // open edits, else the working copy: a version
      setDirty(false)
      await api.post(`/api/workspace/tasks/${submitTask.id}/submit`, { note: submitNote.trim(), hours: submitHours, documentIds: [docId] })
      toast.success('Saved and submitted for review.')
      setSubmitTask(null); setSubmitNote(''); setSubmitHours(null)
      load()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not submit the task.'))
    } finally {
      setSubmitting(false)
    }
  }
  const [compareOpen, setCompareOpen] = useState(false)
  const [versions, setVersions] = useState<{ version: number; created: string; name: string }[]>([])
  const [comparing, setComparing] = useState(false)
  const openCompare = useCallback(() => {
    setCompareOpen(true)
    api.get<{ history?: { version: number; created: string; user?: { name?: string } }[] }>(
      `/api/documents/${docId}/editor/history`).then(r => setVersions((r.data.history || [])
      .map(v => ({ version: v.version, created: v.created, name: v.user?.name || '' })).reverse()))
      .catch(() => setVersions([]))
  }, [docId])
  const compareWith = async (source: { version: number } | File) => {
    setComparing(true)
    try {
      let data: Record<string, unknown>
      if (source instanceof File) {
        const form = new FormData()
        form.append('file', source)
        data = (await api.post(`/api/documents/${docId}/editor/compare`, form)).data
      } else {
        data = (await api.post(`/api/documents/${docId}/editor/compare`, source)).data
      }
      editorRef.current?.compareWith(data)
      setCompareOpen(false)
    } catch (e) {
      toast.error(errorMessage(e, 'Could not open that document for comparison.'))
    } finally {
      setComparing(false)
    }
  }

  if (error) return <EmptyState icon="file" title="Can't open this document" text={error}
    action={<Button onClick={() => navigate(-1)}>Back</Button>} />
  if (!state) return <p className="faint small" style={{ padding: 24 }}>Opening the document…</p>
  if (state.enabled === false) return <EmptyState icon="file" title="Can't open this document in the editor"
    text={state.reason || ''} action={<Button onClick={() => navigate(-1)}>Back</Button>} />

  const setup: OnlyOfficeSetup = { enabled: true, url: state.url, config: state.config }
  return (
    <div className="dr-doc-editor">
      <PageHead title={state.document.name}
        sub={state.document.case ? `Case: ${state.document.case.title || `#${state.document.case.id}`}` : 'Not linked to a case'}
        actions={<>
          <Chip>{`v${state.document.version}`}</Chip>
          {!state.editable && <Chip>Read only</Chip>}
          {state.editable && (
            <>
              {dirty && safe && (
                <span className="small muted" title="Saved by the editor (Ctrl+S, its Save icon or autosave): kept for you, but not yet a PactPro version">
                  Your work is safe; not yet a PactPro version
                </span>
              )}
              <Button size="sm" icon="check" loading={saving} disabled={saving || !dirty} onClick={() => void save()}
                title={dirty ? 'Make your edits a new PactPro version' : undefined}>
                {dirty ? 'Save to PactPro' : 'Saved'}
              </Button>
              <Button size="sm" variant="ghost" title="Where Save goes: PactPro and / or this computer"
                onClick={() => void save(true)}>Save options</Button>
            </>
          )}
          {/* Handing in edits nothing, so it stays available while someone else has the file open (read only). */}
          {(state.tasks || []).filter(t => t.canSubmit).map(t => (
            <Button key={t.id} size="sm" variant="primary" icon="send" title={`Save to PactPro and hand in "${t.title}" for review`}
              onClick={() => setSubmitTask(t)}>
              {(state.tasks || []).filter(x => x.canSubmit).length > 1 ? `Submit: ${t.title}`
                : t.reviewStatus === 'CHANGES_REQUESTED' ? 'Resubmit to task' : 'Submit to task'}
            </Button>
          ))}
          {/* The reviewer decides here, with the work open (docs/DESKTOP_EDITING.md, "Tasks"). */}
          {(state.tasks || []).filter(t => t.canReview).map(t => (
            <span key={`r${t.id}`} className="row" style={{ gap: 4 }}
              title={(state.tasks || []).filter(x => x.canReview).length > 1 ? t.title : undefined}>
              <ReviewActions task={{ ...t, needsReview: true }} myId={-1} canAssign toast={toast} buttonClass=""
                onDone={() => load()} />
            </span>
          ))}
          <Button size="sm" icon="download" onClick={() => void download()}>Download</Button>
          <Button size="sm" variant="ghost" icon="x" onClick={() => navigate(-1)}>Close</Button>
        </>} />
      {state.desktopLock && (
        <div className="row wrap" role="status" style={{ gap: 8, alignItems: 'center', margin: '0 0 8px', padding: '8px 12px',
          borderRadius: 'var(--r-md)', background: 'var(--warn-soft)', color: 'var(--warn)' }}>
          <Icon name="lock" size="sm" />
          <span className="small" style={{ flex: 1 }}>
            <strong>Read only.</strong>{' '}
            {state.desktopLock.pending
              ? `${state.desktopLock.by} has edits in a desktop editor that aren't saved to PactPro yet. You can edit once they save or discard them.`
              : `${state.desktopLock.by} has this document open in a desktop editor (Word / LibreOffice). You can edit once they close it.`}
            {(state.tasks || []).some(t => t.canSubmit) ? ' You can still submit the saved version to the task.' : ''}
          </span>
          <Button size="sm" icon="refresh" onClick={() => load()}>Check again</Button>
        </div>
      )}
      {saveChoice.dialog}
      <Modal open={!!submitTask} onClose={() => setSubmitTask(null)} title="Submit to task" sub={submitTask?.title}
        footer={<>
          <Button variant="ghost" onClick={() => setSubmitTask(null)}>Cancel</Button>
          <Button variant="primary" icon="send" loading={submitting} disabled={submitting || !submitNote.trim()}
            onClick={() => void submitToTask()}>Save and submit</Button>
        </>}>
        <div className="stack">
          <p className="small muted">This document is saved to PactPro first; the reviewer gets that version
            {state.enabled ? ` (now v${state.document.version}${dirty || state.pendingWork ? ', plus your unsaved edits' : ''})` : ''}.
            Only this document is handed in; to hand in several, use Submit work on the task.</p>
          <TextArea label="What was done?" rows={4} autoFocus required value={submitNote}
            onChange={e => setSubmitNote(e.target.value)} placeholder="e.g. Drafted the reply notice; please check para 4." />
          <TextField label="Hours spent" hint="Optional" type="number" min={0} max={999} step="0.25"
            value={submitHours ?? ''} onChange={e => setSubmitHours(e.target.value === '' ? null : Number(e.target.value))} />
        </div>
      </Modal>
      <div className="dr-doc-editor-body">
        <OnlyOfficeEditor ref={editorRef} setup={setup} backend={backend} canRestore={state.editable}
          onConfig={config => { setState(s => (s && s.enabled ? { ...s, config } : s)); setDirty(false) }}
          onCompareRequest={openCompare}
          onReady={() => {
            if (!reviewCompare || reviewCompareDone.current) return
            reviewCompareDone.current = true
            api.post<Record<string, unknown>>(`/api/documents/${docId}/editor/compare`, reviewCompare)
              .then(r => {
                editorRef.current?.compareWith(r.data)
                toast.info("The client's changes are shown as tracked changes: accept or reject each in the Review tab.")
              })
              .catch(e => toast.error(errorMessage(e, "Could not open the client's changes.")))
          }}
          onModified={m => {
            // Typing: unsaved. The editor saving its working copy (modified -> false): safe, not a version yet.
            if (m) { setDirty(true); setSafe(false) } else if (dirty) setSafe(true)
          }} />
      </div>

      <Modal title="Compare with…" open={compareOpen} onClose={() => setCompareOpen(false)}
        sub="The differences show in the document as tracked changes you accept or reject.">
        <div className="stack" style={{ gap: 12 }}>
          <Field label="A file you received back">
            {fid => (
              <input id={fid} type="file" disabled={comparing}
                onChange={e => { const f = e.target.files?.[0]; if (f) void compareWith(f) }} />
            )}
          </Field>
          <div>
            <p className="small muted">Or an earlier version of this document</p>
            {versions.length === 0 ? <p className="faint small">No saved versions yet.</p> : (
              <div className="stack" style={{ gap: 6 }}>
                {versions.map(v => (
                  <Button key={v.version} size="sm" disabled={comparing} onClick={() => void compareWith({ version: v.version })}>
                    {`Version ${v.version} · ${v.created}${v.name ? ` · ${v.name}` : ''}`}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
