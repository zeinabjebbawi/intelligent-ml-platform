import { useLayoutEffect, useRef, useState } from 'react'
import { authAPI } from '../api'
import { formatDjangoErrors } from '../utils/authErrors'
import { GATE, GATE_SPECTRUM } from '../constants/darkGate'

const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

// ─────────────────────────────────────────────────────────────────────────────
// AuthSection — the real login/register form, dropped into whatever gate
// page hosts it (Landing's new light hero today; originally a fixed dark
// palette independent of the app's own light/dark theme toggle). `palette`/
// `spectrum` default to that original dark GATE so nothing else using this
// component changes — a caller on a light page passes LIGHT_GATE instead.
// `palette.white` is a legacy key name from GATE: it means "the ink color
// that reads on this palette's `bg`", not literally white — LIGHT_GATE's
// own `white` is a dark ink color for exactly this reason.
//
// Two adaptations from the original prism_prototype_v2.html mockup, both
// required for this to actually work against the real backend (register
// requires a password, min 8 characters) rather than just look right:
//   - the mockup's Create Account form had no password field at all — one
//     (plus a client-only confirm field) is added here, styled identically.
//   - the mockup's single "Name" input is sent as `first_name`; `last_name`
//     is left blank. Splitting on whitespace would be guessable but wrong
//     often enough (multi-word first names, etc.) that leaving it as one
//     field is the more honest choice until real separate fields are wanted.
// ─────────────────────────────────────────────────────────────────────────────
function Field({ label, id, colors, borderRest, ...inputProps }) {
  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: colors.muted, marginBottom: 10 }}>
        {label}
      </label>
      <input id={id} {...inputProps}
        style={{
          width: '100%', background: 'transparent', border: 'none',
          borderBottom: `1px solid ${borderRest}`, color: colors.white,
          fontSize: 18, fontFamily: 'inherit', padding: '6px 2px 12px', outline: 'none',
        }}
        onFocus={(e) => { e.target.style.borderBottomColor = colors.white }}
        onBlur={(e) => { e.target.style.borderBottomColor = borderRest }}
      />
    </div>
  )
}

export default function AuthSection({ onAuthenticated, palette = GATE, spectrum = GATE_SPECTRUM }) {
  const COLORS = palette
  const SPECTRUM = spectrum
  // The dark gate's inputs use a translucent white hairline that only reads
  // against a dark bg; a light palette needs its own (opaque) border color
  // instead of "translucent white", which would be invisible on white.
  const borderRest = palette === GATE ? 'rgba(255,255,255,0.2)' : COLORS.border
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const tabInRef = useRef(null)
  const tabUpRef = useRef(null)
  const tabsRowRef = useRef(null)
  const [underlineX, setUnderlineX] = useState(0)

  useLayoutEffect(() => {
    const target = mode === 'login' ? tabInRef.current : tabUpRef.current
    const tabsRow = tabsRowRef.current
    if (!target || !tabsRow) return
    const tabsRect = tabsRow.getBoundingClientRect()
    const rect = target.getBoundingClientRect()
    setUnderlineX(rect.left - tabsRect.left - (60 - rect.width) / 2)
  }, [mode])

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
        await authAPI.register({ email: email.trim(), password, first_name: name.trim() })
        try {
          await doLogin()
          onAuthenticated?.()
        } catch {
          switchMode('login')
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

  return (
    <section style={{
      position: 'relative', zIndex: 10, background: COLORS.bg, minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 24px',
      fontFamily: "'Helvetica Neue', Arial, sans-serif",
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.3em', textTransform: 'uppercase', color: COLORS.muted, marginBottom: 14, textAlign: 'center' }}>
          Prism
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 300, textAlign: 'center', margin: '0 0 48px', lineHeight: 1.4, color: COLORS.white }}>
          Continue into<br />your workspace
        </h1>

        <div ref={tabsRowRef} style={{ display: 'flex', justifyContent: 'center', gap: 32, position: 'relative', marginBottom: 6 }}>
          <button ref={tabInRef} type="button" onClick={() => switchMode('login')}
            style={{ background: 'none', border: 'none', color: mode === 'login' ? COLORS.white : COLORS.muted, fontSize: 15, letterSpacing: '0.03em', cursor: 'pointer', padding: '0 0 14px', fontFamily: 'inherit' }}>
            Sign in
          </button>
          <button ref={tabUpRef} type="button" onClick={() => switchMode('register')}
            style={{ background: 'none', border: 'none', color: mode === 'register' ? COLORS.white : COLORS.muted, fontSize: 15, letterSpacing: '0.03em', cursor: 'pointer', padding: '0 0 14px', fontFamily: 'inherit' }}>
            Create account
          </button>
        </div>
        <div style={{
          height: 2, width: 60, background: SPECTRUM, margin: '0 auto 44px', borderRadius: 2,
          transform: `translateX(${underlineX}px)`, transition: 'transform 0.35s ease',
        }} />

        {notice && (
          <div style={{ background: COLORS.successBg, border: `1px solid ${COLORS.success}55`, borderRadius: 8, padding: '10px 14px', color: COLORS.success, fontSize: 12.5, marginBottom: 24 }}>{notice}</div>
        )}
        {error && (
          <div style={{ background: COLORS.dangerBg, border: `1px solid ${COLORS.danger}55`, borderRadius: 8, padding: '10px 14px', color: COLORS.danger, fontSize: 12.5, marginBottom: 24 }}>⚠ {error}</div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
          {mode === 'register' && (
            <Field id="auth-name" label="Name" type="text" placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} colors={COLORS} borderRest={borderRest} />
          )}
          <Field id="auth-email" label="Email" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" colors={COLORS} borderRest={borderRest} />
          <Field id="auth-password" label="Password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'} colors={COLORS} borderRest={borderRest} />
          {mode === 'register' && (
            <Field id="auth-confirm-password" label="Confirm password" type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} colors={COLORS} borderRest={borderRest} />
          )}

          <button type="submit" disabled={submitting}
            style={{
              marginTop: 12, background: 'none', border: 'none', color: COLORS.white, fontSize: 15,
              letterSpacing: '0.04em', cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.6 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 0', fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => { const s = e.currentTarget.querySelector('span'); if (s) s.style.transform = 'translateX(6px)' }}
            onMouseLeave={(e) => { const s = e.currentTarget.querySelector('span'); if (s) s.style.transform = 'translateX(0)' }}>
            {submitting ? 'Working…' : (mode === 'register' ? 'Create account' : 'Continue')}
            <span style={{ transition: 'transform 0.25s ease' }}>→</span>
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 12, color: COLORS.muted, marginTop: 40, lineHeight: 1.6 }}>
          Prefer to look around first?{' '}
          <a href="#" onClick={(e) => e.preventDefault()} style={{ color: COLORS.white, textDecoration: 'none', borderBottom: `1px solid ${borderRest}` }}>
            Explore a sample dataset
          </a>
        </p>
      </div>
    </section>
  )
}
