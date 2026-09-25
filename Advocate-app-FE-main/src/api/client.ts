import axios from 'axios'
import { logoutAndRedirect } from '../utils/auth'

// The one HTTP client for the whole app (merge phase 04). Every request carries the
// AMS JWT. AMS has no refresh token (one 24h token), so a 401 means "sign in
// again": clear the session and go to /login, as logoutAndRedirect() always did.
export const API_BASE: string = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8080'   // not localhost: see .env

export const getToken = () => localStorage.getItem('token')

// Endpoints where a 401 is an answer for the form (wrong password, bad OTP), not an
// expired session.
const PUBLIC_AUTH = /\/api\/auth\/|\/api\/client\/invite/

/** An axios instance on AMS, optionally under a path prefix (e.g. '/api/drafting'). */
export function createApi(prefix = '') {
  const instance = axios.create({ baseURL: `${API_BASE}${prefix}` })
  instance.interceptors.request.use((config) => {
    const token = getToken()
    if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`
    return config
  })
  instance.interceptors.response.use(
    (res) => res,
    (error) => {
      const url: string = error.config?.url || ''
      if (error.response?.status === 401 && getToken() && !PUBLIC_AUTH.test(`${prefix}${url}`)) logoutAndRedirect()
      return Promise.reject(error)
    },
  )
  return instance
}

const api = createApi()

/** Absolute URL for an API path, for places that need one (links, <img src>, window.open). */
export const apiUrl = (path: string) => `${API_BASE}${path}`

/** The Authorization header, for the few fetch() callers left (streaming, blobs). */
export const authHeaders = (): Record<string, string> => {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** A readable message from an axios error (DRF / AMS error shapes). */
export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data as Record<string, unknown> | string | undefined
  if (typeof data === 'string' && data.trim() && data.length < 300) return data
  if (data && typeof data === 'object') {
    for (const k of ['error', 'detail', 'message']) if (typeof data[k] === 'string') return data[k] as string
    const first = Object.values(data)[0]
    if (Array.isArray(first) && typeof first[0] === 'string') return first[0]
  }
  return (err as Error)?.message || fallback
}

export default api
