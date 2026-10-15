import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { TextArea } from '../../ui/forms'
import { Button, Chip, EmptyState, PageHead, Panel, Skel, StatusChip } from '../../ui/kit'
import { confirm, Modal } from '../../ui/overlays'
import { errorText, platformApi } from '../api'
import { usePlatformAuth } from '../PlatformAuth'
import FirmSubscription from './FirmSubscription'
import { deliveryLabel } from '../../utils/delivery'

type Invitation = {
  id: number; email: string; status: string; expiresAt: string; createdAt: string; acceptedAt: string | null
  sendCount: number; deliveryStatus: string; deliveryError: string; lastSentAt: string | null
}
type Firm = {
  publicId: string; name: string; slug: string; status: string; planCode: string; displayName: string
  createdAt: string; members: Record<string, number>; contact?: Record<string, string>
  timeZone?: string; currency?: string; adminInvitation: Invitation | null
}
type Usage = Record<string, number | Record<string, number>>

const CONTACT_LABELS: [string, string][] = [
  ['officeEmail', 'Office email'], ['officePhone', 'Office phone'], ['officeAddress', 'Address'],
  ['city', 'City'], ['state', 'State'], ['country', 'Country'], ['pinCode', 'PIN code'], ['website', 'Website'],
]

const fmtBytes = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** /platform/firms/:id - identity, contact, members, usage counts (never contents),
 *  administrator invitation, lifecycle and the firm's platform audit trail. */
