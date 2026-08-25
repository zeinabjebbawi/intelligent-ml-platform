import { useTheme } from '../theme'
import { STEP_ORDER } from '../hooks/useVersionHistory'

// ─────────────────────────────────────────────────────────────────────────────
// SHARED TOP NAVIGATION — same structure/styling Diagnose.jsx originated
// (PRISM wordmark, page links row, theme toggle, icon cluster), now used by
// every journey-map page instead of each page keeping its own copy. Reads
// theme from ThemeContext itself (see ../theme.jsx) so callers only need to
// pass which page is active and how to navigate.
//
// `enabled: false` entries (Training/Report) render but aren't
// clickable — those pages don't exist yet in this project, regardless of
// progress. `order` ties each link to its STEP_ORDER value (imported, not
// duplicated as a bare number) so this file has one source of truth for
// "how far into the pipeline is this link" — 'cleaning' uses its FIRST
// sub-step's order since Cleaning is one nav entry covering three STEP_ORDER
// slots (duplicates/outliers/missing).
//
// Backward-only navigation: a link is clickable only if it's BUILT
// (`enabled`) AND already REACHED (`order <= furthestOrder`, the highest
// STEP_ORDER the user has ever advanced into via a page's own "Continue"
// button — see App.jsx). Links ahead of that are grayed out and inert, even
// though the page exists — the only way to move forward is each page's own
// Continue button; this nav is for going back to an already-visited stage.
// `furthestOrder` defaults to Infinity (nothing restricted) so any caller
// that doesn't pass it yet still behaves exactly as before.
// ─────────────────────────────────────────────────────────────────────────────
export const NAV_LINKS = [
  { key: 'upload', label: 'Upload', enabled: true, order: STEP_ORDER.upload },
  { key: 'diagnose', label: 'Diagnose', enabled: true, order: STEP_ORDER.diagnose },
  { key: 'cleaning', label: 'Cleaning', enabled: true, order: STEP_ORDER.cleaning_duplicates },
  { key: 'encoding', label: 'Scaling & Encoding', enabled: true, order: STEP_ORDER.encoding },
  { key: 'feature_engineering', label: 'Feature Engineering', enabled: true, order: STEP_ORDER.feature_engineering },
  { key: 'sampling', label: 'Sampling', enabled: true, order: STEP_ORDER.sampling },
  { key: 'data_readiness', label: 'Visualization', enabled: true, order: STEP_ORDER.data_readiness },
  { key: 'feature_selection', label: 'Feature Selection', enabled: true, order: STEP_ORDER.feature_selection },
  { key: 'training', label: 'Training', enabled: false, order: STEP_ORDER.training },
  { key: 'report', label: 'Report', enabled: false, order: STEP_ORDER.report },
]

export default function TopNav({ active, onNavigate, furthestOrder = Infinity }) {
  const { C, dark, toggleTheme } = useTheme()

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 24px', borderBottom: `1px solid ${C.border}`, background: C.card,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, color: C.primary }}>◈</span>
          <span style={{ fontWeight: 900, fontSize: 15, color: C.text, letterSpacing: 0.5 }}>PRISM</span>
        </div>
        {/* overflowX:'auto' + flexShrink:0 per link, matching the pattern
            already used by VersionsBar for the same reason: without an
            explicit `whiteSpace:'nowrap'` + `flexShrink:0` on each link, a
            flex row that runs out of horizontal space shrinks its items by
            default — multi-word labels ("Scaling & Encoding", "Feature
            Engineering", "Data Readiness") then wrap onto a second line
            while single-word ones can't (no space to break at) and just
            stay full width, which is exactly what produced the ragged,
            inconsistent spacing/heights across links. Now every link keeps
            its natural one-line width always; the row scrolls horizontally
            instead of wrapping if it ever runs out of room. */}
        <div style={{ display: 'flex', gap: 22, overflowX: 'auto', flexWrap: 'nowrap' }}>
          {NAV_LINKS.map(l => {
            const isActive = l.key === active
            const reached = l.order <= furthestOrder
            const clickable = l.enabled && reached && !!onNavigate && !isActive
            return (
              <span
                key={l.key}
                onClick={clickable ? () => onNavigate(l.key) : undefined}
                title={!l.enabled ? 'Not built yet' : (!reached ? 'Keep going — this unlocks once you reach it' : undefined)}
                style={{
                  fontSize: 13, fontWeight: isActive ? 700 : 500,
                  color: isActive ? C.primary : ((l.enabled && reached) ? C.muted : C.faint),
                  paddingBottom: 4, borderBottom: isActive ? `2px solid ${C.primary}` : '2px solid transparent',
                  cursor: clickable ? 'pointer' : 'default',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >{l.label}</span>
            )
          })}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button onClick={toggleTheme} title="Toggle theme" style={{
          background: C.faint, border: `1px solid ${C.border}`, borderRadius: 20,
          padding: '5px 12px', color: C.text, fontSize: 12, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>{dark ? '🌙' : '☀'} {dark ? 'Dark' : 'Light'}</button>
        <span style={{ fontSize: 15, color: C.muted, cursor: 'default' }}>⚙</span>
        <span style={{ fontSize: 15, color: C.muted, cursor: 'default', position: 'relative' }}>
          🔔
          <span style={{ position: 'absolute', top: -2, right: -2, width: 6, height: 6, borderRadius: '50%', background: C.danger }} />
        </span>
        <span style={{ fontSize: 15, color: C.muted, cursor: 'default' }}>👤</span>
      </div>
    </div>
  )
}
