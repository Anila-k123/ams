import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { jwtDecode } from 'jwt-decode'
import { logoutAndRedirect } from '../utils/auth'

// Who is signed in (merge phase 04). One place for identity instead of pages reading
// localStorage keys ad hoc. The same keys stay underneath (token, email, role,
// fullName) so a reload, and any code not yet moved over, see the same session.
// What the user may do is PermissionContext's job, not this one's.

export interface Session {
  token: string | null
  advocateId: number | null
  email: string | null
  role: string | null
  fullName: string | null
}

interface AuthState extends Session {
  isClient: boolean
  /** Store the /api/auth/login (or set-password) response. */
  login: (data: { token: string; role?: string; fullName?: string }, email?: string) => void
  /** Update the cached name / email after a profile edit. */
  updateProfile: (patch: { fullName?: string; email?: string }) => void
  logout: () => void
}

function read(): Session {
  const token = localStorage.getItem('token')
  let advocateId: number | null = null
  let email = localStorage.getItem('email')
  if (token) {
    try {
      const claims = jwtDecode<{ advocateId?: number; sub?: string }>(token)
      advocateId = claims.advocateId ?? null
      email = email || claims.sub || null
    } catch { /* malformed token: ProtectedRoute signs the user out */ }
  }
  return { token, advocateId, email, role: localStorage.getItem('role'), fullName: localStorage.getItem('fullName') }
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(read)

  const login = useCallback<AuthState['login']>((data, email) => {
    localStorage.setItem('token', data.token)
    localStorage.setItem('role', data.role || 'ADVOCATE')
    localStorage.setItem('fullName', data.fullName || '')
    if (email) localStorage.setItem('email', email)
    setSession(read())
  }, [])

  const updateProfile = useCallback<AuthState['updateProfile']>((patch) => {
    if (patch.fullName !== undefined) localStorage.setItem('fullName', patch.fullName)
    if (patch.email !== undefined) localStorage.setItem('email', patch.email)
    setSession(read())
  }, [])

  const logout = useCallback(() => logoutAndRedirect(false), [])

  const value = useMemo<AuthState>(() => ({
    ...session, isClient: session.role === 'CLIENT', login, updateProfile, logout,
  }), [session, login, updateProfile, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