export default function FirmDetail() {
  const { id = '' } = useParams()
  const { can } = usePlatformAuth()
  const [firm, setFirm] = useState<Firm | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [audit, setAudit] = useState<any[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [suspendOpen, setSuspendOpen] = useState(false)
  const [reason, setReason] = useState('')

  const load = useCallback(() => {
    platformApi.get(`/firms/${id}`).then((r) => setFirm(r.data)).catch((e) => setError(errorText(e, "Couldn't load the firm.")))
    platformApi.get(`/firms/${id}/usage`).then((r) => setUsage(r.data)).catch(() => setUsage(null))
    if (can('audit.read')) {
      platformApi.get('/audit', { params: { firm: id, limit: 50 } }).then((r) => setAudit(r.data.results)).catch(() => setAudit([]))
    }
  }, [id, can])
  useEffect(load, [load])

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setError(''); setNotice('')
    try { await fn(); setNotice(ok); load() } catch (e) { setError(errorText(e, 'That did not work.')) } finally { setBusy(false) }
  }

  const activate = () => act(() => platformApi.post(`/firms/${id}/${firm?.status === 'SUSPENDED' ? 'reactivate' : 'activate'}`),
    'The firm is active.')

  const suspend = () => {
    if (reason.trim().length < 3) { setError('Give a reason for suspending the firm.'); return }
    confirm({
      title: 'Suspend this firm?', danger: true, confirmLabel: 'Suspend firm',
      message: `Everyone at ${firm?.name} is signed out at once and can't sign in until the firm is reactivated. No data is deleted.`,
      accept: () => act(async () => {
        await platformApi.post(`/firms/${id}/suspend`, { reason: reason.trim() })
        setSuspendOpen(false); setReason('')
      }, 'The firm is suspended.'),
    })
  }

  const resend = (inv: Invitation) => act(() => platformApi.post(`/firms/${id}/invitations/${inv.id}/resend`),
    `A new invitation link was sent to ${inv.email}.`)

  if (!firm) {
    return error ? <div className="callout bad" role="alert">{error}</div>
      : <div className="stack"><Skel h={28} w="40%" /><Skel h={120} /></div>
  }

  const inv = firm.adminInvitation
  const lifecycle = can('firm.lifecycle') && firm.status !== 'CLOSED'
  return (
    <div>
      <PageHead title={firm.displayName || firm.name} sub={<>{firm.slug} · created {new Date(firm.createdAt).toLocaleDateString()}</>}
        actions={<div className="row" style={{ gap: 8 }}>
          <StatusChip status={firm.status} />
          {lifecycle && firm.status !== 'ACTIVE' && <Button variant="primary" loading={busy} onClick={activate}>
            {firm.status === 'SUSPENDED' ? 'Reactivate' : 'Activate'}</Button>}
          {lifecycle && firm.status !== 'SUSPENDED' && <Button variant="danger" onClick={() => setSuspendOpen(true)}>Suspend</Button>}
        </div>} />
      <p><Link to="/platform/firms">← All firms</Link></p>
      {error && <div className="callout bad" role="alert">{error}</div>}
      {notice && <div className="callout ok" role="status">{notice}</div>}
      {firm.status === 'PROVISIONING' && (
        <div className="callout info">Awaiting activation: the firm becomes active when its administrator accepts the invitation.</div>
      )}

      <div className="cols" style={{ gap: 16 }}>
        <Panel title="Identity and plan">
          <dl className="pf-dl">
            <dt>Legal name</dt><dd>{firm.name}</dd>
            <dt>Identifier</dt><dd>{firm.slug}</dd>
            <dt>Firm id</dt><dd className="small">{firm.publicId}</dd>
            <dt>Plan</dt><dd>{firm.planCode || '—'}</dd>
            <dt>Time zone</dt><dd>{firm.timeZone || '—'}</dd>
            <dt>Currency</dt><dd>{firm.currency || '—'}</dd>
          </dl>
        </Panel>
        <Panel title="Contact">
          <dl className="pf-dl">
            {CONTACT_LABELS.map(([k, label]) => <span key={k} style={{ display: 'contents' }}>
              <dt>{label}</dt><dd>{firm.contact?.[k] || '—'}</dd></span>)}
          </dl>
        </Panel>
      </div>

      <div className="cols" style={{ gap: 16 }}>
        <Panel title="Members">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {['ACTIVE', 'INVITED', 'SUSPENDED', 'LEFT'].map((s) => (
              <Chip key={s} plain>{s.toLowerCase()}: {firm.members?.[s] ?? 0}</Chip>
            ))}
          </div>
        </Panel>
        <Panel title="Usage" sub="Counts only - operators never see a firm's records.">
          {!usage ? <Skel h={60} /> : (
            <dl className="pf-dl">
              <dt>Cases</dt><dd>{usage.cases as number}</dd>
              <dt>Clients</dt><dd>{usage.clients as number}</dd>
              <dt>Documents</dt><dd>{usage.documents as number} ({fmtBytes(usage.storageBytes as number)})</dd>
              <dt>Invoices</dt><dd>{usage.invoices as number}</dd>
              <dt>Roles</dt><dd>{usage.roles as number}</dd>
              <dt>Pending invitations</dt><dd>{usage.pendingInvitations as number}</dd>
            </dl>
          )}
        </Panel>
      </div>

      <FirmSubscription firmId={id} onChanged={load} />

      <Panel title="Administrator invitation">
        {!inv ? <EmptyState icon="info" title="No administrator invitation" /> : (
          <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div className="stack" style={{ gap: 4 }}>
              <div><b>{inv.email}</b> <StatusChip status={inv.status} /></div>
              <div className="small muted">
                Email: {inv.deliveryStatus === 'FAILED'
                  ? <span className="bad">failed - {inv.deliveryError}</span>
                  : deliveryLabel(inv.deliveryStatus)}
                {' · '}sent {inv.sendCount}×{inv.lastSentAt ? `, last ${new Date(inv.lastSentAt).toLocaleString()}` : ''}
                {' · '}{inv.status === 'ACCEPTED' && inv.acceptedAt ? `accepted ${new Date(inv.acceptedAt).toLocaleString()}`
                  : `expires ${new Date(inv.expiresAt).toLocaleString()}`}
              </div>
            </div>
            {can('invite.manage') && inv.status !== 'ACCEPTED' && (
              <Button loading={busy} onClick={() => resend(inv)}>Resend invitation</Button>
            )}
          </div>
        )}
      </Panel>

      {can('audit.read') && (
        <Panel title="Platform audit for this firm">
          {audit && audit.length === 0 && <EmptyState icon="history" title="No events" />}
          {audit === null && <Skel h={40} />}
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {audit?.map((a) => (
              <li key={a.id} className="small">
                <b>{a.action}</b> {a.success ? '' : <Chip tone="bad">failed</Chip>} · {a.operator || 'unknown'} · {new Date(a.at).toLocaleString()}
                {a.detail?.reason ? <> · “{a.detail.reason}”</> : null}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Modal open={suspendOpen} onClose={() => setSuspendOpen(false)} title={`Suspend ${firm.name}`} size="narrow"
        footer={<><Button variant="ghost" onClick={() => setSuspendOpen(false)}>Cancel</Button>
          <Button variant="danger" onClick={suspend} disabled={reason.trim().length < 3}>Continue</Button></>}>
        <TextArea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)}
          hint="Recorded in the platform audit log." rows={3} />
      </Modal>
    </div>
  )
}
