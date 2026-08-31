import { useEffect, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// useScrollProgress — tracks how far a tall "pin" section has scrolled past,
// as a 0-1 value. Pairs with a CSS `position: sticky` inner wrapper on the
// caller's side (native pin behavior, no JS position toggling needed here —
// this hook only computes the progress number).
//
// The rAF loop that recomputes progress only runs while the section is
// actually on-screen (gated by an IntersectionObserver), for two reasons:
//   1. Zero scroll-tied work happens once the user has scrolled past this
//      section, or on any other page that doesn't use this hook at all.
//   2. Under Vitest/jsdom, IntersectionObserver.observe() is stubbed as a
//      no-op that never fires (see src/setupTests.js) — so the rAF loop
//      never starts in tests, with nothing to leak or hang between tests.
// ─────────────────────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export default function useScrollProgress(sectionRef) {
  const [progress, setProgress] = useState(0)
  const rafRef = useRef(null)

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return

    const tick = () => {
      const rect = el.getBoundingClientRect()
      const scrollable = rect.height - window.innerHeight
      const scrolled = -rect.top
      setProgress(scrollable > 0 ? clamp(scrolled / scrollable, 0, 1) : 0)
      rafRef.current = requestAnimationFrame(tick)
    }

    const observer = new IntersectionObserver((entries) => {
      const isVisible = entries.some(e => e.isIntersecting)
      if (isVisible && rafRef.current == null) {
        rafRef.current = requestAnimationFrame(tick)
      } else if (!isVisible && rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }, { threshold: 0 })

    observer.observe(el)

    return () => {
      observer.disconnect()
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return progress
}
