import { useEffect, useRef, useState } from 'react'
import { InputTextarea } from 'primereact/inputtextarea'
import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { Menu } from 'primereact/menu'
import { diffWords } from 'diff'
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
  { key: 'formal', short: 'More formal', chip: 'Make the language more formal', prompt: 'Make the whole document more formal', icon: 'pi pi-briefcase' },
  { key: 'concise', short: 'More concise', chip: 'Make the document more concise', prompt: 'Make the whole document more concise', icon: 'pi pi-align-center' },
  { key: 'grammar', short: 'Fix grammar', chip: 'Fix grammar & spelling', prompt: 'Fix grammar and spelling across the document', icon: 'pi pi-check-circle' },
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
      <button type="button" className="pp-cf-head" onClick={() => setOpen(o => !o)}>
        <i className={`pi ${open ? 'pi-chevron-down' : 'pi-chevron-right'}`} />
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
  const refineMenu = useRef<Menu>(null)
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

  const chatInner = (
    <>
      <CreatedFrom facts={facts} />

      <div className="pp-chat-msgs">
        {messages.length === 0 && !sending && (
          <div className="pp-chat-intro">
            <div className="pp-chat-intro-icon"><i className="pi pi-sparkles" /></div>
            <div className="pp-chat-intro-title">Work on this draft with AI</div>
            <div className="pp-chat-intro-sub">Refine the whole document, or ask for a specific change.</div>
            <div className="pp-chat-chips">
              {REFINE_ACTIONS.map(a => (
                <button key={a.key} type="button" className="pp-chat-chip" onClick={() => runRefine(a.key)}>
                  {a.chip}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.role === 'user') return <div key={i} className="pp-chat-user">{msg.text}</div>
          if (msg.role === 'error') return <div key={i} className="pp-chat-error">{msg.text}</div>
          if (msg.role === 'refine') {
            if (msg.results.length === 0) {
              return (
                <div key={i} className="pp-chat-card">
                  <div className="pp-chat-card-lead">No changes needed for <strong>{msg.label.toLowerCase()}</strong> — the document already reads well.</div>
                </div>
              )
            }
            const pending = msg.results.filter(r => (msg.statuses[r.block_id] ?? 'pending') === 'pending').length
            const accepted = msg.results.filter(r => msg.statuses[r.block_id] === 'accepted').length
            const rejected = msg.results.filter(r => msg.statuses[r.block_id] === 'rejected').length
            return (
              <div key={i} className="pp-chat-card">
                <div className="pp-chat-card-lead">
                  Reworked <strong>{msg.results.length}</strong> clause{msg.results.length === 1 ? '' : 's'} — <strong>{msg.label.toLowerCase()}</strong>.
                  {' '}Review each, or apply all.
                </div>

                {/* Per-clause step-through */}
                {msg.results.map(r => {
                  const st = msg.statuses[r.block_id] ?? 'pending'
                  const rfd = focusedDiff(r.before_text, r.after_text)
                  return (
                    <div key={r.block_id} className="pp-refine-item">
                      <div className="pp-refine-item-head">
                        <span className="pp-refine-item-title">{r.heading || `Clause ${r.block_id}`}</span>
                        {st !== 'pending' && (
                          <span className={`pp-refine-item-badge ${st}`}>
                            <i className={`pi ${st === 'accepted' ? 'pi-check' : 'pi-times'}`} /> {st}
                          </span>
                        )}
                      </div>
                      {st === 'pending' && (
                        <>
                          <div className="pp-chat-diff">
                            <div className="pp-chat-diff-label del"><i className="pi pi-times" /> Removed</div>
                            <div className="pp-chat-removed">{rfd.removed}</div>
                            <div className="pp-chat-diff-label ins"><i className="pi pi-check" /> Added</div>
                            <div className="pp-chat-added">{rfd.added}</div>
                          </div>
                          {r.shrunk && (
                            <div className="pp-chat-warn">
                              <i className="pi pi-exclamation-triangle" /> Much shorter than the original — check nothing was dropped.
                            </div>
                          )}
                          <div className="flex gap-2 mt-1">
                            <Button label="Accept" icon="pi pi-check" size="small" onClick={() => acceptOne(i, r)} />
                            <Button label="Reject" icon="pi pi-times" size="small" outlined severity="secondary" onClick={() => rejectOne(i, r.block_id)} />
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}

                {pending > 0 ? (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <Button label={`Apply all (${pending})`} icon="pi pi-check" size="small" onClick={() => applyAllRefine(i, msg.results, msg.statuses)} />
                    <Button label="Reject all" icon="pi pi-times" size="small" outlined severity="secondary" onClick={() => rejectAllRefine(i)} />
                  </div>
                ) : (
                  <div className="pp-chat-status accepted">
                    <i className="pi pi-check-circle" /> {accepted} applied{rejected ? `, ${rejected} rejected` : ''} — review the highlighted changes and Save
                  </div>
                )}
              </div>
            )
          }
          const p = msg.proposal
          const fd = focusedDiff(p.before_text, p.after_text)
          return (
            <div key={i} className="pp-chat-card">
              <div className="pp-chat-card-lead">
                Located <strong>{p.heading || 'clause'}</strong>. {p.rationale}
              </div>
              <div className="pp-chat-diff">
                <div className="pp-chat-diff-label del"><i className="pi pi-times" /> Removed</div>
                <div className="pp-chat-removed">{fd.removed}</div>
                <div className="pp-chat-diff-label ins"><i className="pi pi-check" /> Added</div>
                <div className="pp-chat-added">{fd.added}</div>
              </div>
              {p.shrunk && (
                <div className="pp-chat-warn">
                  <i className="pi pi-exclamation-triangle" /> The revision is much shorter than the original — check nothing was dropped before accepting.
                </div>
              )}
              {msg.status === 'pending' ? (
                <div className="flex gap-2 mt-2 flex-wrap">
                  <Button label="Accept" icon="pi pi-check" size="small" onClick={() => accept(i, p)} />
                  <Button label="Reject" icon="pi pi-times" size="small" outlined severity="secondary" onClick={() => reject(i, p)} />
                  <Button label="Edit further" icon="pi pi-pencil" size="small" text onClick={() => editFurther(p)} />
                </div>
              ) : (
                <div className={`pp-chat-status ${msg.status}`}>
                  <i className={`pi ${msg.status === 'accepted' ? 'pi-check-circle' : 'pi-ban'}`} /> {msg.status}
                </div>
              )}
              <div className="pp-chat-foot">{(p.elapsed_ms / 1000).toFixed(1)}s</div>
            </div>
          )
        })}

        {sending && (
          <div className="pp-chat-card pp-chat-thinking">
            <i className="pi pi-spin pi-spinner mr-2" />{thinking}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="pp-chat-input">
        <Menu popup ref={refineMenu} model={REFINE_ACTIONS.map(a => ({ label: a.short, icon: a.icon, command: () => runRefine(a.key) }))} />
        <InputTextarea
          ref={inputRef}
          value={input} onChange={e => setInput(e.target.value)} rows={2} autoResize
          placeholder="Ask about this draft or request changes…"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          disabled={sending}
        />
        <div className="pp-chat-input-bar">
          <Button className="pp-chat-feature" label="Refine" icon="pi pi-sparkles" size="small"
            onClick={e => refineMenu.current?.toggle(e)} disabled={sending} aria-label="Refine document" />
          <span style={{ flex: 1 }} />
          <Button icon="pi pi-send" rounded onClick={send} disabled={sending || !input.trim()} aria-label="Send" />
        </div>
      </div>
    </>
  )

  if (expanded) {
    return (
      <Dialog
        header={<span className="pp-chat-dialog-title"><i className="pi pi-sparkles mr-2" />AI drafting assistant</span>}
        visible
        onHide={() => setExpanded(false)}
        maximizable
        dismissableMask
        style={{ width: '92vw', maxWidth: '1000px', height: '85vh' }}
        contentClassName="pp-chat-dialog-body"
      >
        <div className="pp-chat pp-chat--wide">{chatInner}</div>
      </Dialog>
    )
  }

  return (
    <div className="pp-chat">
      <div className="pp-chat-head">
        <span><i className="pi pi-sparkles mr-2" />AI drafting assistant</span>
        <Button icon="pi pi-window-maximize" text rounded severity="secondary" size="small"
          onClick={() => setExpanded(true)} tooltip="Expand" tooltipOptions={{ position: 'left' }}
          aria-label="Expand chat" />
      </div>
      {chatInner}
    </div>
  )
}
