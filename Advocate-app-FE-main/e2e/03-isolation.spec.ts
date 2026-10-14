// Three firms. Firm B's records all carry a secret marker. Firm A's admin and
// junior, a platform operator and firm A's client then call EVERY API route
// with B's ids (idor_sweep.py); no response may contain the marker and B's
// data must be exactly as before. Plus token-audience checks and a UI check.
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { API, STATE_FILE } from './env'
import { apiLogin, bearer, inviteLink, operatorLogin, py, state, uiLogin, waitForMail, manage } from './helpers'

test.describe.configure({ mode: 'serial' })

const st = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
const PASSWORD = 'Firm#E2e-Pass2026'
type Firm = { key: string; marker: string; token: string; email: string; uuid: string; ids: Record<string, number> }
const firms: Record<string, Firm> = {}

async function provision(request: APIRequestContext, key: string): Promise<Firm> {
  const run = st().run
  const op = await operatorLogin(request, state().operators.OWNER)
  const email = `admin-${run}@${key.toLowerCase()}.e2e.test`
  const r = await request.post(`${API}/api/platform/firms`, {
    headers: { ...bearer(op), 'Idempotency-Key': `${run}-${key}` },
    data: { name: `Firm ${key} ${run}`, slug: `e2e-${key.toLowerCase()}-${run}`, adminEmail: email, adminName: `Admin ${key}` },
  })
  expect(r.status(), await r.text()).toBe(201)
  const uuid = (await r.json()).firm.publicId
  const token = inviteLink(await waitForMail(email)).split('token=')[1]
  const acc = await request.post(`${API}/api/invitations/accept`, { data: { token, password: PASSWORD, fullName: `Admin ${key}` } })
  expect(acc.status(), await acc.text()).toBe(200)
  return { key, marker: `SECRET-${key}-${run}`, token: await apiLogin(request, email, PASSWORD), email, uuid, ids: {} }
}

async function fill(request: APIRequestContext, f: Firm) {
  const h = bearer(f.token)
  const post = async (url: string, data: unknown) => {
    const r = await request.post(`${API}${url}`, { headers: h, data })
    expect(r.status(), `${url}: ${await r.text()}`).toBeLessThan(300)
    return r.json()
  }
  const client = await post('/api/clients/create', { name: `Client ${f.marker}`, email: `c-${f.marker.toLowerCase()}@x.e2e.test`, phone: '9876500000' })
  const caseRow = await post('/api/cases/create', { caseNumber: `CS/${f.marker}`, caseTitle: `Matter ${f.marker}`, caseType: 'CS',
    courtLevel: 'District', status: 'Active', clientId: client.id, matterType: 'litigation', amount: 1000, description: f.marker })
  const event = await post('/api/events/create', { caseId: caseRow.id, title: `Hearing ${f.marker}`, eventType: 'HEARING',
    date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) })
  const up = await request.post(`${API}/api/documents/upload`, { headers: h, multipart: {
    caseId: String(caseRow.id), documentName: `Doc ${f.marker}`,
    file: { name: `doc-${f.marker}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4 ${f.marker}`) } } })
  expect(up.status(), await up.text()).toBeLessThan(300)
  const doc = await up.json()
  const inv = await post('/api/invoices/create', { caseId: caseRow.id, particulars: [{ description: `Fee ${f.marker}`, amount: '500' }] })
  const pay = await post('/api/payments/create', { invoiceId: inv.id, amount: '100', referenceNumber: `REF-${f.marker}`, description: f.marker })
  const staff = await post('/api/firm/invitations', { email: `staff-${f.marker.toLowerCase()}@x.e2e.test`, roleIds: [], fullName: f.marker })
    .catch(() => null)
  void staff
  // Drafting, a task and a note made directly (their creation flows need the AI pipeline).
  const extra = JSON.parse(py(`import json
from core.models import Advocate, Case
from drafting.models import Template, DraftSession, DraftBlock
from workspace.models import CaseTask
adv = Advocate.objects.get(email='${f.email}')
case = Case.objects.get(id=${caseRow.id})
t = Template.objects.create(name='Tpl ${f.marker}', created_by_id=adv.id)
s = DraftSession.objects.create(template=t, created_by_id=adv.id, facts={'note': '${f.marker}'}, status='ready')
DraftBlock.objects.create(session=s, position=0, block_type='clause', text='Clause ${f.marker}', source='generated')
task = CaseTask.objects.create(case_id=case.id, advocate_id=adv.id, title='Task ${f.marker}', priority='HIGH')
from core.models import Role
role = Role.objects.filter(firm_id=case.firm_id).order_by('id').first()
# Acts are shared by all firms; a link from one to B's case must stay B's.
import datetime
from acts.models import Act, ActCaseLink
act = Act.objects.create(title='E2E Act ${f.marker}'.replace('${f.marker}', 'shared'), source_state_name='CENTRAL',
                         source_uuid='e2e-${f.marker}', created_at=datetime.datetime.now(), last_synced_at=datetime.datetime.now())
ActCaseLink.objects.create(act=act, case_id=case.id, advocate_id=adv.id)
print(json.dumps({'template': t.id, 'draft': s.id, 'task': task.id, 'role': role.id, 'advocate': adv.id, 'act': act.id}))`))
  f.ids = { client: client.id, case: caseRow.id, event: event.id, doc: doc.id, invoice: inv.id, payment: pay.id, ...extra }
}

