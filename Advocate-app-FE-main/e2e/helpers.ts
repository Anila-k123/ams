import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { API, BE_DIR, MAIL_DIR, PYTHON, STATE_FILE, backendEnv } from './env'

export type Operator = { email: string; password: string; seed: string; active: boolean }
export const state = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as
  { run: string; operators: Record<'OWNER' | 'READONLY' | 'SUPPORT', Operator> }

// ---------------------------------------------------------------- TOTP ------
function base32(s: string) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += alpha.indexOf(ch).toString(2).padStart(5, '0')
  const out = []
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(out)
}
export function totpAt(seed: string, step: number) {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const d = crypto.createHmac('sha1', base32(seed)).update(msg).digest()
  const o = d[d.length - 1] & 0x0f
  return String((d.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}
const lastStep: Record<string, number> = {}
/** A fresh code for this operator: the server refuses a code (step) used before. */
export async function freshCode(seed: string) {
  for (;;) {
    const now = Math.floor(Date.now() / 30_000)
    const step = Math.max(now, (lastStep[seed] ?? -1) + 1)
    if (step <= now + 1) { lastStep[seed] = step; return totpAt(seed, step) }
    await new Promise((r) => setTimeout(r, 2_000))
  }
}

// ---------------------------------------------------------------- inbox -----
/** The newest email (file backend) to `to` containing `needle`, as text. */
export async function waitForMail(to: string, needle = 'accept-invite', timeoutMs = 20_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const files = fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR).map((f) => path.join(MAIL_DIR, f)) : []
    const hits = files.map((f) => fs.readFileSync(f, 'utf-8'))
      .flatMap((t) => t.split(/^-{60,}$/m)).filter((m) => m.includes(`To: ${to}`) && m.includes(needle))
    if (hits.length) return hits[hits.length - 1]
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no email to ${to} containing ${needle}`)
}
export const inviteLink = (mail: string) => {
  const m = mail.replace(/=\r?\n/g, '').match(/http:\/\/localhost:5180\/accept-invite\?token=[A-Za-z0-9_-]+/)
  if (!m) throw new Error('no invitation link in the email')
  return m[0]
}

// ---------------------------------------------------------------- backend ---
/** Run a management command against the E2E backend's database. */
export function manage(...args: string[]) {
  return execFileSync(PYTHON, ['manage.py', ...args], { cwd: BE_DIR, env: { ...process.env, ...backendEnv }, encoding: 'utf-8' })
}
/** Run Python (shell -c) against pactpro_e2e; refuses any other database. */
export function py(code: string) {
  const guard = "from django.db import connection as _c\nassert _c.settings_dict['NAME']=='pactpro_e2e'\n"
  return manage('shell', '-c', guard + code).trim()
}

export async function apiLogin(request: APIRequestContext, email: string, password: string) {
  const r = await request.post(`${API}/api/advocates/login`, { data: { email, password } })
  expect(r.status(), await r.text()).toBe(200)
  return (await r.json()).token as string
}
export async function operatorLogin(request: APIRequestContext, op: Operator) {
  const r = await request.post(`${API}/api/platform/auth/login`,
    { data: { email: op.email, password: op.password, otp: await freshCode(op.seed) } })
  expect(r.status(), await r.text()).toBe(200)
  return (await r.json()).token as string
}
export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })

/** Sign in through the firm login page. */
export async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel(/Email/).fill(email)
  await page.getByLabel(/Password/).first().fill(password)
  await page.getByRole('button', { name: /^Sign in$/ }).click()
  await page.waitForURL(/\/dashboard/)
}
