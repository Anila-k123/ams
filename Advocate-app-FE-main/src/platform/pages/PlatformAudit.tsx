import { useEffect, useState } from 'react'
import { DataTable, type Column } from '../../ui/DataTable'
import { SelectField, TextField } from '../../ui/forms'
import { Button, Chip, PageHead } from '../../ui/kit'
import { errorText, platformApi } from '../api'

type Row = { id: number; at: string; operator: string; action: string; firmId: number | null; success: boolean; detail: Record<string, unknown> }

const RESULTS = [{ value: '', label: 'Any result' }, { value: 'true', label: 'Succeeded' }, { value: 'false', label: 'Failed' }]

/** /platform/audit - every operator action, searchable by action, operator and result. */
export default function PlatformAudit() {
  const [filters, setFilters] = useState({ action: '', operator: '', success: '' })
  const [applied, setApplied] = useState(filters)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  // Server pages, newest first; `nextBefore` fetches the next older page.
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const fetchPage = (before: number | null) => {
    const params = Object.fromEntries(Object.entries({ ...applied, limit: '100', before: before ? String(before) : '' })
      .filter(([, v]) => v))
    return platformApi.get('/audit', { params }).then((r) => {
      setNextBefore(r.data.hasMore ? r.data.nextBefore : null)
      return r.data.results as Row[]
    })
  }

  useEffect(() => {
    setRows(null); setError(''); setNextBefore(null)
    fetchPage(null).then(setRows)
      .catch((e) => { setError(errorText(e, "Couldn't load the audit log.")); setRows([]) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the applied filters change
  }, [applied])

  const loadMore = () => {
    if (!nextBefore) return
    setLoadingMore(true)
    fetchPage(nextBefore).then((more) => setRows((prev) => [...(prev || []), ...more]))
      .catch((e) => setError(errorText(e, "Couldn't load older events.")))
      .finally(() => setLoadingMore(false))
  }

  const columns: Column<Row>[] = [
    { key: 'at', label: 'When', sort: true, render: (r) => new Date(r.at).toLocaleString() },
    { key: 'operator', label: 'Operator', sort: true, render: (r) => r.operator || '—' },
    { key: 'action', label: 'Action', sort: true },
    { key: 'success', label: 'Result', render: (r) => (r.success ? <Chip tone="ok">ok</Chip> : <Chip tone="bad">failed</Chip>) },
    { key: 'detail', label: 'Detail', hideSm: true, render: (r) => <span className="small muted">{
      Object.entries(r.detail || {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')
    }</span> },
  ]

  return (
    <div>
      <PageHead title="Platform audit" sub="Every operator sign-in and action, newest first." />
      <form className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}
        onSubmit={(e) => { e.preventDefault(); setApplied(filters) }}>
        <TextField label="Action" placeholder="e.g. FIRM_SUSPEND" value={filters.action}
          onChange={(e) => setFilters({ ...filters, action: e.target.value })} />
        <TextField label="Operator" placeholder="email" value={filters.operator}
          onChange={(e) => setFilters({ ...filters, operator: e.target.value })} />
        <SelectField label="Result" options={RESULTS} value={filters.success}
          onChange={(e) => setFilters({ ...filters, success: e.target.value })} />
        <Button type="submit" variant="primary">Filter</Button>
      </form>
      {error && <div className="callout bad" role="alert">{error}</div>}
      <DataTable rows={rows || []} columns={columns} rowKey={(r) => r.id} loading={rows === null}
        empty={{ icon: 'history', title: 'No matching events' }} pageSize={1000} />
      {rows && rows.length > 0 && (
        <p className="small muted" style={{ marginTop: 12 }}>
          Showing {rows.length} event{rows.length === 1 ? '' : 's'}{nextBefore ? ' - older events exist.' : ' - the full history for these filters.'}
          {nextBefore && <> <Button size="sm" loading={loadingMore} onClick={loadMore}>Load older events</Button></>}
        </p>
      )}
    </div>
  )
}
