import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { platformApi, setPlatformSession } from '../platform/api'
import { PlatformAuthProvider } from '../platform/PlatformAuth'
import PlatformAudit from '../platform/pages/PlatformAudit'
import { deliveryLabel } from '../utils/delivery'
import { newRequestKey } from '../utils/requestKey'

describe('request keys', () => {
  it('are unique per form', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newRequestKey()))
    expect(keys.size).toBe(50)
  })
})

describe('invitation delivery labels', () => {
  it('never claim an email went out when it only reached the console', () => {
    expect(deliveryLabel('SENT')).toBe('email sent')
    expect(deliveryLabel('FAILED')).toBe('not delivered')
    expect(deliveryLabel('CONSOLE')).toMatch(/not emailed/)
    expect(deliveryLabel(undefined)).toBe('email queued')
  })
})

describe('PlatformAudit paging', () => {
  it('says when older events exist and loads them on request', async () => {
    setPlatformSession('PLAT', { id: 1, email: 'op@x', fullName: 'Op', role: 'OWNER', permissions: ['audit.read'] })
    const asked: any[] = []
    platformApi.defaults.adapter = async (config: any) => {
      asked.push(config.params)
      const before = config.params?.before
      const data = before
        ? { results: [{ id: 1, at: '2026-01-01T00:00:00', operator: 'op@x', action: 'OLD_EVENT', firmId: null, success: true, detail: {} }], hasMore: false, nextBefore: null }
        : { results: [{ id: 2, at: '2026-01-02T00:00:00', operator: 'op@x', action: 'NEW_EVENT', firmId: null, success: true, detail: {} }], hasMore: true, nextBefore: 2 }
      return { data, status: 200, statusText: 'OK', headers: {}, config }
    }
    render(<MemoryRouter><PlatformAuthProvider><PlatformAudit /></PlatformAuthProvider></MemoryRouter>)
    expect(await screen.findByText('NEW_EVENT')).toBeInTheDocument()
    expect(screen.getByText(/older events exist/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Load older events' }))
    expect(await screen.findByText('OLD_EVENT')).toBeInTheDocument()
    expect(screen.getByText(/full history/)).toBeInTheDocument()
    expect(asked[1].before).toBe('2')
  })
})
