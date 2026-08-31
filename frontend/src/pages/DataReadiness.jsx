/**
 * PRISM — Visualization Page (preprocessing report)
 *
 * Sections (in order, all scrollable):
 *   A. Pipeline Journey  +  KPI strip
 *   B. Summary (signature radar chart — 5 axes: Completeness, Balance,
 *      Normality, Separability, Cleanliness; Balance is dropped for
 *      clustering datasets, which have no target to be balanced)
 *   C. Before vs After  (skewness moved out to Quality — see below;
 *      missing values, class balance)
 *   D. Distribution Health (mini histogram grid + class-conditional overlays)
 *   E. Separability Check (PCA scatter + scree — loaded on demand)
 *   F. Quality Confirmation (skewness + missing values final state +
 *      anomaly score distribution + statistics table)
 *   G. Pre-Training Signal (signal score + algorithm recommendations)
 *
 * NOTE: No Feature Importance section — that belongs in the Feature
 * Selection page (deciding what to keep) and, after training, the Feature
 * Impact/SHAP page. This page only describes the data, it never prescribes
 * what to remove. No Correlations section either — explicit, repeated user
 * instruction: correlation structure doesn't belong on this page (feature-
 * target correlation as a *ranking signal* still lives in Feature Selection).
 *
 * Design: shares the app-wide theme system (../theme.jsx) and TopNav
 * (../components/TopNav.jsx), same convention as every other journey-map
 * page — not its own standalone token set.
 *
 * STANDING RULE (applies to every future page, not just this one): the
 * "Continue to X" forward-navigation button always lives at the page
 * BOTTOM, never in the top-right header. This page used to be the one
 * exception (its own in-page header button, kept there originally so
 * App.jsx's generic footer AdvanceButton wouldn't duplicate it) — that
 * was the actual bug, not the fix. Fixed here by moving this page's own
 * button to the bottom instead; App.jsx still deliberately renders no
 * separate footer button for this stage (see App.jsx's 'data_readiness'
 * block), so there's still exactly one Continue button, just correctly
 * positioned now.
 */
import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Cell, ResponsiveContainer, ReferenceLine,
  ScatterChart, Scatter, ZAxis,
  Area, AreaChart,
  Line, ComposedChart,
} from 'recharts'
import { useTheme } from '../theme'
import TopNav from '../components/TopNav'
import { getBalanceLevelConfig, getSkewLevelConfig } from '../constants/balanceLevels'
import VersionsBar from '../components/VersionsBar'

const shadow  = '0 4px 24px rgba(0,0,0,0.07)'
const shadow2 = '0 2px 8px rgba(0,0,0,0.05)'
const cardR   = 16

// 127.0.0.1, not "localhost" — dual-stack landmine on this machine, see
// docs/PROJECT_HANDOFF.md §11.2.
const ML_API = 'http://127.0.0.1:8001'

