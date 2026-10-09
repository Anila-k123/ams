import { useEffect, useState } from 'react'
import { Modal } from '../../../ui/overlays'
import { Button } from '../../../ui/kit'
import { Field } from '../../../ui/forms'
import Icon from '../../../ui/Icon'
import { draftingApi, type DraftReviewer } from '../api/drafting'

export const POWER = {
  binding: 'can correct it directly and suggest changes',
  suggest: 'can suggest changes; you accept or decline them',
} as const

interface Props {
  sessionId: number
  open: boolean
  onClose: () => void
  onSent: () => void
}

// "Request review" for a draft not started from a task (docs/DRAFT_REVIEW.md, situations 2-4):
// pick a colleague from the team; what they may do follows the authority rule and is shown here.
export default function RequestReviewDialog({ sessionId, open, onClose, onSent }: Props) {
  const [people, setPeople] = useState<DraftReviewer[]>([])
  const [reviewer, setReviewer] = useState<number | ''>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setReviewer(''); setNote(''); setError('')
    draftingApi.getReviewers(sessionId).then(setPeople).catch(() => setError('Could not load your team.'))
  }, [open, sessionId])

  const chosen = people.find(p => p.id === reviewer)
  const send = async () => {
    if (!reviewer) return
    setBusy(true); setError('')
    try {
      await draftingApi.requestReview(sessionId, reviewer, note.trim())
      onSent()
      onClose()
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not send the request.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Request review"
      sub="Ask a colleague in your team to review this draft."
      footer={<>
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <Button variant="primary" icon="send" disabled={!reviewer || busy} loading={busy} onClick={send}>Send request</Button>
      </>}>
      <div className="stack" style={{ gap: 14 }}>
        <Field label="Reviewer" required>
          {id => (
            <select id={id} className="input" value={reviewer} onChange={e => setReviewer(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Pick a colleague</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.authority === 'binding' ? ' (can correct)' : ''}</option>)}
            </select>
          )}
        </Field>
        {chosen?.authority === 'binding' && (
          <div className="callout"><Icon name="info" size="sm" /><div>
            {chosen.name} {POWER.binding}. Their corrections come back to you to acknowledge or query.
          </div></div>
        )}
        <Field label="Note (optional)">
          {id => <textarea id={id} className="input" rows={3} value={note} onChange={e => setNote(e.target.value)}
            placeholder="Please check clauses 5 to 8 and the rent figure." />}
        </Field>
        {error && <div className="callout warn" role="alert"><Icon name="warn" size="sm" /><div>{error}</div></div>}
      </div>
    </Modal>
  )
}
