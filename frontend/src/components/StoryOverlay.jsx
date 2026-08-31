// ─────────────────────────────────────────────────────────────────────────────
// StoryOverlay — headline + short blurbs layered over ScrollVisual's canvas,
// each fading/rising in and out across its own [progress] window. Values are
// set directly from `progress` every render (no CSS `transition`) so the
// text tracks the scroll exactly, rather than trailing it with time-based
// easing — the opposite of every other animated element in this app, and
// deliberately so: this IS the scrubbing effect.
// ─────────────────────────────────────────────────────────────────────────────

// [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd]
const BLOCKS = [
  {
    window: [0, 0.05, 0.08, 0.14],
    heading: '◈ PRISM',
    body: 'Turn raw data into a trained, explainable model — guided, step by step.',
  },
  {
    window: [0.08, 0.14, 0.24, 0.30],
    heading: 'Understand your data first',
    body: 'Upload any dataset — PRISM profiles it instantly, flagging what needs attention before you touch a row.',
  },
  {
    window: [0.24, 0.30, 0.42, 0.48],
    heading: 'Clean it with confidence',
    body: 'Clean, encode, and engineer features guided by real statistics, not guesswork.',
  },
  {
    window: [0.42, 0.48, 0.62, 0.68],
    heading: 'Train and explain',
    body: 'Train, compare, and explain models — SHAP-backed importance and learning curves built in.',
  },
  {
    window: [0.62, 0.68, 0.82, 0.88],
    heading: 'Simulate and share',
    body: 'Simulate what-if scenarios and export a client-ready report.',
  },
  {
    window: [0.85, 0.92, 0.97, 1],
    heading: 'Ready to see what your data can do?',
    body: '',
  },
]

function bandOpacity(progress, [a, b, c, d]) {
  if (progress <= a || progress >= d) return 0
  if (progress < b) return (progress - a) / (b - a)
  if (progress <= c) return 1
  return 1 - (progress - c) / (d - c)
}

export default function StoryOverlay({ progress, C }) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {BLOCKS.map((block, i) => {
        const opacity = bandOpacity(progress, block.window)
        if (opacity <= 0.001) return null
        const translateY = (1 - opacity) * 20
        return (
          <div key={i} style={{
            position: 'absolute', maxWidth: 560, textAlign: 'center', padding: '20px 28px',
            borderRadius: 16, background: `${C.card}cc`, border: `1px solid ${C.border}`,
            opacity, transform: `translateY(${translateY}px)`, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}>
            <div style={{ fontSize: i === 0 ? 30 : 20, fontWeight: 900, color: C.text, marginBottom: block.body ? 8 : 0 }}>
              {block.heading}
            </div>
            {block.body && (
              <div style={{ fontSize: 14.5, color: C.muted, lineHeight: 1.6 }}>{block.body}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