const callViz = async (endpoint, body) => {
  const res = await fetch(`${ML_API}/visualization/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || `Error ${res.status}`) }
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────────
// INFO ICON — same dual-mode ⓘ popover already used across Train and Test /
// Feature Importance / Learning Curve / Simulator (bold multi-column `items`
// list, or a plain `content` paragraph for a short explanation). Ported
// verbatim rather than shared from one file, matching how each of those
// pages already carries its own copy - `items`/`content`, fixed-position +
// viewport-clamped on open, same visual language everywhere in the app.
// ─────────────────────────────────────────────────────────────────────────────
const WIDE_POPUP_W = 560
const NARROW_POPUP_W = 300

const InfoIcon = ({ content, items, itemsTitle, footer, width }) => {
  const { C } = useTheme()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const popupRef = useRef(null)
  const isWide = !!items
  const popupW = width || (isWide ? WIDE_POPUP_W : NARROW_POPUP_W)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const w = popupRef.current?.offsetWidth || popupW
    const h = popupRef.current?.offsetHeight || 0
    const left = Math.max(12, Math.min(r.right + 8, window.innerWidth - w - 12))
    const top  = Math.max(12, Math.min(r.top - 6, window.innerHeight - h - 12))
    setPos({ left, top })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button ref={btnRef} onClick={() => setOpen(o => !o)} title="Learn more"
        style={{
          width: 18, height: 18, border: 'none', background: 'none', padding: 0,
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          marginLeft: 6, flexShrink: 0, lineHeight: 1, transition: 'all 0.15s',
        }}>
        <svg width={18} height={18} viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="7.25" fill={open ? C.primary : C.primarySoft} stroke={C.primary} strokeWidth="1.5" />
          <circle cx="9" cy="5.7" r="1.05" fill={open ? '#fff' : C.primary} />
          <rect x="8.15" y="8.1" width="1.7" height="5" rx="0.85" fill={open ? '#fff' : C.primary} />
        </svg>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
          {isWide ? (
            <div ref={popupRef} style={{
              position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, zIndex: 999,
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
              padding: '16px 20px', width: popupW, maxWidth: 'calc(100vw - 24px)',
              maxHeight: 'calc(100vh - 24px)', overflowY: 'auto', boxShadow: shadow,
              fontSize: 12, color: C.text,
              fontWeight: 400, textTransform: 'none', letterSpacing: 'normal',
            }}>
              {itemsTitle && (
                <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase',
                  letterSpacing: 1, marginBottom: 12 }}>{itemsTitle}</div>
              )}
              <div style={{ columns: '2 230px', columnGap: 22 }}>
                {items.map(it => (
                  <div key={it.label} style={{ breakInside: 'avoid', marginBottom: 13 }}>
                    <div style={{ fontWeight: 800, fontSize: 12.5, color: C.text, marginBottom: 3 }}>{it.label}</div>
                    <div style={{ fontWeight: 400, fontSize: 11.5, color: C.muted, lineHeight: 1.55, whiteSpace: 'pre-line' }}>{it.desc}</div>
                  </div>
                ))}
              </div>
              {footer && (
                <div style={{ marginTop: 4, paddingTop: 10, borderTop: `1px dashed ${C.border}`,
                  fontSize: 11, fontWeight: 600, color: C.muted, lineHeight: 1.6 }}>{footer}</div>
              )}
            </div>
          ) : (
            <div ref={popupRef} style={{
              position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, zIndex: 999,
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
              padding: '14px 16px', width: popupW, maxWidth: 'calc(100vw - 24px)',
              maxHeight: 'calc(100vh - 24px)', overflowY: 'auto', boxShadow: shadow, fontSize: 12,
              color: C.text, lineHeight: 1.65, whiteSpace: 'pre-line',
              fontWeight: 400, textTransform: 'none', letterSpacing: 'normal',
            }}>
              {content}
            </div>
          )}
        </>
      )}
    </span>
  )
}

const CLASS_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

// ─────────────────────────────────────────────────────────────────────────────
// PROFESSIONAL METRIC CARD — left-border accent + decorative blob + icon
// pill + trend badge, replacing the plain bordered-box KPI style used
// earlier in Sampling.jsx (explicit feedback: that style read as boring).
// ─────────────────────────────────────────────────────────────────────────────
const MetricCard = ({ label, value, sub, accent, icon, trend, trendLabel }) => {
  const { C } = useTheme()
  const ac = accent || C.primary
  return (
    <div style={{
      background: C.card, borderRadius: cardR,
      padding: '20px 22px', position: 'relative', overflow: 'hidden',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)',
      borderLeft: `4px solid ${ac}`,
    }}>
      <div style={{
        position: 'absolute', top: -32, right: -32, width: 96, height: 96,
        borderRadius: '50%', background: `${ac}10`, pointerEvents: 'none',
      }} />
      {icon && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 36, height: 36, borderRadius: 10, marginBottom: 10,
          background: `${ac}15`, fontSize: 16,
        }}>{icon}</div>
      )}
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
        letterSpacing: 1.6, color: C.muted, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 900, color: C.text, lineHeight: 1 }}>{value}</div>
      {(sub || trendLabel) && (
        <div style={{ marginTop: 6, fontSize: 12, color: C.muted, display: 'flex',
          alignItems: 'center', gap: 5 }}>
          {trend && (
            <span style={{
              fontWeight: 700, fontSize: 11, padding: '1px 6px', borderRadius: 5,
              background: trend === 'positive' ? C.successSoft : trend === 'negative' ? C.dangerSoft : C.faint,
              color: trend === 'positive' ? C.success : trend === 'negative' ? C.danger : C.muted,
            }}>
              {trend === 'positive' ? '▲' : trend === 'negative' ? '▼' : '●'} {trendLabel}
            </span>
          )}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION WRAPPER
// ─────────────────────────────────────────────────────────────────────────────
const Section = ({ id, icon, label, sub, accent, children }) => {
  const { C } = useTheme()
  return (
    <div id={id} style={{ marginBottom: 36 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 17, background: `${accent || C.primary}14`,
        }}>{icon}</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{label}</div>
          {sub && <div style={{ fontSize: 12, color: C.muted }}>{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  )
}

// Chart card wrapper
const ChartCard = ({ title, sub, children, action, style: extraStyle }) => {
  const { C } = useTheme()
  return (
    <div style={{
      background: C.card, borderRadius: 14, padding: '18px 20px',
      boxShadow: shadow2, border: `1px solid ${C.border}`, ...extraStyle,
    }}>
      {(title || action) && (
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            {title && <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{title}</div>}
            {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY RADAR — custom SVG radar, the signature visual. 5 axes now
// (Completeness, Balance, Normality, Separability, Cleanliness) — the
// Signal axis was removed per explicit request: signal strength is a
// feature-selection concern (it's still shown, correctly, in Feature
// Selection's own correlation ranking), not a general readiness axis.
// ─────────────────────────────────────────────────────────────────────────────
const DataFingerprint = ({ scores, isClustering, isRegression }) => {
  const { C } = useTheme()
  // The underlying score is still meaningful for regression (it's the same
  // skew-derived "how well distributed" number the Target Skew card shows
  // as a percentage), so unlike clustering the axis itself stays - only the
  // WORD changes, since "Balance" implies classes a continuous target
  // doesn't have.
  const ALL_AXES = [
    { key: 'completeness', label: 'Completeness' },
    { key: 'balance',      label: isRegression ? 'Skew' : 'Balance' },
    { key: 'normality',    label: 'Normality' },
    { key: 'separability', label: 'Separability' },
    { key: 'cleanliness',  label: 'Cleanliness' },
  ]
  // Balance measures how evenly TARGET CLASSES are distributed - clustering
  // has no target at all, so the axis (and its scale/shape) is dropped
  // entirely rather than shown with a meaningless filler score.
  const AXES = isClustering ? ALL_AXES.filter(a => a.key !== 'balance') : ALL_AXES
  const N = AXES.length
  const CX = 180, CY = 180, R = 130
  const angles = AXES.map((_, i) => (i * 2 * Math.PI / N) - Math.PI / 2)

  const pt = (angle, r) => ({
    x: CX + r * Math.cos(angle),
    y: CY + r * Math.sin(angle),
  })

  const grids = [25, 50, 75, 100]
  const dataPoints = AXES.map((ax, i) => pt(angles[i], (scores[ax.key] || 0) / 100 * R))
  const polygon = dataPoints.map(p => `${p.x},${p.y}`).join(' ')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
      <svg width={360} height={360} viewBox="0 0 360 360">
        {grids.map(g => {
          const gpts = angles.map(a => pt(a, g/100*R))
          const d = gpts.map((p,i) => `${i===0?'M':'L'}${p.x},${p.y}`).join(' ') + 'Z'
          return <path key={g} d={d} fill="none" stroke={C.border} strokeWidth={1} />
        })}
        {angles.map((a, i) => {
          const end = pt(a, R)
          return <line key={i} x1={CX} y1={CY} x2={end.x} y2={end.y}
            stroke={C.border} strokeWidth={1} />
        })}
        <polygon points={polygon}
          fill={C.primary} fillOpacity={0.2}
          stroke={C.primary} strokeWidth={2.5} />
        {dataPoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={5}
            fill={C.primary} stroke="white" strokeWidth={2} />
        ))}
        {AXES.map((ax, i) => {
          const labelPt = pt(angles[i], R + 22)
          // ax.key === 'separability' can genuinely be 0 (not yet loaded)
          // or a real 0% score post-PCA — `scores[ax.key]` being null/
          // undefined (never fetched at all) is the ONLY case that should
          // ever read "PCA pending"; a real, computed 0 is a real 0.
          const raw = scores[ax.key]
          const score = Math.round(raw || 0)
          const isPending = ax.key === 'separability' && (raw === null || raw === undefined || raw === 0)
          return (
            <g key={i}>
              <text x={labelPt.x} y={labelPt.y - 4}
                textAnchor="middle" fontSize={11} fontWeight={700} fill={C.text}>
                {ax.label}
              </text>
              <text x={labelPt.x} y={labelPt.y + 11}
                textAnchor="middle" fontSize={10} fill={C.muted}>
                {isPending ? 'PCA pending' : `${score}%`}
              </text>
            </g>
          )
        })}
        {grids.map(g => (
          <text key={g} x={CX + 4} y={CY - g/100*R + 4}
            fontSize={8} fill={C.muted}>{g}%</text>
        ))}
        <text x={CX} y={CY - 8} textAnchor="middle"
          fontSize={28} fontWeight={900} fill={C.primary}>{Math.round(scores.overall || 0)}</text>
        <text x={CX} y={CY + 10} textAnchor="middle"
          fontSize={10} fontWeight={600} fill={C.muted}>OVERALL</text>
      </svg>

      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: C.text, marginBottom: 12 }}>
          Dataset Quality Summary
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>
          Each axis measures one dimension of data readiness.
          A large, regular {isClustering ? 'shape' : 'pentagon'} = excellent ML-ready dataset.
        </div>
        {[
          ['Completeness', 'Fraction of non-null values across all columns'],
          ...(isClustering ? [] : [isRegression
            ? ['Skew', 'How symmetric the target\'s distribution is (low skew = ML-ready)']
            : ['Balance', 'How evenly the target classes are distributed']]),
          ['Normality',    '% of features with |skewness| < 1'],
          ['Separability', 'Class separation score (from PCA — load below)'],
          ['Cleanliness',  '% of rows free from IQR-detected outliers'],
        ].map(([name, desc]) => (
          <div key={name} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%',
              background: C.primary, marginTop: 4, flexShrink: 0 }} />
            <div>
              <span style={{ fontWeight: 700, fontSize: 12, color: C.text }}>{name}:</span>
              <span style={{ fontSize: 12, color: C.muted }}> {desc}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MINI HISTOGRAM — small chart for the distribution grid
// ─────────────────────────────────────────────────────────────────────────────
const MiniHistogram = ({ col, histEntry, diagnostic, showOriginal }) => {
  const { C } = useTheme()
  const SEV = { error: C.danger, warning: C.warning, info: C.primary, ok: C.success }
  const badgeColor = SEV[diagnostic?.severity || 'ok']

  // Backend now always returns an entry per numeric column (even a
  // constant/all-NaN one), with empty counts/bin_mids in that case, so a
  // column can never silently vanish from this grid the way it used to —
  // it renders this explicit card instead, telling the user WHY there's no
  // chart rather than leaving an unexplained gap where a histogram should be.
  if (!histEntry?.current?.counts?.length) {
    return (
      <div style={{ background: C.card, borderRadius: 12, padding: '12px 14px',
        border: `1px solid ${C.border}`, boxShadow: shadow2 }}>
        <div style={{ fontWeight: 700, fontSize: 11, color: C.text, wordBreak: 'break-word', marginBottom: 6 }}>{col}</div>
        <div style={{ fontSize: 10, color: C.muted, padding: '18px 0', textAlign: 'center' }}>
          No variation to display
        </div>
      </div>
    )
  }

  const data = histEntry.current.counts.map((c, i) => ({
    mid: histEntry.current.bin_mids[i],
    current: c,
    original: histEntry.original?.counts[i] || 0,
  }))

  return (
    <div style={{ background: C.card, borderRadius: 12, padding: '12px 14px',
      border: `1px solid ${C.border}`, boxShadow: shadow2,
      borderTop: `3px solid ${badgeColor}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 11, color: C.text, wordBreak: 'break-word' }}>{col}</div>
        <div style={{ fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 5,
          background: `${badgeColor}18`, color: badgeColor, flexShrink: 0, marginLeft: 4, whiteSpace: 'nowrap' }}>
          {diagnostic?.title || 'OK'}
        </div>
      </div>
      {/* Same chart shape as Diagnose.jsx's own per-column MiniHistogram
          (real XAxis/YAxis showing actual values, CartesianGrid) — this
          page's version previously had no axis at all, so bin positions
          only ever meant anything via the tooltip. barGap=-barSize collapses
          Recharts' default side-by-side grouping of the two Bar series so
          they sit at the exact same x position: without it, "original" and
          "current" render next to each other (and can visually collide/hide
          one another at this bar width) instead of the intended semi-
          transparent overlay — original (taller, pre-cleaning) visible
          behind current wherever it exceeds current's height. */}
      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barSize={5} barGap={-5}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.faint} />
          <XAxis dataKey="mid" tick={{ fontSize: 8, fill: C.muted }} tickFormatter={v => Number(v).toFixed(1)} />
          <YAxis tick={{ fontSize: 8, fill: C.muted }} width={24} />
          {showOriginal && histEntry.original && (
            <Bar dataKey="original" fill={C.danger} opacity={0.6} radius={[1,1,0,0]} />
          )}
          <Bar dataKey="current" fill={C.primary} radius={[1,1,0,0]} opacity={0.85} />
          <Tooltip contentStyle={{ fontSize: 10, borderRadius: 6 }}
            formatter={(v) => [v, 'count']}
            labelFormatter={(l) => `Value ≈ ${Number(l).toFixed(1)}`} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SKEWNESS COMPARISON CHART — now lives in the Quality section (moved from
// Before vs After, which shows class distribution instead — see Section C).
// ─────────────────────────────────────────────────────────────────────────────
const SkewnessChart = ({ current, original }) => {
  const { C } = useTheme()
  if (!current?.length) return null
  const data = current.map(c => {
    const orig = original?.find(o => o.feature === c.feature)
    return {
      feature: c.feature.length > 12 ? c.feature.slice(0,10)+'…' : c.feature,
      current: c.skew,
      original: orig?.skew ?? null,
      severe: c.severe,
    }
  }).slice(0, 12)

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ left: 80, right: 30 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.faint} />
        <XAxis type="number" tick={{ fontSize: 10, fill: C.muted }} />
        <YAxis dataKey="feature" type="category" tick={{ fontSize: 10, fill: C.muted }} width={80} />
        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${C.border}` }} />
        <ReferenceLine x={0} stroke={C.border} />
        <ReferenceLine x={1} stroke={C.warning} strokeDasharray="4,2" />
        <ReferenceLine x={-1} stroke={C.warning} strokeDasharray="4,2" />
        {original?.length > 0 && (
          <Bar dataKey="original" name="Before" fill={C.danger} opacity={0.6} radius={[0,3,3,0]} />
        )}
        <Bar dataKey="current" name="After" radius={[0,3,3,0]}>
          {data.map((d, i) => (
            <Cell key={i}
              fill={d.severe ? C.warning : C.primary}
              opacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASS DISTRIBUTION COMPARISON — before vs after side-by-side bars
// ─────────────────────────────────────────────────────────────────────────────
const ClassCompare = ({ current, original }) => {
  const { C } = useTheme()
  const render = (dist, title, accent) => (
    <div style={{ flex: 1, padding: '14px 16px',
      background: accent === C.primary ? C.primarySoft : C.faint,
      border: `1px solid ${accent === C.primary ? C.primary + '33' : C.border}`,
      borderRadius: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
        letterSpacing: 1, color: accent, marginBottom: 10 }}>{title}</div>
      <div style={{ fontWeight: 800, fontSize: 16, color: C.text, marginBottom: 10 }}>
        {dist.reduce((s, d) => s + d.count, 0).toLocaleString()} rows
      </div>
      {dist.map((cls, i) => (
        <div key={cls.class} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
            <span style={{ fontWeight: 600, color: C.text }}>Class {cls.class}</span>
            <span style={{ color: C.muted }}>{cls.pct}% · {cls.count.toLocaleString()}</span>
          </div>
          <div style={{ height: 8, background: 'rgba(127,127,127,0.15)', borderRadius: 4 }}>
            <div style={{ width: `${cls.pct}%`, height: '100%',
              background: CLASS_COLORS[i % CLASS_COLORS.length], borderRadius: 4,
              transition: 'width 0.6s ease' }} />
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {original?.length > 0 && render(original, 'Before Preprocessing', C.muted)}
      {current?.length > 0 && render(current, 'After Preprocessing', C.primary)}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL ASSESSMENT CARD
// ─────────────────────────────────────────────────────────────────────────────
const SignalCard = ({ signal }) => {
  const { C } = useTheme()
  if (!signal) return null
  const gradeColor = signal.grade === 'Excellent' ? C.success
    : signal.grade === 'Good' ? C.primary
    : signal.grade === 'Fair' ? C.warning : C.danger

  return (
    <div style={{ background: C.card, borderRadius: cardR, padding: '24px 28px',
      boxShadow: shadow, border: `1px solid ${C.border}`, position: 'relative', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', top: -40, right: -40, width: 160, height: 160,
        borderRadius: '50%', background: `${gradeColor}08`, pointerEvents: 'none',
      }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 52, fontWeight: 900, color: gradeColor, lineHeight: 1 }}>
            {signal.score}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: gradeColor, marginTop: 2 }}>
            /100 · {signal.grade}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
            ML Readiness Score
          </div>
          <div style={{ height: 16, background: C.faint, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ width: `${signal.score}%`, height: '100%',
              background: `linear-gradient(90deg, ${gradeColor}cc, ${gradeColor})`,
              borderRadius: 8, transition: 'width 1s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.muted, marginTop: 4 }}>
            <span>Weak</span><span>Fair</span><span>Good</span><span>Excellent</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {signal.strengths.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.success,
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              ✓ Strengths
            </div>
            {signal.strengths.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 7, alignItems: 'flex-start' }}>
                <span style={{ color: C.success, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
                <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{s}</span>
              </div>
            ))}
          </div>
        )}
        {signal.warnings.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.warning,
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              ⚠ Watch Out
            </div>
            {signal.warnings.map((w, i) => (
              <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 7, alignItems: 'flex-start' }}>
                <span style={{ color: C.warning, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>⚠</span>
                <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{w}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ALGORITHM RECOMMENDATION TABLE
// ─────────────────────────────────────────────────────────────────────────────
const AlgoTable = ({ recs }) => {
  const { C } = useTheme()
  if (!recs?.length) return null
  const STAR_COLOR = [null, C.danger, C.warning, C.warning, C.primary, C.success]
  const th = { padding: '10px 14px', textAlign: 'left', fontSize: 10,
    fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }
  const td = { padding: '11px 14px', color: C.text }
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.faint }}>
            <th style={th}>Algorithm</th>
            <th style={th}>Fit</th>
            <th style={th}>Why</th>
          </tr>
        </thead>
        <tbody>
          {recs.map((rec) => (
            <tr key={rec.name}
              style={{ borderTop: `1px solid ${C.border}`,
                background: rec.stars === 5 ? C.successSoft : 'transparent' }}>
              <td style={td}>
                <span style={{ fontWeight: 700, color: C.text }}>{rec.name}</span>
                {rec.stars === 5 && (
                  <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 8, padding: '1px 7px',
                    borderRadius: 6, background: C.successSoft, color: C.success }}>
                    Recommended
                  </span>
                )}
              </td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                {Array.from({ length: 5 }, (_, si) => (
                  <span key={si} style={{
                    fontSize: 14,
                    color: si < rec.stars ? STAR_COLOR[rec.stars] : C.faint,
                  }}>★</span>
                ))}
              </td>
              <td style={{ ...td, color: C.muted, fontSize: 12 }}>{rec.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STATISTICS TABLE
// ─────────────────────────────────────────────────────────────────────────────
const StatisticsTable = ({ describeData }) => {
  const { C } = useTheme()
  if (!describeData) return null
  const cols = Object.keys(describeData)
  if (!cols.length) return null
  const STATS = ['count','mean','std','min','25%','50%','75%','max']
  const th = { padding: '10px 14px', textAlign: 'left', fontSize: 10,
    fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }
  const td = { padding: '11px 14px', color: C.text }
  return (
    <div style={{ overflowX: 'auto', borderRadius: 12, border: `1px solid ${C.border}` }}>
      <table style={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: 12 }}>
        <thead>
          <tr style={{ background: C.faint }}>
            <th style={{ ...th, position: 'sticky', left: 0, background: C.faint, minWidth: 80 }}>Stat</th>
            {cols.map(col => <th key={col} style={{ ...th, minWidth: 110 }}>{col}</th>)}
          </tr>
        </thead>
        <tbody>
          {STATS.map((stat, ri) => (
            <tr key={stat} style={{ borderTop: `1px solid ${C.border}`,
              background: ri % 2 === 0 ? C.card : C.faint }}>
              <td style={{ ...td, fontWeight: 700, fontSize: 11, color: C.muted,
                position: 'sticky', left: 0,
                background: ri % 2 === 0 ? C.card : C.faint }}>
                {stat}
              </td>
              {cols.map(col => {
                const v = describeData[col]?.[stat]
                return (
                  <td key={col} style={{ ...td, fontFamily: 'monospace' }}>
                    {v != null ? Number(v).toFixed(3) : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION NAVIGATOR (sticky) — 'correlations' removed entirely (see file
// header note); 'fingerprint' renamed to 'summary' to match the section's
// new, plainer title.
// ─────────────────────────────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'summary',        label: 'Summary',          icon: '◆' },
  { id: 'beforeafter',    label: 'Before vs After',  icon: '⇄' },
  { id: 'distributions',  label: 'Distributions',    icon: '📊' },
  { id: 'separability',   label: 'Separability',     icon: '⊕' },
  { id: 'quality',        label: 'Quality',          icon: '✓' },
  { id: 'signal',         label: 'ML Signal',        icon: '🎯' },
]

const SectionNav = ({ active }) => {
  const { C } = useTheme()
  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: C.card, opacity: 0.98, backdropFilter: 'blur(8px)',
      borderBottom: `1px solid ${C.border}`,
      display: 'flex', gap: 0, overflowX: 'auto',
      padding: '0 32px',
    }}>
      {SECTIONS.map(s => (
        <button key={s.id} onClick={() => scrollTo(s.id)}
          style={{
            padding: '12px 16px', border: 'none', background: 'none',
            fontSize: 12, fontWeight: active === s.id ? 700 : 500,
            color: active === s.id ? C.primary : C.muted,
            cursor: 'pointer', whiteSpace: 'nowrap',
            borderBottom: active === s.id ? `2.5px solid ${C.primary}` : '2.5px solid transparent',
            transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 5,
          }}>
          <span>{s.icon}</span> {s.label}
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function DataReadinessPage({ projectData, onNext, onUpdateData,
  getDisplayPath, isStepDone, versions, active, onNavigate, furthestOrder }) {
  const { C } = useTheme()

  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [pcaData, setPcaData] = useState(null)
  const [pcaLoading, setPcaLoad] = useState(false)
  const [error,   setError]   = useState('')
  // `error` stays load-only (gates the full-page early-return below —
  // correct there, since nothing has rendered yet). loadPCA runs after the
  // main analysis already rendered the whole page, so its failure must
  // show inline in the Separability Check card, not blank everything else.
  const [pcaError, setPcaError] = useState('')
  const [activeSection, setActiveSection] = useState('summary')
  const [showOriginalDist, setShowOrigDist] = useState(false)

  // This page never registers its own version (it's read-only — nothing to
  // Apply), so getDisplayPath('data_readiness') always falls back to
  // whatever the latest real step's output is. Having its own slot in
  // STEP_ORDER (between sampling and feature_selection) still matters: it's
  // what lets this fallback chain correctly find "sampling" (or whichever
  // upstream step actually ran) without hardcoding a specific step name.
  const filePath = getDisplayPath ? getDisplayPath('data_readiness') : projectData?.filePath
  const isClustering = projectData?.taskType === 'clustering'
  const isRegression = projectData?.taskType === 'regression'

  // The true original upload — for every "before vs after" comparison —
  // read directly from the version array rather than requiring a caller to
  // pre-compute it into projectData (one less place to wire incorrectly).
  const origPath = (versions || []).find(v => v.stepName === 'upload')?.filePath
    || projectData?.originalFilePath || null

  useEffect(() => {
    if (!filePath) return
    setLoading(true)
    callViz('analyze', {
      file_path:          filePath,
      // Real bug, fixed: this used to be `origPath && origPath !== filePath
      // ? origPath : null` — withholding the original file entirely
      // whenever nothing had changed it yet (e.g. arriving here straight
      // from Cleaning without ever running "Remove Missing Values"). The
      // backend then has no `original_file_path` to read, so `original` in
      // its response is `null`, and the Missing Values Before/After chart's
      // `origMiss[c] || 0` fallback makes every "Before" bar show 0 — wrong
      // whenever the real original dataset actually had missing values.
      // Always send it when it exists; the backend reading the same file
      // twice when nothing's changed yet is a trivial cost, not a bug.
      original_file_path: origPath || null,
      target_column:      projectData?.targetColumn || null,
      task_type:          projectData?.taskType || null,
    })
    .then(setData)
    .catch(e => setError(e.message))
    .finally(() => setLoading(false))
  }, [filePath, origPath])

  // Intersection observer for active section tracking
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) setActiveSection(e.target.id)
      }
    }, { rootMargin: '-40% 0px -50% 0px', threshold: 0 })
    SECTIONS.forEach(s => {
      const el = document.getElementById(s.id)
      if (el) obs.observe(el)
    })
    return () => obs.disconnect()
  }, [data])

  const loadPCA = useCallback(async () => {
    if (pcaData || pcaLoading) return
    setPcaError('')
    setPcaLoad(true)
    try {
      const result = await callViz('pca', {
        file_path: filePath,
        target_column: projectData?.targetColumn || null,
      })
      setPcaData(result)
      if (result.silhouette > 0 && data) {
        setData(prev => {
          const nextFp = { ...prev.fingerprint, separability: result.silhouette }
          // 5 axes (4 for clustering — Balance dropped, see the backend's
          // compute_fingerprint for why; signal_strength deliberately
          // excluded), matching the radar. Mirrors the backend's own
          // averaging rule exactly (positive scores only) so `overall`
          // doesn't jump inconsistently the moment this client-side
          // recompute takes over from the server's initial value.
          const AXIS_KEYS = isClustering
            ? ['completeness', 'normality', 'separability', 'cleanliness']
            : ['completeness', 'balance', 'normality', 'separability', 'cleanliness']
          const vals = AXIS_KEYS.map(k => nextFp[k] || 0)
          const positive = vals.filter(v => v > 0)
          nextFp.overall = Math.round(positive.reduce((s,v) => s+v, 0) / Math.max(positive.length, 1))

          // The Pre-Training Signal card's score/grade come from the
          // backend's build_signal_assessment(), computed BEFORE PCA ran
          // (separability was still 0 then) — without this, the KPI strip
          // and radar update to the new overall once PCA loads, but the
          // Signal card keeps showing the stale pre-PCA number right next
          // to it, which reads as a contradiction on the same page. Mirrors
          // the backend's own grade thresholds exactly.
          const nextScore = nextFp.overall
          const nextGrade = nextScore >= 85 ? 'Excellent' : nextScore >= 70 ? 'Good' : nextScore >= 55 ? 'Fair' : 'Weak'
          const nextSignal = prev.signal ? { ...prev.signal, score: nextScore, grade: nextGrade } : prev.signal

          return { ...prev, fingerprint: nextFp, signal: nextSignal }
        })
      }
    } catch (e) { setPcaError(e.message) }
    finally { setPcaLoad(false) }
  }, [filePath, pcaData, pcaLoading, data, projectData?.targetColumn])

  if (loading) return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <TopNav active={active || 'data_readiness'} onNavigate={onNavigate} furthestOrder={furthestOrder} taskType={projectData?.taskType} />
      <div style={{ textAlign: 'center', padding: '80px 0', color: C.muted }}>
        <div style={{ fontSize: 28, marginBottom: 12, display: 'inline-block',
          animation: 'spin 1s linear infinite' }}>⚙</div>
        <p>Running full preprocessing analysis…</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )
  if (error) return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <TopNav active={active || 'data_readiness'} onNavigate={onNavigate} furthestOrder={furthestOrder} taskType={projectData?.taskType} />
      <div style={{ background: C.dangerSoft, border: `1px solid ${C.danger}`,
        borderRadius: 12, padding: 20, color: C.danger, margin: 32 }}>⚠ {error}</div>
    </div>
  )
  if (!data) return null

  const { current, original,
          fingerprint, signal, algorithm_recs: algoRecs,
          algorithm_recs_task_type: algoTaskType, target_quality: targetQuality } = data

  const numCols = current?.numeric_cols || []

  const pcaByClass = {}
  if (pcaData?.scatter) {
    pcaData.scatter.forEach(pt => {
      if (!pcaByClass[pt.class]) pcaByClass[pt.class] = []
      pcaByClass[pt.class].push(pt)
    })
  }
  const pcaClassKeys = Object.keys(pcaByClass)
  const manyClasses = pcaClassKeys.length > 6

  return (
    <div style={{ background: C.bg, minHeight: '100vh', paddingBottom: 60 }}>
      <TopNav active={active || 'data_readiness'} onNavigate={onNavigate} furthestOrder={furthestOrder} taskType={projectData?.taskType} />
      <VersionsBar versions={versions} />

      {/* ── Page header — no Continue button here anymore, see file header
          note and the bottom-of-page button further down. ──────────────── */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: '20px 32px', display: 'flex', justifyContent: 'space-between',
        alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: C.text, marginBottom: 4 }}>
            Visualization
          </h1>
          <p style={{ fontSize: 13, color: C.muted }}>
            A complete view of how preprocessing transformed your dataset — before continuing to training.
          </p>
        </div>
      </div>

      {/* ── KPI Strip ─────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 32px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
          <MetricCard icon="▤" label="Rows" value={current.row_count.toLocaleString()}
            accent={C.primary}
            trend={original?.row_count ? (current.row_count < original.row_count ? 'negative' : 'neutral') : null}
            trendLabel={original?.row_count ? `was ${original.row_count.toLocaleString()}` : ''}
            sub="after all cleaning stages" />
          <MetricCard icon="▥" label="Columns" value={current.col_count}
            accent="#8b5cf6" sub="including engineered features" />
          <MetricCard icon="●" label="Completeness" value={`${fingerprint?.completeness}%`}
            accent={fingerprint?.completeness === 100 ? C.success : C.warning}
            trend={fingerprint?.completeness === 100 ? 'positive' : 'negative'}
            trendLabel={fingerprint?.completeness === 100 ? 'No missing' : 'Some missing'}
            sub="" />
          {/* level/color come from the SAME shared check_target_balance()
              verdict the Sampling page shows (see backend's
              utils/balance_checker.py + constants/balanceLevels.js) — a
              dataset gets one consistent balance judgment across the whole
              app, not a second, independently-bucketed opinion here. */}
          <MetricCard icon="⚖" label={isClustering ? 'Class Balance' : targetQuality?.is_classification === false ? 'Target Skew' : 'Class Balance'}
            value={isClustering ? getBalanceLevelConfig(C).clustering.label
              : !targetQuality ? 'No Target'
              : (targetQuality.is_classification === false ? getSkewLevelConfig(C) : getBalanceLevelConfig(C))[targetQuality.level]?.label}
            accent={isClustering ? getBalanceLevelConfig(C).clustering.color
              : !targetQuality ? C.muted
              : (targetQuality.is_classification === false ? getSkewLevelConfig(C) : getBalanceLevelConfig(C))[targetQuality.level]?.color}
            sub={
              isClustering ? 'Not applicable — clustering has no target to balance'
              : !targetQuality ? 'No target set'
              : targetQuality.is_classification === false ? `skew ${targetQuality.skewness?.toFixed(2)}`
              : current.class_dist?.length > 0 ? current.class_dist.map(d => `${d.class}: ${d.pct}%`).join(' / ') : ''
            } />
          <MetricCard icon="✓" label="ML Readiness"
            value={`${Math.round(fingerprint?.overall || 0)}/100`}
            accent={signal?.grade === 'Excellent' ? C.success : signal?.grade === 'Good' ? C.primary : C.warning}
            sub={signal?.grade || 'Calculating…'} />
        </div>
      </div>

      {/* ── Sticky Section Navigator ─────────────────────────────────────── */}
      <SectionNav active={activeSection} />

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div style={{ padding: '28px 32px 0' }}>

        {/* ── A. Summary ───────────────────────────────────────────────────── */}
        <Section id="summary" icon="◆" accent={C.primary}
          label="Summary"
          sub={`Your dataset quality across ${isClustering ? 4 : 5} ML-readiness dimensions`}>
          <ChartCard style={{ padding: '28px 32px' }}>
            <DataFingerprint scores={fingerprint || {}} isClustering={isClustering} isRegression={isRegression} />
          </ChartCard>
        </Section>

        {/* ── B. Before vs After ──────────────────────────────────────────── */}
        <Section id="beforeafter" icon="⇄" accent="#8b5cf6"
          label="Before vs After Preprocessing"
          sub="How each stage changed your data">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginBottom: 16 }}>
            {/* Skewness moved to the Quality section (below, alongside
                Anomaly Score) — replaced here with class distribution,
                which belongs in a "before vs after" comparison far more
                directly than skewness ever did. */}
            {(current.class_dist?.length > 0 || original?.class_dist?.length > 0) ? (
              <ChartCard title="Target Class Distribution — Before vs After"
                sub="How sampling and preprocessing changed your class balance.">
                <ClassCompare current={current.class_dist} original={original?.class_dist} />
              </ChartCard>
            ) : (
              <ChartCard title="Target Class Distribution">
                <div style={{ textAlign: 'center', padding: '24px 0', color: C.muted, fontSize: 13 }}>
                  {targetQuality?.is_classification === false
                    ? "This target is continuous (regression) — there are no discrete classes to compare. See Target Skew in the KPI strip above instead."
                    : "No target column set — class distribution not available."}
                </div>
              </ChartCard>
            )}
            <ChartCard title="Missing Values — Before & After"
              sub="Should be 0 after cleaning.">
              {(() => {
                const cols = Object.keys(current.missing_per_col)
                const origMiss = original?.missing_per_col || {}
                const chartData = cols.filter(c => (origMiss[c] || 0) > 0 || current.missing_per_col[c] > 0)
                  .map(c => ({ col: c.length > 12 ? c.slice(0,10)+'…' : c,
                    before: origMiss[c] || 0, after: current.missing_per_col[c] || 0 }))
                if (!chartData.length) return (
                  <div style={{ textAlign: 'center', padding: '30px 0', color: C.success, fontWeight: 700 }}>
                    ✓ No missing values in current dataset
                  </div>
                )
                return (
                  // barSize widened slightly + barCategoryGap tightened (bars
                  // read as too thin at the default auto-sizing); "before"
                  // recolored from grey to red per explicit request.
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} layout="vertical" barSize={12} barCategoryGap="30%" margin={{ left: 80 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis dataKey="col" type="category" tick={{ fontSize: 10 }} width={80} />
                      <Tooltip />
                      {/* minPointSize renders a small non-zero stub for a
                          literal 0 value — without it a fully-cleaned
                          column's "After" bar has 0 width and is
                          indistinguishable from that column not being
                          plotted at all. This is exactly the case that
                          matters most here: after "Remove Missing Values"
                          runs, every After bar SHOULD be 0, and that's the
                          one result the user most needs to visually confirm
                          actually happened, not just infer from its absence. */}
                      <Bar dataKey="before" name="Before" fill={C.danger} radius={[0,3,3,0]} minPointSize={3} />
                      <Bar dataKey="after" name="After" fill={C.success} radius={[0,3,3,0]} opacity={0.8} minPointSize={3} />
                    </BarChart>
                  </ResponsiveContainer>
                )
              })()}
            </ChartCard>
          </div>
        </Section>

        {/* ── C. Distribution Health ──────────────────────────────────────── */}
        <Section id="distributions" icon="📊" accent={C.warning}
          label="Distribution Health"
          sub="Per-column distributions after all preprocessing stages">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
              color: C.muted, cursor: 'pointer' }}>
              <input type="checkbox" checked={showOriginalDist}
                onChange={e => setShowOrigDist(e.target.checked)} />
              Show original distribution (red overlay)
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 12, marginBottom: 24 }}>
            {numCols.map(col => (
              <MiniHistogram key={col} col={col}
                histEntry={current.hist_data?.[col]}
                diagnostic={current.diagnostics?.[col]}
                showOriginal={showOriginalDist} />
            ))}
          </div>
        </Section>

        {/* ── D. Separability Check ───────────────────────────────────────── */}
        <Section id="separability" icon="⊕" accent="#8b5cf6"
          label="Separability Check"
          sub="PCA reveals how well the classes can be distinguished in reduced dimensions">
          {!pcaData ? (
            <div style={{ textAlign: 'center', padding: '40px 0',
              background: C.card, borderRadius: cardR, border: `1px solid ${C.border}`, boxShadow: shadow2 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⊕</div>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 6 }}>
                PCA Analysis
              </div>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 20, maxWidth: 420, margin: '0 auto 20px' }}>
                PCA projects your dataset to 2D to reveal class separation and explained variance.
                This computation takes a few seconds.
              </div>
              <button onClick={loadPCA} disabled={pcaLoading}
                style={{ padding: '11px 28px', borderRadius: 10, border: 'none',
                  background: pcaLoading ? C.muted : '#8b5cf6',
                  color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {pcaLoading ? '⏳ Computing PCA…' : '▶ Load PCA Analysis'}
              </button>
              {pcaError && (
                <div style={{ marginTop: 16, textAlign: 'left', background: C.dangerSoft,
                  border: `1px solid ${C.danger}`, borderRadius: 10, padding: '10px 14px',
                  color: C.danger, fontSize: 13 }}>
                  ⚠ {pcaError}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(260px,300px)', gap: 16 }}>
              <ChartCard title="PCA — 2D Class Projection"
                sub={`PC1 (${pcaData.scree[0]?.variance_pct}%) + PC2 (${pcaData.scree[1]?.variance_pct || 0}%) = ${pcaData.explained_2pc}% of total variance explained.`}>
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.faint} />
                    <XAxis dataKey="x" type="number" name="PC1"
                      tick={{ fontSize: 10, fill: C.muted }}
                      label={{ value: 'PC1', position: 'insideBottomRight', fontSize: 10 }} />
                    <YAxis dataKey="y" type="number" name="PC2"
                      tick={{ fontSize: 10, fill: C.muted }}
                      label={{ value: 'PC2', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                    <ZAxis range={[18, 18]} />
                    <Tooltip formatter={(v) => Number(v).toFixed(3)}
                      contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    {pcaClassKeys.map((cls, ci) => (
                      <Scatter key={cls} name={`Class ${cls}`}
                        data={pcaByClass[cls]}
                        fill={CLASS_COLORS[ci % CLASS_COLORS.length]}
                        opacity={0.6} />
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
                {pcaData.silhouette > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ padding: '6px 12px', borderRadius: 8, background: C.primarySoft,
                      fontSize: 12, color: C.primary, fontWeight: 700, display: 'flex', alignItems: 'center' }}>
                      Silhouette Score: {pcaData.silhouette.toFixed(1)}%
                      <InfoIcon itemsTitle="Silhouette Score" items={[
                        { label: 'What It Measures', desc: 'How well-separated the classes are in this 2D PCA projection — how tightly each class clusters together vs. how far it sits from other classes.' },
                        { label: 'Reading The Score', desc: '> 50%: strong separation, model should perform well.\n25-50%: moderate separation, some classes overlap.\n< 25%: weak separation, classes are not linearly distinguishable in PCA space.' },
                        { label: 'Caveat', desc: 'Computed on only 2 principal components — a low score here doesn\'t always mean a low-dimensional dataset is unusable, since more components may separate classes better than PC1+PC2 alone.' },
                      ]} />
                    </div>
                    <span style={{ fontSize: 12, color: C.muted }}>
                      {pcaData.silhouette > 50 ? 'Strong class separation — model should perform well.' :
                       pcaData.silhouette > 25 ? 'Moderate separation — some classes overlap.' :
                       'Weak separation — classes are not linearly distinguishable in PCA space.'}
                    </span>
                  </div>
                )}
                {/* Legend below the graph — for a regression dataset (or any
                    high-cardinality target), this can be hundreds of
                    "classes". Scrollable, bordered container ONLY once
                    there are more than 6; a normal classification target's
                    short legend is untouched. */}
                {manyClasses ? (
                  <div style={{
                    maxHeight: 80, overflowY: 'auto', marginTop: 8,
                    display: 'flex', flexWrap: 'wrap', gap: 8,
                    padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8,
                  }}>
                    {pcaClassKeys.map((cls, ci) => (
                      <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%',
                          background: CLASS_COLORS[ci % CLASS_COLORS.length], flexShrink: 0 }} />
                        <span style={{ color: C.muted }}>{cls}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
                    {pcaClassKeys.map((cls, ci) => (
                      <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%',
                          background: CLASS_COLORS[ci % CLASS_COLORS.length] }} />
                        <span style={{ color: C.muted }}>Class {cls}</span>
                      </div>
                    ))}
                  </div>
                )}
              </ChartCard>

              <ChartCard title={<>Scree Plot<InfoIcon itemsTitle="Scree Plot" items={[
                  { label: 'What It Shows', desc: 'Each bar is one principal component (PC) — a combined direction of your original features. Bar height = % of total variance that PC explains on its own.' },
                  { label: 'Cumulative Line', desc: 'The green line adds up variance explained as more PCs are included. The amber dashed line marks 80% — a common "good enough" cutoff.' },
                  { label: 'Why It Matters', desc: 'Few PCs needed to reach 80% = features are highly correlated/redundant. Many PCs needed = features each carry distinct information.' },
                ]} /></>}
                sub={`80% of variance captured by ${pcaData.n_components_80} PCs.`}>
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={pcaData.scree.slice(0,8)} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.faint} />
                    <XAxis dataKey="pc" tick={{ fontSize: 10, fill: C.muted }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10, fill: C.muted }} />
                    <YAxis yAxisId="right" orientation="right" domain={[0,100]}
                      tick={{ fontSize: 10, fill: C.muted }} />
                    <Tooltip contentStyle={{ fontSize: 10, borderRadius: 8 }} />
                    <Bar yAxisId="left" dataKey="variance_pct" name="Variance %"
                      fill={C.primary} radius={[3,3,0,0]} opacity={0.8} />
                    <Line yAxisId="right" dataKey="cumulative" name="Cumulative %"
                      stroke={C.success} strokeWidth={2} dot={{ r: 3 }} />
                    <ReferenceLine yAxisId="right" y={80} stroke={C.warning} strokeDasharray="4,2" />
                  </ComposedChart>
                </ResponsiveContainer>
                <div style={{ marginTop: 10, fontSize: 12, color: C.muted }}>
                  {pcaData.n_components_80 === 1
                    ? '1 PC captures 80%+ — the dataset is essentially 1-dimensional.'
                    : `First ${pcaData.n_components_80} PCs capture 80% of the information.`}
                </div>
              </ChartCard>
            </div>
          )}
        </Section>

        {/* ── E. Quality Confirmation ─────────────────────────────────────── */}
        <Section id="quality" icon="✓" accent={C.success}
          label="Quality Confirmation"
          sub="Final verification that preprocessing achieved its goals">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Missing Values — Final State was removed from here: it's
                already shown as "Missing Values — Before & After" in
                Section B above, so a second copy here was pure duplication
                on the same page. Skewness + Anomaly Score now fill the
                50/50 row on their own. */}
            <ChartCard title="Skewness After Preprocessing"
              sub="Amber dashed = |skew|=1 threshold. Features still above this may affect linear models.">
              <SkewnessChart current={current.skewness} original={original?.skewness} />
            </ChartCard>
            <ChartCard title={<>Anomaly Score Distribution<InfoIcon itemsTitle="Anomaly Score Distribution" items={[
                { label: 'What It Shows', desc: 'Each row gets an IsolationForest anomaly score from 0 (very unusual) to 1 (typical). This chart is a histogram of those scores across the dataset.' },
                { label: 'Reading The Shape', desc: 'Right-skewed toward 1 = most rows look normal, few anomalies remain. A cluster near 0 flags rows still worth reviewing.' },
                { label: 'Before vs After', desc: 'Red = distribution before cleaning. Blue = after. A rightward shift means cleaning removed or fixed anomalous rows.' },
              ]} /></>}
              sub="IsolationForest scores — right-skewed toward 1 = fewer anomalies remaining.">
              {current.iso_scores?.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={current.iso_scores} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
                      <XAxis dataKey="mid" tick={{ fontSize: 9, fill: C.muted }}
                        tickFormatter={v => Number(v).toFixed(2)} />
                      <YAxis tick={{ fontSize: 9, fill: C.muted }} />
                      <Tooltip contentStyle={{ fontSize: 10, borderRadius: 8 }}
                        formatter={(v) => [v, 'Rows']}
                        labelFormatter={v => `Score ≈ ${Number(v).toFixed(2)}`} />
                      {original?.iso_scores?.length > 0 && (
                        <Area data={original.iso_scores} dataKey="count" name="Before"
                          stroke={C.danger} fill={C.danger} fillOpacity={0.3}
                          strokeWidth={1.5} type="monotone" />
                      )}
                      <Area dataKey="count" name="After" stroke={C.primary}
                        fill={C.primary} fillOpacity={0.2}
                        strokeWidth={2} type="monotone" />
                    </AreaChart>
                  </ResponsiveContainer>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
                    Score near 1 = normal. Score near 0 = anomalous. Red = before cleaning.
                  </div>
                </>
              ) : (
                <div style={{ padding: '30px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>
                  Need at least 2 numeric columns and 20 rows for anomaly scoring.
                </div>
              )}
            </ChartCard>
          </div>
          <ChartCard title="Dataset Statistics"
            sub="Key statistical moments for every numeric column after all preprocessing.">
            <StatisticsTable describeData={current.describe} />
          </ChartCard>
        </Section>

        {/* ── F. Pre-Training Signal ──────────────────────────────────────── */}
        <Section id="signal" icon="🎯" accent={C.success}
          label="Pre-Training Signal Assessment"
          sub="Rule-based data readiness evaluation — no model training required">
          <SignalCard signal={signal} />
          <div style={{ marginTop: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 12 }}>
              Algorithm Fit Recommendations
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
              Rule-based guidance only — based on THIS dataset's actual size, balance, skewness, and
              correlation strength, scoped to {algoTaskType || 'classification'} algorithms since that's
              the task type set on the Upload page. Only algorithms available on the Train and Test page
              are shown, and the single best fit is starred highest. No model has been trained yet.
            </div>
            <AlgoTable recs={algoRecs} />
          </div>
        </Section>

      </div>

      {/* ── Bottom navigation — always at page bottom, never the header.
          See the standing rule in this file's header comment. ──────────── */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end',
        padding: '24px 32px', marginTop: 12,
        borderTop: `1px solid ${C.border}`,
      }}>
        <button
          onClick={() => onNext && onNext('feature_selection', {})}
          style={{
            padding: '12px 28px', borderRadius: 11, border: 'none',
            background: C.primary, color: 'white', fontWeight: 800,
            fontSize: 14, cursor: 'pointer',
            boxShadow: `0 6px 20px ${C.primary}44`,
          }}>
          Continue to Feature Selection →
        </button>
      </div>
    </div>
  )
}
