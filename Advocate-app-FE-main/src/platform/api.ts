import axios, { type AxiosInstance } from 'axios'
import { API_BASE } from '../api/client'

// The SaaS operator API (/api/platform/*). Deliberately separate from the firm
// client in api/client.ts:
//  - its own token, in sessionStorage under its own key (gone when the tab
//    closes; never the firm's localStorage 'token');
//  - it only ever sends that token, and only to /api/platform/;
//  - a 401 ends only the platform session.
// The backend is the real boundary: platform tokens have audience
// 'ams-platform', which every firm endpoint refuses, and vice versa.
export const PLATFORM_TOKEN_KEY = 'amsPlatformToken'
export const PLATFORM_OPERATOR_KEY = 'amsPlatformOperator'

export type Operator = { id: number; email: string; fullName: string; role: string; permissions: string[] }

function storage(): Storage | null {
  try { return window.sessionStorage } catch { return null }
}

export const getPlatformToken = () => storage()?.getItem(PLATFORM_TOKEN_KEY) || null

export function getOperator(): Operator | null {
  try { return JSON.parse(storage()?.getItem(PLATFORM_OPERATOR_KEY) || 'null') } catch { return null }
}

export function setPlatformSession(token: string, operator: Operator) {
  storage()?.setItem(PLATFORM_TOKEN_KEY, token)
  storage()?.setItem(PLATFORM_OPERATOR_KEY, JSON.stringify(operator))
}

export function clearPlatformSession() {
  storage()?.removeItem(PLATFORM_TOKEN_KEY)
  storage()?.removeItem(PLATFORM_OPERATOR_KEY)
}

let onExpired: (reason: string) => void = (reason) => {
  window.location.href = `/platform/login${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`
}
/** Lets the app (and tests) decide what an ended session does. */
export function setOnPlatformExpired(fn: (reason: string) => void) { onExpired = fn }

export const platformApi: AxiosInstance = axios.create({ baseURL: `${API_BASE}/api/platform` })

platformApi.interceptors.request.use((config) => {
  const token = getPlatformToken()
  // Only the platform token, and only to the platform API (baseURL above).
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

platformApi.interceptors.response.use(
  (res) => res,
  (error) => {
    const url: string = error.config?.url || ''
    if (error.response?.status === 401 && !url.includes('/auth/login') && getPlatformToken()) {
      clearPlatformSession()
      const detail = error.response?.data?.detail
      onExpired(typeof detail === 'string' && detail !== 'Token expired' ? detail : 'Your session has ended.')
    }
    return Promise.reject(error)
  },
)

/** The API's own sentence for an error, else a fallback. */
export function errorText(err: any, fallback = 'Something went wrong.') {
  const d = err?.response?.data
  return (d && (d.error || d.detail)) || fallback
}

export function uuid(): string {
  // crypto.randomUUID needs a secure context; the LAN runs over http.
  const c: any = (globalThis as any).crypto
  if (c?.randomUUID) {
    try { return c.randomUUID() } catch { /* http: fall through */ }
  }
  const b = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}
