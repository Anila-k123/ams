import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Spinner } from '../../../ui/kit'
import { confirm } from '../../../ui/overlays'
import Icon from '../../../ui/Icon'
import { draftingApi, type ChangeDecision, type ChangeDecisionKind, type ReviewRound } from '../api/drafting'
import { ComparedPara, changeList, kindLabel, scrollToChange, stepChange } from './compareParts'

// What each decision is called, by round type (docs/DRAFT_REVIEW.md):
// suggestions -> Accept / Decline; changes already made -> Keep / Reject; a senior's binding
// corrections -> OK / Query (they are never undone).
const ACTION: Record<ChangeDecisionKind, { label: string; done: string; icon: 'check' | 'x' | 'chat' }> = {
  accepted: { label: 'Accept', done: 'Accepted', icon: 'check' },
  declined: { label: 'Decline', done: 'Declined', icon: 'x' },
  rejected: { label: 'Reject', done: 'Rejected', icon: 'x' },
  acknowledged: { label: 'OK', done: 'Acknowledged', icon: 'check' },
  queried: { label: 'Query', done: 'Queried', icon: 'chat' },
}

function actionLabel(rnd: ReviewRound, d: ChangeDecisionKind) {
  if (d === 'accepted' && rnd.kind === 'changes') return 'Keep'
  return ACTION[d].label
}
function doneLabel(rnd: ReviewRound, d: ChangeDecisionKind) {
  if (d === 'accepted' && rnd.kind === 'changes') return 'Kept'
  return ACTION[d].done
}

export function roundTitle(rnd: Pick<ReviewRound, 'kind' | 'binding' | 'author_name'>) {
  const who = rnd.author_name || 'Someone'
  if (rnd.binding) return `Corrections by ${who}`
  return rnd.kind === 'suggestions' ? `Suggestions from ${who}` : `Changes by ${who}`
}

interface Props {
  roundId: number
  docTitle: string
  onClose: () => void
  // The round was finished / withdrawn: the page reloads the draft (decisions may have changed it).
  onDone: (rnd: ReviewRound) => void
}

