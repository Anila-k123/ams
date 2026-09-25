import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import type { Citation } from '../editor/clause'
import { useRiskMap, type RiskInfo } from '../context/RiskContext'

const RISK_COLOR: Record<string, string> = {
  critical: '#ef4444',
  major:    '#f97316',
  minor:    '#eab308',
  info:     '#3b82f6',
}
const RISK_LABEL: Record<string, string> = {
  critical: 'Critical', major: 'Major', minor: 'Minor', info: 'Note',
}

/** Renders one clause: an editable heading + editable body, and — when the clause
 *  is traceable to a source — a footnote-style citation marker [N] that reveals the
 *  source document + snippet on hover and opens that document on click. A playbook
 *  risk on the clause shows as a severity-coloured shield in the left gutter (with a
 *  count) that opens a popover listing the findings — NOT a full-block border, since
 *  most findings are about omissions rather than the visible text. */
// Turn a captured heading-style dict into inline CSS for the heading input.
function headingCss(s: Record<string, unknown> | null): React.CSSProperties {
  if (!s) return {}
  const css: React.CSSProperties = {}
  if (s.align) css.textAlign = s.align as React.CSSProperties['textAlign']
  if (s.font) css.fontFamily = `'${s.font}'`
  if (s.size) css.fontSize = `${s.size}pt`
  if (s.color) css.color = s.color as string
  if (s.bold) css.fontWeight = 'bold'
  if (s.italic) css.fontStyle = 'italic'
  if (s.underline) css.textDecoration = 'underline'
  if (s.caps) css.textTransform = 'uppercase'
  return css
}

export default function ClauseNodeView({ node, updateAttributes, extension }: NodeViewProps) {
  const heading = (node.attrs.heading as string) || ''
  const blockId = Number(node.attrs.blockId)
  const headingStyle = headingCss(node.attrs.headingStyle as Record<string, unknown> | null)
  const cite: Citation | undefined = extension.options.getCitation?.(blockId)
  const markerRef = useRef<HTMLElement>(null)
  const [pop, setPop] = useState<{ x: number; y: number; above: boolean } | null>(null)
  const riskMap = useRiskMap()
  const risk: RiskInfo | undefined = riskMap[blockId]
  const riskRef = useRef<HTMLButtonElement>(null)
  const [riskPop, setRiskPop] = useState<{ x: number; y: number; above: boolean } | null>(null)

  const show = () => {
    const r = markerRef.current?.getBoundingClientRect()
    if (!r) return
    const EST = 240  // approx popover height; open above unless there isn't room
    const above = r.top >= EST
    const x = Math.max(8, Math.min(r.left, window.innerWidth - 312))
    setPop({ x, y: above ? r.top : r.bottom + 8, above })
  }
  const hide = () => setPop(null)

  const showRisk = () => {
    const r = riskRef.current?.getBoundingClientRect()
    if (!r) return
    const EST = 220
    const above = r.top >= EST
    const x = Math.max(8, Math.min(r.right + 6, window.innerWidth - 352))
    setRiskPop({ x, y: above ? r.top : r.bottom + 8, above })
  }
  const hideRisk = () => setRiskPop(null)

  return (
    <NodeViewWrapper className="pp-editor-clause" data-block-id={blockId} style={{ position: 'relative' }}>
      {risk && (
        <button
          ref={riskRef}
          type="button"
          className="pp-risk-shield"
          contentEditable={false}
          style={{ color: RISK_COLOR[risk.worst] }}
          onMouseEnter={showRisk}
          onMouseLeave={hideRisk}
          onClick={showRisk}
          aria-label={`${risk.count} playbook ${risk.count === 1 ? 'finding' : 'findings'} on this clause`}
        >
          <i className="pi pi-shield" />
          {risk.count > 1 && <span className="pp-risk-count">{risk.count}</span>}
        </button>
      )}

      {/* Only render the heading row when the clause actually has a heading — clauses
          with no title (the drafted text carries its own heading) show no empty input. */}
      {heading && (
        <div className="pp-editor-clause-head" contentEditable={false}>
          <input
            className="pp-editor-clause-title"
            style={headingStyle}
            value={heading}
            onChange={e => updateAttributes({ heading: e.target.value })}
          />
        </div>
      )}
      <NodeViewContent className="pp-editor-clause-body pp-doc-text" />

      {cite && (
        <sup
          ref={markerRef}
          className="pp-cite"
          contentEditable={false}
          onMouseEnter={show}
          onMouseLeave={hide}
          onClick={() => cite.url && extension.options.onCite?.(cite.url, cite.doc ?? undefined)}
        >
          [{cite.n}]
        </sup>
      )}

      {cite && pop && createPortal(
        <div className="pp-cite-pop" style={{ left: pop.x, top: pop.y, transform: pop.above ? 'translateY(calc(-100% - 8px))' : 'none' }} onMouseEnter={show} onMouseLeave={hide}>
          <div className="pp-cite-pop-head"><i className="pi pi-file" /> {cite.doc || 'Source document'}</div>
          {cite.page != null && <span className="pp-cite-pop-tag">Clause {cite.page}</span>}
          <div className="pp-cite-pop-text">{cite.text}</div>
          {cite.url && <div className="pp-cite-pop-hint">Click [{cite.n}] to open the document</div>}
        </div>,
        document.body,
      )}

      {risk && riskPop && createPortal(
        <div className="pp-risk-pop" style={{ left: riskPop.x, top: riskPop.y, transform: riskPop.above ? 'translateY(calc(-100% - 8px))' : 'none' }}
          onMouseEnter={showRisk} onMouseLeave={hideRisk}>
          <div className="pp-risk-pop-head">
            <i className="pi pi-shield" /> Playbook {risk.count === 1 ? 'finding' : `findings · ${risk.count}`}
          </div>
          {risk.findings.map(f => (
            <div key={f.id} className="pp-risk-pop-item">
              <span className="pp-risk-pop-sev" style={{ background: RISK_COLOR[f.severity] }}>{RISK_LABEL[f.severity]}</span>
              {f.issue && <div className="pp-risk-pop-issue">{f.issue}</div>}
              {f.suggestion && <div className="pp-risk-pop-fix"><i className="pi pi-lightbulb mr-1" />{f.suggestion}</div>}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </NodeViewWrapper>
  )
}
