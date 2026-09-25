import { useEffect, useState } from 'react'
import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { Tag } from 'primereact/tag'
import { draftingApi, playbookApi, type PlaybookListItem, type PlaybookRisk, type RiskReport, type RiskSeverity, type RiskStatus } from '../api/drafting'
import type { RiskMap } from '../context/RiskContext'

interface Props {
  sessionId: number
  initialPlaybookId: number | null
  initialRiskStatus: string
  initialReport: RiskReport | null
  onJump: (blockId: number) => void
  onRisksLoaded: (map: RiskMap) => void
}

const REC_CONFIG: Record<string, { label: string; severity: 'danger' | 'warning' | 'success' }> = {
  decline:   { label: 'Decline',   severity: 'danger'  },
  negotiate: { label: 'Negotiate', severity: 'warning' },
  proceed:   { label: 'Proceed',   severity: 'success' },
}

const SEV_CONFIG = {
  critical: { icon: 'pi-times-circle',        label: 'Critical', severity: 'danger'    as const },
  major:    { icon: 'pi-exclamation-triangle', label: 'Major',    severity: 'warning'   as const },
  minor:    { icon: 'pi-info-circle',          label: 'Minor',    severity: 'info'      as const },
  info:     { icon: 'pi-comment',              label: 'Note',     severity: 'secondary' as const },
}

const SEV_ORDER = ['critical', 'major', 'minor', 'info'] as const

/** Group findings by clause so each clause heading is shown once, with its
 * findings listed beneath it (worst severity first). Groups are ordered by
 * their worst finding's severity. */
function groupByClause<T extends { clause_type: string | null; severity: RiskSeverity }>(items: T[]) {
  const map = new Map<string, T[]>()
  for (const it of items) {
    const key = (it.clause_type || '').replace(/_/g, ' ').trim() || 'Other'
    const arr = map.get(key) ?? []
    arr.push(it)
    map.set(key, arr)
  }
  return [...map.entries()]
    .map(([clause, list]) => {
      const sorted = [...list].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
      return { clause, items: sorted, worst: sorted[0].severity }
    })
    .sort((a, b) =>
      SEV_ORDER.indexOf(a.worst) - SEV_ORDER.indexOf(b.worst) || a.clause.localeCompare(b.clause))
}

function buildRiskMap(risks: PlaybookRisk[]): RiskMap {
  const map: RiskMap = {}
  for (const r of risks) {
    if (r.block == null || r.status !== 'open') continue
    const entry = map[r.block] ?? { worst: r.severity, count: 0, findings: [] }
    entry.findings.push({
      id: r.id, severity: r.severity, issue: r.issue, suggestion: r.suggestion, quote: r.quote,
    })
    entry.count = entry.findings.length
    if (SEV_ORDER.indexOf(r.severity) < SEV_ORDER.indexOf(entry.worst)) entry.worst = r.severity
    map[r.block] = entry
  }
  return map
}

