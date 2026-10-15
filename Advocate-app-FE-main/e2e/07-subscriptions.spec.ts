// Phase 8 in the browser, against the live E2E backend: an operator manages a
// firm's plan from /platform/firms/:id; the firm sees its plan on Plan & Usage;
// limits and an ended trial are enforced by the server with a clear message,
// and nothing is lost. Uses firm A (01) and firm C (03).
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { API, STATE_FILE } from './env'
import { apiLogin, bearer, freshCode, operatorLogin, py, state, uiLogin } from './helpers'

test.describe.configure({ mode: 'serial' })
const st = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
const firmUuid = (slug: string) => py(`from firms.models import Firm;print(Firm.objects.get(slug='${slug}').public_id)`)

test('the operator sees and changes a firm\'s plan from the firm page', async ({ page }) => {
  const op = state().operators.OWNER
  await page.goto('/platform/login')
  await page.getByLabel('Email').fill(op.email)
  await page.getByLabel('Password').fill(op.password)
  await page.getByLabel('Authenticator code').fill(await freshCode(op.seed))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/dashboard/)
  await page.goto(`/platform/firms/${firmUuid(st().firmA.slug)}`)
  const sub = page.getByRole('region', { name: 'Subscription' }).or(page.locator('section, .panel').filter({ hasText: 'AMS plan for this firm' })).first()
  await expect(sub).toContainText('Professional')
  await sub.getByRole('button', { name: 'Change plan' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Plan').selectOption('ENTERPRISE')
  await dialog.getByLabel(/Reason/).fill('E2E: customer upgraded')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(sub).toContainText('Enterprise')
  await sub.getByText(/Subscription history/).click()
  await expect(sub).toContainText('E2E: customer upgraded')
})

test('a case limit is enforced by the server with a clear message; data stays', async ({ page, request }) => {
  const a = st().firmA
  const op = await operatorLogin(request, state().operators.OWNER)
  const uuid = firmUuid(a.slug)
  const clients = Number(py(`from core.models import Client;from firms.models import Firm;print(Client.objects.filter(firm_id=Firm.objects.get(slug='${a.slug}').id, deleted=False).count())`))
  const r = await request.post(`${API}/api/platform/firms/${uuid}/subscription`, { headers: bearer(op),
    data: { action: 'set_override', key: 'clients.total', limit: clients, reason: 'E2E: cap clients at current count' } })
  expect(r.status(), await r.text()).toBe(200)

  await uiLogin(page, a.adminEmail, a.password)
  await page.goto('/dashboard/firm/subscription')
  await expect(page.getByRole('row', { name: /Clients/ })).toContainText(String(clients))
  await page.goto('/dashboard/clients')
  await page.getByRole('button', { name: 'Add client' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/^Name/).fill(`Over Limit ${st().run}`)
  await dialog.getByLabel(/^Email/).fill(`over-${st().run}@x.e2e.test`)
  await dialog.getByLabel(/^Mobile/).fill('9876501234')
  await page.getByRole('button', { name: 'Save client' }).click()
  await expect(page.getByText(/reached its clients limit/i).first()).toBeVisible()
  // Existing clients are still listed.
  const tok = await apiLogin(request, a.adminEmail, a.password)
  expect((await request.get(`${API}/api/clients/my-clients`, { headers: bearer(tok) })).status()).toBe(200)

  await request.post(`${API}/api/platform/firms/${uuid}/subscription`, { headers: bearer(op),
    data: { action: 'clear_override', key: 'clients.total', reason: 'E2E: done' } })
})

test('an ended trial makes the firm read-only, never deletes, and an extension restores it', async ({ request }) => {
  const op = await operatorLogin(request, state().operators.OWNER)
  const slug = `e2e-c-${st().run}`
  const uuid = firmUuid(slug)
  const sub = (body: Record<string, unknown>) => request.post(`${API}/api/platform/firms/${uuid}/subscription`,
    { headers: bearer(op), data: body })
  expect((await sub({ action: 'change_plan', planCode: 'TRIAL', status: 'TRIALING', reason: 'E2E trial' })).status()).toBe(200)
  py(`from subscriptions.models import FirmSubscription;from firms.models import Firm;import datetime
FirmSubscription.objects.filter(firm=Firm.objects.get(slug='${slug}')).update(trial_ends_at=datetime.datetime.now()-datetime.timedelta(minutes=1))`)
  const cTok = await apiLogin(request, `admin-${st().run}@c.e2e.test`, 'Firm#E2e-Pass2026')     // sign-in still works
  const before = await (await request.get(`${API}/api/cases/my-cases`, { headers: bearer(cTok) })).json()
  const blocked = await request.post(`${API}/api/clients/create`, { headers: bearer(cTok),
    data: { name: 'Blocked Client', email: `blocked-${st().run}@x.e2e.test`, phone: '9876500001' } })
  expect((await blocked.json()).code).toBe('ENTITLEMENT_SUBSCRIPTION_INACTIVE')
  const after = await (await request.get(`${API}/api/cases/my-cases`, { headers: bearer(cTok) })).json()
  expect(JSON.stringify(after)).toEqual(JSON.stringify(before))                               // nothing lost
  const ext = await sub({ action: 'extend_trial', days: 7, reason: 'E2E: more time' })
  expect((await ext.json()).status).toBe('TRIALING')
  const ok = await request.post(`${API}/api/clients/create`, { headers: bearer(cTok),
    data: { name: 'Now Allowed', email: `allowed-${st().run}@x.e2e.test`, phone: '9876500002' } })
  expect(ok.status(), await ok.text()).toBeLessThan(300)
  await sub({ action: 'change_plan', planCode: 'PROFESSIONAL', reason: 'E2E: restore' })
})

test('plans are unapproved drafts: shown as such, never given to a real firm, and only owners approve', async ({ page, request }) => {
  const op = await operatorLogin(request, state().operators.OWNER)
  const plans = await (await request.get(`${API}/api/platform/plans`, { headers: bearer(op) })).json()
  expect(plans.find((p: { code: string }) => p.code === 'PROFESSIONAL').state).toBe('DRAFT')
  expect(plans.every((p: { monthlyPrice: string | null }) => p.monthlyPrice === null)).toBe(true)
  // A real (non-test) firm: no plan unless one is published -> PENDING, adds nothing.
  const run = st().run
  const r = await request.post(`${API}/api/platform/firms`, { headers: { ...bearer(op), 'Idempotency-Key': `${run}-real` },
    data: { name: `Real Firm ${run}`, slug: `e2e-real-${run}`, adminEmail: `admin-${run}@real.e2e.test`, planCode: 'PROFESSIONAL' } })
  expect((await r.json()).code).toBe('PLAN_NOT_PUBLISHED')
  const ok = await request.post(`${API}/api/platform/firms`, { headers: { ...bearer(op), 'Idempotency-Key': `${run}-real2` },
    data: { name: `Real Firm ${run}`, slug: `e2e-real-${run}`, adminEmail: `admin-${run}@real.e2e.test` } })
  expect(ok.status(), await ok.text()).toBe(201)
  const realUuid = (await ok.json()).firm.publicId
  const sub = await (await request.get(`${API}/api/platform/firms/${realUuid}/subscription`, { headers: bearer(op) })).json()
  expect(sub.readOnly).toBe(true)
  expect(sub.status).toBe('PENDING')
  const assign = await request.post(`${API}/api/platform/firms/${realUuid}/subscription`, { headers: bearer(op),
    data: { action: 'change_plan', planCode: 'ENTERPRISE', reason: 'should be refused' } })
  expect((await assign.json()).code).toBe('PLAN_NOT_PUBLISHED')
  // Operators below owner can read plans but not approve them.
  const support = await operatorLogin(request, state().operators.READONLY)
  expect((await request.post(`${API}/api/platform/plans/BASIC`, { headers: bearer(support),
    data: { action: 'approve', reason: 'not mine to approve' } })).status()).toBe(403)
  // The Plans screen says so plainly.
  const owner = state().operators.OWNER
  await page.goto('/platform/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(owner.password)
  await page.getByLabel('Authenticator code').fill(await freshCode(owner.seed))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/dashboard/)
  await page.getByRole('link', { name: 'Plans' }).click()
  await expect(page.getByText(/No plan is approved and published yet/)).toBeVisible()
  await page.goto(`/platform/firms/${realUuid}`)
  await expect(page.getByText(/No plan yet: the firm can sign in/)).toBeVisible()
})

test('a Lisa request key cannot be reused for free', async ({ request }) => {
  const a = st().firmA
  const tok = await apiLogin(request, a.adminEmail, a.password)
  const key = `lisa-${st().run}`
  const first = await request.post(`${API}/api/assistant/chat`, { headers: { ...bearer(tok), 'Idempotency-Key': key },
    data: { message: 'hello' } })
  expect(first.status()).toBe(200)
  await first.body()
  const again = await request.post(`${API}/api/assistant/chat`, { headers: { ...bearer(tok), 'Idempotency-Key': key },
    data: { message: 'hello' } })
  expect(again.status()).toBe(409)
  expect((await again.json()).code).toBe('IDEMPOTENCY_KEY_USED')
})

test('a firm can read its plan but not change it; operators below owner cannot change it', async ({ request }) => {
  const a = st().firmA
  const tok = await apiLogin(request, a.adminEmail, a.password)
  expect((await request.get(`${API}/api/firm/subscription`, { headers: bearer(tok) })).status()).toBe(200)
  expect((await request.post(`${API}/api/firm/subscription`, { headers: bearer(tok), data: { planCode: 'ENTERPRISE' } })).status()).toBe(405)
  const junior = await apiLogin(request, a.staffEmail, a.password)
  expect((await request.get(`${API}/api/firm/subscription`, { headers: bearer(junior) })).status()).toBe(403)
  const ro = await operatorLogin(request, state().operators.READONLY)
  const r = await request.post(`${API}/api/platform/firms/${firmUuid(a.slug)}/subscription`, { headers: bearer(ro),
    data: { action: 'change_plan', planCode: 'TRIAL', reason: 'should be refused' } })
  expect(r.status()).toBe(403)
})
