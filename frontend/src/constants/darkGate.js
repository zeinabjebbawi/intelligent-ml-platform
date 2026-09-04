// ─────────────────────────────────────────────────────────────────────────────
// Shared palette for the pre-pipeline "dark gate" pages — Landing, AuthSection,
// Workspace — a fixed dark aesthetic independent of the app's own light/dark
// theme toggle (the same deliberate one-off deviation Report.jsx's gradient
// header already makes for a page that isn't part of the ordinary pipeline
// furniture). Ported from prism_prototype_v2.html's :root custom properties.
// ─────────────────────────────────────────────────────────────────────────────
export const GATE = {
  bg: '#05070c',
  panel: '#0b0e16',
  white: '#f5f6ff',
  muted: '#8890a8',
  border: 'rgba(255,255,255,0.1)',
  danger: '#ff6b6b',
  dangerBg: 'rgba(255,107,107,0.1)',
  success: '#7dff7d',
  successBg: 'rgba(125,255,125,0.1)',
}

export const GATE_SPECTRUM = 'linear-gradient(90deg, #ff5c5c, #ffa64d, #ffe64d, #7dff7d, #4dd2ff, #7c6cff, #d66dff)'

export const GATE_FONT = "'Helvetica Neue', Arial, sans-serif"
