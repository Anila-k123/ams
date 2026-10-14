import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DataTable, type Column } from '../../ui/DataTable'
import { SearchInput, SelectField } from '../../ui/forms'
import { PageHead, StatusChip } from '../../ui/kit'
import { errorText, platformApi } from '../api'
import { usePlatformAuth } from '../PlatformAuth'

export type FirmRow = {
  publicId: string; name: string; slug: string; status: string; planCode: string; displayName: string
  createdAt: string; members?: Record<string, number>
}

const STATUSES = [
  { value: '', label: 'All statuses' }, { value: 'ACTIVE', label: 'Active' },
  { value: 'PROVISIONING', label: 'Awaiting activation' }, { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'CLOSED', label: 'Closed' },
]

/** /platform/firms - search, filter by status, open a firm. */
export default function FirmDirectory() {
  const { can } = usePlatformAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState<FirmRow[] | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setRows(null)
    platformApi.get('/firms', { params: status ? { status } : {} })
      .then((r) => setRows(r.data)).catch((e) => { setError(errorText(e, "Couldn't load firms.")); setRows([]) })
  }, [status])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (rows || []).filter((f) => !needle || [f.name, f.slug, f.displayName, f.publicId]
      .some((v) => (v || '').toLowerCase().includes(needle)))
  }, [rows, q])

  const columns: Column<FirmRow>[] = [
    { key: 'name', label: 'Firm', sort: true, render: (f) => <Link to={`/platform/firms/${f.publicId}`}>{f.displayName || f.name}</Link> },
    { key: 'slug', label: 'Identifier', sort: true, hideSm: true },
    { key: 'status', label: 'Status', sort: true, render: (f) => <StatusChip status={f.status} /> },
    { key: 'members', label: 'Active members', align: 'right', render: (f) => f.members?.ACTIVE ?? 0 },
    { key: 'planCode', label: 'Plan', hideSm: true, render: (f) => f.planCode || '—' },
    { key: 'createdAt', label: 'Created', sort: true, hideSm: true, render: (f) => new Date(f.createdAt).toLocaleDateString() },
  ]

  return (
    <div>
      <PageHead title="Firms" sub="Every tenant on this AMS platform."
        actions={can('firm.create') ? <Link className="btn primary" to="/platform/firms/new">Create firm</Link> : undefined} />
      {error && <div className="callout bad" role="alert">{error}</div>}
      <div className="row" style={{ gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <SearchInput value={q} onChange={setQ} placeholder="Search name, identifier or id" aria-label="Search firms" />
        <SelectField label="Status" options={STATUSES} value={status} onChange={(e) => setStatus(e.target.value)} />
      </div>
      <DataTable rows={shown} columns={columns} rowKey={(f) => f.publicId} loading={rows === null}
        onRow={(f) => navigate(`/platform/firms/${f.publicId}`)}
        empty={{ icon: 'search', title: rows?.length ? 'No firm matches' : 'No firms yet' }} />
    </div>
  )
}
