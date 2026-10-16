// A firm's day-to-day work, against the real backend (database pactpro_e2e):
// client (browser form) -> case -> hearing -> document upload (browser),
// preview + download link -> invoice -> part payment (browser) -> final
// payment -> balances -> notifications delivered to the right people ->
// Lisa answers through the local AI stand-in -> client portal -> logout.
// Setup steps that need custom select widgets go through the same API the
// pages call, signed in as the firm administrator.
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { API, LLM_STUB, STATE_FILE } from './env'
import { apiLogin, bearer, manage, py, uiLogin, waitForMail } from './helpers'

test.describe.configure({ mode: 'serial' })

const firm = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')).firmA as
  { adminEmail: string; password: string; staffEmail: string }
let token = ''
let clientId = 0
let caseId = 0
let invoiceId = 0
const run = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')).run as string

async function api(request: APIRequestContext, method: 'get' | 'post' | 'put', url: string, data?: unknown) {
  const r = await request[method](`${API}${url}`, { headers: bearer(token), data })
  return r
}

test.beforeAll(async ({ request }) => {
  token = await apiLogin(request, firm().adminEmail, firm().password)
})

test('add a client through the form', async ({ page, request }) => {
  await uiLogin(page, firm().adminEmail, firm().password)
  await page.goto('/dashboard/clients')
  await page.getByRole('button', { name: 'Add client' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/^Name/).fill(`Meena Traders ${run()}`)
  await dialog.getByLabel(/^Email/).fill(`client-${run()}@meena.e2e.test`)
  await dialog.getByLabel(/^Mobile/).fill('9876543210')
  // Bad GSTIN first: refused in the form.
  await dialog.getByLabel(/^GSTIN/).fill('33ABC')
  await page.getByRole('button', { name: 'Save client' }).click()
  await expect(dialog.getByText(/GSTIN/).last()).toBeVisible()
  await dialog.getByLabel(/^GSTIN/).fill('')
  await page.getByRole('button', { name: 'Save client' }).click()
  await expect(page.getByText(`Meena Traders ${run()}`)).toBeVisible()
  const list = await (await api(request, 'get', '/api/clients/my-clients')).json()
  const rows = Array.isArray(list) ? list : (list.content || list.results || [])
  clientId = rows.find((c: { name: string }) => c.name === `Meena Traders ${run()}`).id
  expect(clientId).toBeGreaterThan(0)
})

test('open a case with a hearing; it shows on the case list and calendar', async ({ page, request }) => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const c = await api(request, 'post', '/api/cases/create', {
    caseNumber: `OS/${run()}/2026`, caseTitle: `Meena Traders v Kumar ${run()}`, caseType: 'OS',
    courtLevel: 'District', status: 'Active', amount: 50000, clientId, matterType: 'litigation',
  })
  expect(c.status(), await c.text()).toBeLessThan(300)
  caseId = (await c.json()).id
  const ev = await api(request, 'post', '/api/events/create', {
    caseId, title: 'Hearing - written statement', eventType: 'HEARING', date: tomorrow, time: '10:30',
  })
  expect(ev.status(), await ev.text()).toBeLessThan(300)
  await uiLogin(page, firm().adminEmail, firm().password)
  await page.goto('/dashboard/cases')
  await expect(page.getByText(`Meena Traders v Kumar ${run()}`)).toBeVisible()
  await page.goto(`/dashboard/cases/${caseId}`)
  await expect(page.getByText(`OS/${run()}/2026`).first()).toBeVisible()
  await page.goto('/dashboard/hearings')
  await expect(page.getByText(/written statement/).first()).toBeVisible()
})

