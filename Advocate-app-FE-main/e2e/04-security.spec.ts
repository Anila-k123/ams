// Authentication, sessions, RBAC and platform security against the live E2E
// backend. Uses firm A (01), its junior, and firms B/C from 03.
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { API, APP, STATE_FILE } from './env'
import { apiLogin, bearer, freshCode, inviteLink, operatorLogin, py, state, totpAt, waitForMail } from './helpers'

test.describe.configure({ mode: 'serial' })
const st = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
const ok = (n: number) => n >= 200 && n < 300

test.describe('platform operators', () => {
  test('a TOTP code works once; a replay is refused', async ({ request }) => {
    const op = state().operators.OWNER
    const code = await freshCode(op.seed)
    const body = { email: op.email, password: op.password, otp: code }
    expect((await request.post(`${API}/api/platform/auth/login`, { data: body })).status()).toBe(200)
    expect((await request.post(`${API}/api/platform/auth/login`, { data: body })).status()).toBe(401)
  })

  test('password alone, or a wrong code, is not enough', async ({ request }) => {
    const op = state().operators.OWNER
    expect((await request.post(`${API}/api/platform/auth/login`, { data: { email: op.email, password: op.password } })).status()).toBe(401)
    const wrong = totpAt(op.seed, Math.floor(Date.now() / 30_000) + 5)       // a code far outside the window
    expect((await request.post(`${API}/api/platform/auth/login`, { data: { email: op.email, password: op.password, otp: wrong } })).status()).toBe(401)
  })

  test('a READONLY operator can read but not change firms', async ({ request }) => {
    const t = await operatorLogin(request, state().operators.READONLY)
    expect((await request.get(`${API}/api/platform/firms`, { headers: bearer(t) })).status()).toBe(200)
    const create = await request.post(`${API}/api/platform/firms`, { headers: bearer(t), data: { name: 'x', slug: `ro-${st().run}`, adminEmail: 'ro@x.e2e.test' } })
    expect(create.status()).toBe(403)
    const firms = await (await request.get(`${API}/api/platform/firms`, { headers: bearer(t) })).json()
    const anyFirm = firms[0].publicId
    expect((await request.post(`${API}/api/platform/firms/${anyFirm}/suspend`, { headers: bearer(t), data: { reason: 'x' } })).status()).toBe(403)
    expect((await request.patch(`${API}/api/platform/firms/${anyFirm}`, { headers: bearer(t), data: { planCode: 'x' } })).status()).toBe(403)
  })

  test('a disabled operator cannot sign in', async ({ request }) => {
    const op = state().operators.SUPPORT                     // seeded inactive
    const r = await request.post(`${API}/api/platform/auth/login`, { data: { email: op.email, password: op.password, otp: await freshCode(op.seed) } })
    expect(r.status()).toBe(401)
  })

  test('an operator sees counts, never a firm\'s legal records', async ({ request }) => {
    const t = await operatorLogin(request, state().operators.OWNER)
    const firms = await (await request.get(`${API}/api/platform/firms`, { headers: bearer(t) })).json()
    const blob = JSON.stringify(await Promise.all(firms.slice(0, 10).map(async (f: { publicId: string }) => [
      await (await request.get(`${API}/api/platform/firms/${f.publicId}`, { headers: bearer(t) })).json(),
      await (await request.get(`${API}/api/platform/firms/${f.publicId}/usage`, { headers: bearer(t) })).json(),
    ])))
    expect(blob).not.toMatch(/SECRET-|Meena Traders|Matter |written statement/)
  })
})

