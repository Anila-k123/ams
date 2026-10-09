import { useEffect, useState } from 'react'
import { Modal } from '../../../ui/overlays'
import { SelectField, Segmented } from '../../../ui/forms'
import { Button } from '../../../ui/kit'
import { draftingApi, type DraftVersion } from '../api/drafting'

interface Props {
  sessionId: number
  visible: boolean
  onHide: () => void
  // Saves unsaved editor changes first, so "current draft" is what's on screen.
  beforeExport: () => Promise<boolean>
  // The "Add firm letterhead" tick from the Download panel (not asked again here).
  letterhead: boolean
}

const CURRENT = 0   // the "to" option for the live draft

const versionLabel = (v: DraftVersion) =>
  `v${v.number} · ${v.label || (v.kind === 'generated' ? 'AI draft' : v.kind === 'sent' ? 'Sent' : 'Saved')} · `
  + new Date(v.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

// Download → Redline: pick two versions, get a Word file with tracked changes
// (drafting/export/redline.py) that can be accepted / rejected in Word, or the same as a PDF.
export default function RedlineDialog({ sessionId, visible, onHide, beforeExport, letterhead }: Props) {
  const [versions, setVersions] = useState<DraftVersion[]>([])
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number>(CURRENT)
  const [format, setFormat] = useState<'docx' | 'pdf'>('docx')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!visible) return
    setMessage('')
    draftingApi.getVersions(sessionId).then(list => {
      setVersions(list)
      // Default "from": the last version sent out, else the latest (the server's rule too).
      setFrom((list.find(v => v.kind === 'sent') || list[0])?.id ?? null)
      setTo(CURRENT)
    }).catch(() => setMessage('Could not load versions.'))
  }, [visible, sessionId])

  const download = async () => {
    if (from == null) return
    setBusy(true); setMessage('')
    try {
      if (to === CURRENT && !(await beforeExport())) return
      const r = await draftingApi.exportRedline(sessionId, from, to || undefined, letterhead, format)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(r.blob); a.download = r.filename
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href)
      setMessage(r.inserted || r.deleted
        ? `Downloaded: ${r.inserted} word(s) added, ${r.deleted} removed.`
        : 'Downloaded: no differences between these versions.')
    } catch (e) {
      setMessage((e as { response?: { status?: number } })?.response?.status === 503
        ? 'PDF is not available on this server yet — download the Word redline instead.'
        : 'Could not create the redline — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const options = versions.map(v => ({ label: versionLabel(v), value: v.id }))
  return (
    <Modal open={visible} onClose={onHide} title="Download redline (tracked changes)"
      footer={<>
        <button type="button" className="btn ghost" onClick={onHide}>Close</button>
        <Button variant="primary" icon="download" loading={busy}
          disabled={busy || from == null || from === to} onClick={download}>Download</Button>
      </>}>
      {versions.length === 0 && !message ? (
        <p className="muted">
          No saved versions yet. Use <strong>Versions → Save</strong> when you send the draft out, then
          come back here to show what changed since.
        </p>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          <SelectField label="Compare from" value={from ?? ''} options={options}
            onChange={e => setFrom(Number(e.target.value))} />
          <SelectField label="Compare to" value={to}
            options={[{ label: 'Current draft (now)', value: CURRENT }, ...options]}
            onChange={e => setTo(Number(e.target.value))} />
          <Segmented label="Format" value={format} onChange={v => setFormat(v as 'pdf' | 'docx')}
            options={[{ value: 'docx', label: 'Word (editable)' }, { value: 'pdf', label: 'PDF (read-only)' }]} />
          <p className="faint small" style={{ margin: 0 }}>
            {format === 'docx'
              ? "Opens in Word's Review mode: each change is marked with your name and can be accepted or rejected."
              : 'A read-only copy: additions underlined, deletions struck through, in colour.'}
            {' '}Formatting-only changes are not marked.{letterhead && ' With firm letterhead.'}
          </p>
        </div>
      )}
      {message && <div className="callout" role="status" style={{ marginTop: 12 }}>{message}</div>}
    </Modal>
  )
}
