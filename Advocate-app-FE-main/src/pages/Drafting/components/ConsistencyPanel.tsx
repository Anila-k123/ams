import { useState } from 'react'
import { draftingApi, type ConsistencyFinding } from '../api/drafting'
import { Button } from '../../../ui/kit'
import Icon, { type IconName } from '../../../ui/Icon'
import DIcon from './DIcon'

interface Props {
  sessionId: number
  model: string
  /** The editor's live clauses (so the review reflects unsaved edits). */
  getClauses: () => { block_id: number; heading: string; text: string }[]
  /** Scroll to + highlight a clause in the document. */
  onJump: (blockId: number) => void
}

const SEVERITY: Record<string, { icon: IconName; label: string; tone: string }> = {
  error: { icon: 'warn', label: 'Issue', tone: 'bad' },
  warning: { icon: 'alert', label: 'Check', tone: 'warn' },
  info: { icon: 'info', label: 'Note', tone: 'info' },
}
const CATEGORY_LABEL: Record<string, string> = {
  unfilled_blank: 'Unfilled',
  party_variant: 'Naming',
  cross_reference: 'Reference',
  contradiction: 'Contradiction',
}

/** Right-pane "Review" tab: a one-click consistency check across the whole draft —
 *  unfilled blanks, inconsistent party names, dangling cross-refs (code) plus a
 *  grounded LLM pass for contradictions. Each finding jumps to its clause. */
export default function ConsistencyPanel({ sessionId, model, getClauses, onJump }: Props) {
  const [findings, setFindings] = useState<ConsistencyFinding[] | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    setRunning(true); setError('')
    try {
      const report = await draftingApi.checkConsistency(sessionId, { clauses: getClauses(), model })
      setFindings(report.findings)
    } catch {
      setError('Could not run the review. Please try again.')
    } finally {
      setRunning(false)
    }
  }

  const errorCount = findings?.filter(f => f.severity === 'error').length ?? 0
  const warnCount = findings?.filter(f => f.severity === 'warning').length ?? 0

  return (
    <div className="ed-sec">
      <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <h3 style={{ marginBottom: 2 }}>Consistency</h3>
          <div className="faint xs">
            {findings === null
              ? 'Scan the whole draft for contradictions and loose ends.'
              : findings.length === 0
                ? 'No issues found.'
                : `${errorCount ? `${errorCount} issue${errorCount === 1 ? '' : 's'}` : ''}${errorCount && warnCount ? ' · ' : ''}${warnCount ? `${warnCount} to check` : ''}`}
          </div>
        </div>
        <Button size="sm" icon="refresh" loading={running} onClick={run}>{findings === null ? 'Run check' : 'Re-check'}</Button>
      </div>

      {error && <div className="callout bad" role="alert" style={{ marginBottom: 10 }}><Icon name="warn" size="sm" /><div>{error}</div></div>}

      <div className="stack" style={{ gap: 10 }}>
        {running && findings === null && (
          <p className="faint small"><span className="pp-spin" aria-hidden="true" /> Reviewing the draft…</p>
        )}

        {findings !== null && findings.length === 0 && !running && (
          <div className="callout ok"><Icon name="ok" size="sm" /><div>
            <b>No contradictions or loose ends found.</b>
            <div className="faint xs">Blanks, party names, cross-references and internal conflicts all check out.</div>
          </div></div>
        )}

        {findings === null && !running && (
          <p className="faint small">
            Run a check to flag unfilled fields, inconsistent party names,
            broken clause references, and contradictory terms.
          </p>
        )}

        {(findings ?? []).map(f => {
          const sev = SEVERITY[f.severity] ?? SEVERITY.info
          return (
            <div key={f.id} className="panel tinted">
              <div className="panel-body" style={{ padding: '10px 12px' }}>
                <div className="row wrap" style={{ gap: 6 }}>
                  <span className={`chip ${sev.tone}`}><Icon name={sev.icon} size="sm" />{sev.label}</span>
                  <span className="chip">{CATEGORY_LABEL[f.category] ?? f.category}</span>
                </div>
                <p className="small" style={{ margin: '6px 0 0', fontWeight: 500 }}>{f.title}</p>
                {f.detail && <p className="small muted" style={{ margin: '4px 0 0' }}>{f.detail}</p>}
                {f.quotes.length > 0 && (
                  <div className="stack" style={{ gap: 4, marginTop: 8 }}>
                    {f.quotes.map((q, i) => (
                      <button key={i} type="button" className="dr-quote"
                        disabled={q.block_id == null}
                        onClick={() => q.block_id != null && onJump(q.block_id)}
                        title={q.block_id != null ? 'Jump to this clause' : undefined}>
                        <span className="ellipsis">“{q.text}”</span>
                        {q.block_id != null && <Icon name="chevron" size="sm" />}
                      </button>
                    ))}
                  </div>
                )}
                {f.suggestion && <p className="faint xs row" style={{ margin: '8px 0 0', gap: 4, alignItems: 'flex-start' }}><DIcon name="bulb" />{f.suggestion}</p>}
                {f.block_ids.length > 0 && (
                  <button type="button" className="link xs" style={{ background: 'none', border: 0, padding: 0, marginTop: 6 }}
                    onClick={() => onJump(f.block_ids[0])}>Go to clause</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
