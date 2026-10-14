import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import {
  clearPlatformSession, getPlatformToken, platformApi, PLATFORM_OPERATOR_KEY, PLATFORM_TOKEN_KEY,
  setOnPlatformExpired, setPlatformSession, type Operator,
} from '../platform/api'
import { PlatformAuthProvider, PlatformRoute } from '../platform/PlatformAuth'
import PlatformLayout, { PLATFORM_NAV } from '../platform/PlatformLayout'
import PlatformLogin from '../platform/pages/PlatformLogin'
import FirmCreate, { slugify } from '../platform/pages/FirmCreate'
import FirmDetail from '../platform/pages/FirmDetail'
import { ThemeProvider } from '../contexts/ThemeContext'

const OP: Operator = { id: 1, email: 'op@ams.test', fullName: 'Op', role: 'SUPPORT',
  permissions: ['firm.read', 'firm.create', 'firm.lifecycle', 'invite.manage', 'audit.read', 'firm.update'] }

type Captured = { url?: string; method?: string; headers: Record<string, any>; data?: any }

/** Route platformApi through a fake adapter; `reply` decides each response. */
function fakeServer(reply: (c: Captured) => { status: number; data: any }) {
  const calls: Captured[] = []
  platformApi.defaults.adapter = async (config: any) => {
    const c: Captured = { url: config.url, method: config.method, headers: { ...config.headers }, data: config.data ? JSON.parse(config.data) : undefined }
    calls.push(c)
    const { status, data } = reply(c)
    if (status >= 400) throw Object.assign(new Error(`HTTP ${status}`), { config, response: { status, data } })
    return { data, status, statusText: 'OK', headers: {}, config }
  }
  return calls
}

function at(path: string, routes: React.ReactNode) {
  return render(<ThemeProvider><MemoryRouter initialEntries={[path]}><PlatformAuthProvider><Routes>{routes}</Routes></PlatformAuthProvider></MemoryRouter></ThemeProvider>)
}

describe('platform session storage', () => {
  it('keeps the operator token in sessionStorage, apart from the firm token', () => {
    localStorage.setItem('token', 'FIRM')
    setPlatformSession('PLAT', OP)
    expect(sessionStorage.getItem(PLATFORM_TOKEN_KEY)).toBe('PLAT')
    expect(JSON.parse(sessionStorage.getItem(PLATFORM_OPERATOR_KEY)!).email).toBe('op@ams.test')
    expect(localStorage.getItem('token')).toBe('FIRM')
    clearPlatformSession()
    expect(getPlatformToken()).toBeNull()
    expect(localStorage.getItem('token')).toBe('FIRM')        // signing out of the platform leaves the firm session
  })

  it('sends only the platform token, never the firm one', async () => {
    localStorage.setItem('token', 'FIRM')
    const calls = fakeServer(() => ({ status: 200, data: {} }))
    await platformApi.get('/stats')
    expect(calls[0].headers.Authorization).toBeUndefined()
    setPlatformSession('PLAT', OP)
    await platformApi.get('/stats')
    expect(calls[1].headers.Authorization).toBe('Bearer PLAT')
  })

  it('a 401 ends only the platform session and reports why', async () => {
    localStorage.setItem('token', 'FIRM')
    setPlatformSession('PLAT', OP)
    const expired = vi.fn()
    setOnPlatformExpired(expired)
    fakeServer(() => ({ status: 401, data: { detail: 'Token expired' } }))
    await expect(platformApi.get('/firms')).rejects.toBeTruthy()
    expect(getPlatformToken()).toBeNull()
    expect(localStorage.getItem('token')).toBe('FIRM')
    expect(expired).toHaveBeenCalledWith('Your session has ended.')
  })
})

