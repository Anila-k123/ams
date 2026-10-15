import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, SelectField, TextField } from '../../ui/forms'
import { Button, PageHead, Panel } from '../../ui/kit'
import { emailError } from '../../utils/validators'
import { errorText, platformApi, uuid } from '../api'
import { deliveryLabel } from '../../utils/delivery'

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/

export const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)

type Result = { firm: { publicId: string; name: string; status: string }; invitation: any; created: boolean }

/** /platform/firms/new - provision a firm and invite its first administrator.
 *  No password is ever set here: the administrator chooses one from the invitation. */
export default function FirmCreate() {
  const [form, setForm] = useState({ name: '', slug: '', adminName: '', adminEmail: '', planCode: '',
    officeEmail: '', officePhone: '', city: '', state: '' })
  const [slugTouched, setSlugTouched] = useState(false)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [plans, setPlans] = useState<{ code: string; name: string; state: string; assignable: string }[]>([])
  const [testPlans, setTestPlans] = useState(false)
  const [testFirm, setTestFirm] = useState(false)
  useEffect(() => {
    platformApi.get('/plans').then((r) => setPlans(Array.isArray(r.data) ? r.data : [])).catch(() => setPlans([]))
    platformApi.get('/subscription-policy').then((r) => setTestPlans(r.data?.testPlansEnabled === true)).catch(() => setTestPlans(false))
  }, [])
  // Only published plans for a real firm; unapproved (draft / approved) plans
  // only for a synthetic test firm where this install allows them. The server
  // checks the same rule.
  const planOptions = plans.filter((p) => p.assignable === 'yes' || (testFirm && p.assignable === 'test'))
  // One key per form: a double click or a retry after a timeout returns the same firm.
  const key = useRef(uuid())

  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v, ...(k === 'name' && !slugTouched ? { slug: slugify(v) } : {}) }))
  }

  const errors = {
    name: form.name.trim().length < 2 ? 'Give the firm a name.' : '',
    slug: !SLUG.test(form.slug) ? 'Use 3-50 characters: a-z, 0-9 and dashes.' : '',
    adminEmail: !form.adminEmail ? 'Enter the administrator’s email.' : emailError(form.adminEmail) || '',
    officeEmail: form.officeEmail ? emailError(form.officeEmail) || '' : '',
  }
  const invalid = Object.values(errors).some(Boolean)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (invalid) return
    setBusy(true); setError('')
    try {
      const contact = Object.fromEntries(Object.entries({ officeEmail: form.officeEmail, officePhone: form.officePhone,
        city: form.city, state: form.state }).filter(([, v]) => v))
      const r = await platformApi.post('/firms', {
        name: form.name.trim(), slug: form.slug, adminName: form.adminName.trim(), adminEmail: form.adminEmail.trim(),
        planCode: form.planCode.trim(), contact, ...(testFirm ? { testFirm: true } : {}),
      }, { headers: { 'Idempotency-Key': key.current } })
      setResult(r.data)
    } catch (err) {
      setError(errorText(err, "Couldn't create the firm."))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const inv = result.invitation
    return (
      <div>
        <PageHead title="Firm created" sub={result.firm.name} />
        <Panel>
          <div className="stack">
            <p role="status">
              <b>{result.firm.name}</b> is <b>awaiting activation</b>. It becomes active when its administrator
              accepts the invitation and chooses a password.
            </p>
            {inv && (
              <p>
                Invitation to <b>{inv.email}</b>: {inv.deliveryStatus === 'FAILED'
                  ? <span className="bad">the email could not be sent ({inv.deliveryError}). Resend it from the firm page.</span>
                  : `${deliveryLabel(inv.deliveryStatus)}.`} Valid until {new Date(inv.expiresAt).toLocaleString()}.
              </p>
            )}
            <div className="row" style={{ gap: 8 }}>
              <Link className="btn primary" to={`/platform/firms/${result.firm.publicId}`}>Open firm</Link>
              <Link className="btn ghost" to="/platform/firms">Back to firms</Link>
            </div>
          </div>
        </Panel>
      </div>
    )
  }

  const err = (k: keyof typeof errors) => (tried ? errors[k] || null : null)
  return (
    <div>
      <PageHead title="Create firm" sub="Provision a new law firm and invite its first administrator." />
      <form className="stack" onSubmit={submit} noValidate style={{ maxWidth: 720 }}>
        {error && <div className="callout bad" role="alert">{error}</div>}
        <Panel title="Firm">
          <div className="form-grid">
            <TextField label="Firm name" required value={form.name} onChange={(e) => set('name', e.target.value)} error={err('name')} />
            <TextField label="Identifier (slug)" required value={form.slug} error={err('slug')}
              hint="Permanent, lowercase, used in operator screens."
              onChange={(e) => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()) }} />
            <SelectField label="Plan" value={form.planCode} onChange={(e) => set('planCode', e.target.value)}
              options={[{ value: '', label: 'Choose later (plan pending)' }, ...planOptions
                .map((p) => ({ value: p.code, label: p.assignable === 'yes' ? p.name : `${p.name} - ${p.state.toLowerCase()}, test only` }))]}
              hint={planOptions.length === 0 && !testFirm
                ? 'No plan has been approved and published yet. The firm can sign in but add nothing until a plan is assigned from its Subscription section.'
                : 'Without a plan the firm can sign in but add nothing until one is assigned from its Subscription section.'} />
            {testPlans && (
              <Check label="Synthetic test firm (may use unapproved plans; development / test installs only)"
                checked={testFirm} onChange={(e) => { setTestFirm(e.target.checked); set('planCode', '') }} />
            )}
          </div>
        </Panel>
        <Panel title="First administrator">
          <div className="form-grid">
            <TextField label="Name" value={form.adminName} onChange={(e) => set('adminName', e.target.value)} />
            <TextField label="Email" type="email" required value={form.adminEmail} error={err('adminEmail')}
              onChange={(e) => set('adminEmail', e.target.value)} hint="They receive a one-time invitation link." />
          </div>
        </Panel>
        <Panel title="Firm contact (optional)">
          <div className="form-grid">
            <TextField label="Office email" type="email" value={form.officeEmail} error={err('officeEmail')}
              onChange={(e) => set('officeEmail', e.target.value)} />
            <TextField label="Office phone" value={form.officePhone} onChange={(e) => set('officePhone', e.target.value)} />
            <TextField label="City" value={form.city} onChange={(e) => set('city', e.target.value)} />
            <TextField label="State" value={form.state} onChange={(e) => set('state', e.target.value)} />
          </div>
        </Panel>
        <div className="row" style={{ gap: 8 }}>
          <Button type="submit" variant="primary" loading={busy} disabled={busy}>Create firm and send invitation</Button>
          <Link className="btn ghost" to="/platform/firms">Cancel</Link>
        </div>
      </form>
    </div>
  )
}
