// /platform/plans - AMS's commercial plans and their approval state.
// The seeded plans are unapproved examples (Draft): they can't be given to a
// customer until a platform owner approves and publishes them. Approved terms
// are never edited: a change is a new revision, and firms on the old one keep
// it. No prices are set here. Every step needs `plan.publish` and a reason;
// the server checks both and writes the platform audit.
import { useCallback, useEffect, useState } from 'react'
import { Check, TextField, TextArea } from '../../ui/forms'
import { Button, Chip, PageHead, Panel, Skel } from '../../ui/kit'
import { Modal } from '../../ui/overlays'
import { formatQty } from '../../ui/SubscriptionUsage'
import { errorText, platformApi } from '../api'
import { usePlatformAuth } from '../PlatformAuth'

type Ent = { key: string; label: string; enabled: boolean; limit: number | null }
export type PlanRow = {
  code: string; name: string; description: string; state: string; family: string; revision: number
  approvedBy: string; approvedAt: string | null; approvalNote: string; publishedBy: string; publishedAt: string | null
  retiredBy: string; retiredAt: string | null; subscribers: number; assignable: 'yes' | 'test' | 'no'
  trialDays: number; entitlements: Ent[]
}
type Action = 'edit' | 'approve' | 'publish' | 'retire' | 'revise'

const STATE_TONE: Record<string, 'warn' | 'info' | 'ok' | ''> = { DRAFT: 'warn', APPROVED: 'info', PUBLISHED: 'ok', RETIRED: '', SYSTEM: '' }
const STATE_HELP: Record<string, string> = {
  DRAFT: 'Unapproved example: never offered to customers.',
  APPROVED: 'Terms signed off; not offered until published.',
  PUBLISHED: 'Offered to new firms.',
  RETIRED: 'No new subscriptions; firms already on it keep it.',
  SYSTEM: 'Internal: firms that used AMS before subscriptions.',
}
const ACTIONS: Record<string, Action[]> = {
  DRAFT: ['edit', 'approve', 'retire'], APPROVED: ['publish', 'retire'], PUBLISHED: ['revise', 'retire'],
  RETIRED: ['revise'], SYSTEM: [],
}
const LABEL: Record<Action, string> = { edit: 'Edit', approve: 'Approve', publish: 'Publish', retire: 'Retire', revise: 'New revision' }
const EXPLAIN: Record<Action, string> = {
  edit: 'Only a draft can be edited. Leave a limit empty for unlimited.',
  approve: 'Sign off these features and limits as the approved commercial terms. They cannot be edited afterwards.',
  publish: 'Offer this plan to new firms. An earlier published revision of the same plan stops being offered; firms on it keep it.',
  retire: 'Stop offering this plan. Firms already on it keep it until moved.',
  revise: 'Make a new draft copy to change the terms. Nobody is moved to it automatically.',
}

const when = (d: string | null) => (d ? new Date(d).toLocaleString() : '')