test.describe('firm sessions', () => {
  test('password reset ends every existing session', async ({ request }) => {
    const email = `reset-${st().run}@alpha.e2e.test`
    const pw = 'Reset#E2e-Pass2026'
    // A fresh member of firm A, so other tests keep their passwords.
    const adminTok = await apiLogin(request, st().firmA.adminEmail, st().firmA.password)
    const roles = await (await request.get(`${API}/api/roles`, { headers: bearer(adminTok) })).json()
    const junior = roles.find((r: { name: string }) => r.name === 'Advocate')
    expect((await request.post(`${API}/api/firm/invitations`, { headers: bearer(adminTok), data: { email, roleIds: [junior.id] } })).status()).toBe(201)
    const token = inviteLink(await waitForMail(email)).split('token=')[1]
    expect((await request.post(`${API}/api/invitations/accept`, { data: { token, password: pw } })).status()).toBe(200)
    const old = await apiLogin(request, email, pw)
    expect((await request.post(`${API}/api/auth/forgot-password`, { data: { email } })).status()).toBeLessThan(300)
    const mail = await waitForMail(email, 'Your OTP is')
    const otp = mail.match(/Your OTP is (\d{6})/)![1]
    const r = await request.post(`${API}/api/auth/reset-password`, { data: { email, otp, newPassword: 'Reset#E2e-New2026' } })
    expect(r.status(), await r.text()).toBe(200)
    expect((await request.get(`${API}/api/cases/my-cases`, { headers: bearer(old) })).status()).toBe(401)
    expect((await request.post(`${API}/api/advocates/login`, { data: { email, password: pw } })).status()).toBe(401)
    await apiLogin(request, email, 'Reset#E2e-New2026')
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...st(), resetUser: { email, password: 'Reset#E2e-New2026' } }, null, 2))
  })

  test('suspending a member ends their session at once; reactivating restores access', async ({ request }) => {
    const adminTok = await apiLogin(request, st().firmA.adminEmail, st().firmA.password)
    const u = st().resetUser
    const userTok = await apiLogin(request, u.email, u.password)
    const id = Number(py(`from core.models import Advocate;print(Advocate.objects.get(email='${u.email}').id)`))
    expect((await request.post(`${API}/api/firm/members/${id}/suspend`, { headers: bearer(adminTok) })).status()).toBe(200)
    expect((await request.get(`${API}/api/cases/my-cases`, { headers: bearer(userTok) })).status()).toBe(401)
    const login = await request.post(`${API}/api/advocates/login`, { data: { email: u.email, password: u.password } })
    expect((await login.json()).code).toBe('MEMBERSHIP_SUSPENDED')
    expect((await request.post(`${API}/api/firm/members/${id}/reactivate`, { headers: bearer(adminTok) })).status()).toBe(200)
    await apiLogin(request, u.email, u.password)
  })

  test('suspending a firm ends all its sessions; members cannot sign in until reactivated', async ({ request }) => {
    const op = await operatorLogin(request, state().operators.OWNER)
    const c = py(`from firms.models import Firm;print(Firm.objects.get(slug='e2e-c-${st().run}').public_id)`)
    const email = `admin-${st().run}@c.e2e.test`
    const cTok = await apiLogin(request, email, 'Firm#E2e-Pass2026')
    expect((await request.post(`${API}/api/platform/firms/${c}/suspend`, { headers: bearer(op), data: { reason: 'E2E check' } })).status()).toBe(200)
    expect((await request.get(`${API}/api/cases/my-cases`, { headers: bearer(cTok) })).status()).toBe(401)
    expect((await (await request.post(`${API}/api/advocates/login`, { data: { email, password: 'Firm#E2e-Pass2026' } })).json()).code).toBe('FIRM_SUSPENDED')
    expect((await request.post(`${API}/api/platform/firms/${c}/reactivate`, { headers: bearer(op) })).status()).toBe(200)
    await apiLogin(request, email, 'Firm#E2e-Pass2026')
  })

  test('a forged or tampered token is refused', async ({ request }) => {
    const t = await apiLogin(request, st().firmA.adminEmail, st().firmA.password)
    const [h, p, s] = t.split('.')
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
    const forged = [h, Buffer.from(JSON.stringify({ ...claims, exp: claims.exp + 86400 * 30 })).toString('base64url'), s].join('.')
    expect((await request.get(`${API}/api/cases/my-cases`, { headers: bearer(forged) })).status()).toBe(401)
    const none = [Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'), p, ''].join('.')
    expect((await request.get(`${API}/api/cases/my-cases`, { headers: bearer(none) })).status()).toBe(401)
  })
})

