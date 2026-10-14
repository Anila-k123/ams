import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthAlert, AuthFrame } from '../../pages/Login'
import { errorText } from '../api'
import { usePlatformAuth } from '../PlatformAuth'

/** /platform/login - operators only: email, password and a 6-digit authenticator code. */
export default function PlatformLogin() {
  const { login, signedIn } = usePlatformAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reason = params.get('reason')

  if (signedIn) return <Navigate to="/platform/dashboard" replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\d{6}$/.test(otp)) { setError('Enter the 6-digit code from your authenticator app.'); return }
    setBusy(true); setError('')
    try {
      await login(email.trim(), password, otp)
      navigate('/platform/dashboard', { replace: true })
    } catch (err: any) {
      const status = err?.response?.status
      setError(status === 429 ? 'Too many failed attempts. Try again later.' : errorText(err, 'Sign-in failed.'))
      setOtp('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
      <div className="pp-kicker">AMS platform administration</div>
      <h1>Platform Admin Sign in</h1>
      <p className="muted auth-lead">For the team operating AMS. Law firm users sign in at the normal login page.</p>
      <form className="stack" onSubmit={submit} noValidate>
        {reason && !error && <AuthAlert>{reason}</AuthAlert>}
        {error && <AuthAlert>{error}</AuthAlert>}
        <div className="field">
          <label htmlFor="pf-email">Email</label>
          <input id="pf-email" className="input" type="email" autoComplete="username" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pf-password">Password</label>
          <input id="pf-password" className="input" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pf-otp">Authenticator code</label>
          <input id="pf-otp" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            pattern="[0-9]{6}" required value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <span className="hint">The 6-digit code from your authenticator app.</span>
        </div>
        <button type="submit" className={`btn primary pp-full${busy ? ' loading' : ''}`} disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthFrame>
  )
}
