import { useEffect, useRef, useState } from 'react'
import { ASSISTANT_NAME } from '../../../constants/assistant'
import { diffWords } from 'diff'
import { Modal } from '../../../ui/overlays'
import { Button, PopMenu } from '../../../ui/kit'
import Icon from '../../../ui/Icon'
import '../../../ui/lisa.css'
import { draftingApi, type EditProposal, type RefineResult } from '../api/drafting'

type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; proposal: EditProposal; status: 'pending' | 'accepted' | 'rejected' }
  | { role: 'refine'; label: string; results: RefineResult[]; model: string; statuses: Record<number, 'pending' | 'accepted' | 'rejected'> }
  | { role: 'error'; text: string }

interface Props {
  sessionId: number
  model: string
  docTitle: string
  clauseCount: number
  focusedId: number | null
  facts: Record<string, string>
  getClauses: () => { block_id: number; heading: string; text: string }[]
  onApply: (blockId: number, beforeText: string, afterText: string, heading?: string) => void
}

const CF_ORDER = ['document_title', 'parties', 'purpose', 'instructions']

/** Whole-document refine actions — presets that run through the refine endpoint. */
const REFINE_ACTIONS = [
  { key: 'formal', short: 'More formal', chip: 'Make the language more formal', prompt: 'Make the whole document more formal', icon: 'case' as const },
  { key: 'concise', short: 'More concise', chip: 'Make the document more concise', prompt: 'Make the whole document more concise', icon: 'minus' as const },
  { key: 'grammar', short: 'Fix grammar', chip: 'Fix grammar & spelling', prompt: 'Fix grammar and spelling across the document', icon: 'check' as const },
]

/** Collapsible "Created from" — the original brief/prompt/facts the draft was
 *  generated from, so the lawyer can re-read the intent while editing. */