describe('PlatformRoute', () => {
  it('sends a firm user (no operator session) to the operator sign-in', () => {
    localStorage.setItem('token', 'FIRM')
    at('/platform/dashboard', <>
      <Route path="/platform/login" element={<p>operator sign-in</p>} />
      <Route path="/platform/dashboard" element={<PlatformRoute><p>secret</p></PlatformRoute>} />
    </>)
    expect(screen.getByText('operator sign-in')).toBeInTheDocument()
    expect(screen.queryByText('secret')).not.toBeInTheDocument()
  })

  it('sends an operator without the permission back to the dashboard', () => {
    setPlatformSession('PLAT', { ...OP, permissions: ['firm.read'] })
    at('/platform/audit', <>
      <Route path="/platform/dashboard" element={<p>dashboard</p>} />
      <Route path="/platform/audit" element={<PlatformRoute permission="audit.read"><p>audit</p></PlatformRoute>} />
    </>)
    expect(screen.getByText('dashboard')).toBeInTheDocument()
  })

  it('the navigation shows only what the operator may open', () => {
    setPlatformSession('PLAT', { ...OP, permissions: ['firm.read'] })
    at('/x', <Route path="/x" element={<PlatformLayout><p>body</p></PlatformLayout>} />)
    expect(screen.getByRole('link', { name: 'Firms' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Audit' })).not.toBeInTheDocument()
    expect(PLATFORM_NAV.find((n) => n.label === 'Audit')?.permission).toBe('audit.read')
  })
})

describe('PlatformLogin', () => {
  it('asks for the 6-digit code before calling the server', async () => {
    const calls = fakeServer(() => ({ status: 200, data: {} }))
    at('/platform/login', <Route path="/platform/login" element={<PlatformLogin />} />)
    await userEvent.type(screen.getByLabelText('Email'), 'op@ams.test')
    await userEvent.type(screen.getByLabelText('Password'), 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('alert')).toHaveTextContent('6-digit code')
    expect(calls).toHaveLength(0)
  })

  it('signs in with email, password and code, then opens the dashboard', async () => {
    const calls = fakeServer(() => ({ status: 200, data: { token: 'PLAT', operator: OP } }))
    at('/platform/login', <>
      <Route path="/platform/login" element={<PlatformLogin />} />
      <Route path="/platform/dashboard" element={<p>dashboard</p>} />
    </>)
    await userEvent.type(screen.getByLabelText('Email'), 'op@ams.test')
    await userEvent.type(screen.getByLabelText('Password'), 'pw')
    await userEvent.type(screen.getByLabelText('Authenticator code'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByText('dashboard')
    expect(calls[0].data).toEqual({ email: 'op@ams.test', password: 'pw', otp: '123456' })
    expect(getPlatformToken()).toBe('PLAT')
    expect(localStorage.getItem('token')).toBeNull()        // never written to the firm slot
  })
})

describe('FirmCreate', () => {
  it('derives the identifier from the name', () => {
    expect(slugify('Kumar & Associates, LLP')).toBe('kumar-associates-llp')
  })

  it('sends one Idempotency-Key and reuses it when retrying', async () => {
    setPlatformSession('PLAT', OP)
    let n = 0
    const calls = fakeServer(() => (++n === 1 ? { status: 503, data: { error: 'Try again' } } : {
      status: 201, data: { created: true, firm: { publicId: 'f1', name: 'Kumar', status: 'PROVISIONING' },
        invitation: { email: 'a@k.test', deliveryStatus: 'FAILED', deliveryError: 'SMTP down', expiresAt: '2030-01-01T00:00:00' } },
    }))
    at('/platform/firms/new', <Route path="/platform/firms/new" element={<FirmCreate />} />)
    await userEvent.type(screen.getByLabelText(/Firm name/), 'Kumar')
    await userEvent.type(screen.getByLabelText(/^Email/), 'a@k.test')
    const submit = screen.getByRole('button', { name: /Create firm and send invitation/ })
    await userEvent.click(submit)
    await screen.findByText('Try again')
    await userEvent.click(submit)
    await screen.findByText(/awaiting activation/)
    expect(screen.getByText(/could not be sent/)).toBeInTheDocument()
    const keys = calls.map((c) => c.headers['Idempotency-Key'])
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    expect(calls[0].data).toMatchObject({ name: 'Kumar', slug: 'kumar', adminEmail: 'a@k.test' })
  })

  it('refuses an invalid email without calling the server', async () => {
    setPlatformSession('PLAT', OP)
    const calls = fakeServer(() => ({ status: 201, data: {} }))
    at('/platform/firms/new', <Route path="/platform/firms/new" element={<FirmCreate />} />)
    await userEvent.type(screen.getByLabelText(/Firm name/), 'Kumar')
    await userEvent.type(screen.getByLabelText(/^Email/), 'not-an-email')
    await userEvent.click(screen.getByRole('button', { name: /Create firm/ }))
    expect(screen.getByText('That is not a valid email address.')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })
})

describe('FirmDetail suspend', () => {
  const FIRM = { publicId: 'f1', name: 'Kumar', slug: 'kumar', status: 'ACTIVE', planCode: '', displayName: 'Kumar',
    createdAt: '2026-01-01T00:00:00', members: { ACTIVE: 2 }, contact: {}, adminInvitation: null }

  async function openSuspend(confirmAnswer: boolean) {
    setPlatformSession('PLAT', OP)
    const calls = fakeServer((c) => {
      if (c.url === '/firms/f1') return { status: 200, data: FIRM }
      if (c.url === '/firms/f1/usage') return { status: 200, data: { cases: 1, clients: 1, documents: 0, storageBytes: 0, invoices: 0, roles: 3, pendingInvitations: 0 } }
      if (c.url === '/audit') return { status: 200, data: { results: [], hasMore: false, nextBefore: null } }
      return { status: 200, data: { ...FIRM, status: 'SUSPENDED' } }
    })
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(confirmAnswer)
    at('/platform/firms/f1', <Route path="/platform/firms/:id" element={<FirmDetail />} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Suspend' }))
    return { calls, ask }
  }

  it('needs a reason, then a confirmation', async () => {
    const { calls, ask } = await openSuspend(true)
    const go = screen.getByRole('button', { name: 'Continue' })
    expect(go).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/Reason/), 'Unpaid invoices')
    await userEvent.click(go)
    expect(ask).toHaveBeenCalled()
    await waitFor(() => expect(calls.some((c) => c.url === '/firms/f1/suspend')).toBe(true))
    expect(calls.find((c) => c.url === '/firms/f1/suspend')!.data).toEqual({ reason: 'Unpaid invoices' })
  })

  it('does nothing when the confirmation is declined', async () => {
    const { calls } = await openSuspend(false)
    await userEvent.type(screen.getByLabelText(/Reason/), 'Unpaid invoices')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(calls.some((c) => c.url === '/firms/f1/suspend')).toBe(false)
  })
})
