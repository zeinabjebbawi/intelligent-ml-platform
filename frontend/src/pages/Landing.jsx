import { useRef } from 'react'
import useScrollProgress from '../hooks/useScrollProgress'
import CrystalScene from '../components/CrystalScene'
import AuthSection from '../components/AuthSection'
import { GATE, GATE_FONT } from '../constants/darkGate'

const clamp01 = (v) => Math.max(0, Math.min(1, v))

// ─────────────────────────────────────────────────────────────────────────────
// Landing — PRISM's first-visit page, ported from prism_prototype_v2.html: a
// tall (460vh) section pins a full-viewport crystal/spectrum scene while the
// user scrolls through it, floods to white right as the pin releases, and
// cuts to the real Login/Register gate in normal document flow below. See
// useScrollProgress.js for the scrubbing mechanics and CrystalScene.jsx for
// the WebGL visual itself.
// ─────────────────────────────────────────────────────────────────────────────
export default function Landing({ onAuthenticated }) {
  const pinRef = useRef(null)
  const progress = useScrollProgress(pinRef)
  const floodOpacity = clamp01((progress - 0.84) / 0.16)

  return (
    <div style={{ background: GATE.bg }}>
      <div style={{
        position: 'fixed', top: 26, left: 40, zIndex: 50, fontSize: 13,
        letterSpacing: '0.35em', fontWeight: 600, opacity: 0.85, color: GATE.white,
        fontFamily: GATE_FONT,
      }}>
        PRISM
      </div>

      <section ref={pinRef} style={{ height: '460vh', position: 'relative' }}>
        <div style={{
          position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
          background: 'radial-gradient(ellipse at 50% 40%, #0e1424 0%, #05070c 70%)',
        }}>
          <CrystalScene progress={progress} />
          <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: floodOpacity, pointerEvents: 'none', zIndex: 5 }} />
          <div style={{
            position: 'absolute', left: '50%', bottom: '8%', transform: 'translateX(-50%)',
            textAlign: 'center', letterSpacing: '0.35em', fontSize: 14, textTransform: 'uppercase',
            opacity: 0.9, pointerEvents: 'none', color: GATE.white, fontFamily: GATE_FONT,
          }}>
            PRISM
            <small style={{ display: 'block', marginTop: 8, letterSpacing: '0.15em', fontSize: 10, color: GATE.muted, textTransform: 'none' }}>
              Where data becomes clarity
            </small>
          </div>
        </div>
      </section>

      <AuthSection onAuthenticated={onAuthenticated} />
    </div>
  )
}