function CreatedFrom({ facts }: { facts: Record<string, string> }) {
  const [open, setOpen] = useState(false)
  const entries = Object.entries(facts || {})
    .filter(([k, v]) => v && v.trim() && k !== 'draft_style')
    .sort(([a], [b]) => ((CF_ORDER.indexOf(a) + 1 || 99) - (CF_ORDER.indexOf(b) + 1 || 99)))
  if (!entries.length) return null
  const preview = entries[0][1].replace(/\s+/g, ' ').trim().slice(0, 80)
  return (
    <div className="pp-createdfrom">
      <button type="button" className="pp-cf-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name={open ? 'chevronDown' : 'chevron'} size="sm" />
        <span>Created from</span>
      </button>
      {open ? (
        <div className="pp-cf-body">
          {entries.map(([k, v]) => (
            <div key={k} className="pp-cf-field">
              <div className="pp-cf-value">{v}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="pp-cf-preview">{preview}…</div>
      )}
    </div>
  )
}

/** Reduce a full before/after to just the changed region with a little context —
 *  a Removed snippet (old wording) + an Added snippet (new wording), each with
 *  leading/trailing "…" when surrounding text was trimmed. */
function focusedDiff(before: string, after: string, ctx = 10) {
  const parts = diffWords(before, after)
  const changed = parts.map((p, i) => (p.added || p.removed ? i : -1)).filter(i => i >= 0)
  if (!changed.length) return { removed: before.trim(), added: after.trim() }
  const first = changed[0], last = changed[changed.length - 1]
  const wordsOf = (s: string) => s.split(/\s+/).filter(Boolean)
  const prev = wordsOf(first > 0 ? parts[first - 1].value : '')
  const next = wordsOf(last < parts.length - 1 ? parts[last + 1].value : '')
  const pre = prev.slice(-ctx).join(' ')
  const suf = next.slice(0, ctx).join(' ')
  const oldMid = parts.slice(first, last + 1).filter(p => !p.added).map(p => p.value).join('').trim()
  const newMid = parts.slice(first, last + 1).filter(p => !p.removed).map(p => p.value).join('').trim()
  const lead = prev.length > ctx || first > 1 ? '… ' : ''
  const trail = next.length > ctx || last < parts.length - 2 ? ' …' : ''
  const compose = (mid: string) => `${lead}${pre}${pre ? ' ' : ''}${mid}${suf ? ' ' : ''}${suf}${trail}`.trim()
  return { removed: compose(oldMid), added: compose(newMid) }
}

/** Right-pane AI drafting assistant: instruction → located-clause rewrite proposal
 *  (diff) → Accept / Reject / Edit further → patches the clause in the editor. */
export default function DraftChat({ sessionId, model, focusedId, facts, getClauses, onApply }: Props) {
  // Persist the transcript per draft so it survives refresh / close-reopen / tab change.
  const msgKey = `pp_chat_${sessionId}`
  const [messages, setMessages] = useState<Msg[]>(() => {
    try { return JSON.parse(localStorage.getItem(msgKey) || '[]') as Msg[] } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const followupBlock = useRef<number | null>(null)   // target hint after "Edit further"
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [refineAnchor, setRefineAnchor] = useState<HTMLElement | null>(null)
  const [thinking, setThinking] = useState('Processing…')  // spinner label
  const [expanded, setExpanded] = useState(false)  // full-width modal view

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, sending])
  // Save the transcript whenever it changes.
  useEffect(() => { try { localStorage.setItem(msgKey, JSON.stringify(messages)) } catch { /* quota */ } }, [msgKey, messages])

  // Whole-document refine: rewrite every clause with the chosen action, then show a
  // summary card. "Apply all" patches the changed clauses (green highlights) → Save.
  const runRefine = async (actionKey: string) => {
    if (sending) return
    const act = REFINE_ACTIONS.find(a => a.key === actionKey)
    if (!act) return
    setMessages(m => [...m, { role: 'user', text: act.prompt }])
    setSending(true); setThinking(`Refining the document — ${act.short.toLowerCase()}…`)
    try {
      const res = await draftingApi.refineDraft(sessionId, { action: actionKey, clauses: getClauses(), model })
      const statuses = Object.fromEntries(res.results.map(r => [r.block_id, 'pending' as const]))
      setMessages(m => [...m, { role: 'refine', label: act.short, results: res.results, model: res.model, statuses }])
    } catch (err) {
      const e = err as { response?: { status?: number; data?: { detail?: string } } }
      const text = e?.response?.status === 429
        ? (e.response.data?.detail || 'The service is busy — please try again shortly.')
        : 'Refine is unavailable right now. Please try again.'
      setMessages(m => [...m, { role: 'error', text }])
    } finally {
      setSending(false); setThinking('Processing…')
    }
  }
  // Per-clause + batch step-through for a refine card. Accepting patches that clause
  // into the editor (green highlight); rejecting just marks it. Side effects run
  // OUTSIDE setState so a strict-mode double-render can't apply an edit twice.
  const setItemStatus = (i: number, blockId: number, status: 'accepted' | 'rejected') =>
    setMessages(m => m.map((msg, idx) =>
      (idx === i && msg.role === 'refine' ? { ...msg, statuses: { ...msg.statuses, [blockId]: status } } : msg)))
  const acceptOne = (i: number, r: RefineResult) => {
    onApply(r.block_id, r.before_text, r.after_text, r.heading)
    setItemStatus(i, r.block_id, 'accepted')
  }
  const rejectOne = (i: number, blockId: number) => setItemStatus(i, blockId, 'rejected')
  const applyAllRefine = (i: number, results: RefineResult[], statuses: Record<number, string>) => {
    results.forEach(r => { if ((statuses[r.block_id] ?? 'pending') === 'pending') onApply(r.block_id, r.before_text, r.after_text, r.heading) })
    setMessages(m => m.map((msg, idx) => {
      if (idx !== i || msg.role !== 'refine') return msg
      const ns = { ...msg.statuses }
      results.forEach(r => { if ((ns[r.block_id] ?? 'pending') === 'pending') ns[r.block_id] = 'accepted' })
      return { ...msg, statuses: ns }
    }))
  }
  const rejectAllRefine = (i: number) =>
    setMessages(m => m.map((msg, idx) => {
      if (idx !== i || msg.role !== 'refine') return msg
      const ns = { ...msg.statuses }
      msg.results.forEach(r => { if ((ns[r.block_id] ?? 'pending') === 'pending') ns[r.block_id] = 'rejected' })
      return { ...msg, statuses: ns }
    }))

  const send = async () => {
    const instruction = input.trim()
    if (!instruction || sending) return
    setMessages(m => [...m, { role: 'user', text: instruction }])
    setInput(''); setSending(true)
    const focused = followupBlock.current ?? focusedId
    followupBlock.current = null
    try {
      const proposal = await draftingApi.proposeEdit(sessionId, { instruction, focused_block_id: focused, model })
      setMessages(m => [...m, { role: 'assistant', proposal, status: 'pending' }])
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      setMessages(m => [...m, {
        role: 'error',
        text: status === 404 ? "Couldn't match a clause to that instruction — try naming the clause."
          : 'The assistant is unavailable right now. Please try again.',
      }])
    } finally {
      setSending(false)
    }
  }

  const setStatus = (i: number, status: 'accepted' | 'rejected') =>
    setMessages(m => m.map((msg, idx) => (idx === i && msg.role === 'assistant' ? { ...msg, status } : msg)))

  const accept = async (i: number, p: EditProposal) => {
    onApply(p.block_id, p.before_text, p.after_text, p.new_heading)
    setStatus(i, 'accepted')
    try { await draftingApi.acceptEdit(sessionId, p.edit_id) } catch { /* editor already patched */ }
  }
  const reject = async (i: number, p: EditProposal) => {
    setStatus(i, 'rejected')
    try { await draftingApi.rejectEdit(sessionId, p.edit_id) } catch { /* no-op */ }
  }
  const editFurther = (p: EditProposal) => {
    followupBlock.current = p.block_id
    inputRef.current?.focus()
  }


  // Assistant turns carry Lisa's seal; user turns are right-aligned ink bubbles,
  // the same visual language as the global Lisa panel (ui/lisa.css).
  const ai = (key: number | string, body: React.ReactNode) => (
    <div key={key} className="lisa-msg ai">
      <span className="lisa-seal sm" aria-hidden="true">L</span>
      <div className="lisa-bubble dr-card">{body}</div>
    </div>
  )
  const diffBox = (removed: string, added: string) => (
    <div className="dr-diff">
      <div className="dr-diff-label del"><Icon name="minus" size="sm" /> Removed</div>
      <div className="dr-diff-text del">{removed}</div>
      <div className="dr-diff-label ins"><Icon name="plus" size="sm" /> Added</div>
      <div className="dr-diff-text ins">{added}</div>
    </div>
  )

  const chatInner = (
    <>
      <CreatedFrom facts={facts} />

      <div className="pp-chat-msgs" aria-live="polite">
        {messages.length === 0 && !sending && (
          <div className="pp-chat-intro">
            <span className="lisa-seal lg" aria-hidden="true">L</span>
            <div className="pp-chat-intro-title">Work on this draft with {ASSISTANT_NAME}</div>
            <div className="pp-chat-intro-sub">Refine the whole document, or ask for a specific change.</div>
            <div className="stack" style={{ gap: 6 }}>
              {REFINE_ACTIONS.map(a => (
                <button key={a.key} type="button" className="dr-chip" onClick={() => runRefine(a.key)}>
                  {a.chip}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.role === 'user') return <div key={i} className="lisa-msg me"><div className="lisa-bubble">{msg.text}</div></div>
          if (msg.role === 'error') return <div key={i} className="callout bad" role="alert"><Icon name="warn" size="sm" /><div>{msg.text}</div></div>
          if (msg.role === 'refine') {
            if (msg.results.length === 0) {
              return ai(i, <>No changes needed for <strong>{msg.label.toLowerCase()}</strong>. The document already reads well.</>)
            }
            const pending = msg.results.filter(r => (msg.statuses[r.block_id] ?? 'pending') === 'pending').length
            const accepted = msg.results.filter(r => msg.statuses[r.block_id] === 'accepted').length
            const rejected = msg.results.filter(r => msg.statuses[r.block_id] === 'rejected').length
            return ai(i, <>
              <div>
                Reworked <strong>{msg.results.length}</strong> clause{msg.results.length === 1 ? '' : 's'}: <strong>{msg.label.toLowerCase()}</strong>.
                {' '}Review each, or apply all.
              </div>

              {/* Per-clause step-through */}
              {msg.results.map(r => {
                const st = msg.statuses[r.block_id] ?? 'pending'
                const rfd = focusedDiff(r.before_text, r.after_text)
                return (
                  <div key={r.block_id} className="dr-refine-item">
                    <div className="row between">
                      <span className="small" style={{ fontWeight: 600 }}>{r.heading || `Clause ${r.block_id}`}</span>
                      {st !== 'pending' && <span className={`chip ${st === 'accepted' ? 'ok' : ''}`}>{st === 'accepted' ? 'Accepted' : 'Rejected'}</span>}
                    </div>
                    {st === 'pending' && (
                      <>
                        {diffBox(rfd.removed, rfd.added)}
                        {r.shrunk && (
                          <div className="callout warn" style={{ marginTop: 6 }}><Icon name="warn" size="sm" /><div>Much shorter than the original. Check nothing was dropped.</div></div>
                        )}
                        <div className="row" style={{ marginTop: 8, gap: 6 }}>
                          <Button variant="primary" size="sm" icon="check" onClick={() => acceptOne(i, r)}>Accept</Button>
                          <Button variant="ghost" size="sm" onClick={() => rejectOne(i, r.block_id)}>Reject</Button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}

              {pending > 0 ? (
                <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
                  <Button variant="primary" size="sm" icon="check" onClick={() => applyAllRefine(i, msg.results, msg.statuses)}>Apply all ({pending})</Button>
                  <Button variant="ghost" size="sm" onClick={() => rejectAllRefine(i)}>Reject all</Button>
                </div>
              ) : (
                <div className="row small" style={{ marginTop: 10, gap: 6, color: 'var(--ok)' }}>
                  <Icon name="ok" size="sm" /> {accepted} applied{rejected ? `, ${rejected} rejected` : ''}. Review the highlighted changes and save.
                </div>
              )}
            </>)
          }
          const p = msg.proposal
          const fd = focusedDiff(p.before_text, p.after_text)
          return ai(i, <>
            <div>Located <strong>{p.heading || 'clause'}</strong>. {p.rationale}</div>
            {diffBox(fd.removed, fd.added)}
            {p.shrunk && (
              <div className="callout warn" style={{ marginTop: 6 }}><Icon name="warn" size="sm" /><div>The revision is much shorter than the original. Check nothing was dropped before accepting.</div></div>
            )}
            {msg.status === 'pending' ? (
              <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
                <Button variant="primary" size="sm" icon="check" onClick={() => accept(i, p)}>Accept</Button>
                <Button variant="ghost" size="sm" onClick={() => reject(i, p)}>Reject</Button>
                <Button variant="ghost" size="sm" icon="edit" onClick={() => editFurther(p)}>Edit further</Button>
              </div>
            ) : (
              <div style={{ marginTop: 8 }}><span className={`chip ${msg.status === 'accepted' ? 'ok' : ''}`}>{msg.status === 'accepted' ? 'Accepted' : 'Rejected'}</span></div>
            )}
            <div className="faint xs mono" style={{ textAlign: 'right', marginTop: 6 }}>{(p.elapsed_ms / 1000).toFixed(1)}s</div>
          </>)
        })}

        {sending && ai('thinking', <span className="row faint" style={{ gap: 8 }}><span className="lisa-thinking" aria-hidden="true"><i /><i /><i /></span>{thinking}</span>)}
        <div ref={endRef} />
      </div>

      <div className="pp-chat-input">
        <div className="lisa-quick">
          <button type="button" className="pp-pill" aria-haspopup="menu" disabled={sending}
            onClick={e => setRefineAnchor(refineAnchor ? null : e.currentTarget)}>
            <Icon name="sparkle" size="sm" /> Refine
          </button>
        </div>
        {refineAnchor && (
          <PopMenu anchor={refineAnchor} onClose={() => setRefineAnchor(null)} width={200}
            items={REFINE_ACTIONS.map(a => ({ label: a.short, icon: a.icon, onClick: () => runRefine(a.key) }))} />
        )}
        <form className="lisa-form" onSubmit={e => { e.preventDefault(); send() }}>
          <label className="sr-only" htmlFor={`dchat-in-${sessionId}`}>Message {ASSISTANT_NAME}</label>
          <textarea
            id={`dchat-in-${sessionId}`}
            ref={inputRef}
            className="input grow dr-chat-ta"
            value={input} onChange={e => setInput(e.target.value)} rows={2}
            placeholder={`Ask ${ASSISTANT_NAME} to change the draft`}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            disabled={sending}
          />
          <button type="submit" className="btn primary icon" disabled={sending || !input.trim()} aria-label="Send"><Icon name="send" size="sm" /></button>
        </form>
      </div>
    </>
  )

  if (expanded) {
    return (
      <Modal
        title={<span className="row" style={{ gap: 10 }}><span className="lisa-seal sm" aria-hidden="true">L</span>{ASSISTANT_NAME} · drafting assistant</span>}
        open
        onClose={() => setExpanded(false)}
        size="xwide"
      >
        <div className="pp-dchat pp-dchat--wide">{chatInner}</div>
      </Modal>
    )
  }

  return (
    <div className="pp-dchat">
      <div className="pp-chat-head">
        <span className="row" style={{ gap: 10 }}><span className="lisa-seal sm" aria-hidden="true">L</span>
          <span><b>{ASSISTANT_NAME}</b><span className="faint xs" style={{ display: 'block', fontWeight: 400 }}>Drafting assistant</span></span></span>
        <button type="button" className="btn ghost sm icon" title="Expand" aria-label="Expand chat"
          onClick={() => setExpanded(true)}><Icon name="external" size="sm" /></button>
      </div>
      {chatInner}
    </div>
  )
}
