// ─────────────────────────────────────────────────────────────────────────────
// Light counterpart to darkGate.js's GATE palette — same key shape (so
// AuthSection can accept either as its `palette` prop with zero logic
// changes), values matching the new marketing hero's own light design
// (prism_platform_hero_light.html's :root custom properties). `white` keeps
// its name from GATE for prop-compatibility, but on this palette it holds
// the ink/foreground color, not literal white — the two palettes represent
// "page background" vs "text that reads on that background", not a fixed
// literal color.
// ─────────────────────────────────────────────────────────────────────────────
export const LIGHT_GATE = {
  bg: '#ffffff',
  panel: '#fafbfc',
  white: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  danger: '#ef4444',
  dangerBg: 'rgba(239,68,68,0.08)',
  success: '#0d9488',
  successBg: 'rgba(13,148,136,0.08)',
}

export const LIGHT_GATE_SPECTRUM = 'linear-gradient(90deg, #14b8a6, #0ea5e9, #6366f1, #f59e0b)'
