import { useRef } from 'react'
import { useTheme } from '../theme'
import useScrollProgress from '../hooks/useScrollProgress'
import ScrollVisual from '../components/ScrollVisual'
import StoryOverlay from '../components/StoryOverlay'
import AuthSection from '../components/AuthSection'

// ─────────────────────────────────────────────────────────────────────────────
// Landing — PRISM's first-visit page. A tall (500vh) section pins a
// full-viewport hero (canvas + story text) while the user scrolls through
// it, then releases into the real Login/Register card in normal document
// flow. See useScrollProgress.js / ScrollVisual.jsx for the scrubbing
// mechanics, and ScrollVisual's own header comment for how to swap in real
// video frames once footage exists.
// ─────────────────────────────────────────────────────────────────────────────
export default function Landing({ onAuthenticated }) {
  const { C } = useTheme()
  const pinRef = useRef(null)
  const progress = useScrollProgress(pinRef)

  return (
    <div style={{ background: C.bg }}>
      <section ref={pinRef} style={{ height: '500vh', position: 'relative' }}>
        <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
          <ScrollVisual progress={progress} C={C} />
          <StoryOverlay progress={progress} C={C} />
          <div style={{
            position: 'absolute', bottom: 28, left: 0, right: 0, textAlign: 'center',
            fontSize: 12, color: C.muted, opacity: Math.max(0, 1 - progress / 0.05),
            pointerEvents: 'none',
          }}>
            Scroll to explore ↓
          </div>
        </div>
      </section>

      <AuthSection onAuthenticated={onAuthenticated} />
    </div>
  )
}
