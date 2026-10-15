import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { platformApi, setPlatformSession } from '../platform/api'
import { PlatformAuthProvider } from '../platform/PlatformAuth'
import FirmSubscription from '../platform/pages/FirmSubscription'
import PlatformPlans from '../platform/pages/PlatformPlans'
import SubscriptionUsage, { formatQty, type SubscriptionSummary } from '../ui/SubscriptionUsage'

const SUMMARY: SubscriptionSummary = {
  plan: { code: 'BASIC', name: 'Basic' }, status: 'ACTIVE', readOnly: false, trialEndsAt: null, window: '2026-10-01',
  entitlements: [
    { key: 'feature.drafting', label: 'AI drafting', kind: 'feature', enabled: false, limit: null, overridden: false, used: null, remaining: null },
    { key: 'feature.assistant', label: 'Lisa (AI assistant)', kind: 'feature', enabled: true, limit: null, overridden: false, used: null, remaining: null },
    { key: 'cases.total', label: 'Cases', kind: 'stock', enabled: true, limit: 500, overridden: true, used: 450, remaining: 50 },
    { key: 'storage.bytes', label: 'Document storage', kind: 'stock', enabled: true, limit: null, overridden: false, used: 1536, remaining: null },
  ],
  ai: { calls: 3, estimatedCalls: 1, failedCalls: 0, inputTokens: 10, outputTokens: 5, totalTokens: 15 },
}

describe('SubscriptionUsage', () => {
  it('shows limits, use, unlimited, features and estimated AI usage honestly', () => {
    render(<SubscriptionUsage data={SUMMARY} />)
    const cases = screen.getByRole('row', { name: /Cases/ })
    expect(within(cases).getByText('450')).toBeInTheDocument()
    expect(within(cases).getByText('500')).toBeInTheDocument()
    expect(within(cases).getByText('adjusted')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /Document storage/ })).getByText('Unlimited')).toBeInTheDocument()
    expect(screen.getByText(/✕ AI drafting/)).toBeInTheDocument()
    expect(screen.getByText(/1 estimated from text length/)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('explains a read-only subscription without suggesting data is lost', () => {
    render(<SubscriptionUsage data={{ ...SUMMARY, status: 'EXPIRED', readOnly: true }} />)
    expect(screen.getByRole('status')).toHaveTextContent(/existing work stays available/)
  })

  it('formats storage sizes', () => {
    expect(formatQty('storage.bytes', 1536)).toBe('1.5 KB')
    expect(formatQty('storage.bytes', 10 * 1024 ** 3)).toBe('10 GB')
    expect(formatQty('cases.total', 1500)).toBe('1,500')
  })
})

const PLANS = [
  { code: 'BASIC', name: 'Basic', state: 'PUBLISHED', assignable: 'yes', trialDays: 0, description: '' },
  { code: 'PROFESSIONAL', name: 'Professional', state: 'PUBLISHED', assignable: 'yes', trialDays: 0, description: '' },
  { code: 'ENTERPRISE', name: 'Enterprise', state: 'DRAFT', assignable: 'test', trialDays: 0, description: '' },
  { code: 'LEGACY', name: 'Legacy', state: 'SYSTEM', assignable: 'no', trialDays: 0, description: '' },
]

function server(onPost: (body: any) => void, extra: Record<string, unknown> = {}, plans: any[] = PLANS) {
  const data = { ...SUMMARY, overrides: [], history: [], keys: SUMMARY.entitlements.map(({ key, label, kind }) => ({ key, label, kind })), ...extra }
  platformApi.defaults.adapter = async (config: any) => {
    if (config.method === 'post') onPost(JSON.parse(config.data))
    const body = config.url === '/plans' ? plans
      : config.url === '/subscription-policy' ? { testPlansEnabled: false }
        : data
    return { data: body, status: 200, statusText: 'OK', headers: {}, config }
  }
}

const view = () => render(<MemoryRouter><PlatformAuthProvider><FirmSubscription firmId="f1" /></PlatformAuthProvider></MemoryRouter>)

