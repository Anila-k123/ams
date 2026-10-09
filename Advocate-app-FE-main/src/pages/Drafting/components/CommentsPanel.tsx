import { useState } from 'react'
import { Button } from '../../../ui/kit'
import Icon from '../../../ui/Icon'
import { draftingApi, type DraftComments, type DraftCommentThread } from '../api/drafting'

export interface PendingComment { blockId: number | null; quote: string }

interface Props {
  sessionId: number
  data: DraftComments | null
  onChange: (data: DraftComments) => void
  pending: PendingComment | null          // a passage picked with the Comment button, waiting for text
  onCancelPending: () => void
  onJump: (thread: DraftCommentThread) => void
}

const when = (v: string) => new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

// Comments on passages (drafting/comments.py): in a task the senior asks here instead of
// suggesting, the junior replies, the senior resolves (docs/DRAFT_REVIEW.md, "Revision").
export default function CommentsPanel({ sessionId, data, onChange, pending, onCancelPending, onJump }: Props) {
  const [draft, setDraft] = useState('')
  const [replies, setReplies] = useState<Record<number, string>>({})
  const [showResolved, setShowResolved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (fn: () => Promise<DraftComments>) => {
    setBusy(true); setError('')
    try {
      onChange(await fn())
      return true
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'That did not work. Please try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (!pending || !draft.trim()) return
    if (await run(() => draftingApi.addComment(sessionId, draft.trim(), pending.blockId, pending.quote))) {
      setDraft(''); onCancelPending()
    }
  }
  const reply = async (t: DraftCommentThread) => {
    const text = (replies[t.id] || '').trim()
    if (!text) return
    if (await run(() => draftingApi.replyComment(t.id, text))) setReplies(r => ({ ...r, [t.id]: '' }))
  }

  const threads = data?.threads ?? []
  const open = threads.filter(t => !t.resolved)
  const resolved = threads.filter(t => t.resolved)

  const card = (t: DraftCommentThread) => (
    <li key={t.id} className={`dr-comment${t.resolved ? ' resolved' : ''}`}>
      {t.quote && (
        <button type="button" className="dr-comment-quote" title="Show this passage in the draft" onClick={() => onJump(t)}>
          "{t.quote.length > 140 ? `${t.quote.slice(0, 140)}…` : t.quote}"
        </button>
      )}
      <div className="dr-comment-msg">
        <div className="xs faint"><strong>{t.author_name || 'Someone'}</strong> · {when(t.created_at)}</div>
        <div className="small">{t.body}</div>
      </div>
      {t.replies.map(r => (
        <div key={r.id} className="dr-comment-msg reply">
          <div className="xs faint"><strong>{r.author_name || 'Someone'}</strong> · {when(r.created_at)}
            {r.can_delete && (
              <button type="button" className="btn ghost sm icon" aria-label="Remove reply" title="Remove"
                disabled={busy} onClick={() => run(() => draftingApi.deleteComment(r.id))}><Icon name="trash" size="sm" /></button>
            )}
          </div>
          <div className="small">{r.body}</div>
        </div>
      ))}
      {t.resolved ? (
        <div className="row xs faint" style={{ gap: 6 }}>
          <Icon name="check" size="sm" /> Resolved by {t.resolved_by_name || 'someone'}
          {t.can_resolve && (
            <button type="button" className="btn ghost sm" disabled={busy}
              onClick={() => run(() => draftingApi.resolveComment(t.id, true))}>Reopen</button>
          )}
        </div>
      ) : (
        <>
          <textarea className="input" rows={2} value={replies[t.id] || ''} placeholder="Reply"
            aria-label={`Reply to ${t.author_name || 'comment'}`}
            onChange={e => setReplies(r => ({ ...r, [t.id]: e.target.value }))} />
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" disabled={busy || !(replies[t.id] || '').trim()} onClick={() => reply(t)}>Reply</Button>
            {t.can_resolve && (
              <Button size="sm" variant="primary" icon="check" disabled={busy}
                onClick={() => run(() => draftingApi.resolveComment(t.id))}>Resolve</Button>
            )}
            {t.can_delete && (
              <button type="button" className="btn ghost sm" disabled={busy}
                onClick={() => run(() => draftingApi.deleteComment(t.id))}>Remove</button>
            )}
          </div>
        </>
      )}
    </li>
  )

  return (
    <div className="dr-comments">
      {pending && (
        <div className="dr-comment new">
          <div className="xs faint">New comment{pending.quote ? ' on' : ''}</div>
          {pending.quote && <div className="dr-comment-quote static">"{pending.quote.length > 140 ? `${pending.quote.slice(0, 140)}…` : pending.quote}"</div>}
          <textarea className="input" rows={3} autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            aria-label="Your comment" placeholder="e.g. Did the client agree to rent in advance?" />
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" variant="primary" icon="send" disabled={busy || !draft.trim()} onClick={add}>Comment</Button>
            <button type="button" className="btn ghost sm" onClick={() => { setDraft(''); onCancelPending() }}>Cancel</button>
          </div>
        </div>
      )}
      {error && <div className="callout warn" role="alert"><Icon name="warn" size="sm" /><div>{error}</div></div>}
      {!pending && !threads.length && (
        <p className="small muted" style={{ padding: 12 }}>
          No comments yet. Select some words in the draft and click <strong>Comment</strong> in the top bar to ask about them.
        </p>
      )}
      {open.length > 0 && <ul className="dr-comment-list" aria-label="Open comments">{open.map(card)}</ul>}
      {resolved.length > 0 && (
        <>
          <button type="button" className="btn ghost sm" onClick={() => setShowResolved(v => !v)}>
            {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved
          </button>
          {showResolved && <ul className="dr-comment-list" aria-label="Resolved comments">{resolved.map(card)}</ul>}
        </>
      )}
    </div>
  )
}
