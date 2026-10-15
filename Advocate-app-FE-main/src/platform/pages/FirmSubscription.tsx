// Subscription section of /platform/firms/:id: plan, status, usage, overrides
// and history. Changing anything needs `subscription.manage` (owners) and a
// reason; the server checks both and records every change.
import { useCallback, useEffect, useState } from 'react'
import { SelectField, TextField } from '../../ui/forms'
import { Button, Chip, Panel, Skel } from '../../ui/kit'
import { confirm, Modal } from '../../ui/overlays'
import SubscriptionUsage, { formatQty, type SubscriptionSummary } from '../../ui/SubscriptionUsage'
import { errorText, platformApi } from '../api'
import { usePlatformAuth } from '../PlatformAuth'

type Plan = { code: string; name: string; state: string; assignable: 'yes' | 'test' | 'no'; trialDays: number; description: string }
type Override = { key: string; label: string; enabled: boolean | null; limit: number | null; unlimited: boolean;
  reason: string; expiresAt: string | null; createdBy: string; active: boolean }
type HistoryRow = { id: number; action: string; fromPlan: string; toPlan: string; fromStatus: string; toStatus: string;
  actor: string; reason: string; at: string; detail: Record<string, unknown> }
type Data = SubscriptionSummary & { overrides: Override[]; history: HistoryRow[];
  keys: { key: string; label: string; kind: string }[] }

type Dialog = null | 'plan' | 'trial' | 'status' | 'override' | 'correct' | 'testfirm'

const STATUS_ACTIONS = [
  { value: 'activate', label: 'Active (paid / renewed)' }, { value: 'past_due', label: 'Past due (grace: still usable)' },
  { value: 'suspend', label: 'Suspended for billing (read-only)' }, { value: 'expire', label: 'Expired (read-only)' },
  { value: 'cancel', label: 'Cancelled (read-only)' },
]