export default function PlatformPlans() {
  const { can } = usePlatformAuth()
  const manage = can('plan.publish')
  const [plans, setPlans] = useState<PlanRow[] | null>(null)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<{ plan: PlanRow; action: Action } | null>(null)
  const [reason, setReason] = useState('')
  const [draft, setDraft] = useState<{ name: string; description: string; trialDays: string; ents: Ent[] }>(
    { name: '', description: '', trialDays: '0', ents: [] })
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')

  const load = useCallback(() => {
    platformApi.get('/plans')
      .then((r) => (Array.isArray(r.data) ? setPlans(r.data) : setError("Couldn't load the plans.")))
      .catch((e) => setError(errorText(e, "Couldn't load the plans.")))
  }, [])
  useEffect(load, [load])

  const open = (plan: PlanRow, action: Action) => {
    setReason(''); setDialogError('')
    setDraft({ name: plan.name, description: plan.description, trialDays: String(plan.trialDays),
      ents: plan.entitlements.map((e) => ({ ...e })) })
    setDialog({ plan, action })
  }
  const setEnt = (key: string, patch: Partial<Ent>) =>
    setDraft((d) => ({ ...d, ents: d.ents.map((e) => (e.key === key ? { ...e, ...patch } : e)) }))

  const submit = async () => {
    if (!dialog) return
    setBusy(true); setDialogError('')
    const body: Record<string, unknown> = { action: dialog.action, reason: reason.trim() }
    if (dialog.action === 'edit') {
      Object.assign(body, { name: draft.name, description: draft.description, trialDays: Number(draft.trialDays || 0),
        entitlements: draft.ents.map((e) => ({ key: e.key, enabled: e.enabled, limit: e.key.startsWith('feature.') ? null : e.limit })) })
    }
    try {
      await platformApi.post(`/plans/${dialog.plan.code}`, body)
      setDialog(null); load()
    } catch (e) {
      setDialogError(errorText(e, 'That change was refused.'))
    } finally {
      setBusy(false)
    }
  }

  if (!plans) {
    return (<div><PageHead title="Plans" />
      {error ? <div className="callout bad" role="alert">{error}</div> : <Skel h={200} />}</div>)
  }
  const anyPublished = plans.some((p) => p.state === 'PUBLISHED')
  return (
    <div>
      <PageHead title="Plans" sub="AMS plans for firms - separate from the invoices firms send their clients. No prices are set in AMS." />
      {!anyPublished && (
        <div className="callout warn" style={{ marginBottom: 16 }}>
          No plan is approved and published yet. The plans below are examples awaiting a business decision;
          new firms stay on <b>plan pending</b> (they can sign in but add nothing) until one is published and assigned.
        </div>
      )}
      <div className="stack">
        {plans.map((p) => (
          <Panel key={p.code} title={<span>{p.name} <span className="muted small">{p.code}{p.revision > 1 ? ` · revision ${p.revision}` : ''}</span></span>}
            sub={STATE_HELP[p.state]}
            actions={<div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Chip tone={STATE_TONE[p.state] || ''}>{p.state.toLowerCase()}</Chip>
              {manage && (ACTIONS[p.state] || []).map((a) => (
                <Button key={a} size="sm" variant={a === 'publish' || a === 'approve' ? 'primary' : 'ghost'}
                  onClick={() => open(p, a)}>{LABEL[a]}</Button>
              ))}
            </div>}>
            {p.description && <p className="small" style={{ marginTop: 0 }}>{p.description}</p>}
            <div className="table-wrap">
              <table className="t">
                <caption className="sr-only">{p.name} features and limits</caption>
                <thead><tr><th scope="col">Entitlement</th><th scope="col">Included</th><th scope="col">Limit</th></tr></thead>
                <tbody>
                  {p.entitlements.map((e) => (
                    <tr key={e.key}>
                      <th scope="row">{e.label}</th>
                      <td>{e.enabled ? 'Yes' : 'No'}</td>
                      <td className="num">{e.key.startsWith('feature.') || !e.enabled ? '—' : e.limit === null ? 'Unlimited' : formatQty(e.key, e.limit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>
              {p.trialDays > 0 ? `Trial: ${p.trialDays} days. ` : ''}
              Firms on this plan: {p.subscribers}.
              {p.approvedAt && ` Approved by ${p.approvedBy}, ${when(p.approvedAt)}${p.approvalNote ? ` ("${p.approvalNote}")` : ''}.`}
              {p.publishedAt && ` Published by ${p.publishedBy}, ${when(p.publishedAt)}.`}
              {p.retiredAt && ` Retired by ${p.retiredBy}, ${when(p.retiredAt)}.`}
            </p>
          </Panel>
        ))}
      </div>

      <Modal open={dialog !== null} onClose={() => setDialog(null)} size={dialog?.action === 'edit' ? undefined : 'narrow'}
        title={dialog ? `${LABEL[dialog.action]}: ${dialog.plan.name}` : ''}
        sub={dialog ? EXPLAIN[dialog.action] : ''}
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={busy || reason.trim().length < 3} onClick={submit}>
            {dialog ? LABEL[dialog.action] : 'Save'}</Button></>}>
        <div className="stack">
          {dialogError && <div className="callout bad" role="alert">{dialogError}</div>}
          {dialog?.action === 'edit' && <>
            <TextField label="Name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            <TextArea label="Description" value={draft.description} rows={2}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
            <TextField label="Trial days (0 = not a trial)" type="number" min={0} max={365} value={draft.trialDays}
              onChange={(e) => setDraft((d) => ({ ...d, trialDays: e.target.value }))} />
            <div className="table-wrap">
              <table className="t">
                <caption className="sr-only">Features and limits</caption>
                <thead><tr><th scope="col">Entitlement</th><th scope="col">Included</th><th scope="col">Limit (empty = unlimited)</th></tr></thead>
                <tbody>
                  {draft.ents.map((e) => (
                    <tr key={e.key}>
                      <th scope="row">{e.label}</th>
                      <td><Check label={<span className="sr-only">{e.label} included</span>} checked={e.enabled}
                        onChange={(ev) => setEnt(e.key, { enabled: ev.target.checked })} /></td>
                      <td>{e.key.startsWith('feature.') ? '—' : (
                        <input className="input" type="number" min={0} aria-label={`${e.label} limit`}
                          value={e.limit === null ? '' : String(e.limit)}
                          onChange={(ev) => setEnt(e.key, { limit: ev.target.value === '' ? null : Math.max(0, Number(ev.target.value)) })} />
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>}
          <TextField label={dialog?.action === 'approve' ? 'Approval reference (e.g. decision / minute)' : 'Reason'} required
            value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Modal>
    </div>
  )
}