export default function PlaybookRiskPanel({ sessionId, initialPlaybookId, initialRiskStatus, initialReport, onJump, onRisksLoaded }: Props) {
  const [playbooks, setPlaybooks]             = useState<PlaybookListItem[]>([])
  const [selectedId, setSelectedId]           = useState<number | null>(initialPlaybookId)
  const [risks, setRisks]                     = useState<PlaybookRisk[] | null>(null)
  const [report, setReport]                   = useState<RiskReport | null>(initialReport)
  const [running, setRunning]                 = useState(false)
  const [expanded, setExpanded]               = useState(false)
  const [error, setError]                     = useState('')

  useEffect(() => {
    playbookApi.list().then(list => setPlaybooks(list.filter(p => p.status === 'ready')))
  }, [])

  useEffect(() => {
    if (initialRiskStatus === 'ready') {
      playbookApi.listSessionRisks(sessionId).then(r => { setRisks(r); onRisksLoaded(buildRiskMap(r)) })
    }
  }, [sessionId, initialRiskStatus])

  const run = async () => {
    if (!selectedId) return
    setRunning(true); setError('')
    try {
      await playbookApi.analyseRisks(sessionId, selectedId)
      onRisksLoaded({})  // clear highlights while analyzing
      await pollUntilReady()
      const [result, freshReport] = await Promise.all([
        playbookApi.listSessionRisks(sessionId),
        playbookApi.getRiskReport(sessionId),
      ])
      setRisks(result)
      setReport(freshReport)
      onRisksLoaded(buildRiskMap(result))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Risk analysis failed — please try again.')
    } finally {
      setRunning(false)
    }
  }

  const pollUntilReady = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const check = async () => {
        try {
          const { risk_status } = await draftingApi.getSessionStatus(sessionId)
          if (risk_status === 'ready') return resolve()
          if (risk_status === 'failed') return reject(new Error('Risk analysis failed on the server.'))
          setTimeout(check, 1500)
        } catch {
          reject(new Error('Could not reach the server — please try again.'))
        }
      }
      check()
    })

  const updateStatus = async (riskId: number, newStatus: RiskStatus) => {
    await playbookApi.updateRiskStatus(sessionId, riskId, newStatus)
    setRisks(prev => {
      const updated = prev?.map(r => r.id === riskId ? { ...r, status: newStatus } : r) ?? null
      if (updated) onRisksLoaded(buildRiskMap(updated))
      return updated
    })
  }

  const openRisks = risks?.filter(r => r.status === 'open') ?? []
  const subtitle = risks === null
    ? 'Compare this draft against your firm\'s playbook.'
    : openRisks.length === 0
      ? 'No open risks.'
      : (['critical', 'major', 'minor'] as const)
          .map(s => ({ s, n: openRisks.filter(r => r.severity === s).length }))
          .filter(({ n }) => n > 0)
          .map(({ s, n }) => `${n} ${s}`)
          .join(' · ')

  return (
    <>
    <div className="pp-review" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      <div className="pp-review-head">
        <div>
          <div className="pp-review-title"><i className="pi pi-shield mr-2" />Playbook review</div>
          <div className="pp-review-sub">{subtitle}</div>
        </div>
        <Button
          label={risks === null ? 'Run' : 'Re-run'}
          icon="pi pi-refresh"
          size="small"
          loading={running}
          disabled={!selectedId}
          onClick={run}
        />
      </div>

      {/* Playbook selector — always visible so the user can switch playbooks */}
      <div style={{ padding: '0 1rem 0.75rem' }}>
        <select
          value={selectedId ?? ''}
          onChange={e => setSelectedId(e.target.value ? Number(e.target.value) : null)}
          style={{
            width: '100%', padding: '0.4rem 0.6rem', borderRadius: '6px',
            border: '1px solid var(--pp-slate-300)', fontSize: '0.85rem',
            background: 'var(--surface-0)', color: 'var(--text-color)',
          }}
        >
          <option value="">Select playbook…</option>
          {playbooks.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {error && <div className="pp-review-error"><i className="pi pi-times-circle mr-2" />{error}</div>}

      <div className="pp-review-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0, maxHeight: '100%' }}>
        {running && (
          <div className="pp-review-empty">
            <i className="pi pi-spin pi-spinner mr-2" />Analysing risks…
          </div>
        )}

        {!running && report && (
          <RiskReportSummary
            report={report}
            risks={risks ?? []}
            variant="compact"
            onJump={onJump}
            onStatus={updateStatus}
            onExpand={() => setExpanded(true)}
          />
        )}

        {!running && !report && risks === null && (
          <div className="pp-review-empty">
            {selectedId ? 'Run to compare this draft against the playbook.' : 'Select a playbook first, then run.'}
          </div>
        )}

        {!running && !report && risks !== null && (
          <div className="pp-review-empty">Re-run to generate the structured review.</div>
        )}
      </div>
    </div>

    <Dialog
      header="Playbook review"
      visible={expanded}
      onHide={() => setExpanded(false)}
      style={{ width: '92vw', maxWidth: '1100px' }}
      contentClassName="pp-report-dialog-body"
      maximizable
      dismissableMask
    >
      {report && (
        <RiskReportSummary
          report={report}
          risks={risks ?? []}
          variant="wide"
          onJump={b => { setExpanded(false); onJump(b) }}
          onStatus={updateStatus}
        />
      )}
    </Dialog>
    </>
  )
}

