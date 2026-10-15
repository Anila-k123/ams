import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, PageHead, Panel, Skel, StatusChip } from '../../ui/kit'
import { errorText, platformApi } from '../api'
import { usePlatformAuth } from '../PlatformAuth'

type Stats = {
  firms: { total: number; ACTIVE: number; PROVISIONING: number; SUSPENDED: number; CLOSED: number }
  createdLast7Days: number
  pendingAdminInvitations: number
  failedInvitationDeliveries: number
  recentFirms: { publicId: string; name: string; status: string; createdAt: string }[]
}

/** /platform/dashboard - every number comes from /api/platform/stats and /audit. */
export default function PlatformDashboard() {
  const { can } = usePlatformAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [audit, setAudit] = useState<any[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    platformApi.get('/stats').then((r) => setStats(r.data)).catch((e) => setError(errorText(e, "Couldn't load the figures.")))
    if (can('audit.read')) {
      platformApi.get('/audit?limit=8').then((r) => setAudit(r.data.results)).catch(() => setAudit([]))
    }
  }, [can])

  const tiles: [string, number | undefined][] = stats ? [
    ['Registered firms', stats.firms.total], ['Active', stats.firms.ACTIVE],
    ['Awaiting activation', stats.firms.PROVISIONING], ['Suspended', stats.firms.SUSPENDED],
    ['New in the last 7 days', stats.createdLast7Days], ['Pending admin invitations', stats.pendingAdminInvitations],
    ['Failed invitation emails', stats.failedInvitationDeliveries],
  ] : []

  return (
    <div>
      <PageHead title="Platform dashboard" sub="Firms on PactPro and recent operator activity."
        actions={can('firm.create') ? <Link className="btn primary" to="/platform/firms/new">Create firm</Link> : undefined} />
      {error && <div className="callout bad" role="alert">{error}</div>}
      <div className="pf-stats" aria-live="polite">
        {!stats && !error && [0, 1, 2, 3].map((i) => <div key={i} className="panel pf-stat"><Skel h={26} w="40%" /><Skel h={12} /></div>)}
        {tiles.map(([label, n]) => (
          <div key={label} className="panel pf-stat"><div className="n">{n ?? 0}</div><div className="l">{label}</div></div>
        ))}
      </div>
      <div className="cols" style={{ gap: 16 }}>
        <Panel title="Recently created firms">
          {stats && stats.recentFirms.length === 0 && <EmptyState icon="info" title="No firms yet" />}
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {stats?.recentFirms.map((f) => (
              <li key={f.publicId} className="row between">
                <Link to={`/platform/firms/${f.publicId}`}>{f.name}</Link>
                <StatusChip status={f.status} />
              </li>
            ))}
          </ul>
        </Panel>
        {can('audit.read') && (
          <Panel title="Recent platform events" actions={<Link to="/platform/audit">All events</Link>}>
            {audit && audit.length === 0 && <EmptyState icon="history" title="No events yet" />}
            <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {audit?.map((a) => (
                <li key={a.id} className="small">
                  <b>{a.action}</b> {a.success ? '' : '(failed) '}· {a.operator || 'unknown'} · {new Date(a.at).toLocaleString()}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  )
}
