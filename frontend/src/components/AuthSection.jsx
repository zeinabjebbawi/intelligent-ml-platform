import { useState } from 'react'
import { useTheme } from '../theme'
import { authAPI } from '../api'
import { formatDjangoErrors } from '../utils/authErrors'

const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

// ─────────────────────────────────────────────────────────────────────────────
// AuthSection — the real Login/Register card that ends the landing scroll.
// Lives in normal (non-pinned) document flow, so it needs none of the
// scroll-progress/canvas machinery above it — just the app's usual theme
// tokens and the existing authAPI.
// ─────────────────────────────────────────────────────────────────────────────
export default function AuthSection({ onAuthenticated }) {
  const { C } = useTheme()
  const [mode, setMode] = useState('register') // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const switchMode = (next) => {
    setMode(next); setError(''); setNotice(''); setPassword(''); setConfirmPassword('')
  }

  const validate = () => {
    if (!email.trim() || !isValidEmail(email.trim())) return 'Enter a valid email address.'
    if (!password) return 'Enter a password.'
    if (mode === 'register') {
      if (password.length < 8) return 'Password must be at least 8 characters.'
      if (password !== confirmPassword) return 'Passwords do not match.'
    }
    return null
  }

  const doLogin = async () => {
    const { data } = await authAPI.login({ username: email.trim(), password })
    localStorage.setItem('access_token', data.access)
    localStorage.setItem('refresh_token', data.refresh)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setSubmitting(true); setError(''); setNotice('')
    try {
      if (mode === 'register') {
        await authAPI.register({
          email: email.trim(), password,
          first_name: firstName.trim(), last_name: lastName.trim(),
        })
        try {
          await doLogin()
          onAuthenticated?.()
        } catch {
          // Account was created but the immediate auto-login failed (rare —
          // a backend hiccup). Don't loop back into registration against
          // the now-duplicate email; send the user to Login instead.
          setMode('login')
          setPassword('')
          setNotice('Account created — please log in below.')
        }
      } else {
        await doLogin()
        onAuthenticated?.()
      }
    } catch (err) {
      setError(formatDjangoErrors(err))
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '10px 14px', fontSize: 13, border: `1px solid ${C.border}`,
    borderRadius: 10, marginBottom: 12, boxSizing: 'border-box', background: C.card, color: C.text,
  }
  const labelStyle = { fontSize: 11.5, fontWeight: 700, color: C.muted, marginBottom: 4, display: 'block' }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: C.bg, padding: '60px 24px',
    }}>
      <form onSubmit={handleSubmit} style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: '32px 36px', boxShadow: '0 4px 24px rgba(0,0,0,0.12)', width: 420,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 18, color: C.primary }}>◈</span>
          <span style={{ fontWeight: 900, fontSize: 16, color: C.text, letterSpacing: 0.5 }}>PRISM</span>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 20, color: C.text }}>
          {mode === 'register' ? 'Create your account' : 'Welcome back'}
        </h1>

        <div style={{ display: 'flex', gap: 4, background: C.faint, borderRadius: 10, padding: 4, marginBottom: 20 }}>
          {[{ key: 'register', label: 'Create Account' }, { key: 'login', label: 'Log In' }].map(t => (
            <button key={t.key} type="button" onClick={() => switchMode(t.key)}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: mode === t.key ? C.card : 'transparent',
                color: mode === t.key ? C.primary : C.muted,
                fontWeight: mode === t.key ? 700 : 500, fontSize: 12.5,
                boxShadow: mode === t.key ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {notice && (
          <div style={{ background: C.successSoft, border: `1px solid ${C.success}`, borderRadius: 10,
            padding: '10px 14px', color: C.success, fontSize: 12.5, marginBottom: 16 }}>{notice}</div>
        )}
        {error && (
          <div style={{ background: C.dangerSoft, border: `1px solid ${C.danger}`, borderRadius: 10,
            padding: '10px 14px', color: C.danger, fontSize: 12.5, marginBottom: 16 }}>⚠ {error}</div>
        )}

        {mode === 'register' && (
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>First name</label>
              <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Last name</label>
              <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} style={inputStyle} />
            </div>
          </div>
        )}

        <label style={labelStyle}>Email</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} autoComplete="email" />

        <label style={labelStyle}>Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />

        {mode === 'register' && (
          <>
            <label style={labelStyle}>Confirm password</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} style={inputStyle} />
          </>
        )}

        <button type="submit" disabled={submitting}
          style={{
            width: '100%', marginTop: 8, padding: '11px 0', borderRadius: 10, border: 'none',
            background: submitting ? C.muted : C.primary, color: 'white', fontWeight: 700, fontSize: 14,
            cursor: submitting ? 'default' : 'pointer',
          }}>
          {submitting ? 'Working…' : (mode === 'register' ? 'Create Account' : 'Log In')}
        </button>
      </form>
    </div>
  )
}
