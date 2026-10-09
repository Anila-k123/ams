import Icon from '../../../ui/Icon'
import type { DraftReviewRequest, ReviewRoundSummary } from '../api/drafting'
import { roundTitle } from './ReviewRoundView'

interface Props {
  rounds: ReviewRoundSummary[]
  requests: DraftReviewRequest[]
  isOwner: boolean
  onOpenRound: (id: number) => void
  onCancelRequest: (id: number) => void
}

const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : '')
const countsText = (c: ReviewRoundSummary['counts']) =>
  Object.entries(c || {}).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing decided'

// The draft's review history in the side panel, newest first, so the page above the document
// carries at most one bar (docs/DRAFT_REVIEW.md, "Where review shows on the draft page").
export default function ReviewActivity({ rounds, requests, isOwner, onOpenRound, onCancelRequest }: Props) {
  const open = rounds.filter(r => r.status === 'open')
  const finished = rounds.filter(r => r.status === 'finished')
  const reqs = isOwner ? requests.filter(r => r.status !== 'cancelled') : []
  if (!open.length && !finished.length && !reqs.length) {
    return <div className="dr-activity"><p className="faint small">No reviews on this draft yet.</p></div>
  }
  return (
    <div className="dr-activity">
      {open.length > 0 && <h4>Waiting</h4>}
      {open.map(r => (
        <div key={r.id} className={`dr-act-item${r.can_decide ? ' act' : ''}`}>
          <div className="grow">
            <strong>{roundTitle(r)}</strong>
            <div className="small muted">
              {r.can_decide
                ? (r.binding ? `${r.pending} of ${r.changes} to acknowledge or query` : `${r.pending} of ${r.changes} to decide`)
                : `waiting for ${r.decider_name || 'the owner'}`}
              {r.note && <> · "{r.note}"</>}
            </div>
          </div>
          <button type="button" className="btn sm" onClick={() => onOpenRound(r.id)}>{r.can_decide ? 'Review' : 'View'}</button>
        </div>
      ))}
      {reqs.filter(r => r.status === 'open').map(r => (
        <div key={`q-${r.id}`} className="dr-act-item">
          <div className="grow">
            <strong>With {r.reviewer_name || 'a colleague'} for review</strong>
            <div className="small muted">asked {when(r.created_at)}{r.note && <> · "{r.note}"</>}</div>
          </div>
          <button type="button" className="btn ghost sm" onClick={() => onCancelRequest(r.id)}>Cancel request</button>
        </div>
      ))}

      {(finished.length > 0 || reqs.some(r => r.status === 'done')) && <h4>History</h4>}
      {finished.map(r => (
        <div key={r.id} className="dr-act-item">
          <div className="grow">
            <strong>{r.mine && !r.external_from
              ? `${r.decider_name || 'The owner'} decided your ${r.kind === 'suggestions' ? 'suggestions' : 'corrections'}`
              : `${roundTitle(r)}: decided`}</strong>
            <div className="small muted">{countsText(r.counts)} · {when(r.finished_at)}</div>
          </div>
          <button type="button" className="btn ghost sm" onClick={() => onOpenRound(r.id)}><Icon name="eye" size="sm" />View</button>
        </div>
      ))}
      {reqs.filter(r => r.status === 'done').map(r => (
        <div key={`d-${r.id}`} className="dr-act-item">
          <div className="grow">
            <strong>Reviewed by {r.reviewer_name || 'a colleague'}</strong>
            <div className="small muted">{when(r.closed_at)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
