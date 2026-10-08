import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, PopMenu, Spinner } from '../../../ui/kit'
import { Segmented } from '../../../ui/forms'
import Icon from '../../../ui/Icon'
import { draftingApi, type DraftComparison, type DraftVersion } from '../api/drafting'
import { ComparedPara, changeList, kindLabel, scrollToChange, stepChange, type Markup } from './compareParts'

const CURRENT = 0   // the "to" option for the live draft

const versionLabel = (v: DraftVersion) =>
  `v${v.number} · ${v.label || (v.kind === 'generated' ? 'AI draft' : v.kind === 'sent' ? 'Sent' : 'Saved')}`

interface Props {
  sessionId: number
  docTitle: string
  initialFrom?: number   // a version picked in the Versions list; omitted = the server's default
  onClose: () => void
  // Word / PDF redline of what's on screen (the page's download, so letterhead etc. apply).
  onDownload: (from: number, to: number | undefined, format: 'docx' | 'pdf') => void
}

// The redline on screen, no download: the draft with additions underlined and deletions struck
// through between two versions (or a version and the current draft). Same engine as the Word / PDF
// redline (drafting/export/compare.py), so the screen and the files always agree. Read-only:
// accepting / rejecting changes inside AMS is the next step (docs/DRAFT_EXPORT.md, roadmap).
export default function CompareView({ sessionId, docTitle, initialFrom, onClose, onDownload }: Props) {
  const [versions, setVersions] = useState<DraftVersion[]>([])
  // The version the user picked; until then the server's default (shown via data.from).
  const [picked, setPicked] = useState<number | undefined>(initialFrom)
  const [to, setTo] = useState<number>(CURRENT)
  const [data, setData] = useState<DraftComparison | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [markup, setMarkup] = useState<Markup>('all')
  const [current, setCurrent] = useState(0)            // the change_id in focus (0 = none)
  const [dlAnchor, setDlAnchor] = useState<HTMLElement | null>(null)
  const sheet = useRef<HTMLElement>(null)

  useEffect(() => {
    draftingApi.getVersions(sessionId).then(setVersions).catch(() => setVersions([]))
  }, [sessionId])

  useEffect(() => {
    setLoading(true); setError(''); setCurrent(0)
    draftingApi.compare(sessionId, picked, to || undefined)
      .then(setData)
      .catch(e => setError(e?.response?.status === 400
        ? 'No saved versions yet. Use Versions → Save first, then compare.'
        : 'Could not load the comparison.'))
      .finally(() => setLoading(false))
  }, [sessionId, picked, to])

  const changes = useMemo(() => changeList(data?.clauses ?? [], docTitle), [data, docTitle])
  const goTo = (id: number) => setCurrent(scrollToChange(sheet.current, id))
  const step = (dir: 1 | -1) => { if (changes.length) goTo(stepChange(changes, current, dir)) }

  const options = versions.map(v => ({ value: v.id, label: versionLabel(v) }))
  return (
    <div className="dr-compare">
      <div className="dr-compare-bar" role="toolbar" aria-label="Compare versions">
        <label className="row" style={{ gap: 6 }}>
          <span className="small muted">From</span>
          <select className="input" value={picked ?? data?.from.id ?? ''} onChange={e => setPicked(Number(e.target.value))}>
            {picked == null && !data && <option value="">…</option>}
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span className="small muted">To</span>
          <select className="input" value={to} onChange={e => setTo(Number(e.target.value))}>
            <option value={CURRENT}>Current draft (now)</option>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {data && (
          <span className="small" aria-live="polite">
            <strong>{data.changes}</strong> change{data.changes === 1 ? '' : 's'}
            <span className="muted"> · {data.inserted} word{data.inserted === 1 ? '' : 's'} added, {data.deleted} removed</span>
          </span>
        )}
        <div className="row" style={{ gap: 2 }}>
          <button type="button" className="btn ghost sm icon" aria-label="Previous change" title="Previous change"
            disabled={!changes.length} onClick={() => step(-1)}><Icon name="chevronLeft" size="sm" /></button>
          <button type="button" className="btn ghost sm icon" aria-label="Next change" title="Next change"
            disabled={!changes.length} onClick={() => step(1)}><Icon name="chevron" size="sm" /></button>
        </div>
        <Segmented label="Markup" value={markup} onChange={v => setMarkup(v as Markup)}
          options={[{ value: 'all', label: 'All markup' }, { value: 'final', label: 'Final' }]} />
        <span className="grow" />
        <Button size="sm" icon="download" disabled={!data} aria-haspopup="menu"
          onClick={e => setDlAnchor(dlAnchor ? null : e.currentTarget)}>Download</Button>
        {dlAnchor && data && (
          <PopMenu anchor={dlAnchor} onClose={() => setDlAnchor(null)} align="right" width={200} items={[
            { label: 'Word (editable)', icon: 'file', onClick: () => onDownload(data.from.id, to || undefined, 'docx') },
            { label: 'PDF (read-only)', icon: 'file', onClick: () => onDownload(data.from.id, to || undefined, 'pdf') },
          ]} />
        )}
        <Button size="sm" icon="x" onClick={onClose}>Close</Button>
      </div>

      {loading ? <div className="dr-compare-empty"><Spinner label="Comparing" /></div>
        : error ? <div className="callout warn" role="alert"><Icon name="warn" size="sm" /><div>{error}</div></div>
        : data && (
          <div className="dr-compare-body">
            <aside className="dr-compare-list" aria-label="Changes">
              {changes.length === 0 ? <p className="small muted">No differences between these versions.</p> : (
                <ol>
                  {changes.map(c => (
                    <li key={c.id}>
                      <button type="button" aria-current={c.id === current || undefined} onClick={() => goTo(c.id)}>
                        <span className="small">{c.label}</span>
                        <span className={`xs rl-tag ${c.kind}`}>{kindLabel(c.kind)}</span>
                        {c.snippet && <span className="xs faint ellipsis">{c.snippet}</span>}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </aside>
            <article ref={sheet} className={`paper-sheet preview dr-compare-sheet ${markup}`} aria-label="Compared draft">
              {docTitle && <h1 className="pp-doc-title">{docTitle}</h1>}
              {data.clauses.map(c => (
                <section key={`${c.status}-${c.block_id}`}>
                  {c.heading.map((p, i) => <ComparedPara key={`h${i}`} p={p} heading markup={markup} current={current} />)}
                  {c.body.map((p, i) => <ComparedPara key={`b${i}`} p={p} markup={markup} current={current} />)}
                </section>
              ))}
            </article>
          </div>
        )}
    </div>
  )
}