function fingerprint(f: Firm) {
  return py(`import json
from core.models import Case, Client, Document, Invoice, ClientPayment, CaseEvent, Role, RolePermission, AuditLog
from firms.models import Firm, FirmMembership
from drafting.models import DraftSession, DraftBlock
firm = Firm.objects.get(public_id='${f.uuid}')
print(json.dumps({
 'firm': [firm.status, firm.name],
 'cases': list(Case.objects.filter(firm_id=firm.id).order_by('id').values_list('id', 'case_title', 'status', 'deleted')),
 'clients': list(Client.objects.filter(firm_id=firm.id).order_by('id').values_list('id', 'name', 'deleted')),
 'docs': list(Document.objects.filter(firm_id=firm.id).order_by('id').values_list('id', 'document_name', 'version', 'status')),
 'invoices': list(Invoice.objects.filter(firm_id=firm.id).order_by('id').values_list('id', 'invoice_number', 'status', 'amount')),
 'payments': list(ClientPayment.objects.filter(firm_id=firm.id).order_by('id').values_list('id', 'amount')),
 'events': list(CaseEvent.objects.filter(firm_id=firm.id).order_by('id').values_list('id', 'title', 'date')),
 'roles': [(r.id, r.name, r.disabled, sorted(RolePermission.objects.filter(role_id=r.id).values_list('permission_id', flat=True))) for r in Role.objects.filter(firm_id=firm.id).order_by('id')],
 'members': list(FirmMembership.objects.filter(firm=firm).order_by('id').values_list('advocate_id', 'status', 'kind')),
 'drafts': list(DraftBlock.objects.filter(session_id=${f.ids.draft}).values_list('id', 'text')),
 'actLinks': list(__import__('acts.models', fromlist=['ActCaseLink']).ActCaseLink.objects.filter(case_id__in=Case.objects.filter(firm_id=firm.id).values('id')).values_list('id', 'act_id', 'case_id')),
}, default=str))`)
}

test('firms B and C are onboarded and filled with marked records', async ({ request }) => {
  for (const key of ['B', 'C']) {
    firms[key] = await provision(request, key)
    await fill(request, firms[key])
  }
  expect(firms.B.ids.case).toBeGreaterThan(0)
})

test('IDOR sweep: no caller from outside firm B sees or changes B\'s records', async ({ request }) => {
  test.skip(!!process.env.E2E_QUICK, 'E2E_QUICK=1: the full sweep (~35 min) is skipped')
  test.setTimeout(60 * 60_000)
  const a = st().firmA
  const B = firms.B
  const tokens = {
    firmA_admin: await apiLogin(request, a.adminEmail, a.password),
    firmA_junior: await apiLogin(request, a.staffEmail, a.password),
    firmC_admin: firms.C.token,
    platform_owner: await operatorLogin(request, state().operators.OWNER),
    firmA_client: await apiLogin(request, `client-${st().run}@meena.e2e.test`, 'Meena#Portal2026'),
  }
  const before = fingerprint(B)
  const dir = path.dirname(STATE_FILE)
  const inFile = path.join(dir, 'sweep-in.json')
  const outFile = path.join(dir, 'sweep-out.json')
  const storedName = py(`from core.models import Document;print(Document.objects.get(id=${B.ids.doc}).stored_name)`)
  fs.writeFileSync(inFile, JSON.stringify({
    marker: B.marker, tokens, mutators: ['firmA_admin', 'firmC_admin'],
    ids: { numeric: Object.values(B.ids), firmUuid: B.uuid, storedName },
  }))
  const out = manage('shell', '-c', `import os;os.environ['E2E_SWEEP_IN']=r'${inFile}';os.environ['E2E_SWEEP_OUT']=r'${outFile}';exec(open(r'${path.join(dir, '..', 'idor_sweep.py')}',encoding='utf-8').read())`)
  expect(out).toContain('SWEEP_DONE')
  const res = JSON.parse(fs.readFileSync(outFile, 'utf-8'))
  test.info().annotations.push({ type: 'sweep', description: `${res.calls} calls; by caller ${JSON.stringify(res.byCaller)}` })
  fs.writeFileSync(path.join(dir, 'sweep-mutations-2xx.json'), JSON.stringify(res.mutations2xx, null, 1))
  expect(res.leaks, JSON.stringify(res.leaks.slice(0, 5), null, 1)).toEqual([])
  expect(fingerprint(B)).toEqual(before)
  fs.rmSync(inFile)
})

test('tokens only work on their own API', async ({ request }) => {
  const a = st().firmA
  const firmTok = await apiLogin(request, a.adminEmail, a.password)
  const opTok = await operatorLogin(request, state().operators.OWNER)
  expect((await request.get(`${API}/api/platform/firms`, { headers: bearer(firmTok) })).status()).toBe(401)
  expect((await request.get(`${API}/api/cases/my-cases`, { headers: bearer(opTok) })).status()).toBe(401)
  expect((await request.get(`${API}/api/platform/firms`, { headers: bearer(opTok) })).status()).toBe(200)
})

test('in the browser, firm A opening firm B\'s case or document by id sees nothing of it', async ({ page }) => {
  const a = st().firmA
  await uiLogin(page, a.adminEmail, a.password)
  for (const url of [`/dashboard/cases/${firms.B.ids.case}`, `/dashboard/documents?doc=${firms.B.ids.doc}`, `/draft/${firms.B.ids.draft}`]) {
    await page.goto(url)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText(firms.B.marker)
  }
})