test('upload a document in the browser; preview and download use signed links', async ({ page, request }) => {
  await uiLogin(page, firm().adminEmail, firm().password)
  await page.goto('/dashboard/documents')
  const file = path.join(path.dirname(STATE_FILE), `plaint-${run()}.pdf`)
  fs.writeFileSync(file, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
  const upload = page.getByRole('button', { name: /Upload/ }).first()
  await upload.click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type=file]').setInputFiles(file)
  await dialog.getByRole('button', { name: /^Upload/ }).click()
  // The file name shows in the dialog before the upload finishes: wait for the result.
  await expect(dialog.getByText('1/1 uploaded')).toBeVisible({ timeout: 30_000 })
  const docs = await (await api(request, 'get', '/api/documents/list')).json()
  const doc = (Array.isArray(docs) ? docs : docs.content || docs.results).find((d: { originalName?: string; documentName?: string }) =>
    (d.originalName || d.documentName || '').includes(run()))
  // A link is signed, short-lived, and bound to its purpose.
  const link = await api(request, 'post', `/api/documents/${doc.id}/link`, { purpose: 'download' })
  expect(link.status()).toBe(200)
  const { url } = await link.json()
  const got = await request.get(url.startsWith('http') ? url : `${API}${url}`)
  expect(got.status()).toBe(200)
  expect((await got.body()).toString()).toContain('%PDF')
  // The bare file URL without a link is refused.
  expect((await request.get(`${API}/api/documents/download/${doc.id}`)).status()).toBeGreaterThanOrEqual(401)
})

test('invoice -> part payment in the browser -> final payment -> paid, balances right', async ({ page, request }) => {
  const inv = await api(request, 'post', '/api/invoices/create', {
    caseId, particulars: [{ description: 'Drafting written statement', amount: '30000' },
      { description: 'Appearance', amount: '5000.50' }],
  })
  expect(inv.status(), await inv.text()).toBe(201)
  const body = await inv.json()
  invoiceId = body.id
  expect(body.invoiceNumber).toMatch(/^INV-\d{6}$/)

  await uiLogin(page, firm().adminEmail, firm().password)
  await page.goto('/dashboard/invoices')
  const row = page.getByRole('row', { name: new RegExp(body.invoiceNumber) })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: /Record payment|Payment/ }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Amount/).fill('10000')
  await dialog.getByRole('button', { name: /Record|Save/ }).last().click()
  await expect(page.getByText('Part-payment recorded.')).toBeVisible()

  const final = await api(request, 'post', '/api/payments/create', { invoiceId, amount: '25000.50', paymentMode: 'UPI', referenceNumber: `UTR${run()}` })
  expect(final.status(), await final.text()).toBe(201)
  const over = await api(request, 'post', '/api/payments/create', { invoiceId, amount: '1' })
  expect(over.status()).toBe(409)
  const after = (await (await api(request, 'get', '/api/invoices/my-invoices')).json())
    .find((i: { id: number }) => i.id === invoiceId)
  expect(after.status).toBe('PAID')
  expect(Number(after.balance ?? 0)).toBe(0)
  const caseRow = JSON.parse(py(`from core.models import Case;import json;c=Case.objects.get(id=${caseId});print(json.dumps([c.total_paid_by_client,c.pending_from_client]))`))
  expect(caseRow).toEqual([35000.5, 14999.5])                    // agreed fee 50,000 - paid 35,000.50
})

test('reminders: queued once for the right firm, processed once, shown in the bell', async ({ page }) => {
  manage('scan_notifications')
  manage('scan_notifications')                                    // a second scan must not duplicate
  // Every reminder about THIS case: who received it, and are they all members of this firm?
  const counts = JSON.parse(py(`import json
from core.models import NotificationQueue, Case
from firms.models import FirmMembership
case = Case.objects.get(id=${caseId})
members = set(FirmMembership.objects.filter(firm_id=case.firm_id, status='ACTIVE').values_list('advocate_id', flat=True))
rows = [r for r in NotificationQueue.objects.filter(type='HEARING_REMINDER', payload_json__contains='"channel": "IN_APP"')
        if json.loads(r.payload_json).get('caseId') == case.id]
print(json.dumps({'mine': sum(r.advocate_id in members for r in rows), 'others': sum(r.advocate_id not in members for r in rows),
                  'perPerson': max([sum(x.advocate_id == r.advocate_id for x in rows) for r in rows] or [0])}))`))
  expect(counts.perPerson).toBe(1)                                // once each, despite two scans
  expect(counts.mine).toBeGreaterThanOrEqual(1)
  expect(counts.others).toBe(0)
  const before = Number(py(`from core.models import Notification;print(Notification.objects.filter(case_id=${caseId}).count())`))
  manage('process_notifications')
  manage('process_notifications')                                 // a second drain sends nothing again
  const after = Number(py(`from core.models import Notification;print(Notification.objects.filter(case_id=${caseId}).count())`))
  expect(after - before).toBe(counts.mine)
  await uiLogin(page, firm().adminEmail, firm().password)
  await page.getByRole('button', { name: /Notifications/ }).first().click()
  await expect(page.getByText(new RegExp(`Hearing .*OS/${run()}/2026`)).first()).toBeVisible()
})