test.describe('RBAC', () => {
  test('cross-firm role assignment and member changes are refused', async ({ request }) => {
    const aTok = await apiLogin(request, st().firmA.adminEmail, st().firmA.password)
    const ids = JSON.parse(py(`import json
from core.models import Advocate, Role
from firms.models import Firm
b = Firm.objects.get(slug='e2e-b-${st().run}')
badmin = Advocate.objects.get(email='admin-${st().run}@b.e2e.test')
brole = Role.objects.filter(firm_id=b.id, is_admin=True).first()
junior = Advocate.objects.get(email='${st().firmA.staffEmail}')
print(json.dumps({'bAdmin': badmin.id, 'bRole': brole.id, 'junior': junior.id}))`))
    expect((await request.put(`${API}/api/admin/users/${ids.bAdmin}/roles`, { headers: bearer(aTok), data: { roleIds: [] } })).status()).toBe(404)
    expect((await request.post(`${API}/api/firm/members/${ids.bAdmin}/suspend`, { headers: bearer(aTok) })).status()).toBe(404)
    const r = await request.put(`${API}/api/admin/users/${ids.junior}/roles`, { headers: bearer(aTok), data: { roleIds: [ids.bRole] } })
    expect(ok(r.status())).toBe(false)
    expect((await request.put(`${API}/api/roles/${ids.bRole}/permissions`, { headers: bearer(aTok), data: [] })).status()).toBe(404)
  })

  test('a junior cannot manage people, roles, settings or issue invoices', async ({ request }) => {
    const j = await apiLogin(request, st().firmA.staffEmail, st().firmA.password)
    for (const [m, url, data] of [
      ['get', '/api/admin/users', undefined], ['get', '/api/firm/members', undefined],
      ['put', '/api/firm/settings', { displayName: 'hijack' }], ['post', '/api/firm/invitations', { email: 'x@y.e2e.test', roleIds: [] }],
      ['post', '/api/invoices/create', { caseId: 1, amount: '1' }], ['post', '/api/roles', { name: 'Mine' }],
      ['get', '/api/audit', undefined], ['get', '/api/backup/history', undefined],
    ] as const) {
      const r = await request.fetch(`${API}${url}`, { method: m.toUpperCase(), headers: bearer(j), data })
      expect(r.status(), `${m} ${url}`).toBe(403)
    }
    const id = Number(py(`from core.models import Advocate;print(Advocate.objects.get(email='${st().firmA.staffEmail}').id)`))
    const roles = await (await request.get(`${API}/api/roles`, { headers: bearer(await apiLogin(request, st().firmA.adminEmail, st().firmA.password)) })).json()
    const admin = roles.find((r: { isAdmin: boolean }) => r.isAdmin)
    expect((await request.put(`${API}/api/admin/users/${id}/roles`, { headers: bearer(j), data: { roleIds: [admin.id] } })).status()).toBe(403)
  })

  test('the last active administrator cannot be removed or demoted (API)', async ({ request }) => {
    const aTok = await apiLogin(request, st().firmA.adminEmail, st().firmA.password)
    const id = Number(py(`from core.models import Advocate;print(Advocate.objects.get(email='${st().firmA.adminEmail}').id)`))
    const roles = await (await request.get(`${API}/api/roles`, { headers: bearer(aTok) })).json()
    const junior = roles.find((r: { name: string }) => r.name === 'Advocate')
    const r = await request.put(`${API}/api/admin/users/${id}/roles`, { headers: bearer(aTok), data: { roleIds: [junior.id] } })
    expect(ok(r.status())).toBe(false)
    await apiLogin(request, st().firmA.adminEmail, st().firmA.password)    // still an admin, still signs in
  })
})