function RiskReportSummary({ report, risks, variant, onJump, onStatus, onExpand }: {
  report: RiskReport
  risks: PlaybookRisk[]
  variant: 'compact' | 'wide'
  onJump: (blockId: number) => void
  onStatus: (riskId: number, status: RiskStatus) => void
  onExpand?: () => void
}) {
  const rec = REC_CONFIG[report.recommendation] ?? REC_CONFIG.negotiate
  const groups = groupByClause(risks)
  const wide = variant === 'wide'
  const cols = wide ? 4 : 3

  const renderActions = (risk: PlaybookRisk) =>
    risk.status !== 'open' ? (
      <span className="pp-report-act-status">{risk.status}</span>
    ) : (
      <div className="pp-report-actions">
        {risk.block != null && (
          <button type="button" title="Go to clause"
            className="pp-report-act" onClick={() => onJump(risk.block!)}>
            <i className="pi pi-arrow-right" />
          </button>
        )}
        <button type="button" title="Accept"
          className="pp-report-act pp-report-act--ok" onClick={() => onStatus(risk.id, 'accepted')}>
          <i className="pi pi-check" />
        </button>
        <button type="button" title="Dismiss"
          className="pp-report-act pp-report-act--x" onClick={() => onStatus(risk.id, 'dismissed')}>
          <i className="pi pi-times" />
        </button>
      </div>
    )

  return (
    <div className={`pp-report ${wide ? 'pp-report--wide' : ''}`}>
      <div className="pp-report-head">
        <span className="pp-report-title">{report.title}</span>
        <div className="pp-report-head-right">
          <Tag value={rec.label} severity={rec.severity} />
          {onExpand && (
            <button type="button" className="pp-report-expand" title="Open full-width view" onClick={onExpand}>
              <i className="pi pi-window-maximize mr-1" />Expand
            </button>
          )}
        </div>
      </div>

      <section className="pp-report-sec">
        <div className="pp-report-sec-title">
          <i className="pi pi-list mr-2" />Risk register
        </div>
        {groups.length === 0 ? (
          <div className="pp-review-clear">
            <i className="pi pi-check-circle" />
            <div>No risks found.</div>
            <small>All clauses align with the playbook positions.</small>
          </div>
        ) : (
          <div className="pp-report-table-wrap">
            <table className="pp-report-table">
              <thead>
                {wide
                  ? <tr><th>Sev.</th><th>Issue</th><th>Suggestion</th><th aria-label="actions" /></tr>
                  : <tr><th>Sev.</th><th>Finding</th><th aria-label="actions" /></tr>}
              </thead>
              {groups.map(group => (
                <tbody key={group.clause} className="pp-report-grp">
                  <tr className="pp-report-grp-head">
                    <td colSpan={cols}>
                      <span className="pp-report-grp-name">{group.clause}</span>
                      <span className="pp-report-grp-count">{group.items.length}</span>
                    </td>
                  </tr>
                  {group.items.map(risk => {
                    const cfg = SEV_CONFIG[risk.severity] ?? SEV_CONFIG.info
                    const dismissed = risk.status !== 'open'
                    return (
                      <tr key={risk.id} className={dismissed ? 'pp-report-row--dim' : ''}>
                        <td>
                          <Tag value={cfg.label} severity={cfg.severity} style={{ fontSize: '0.6rem' }} />
                        </td>
                        {wide ? (
                          <>
                            <td>{risk.issue}</td>
                            <td className="pp-report-fix">{risk.suggestion || '—'}</td>
                          </>
                        ) : (
                          <td>
                            <div className="pp-report-finding-issue">{risk.issue}</div>
                            {risk.suggestion && (
                              <div className="pp-report-finding-fix">
                                <i className="pi pi-lightbulb mr-1" />{risk.suggestion}
                              </div>
                            )}
                          </td>
                        )}
                        <td>{renderActions(risk)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </section>

      {report.deal_breakers.length > 0 && (
        <section className="pp-report-sec">
          <div className="pp-report-sec-title">
            <i className="pi pi-flag-fill mr-2" />Deal-breakers
          </div>
          <ul className="pp-report-list pp-report-list--danger">
            {report.deal_breakers.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </section>
      )}

      {report.open_questions.length > 0 && (
        <section className="pp-report-sec">
          <div className="pp-report-sec-title">
            <i className="pi pi-question-circle mr-2" />Open questions for the client
          </div>
          <ul className="pp-report-list">
            {report.open_questions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </section>
      )}
    </div>
  )
}