// A review round on screen: the comparison (same as Compare) with a decision on every change.
// The person the round waits for decides; everyone else sees the decisions read-only.
export default function ReviewRoundView({ roundId, docTitle, onClose, onDone }: Props) {
  const [rnd, setRnd] = useState<ReviewRound | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState(0)
  // A decision that needs a reason (decline / query), waiting for the text: change id or 'all'.
  const [asking, setAsking] = useState<{ change: number | 'all'; decision: ChangeDecisionKind } | null>(null)
  // Decided changes whose choices are open again (the reviewer clicked Change).
  const [changing, setChanging] = useState<Set<number>>(new Set())
  const [reason, setReason] = useState('')
  const sheet = useRef<HTMLElement>(null)

  const load = useCallback(() => {
    draftingApi.getRound(roundId).then(setRnd).catch(() => setError('Could not load this review.'))
  }, [roundId])
  useEffect(() => { load() }, [load])

  const changes = useMemo(() => changeList(rnd?.clauses ?? [], docTitle), [rnd, docTitle])
  const goTo = (id: number) => setCurrent(scrollToChange(sheet.current, id))
  const step = (dir: 1 | -1) => { if (changes.length) goTo(stepChange(changes, current, dir)) }

  const run = async (fn: () => Promise<ReviewRound>) => {
    setBusy(true); setError('')
    try {
      const r = await fn()
      setRnd(r)
      return r
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'That did not work. Please try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  // A change is decided again: show only its result (close its Change).
  const settled = (change: number | 'all') => setChanging(c => {
    if (change === 'all') return new Set()
    const next = new Set(c); next.delete(change); return next
  })
  const choose = async (change: number | 'all', decision: ChangeDecisionKind) => {
    if (rnd?.needs_reason.includes(decision)) { setAsking({ change, decision }); setReason(''); return }
    if (await run(() => draftingApi.decideChange(roundId, change, decision))) settled(change)
  }
  const confirmReason = async () => {
    if (!asking || !reason.trim()) return
    const r = await run(() => draftingApi.decideChange(roundId, asking.change, asking.decision, reason.trim()))
    if (r) { settled(asking.change); setAsking(null) }
  }
  // Finishing applies the decisions to the draft and closes the round for good: ask first,
  // saying what will happen.
  const finish = () => {
    if (!rnd) return
    const counts: Partial<Record<ChangeDecisionKind, number>> = {}
    let outdated = 0
    for (const c of rnd.clauses) {
      for (const p of [...c.heading, ...c.body]) {
        if (!p.change_id) continue
        if (p.outdated) outdated += 1
        else if (p.decision) counts[p.decision.decision] = (counts[p.decision.decision] || 0) + 1
      }
    }
    const parts = (Object.keys(counts) as ChangeDecisionKind[])
      .map(k => `${counts[k]} ${doneLabel(rnd, k).toLowerCase()}`)
    const effect = rnd.binding
      ? 'The corrections stay in the draft; your acknowledgements and queries are recorded.'
      : rnd.kind === 'suggestions'
        ? 'Accepted suggestions go into the draft; declined ones are left out, with your reasons.'
        : 'Kept changes stay; rejected ones are taken out of the draft (the old text comes back).'
    confirm({
      title: 'Finish this review?',
      message: <>
        <p style={{ margin: '0 0 8px' }}><strong>{parts.join(', ') || 'No decisions'}</strong>
          {outdated > 0 && <> · {outdated} outdated (left as they are)</>}.</p>
        <p style={{ margin: '0 0 8px' }}>{effect}</p>
        <p style={{ margin: 0 }} className="muted">This can't be undone: the review closes and a version is saved.
          The draft as it was before stays in Versions.</p>
      </>,
      confirmLabel: 'Finish review',
      accept: async () => { const r = await run(() => draftingApi.finishRound(roundId)); if (r) onDone(r) },
    })
  }
  const withdraw = async () => { const r = await run(() => draftingApi.cancelRound(roundId)); if (r) onDone(r) }

  if (!rnd) {
    return <div className="dr-compare">
      {error ? <div className="callout warn" role="alert"><Icon name="warn" size="sm" /><div>{error}</div></div>
        : <div className="dr-compare-empty"><Spinner label="Loading review" /></div>}
    </div>
  }

  const open = rnd.status === 'open'
  const decidable = rnd.can_decide
  const positive = rnd.allowed.find(d => d === 'accepted' || d === 'acknowledged')
  const negative = rnd.allowed.find(d => d === 'declined' || d === 'rejected')
  const total = changes.length
  const canFinish = decidable && (rnd.binding || rnd.pending === 0)

  const reasonBox = (change: number | 'all') => asking && asking.change === change && (
    <div className="rl-reason">
      <textarea className="input" rows={2} autoFocus value={reason} onChange={e => setReason(e.target.value)}
        aria-label={asking.decision === 'queried' ? 'Your query' : 'Reason for declining'}
        placeholder={asking.decision === 'queried' ? 'Your question about this correction' : 'Why you are declining this'} />
      <div className="row" style={{ gap: 6 }}>
        <Button size="sm" variant="primary" disabled={!reason.trim() || busy} loading={busy} onClick={confirmReason}>
          {actionLabel(rnd, asking.decision)}{change === 'all' ? ' all' : ''}</Button>
        <button type="button" className="btn ghost sm" onClick={() => setAsking(null)}>Cancel</button>
      </div>
    </div>
  )

  const decisionChip = (d: ChangeDecision | null | undefined) => d && (
    <span className={`xs rl-decision ${d.decision}`} title={d.reason || undefined}>
      {doneLabel(rnd, d.decision)}{d.reason ? `: ${d.reason}` : ''}
    </span>
  )

  const controls = (id: number, d: ChangeDecision | null | undefined, outdated?: boolean) => (
    <div className="rl-decide" role="group" aria-label={`Change ${id}`}>
      {outdated
        ? <span className="xs rl-decision outdated" title="The draft has changed here since; this change is left as it is now.">Outdated</span>
        : decisionChip(d)}
      {/* Decided: just the result and a Change link; the choices come back only on Change. */}
      {decidable && open && !outdated && d && !changing.has(id) && (
        <button type="button" className="btn ghost sm" disabled={busy}
          onClick={() => setChanging(c => new Set(c).add(id))}>Change</button>
      )}
      {decidable && open && !outdated && (!d || changing.has(id)) && rnd.allowed.map(a => (
        <button key={a} type="button" className={`btn sm ${d?.decision === a ? 'primary' : 'ghost'}`}
          aria-pressed={d?.decision === a} disabled={busy} onClick={() => choose(id, a)}>
          <Icon name={ACTION[a].icon} size="sm" />{actionLabel(rnd, a)}
        </button>
      ))}
      {reasonBox(id)}
    </div>
  )

  return (
    <div className="dr-compare">
      <div className="dr-compare-bar" role="toolbar" aria-label="Review">
        <strong className="small">{roundTitle(rnd)}</strong>
        <span className="small muted">
          {open ? `waiting for ${rnd.decider_name || 'the owner'}` : rnd.status === 'finished' ? 'finished' : 'withdrawn'}
          {' · '}{new Date(rnd.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
        <span className="small" aria-live="polite">
          <strong>{rnd.decided}</strong> of {total} decided
          <span className="muted"> · {rnd.inserted} word{rnd.inserted === 1 ? '' : 's'} added, {rnd.deleted} removed</span>
        </span>
        <div className="row" style={{ gap: 2 }}>
          <button type="button" className="btn ghost sm icon" aria-label="Previous change" title="Previous change"
            disabled={!total} onClick={() => step(-1)}><Icon name="chevronLeft" size="sm" /></button>
          <button type="button" className="btn ghost sm icon" aria-label="Next change" title="Next change"
            disabled={!total} onClick={() => step(1)}><Icon name="chevron" size="sm" /></button>
        </div>
        <span className="grow" />
        {decidable && open && positive && (
          <Button size="sm" disabled={busy} onClick={() => choose('all', positive)}>{actionLabel(rnd, positive)} all</Button>
        )}
        {decidable && open && negative && (
          <Button size="sm" disabled={busy} onClick={() => choose('all', negative)}>{actionLabel(rnd, negative)} all</Button>
        )}
        {decidable && open && (
          <Button size="sm" variant="primary" icon="check" disabled={!canFinish || busy} loading={busy}
            title={canFinish ? undefined : 'Decide on every change first'} onClick={finish}>Finish review</Button>
        )}
        {rnd.can_cancel && <Button size="sm" disabled={busy} onClick={withdraw}>Withdraw</Button>}
        <Button size="sm" icon="x" onClick={onClose}>Close</Button>
      </div>
      {rnd.note && <div className="callout" style={{ marginTop: -2 }}><Icon name="chat" size="sm" /><div>"{rnd.note}"</div></div>}
      {asking?.change === 'all' && reasonBox('all')}
      {error && <div className="callout warn" role="alert"><Icon name="warn" size="sm" /><div>{error}</div></div>}

      <div className="dr-compare-body">
        <aside className="dr-compare-list" aria-label="Changes to decide">
          {total === 0 ? <p className="small muted">No changes in this round.</p> : (
            <ol>
              {changes.map(c => (
                <li key={c.id}>
                  <button type="button" aria-current={c.id === current || undefined} onClick={() => goTo(c.id)}>
                    <span className="small">{c.label}</span>
                    <span className="row" style={{ gap: 4 }}>
                      <span className={`xs rl-tag ${c.kind}`}>{kindLabel(c.kind)}</span>
                      {c.para.outdated ? <span className="xs rl-decision outdated">Outdated</span> : decisionChip(c.para.decision)}
                    </span>
                    {c.snippet && <span className="xs faint ellipsis">{c.snippet}</span>}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </aside>
        <article ref={sheet} className="paper-sheet preview dr-compare-sheet all" aria-label="Changes in the draft">
          {docTitle && <h1 className="pp-doc-title">{docTitle}</h1>}
          {rnd.clauses.map(c => (
            <section key={`${c.status}-${c.block_id}`}>
              {[...c.heading.map(p => ({ p, h: true })), ...c.body.map(p => ({ p, h: false }))].map(({ p, h }, i) => (
                <ComparedPara key={i} p={p} heading={h} markup="all" current={current}>
                  {p.change_id ? controls(p.change_id, p.decision, p.outdated) : null}
                </ComparedPara>
              ))}
            </section>
          ))}
        </article>
      </div>
    </div>
  )
}
