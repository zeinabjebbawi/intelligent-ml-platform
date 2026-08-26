/**
 * PRISM — Feature Selection Page
 * RULE: No SHAP. No model-derived insights. Statistical correlation/
 * association ONLY (Rule 2 — No Reaching Forward: SHAP needs a trained
 * model, which doesn't exist yet at this stage of the pipeline).
 *
 * Visuals: Correlation heatmap · Feature -> Target importance ranking ·
 * Redundancy-vs-Relevance scatter (the analyst signature visual) · Top-2
 * feature scatter · Pairplot · Checkbox feature list with one-hot grouping.
 *
 * Design: shares the app-wide theme system (../theme.jsx) and TopNav
 * (../components/TopNav.jsx), same convention as Encoding/FeatureEngineering/
 * Sampling/DataReadiness — not its own standalone light-only token set.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Cell, ResponsiveContainer, ReferenceLine,
  ScatterChart, Scatter, ZAxis,
} from 'recharts'
import { useTheme } from '../theme'
import TopNav from '../components/TopNav'
import SharedVersionsBar from '../components/VersionsBar'

const shadow2 = '0 2px 8px rgba(0,0,0,0.05)'
const cardR   = 14

// 127.0.0.1, not "localhost" — dual-stack landmine on this machine, see
// docs/PROJECT_HANDOFF.md §11.2.
const ML_API = 'http://127.0.0.1:8001'

const callFS = async (ep, body) => {
  const r = await fetch(`${ML_API}/feature-selection/${ep}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || `Error ${r.status}`) }
  return r.json()
}

const downloadFile = (filePath, filename) => {
  const url = `${ML_API}/cleaning/download?file_path=${encodeURIComponent(filePath)}&filename=${encodeURIComponent(filename)}`
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
}

const CLASS_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']
const TABLE_BODY_MAX_HEIGHT = 420

// ─────────────────────────────────────────────────────────────────────────────
// METRIC CARD — same rich style as DataReadiness.jsx's (left-border accent,
// decorative blob, icon pill) — the pattern explicitly preferred over plain
// bordered KPI boxes.
// ─────────────────────────────────────────────────────────────────────────────
const MetricCard = ({ label, value, sub, accent, icon }) => {
  const { C } = useTheme()
  const ac = accent || C.primary
  return (
    <div style={{
      background: C.card, borderRadius: cardR, padding: '18px 22px',
      position: 'relative', overflow: 'hidden',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)',
      borderLeft: `4px solid ${ac}`,
    }}>
      <div style={{ position: 'absolute', top: -28, right: -28, width: 80, height: 80,
        borderRadius: '50%', background: `${ac}12`, pointerEvents: 'none' }} />
      {icon && (
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 34, height: 34, borderRadius: 9, marginBottom: 8, background: `${ac}18`, fontSize: 15 }}>
          {icon}
        </div>
      )}
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
        letterSpacing: 1.6, color: C.muted, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 900, color: C.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.muted, marginTop: 5 }}>{sub}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART CARD
// ─────────────────────────────────────────────────────────────────────────────
const ChartCard = ({ title, sub, children, badge, style: extra }) => {
  const { C } = useTheme()
  return (
    <div style={{ background: C.card, borderRadius: cardR, padding: '18px 20px',
      boxShadow: shadow2, border: `1px solid ${C.border}`, ...extra }}>
      {(title || badge) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            {title && <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{title}</div>}
            {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
          </div>
          {badge}
        </div>
      )}
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CORRELATION HEATMAP — primary (high) -> card bg (0) -> danger (negative)
// ─────────────────────────────────────────────────────────────────────────────
const CorrelationHeatmap = ({ data, multicolPairs, targetCol, features }) => {
  const { C, dark } = useTheme()
  // `tierByName` looks up each feature's own strong/moderate/weak signal
  // (w.r.t. the target) so cells in the target's row/column can be
  // border-colored accordingly — green for strong, red for weak, matching
  // the same convention used in the redundancy-vs-relevance scatter and the
  // feature table. Computed unconditionally, before any early return, so
  // this hook call order never varies across renders (Rules of Hooks).
  const tierByName = useMemo(() => Object.fromEntries(
    (features || []).map(f => [f.name, f.signal_tier])
  ), [features])
  if (!data?.labels?.length) return null
  const { labels, matrix } = data
  // `data.labels` now includes the target column itself (backend change —
  // it used to be numeric features only), so its correlation with every
  // feature is visible directly in the grid.
  const targetIndex = labels.indexOf(targetCol)
  const N    = labels.length
  const CELL = Math.max(20, Math.min(52, 580 / N))
  const LBL  = 88

  const heatColor = (val) => {
    const v = Math.max(-1, Math.min(1, val))
    const base = dark ? [22, 27, 38] : [248, 250, 252] // C.cardAlt-ish neutral
    if (v >= 0) {
      const target = [45, 212, 191] // teal primary-ish, works in both themes as a saturated stop
      return `rgb(${Math.round(base[0] + (target[0] - base[0]) * v)},${Math.round(base[1] + (target[1] - base[1]) * v)},${Math.round(base[2] + (target[2] - base[2]) * v)})`
    }
    const a = Math.abs(v)
    const target = [248, 113, 113] // danger-ish red
    return `rgb(${Math.round(base[0] + (target[0] - base[0]) * a)},${Math.round(base[1] + (target[1] - base[1]) * a)},${Math.round(base[2] + (target[2] - base[2]) * a)})`
  }
  const heatTextColor = (val) => Math.abs(val) > 0.55 ? '#ffffff' : C.text

  const highPairs = new Set(
    multicolPairs
      .filter(p => p.severity === 'warning')
      .flatMap(p => [`${p.feature_a}||${p.feature_b}`, `${p.feature_b}||${p.feature_a}`])
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={N * CELL + LBL + 24} height={N * CELL + 82} style={{ display: 'block' }}>
        {labels.map((lbl, ci) => (
          <text key={ci}
            x={ci * CELL + CELL / 2 + LBL} y={70}
            textAnchor="end" fontSize={Math.min(11, CELL * 0.5)}
            fill={lbl === targetCol ? C.primary : C.muted}
            fontWeight={lbl === targetCol ? 700 : 400}
            transform={`rotate(-45,${ci * CELL + CELL / 2 + LBL},70)`}>
            {lbl.length > 14 ? lbl.slice(0, 12) + '…' : lbl}
          </text>
        ))}
        {labels.map((lbl, ri) => (
          <text key={ri} x={LBL - 4} y={ri * CELL + CELL / 2 + 75 + 4}
            textAnchor="end" fontSize={Math.min(11, CELL * 0.5)}
            fill={lbl === targetCol ? C.primary : C.muted}
            fontWeight={lbl === targetCol ? 700 : 400}>
            {lbl.length > 14 ? lbl.slice(0, 12) + '…' : lbl}
          </text>
        ))}
        {matrix.map((row, ri) =>
          row.map((val, ci) => {
            const isDiag  = ri === ci
            const pairKey = `${labels[ri]}||${labels[ci]}`
            const isHigh  = highPairs.has(pairKey) && !isDiag
            // Cells in the target's own row/column (never overlapping with
            // isHigh — multicol pairs are only ever computed between two
            // FEATURES, never involving the target) get a green/red border
            // reflecting the OTHER feature's own signal tier w.r.t. the
            // target — strong = green, weak = red, moderate = no border.
            const touchesTarget = targetIndex !== -1 && !isDiag && (ri === targetIndex || ci === targetIndex)
            const otherLabel = touchesTarget ? (ri === targetIndex ? labels[ci] : labels[ri]) : null
            const otherTier  = otherLabel ? tierByName[otherLabel] : null
            const targetBorder = otherTier === 'strong' ? C.success : otherTier === 'weak' ? C.danger : null
            const borderColor = isHigh ? C.warning : targetBorder
            return (
              <g key={`${ri}-${ci}`}>
                <rect
                  x={ci * CELL + LBL} y={ri * CELL + 75}
                  width={CELL - 1} height={CELL - 1}
                  fill={isDiag ? C.primary : heatColor(val)}
                  rx={CELL > 32 ? 3 : 1}
                  stroke={borderColor || 'transparent'}
                  strokeWidth={borderColor ? 2 : 0}
                />
                {CELL >= 30 && !isDiag && (
                  <text x={ci * CELL + CELL / 2 + LBL} y={ri * CELL + CELL / 2 + 75 + 4}
                    textAnchor="middle" fontSize={Math.min(9, CELL * 0.2)}
                    fill={heatTextColor(val)}>
                    {val.toFixed(2)}
                  </text>
                )}
                {isDiag && (
                  <text x={ci * CELL + CELL / 2 + LBL} y={ri * CELL + CELL / 2 + 75 + 4}
                    textAnchor="middle" fontSize={9} fill="white">1</text>
                )}
              </g>
            )
          })
        )}
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, fontSize: 11, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 50, height: 10, borderRadius: 3,
            background: `linear-gradient(90deg,${C.danger},${C.card},${C.primary})` }} />
          <span style={{ color: C.muted }}>-1 · · 0 · · +1</span>
        </div>
        {multicolPairs.some(p => p.severity === 'warning') && (
          <span style={{ color: C.warning, fontWeight: 700, fontSize: 11 }}>
            » yellow border = |r| ≥ 0.85 (multicollinearity warning)
          </span>
        )}
        {targetIndex !== -1 && (
          <>
            <span style={{ color: C.success, fontWeight: 700, fontSize: 11 }}>» green border = strong signal vs. target</span>
            <span style={{ color: C.danger, fontWeight: 700, fontSize: 11 }}>» red border = weak signal vs. target</span>
          </>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// REDUNDANCY vs RELEVANCE SCATTER — the analyst signature visual
// ─────────────────────────────────────────────────────────────────────────────
// True yellow, distinct from C.warning's amber/orange (used for "moderate")
// — "relevant but redundant" needs its own visually distinct color from
// "moderate signal", not to reuse the theme's single warning tone for both.
const YELLOW = '#eab308'

const RedundancyRelevanceChart = ({ data }) => {
  const { C } = useTheme()
  const [hovered, setHovered] = useState(null)
  if (!data?.length) return null

  const REC_COLORS = {
    strong: C.success, moderate: C.warning, redundant_high: YELLOW,
    weak: C.muted, weak_redundant: C.danger,
  }
  const REC_LABELS = {
    strong: 'Strong independent signal', moderate: 'Moderate signal',
    redundant_high: 'Relevant but redundant', weak: 'Weak signal',
    weak_redundant: 'Weak & redundant',
  }

  const W = 600, H = 320, PL = 60, PR = 24, PT = 24, PB = 48
  const scaleX = (v) => PL + v * (W - PL - PR)
  const scaleY = (v) => H - PB - v * (H - PT - PB)

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow: 'visible' }}>
        {/* Bottom-right: strong independent signals (green) */}
        <rect x={PL + (W - PL - PR) * 0.15} y={H / 2} width={(W - PL - PR) * 0.85} height={H / 2 - PB}
          fill={`${C.success}0a`} />
        {/* Top-right: relevant but redundant (yellow-tinted, matches the dot color) */}
        <rect x={PL + (W - PL - PR) * 0.15} y={PT} width={(W - PL - PR) * 0.85} height={H / 2 - PT}
          fill={`${YELLOW}0d`} />
        {/* Bottom-left: weak & independent (grey) */}
        <rect x={PL} y={H / 2} width={(W - PL - PR) * 0.15} height={H / 2 - PB}
          fill={`${C.muted}14`} />
        {/* Top-left: weak & redundant (red) */}
        <rect x={PL} y={PT} width={(W - PL - PR) * 0.15} height={H / 2 - PT}
          fill={`${C.danger}0d`} />
        <line x1={PL} y1={H - PB} x2={W - PR} y2={H - PB} stroke={C.border} strokeWidth={1.5} />
        <line x1={PL} y1={PT} x2={PL} y2={H - PB} stroke={C.border} strokeWidth={1.5} />
        <line x1={PL + (W - PL - PR) * 0.15} y1={PT} x2={PL + (W - PL - PR) * 0.15} y2={H - PB}
          stroke={C.border} strokeDasharray="4,3" strokeWidth={1} />
        <line x1={PL} y1={H / 2} x2={W - PR} y2={H / 2} stroke={C.border} strokeDasharray="4,3" strokeWidth={1} />
        <text x={PL + (W - PL - PR) * 0.57} y={H - PB - 8} fontSize={9} fill={C.success} fontWeight={700}>
          ✓ Strong Independent Signals
        </text>
        <text x={PL + (W - PL - PR) * 0.57} y={PT + 14} fontSize={9} fill={C.warning} fontWeight={700}>
          ⚠ Relevant but Redundant
        </text>
        <text x={PL + 8} y={H - PB - 8} fontSize={9} fill={C.muted}>Weak &amp; Independent</text>
        <text x={PL + 8} y={PT + 14} fontSize={9} fill={C.muted}>Weak &amp; Redundant</text>
        <text x={(W + PL) / 2} y={H - 4} textAnchor="middle" fontSize={11} fill={C.muted}>
          Relevance (|correlation with target|)
        </text>
        <text x={14} y={H / 2} textAnchor="middle" fontSize={11} fill={C.muted}
          transform={`rotate(-90,14,${H / 2})`}>
          Redundancy (max |r| with other features)
        </text>
        {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map(v => (
          <g key={v}>
            <line x1={scaleX(v)} y1={H - PB} x2={scaleX(v)} y2={H - PB + 4} stroke={C.border} />
            <text x={scaleX(v)} y={H - PB + 14} textAnchor="middle" fontSize={9} fill={C.muted}>{v.toFixed(1)}</text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1.0].map(v => (
          <g key={v}>
            <line x1={PL - 4} y1={scaleY(v)} x2={PL} y2={scaleY(v)} stroke={C.border} />
            <text x={PL - 8} y={scaleY(v) + 4} textAnchor="end" fontSize={9} fill={C.muted}>{v.toFixed(2)}</text>
          </g>
        ))}
        {data.map((d) => {
          const x = scaleX(d.relevance)
          const y = scaleY(d.redundancy)
          const color = REC_COLORS[d.recommendation] || C.muted
          const isHov = hovered === d.name
          return (
            <g key={d.name}
              onMouseEnter={() => setHovered(d.name)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}>
              <circle cx={x} cy={y} r={isHov ? 9 : 6} fill={color} opacity={0.85}
                stroke={C.card} strokeWidth={isHov ? 2 : 1} />
              {isHov && (
                <text x={x + 12} y={y + 4} fontSize={10} fontWeight={700} fill={C.text}>{d.name}</text>
              )}
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8 }}>
        {Object.entries(REC_COLORS).map(([key, color]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
            <span style={{ color: C.muted }}>{REC_LABELS[key]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP 2 FEATURES SCATTER
// ─────────────────────────────────────────────────────────────────────────────
const TopTwoScatter = ({ top2 }) => {
  const { C } = useTheme()
  if (!top2?.scatter?.length || !top2.feature_1 || !top2.feature_2) return null
  const classes = [...new Set(top2.scatter.map(p => p.target))]
  const byClass = Object.fromEntries(classes.map(c => [c, top2.scatter.filter(p => p.target === c)]))

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.faint} />
          <XAxis dataKey="x" type="number" name={top2.feature_1}
            tick={{ fontSize: 10, fill: C.muted }}
            label={{ value: top2.feature_1, position: 'insideBottom', offset: -10, fontSize: 11, fill: C.muted }} />
          <YAxis dataKey="y" type="number" name={top2.feature_2}
            tick={{ fontSize: 10, fill: C.muted }}
            label={{ value: top2.feature_2, angle: -90, position: 'insideLeft', fontSize: 11, fill: C.muted }} />
          <ZAxis range={[20, 20]} />
          <Tooltip formatter={(v) => Number(v).toFixed(3)}
            contentStyle={{ fontSize: 11, borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, color: C.text }} />
          {classes.map((cls, ci) => (
            <Scatter key={cls} name={`Class ${cls}`} data={byClass[cls]}
              fill={CLASS_COLORS[ci % CLASS_COLORS.length]} opacity={0.65} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
        {classes.map((cls, ci) => (
          <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: CLASS_COLORS[ci % CLASS_COLORS.length] }} />
            <span style={{ color: C.muted }}>Class {cls}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE LIST TABLE WITH CHECKBOXES
// ─────────────────────────────────────────────────────────────────────────────
const FeatureTable = ({ features, selected, onToggle, onToggleGroup, ohGroups, shapeWarning }) => {
  const { C } = useTheme()
  const [expandedGroups, setExpandedGroups] = useState({})

  const groupSet = new Set(Object.values(ohGroups || {}).flat())
  const regularFeatures = features.filter(f => !groupSet.has(f.name))
  const groupHeaders     = Object.keys(ohGroups || {})

  // Color-only lookup, keyed by the backend's compound `recommendation` —
  // the LABEL TEXT is built separately below from `signal_tier` +
  // `is_redundant` directly, so it always names the tier (Strong/Moderate/
  // Weak) and appends "· Redundant" whenever true, for every combination —
  // "Strong · Redundant" and "Moderate · Redundant" both share the yellow
  // redundant_high color, but read as genuinely different tiers in text.
  const REC_BADGE = {
    strong:         { bg: C.successSoft, color: C.success },
    moderate:       { bg: C.warningSoft, color: C.warning },
    redundant_high: { bg: `${YELLOW}1a`, color: YELLOW },
    weak:           { bg: C.faint, color: C.muted },
    weak_redundant: { bg: C.dangerSoft, color: C.danger },
  }
  const TIER_ICON  = { strong: '✓', moderate: '●', weak: '○' }
  const TIER_LABEL = { strong: 'Strong', moderate: 'Moderate', weak: 'Weak' }
  const TYPE_BADGE = {
    numeric:     { bg: C.primarySoft, color: C.primary },
    binary:      { bg: C.blueSoft, color: C.blue },
    ordinal:     { bg: C.warningSoft, color: C.warning },
    categorical: { bg: `${C.pink}1a`, color: C.pink },
  }

  const th = { padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 800,
    color: C.muted, textTransform: 'uppercase', letterSpacing: 1, background: C.faint,
    position: 'sticky', top: 0, zIndex: 2 }
  const td = { padding: '10px 14px' }

  const MiniBar = ({ val, color }) => (
    <div style={{ height: 6, background: C.faint, borderRadius: 3, width: 80, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, val * 100)}%`, height: '100%',
        background: color || C.primary, borderRadius: 3, transition: 'width 0.4s ease' }} />
    </div>
  )

  const renderRow = (f, indented = false) => {
    const isSelected = selected.has(f.name)
    const rec = REC_BADGE[f.recommendation] || REC_BADGE.moderate
    const typ = TYPE_BADGE[f.type] || TYPE_BADGE.numeric
    const shapWarn = shapeWarning && !isSelected && shapeWarning[f.name]
    const miDiverges = f.importance_mi != null && Math.abs(f.importance_mi - f.importance) > 0.15

    return (
      <tr key={f.name} style={{
        borderTop: `1px solid ${C.border}`,
        background: !isSelected ? 'transparent' : 'inherit',
        opacity: isSelected ? 1 : 0.5, transition: 'all 0.15s',
      }}>
        <td style={{ ...td, width: 40, color: C.muted, fontWeight: 600 }}>{f.rank}</td>
        <td style={{ ...td, paddingLeft: indented ? 32 : 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{f.name}</span>
            {indented && <span style={{ fontSize: 9, color: C.muted }}>↳ one-hot</span>}
            {f.unencoded && (
              <span title={`Not yet numeric-encoded — importance estimated via ${f.stat_test === 'chi_square' ? 'Chi-Square (Cramer’s V)' : 'one-way ANOVA'}${f.p_value != null ? `, p = ${f.p_value}` : ''}. Excluded from the correlation heatmap and redundancy scatter (those require numeric values).`}
                style={{ fontSize: 9, fontWeight: 700, color: C.pink,
                  background: `${C.pink}1a`, borderRadius: 4, padding: '1px 5px', cursor: 'help' }}>
                {f.stat_test === 'chi_square' ? 'χ² unencoded' : 'ANOVA unencoded'}
              </span>
            )}
            {miDiverges && (
              <span title={`Pearson correlation: ${(f.importance * 100).toFixed(1)}% · Mutual Information: ${(f.importance_mi * 100).toFixed(1)}% — this gap suggests a non-linear relationship with the target that a linear correlation understates.`}
                style={{ fontSize: 9, fontWeight: 700, color: C.blue,
                  background: C.blueSoft, borderRadius: 4, padding: '1px 5px', cursor: 'help' }}>
                MI {(f.importance_mi * 100).toFixed(0)}%
              </span>
            )}
            {shapWarn && (
              <span title="SHAP showed this was important after training — consider keeping it"
                style={{ fontSize: 9, fontWeight: 700, color: C.warning,
                  background: C.warningSoft, borderRadius: 4, padding: '1px 5px' }}>
                ⚠ SHAP important
              </span>
            )}
          </div>
        </td>
        <td style={td}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
            background: typ.bg, color: typ.color }}>{f.type}</span>
        </td>
        <td style={{ ...td, minWidth: 100 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <MiniBar val={f.importance} color={f.importance >= 0.3 ? C.success : f.importance >= 0.1 ? C.primary : C.muted} />
            <span style={{ fontSize: 10, color: C.muted }}>{(f.importance * 100).toFixed(1)}%</span>
          </div>
        </td>
        <td style={{ ...td, minWidth: 100 }}>
          {f.redundancy_na ? (
            <span style={{ fontSize: 10, color: C.muted }}>n/a</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <MiniBar val={f.redundancy} color={f.redundancy >= 0.85 ? C.danger : f.redundancy >= 0.5 ? C.warning : C.success} />
              <span style={{ fontSize: 10, color: C.muted }}>{(f.redundancy * 100).toFixed(1)}%</span>
            </div>
          )}
        </td>
        <td style={td}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
            background: rec.bg, color: rec.color }}>
            {TIER_ICON[f.signal_tier] || ''} {TIER_LABEL[f.signal_tier] || '—'}{f.is_redundant ? ' · Redundant' : ''}
          </span>
        </td>
        <td style={{ ...td, textAlign: 'center' }}>
          <input type="checkbox" checked={isSelected}
            onChange={() => onToggle(f.name, f.one_hot_group)}
            style={{ width: 16, height: 16, accentColor: C.primary, cursor: 'pointer' }} />
        </td>
      </tr>
    )
  }

  const renderGroupRow = (grp) => {
    const members  = ohGroups[grp] || []
    const allSel   = members.every(m => selected.has(m))
    const noneSel  = members.every(m => !selected.has(m))
    const expanded = expandedGroups[grp] !== false

    const avgImportance = members.reduce((s, m) => {
      const f = features.find(x => x.name === m)
      return s + (f?.importance || 0)
    }, 0) / (members.length || 1)

    return (
      <>
        <tr key={`grp-${grp}`} style={{ background: C.primarySoft, borderTop: `1px solid ${C.border}` }}>
          <td style={{ ...td, width: 40 }}>
            <button onClick={() => setExpandedGroups(g => ({ ...g, [grp]: !expanded }))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.muted }}>
              {expanded ? '▲' : '▼'}
            </button>
          </td>
          <td style={td}>
            <div style={{ fontWeight: 700, color: C.primary, fontSize: 13 }}>
              {grp} <span style={{ fontSize: 10, color: C.muted, fontWeight: 400 }}>({members.length} one-hot columns)</span>
            </div>
          </td>
          <td style={td}><span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px',
            borderRadius: 5, background: C.blueSoft, color: C.blue }}>group</span></td>
          <td style={{ ...td, minWidth: 100 }}>
            <span style={{ fontSize: 11, color: C.muted }}>{(avgImportance * 100).toFixed(1)}% avg</span>
          </td>
          <td style={td}><span style={{ fontSize: 11, color: C.muted }}>—</span></td>
          <td style={td}><span style={{ fontSize: 10, color: C.muted }}>One-hot group</span></td>
          <td style={{ ...td, textAlign: 'center' }}>
            <input type="checkbox"
              checked={allSel} ref={el => el && (el.indeterminate = !allSel && !noneSel)}
              onChange={() => onToggleGroup(grp, members, !allSel)}
              style={{ width: 16, height: 16, accentColor: C.primary, cursor: 'pointer' }} />
          </td>
        </tr>
        {expanded && members.map(m => {
          const f = features.find(x => x.name === m)
          return f ? renderRow(f, true) : null
        })}
      </>
    )
  }

  return (
    <div style={{ overflow: 'auto', maxHeight: TABLE_BODY_MAX_HEIGHT, borderRadius: 12, border: `1px solid ${C.border}` }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={th}>#</th>
            <th style={th}>Feature</th>
            <th style={th}>Type</th>
            <th style={th}>Importance</th>
            <th style={th}>Redundancy</th>
            <th style={th}>Signal</th>
            <th style={{ ...th, textAlign: 'center' }}>Keep</th>
          </tr>
        </thead>
        <tbody>
          {regularFeatures.map(f => renderRow(f, false))}
          {groupHeaders.map(grp => renderGroupRow(grp))}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTICOLLINEARITY WARNING CARDS
// ─────────────────────────────────────────────────────────────────────────────
const MulticolWarnings = ({ pairs, onNavigate }) => {
  const { C } = useTheme()
  const warnings = pairs.filter(p => p.severity === 'warning')
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
  if (!warnings.length) return (
    <div style={{ textAlign: 'center', padding: '18px 0', color: C.success, fontSize: 13, fontWeight: 600 }}>
      ✓ No multicollinearity issues detected (all feature pairs |r| &lt; 0.85)
    </div>
  )
  const top = warnings[0]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Recommended alternative to dropping a feature outright — combine
          the two redundant features into one on Feature Engineering
          instead, so predictive signal unique to either one isn't just
          thrown away along with the redundancy. Placed first, styled more
          prominently than the plain warning cards below it, per explicit
          request that this read as the RECOMMENDED option. */}
      <div style={{ padding: '14px 16px', borderRadius: 10, background: C.primarySoft,
        border: `2px solid ${C.primary}`, marginBottom: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
            color: C.primary, background: C.card, borderRadius: 20, padding: '2px 9px' }}>★ Recommended</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Combine instead of dropping</span>
        </div>
        <p style={{ fontSize: 12, color: C.text, lineHeight: 1.6, margin: '0 0 10px' }}>
          Dropping one of two redundant features (e.g. <strong>{top.feature_a}</strong> and{' '}
          <strong>{top.feature_b}</strong>, r = {top.correlation.toFixed(3)}) throws away whatever signal was
          unique to the one you remove — not just the overlap. Combining them into a single new feature
          (their ratio, sum, difference, or product) on the Feature Engineering page can keep that signal
          while still removing the redundancy itself, often preserving more predictive value than a straight
          drop.
        </p>
        <button onClick={() => onNavigate && onNavigate('feature_engineering')}
          disabled={!onNavigate}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: C.primary,
            color: 'white', fontWeight: 700, fontSize: 12.5, cursor: onNavigate ? 'pointer' : 'default' }}>
          → Combine in Feature Engineering
        </button>
      </div>
      {warnings.slice(0, 6).map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 14px', borderRadius: 9,
          background: Math.abs(p.correlation) >= 0.95 ? C.dangerSoft : C.warningSoft,
          border: `1px solid ${Math.abs(p.correlation) >= 0.95 ? C.danger + '33' : C.warning + '33'}` }}>
          <span style={{ fontSize: 14 }}>{Math.abs(p.correlation) >= 0.95 ? '🔴' : '🟡'}</span>
          <div style={{ flex: 1, fontSize: 12, color: C.text }}>
            <strong>{p.feature_a}</strong> &amp; <strong>{p.feature_b}</strong>
            <span style={{ color: C.muted, marginLeft: 8 }}>r = {p.correlation.toFixed(3)}</span>
          </div>
          <div style={{ fontSize: 11, color: Math.abs(p.correlation) >= 0.95 ? C.danger : C.warning, fontWeight: 700 }}>
            {Math.abs(p.correlation) >= 0.95 ? 'Highly redundant' : 'Potentially redundant'}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
        Rule: features with |r| &gt; 0.85 may be redundant. Consider keeping only the one with higher target correlation.
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// INFO / PHILOSOPHY WIDGET (ℹ) — collapsed by default, same pulsing-button
// pattern as Sampling.jsx's DescriptionWidget.
// ─────────────────────────────────────────────────────────────────────────────
const InfoBanner = () => {
  const { C } = useTheme()
  const [open, setOpen] = useState(false)
  const TEXT = `This page uses ONLY statistical methods — no model has been trained yet.

Correlation heatmap: shows how strongly every pair of NUMERIC features is related. Diagonal = 1.0. Strong positive leans toward the accent color; strong negative leans toward red.

Feature importance: for a numeric feature, this is its absolute Pearson correlation with the target. For a column that hasn't been encoded yet, Pearson would be meaningless (it would treat unordered categories as if they were numbers) — those columns are scored with Chi-Square (classification target) or one-way ANOVA (regression target) instead, and flagged accordingly.

Mutual Information (MI): shown alongside Pearson when the two diverge by more than 15 points — MI catches non-linear relationships a linear correlation coefficient can miss entirely.

Redundancy vs Relevance scatter: the most powerful view here. Bottom-right is ideal (relevant to the target AND not redundant with other features). Top-right is relevant but correlated with another feature — you may only need one of them.

Multicollinearity warning: pairs of features with |correlation| ≥ 0.85 may carry duplicate information. Consider removing the weaker one.

One-Hot groups: when a column was one-hot encoded, its binary columns are grouped together. Uncheck the group header to exclude the entire original variable from training.

⚠ SHAP values (which features truly mattered to the trained model) become available on the Feature Impact page after training. If you return to this page after training, any feature SHAP flagged as important will show a warning if you try to remove it.`

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
        background: open ? C.primarySoft : C.faint,
        border: `1px solid ${open ? C.primary + '40' : C.border}`,
        borderRadius: 10, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', border: `2px solid ${C.primary}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 900, color: open ? 'white' : C.primary,
          background: open ? C.primary : C.card, flexShrink: 0 }}>
          ℹ
        </div>
        <span style={{ fontSize: 13, color: open ? C.primary : C.muted, fontWeight: 600, flex: 1 }}>
          {open ? 'How to read this page' : 'Statistical feature selection only — click to understand how this page works'}
        </span>
        <span style={{ fontSize: 11, color: C.muted }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ background: C.primarySoft, border: `1px solid ${C.primary}40`,
          borderRadius: '0 0 10px 10px', padding: '14px 20px', fontSize: 13,
          color: C.text, lineHeight: 1.7, borderTop: 'none', whiteSpace: 'pre-line' }}>
          {TEXT}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// REDO CONFIRMATION MODAL — same pattern as every other page in this app.
// ─────────────────────────────────────────────────────────────────────────────
const RedoModal = ({ onCancel, onConfirm, working }) => {
  const { C } = useTheme()
  return (
    <div style={{ position: 'fixed', inset: 0, background: C.scrim, backdropFilter: 'blur(4px)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.overlayCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: 30,
        maxWidth: 420, width: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8, color: C.text }}>Redo Feature Selection?</div>
        <p style={{ fontSize: 13, color: C.muted, marginBottom: 20, lineHeight: 1.6 }}>
          This clears your current selection and removes the Feature Selected Version if one was
          already applied — you'll start again with every feature checked.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '9px 20px', borderRadius: 10, border: `1px solid ${C.border}`,
            background: C.faint, color: C.text, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={onConfirm} disabled={working} style={{ padding: '9px 20px', borderRadius: 10, border: 'none',
            background: C.danger, color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {working ? 'Working…' : 'Yes, redo'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function FeatureSelectionPage({
  projectData, onNext, onUpdateData,
  getDisplayPath, getInputPath, registerVersion, isStepDone, getVersion, resetStep, versions,
  active, onNavigate, furthestOrder, shapData,
}) {
  const { C } = useTheme()

  const [data,     setData]    = useState(null)
  const [loading,  setLoading] = useState(true)
  const [error,    setError]   = useState('')
  const [selected, setSelected] = useState(new Set())
  const [applying, setApplying] = useState(false)
  const [applied,  setApplied]  = useState(false)
  const [newPath,  setNewPath]  = useState(null)
  const [showPairplot, setShowPair] = useState(false)
  const [redoModal, setRedoModal] = useState(false)
  const [redoing,   setRedoing]   = useState(false)

  // filePath is the PERMANENT pre-selection snapshot — the analysis this
  // whole page is built from, and the file every /analyze and /apply call
  // operates on. Must come from getInputPath, never getDisplayPath, for the
  // same reason Sampling.jsx/Encoding.jsx use getInputPath for their fixed
  // "before" data: getDisplayPath deliberately flips to this step's OWN
  // output once a version exists, which would make the analysis silently
  // start describing the already-filtered result instead of what the user
  // is choosing from.
  const filePath = useMemo(() =>
    (getInputPath ? getInputPath('feature_selection') : null) || projectData?.filePath,
  [getInputPath, projectData])

  const targetCol = projectData?.targetColumn
  const done       = isStepDone ? isStepDone('feature_selection') : applied

  useEffect(() => {
    if (!filePath || !targetCol) return
    setLoading(true)
    callFS('analyze', { file_path: filePath, target_column: targetCol })
      .then(d => {
        setData(d)
        setSelected(new Set(d.features.map(f => f.name)))
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [filePath, targetCol])

  // Resume: if this step already has a registered version when the page
  // mounts (navigated away after Apply, came back), reconstruct exactly
  // which features are still selected from the real output file — rather
  // than resetting to "everything checked" — so going back to change a
  // filter never means refilling the whole form from scratch. Mirrors
  // Sampling.jsx's resume effect (re-derive from the resolved output path,
  // not from any client-only memory).
  useEffect(() => {
    if (!done || applied || !data || !targetCol) return
    const outputPath = getDisplayPath ? getDisplayPath('feature_selection') : null
    if (!outputPath || outputPath === filePath) return
    callFS('analyze', { file_path: outputPath, target_column: targetCol })
      .then(outData => {
        setData(outData)  // was missing — the page used to keep showing the
        // ORIGINAL pre-selection analysis in every chart/heatmap/table even
        // after resuming an already-applied step; see handleApply's own
        // fresh-analyze call for the identical fix on the immediate-Apply path.
        setSelected(new Set(outData.features.map(f => f.name)))
        setNewPath(outputPath)
        setApplied(true)
      })
      .catch(() => { /* resume best-effort — stays in the pending selection state if this fails */ })
  }, [done, applied, data, targetCol, getDisplayPath, filePath])

  const handleToggle = useCallback((name) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const handleToggleGroup = useCallback((grp, members, selectAll) => {
    setSelected(prev => {
      const next = new Set(prev)
      members.forEach(m => selectAll ? next.add(m) : next.delete(m))
      return next
    })
  }, [])

  const handleApply = useCallback(async () => {
    if (!filePath || !targetCol || !data) return
    setApplying(true)
    try {
      const res = await callFS('apply', {
        file_path: filePath, target_column: targetCol, features_to_keep: [...selected],
      })
      setNewPath(res.new_file_path)
      if (registerVersion)
        await registerVersion('feature_selection', res.new_file_path, 'Feature Selected Version', res.row_count,
          { features_kept: res.features_kept, features_dropped: res.features_dropped })
      if (onUpdateData) onUpdateData({ cleanedFilePath: res.new_file_path, selectedFeatures: res.features_kept })
      // Real bug, fixed: re-analyze the JUST-APPLIED file and replace `data`
      // with it — without this, the entire rest of the page (heatmap,
      // importance chart, redundancy scatter, feature table) kept showing
      // the ORIGINAL pre-selection analysis forever after Apply, since
      // nothing ever re-fetched or overwrote `data`.
      const freshData = await callFS('analyze', { file_path: res.new_file_path, target_column: targetCol })
      setData(freshData)
      setSelected(new Set(freshData.features.map(f => f.name)))
      setApplied(true)
    } catch (e) { setError(e.message) }
    finally { setApplying(false) }
  }, [filePath, targetCol, data, selected, registerVersion, onUpdateData])

  const handleRedo = async () => {
    setRedoing(true)
    try {
      if (resetStep) await resetStep('feature_selection')
      if (data) setSelected(new Set(data.features.map(f => f.name)))
      setApplied(false); setNewPath(null); setRedoModal(false)
    } finally { setRedoing(false) }
  }

  const shapWarnings = useMemo(() => {
    if (!shapData) return null
    const out = {}
    Object.entries(shapData).forEach(([feat, score]) => { if (score > 0.1) out[feat] = true })
    return out
  }, [shapData])

  const selectedCount = selected.size
  const totalCount    = data?.total_features || 0
  const removedCount  = totalCount - selectedCount
  const weakCount     = (data?.features || []).filter(f => f.signal_tier === 'weak').length
  const strongCount   = data?.n_strong || 0

  if (!targetCol) return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <TopNav active={active || 'feature_selection'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
      <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>
        <div style={{ fontSize: 32 }}>⚠️</div>
        <div style={{ fontWeight: 700, marginTop: 12, color: C.text }}>No target column set.</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>Set your target column during Upload to use this page.</div>
      </div>
    </div>
  )

  if (loading) return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <TopNav active={active || 'feature_selection'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
      <div style={{ textAlign: 'center', padding: '80px 0', color: C.muted }}>
        <div style={{ fontSize: 28, marginBottom: 12, display: 'inline-block',
          animation: 'spin 1s linear infinite' }}>⚙</div>
        <p>Computing feature correlations and redundancy scores…</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )
  if (error) return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <TopNav active={active || 'feature_selection'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
      <div style={{ background: C.dangerSoft, border: `1px solid ${C.danger}`,
        borderRadius: 12, padding: 20, color: C.danger, margin: 20 }}>⚠ {error}</div>
    </div>
  )
  if (!data) return null

  const ft = data.features || []
  const importanceData = [...ft]
    .sort((a, b) => b.importance - a.importance)
    .map(f => ({ feature: f.name.length > 16 ? f.name.slice(0, 14) + '…' : f.name,
                 importance: f.importance, unencoded: f.unencoded }))

  const analystSummary = `${strongCount} of ${totalCount} feature(s) show strong independent signal · ${weakCount} appear weak · ${data.n_multicol_warnings} redundant pair(s) detected${data.n_unencoded_features > 0 ? ` · ${data.n_unencoded_features} column(s) not yet encoded (Chi-Square/ANOVA used)` : ''}.`

  return (
    <div style={{ background: C.bg, minHeight: '100vh', paddingBottom: 100 }}>
      <TopNav active={active || 'feature_selection'} onNavigate={onNavigate} furthestOrder={furthestOrder} />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: '20px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: C.text, marginBottom: 4 }}>Feature Selection</h1>
          <p style={{ fontSize: 13, color: C.muted }}>
            Identify meaningful features using statistical correlation — before any model is trained.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <button onClick={() => setRedoModal(true)}
            style={{ padding: '9px 18px', borderRadius: 9, border: `1px solid ${C.danger}`,
              background: C.dangerSoft, color: C.danger, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            ↺ Redo Selection
          </button>
          {applied && newPath && (
            <button onClick={() => downloadFile(newPath, 'dataset_feature_selected.csv')}
              style={{ padding: '9px 18px', borderRadius: 9, border: `1px solid ${C.success}`,
                background: C.successSoft, color: C.success, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              ⬇ Download
            </button>
          )}
          {applied && newPath && (
            <button onClick={() => onNext && onNext('training', {})}
              style={{ padding: '10px 22px', borderRadius: 10, border: 'none',
                background: C.primary, color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                boxShadow: `0 4px 16px ${C.primary}44` }}>
              Continue to Training →
            </button>
          )}
        </div>
      </div>

      {/* ── Versions bar ────────────────────────────────────────────────── */}
      <SharedVersionsBar versions={versions} />

      <div style={{ padding: '20px 32px 0' }}>
        <InfoBanner />

        {/* ── Analyst summary ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
          background: C.faint, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 20,
          fontSize: 13, color: C.text }}>
          <span style={{ fontSize: 15 }}>📊</span>
          <span><strong>Analyst summary:</strong> {analystSummary}</span>
        </div>

        {data.target_is_multiclass_nominal && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
            background: C.warningSoft, border: `1px solid ${C.warning}40`, borderRadius: 10, marginBottom: 20,
            fontSize: 13, color: C.text }}>
            <span style={{ fontSize: 15 }}>ℹ</span>
            <span>Target "{targetCol}" has {data.n_target_classes} nominal classes — Pearson correlation treats class
            codes as ordinal, which can understate a feature's real importance. Check the MI badge next to a
            feature's name in the list below for a more reliable non-linear signal.</span>
          </div>
        )}

        {/* ── KPI Cards ───────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 24 }}>
          <MetricCard icon="▤" label="Total Features" value={totalCount} accent={C.primary}
            sub={`excluding target (${targetCol})`} />
          <MetricCard icon="✓" label="Selected" value={selectedCount} accent={C.success}
            sub="will be used for training" />
          <MetricCard icon="✕" label="Removed" value={removedCount} accent={C.muted}
            sub={removedCount > 0 ? `${weakCount} weak feature(s) detected` : 'none removed yet'} />
          <MetricCard icon="⚠" label="Redundant Pairs" value={data.n_multicol_warnings} accent={C.warning}
            sub={data.n_multicol_warnings ? 'pairs with |r| ≥ 0.85' : 'no multicollinearity'} />
        </div>

        {/* ── Main two-column grid ───────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '56% 42%', gap: 18, marginBottom: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ChartCard title="Full Correlation Heatmap"
              sub={`Every numeric feature pair, including the target "${targetCol}". Yellow-bordered = multicollinearity warning; green/red-bordered = strong/weak signal vs. the target.${data.n_unencoded_features > 0 ? ` ${data.n_unencoded_features} unencoded column(s) excluded — see Feature List below.` : ''}`}>
              <CorrelationHeatmap data={data.correlation_matrix} multicolPairs={data.multicol_pairs || []} targetCol={targetCol} features={ft} />
            </ChartCard>
            <ChartCard title="⚠ Multicollinearity Check"
              sub="Pairs of features that are too similar to each other — keeping both adds redundancy, not signal.">
              <MulticolWarnings pairs={data.multicol_pairs || []} onNavigate={onNavigate} />
            </ChartCard>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ChartCard title="Feature → Target Importance"
              sub={`Ranked by statistical association with "${targetCol}". Purely statistical — no model trained.`}>
              <ResponsiveContainer width="100%" height={Math.max(200, importanceData.length * 26 + 20)}>
                <BarChart data={importanceData} layout="vertical" margin={{ left: 100, right: 30, top: 22, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.faint} />
                  <XAxis type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: C.muted }} />
                  <YAxis dataKey="feature" type="category" tick={{ fontSize: 10, fill: C.muted }} width={100} />
                  <Tooltip formatter={v => [(v * 100).toFixed(1) + '%', 'Importance']}
                    contentStyle={{ fontSize: 11, borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, color: C.text }} />
                  {/* Labels sit ABOVE the whole chart (position:'top'), not
                      floating inline among the bars where they used to be
                      unreadable — a vertical ReferenceLine's default label
                      placement centers it mid-chart, right on top of
                      whichever bar happens to be there. */}
                  <ReferenceLine x={0.3} stroke={C.success} strokeDasharray="4,2"
                    label={{ value: 'strong ≥ 0.3', position: 'top', fontSize: 9, fontWeight: 700, fill: C.success }} />
                  <ReferenceLine x={0.1} stroke={C.warning} strokeDasharray="4,2"
                    label={{ value: 'moderate ≥ 0.1', position: 'top', fontSize: 9, fontWeight: 700, fill: C.warning }} />
                  <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
                    {importanceData.map((d, i) => (
                      <Cell key={i} fill={d.importance >= 0.3 ? C.success : d.importance >= 0.1 ? C.primary : C.muted} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={data.top_2?.feature_1 ? `Top 2 Features: ${data.top_2.feature_1} × ${data.top_2.feature_2}` : 'Top 2 Features'}
              sub="Scatter of the two most important numeric features, colored by target class. Good separation = high predictive value.">
              <TopTwoScatter top2={data.top_2} />
            </ChartCard>
          </div>
        </div>

        {/* ── Redundancy vs Relevance (full width) ───────────────────────── */}
        <ChartCard title="Redundancy vs Relevance — Feature Decision Space"
          sub="Each dot = one numeric feature. Keep features in the bottom-right (high relevance, low redundancy). Features in the top-right are relevant but redundant — consider dropping one of each redundant pair."
          style={{ marginBottom: 18 }}>
          <RedundancyRelevanceChart data={data.rdv_scatter || []} />
        </ChartCard>

        {/* ── Pairplot (collapsible) ──────────────────────────────────────── */}
        <div style={{ marginBottom: 18 }}>
          <button onClick={() => setShowPair(s => !s)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: '12px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 13, color: C.muted }}>
            <span>{showPairplot ? '▲' : '▼'}</span>
            Show Pairplot — relationships between top features, colored by target class
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 400 }}>
              (top 5 numeric features · {Object.keys(data.pairplot_data || {}).length} scatter plots)
            </span>
          </button>
          {showPairplot && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`,
              borderRadius: '0 0 12px 12px', padding: '20px', borderTop: 'none' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 14 }}>
                {Object.entries(data.pairplot_data || {}).map(([key, pts]) => {
                  const [fa, fb] = key.split('||')
                  const classes  = [...new Set(pts.map(p => p.target))]
                  const byClass  = Object.fromEntries(classes.map(c => [c, pts.filter(p => p.target === c)]))
                  return (
                    <div key={key} style={{ background: C.faint, borderRadius: 10, padding: '10px 12px' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 6 }}>{fa} × {fb}</div>
                      <ResponsiveContainer width="100%" height={120}>
                        <ScatterChart margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                          <XAxis dataKey="x" type="number" tick={{ fontSize: 8 }} />
                          <YAxis dataKey="y" type="number" tick={{ fontSize: 8 }} />
                          <ZAxis range={[10, 10]} />
                          <Tooltip contentStyle={{ fontSize: 10 }} />
                          {classes.map((cls, ci) => (
                            <Scatter key={cls} data={byClass[cls]} fill={CLASS_COLORS[ci % CLASS_COLORS.length]} opacity={0.6} />
                          ))}
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Feature Selection Table ─────────────────────────────────────── */}
        <ChartCard title="Feature List — select which features to use in training"
          sub={`${selectedCount} of ${totalCount} features selected. Uncheck to exclude from training. One-hot groups are managed together.`}
          style={{ marginBottom: 80 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <button onClick={() => setSelected(new Set(ft.map(f => f.name)))}
              style={{ padding: '6px 14px', borderRadius: 7, border: `1px solid ${C.border}`,
                background: C.card, fontSize: 12, cursor: 'pointer', fontWeight: 600, color: C.text }}>
              Select All
            </button>
            <button onClick={() => setSelected(new Set(ft.filter(f => f.signal_tier !== 'weak').map(f => f.name)))}
              style={{ padding: '6px 14px', borderRadius: 7, border: `1px solid ${C.warning}`,
                background: C.warningSoft, fontSize: 12, cursor: 'pointer', fontWeight: 600, color: C.warning }}>
              Auto-remove weak features
            </button>
            {/* Removes only features that are BOTH weak AND redundant at
                once — not everything that's weak OR everything that's
                redundant (a genuinely different, narrower selection than
                the button above; a moderate/strong feature that happens to
                be redundant, or a weak feature that isn't redundant, is
                left untouched by this one). */}
            <button onClick={() => setSelected(new Set(
                ft.filter(f => !(f.signal_tier === 'weak' && f.is_redundant)).map(f => f.name)))}
              style={{ padding: '6px 14px', borderRadius: 7, border: `1px solid ${C.danger}`,
                background: C.dangerSoft, fontSize: 12, cursor: 'pointer', fontWeight: 600, color: C.danger }}>
              Remove weak + redundant
            </button>
          </div>
          <FeatureTable features={ft} selected={selected} onToggle={handleToggle} onToggleGroup={handleToggleGroup}
            ohGroups={data.one_hot_groups || {}} shapeWarning={shapWarnings} />
        </ChartCard>
      </div>

      {/* ── Sticky Apply Panel ──────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: C.card, backdropFilter: 'blur(8px)', borderTop: `1px solid ${C.border}`,
        padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: 13, color: C.text, fontWeight: 700 }}>{selectedCount} features selected</span>
            <span style={{ fontSize: 12, color: C.muted, marginLeft: 8 }}>({removedCount} excluded from training)</span>
          </div>
          {removedCount > 0 && !applied && (
            <div style={{ fontSize: 12, color: C.warning, fontWeight: 600 }}>
              ⚠ Removing {removedCount} feature(s) — verify they are truly unimportant.
            </div>
          )}
          {applied && (
            <div style={{ fontSize: 13, color: C.success, fontWeight: 700 }}>✓ Feature Selected Version saved</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {!applied ? (
            <button onClick={handleApply} disabled={applying || selectedCount === 0}
              style={{ padding: '11px 28px', borderRadius: 10, border: 'none',
                background: selectedCount > 0 ? C.primary : C.muted, color: 'white', fontWeight: 800, fontSize: 14,
                cursor: selectedCount > 0 ? 'pointer' : 'not-allowed',
                boxShadow: selectedCount > 0 ? `0 4px 20px ${C.primary}44` : 'none' }}>
              {applying ? '⏳ Saving…' : '✓ Confirm Selection & Save Version'}
            </button>
          ) : (
            <button onClick={() => onNext && onNext('training', {})}
              style={{ padding: '11px 28px', borderRadius: 10, border: 'none',
                background: C.success, color: 'white', fontWeight: 800, fontSize: 14,
                cursor: 'pointer', boxShadow: `0 4px 20px ${C.success}44` }}>
              Continue to Training →
            </button>
          )}
        </div>
      </div>

      {redoModal && <RedoModal onCancel={() => setRedoModal(false)} onConfirm={handleRedo} working={redoing} />}
    </div>
  )
}