export default function FirmSubscription({ firmId, onChanged }: { firmId: string; onChanged?: () => void }) {
  const { can } = usePlatformAuth()
  const manage = can('subscription.manage')
  const [data, setData] = useState<Data | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [testPlans, setTestPlans] = useState(false)

  const load = useCallback(() => {
    platformApi.get(`/firms/${firmId}/subscription`)
      .then((r) => (Array.isArray(r.data?.entitlements) ? setData(r.data) : setError("Couldn't load the subscription.")))
      .catch((e) => setError(errorText(e, "Couldn't load the subscription.")))
    platformApi.get('/plans').then((r) => setPlans(Array.isArray(r.data) ? r.data : [])).catch(() => setPlans([]))
    platformApi.get('/subscription-policy').then((r) => setTestPlans(r.data?.testPlansEnabled === true)).catch(() => setTestPlans(false))
  }, [firmId])
  useEffect(load, [load])

  const open = (d: Dialog, init: Record<string, string> = {}) => { setForm({ reason: '', ...init }); setError(''); setDialog(d) }
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const send = async (body: Record<string, unknown>) => {
    setBusy(true); setError('')
    try {
      const r = await platformApi.post(`/firms/${firmId}/subscription`, body)
      setData(r.data); setDialog(null); onChanged?.()
    } catch (e) {
      setError(errorText(e, 'That change was refused.'))
    } finally {
      setBusy(false)
    }
  }

  const submit = () => {
    const reason = (form.reason || '').trim()
    if (dialog === 'plan') send({ action: 'change_plan', planCode: form.planCode, status: form.status || 'ACTIVE', reason })
    if (dialog === 'trial') send({ action: 'extend_trial', days: Number(form.days || 0), reason })
    if (dialog === 'status') {
      const go = () => send({ action: form.statusAction, reason })
      if (['suspend', 'expire', 'cancel'].includes(form.statusAction)) {
        confirm({ title: 'Make this firm read-only?', danger: true, confirmLabel: 'Change status', accept: go,
          message: 'Nothing new can be added (cases, clients, invitations, uploads, AI). Existing work stays available and nothing is deleted. People can still sign in.' })
      } else go()
    }
    if (dialog === 'override') {
      send({ action: 'set_override', key: form.key, reason,
        enabled: form.enabled === '' || form.enabled === undefined ? undefined : form.enabled === 'on',
        limit: form.unlimited === 'yes' || !form.limit ? undefined : Number(form.limit),
        unlimited: form.unlimited === 'yes', expiresAt: form.expiresAt || undefined })
    }
    if (dialog === 'correct') send({ action: 'correct_usage', key: form.key, quantity: Number(form.quantity || 0), reason })
    if (dialog === 'testfirm') send({ action: data?.testFirm ? 'clear_test_firm' : 'mark_test_firm', reason })
  }

  if (!data) {
    return <Panel title="Subscription">{error ? <div className="callout bad" role="alert">{error}</div> : <Skel h={120} />}</Panel>
  }
  const plan = plans.find((p) => p.code === data.plan.code)
  const featureKeys = data.keys.filter((k) => k.kind === 'feature')
  const limitKeys = data.keys.filter((k) => k.kind !== 'feature')
  const overrideIsFeature = featureKeys.some((k) => k.key === form.key)
  const pending = data.status === 'PENDING'
  // Plans an operator may choose: published ones; unapproved ones only for a test firm (the server enforces it too).
  const choosable = plans.filter((p) => p.assignable === 'yes' || (data.testFirm && p.assignable === 'test'))

  return (
    <Panel title="Subscription" sub="AMS plan for this firm (separate from the invoices the firm sends its clients)."
      actions={manage ? (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" onClick={() => open('plan', {
            planCode: choosable.some((p) => p.code === data.plan.code) ? data.plan.code : choosable[0]?.code || '', status: 'ACTIVE' })}>
            {pending ? 'Assign plan' : 'Change plan'}</Button>
          {(data.status === 'TRIALING' || data.status === 'EXPIRED') && (plan?.trialDays ?? 0) > 0 &&
            <Button size="sm" variant="ghost" onClick={() => open('trial', { days: '7' })}>Extend trial</Button>}
          {!pending && <Button size="sm" variant="ghost" onClick={() => open('status', { statusAction: 'activate' })}>Status</Button>}
          {(testPlans || data.testFirm) && <Button size="sm" variant="ghost" onClick={() => open('testfirm')}>
            {data.testFirm ? 'Clear test firm' : 'Mark as test firm'}</Button>}
          <Button size="sm" variant="ghost" onClick={() => open('override', { key: limitKeys[0]?.key || '', enabled: '', unlimited: 'no' })}>Override</Button>
        </div>
      ) : undefined}>
      {error && !dialog && <div className="callout bad" role="alert">{error}</div>}
      {pending && (
        <div className="callout warn" style={{ marginBottom: 12 }}>
          No plan yet: the firm can sign in but can&apos;t add anything. Assign an approved, published plan
          {choosable.length === 0 ? ' (none is published yet - see Plans)' : ''}.
        </div>
      )}
      <SubscriptionUsage data={data} />

      {data.overrides.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="label" style={{ marginBottom: 6 }}>Overrides for this firm</div>
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 6 }}>
            {data.overrides.map((o) => (
              <li key={o.key} className="row between small" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span>
                  <b>{o.label}</b>{' '}
                  {o.enabled !== null && <Chip>{o.enabled ? 'on' : 'off'}</Chip>}{' '}
                  {o.unlimited ? <Chip>unlimited</Chip> : o.limit !== null && <Chip>limit {formatQty(o.key, o.limit)}</Chip>}{' '}
                  {!o.active && <Chip tone="warn">expired</Chip>}
                  <span className="muted"> · {o.reason} · {o.createdBy}{o.expiresAt ? ` · until ${new Date(o.expiresAt).toLocaleDateString()}` : ''}</span>
                </span>
                {manage && <Button size="sm" variant="ghost" className="danger"
                  onClick={() => confirm({ title: `Remove the ${o.label} override?`, message: 'The plan\'s own value applies again.',
                    confirmLabel: 'Remove', danger: true,
                    accept: () => send({ action: 'clear_override', key: o.key, reason: 'Override removed' }) })}>Remove</Button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details style={{ marginTop: 16 }}>
        <summary className="small">Subscription history ({data.history.length})</summary>
        <ul className="stack small" style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', gap: 4 }}>
          {data.history.map((h) => (
            <li key={h.id}>
              <b>{h.action.replace(/_/g, ' ').toLowerCase()}</b>
              {h.fromPlan !== h.toPlan && h.fromPlan && <> · {h.fromPlan} → {h.toPlan}</>}
              {h.fromStatus !== h.toStatus && h.fromStatus && <> · {h.fromStatus} → {h.toStatus}</>}
              <span className="muted"> · {h.actor} · {new Date(h.at).toLocaleString()}{h.reason ? ` · "${h.reason}"` : ''}</span>
            </li>
          ))}
        </ul>
        {manage && <Button size="sm" variant="ghost" style={{ marginTop: 8 }}
          onClick={() => open('correct', { key: data.keys.find((k) => k.kind === 'metered')?.key || '', quantity: '' })}>Correct metered usage…</Button>}
      </details>

      <Modal open={dialog !== null} onClose={() => setDialog(null)} size="narrow"
        title={{ plan: pending ? 'Assign plan' : 'Change plan', trial: 'Extend trial', status: 'Subscription status',
          override: 'Override an entitlement', correct: 'Correct metered usage',
          testfirm: data.testFirm ? 'Clear test firm' : 'Mark as a synthetic test firm' }[dialog || 'plan']}
        sub="Every change needs a reason and is kept in the subscription history."
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={busy || (form.reason || '').trim().length < 3} onClick={submit}>Save</Button></>}>
        <div className="stack">
          {error && <div className="callout bad" role="alert">{error}</div>}
          {dialog === 'plan' && <>
            {choosable.length === 0 && <div className="callout warn">No plan has been approved and published yet.</div>}
            <SelectField label="Plan" value={form.planCode} onChange={(e) => set('planCode', e.target.value)}
              options={choosable.map((p) => ({ value: p.code,
                label: p.assignable === 'yes' ? p.name : `${p.name} - ${p.state.toLowerCase()}, test only` }))}
              hint={plans.find((p) => p.code === form.planCode)?.description} />
            <SelectField label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}
              options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'TRIALING', label: 'Trial' }]}
              hint="A downgrade never deletes anything: work over the new limits stays, only new additions are refused." />
          </>}
          {dialog === 'testfirm' && <p className="small" style={{ margin: 0 }}>{data.testFirm
            ? 'The firm must be on a published plan first.'
            : 'A synthetic firm for development and testing: it may use unapproved (draft) plans. Only allowed on installs where test plans are enabled - never for a customer.'}</p>}
          {dialog === 'trial' && <TextField label="Extra days" type="number" min={1} max={365} value={form.days}
            onChange={(e) => set('days', e.target.value)} />}
          {dialog === 'status' && <SelectField label="New status" value={form.statusAction}
            onChange={(e) => set('statusAction', e.target.value)} options={STATUS_ACTIONS}
            hint="Billing status only - this is not a security suspension (use Suspend firm for that)." />}
          {dialog === 'override' && <>
            <SelectField label="Entitlement" value={form.key} onChange={(e) => set('key', e.target.value)}
              options={data.keys.map((k) => ({ value: k.key, label: k.label }))} />
            {overrideIsFeature ? (
              <SelectField label="Feature" value={form.enabled} onChange={(e) => set('enabled', e.target.value)}
                options={[{ value: '', label: 'Keep the plan\'s' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
            ) : <>
              <SelectField label="Unlimited" value={form.unlimited} onChange={(e) => set('unlimited', e.target.value)}
                options={[{ value: 'no', label: 'No - set a limit' }, { value: 'yes', label: 'Yes - no limit' }]} />
              {form.unlimited !== 'yes' && <TextField label={form.key === 'storage.bytes' ? 'Limit (bytes)' : 'Limit'} type="number" min={0}
                value={form.limit} onChange={(e) => set('limit', e.target.value)} />}
            </>}
            <TextField label="Expires (optional)" type="date" value={form.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
          </>}
          {dialog === 'correct' && <>
            <SelectField label="Metered usage" value={form.key} onChange={(e) => set('key', e.target.value)}
              options={data.keys.filter((k) => k.kind === 'metered').map((k) => ({ value: k.key, label: k.label }))} />
            <TextField label="Change (+ or -)" type="number" value={form.quantity} onChange={(e) => set('quantity', e.target.value)}
              hint="Recorded as a correction event; earlier events are never edited." />
          </>}
          <TextField label="Reason" required value={form.reason} onChange={(e) => set('reason', e.target.value)} />
        </div>
      </Modal>
    </Panel>
  )
}
