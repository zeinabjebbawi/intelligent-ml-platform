import AuthSection from '../components/AuthSection'
import PlatformHero from '../components/PlatformHero'
import { LIGHT_GATE, LIGHT_GATE_SPECTRUM } from '../constants/lightGate'

const scrollToId = (id) => (e) => {
  e.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}

const WORK_STEPS = [
  { num: '01', title: 'Diagnose', text: 'Explore, visualize, and understand your dataset before touching it.' },
  { num: '02', title: 'Prepare', text: 'Clean, engineer, and select the features that matter.' },
  { num: '03', title: 'Train', text: 'Configure and train models with guidance at every step.' },
  { num: '04', title: 'Predict', text: 'Explain, simulate, and export what your model has learned.' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Landing — PRISM's first-visit page: a light marketing site (nav → intro →
// scroll-scrubbed hero → workflow overview → real login/register gate),
// replacing the previous dark CrystalScene-based gate wholesale. Nav has no
// page links (there's nothing to link to before signing in) — its one action
// is "Login", which just scrolls to the real form at the bottom rather than
// navigating anywhere, since the form is already on this page.
// ─────────────────────────────────────────────────────────────────────────────
export default function Landing({ onAuthenticated }) {
  return (
    <div style={{ background: '#f8fafc', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", color: '#0f172a' }}>
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 40px', background: 'rgba(248,250,252,0.9)',
        borderBottom: '1px solid #e2e8f0', backdropFilter: 'blur(6px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 12, height: 12, background: '#14b8a6', borderRadius: 3, transform: 'rotate(45deg)', display: 'inline-block' }} />
          <span style={{ fontSize: 15, letterSpacing: '0.08em', fontWeight: 700 }}>PRISM</span>
        </div>
        <button onClick={scrollToId('login')} style={{
          color: '#fff', background: '#14b8a6', border: 'none',
          padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>
          Login
        </button>
      </nav>

      {/* ── Intro ── */}
      <section style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', textAlign: 'center', padding: '120px 40px 80px',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#14b8a6', marginBottom: 20 }}>
          Welcome to PRISM
        </div>
        <h1 style={{ fontSize: 42, fontWeight: 800, lineHeight: 1.25, margin: '0 0 20px', maxWidth: 720 }}>
          An end-to-end machine learning platform, built to guide you one decision at a time
        </h1>
        <p style={{ fontSize: 16, color: '#64748b', maxWidth: 560, lineHeight: 1.7, margin: 0 }}>
          Upload raw data and PRISM walks you through diagnosing, cleaning, and preparing it,
          training a model, and understanding what it learned — every step explained, every
          decision yours to make or hand to the agent.
        </p>
        <div style={{ marginTop: 44, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#94a3b8' }}>
          Scroll to see it in action
        </div>
      </section>

      <PlatformHero workHref="#work" />

      <section id="work" style={{
        position: 'relative', zIndex: 5, background: '#fff', borderTop: '1px solid #e2e8f0',
        padding: '110px 40px 130px',
      }}>
        <div style={{ maxWidth: 620, margin: '0 auto 52px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 25, fontWeight: 700, margin: '0 0 12px' }}>One workflow, from raw data to decision</h2>
          <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            PRISM guides you through every stage of a machine learning project — diagnose your
            data, clean and prepare it, train a model, and act on what it tells you.
          </p>
        </div>
        <div style={{
          maxWidth: 980, margin: '0 auto', display: 'grid',
          gridTemplateColumns: 'repeat(4,1fr)', gap: 16,
        }}>
          {WORK_STEPS.map((s) => (
            <div key={s.num} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '26px 22px' }}>
              <span style={{ fontSize: 11, color: '#14b8a6', fontWeight: 700, marginBottom: 14, display: 'block' }}>{s.num}</span>
              <h3 style={{ fontSize: 15, margin: '0 0 6px' }}>{s.title}</h3>
              <p style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.5, margin: 0 }}>{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Login ── */}
      <div id="login">
        <AuthSection onAuthenticated={onAuthenticated} palette={LIGHT_GATE} spectrum={LIGHT_GATE_SPECTRUM} />
      </div>
    </div>
  )
}
