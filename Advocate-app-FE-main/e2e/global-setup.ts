import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { BE_DIR, MAIL_DIR, PYTHON, STATE_FILE, UPLOAD_DIR, backendEnv } from './env'

/** Seeds this run's synthetic operators into pactpro_e2e and clears the local inbox. */
export default async function globalSetup() {
  const run = Date.now().toString(36)
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.rmSync(MAIL_DIR, { recursive: true, force: true })
  fs.mkdirSync(MAIL_DIR, { recursive: true })
  fs.mkdirSync(path.join(UPLOAD_DIR, 'documents'), { recursive: true })
  // Deploy-time permission seeds (idempotent), as on a properly deployed server.
  for (const cmd of ['rename_junior_role', 'seed_admin_permissions', 'seed_alert_permissions', 'seed_firm_wide_scope',
    'seed_task_permissions', 'seed_invoice_permissions', 'seed_drafting_permissions']) {
    execFileSync(PYTHON, ['manage.py', cmd], { cwd: BE_DIR, env: { ...process.env, ...backendEnv }, encoding: 'utf-8' })
  }
  const script = path.join(path.dirname(STATE_FILE), '..', 'seed_operators.py')
  const out = execFileSync(PYTHON, ['manage.py', 'shell', '-c', `exec(open(r'${script}', encoding='utf-8').read())`], {
    cwd: BE_DIR, env: { ...process.env, ...backendEnv, E2E_RUN: run }, encoding: 'utf-8',
  })
  const line = out.split(/\r?\n/).find((l) => l.startsWith('E2E_STATE '))
  if (!line) throw new Error('operator seeding printed no state')
  fs.writeFileSync(STATE_FILE, JSON.stringify({ run, operators: JSON.parse(line.slice(10)) }, null, 2))
}
