// Firm onboarding, in the browser, against the real backend:
// operator MFA sign-in -> dashboard -> create firm -> invitation email (local
// file inbox) -> administrator accepts -> firm active -> admin signs in ->
// firm settings -> invites staff -> staff accepts -> role change.
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { STATE_FILE } from './env'
import { freshCode, inviteLink, state, uiLogin, waitForMail } from './helpers'

test.describe.configure({ mode: 'serial' })

const s = () => state()
const slug = () => `e2e-alpha-${s().run}`
const adminEmail = () => `admin-${s().run}@alpha.e2e.test`
const staffEmail = () => `junior-${s().run}@alpha.e2e.test`
const PASSWORD = 'Alpha#E2e-Pass2026'

function remember(extra: Record<string, unknown>) {
  const cur = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...cur, ...extra }, null, 2))
}

test('operator signs in with password and authenticator code', async ({ page }) => {
  const op = s().operators.OWNER
  await page.goto('/platform/login')
  await page.getByLabel('Email').fill(op.email)
  await page.getByLabel('Password').fill(op.password)
  // Without the code the server is never asked.
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('6-digit code')
  await page.getByLabel('Authenticator code').fill(await freshCode(op.seed))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/platform\/dashboard/)
  await expect(page.getByRole('heading', { name: 'Platform dashboard' })).toBeVisible()
  await expect(page.getByText('Registered firms')).toBeVisible()
})

test('operator creates a firm; the administrator is invited by email', async ({ page }) => {
  const op = s().operators.OWNER
  await page.goto('/platform/login')
  await page.getByLabel('Email').fill(op.email)
  await page.getByLabel('Password').fill(op.password)
  await page.getByLabel('Authenticator code').fill(await freshCode(op.seed))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/dashboard/)
  await page.getByRole('link', { name: 'Create firm' }).first().click()
  await page.getByLabel(/Firm name/).fill(`Alpha Legal ${s().run}`)
  await page.getByLabel(/Identifier/).fill(slug())
  await page.getByLabel(/^Name$/).fill('Asha Admin')
  await page.getByLabel(/^Email/).fill(adminEmail())
  await page.getByLabel('City').fill('Chennai')
  // Professional: the scenarios below use the client portal and several seats.
  // The seeded plans are unapproved drafts: only a synthetic test firm may use
  // them (SUBSCRIPTION_TEST_PLANS is on for the E2E server only).
  await expect(page.getByLabel('Plan', { exact: true }).locator('option[value="PROFESSIONAL"]')).toHaveCount(0)
  await page.getByLabel(/Synthetic test firm/).check()
  await page.getByLabel('Plan', { exact: true }).selectOption('PROFESSIONAL')
  await page.getByRole('button', { name: /Create firm and send invitation/ }).click()
  await expect(page.getByRole('status')).toContainText('awaiting activation')
  // Delivered to the local file inbox only (MAIL_BACKEND filebased).
  await expect(page.getByText(/not emailed|email sent/)).toBeVisible()
  await page.getByRole('link', { name: 'Open firm' }).click()
  await expect(page.getByText(adminEmail())).toBeVisible()
  remember({ firmA: { slug: slug(), adminEmail: adminEmail(), password: PASSWORD, url: page.url() } })
})

test('administrator accepts the invitation and is sent to sign in', async ({ page }) => {
  const link = inviteLink(await waitForMail(adminEmail()))
  await page.goto(link)
  await expect(page.getByRole('heading', { name: /Join Alpha Legal/ })).toBeVisible()
  await page.getByLabel('Your name').fill('Asha Admin')
  await page.getByLabel(/Choose a password/).fill(PASSWORD)
  await page.getByLabel(/Confirm password/).fill(PASSWORD)
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('status')).toContainText('You have joined')
  // The same link can't be used twice.
  await page.goto(link)
  await expect(page.getByRole('heading', { name: 'This invitation was already used' })).toBeVisible()
})

test('administrator signs in, sees the firm in the shell and edits firm settings', async ({ page }) => {
  await uiLogin(page, adminEmail(), PASSWORD)
  await expect(page.locator('.brand')).toContainText(`Alpha Legal ${s().run}`)
  await page.goto('/dashboard/firm/settings')
  await page.getByLabel(/Display name/).fill(`Alpha Legal Chambers ${s().run}`)
  await page.getByLabel('PIN code').fill('600001')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Firm settings saved.')).toBeVisible()
  await expect(page.locator('.brand')).toContainText(`Alpha Legal Chambers ${s().run}`)
  // Invalid GSTIN is refused before saving.
  await page.getByLabel('GSTIN').fill('12ABC')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.locator('.err, [role=alert]').first()).toBeVisible()
})

test('administrator invites a junior; the junior accepts and signs in', async ({ page, browser }) => {
  await uiLogin(page, adminEmail(), PASSWORD)
  await page.goto('/dashboard/users')
  await page.getByRole('button', { name: /Invite team member/ }).click()
  const dialog = page.getByRole('dialog')
  // Invitation only: no password is set by the administrator.
  await expect(dialog.getByLabel(/password/i)).toHaveCount(0)
  await dialog.getByLabel(/^Email/).fill(staffEmail())
  await dialog.getByLabel(/^Name/).fill('Ravi Junior')
  await dialog.getByRole('button', { name: 'Advocate', exact: true }).click()
  await dialog.getByRole('button', { name: 'Send invitation' }).click()
  await expect(page.getByText(`Invitation sent to ${staffEmail()}`)).toBeVisible()

  const ctx = await browser.newContext()
  const junior = await ctx.newPage()
  await junior.goto(inviteLink(await waitForMail(staffEmail())))
  await junior.getByLabel(/Choose a password/).fill(PASSWORD)
  await junior.getByLabel(/Confirm password/).fill(PASSWORD)
  await junior.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(junior).toHaveURL(/\/login/)
  await uiLogin(junior, staffEmail(), PASSWORD)
  // A junior has no firm administration.
  await expect(junior.getByRole('link', { name: 'Firm Settings' })).toHaveCount(0)
  await junior.goto('/dashboard/users')
  await expect(junior.getByRole('button', { name: /Invite team member/ })).toHaveCount(0)
  await ctx.close()

  await page.reload()
  await page.getByRole('tab', { name: /Invitations/ }).click()
  await expect(page.getByRole('row', { name: new RegExp(staffEmail()) })).toContainText(/accepted/i)
  await page.getByRole('tab', { name: /Active/ }).click()
  const row = page.getByRole('row', { name: /Ravi Junior/ })
  await expect(row).toBeVisible()
  remember({ firmA: { ...state().firmA, staffEmail: staffEmail() } })
})

test('the last administrator cannot be removed from the UI', async ({ page }) => {
  await uiLogin(page, adminEmail(), PASSWORD)
  await page.goto('/dashboard/users')
  await page.getByRole('button', { name: /Actions for Asha Admin/ }).click()
  await expect(page.getByRole('menuitem', { name: /Suspend/ })).toHaveCount(0)
  await page.getByRole('menuitem', { name: /Edit/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /Super Admin/ }).click()          // deselect the administrator role
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText(/last active administrator/).first()).toBeVisible()
})