test('Lisa answers through the local AI stand-in (no real provider)', async ({ page, request }) => {
  const before = (await (await request.get(`${LLM_STUB}/__stats`)).json()).requests
  await uiLogin(page, firm().adminEmail, firm().password)
  await page.getByRole('button', { name: /Ask Lisa/ }).click()
  const box = page.getByRole('textbox').last()
  await box.fill('Summarise my hearings this week')
  await box.press('Enter')
  await expect(page.getByText(/\[E2E stub\]/).first()).toBeVisible({ timeout: 45_000 })
  const after = (await (await request.get(`${LLM_STUB}/__stats`)).json()).requests
  expect(after).toBeGreaterThan(before)
})

test('client portal: invited client sets a password and sees only their own matter', async ({ page, request }) => {
  const email = `client-${run()}@meena.e2e.test`
  const r = await api(request, 'post', `/api/clients/${clientId}/logins`, { email, fullName: 'Meena' })
  expect(r.status(), await r.text()).toBeLessThan(300)
  const mail = await waitForMail(email, 'set-password')
  // The invite opens the portal's own page with the firm's signed key (?f=, for its
  // name and logo) before the one-time token (clientaccess.views.portal_url).
  const link = mail.replace(/=\r?\n/g, '').match(/http:\/\/localhost:5180\/client\/set-password\?f=[^&\s"'<>]+&token=[A-Za-z0-9_-]+/)![0]
  await page.goto(link)
  await page.getByLabel(/New password/).fill('Meena#Portal2026')
  await page.getByLabel(/Confirm password/).fill('Meena#Portal2026')
  await page.locator('button[type=submit]').click()
  // The set-password page is itself under /client/, so wait until it has been
  // left for the portal (the password is saved by then).
  await expect(page).not.toHaveURL(/set-password/)
  await expect(page).toHaveURL(/\/client(\/|\?|$)/)
  const ct = await apiLogin(request, email, 'Meena#Portal2026')
  const cases = await (await request.get(`${API}/api/client/cases`, { headers: bearer(ct) })).json()
  expect(JSON.stringify(cases)).toContain(`OS/${run()}/2026`)
  // A client token is not a firm token.
  expect((await request.get(`${API}/api/cases/my-cases`, { headers: bearer(ct) })).status()).toBeGreaterThanOrEqual(401)
  const invs = await (await request.get(`${API}/api/client/invoices`, { headers: bearer(ct) })).json()
  expect(JSON.stringify(invs)).toContain('PAID')
})

test('logout ends the session on the server, not just in the browser', async ({ page, request }) => {
  const t = await apiLogin(request, firm().adminEmail, firm().password)
  await uiLogin(page, firm().adminEmail, firm().password)
  const stored = await page.evaluate(() => localStorage.getItem('token'))
  await page.getByRole('button', { name: /Asha/ }).first().click()
  await page.getByRole('menuitem', { name: /Sign out|Log out/ }).click()
  await expect(page).toHaveURL(/login|\/$/)
  for (const tok of [stored, t]) {
    expect((await request.get(`${API}/api/cases/my-cases`, { headers: bearer(tok!) })).status()).toBe(401)
  }
  token = await apiLogin(request, firm().adminEmail, firm().password)
})