test.describe('documents, CORS, concurrency', () => {
  test('a signed document link is bound to its purpose and expires', async ({ request }) => {
    test.setTimeout(150_000)
    const aTok = await apiLogin(request, st().firmA.adminEmail, st().firmA.password)
    const docs = await (await request.get(`${API}/api/documents/list`, { headers: bearer(aTok) })).json()
    const doc = (Array.isArray(docs) ? docs : docs.content || docs.results)[0]
    const { url } = await (await request.post(`${API}/api/documents/${doc.id}/link`, { headers: bearer(aTok), data: { purpose: 'preview' } })).json()
    const full = url.startsWith('http') ? url : `${API}${url}`
    expect((await request.get(full)).status()).toBe(200)
    // Swapping the purpose (preview -> download) breaks the signature.
    expect((await request.get(full.replace('/preview/', '/download/'))).status()).toBeGreaterThanOrEqual(400)
    await new Promise((r) => setTimeout(r, 65_000))                     // DOCUMENT_LINK_SECONDS = 60
    expect((await request.get(full)).status()).toBeGreaterThanOrEqual(400)
  })

  test('CORS answers only the app origin', async ({ request }) => {
    const pre = (origin: string) => request.fetch(`${API}/api/cases/my-cases`, {
      method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } })
    expect((await pre(APP)).headers()['access-control-allow-origin']).toBe(APP)
    expect((await pre('https://evil.example')).headers()['access-control-allow-origin']).toBeUndefined()
  })

  test('two people accepting one invitation at once make one membership', async ({ request }) => {
    const aTok = await apiLogin(request, st().firmA.adminEmail, st().firmA.password)
    const email = `race-${st().run}@alpha.e2e.test`
    const roles = await (await request.get(`${API}/api/roles`, { headers: bearer(aTok) })).json()
    const junior = roles.find((r: { name: string }) => r.name === 'Advocate')
    await request.post(`${API}/api/firm/invitations`, { headers: bearer(aTok), data: { email, roleIds: [junior.id] } })
    const token = inviteLink(await waitForMail(email)).split('token=')[1]
    const results = await Promise.all([0, 1, 2, 3].map(() =>
      request.post(`${API}/api/invitations/accept`, { data: { token, password: 'Race#E2e-Pass2026' } })))
    expect(results.filter((r) => r.status() === 200)).toHaveLength(1)
    expect(py(`from firms.models import FirmMembership;from core.models import Advocate;print(FirmMembership.objects.filter(advocate_id__in=Advocate.objects.filter(email='${email}').values('id')).count())`)).toBe('1')
  })

  test('simultaneous uploads all land, each with its own file', async ({ request }) => {
    const aTok = await apiLogin(request, st().firmA.adminEmail, st().firmA.password)
    const rs = await Promise.all([0, 1, 2, 3, 4].map((i) => request.post(`${API}/api/documents/upload`, {
      headers: bearer(aTok), multipart: { file: { name: `par-${i}-${st().run}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4 ${i}`) } } })))
    expect(rs.every((r) => ok(r.status()))).toBe(true)
    const names = JSON.parse(py(`import json, os
from core.models import Document
from documents.storage import resolve_stored_file
docs = Document.objects.filter(original_name__startswith='par-', original_name__endswith='-${st().run}.pdf')
print(json.dumps([[d.stored_name, bool(resolve_stored_file(d.file_path, d.stored_name))] for d in docs]))`))
    expect(names).toHaveLength(5)
    expect(new Set(names.map((n: [string, boolean]) => n[0])).size).toBe(5)
    expect(names.every((n: [string, boolean]) => n[1])).toBe(true)
  })
})
