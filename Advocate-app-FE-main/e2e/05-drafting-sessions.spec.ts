// Drafting versions and session end, against the live E2E backend.
//
// AI generation itself is NOT run here: the generation job loads a local
// embeddings model that would be downloaded from HuggingFace on first use, and
// this run must not reach outside services. So a draft is created with known
// clauses (as generation would leave it) and everything after generation is
// tested for real: edit in the browser editor, save, versions, restore, Word
// export, previous versions intact.
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { API, STATE_FILE } from './env'
import { apiLogin, bearer, py, uiLogin } from './helpers'

test.describe.configure({ mode: 'serial' })
const st = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
let sessionId = 0

test('a draft is edited in the browser, versioned, restored and exported; earlier versions stay intact', async ({ page, request }) => {
  const a = st().firmA
  sessionId = Number(py(`from core.models import Advocate
from drafting.models import Template, DraftSession, DraftBlock
adv = Advocate.objects.get(email='${a.adminEmail}')
t = Template.objects.create(name='E2E NDA ${st().run}', created_by_id=adv.id)
s = DraftSession.objects.create(template=t, created_by_id=adv.id, facts={'party': 'Meena Traders'}, status='ready')
for i, txt in enumerate(['The parties agree to keep information confidential.', 'This agreement lasts two years.']):
    DraftBlock.objects.create(session=s, position=i, block_type='clause', heading=f'Clause {i+1}', text=txt,
                              content_html=f'<p>{txt}</p>', source='generated')
print(s.id)`))
  const tok = await apiLogin(request, a.adminEmail, a.password)
  const h = bearer(tok)
  const v1 = await request.post(`${API}/api/drafting/draft-sessions/${sessionId}/versions/`, { headers: h, data: { label: 'First' } })
  expect(v1.status(), await v1.text()).toBe(201)

  // Edit in the real editor and save.
  await uiLogin(page, a.adminEmail, a.password)
  await page.goto(`/draft/${sessionId}`)
  const clause = page.getByText('This agreement lasts two years.')
  await expect(clause).toBeVisible({ timeout: 30_000 })
  await clause.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' It renews automatically unless ended in writing.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => py(`from drafting.models import DraftBlock;print(DraftBlock.objects.get(session_id=${sessionId}, position=1).text)`),
    { timeout: 20_000 }).toContain('renews automatically')

  const v2 = await request.post(`${API}/api/drafting/draft-sessions/${sessionId}/versions/`, { headers: h, data: { label: 'Edited' } })
  const versions = await v2.json()
  expect(versions.map((v: { label: string }) => v.label)).toEqual(expect.arrayContaining(['First', 'Edited']))
  const first = versions.find((v: { label: string }) => v.label === 'First')

  // Restore the first version: the edit is gone from the draft, but kept as a version.
  const r = await request.post(`${API}/api/drafting/draft-sessions/${sessionId}/versions/${first.id}/restore/`, { headers: h })
  expect(r.status(), await r.text()).toBeLessThan(300)
  expect(py(`from drafting.models import DraftBlock;print(DraftBlock.objects.get(session_id=${sessionId}, position=1).text)`))
    .not.toContain('renews automatically')
  const kept = py(`from drafting.models import DraftVersion;import json;print(json.dumps(sorted(v.label for v in DraftVersion.objects.filter(session_id=${sessionId}))))`)
  expect(JSON.parse(kept)).toEqual(expect.arrayContaining(['First', 'Edited']))

  // Word export of the current draft.
  const docx = await request.get(`${API}/api/drafting/drafts/${sessionId}/export/docx/`, { headers: h })
  expect(docx.status()).toBe(200)
  expect((await docx.body()).subarray(0, 2).toString()).toBe('PK')       // a .docx is a zip
})

test('another firm cannot open, save or export this draft', async ({ request }) => {
  const bTok = await apiLogin(request, `admin-${st().run}@b.e2e.test`, 'Firm#E2e-Pass2026')
  const h = bearer(bTok)
  expect((await request.get(`${API}/api/drafting/draft-sessions/${sessionId}/`, { headers: h })).status()).toBe(404)
  expect((await request.post(`${API}/api/drafting/draft-sessions/${sessionId}/save-blocks/`, { headers: h, data: [] })).status()).toBe(404)
  expect((await request.get(`${API}/api/drafting/drafts/${sessionId}/export/docx/`, { headers: h })).status()).toBe(404)
})

test('when the session ends elsewhere, the open app returns to sign-in', async ({ page, request }) => {
  const a = st().firmA
  await uiLogin(page, a.adminEmail, a.password)
  await expect(page.getByText(/Good (morning|afternoon|evening)/)).toBeVisible()
  // Logging out on another device ends every session (account-wide token version).
  const other = await apiLogin(request, a.adminEmail, a.password)
  await request.post(`${API}/api/advocates/logout`, { headers: bearer(other) })
  await page.goto('/dashboard/cases')
  // The app says why, then returns to sign-in.
  await expect(page.getByText('Your session has ended. Please sign in again.')).toHaveCount(1, { timeout: 20_000 })   // one dialog, not one per request
  await page.getByRole('button', { name: 'OK' }).click()
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })
})
