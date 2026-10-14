import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import {
  clearPlatformSession, getOperator, getPlatformToken, platformApi, setPlatformSession, type Operator,
} from './api'

type PlatformAuthState = {
  operator: Operator | null
  signedIn: boolean
  can: (permission: string) => boolean
  login: (email: string, password: string, otp: string) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<PlatformAuthState | null>(null)

/** Operator session (platform/api.ts storage). Independent of the firm AuthContext. */
export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [operator, setOperator] = useState<Operator | null>(() => (getPlatformToken() ? getOperator() : null))

  const login = useCallback(async (email: string, password: string, otp: string) => {
    const res = await platformApi.post('/auth/login', { email, password, otp })
    setPlatformSession(res.data.token, res.data.operator)
    setOperator(res.data.operator)
  }, [])

  const logout = useCallback(async () => {
    try { await platformApi.post('/auth/logout') } catch { /* ending locally anyway */ }
    clearPlatformSession()
    setOperator(null)
  }, [])

  const value = useMemo<PlatformAuthState>(() => ({
    operator,
    signedIn: !!operator && !!getPlatformToken(),
    can: (p: string) => !!operator?.permissions?.includes(p),
    login,
    logout,
  }), [operator, login, logout])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePlatformAuth(): PlatformAuthState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePlatformAuth must be used inside <PlatformAuthProvider>')
  return ctx
}

/** Platform pages need a platform session - a firm login doesn't count. The
 *  server checks every call too; this only keeps the screens honest. */
export function PlatformRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { signedIn, can } = usePlatformAuth()
  const location = useLocation()
  if (!signedIn) return <Navigate to="/platform/login" replace state={{ from: location.pathname }} />
  if (permission && !can(permission)) return <Navigate to="/platform/dashboard" replace />
  return <>{children}</>
}
