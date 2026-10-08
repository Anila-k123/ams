import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../../../ui/kit'
import Icon from '../../../ui/Icon'
import { draftingApi, type DraftVersion } from '../api/drafting'

const KIND_LABEL: Record<DraftVersion['kind'], string> = {
  generated: 'AI draft', sent: 'Sent', manual: 'Saved', review: 'Review', returned: 'Sent back',
}
const WIDTH = 340

interface Props {
  sessionId: number
  canSave: boolean
  // Saves unsaved editor changes first; false = that save failed, so don't snapshot.
  beforeSave: () => Promise<boolean>
  // Open the on-screen compare view: this version against the current draft.
  onCompare?: (versionId: number) => void
}

// "Versions" button: lists the draft's saved versions and saves a new one.
// These are what a redline export compares the current draft against.
export default function DraftVersions({ sessionId, canSave, beforeSave, onCompare }: Props) {
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<DraftVersion[] | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      const t = e.target as Node
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])

  const toggle = () => {
    if (open) { setOpen(false); return }
    setOpen(true); setError('')
    draftingApi.getVersions(sessionId).then(setVersions).catch(() => setError('Could not load versions.'))
  }

  const saveVersion = async () => {
    setBusy(true); setError('')
    try {
      if (!(await beforeSave())) return
      setVersions(await draftingApi.saveVersion(sessionId, label.trim()))
      setLabel('')
    } catch {
      setError('Could not save the version.')
    } finally {
      setBusy(false)
    }
  }

  const r = btn.current?.getBoundingClientRect()
  return <>
    <button ref={btn} type="button" className="btn sm" aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
      <Icon name="history" size="sm" />Versions
    </button>
    {open && r && createPortal(
      <div ref={pop} className="popover" role="dialog" aria-label="Versions"
        style={{ left: Math.max(8, r.right - WIDTH), top: r.bottom + 6, width: WIDTH, padding: 12 }}>
        {canSave && (
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <input className="input grow" value={label} maxLength={255} aria-label="Version label"
              placeholder="Label, e.g. Sent to opposite counsel" onChange={e => setLabel(e.target.value)} />
            <Button variant="primary" size="sm" icon="check" loading={busy} disabled={busy} onClick={saveVersion}>Save</Button>
          </div>
        )}
        {error && <div className="callout warn" role="alert" style={{ marginBottom: 8 }}>{error}</div>}
        {versions === null ? <div className="small muted">Loading…</div>
          : versions.length === 0 ? <div className="small muted">No versions saved yet.</div>
          : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 280, overflowY: 'auto' }}>
              {versions.map(v => (
                <li key={v.id} className="row" style={{ gap: 8, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                  <div className="grow">
                    <div style={{ fontWeight: 500 }}>v{v.number} · {v.label || KIND_LABEL[v.kind]}</div>
                    <div className="xs faint">
                      {KIND_LABEL[v.kind]} · {new Date(v.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </div>
                  </div>
                  {onCompare && (
                    <button type="button" className="btn ghost sm" title={`Show what changed since v${v.number}`}
                      onClick={() => { setOpen(false); onCompare(v.id) }}>Compare</button>
                  )}
                </li>
              ))}
            </ul>
          )}
      </div>,
      document.body,
    )}
  </>
}
