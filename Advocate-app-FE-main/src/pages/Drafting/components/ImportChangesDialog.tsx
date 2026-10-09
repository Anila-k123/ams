import { useEffect, useState } from 'react'
import { Modal } from '../../../ui/overlays'
import { Button } from '../../../ui/kit'
import { Field } from '../../../ui/forms'
import Icon from '../../../ui/Icon'
import { useToast } from '../../../contexts/ToastContext'
import { draftingApi, type ImportResult } from '../api/drafting'

interface Props {
  sessionId: number
  open: boolean
  onClose: () => void
  onImported: (result: ImportResult) => void
}

// "Import changes": the client or the other side sent the draft back (by email or otherwise) as a
// Word file. Its tracked changes or edits become suggestions to accept or decline, and its Word
// comments become comment threads (drafting/incoming.py, docs/DRAFT_REVIEW.md).
export default function ImportChangesDialog({ sessionId, open, onClose, onImported }: Props) {
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [fromName, setFromName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) { setFile(null); setFromName(''); setNote(''); setError('') }
  }, [open])

  const send = async () => {
    if (!file) return
    setBusy(true); setError('')
    try {
      const r = await draftingApi.importChanges(sessionId, file, fromName.trim(), note.trim())
      const parts = [r.changes && `${r.changes} change${r.changes === 1 ? '' : 's'}`,
        r.comments && `${r.comments} comment${r.comments === 1 ? '' : 's'}`].filter(Boolean).join(' and ')
      toast.success(`From ${r.from_name}: ${parts}${r.tracked ? '' : ' (no tracked changes; compared with the draft)'}`)
      onImported(r)
      onClose()
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not read the file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Import changes"
      sub="The draft came back from the client or the other side? Upload their Word file to review their changes."
      footer={<>
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <Button variant="primary" icon="upload" disabled={!file || busy} loading={busy} onClick={send}>Import</Button>
      </>}>
      <div className="stack" style={{ gap: 14 }}>
        <Field label="Word file (.docx)" required hint="With tracked changes and comments, or simply edited: both work.">
          {(id, d) => <input id={id} aria-describedby={d} type="file" className="input"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={e => setFile(e.target.files?.[0] ?? null)} />}
        </Field>
        <Field label="From" hint="Who sent it. Left empty, the names in the file's tracked changes are used.">
          {id => <input id={id} className="input" value={fromName} maxLength={120} onChange={e => setFromName(e.target.value)}
            placeholder="e.g. R. Arun Prakash (tenant's counsel)" />}
        </Field>
        <Field label="Note (optional)">
          {id => <textarea id={id} className="input" rows={2} value={note} onChange={e => setNote(e.target.value)}
            placeholder="Received by email on 10 Oct." />}
        </Field>
        <div className="callout"><Icon name="info" size="sm" /><div>
          Nothing changes in the draft yet: their changes come in as suggestions for you to accept or decline,
          and their Word comments appear in the Comments tab.
        </div></div>
        {error && <div className="callout warn" role="alert"><Icon name="warn" size="sm" /><div>{error}</div></div>}
      </div>
    </Modal>
  )
}
