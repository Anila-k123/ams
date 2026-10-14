// Reliability against the live E2E backend: retried / simultaneous money
// operations, two queue processors at once, a crashed processor's work
// recovered, failed uploads leave nothing behind.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { API, BE_DIR, PYTHON, STATE_FILE, UPLOAD_DIR, backendEnv } from './env'
import { apiLogin, bearer, manage, py } from './helpers'

test.describe.configure({ mode: 'serial' })
const st = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
const run = promisify(execFile)

async function freshInvoice(request: import('@playwright/test').APIRequestContext, tok: string) {
  const caseId = Number(py(`from core.models import Case, Advocate;a=Advocate.objects.get(email='${st().firmA.adminEmail}');print(Case.objects.filter(firm_id=Case.objects.filter(advocate_id=a.id).first().firm_id).first().id)`))
  const r = await request.post(`${API}/api/invoices/create`, { headers: bearer(tok), data: { caseId, particulars: [{ description: 'Fee', amount: '1000' }] } })
  expect(r.status(), await r.text()).toBe(201)
  return (await r.json()).id as number
}

test('the same payment sent 5 times at once (one key) is recorded once', async ({ request }) => {
  const tok = await apiLogin(request, st().firmA.adminEmail, st().firmA.password)
  const inv = await freshInvoice(request, tok)
  const key = `e2e-${Date.now()}`
  const rs = await Promise.all([0, 1, 2, 3, 4].map(() => request.post(`${API}/api/payments/create`, {
    headers: { ...bearer(tok), 'Idempotency-Key': key }, data: { invoiceId: inv, amount: '250' } })))
  const ids = new Set(await Promise.all(rs.filter((r) => r.status() < 300).map(async (r) => (await r.json()).id)))
  expect(ids.size).toBe(1)
  expect(py(`from invoices.models import PaymentInvoice;print(PaymentInvoice.objects.filter(invoice_id=${inv}).count())`)).toBe('1')
})

test('simultaneous payments never exceed the invoice', async ({ request }) => {
  const tok = await apiLogin(request, st().firmA.adminEmail, st().firmA.password)
  const inv = await freshInvoice(request, tok)
  const rs = await Promise.all([0, 1, 2, 3].map(() => request.post(`${API}/api/payments/create`, {
    headers: bearer(tok), data: { invoiceId: inv, amount: '400' } })))
  expect(rs.filter((r) => r.status() === 201)).toHaveLength(2)                // 800 of 1000 fits, a third would not
  const paid = Number(py(`from core.finance import invoice_paid_amounts;print(invoice_paid_amounts([${inv}]).get(${inv}, 0))`))
  expect(paid).toBeLessThanOrEqual(1000)
})

test('simultaneous invoices in one firm get distinct numbers', async ({ request }) => {
  const tok = await apiLogin(request, st().firmA.adminEmail, st().firmA.password)
  const caseId = Number(py(`from core.models import Case, Advocate;a=Advocate.objects.get(email='${st().firmA.adminEmail}');print(Case.objects.filter(advocate_id=a.id).first().id)`))
  const rs = await Promise.all(Array.from({ length: 6 }, () => request.post(`${API}/api/invoices/create`, {
    headers: bearer(tok), data: { caseId, particulars: [{ description: 'Fee', amount: '10' }] } })))
  expect(rs.every((r) => r.status() === 201)).toBe(true)
  const nums = await Promise.all(rs.map(async (r) => (await r.json()).invoiceNumber))
  expect(new Set(nums).size).toBe(6)
})

test('two queue processors at once deliver each notification once', async () => {
  const marker = `dup-${Date.now()}`
  py(`from core.models import Advocate
from notifications import service
a = Advocate.objects.get(email='${st().firmA.adminEmail}')
for i in range(15):
    service.notify(a.id, 'HEARING_REMINDER', '${marker} %d' % i, 'b')`)
  const env = { ...process.env, ...backendEnv }
  await Promise.all([0, 1, 2].map(() => run(PYTHON, ['manage.py', 'process_notifications'], { cwd: BE_DIR, env })))
  const n = py(`from core.models import Notification;print(Notification.objects.filter(message__startswith='${marker}').count())`)
  expect(n).toBe('15')
})

test('work claimed by a processor that died is recovered on the next run', async () => {
  const marker = `crash-${Date.now()}`
  py(`import datetime
from django.utils import timezone
from core.models import Advocate, NotificationQueue
from notifications import service
a = Advocate.objects.get(email='${st().firmA.adminEmail}')
ids = service.notify(a.id, 'HEARING_REMINDER', '${marker}', 'b')
NotificationQueue.objects.filter(id__in=ids).update(status='PROCESSING', processing_started_at=timezone.now() - datetime.timedelta(hours=1))`)
  manage('process_notifications')
  expect(py(`from core.models import Notification;print(Notification.objects.filter(message='${marker}').count())`)).toBe('1')
  expect(manage('job_status', '--job', 'process_notifications', '--limit', '3')).toMatch(/SUCCEEDED/)
})

test('a refused upload leaves no file behind', async ({ request }) => {
  const tok = await apiLogin(request, st().firmA.adminEmail, st().firmA.password)
  const dir = path.join(UPLOAD_DIR, 'documents')
  const before = new Set(fs.readdirSync(dir))
  for (const [name, type] of [['evil.html', 'text/html'], ['run.exe', 'application/octet-stream'], ['../../x.pdf.svg', 'image/svg+xml']]) {
    const r = await request.post(`${API}/api/documents/upload`, { headers: bearer(tok), multipart: {
      file: { name, mimeType: type, buffer: Buffer.from('<script>alert(1)</script>') } } })
    expect(r.status(), name).toBe(400)
  }
  const after = fs.readdirSync(dir).filter((f) => !before.has(f))
  expect(after).toEqual([])
  expect(fs.readdirSync(dir).some((f) => f.endsWith('.part'))).toBe(false)
})
