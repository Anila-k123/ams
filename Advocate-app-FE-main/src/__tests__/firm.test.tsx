import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The firm API client is replaced by a small in-memory server per test.
const server = vi.hoisted(() => ({ handle: (() => ({ status: 200, data: {} })) as (m: string, url: string, body?: any) => { status: number; data: any }, calls: [] as any[] }))
vi.mock('../api/client', () => {
  const call = (method: string) => async (url: string, a?: any, b?: any) => {
    const body = method === 'get' || method === 'delete' ? undefined : a
    server.calls.push({ method, url, body })
    const { status, data } = server.handle(method, url, body)
    if (status >= 400) throw Object.assign(new Error(`HTTP ${status}`), { response: { status, data } })
    void b
    return { data, status }
  }
  const api: any = { get: call('get'), post: call('post'), put: call('put'), delete: call('delete') }
  // rbacService calls api.request({method, url, data}).
  api.request = ({ method, url, data }: { method: string; url: string; data?: any }) =>
    api[method](url, data)
  return {
    default: api, API_BASE: 'http://api', apiUrl: (p: string) => `http://api${p}`,
    errorMessage: (e: any, f: string) => e?.response?.data?.error || f,
  }
})

import { ToastProvider } from '../contexts/ToastContext'
import { ThemeProvider } from '../contexts/ThemeContext'
import AcceptInvite, { LINK_STATES } from '../pages/AcceptInvite'
import UserManagement, { assignableRoles, isLastAdmin, type Member } from '../pages/UserManagement'

// The page checks USER_MANAGE through the permission context.
vi.mock('../contexts/PermissionContext', () => ({ usePermission: () => ({ hasPermission: () => true }) }))
import Sidebar from '../layout/Sidebar'
import { NAV } from '../layout/nav'

afterEach(() => { server.calls = []; vi.unstubAllGlobals() })

const member = (over: Partial<Member>): Member => ({
  advocateId: 1, fullName: 'A', email: 'a@x.test', status: 'ACTIVE', membershipId: 1, joinedAt: null, leftAt: null,
  isSelf: false, isAdmin: false, roles: [], invitation: null, ...over,
})

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}|{(l.state as any)?.notice}</p> }