describe('FirmSubscription (operator)', () => {
  it('only operators allowed to manage subscriptions see the change buttons', async () => {
    setPlatformSession('T', { id: 1, email: 'ro@x', fullName: 'RO', role: 'READONLY', permissions: ['firm.read'] })
    server(() => {})
    view()
    expect(await screen.findByText('Basic')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change plan' })).not.toBeInTheDocument()
  })

  it('a plan change needs a reason and sends it', async () => {
    setPlatformSession('T', { id: 1, email: 'own@x', fullName: 'O', role: 'OWNER', permissions: ['firm.read', 'subscription.manage'] })
    const posts: any[] = []
    server((b) => posts.push(b))
    view()
    await userEvent.click(await screen.findByRole('button', { name: 'Change plan' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText('Plan'), 'PROFESSIONAL')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Customer upgraded')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ action: 'change_plan', planCode: 'PROFESSIONAL', status: 'ACTIVE', reason: 'Customer upgraded' })
  })

  it('offers only published plans to a customer firm - never drafts or Legacy', async () => {
    setPlatformSession('T', { id: 1, email: 'own@x', fullName: 'O', role: 'OWNER', permissions: ['firm.read', 'subscription.manage'] })
    server(() => {})
    view()
    await userEvent.click(await screen.findByRole('button', { name: 'Change plan' }))
    const values = Array.from(within(screen.getByRole('dialog')).getByLabelText('Plan').querySelectorAll('option')).map((o) => o.getAttribute('value'))
    expect(values).toEqual(['BASIC', 'PROFESSIONAL'])
  })

  it('a firm with no plan yet is shown as pending and is offered Assign plan', async () => {
    setPlatformSession('T', { id: 1, email: 'own@x', fullName: 'O', role: 'OWNER', permissions: ['firm.read', 'subscription.manage'] })
    server(() => {}, { status: 'PENDING', readOnly: true, plan: { code: '', name: 'No plan yet', state: '' } }, PLANS.filter((p) => p.state !== 'PUBLISHED'))
    view()
    expect(await screen.findByRole('button', { name: 'Assign plan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Status' })).not.toBeInTheDocument()
    expect(screen.getByText(/none is published yet/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/No AMS plan has been assigned yet/)
  })
})

describe('PlatformPlans', () => {
  const PLAN = {
    code: 'PROFESSIONAL', name: 'Professional', description: '', state: 'DRAFT', family: 'PROFESSIONAL', revision: 1,
    approvedBy: '', approvedAt: null, approvalNote: '', publishedBy: '', publishedAt: null, retiredBy: '', retiredAt: null,
    subscribers: 0, assignable: 'no', trialDays: 0,
    entitlements: [{ key: 'cases.total', label: 'Cases', enabled: true, limit: 5000 }],
  }
  const plansView = () => render(<MemoryRouter><PlatformAuthProvider><PlatformPlans /></PlatformAuthProvider></MemoryRouter>)

  it('marks drafts as unapproved and lets only plan owners approve', async () => {
    setPlatformSession('T', { id: 1, email: 'ro@x', fullName: 'RO', role: 'SUPPORT', permissions: ['firm.read'] })
    server(() => {}, {}, [PLAN])
    plansView()
    expect(await screen.findByText(/No plan is approved and published yet/)).toBeInTheDocument()
    expect(screen.getByText(/Unapproved example/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByText(/₹|INR \d/)).not.toBeInTheDocument()                     // no prices anywhere
  })

  it('approval needs a reference and is sent to the server', async () => {
    setPlatformSession('T', { id: 1, email: 'own@x', fullName: 'O', role: 'OWNER', permissions: ['firm.read', 'plan.publish'] })
    const posts: any[] = []
    server((b) => posts.push(b), {}, [PLAN])
    plansView()
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Approve' })).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText(/Approval reference/), 'Board minute 12')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(posts).toEqual([{ action: 'approve', reason: 'Board minute 12' }]))
  })
})
