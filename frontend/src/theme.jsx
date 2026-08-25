import { createContext, useContext, useState, useCallback, useMemo } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// SHARED THEME — one dark/light system for the whole app.
//
// These are the exact token values Diagnose.jsx (and, copied from it,
// Encoding.jsx) already used before this file existed — teal accent,
// dark-first reference design. Cleaning.jsx and FeatureEngineering.jsx
// previously had their own indigo, light-only `const C`; per an explicit
// product decision they now render with these same tokens too, so all five
// pages look identical and share one toggle instead of five independent
// theme systems.
// ─────────────────────────────────────────────────────────────────────────────
export const DARK = {
  bg: '#0a0e15', card: '#12161f', cardAlt: '#161b26', border: 'rgba(255,255,255,0.08)',
  text: '#e8ecf2', muted: 'rgba(255,255,255,0.45)', faint: 'rgba(255,255,255,0.06)',
  primary: '#2dd4bf', primarySoft: 'rgba(45,212,191,0.14)',
  success: '#34d399', successSoft: 'rgba(52,211,153,0.14)',
  warning: '#fbbf24', warningSoft: 'rgba(251,191,36,0.14)',
  danger: '#f87171', dangerSoft: 'rgba(248,113,113,0.14)',
  scrim: 'rgba(0,0,0,0.55)', overlayCard: '#0d1117',
  // Aliases so files that previously used Cleaning/FeatureEngineering's own
  // key names (white/light/green/greenSoft/blue/blueSoft) keep working
  // unchanged after switching to these shared tokens.
  white: '#12161f', light: '#161b26',
  green: '#34d399', greenSoft: 'rgba(52,211,153,0.14)',
  blue: '#38bdf8', blueSoft: 'rgba(56,189,248,0.14)',
  chip: '#161b26', chipText: 'rgba(255,255,255,0.45)',
  // Fixed chart-accent colors (IQR/Z-score reference lines, neutral text) —
  // deliberately the same in both themes, matching how Cleaning.jsx used
  // them before it had a dark variant at all.
  amber: '#f59e0b', pink: '#ec4899', slate: '#334155',
}
export const LIGHT = {
  bg: '#f4f6f9', card: '#ffffff', cardAlt: '#f8fafc', border: '#e2e8f0',
  text: '#1e293b', muted: '#64748b', faint: '#f1f5f9',
  primary: '#0d9488', primarySoft: 'rgba(13,148,136,0.10)',
  success: '#059669', successSoft: 'rgba(5,150,105,0.10)',
  warning: '#d97706', warningSoft: 'rgba(217,119,6,0.10)',
  danger: '#dc2626', dangerSoft: 'rgba(220,38,38,0.10)',
  scrim: 'rgba(15,23,42,0.45)', overlayCard: '#ffffff',
  white: '#ffffff', light: '#f1f5f9',
  green: '#059669', greenSoft: 'rgba(5,150,105,0.10)',
  blue: '#0284c7', blueSoft: 'rgba(2,132,199,0.10)',
  chip: '#f1f5f9', chipText: '#64748b',
  amber: '#f59e0b', pink: '#ec4899', slate: '#334155',
}

const ThemeContext = createContext({ dark: false, C: LIGHT, toggleTheme: () => {} })

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(false)
  const toggleTheme = useCallback(() => setDark(d => !d), [])
  const value = useMemo(() => ({ dark, C: dark ? DARK : LIGHT, toggleTheme }), [dark])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// One dark/light flag + toggle, read from anywhere in the tree — this is
// the "existing dark/light mode" every page now shares, instead of each
// page keeping its own useState(false) that resets on navigation.
export function useTheme() {
  return useContext(ThemeContext)
}
