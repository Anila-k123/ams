import { useState } from 'react'
import { Button } from 'primereact/button'
import { draftingApi, type ConsistencyFinding } from '../api/drafting'

interface Props {
  sessionId: number
  model: string
  /** The editor's live clauses (so the review reflects unsaved edits). */
  getClauses: () => { block_id: number; heading: string; text: string }[]
  /** Scroll to + highlight a clause in the document. */
  onJump: (blockId: number) => void
}

const SEVERITY: Record<string, { icon: string; label: string }> = {
  error: { icon: 'pi-times-circle', label: 'Issue' },
  warning: { icon: 'pi-exclamation-triangle', label: 'Check' },
  info: { icon: 'pi-info-circle', label: 'Note' },
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
      setError('Could not run the review — please try again.')
    } finally {
      setRunning(false)
    }
  }

  const errorCount = findings?.filter(f => f.severity === 'error').length ?? 0
  const warnCount = findings?.filter(f => f.severity === 'warning').length ?? 0

  return (
    <div className="pp-review" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      <div className="pp-review-head">
        <div>
          <div className="pp-review-title"><i className="pi pi-verified mr-2" />Consistency review</div>
          <div className="pp-review-sub">
            {findings === null
              ? 'Scan the whole draft for contradictions and loose ends.'
              : findings.length === 0
                ? 'No issues found.'
                : `${errorCount ? `${errorCount} issue${errorCount === 1 ? '' : 's'}` : ''}${errorCount && warnCount ? ' · ' : ''}${warnCount ? `${warnCount} to check` : ''}`}
          </div>
        </div>
        <Button label={findings === null ? 'Run check' : 'Re-check'} icon="pi pi-refresh"
          size="small" loading={running} onClick={run} />
      </div>

      {error && <div className="pp-review-error"><i className="pi pi-times-circle mr-2" />{error}</div>}

      <div className="pp-review-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {running && findings === null && (
          <div className="pp-review-empty"><i className="pi pi-spin pi-spinner mr-2" />Reviewing the draft…</div>
        )}

        {findings !== null && findings.length === 0 && !running && (
          <div className="pp-review-clear">
            <i className="pi pi-check-circle" />
            <div>No contradictions or loose ends found.</div>
            <small>Blanks, party names, cross-references and internal conflicts all check out.</small>
          </div>
        )}

        {findings === null && !running && (
          <div className="pp-review-empty">
            Run a check to flag unfilled fields, inconsistent party names,
            broken clause references, and contradictory terms.
          </div>
        )}

        {(findings ?? []).map(f => {
          const sev = SEVERITY[f.severity] ?? SEVERITY.info
          return (
            <div key={f.id} className={`pp-finding ${f.severity}`}>
              <div className="pp-finding-head">
                <i className={`pi ${sev.icon} pp-finding-icon`} />
                <span className="pp-finding-title">{f.title}</span>
                <span className="pp-finding-cat">{CATEGORY_LABEL[f.category] ?? f.category}</span>
              </div>
              {f.detail && <div className="pp-finding-detail">{f.detail}</div>}
              {f.quotes.length > 0 && (
                <div className="pp-finding-quotes">
                  {f.quotes.map((q, i) => (
                    <button key={i} type="button" className="pp-finding-quote"
                      disabled={q.block_id == null}
                      onClick={() => q.block_id != null && onJump(q.block_id)}
                      title={q.block_id != null ? 'Jump to this clause' : undefined}>
                      <span className="pp-finding-quote-text">“{q.text}”</span>
                      {q.block_id != null && <i className="pi pi-arrow-right" />}
                    </button>
                  ))}
                </div>
              )}
              {f.suggestion && <div className="pp-finding-suggestion"><i className="pi pi-lightbulb mr-1" />{f.suggestion}</div>}
              {f.block_ids.length > 0 && (
                <div className="pp-finding-actions">
                  <Button label="Go to clause" icon="pi pi-arrow-right" iconPos="right"
                    size="small" text onClick={() => onJump(f.block_ids[0])} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
