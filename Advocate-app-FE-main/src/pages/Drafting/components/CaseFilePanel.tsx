import { useEffect, useState } from 'react'
import Icon from '../../../ui/Icon'
import { draftingApi, type CaseFile, type CaseFileDocument } from '../api/drafting'

interface Props {
  sessionId: number
  onOpen: (doc: CaseFileDocument) => void
}

// The linked case beside the draft: who, which court, what's next, and every paper on file, so the
// draft can be checked against its source (drafting/casefile.py). Hidden when the draft has no case.
export default function CaseFilePanel({ sessionId, onOpen }: Props) {
  const [data, setData] = useState<CaseFile | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    draftingApi.getCaseFile(sessionId).then(setData).catch(() => setData(null))
  }, [sessionId])

  if (!data?.case) return null
  const c = data.case
  const docs = data.documents.filter(d => !query.trim() || d.name.toLowerCase().includes(query.trim().toLowerCase()))
  const line = (label: string, value?: string | null) => value
    ? <div className="dr-cf-row"><span className="faint">{label}</span><span>{value}</span></div> : null

  return (
    <div className="ed-sec dr-casefile">
      <h3 className="row" style={{ justifyContent: 'space-between' }}>
        <span>Case file</span>
        <button type="button" className="btn ghost sm" title="Open the full case in a new tab" aria-label="Open the full case"
          onClick={() => window.open(`/dashboard/cases/${c.id}`, '_blank', 'noopener')}><Icon name="external" size="sm" /></button>
      </h3>
      <div className="small"><strong>{c.caseNumber}</strong>{c.caseTitle && <> · {c.caseTitle}</>}</div>
      {data.canSeeCase && (
        <div className="dr-cf small">
          {line('Court', [c.court, c.judge].filter(Boolean).join(' · '))}
          {line('CNR', c.cnr)}
          {line('Next', c.nextHearing ? `${new Date(c.nextHearing.date).toLocaleDateString()} · ${c.nextHearing.title}` : null)}
          {c.client && <>
            {line('Client', c.client.name)}
            {line('Address', c.client.address)}
            {line('Phone', c.client.phone)}
          </>}
          {(c.parties ?? []).map((p, i) => (
            <div key={i}>{line(p.opponent ? 'Opponent' : (p.role || 'Party'), [p.name, p.counsel && `(${p.counsel})`].filter(Boolean).join(' '))}</div>
          ))}
        </div>
      )}
      {data.canSeeDocuments && (
        <>
          <div className="faint xs" style={{ margin: '10px 0 4px' }}>Documents ({data.documents.length})</div>
          {data.documents.length > 6 && (
            <input className="input" style={{ marginBottom: 6 }} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search documents" aria-label="Search case documents" />
          )}
          {docs.map(d => (
            <button key={d.id} type="button" className="pp-ref-doc" title={d.fileName} onClick={() => onOpen(d)}>
              <Icon name="file" size="sm" />
              <span className="pp-ref-doc-name">{d.name}</span>
              {!d.onCase && <span className="faint xs" title="The client's document, not filed on this case">client</span>}
            </button>
          ))}
          {!data.documents.length && <div className="faint small">No documents on this case.</div>}
        </>
      )}
    </div>
  )
}
