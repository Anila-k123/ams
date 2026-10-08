import type { CompareClause, CompareParagraph, CompareSeg } from '../api/drafting'

// Shared by the compare view (CompareView.tsx) and the review view (ReviewRoundView.tsx): both
// show the same comparison data (drafting/export/compare.py), so they render it the same way.

export type Markup = 'all' | 'final'

// A section heading line inside a clause: "8. TERMINATION", "SCHEDULE OF PROPERTY", "ARTICLE II".
const SECTION_RE = /^(?:(?:\d+|[IVXLC]+)[.)]\s+)?[A-Z][A-Z0-9 &,'()/-]{2,60}$/

export interface ChangeEntry {
  id: number
  label: string
  kind: CompareParagraph['kind']
  snippet: string
  para: CompareParagraph
}

/** The changed paragraphs in order, for the change list and next / previous. Each is named
 *  after the nearest section heading above it ("8. TERMINATION"): a draft often holds many
 *  sections in one clause, whose own label is just the document title. */
export function changeList(clauses: CompareClause[], docTitle: string): ChangeEntry[] {
  const out: ChangeEntry[] = []
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  for (const c of clauses) {
    let section = c.label && !same(c.label, docTitle) ? c.label : ''
    for (const p of [...c.heading, ...c.body]) {
      const text = p.segs.filter(s => s.op !== 'del').map(s => s.text).join('').trim()
      if (SECTION_RE.test(text)) section = text
      if (!p.change_id) continue
      const changed = p.segs.filter(s => s.op !== 'same').map(s => s.text).join(' ').replace(/\s+/g, ' ').trim()
      out.push({ id: p.change_id, label: section || c.label || 'Untitled clause', kind: p.kind,
        snippet: changed.slice(0, 80), para: p })
    }
  }
  return out
}

export const kindLabel = (k: CompareParagraph['kind']) => (k === 'ins' ? 'Added' : k === 'del' ? 'Removed' : 'Changed')

/** Scroll the sheet to a change and return its id (the caller keeps it as "current"). */
export function scrollToChange(sheet: HTMLElement | null, id: number) {
  sheet?.querySelector(`[data-change="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  return id
}

/** Next / previous change id, wrapping around. */
export function stepChange(changes: ChangeEntry[], current: number, dir: 1 | -1) {
  if (!changes.length) return current
  const i = changes.findIndex(c => c.id === current)
  const next = i < 0 ? (dir === 1 ? 0 : changes.length - 1) : (i + dir + changes.length) % changes.length
  return changes[next].id
}

function ComparedSeg({ s, markup }: { s: CompareSeg; markup: Markup }) {
  if (s.op === 'del' && markup === 'final') return null
  let el: React.ReactNode = s.text
  if (s.fmt.includes('bold')) el = <b>{el}</b>
  if (s.fmt.includes('italic')) el = <i>{el}</i>
  if (s.fmt.includes('underline')) el = <u>{el}</u>
  if (markup === 'all' && s.op === 'ins') return <ins className="rl-ins">{el}</ins>
  if (s.op === 'del') return <del className="rl-del">{el}</del>
  return <>{el}</>
}

export function ComparedPara({ p, heading, markup, current, children }:
  { p: CompareParagraph; heading?: boolean; markup: Markup; current: number; children?: React.ReactNode }) {
  if (p.kind === 'del' && markup === 'final') return null
  const Tag = heading ? 'h3' : 'p'
  const cls = [p.kind !== 'same' && 'rl-changed', p.kind === 'ins' && 'rl-para-ins', p.kind === 'del' && 'rl-para-del',
    p.change_id != null && p.change_id === current && 'rl-current'].filter(Boolean).join(' ')
  const para = (
    <Tag className={cls || undefined} data-change={p.change_id ?? undefined}
      style={p.align ? { textAlign: p.align as React.CSSProperties['textAlign'] } : undefined}>
      {p.segs.map((s, i) => <ComparedSeg key={i} s={s} markup={markup} />)}
    </Tag>
  )
  // Review controls (decide buttons) sit right under their paragraph.
  return children ? <div className="rl-decide-wrap">{para}{children}</div> : para
}