describe('AcceptInvite', () => {
  const page = (token = 'tok') => render(<ThemeProvider>
    <MemoryRouter initialEntries={[`/accept-invite?token=${token}`]}>
      <Routes>
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/login" element={<Where />} />
      </Routes>
    </MemoryRouter></ThemeProvider>)

  const fetchReplies = (...replies: { ok: boolean; body: any }[]) => {
    const f = vi.fn()
    replies.forEach((r) => f.mockResolvedValueOnce({ ok: r.ok, json: async () => r.body }))
    vi.stubGlobal('fetch', f)
    return f
  }

  it.each(['EXPIRED', 'REVOKED', 'ACCEPTED', 'INVALID'])('explains a %s link', async (code) => {
    fetchReplies({ ok: false, body: { code, error: 'x' } })
    page()
    expect(await screen.findByRole('heading', { name: LINK_STATES[code].title })).toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('a new account chooses a password, then goes to sign-in (not signed in)', async () => {
    const f = fetchReplies({ ok: true, body: { firm: 'Kumar', email: 'n@k.test', kind: 'STAFF', newAccount: true } },
      { ok: true, body: { accepted: true, email: 'n@k.test' } })
    page()
    await userEvent.type(await screen.findByLabelText(/Choose a password/), 'Str0ng#Pass')
    await userEvent.type(screen.getByLabelText(/Confirm password/), 'Str0ng#Pass')
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/login|You have joined Kumar')
    expect(JSON.parse(f.mock.calls[1][1].body)).toMatchObject({ token: 'tok', password: 'Str0ng#Pass' })
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('an existing account confirms with its current password', async () => {
    fetchReplies({ ok: true, body: { firm: 'Kumar', email: 'e@k.test', kind: 'STAFF', newAccount: false } },
      { ok: false, body: { code: 'WRONG_PASSWORD', error: 'Enter the current password of this AMS account.' } })
    page()
    expect(await screen.findByText(/already has an AMS account/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Confirm password/)).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/current AMS password/), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('current password')
  })

  it('mismatched new passwords never reach the server', async () => {
    const f = fetchReplies({ ok: true, body: { firm: 'Kumar', email: 'n@k.test', kind: 'STAFF', newAccount: true } })
    page()
    await userEvent.type(await screen.findByLabelText(/Choose a password/), 'Str0ng#Pass')
    await userEvent.type(screen.getByLabelText(/Confirm password/), 'Other#Pass1')
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))
    expect(screen.getByRole('alert')).toHaveTextContent("don't match")
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('Team Members rules', () => {
  it('offers only the firm\'s own enabled roles', () => {
    const roles = [{ id: 1, name: 'Admin', isAdmin: true }, { id: 2, name: 'Tpl', template: true }, { id: 3, name: 'Off', disabled: true },
      { id: 4, name: 'Shared', builtIn: true }, { id: 5, name: 'Junior' }]
    expect(assignableRoles(roles).map((r) => r.id)).toEqual([1, 5])
  })

  it('knows the last active administrator', () => {
    const a = member({ advocateId: 1, isAdmin: true })
    const b = member({ advocateId: 2, isAdmin: true, status: 'SUSPENDED' })
    expect(isLastAdmin(a, [a, b])).toBe(true)
    expect(isLastAdmin(a, [a, { ...b, status: 'ACTIVE' }])).toBe(false)
  })
})

describe('Team Members page (merged with invitations)', () => {
  const MEMBERS = [
    member({ advocateId: 1, fullName: 'Asha Admin', isAdmin: true, isSelf: true, roles: [{ id: 1, name: 'Super Admin', isAdmin: true }] }),
    member({ advocateId: 2, fullName: 'Ravi Junior', membershipId: 2, roles: [{ id: 5, name: 'Junior', isAdmin: false }] }),
    member({ advocateId: 3, fullName: 'Old Hand', membershipId: 3, status: 'LEFT' }),
  ]
  const USERS = [
    { id: 1, fullName: 'Asha Admin', email: 'asha@x.test', roles: ['Super Admin'], isPracticeHead: true, active: true },
    { id: 2, fullName: 'Ravi Junior', email: 'ravi@x.test', roles: ['Junior'], practiceOwnerId: 1, active: true, sharesPractice: true, phone: '9876543210' },
    { id: 3, fullName: 'Old Hand', email: 'old@x.test', roles: [], active: false },
  ]
  const ROLES = [{ id: 1, name: 'Super Admin', isAdmin: true }, { id: 5, name: 'Junior' }, { id: 9, name: 'Template', template: true }]

  const page = () => {
    server.handle = (m, url) => {
      if (m === 'get' && url === '/api/admin/users') return { status: 200, data: USERS }
      if (m === 'get' && url === '/api/firm/members') return { status: 200, data: MEMBERS }
      if (m === 'get' && url === '/api/firm/invitations') return { status: 200, data: [
        { id: 7, email: 'pending@x.test', kind: 'STAFF', status: 'PENDING', roleIds: [5], expiresAt: '2030-01-01', createdAt: '2026-01-01',
          sendCount: 1, deliveryStatus: 'SENT', deliveryError: '', lastSentAt: null }] }
      if (m === 'get' && url === '/api/roles') return { status: 200, data: ROLES }
      return { status: 200, data: {} }
    }
    return render(<ToastProvider><MemoryRouter><UserManagement /></MemoryRouter></ToastProvider>)
  }
  const openMenu = async (name: string) => {
    await userEvent.click(await screen.findByRole('button', { name: `Actions for ${name}` }))
  }

  it('keeps the profile table (phone, practice) with status tabs', async () => {
    page()
    expect(await screen.findByText('Ravi Junior')).toBeInTheDocument()
    expect(screen.getByText('9876543210')).toBeInTheDocument()
    expect(screen.getByText(/Reports to Asha Admin/)).toBeInTheDocument()
    expect(screen.queryByText('Old Hand')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Left/ }))
    expect(screen.getByText('Old Hand')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Invitations/ }))
    expect(screen.getByText('pending@x.test')).toBeInTheDocument()
  })

  it('adds people only by invitation (no password field), with firm roles only', async () => {
    page()
    await screen.findByText('Ravi Junior')
    await userEvent.click(screen.getByRole('button', { name: /Invite team member/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByLabelText(/password/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Template/ })).not.toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(/^Email/), 'new@k.test')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
    expect(within(dialog).getByText('Choose at least one role.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: /Junior/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
    await waitFor(() => expect(server.calls.some((c) => c.url === '/api/firm/invitations' && c.method === 'post')).toBe(true))
    expect(server.calls.find((c) => c.method === 'post')!.body).toEqual({ email: 'new@k.test', fullName: '', roleIds: [5] })
    expect(server.calls.some((c) => c.url === '/api/admin/users' && c.method === 'post')).toBe(false)
  })

  it('asks before suspending, and does nothing when declined', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false)
    page()
    await openMenu('Ravi Junior')
    await userEvent.click(screen.getByRole('menuitem', { name: /Suspend/ }))
    expect(ask).toHaveBeenCalled()
    expect(server.calls.some((c) => c.method === 'post')).toBe(false)
    ask.mockReturnValue(true)
    await openMenu('Ravi Junior')
    await userEvent.click(screen.getByRole('menuitem', { name: /Suspend/ }))
    await waitFor(() => expect(server.calls.some((c) => c.url === '/api/firm/members/2/suspend')).toBe(true))
  })

  it('offers no suspend or remove on your own row', async () => {
    page()
    await openMenu('Asha Admin')
    expect(screen.getByRole('menuitem', { name: /Edit/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Suspend/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Remove|Delete/ })).not.toBeInTheDocument()
  })
})

describe('firm shell', () => {
  const shell = (firmName: string, firmLogo?: string) => render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Sidebar can={() => true} counts={{}} hot={[]} rail={false} firmName={firmName} firmLogo={firmLogo} onNavigate={() => {}} />
    </MemoryRouter>)

  it('shows the firm it was given (firm A and firm B differ)', () => {
    const a = shell('Firm A')
    expect(screen.getByText('Firm A')).toBeInTheDocument()
    a.unmount()
    shell('Firm B', 'http://api/logo.png')
    expect(screen.getByText('Firm B')).toBeInTheDocument()
    expect(screen.queryByText('Firm A')).not.toBeInTheDocument()
    expect(document.querySelector('img.firm-logo')).toHaveAttribute('src', 'http://api/logo.png')
  })

  it('firm administration items need their permissions', () => {
    const firm = NAV.groups.find((g) => g.id === 'firm')!.items
    expect(firm.find((i) => i.label === 'Firm Settings')?.perm).toBe('SETTINGS_EDIT')
    expect(firm.find((i) => i.label === 'Team Members')?.perm).toBe('USER_MANAGE')
    expect(firm.find((i) => i.label === 'Members & Invitations')).toBeUndefined()    // merged into Team Members
    render(<MemoryRouter><Sidebar can={(p) => p !== 'SETTINGS_EDIT'} counts={{}} hot={[]} rail={false} onNavigate={() => {}} /></MemoryRouter>)
    expect(screen.queryByText('Firm Settings')).not.toBeInTheDocument()
  })
})
