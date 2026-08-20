import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  ReferenceLine, ReferenceArea, ResponsiveContainer, LabelList,
  ScatterChart, Scatter, ZAxis,
} from 'recharts'
import { versionsAPI, workflowAPI } from '../api'

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS (light theme)
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg:         '#f8fafc',
  white:      '#ffffff',
  card:       '#ffffff',
  border:     '#e2e8f0',
  primary:    '#6366f1',
  primarySoft:'rgba(99,102,241,0.08)',
  success:    '#10b981',
  successSoft:'rgba(16,185,129,0.1)',
  warning:    '#f59e0b',
  warningSoft:'rgba(245,158,11,0.1)',
  danger:     '#ef4444',
  dangerSoft: 'rgba(239,68,68,0.08)',
  text:       '#1e293b',
  muted:      '#64748b',
  light:      '#f1f5f9',
  amber:      '#f59e0b',
  pink:       '#ec4899',
  indigo:     '#6366f1',
  slate:      '#334155',
}

const shadow  = '0 4px 24px rgba(0,0,0,0.08)'
const shadow2 = '0 1px 4px rgba(0,0,0,0.06)'
const btn = (bg, color='white', extra={}) => ({
  padding: '9px 20px', borderRadius: 10, border: 'none',
  background: bg, color, fontWeight: 700, fontSize: 13,
  cursor: 'pointer', transition: 'all 0.2s', ...extra,
})

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY-MAP STEP ORDER — mirrors backend-django/datasets/models.py's
// STEP_ORDER exactly. Used to resolve which dataset version a tab should
// display (getDisplayPath) and to decide whether redoing a step would
// invalidate later versions (confirmBeforeAction), both in CleaningPage below.
// ─────────────────────────────────────────────────────────────────────────────
const STEP_ORDER = {
  upload: 1, diagnose: 2,
  cleaning_duplicates: 3, cleaning_outliers: 4, cleaning_missing: 5,
  encoding: 6, sampling: 7, feature_selection: 8,
  training: 9, feature_impact: 10, report: 11,
}

const STAGE_NUMBER = 3

const STEP_INFO = {
  duplicates: {
    title: 'Remove Duplicates',
    description: 'Identical rows inflate frequencies and bias every downstream statistic. Inspect the flagged duplicates below, then remove them to create a clean version.',
  },
  outliers: {
    title: 'Remove Outliers',
    description: "Each numeric column is tested for normality (Shapiro–Wilk). Normal columns default to Z-Score; skewed columns default to IQR. Review the whole-dataset view, then drill into any column.",
  },
  missing: {
    title: 'Handle Missing Values',
    description: 'First drop rows that are too incomplete to keep, then impute the rest per column. Outliers are already removed, so column means are safe to use.',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILS — unchanged from the previous version of this file
// ─────────────────────────────────────────────────────────────────────────────
const API = 'http://localhost:8001'

const callCleaning = async (endpoint, body) => {
  const res = await fetch(`${API}/cleaning/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Error ${res.status}`)
  }
  return res.json()
}

const downloadDataset = (filePath, filename) => {
  const url = `${API}/cleaning/download?file_path=${encodeURIComponent(filePath)}&filename=${encodeURIComponent(filename)}`
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
}

const computeOutliers = (allValues, method, zThresh, iqrMult, stats) => {
  return allValues.map(v => {
    let isOutlier = false, score = 0
    if (method === 'zscore') {
      score = Math.abs((v.value - stats.mean) / Math.max(stats.std, 1e-10))
      isOutlier = score > zThresh
    } else {
      const upper = stats.Q3 + iqrMult * stats.IQR
      const lower = stats.Q1 - iqrMult * stats.IQR
      isOutlier = v.value > upper || v.value < lower
      score = Math.abs(v.value - stats.median) / Math.max(stats.IQR, 1e-10)
    }
    return { ...v, isOutlier, score }
  })
}

const computeHistBins = (allValues, numBins = 35) => {
  const vals = allValues.map(v => v.value)
  const mn = Math.min(...vals), mx = Math.max(...vals)
  if (mn === mx) return [{ mid: mn, count: vals.length }]
  const binSize = (mx - mn) / numBins
  const bins = Array.from({ length: numBins }, (_, i) => ({
    mid: mn + (i + 0.5) * binSize,
    start: mn + i * binSize,
    end: mn + (i + 1) * binSize,
    count: 0,
  }))
  vals.forEach(v => {
    const idx = Math.min(Math.floor((v - mn) / binSize), numBins - 1)
    bins[idx].count++
  })
  return bins
}

// ─────────────────────────────────────────────────────────────────────────────
// STRIP PLOT (custom SVG — supports click-to-toggle outlier dots) — UNCHANGED
// ─────────────────────────────────────────────────────────────────────────────
function StripPlot({ computedValues, stats, method, zThresh, iqrMult, keptRows, onToggleRow }) {
  const W = 560, H = 200, PL = 52, PR = 24, PT = 16, PB = 36

  const vals = computedValues.map(v => v.value)
  const mn = Math.min(...vals), mx = Math.max(...vals)
  const range = mx - mn || 1
  const toX = v => PL + ((v - mn) / range) * (W - PL - PR)

  const getUpper = () => method === 'zscore'
    ? stats.mean + zThresh * stats.std
    : stats.Q3 + iqrMult * stats.IQR
  const getLower = () => method === 'zscore'
    ? stats.mean - zThresh * stats.std
    : stats.Q1 - iqrMult * stats.IQR

  const upperX = Math.min(toX(getUpper()), W - PR)
  const lowerX = Math.max(toX(getLower()), PL)
  const zUpperX = Math.min(toX(stats.mean + zThresh * stats.std), W - PR)
  const zLowerX = Math.max(toX(stats.mean - zThresh * stats.std), PL)
  const iqrUpperX = Math.min(toX(stats.Q3 + iqrMult * stats.IQR), W - PR)
  const iqrLowerX = Math.max(toX(stats.Q1 - iqrMult * stats.IQR), PL)

  const CENTER = PT + (H - PT - PB) / 2
  const ticks = 5
  const tickVals = Array.from({ length: ticks }, (_, i) => mn + (i / (ticks - 1)) * range)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow: 'visible' }}>
      {/* Axes */}
      <line x1={PL} y1={H - PB} x2={W - PR} y2={H - PB} stroke={C.border} />
      <line x1={PL} y1={PT} x2={PL} y2={H - PB} stroke={C.border} />

      {/* Normal range shading */}
      <rect x={lowerX} y={PT} width={Math.max(0, upperX - lowerX)} height={H - PT - PB}
        fill="rgba(16,185,129,0.07)" />

      {/* IQR bound lines (amber solid) */}
      <line x1={iqrUpperX} y1={PT} x2={iqrUpperX} y2={H - PB}
        stroke={C.amber} strokeWidth={2} />
      <line x1={iqrLowerX} y1={PT} x2={iqrLowerX} y2={H - PB}
        stroke={C.amber} strokeWidth={2} />
      <text x={iqrUpperX + 2} y={PT + 10} fontSize={8} fill={C.amber}>IQR</text>

      {/* Z-Score bound lines (pink dashed) */}
      <line x1={zUpperX} y1={PT} x2={zUpperX} y2={H - PB}
        stroke={C.pink} strokeWidth={1.5} strokeDasharray="4,3" />
      <line x1={zLowerX} y1={PT} x2={zLowerX} y2={H - PB}
        stroke={C.pink} strokeWidth={1.5} strokeDasharray="4,3" />
      <text x={zUpperX + 2} y={PT + 20} fontSize={8} fill={C.pink}>Z</text>

      {/* Dots */}
      {computedValues.map((pt, i) => {
        const x = toX(pt.value)
        const jitter = Math.sin(pt.row_index * 37.1 + 1.7) * 28
        const y = CENTER + jitter
        const isKept = keptRows.has(pt.row_index)
        const color = pt.isOutlier ? (isKept ? '#94a3b8' : C.danger) : C.primary
        const r = pt.isOutlier ? 5.5 : 2.5
        const opacity = pt.isOutlier ? 0.92 : 0.35
        return (
          <circle key={`${pt.row_index}-${i}`}
            cx={x} cy={y} r={r}
            fill={color} opacity={opacity}
            style={{ cursor: pt.isOutlier ? 'pointer' : 'default' }}
            onClick={() => pt.isOutlier && onToggleRow(pt.row_index)}>
            {pt.isOutlier && <title>Row {pt.row_index}: {pt.value} — click to toggle</title>}
          </circle>
        )
      })}

      {/* X axis ticks */}
      {tickVals.map((v, i) => (
        <g key={i}>
          <line x1={toX(v)} y1={H - PB} x2={toX(v)} y2={H - PB + 4} stroke={C.border} />
          <text x={toX(v)} y={H - PB + 14} textAnchor="middle" fontSize={9} fill={C.muted}>
            {v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}
          </text>
        </g>
      ))}

      {/* Legend */}
      <circle cx={PL} cy={PT - 4} r={4} fill={C.danger} opacity={0.9} />
      <text x={PL + 8} y={PT} fontSize={9} fill={C.muted}>Outlier (click to keep)</text>
      <circle cx={PL + 110} cy={PT - 4} r={4} fill="#94a3b8" />
      <text x={PL + 118} y={PT} fontSize={9} fill={C.muted}>Kept</text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MISSING VALUE MATRIX (custom SVG — missingno.matrix style) — UNCHANGED
// ─────────────────────────────────────────────────────────────────────────────
function MissingMatrix({ matrixData }) {
  if (!matrixData) return null
  const { columns, rows, total_rows, sample_rows } = matrixData
  const cellW = Math.max(14, Math.min(48, 680 / columns.length))
  const cellH = Math.max(1.2, Math.min(4, 300 / rows.length))
  const LABEL_H = 30
  const svgW = columns.length * cellW + 70
  const svgH = rows.length * cellH + LABEL_H + 24
  const labelFontSize = Math.min(9, Math.max(6, cellW * 0.55))
  const maxChars = Math.max(3, Math.floor(cellW / (labelFontSize * 0.62)))

  return (
    // viewBox + width="100%" (height omitted, so the browser derives it from
    // the viewBox's aspect ratio — uniform scaling, no distortion) makes
    // this stretch to fill the full width of its card, same as the bar
    // chart's ResponsiveContainer. That's what makes the 50/50 grid split
    // actually look 50/50 instead of a fixed-pixel-width matrix sitting
    // narrower than its half while the bar chart fills its own.
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${svgW} ${svgH}`} width="100%" style={{ display: 'block' }}>
        {/* Column labels — horizontal, sitting right above each column */}
        {columns.map((col, ci) => (
          <text key={ci}
            x={ci * cellW + cellW / 2 + 40}
            y={LABEL_H - 8}
            textAnchor="middle"
            fontSize={labelFontSize}
            fill={C.slate}>
            {col.length > maxChars ? col.slice(0, maxChars - 1) + '…' : col}
          </text>
        ))}
        {/* Cells */}
        {rows.map((row, ri) =>
          row.map((present, ci) => (
            <rect key={`${ri}-${ci}`}
              x={ci * cellW + 40}
              y={ri * cellH + LABEL_H}
              width={cellW - 0.8}
              height={cellH}
              fill={present ? C.slate : '#f1f5f9'}
            />
          ))
        )}
        {/* Side bar (row completeness sparkline) */}
        {rows.map((row, ri) => {
          const ratio = row.filter(Boolean).length / columns.length
          return (
            <rect key={`bar-${ri}`}
              x={columns.length * cellW + 44}
              y={ri * cellH + LABEL_H}
              width={ratio * 22}
              height={cellH}
              fill={C.primary}
              opacity={0.6}
            />
          )
        })}
        {/* Bottom labels */}
        <text x={40} y={rows.length * cellH + LABEL_H + 18}
          fontSize={10} fill={C.muted}>
          {sample_rows < total_rows
            ? `${sample_rows} of ${total_rows} rows shown`
            : `${total_rows} rows`}
        </text>
        <text x={columns.length * cellW + 44} y={rows.length * cellH + LABEL_H + 18}
          fontSize={9} fill={C.muted}>Completeness</text>
        {/* Row index labels left */}
        <text x={36} y={LABEL_H + 4} fontSize={9} fill={C.muted} textAnchor="end">1</text>
        <text x={36} y={rows.length * cellH + LABEL_H}
          fontSize={9} fill={C.muted} textAnchor="end">{total_rows}</text>
      </svg>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW: MISSING BAR CHART — standard vertical bars, one per column, colored
// by severity. Sits side-by-side with the matrix, so width is whatever the
// grid column gives it (ResponsiveContainer width="100%").
// ─────────────────────────────────────────────────────────────────────────────
function MissingBarChart({ barData }) {
  const sorted = [...barData].sort((a, b) => a.present_pct - b.present_pct)
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={sorted} margin={{ top: 24, right: 8, bottom: 64, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
        <XAxis dataKey="column" angle={-45} textAnchor="end" interval={0}
          height={70} tick={{ fontSize: 10, fill: C.muted }} />
        <YAxis domain={[0, 1]} tickFormatter={v => `${(v * 100).toFixed(0)}%`}
          tick={{ fontSize: 10, fill: C.muted }} />
        <Tooltip
          formatter={(v, n, props) => [`${(props.payload.present_pct * 100).toFixed(1)}% present`, props.payload.column]}
          contentStyle={{ borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, boxShadow: shadow2 }}
        />
        <Bar dataKey="present_pct" radius={[4, 4, 0, 0]}>
          {sorted.map((entry, i) => (
            <Cell key={i} fill={entry.missing_pct > 30 ? C.danger : entry.missing_pct > 10 ? C.warning : C.success} />
          ))}
          <LabelList dataKey="present_pct" position="top"
            formatter={v => `${(v * 100).toFixed(0)}%`} style={{ fontSize: 9, fill: C.muted }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW: OUTLIER COLUMN BAR CHART — horizontal, one bar per column, clickable
// ─────────────────────────────────────────────────────────────────────────────
function OutlierColumnBarChart({ columnSummary, onSelectColumn, compact = false }) {
  const [hoveredCol, setHoveredCol] = useState(null)
  const maxOut = Math.max(...columnSummary.map(c => c.n_outliers), 1)
  const labelWidth = compact ? 62 : 130

  return (
    <div style={{ padding: '4px 0' }}>
      {columnSummary.map(col => {
        const pct = maxOut > 0 ? (col.n_outliers / maxOut) * 100 : 0
        const color = col.n_outliers === 0 ? C.success
          : col.n_outliers < maxOut * 0.3 ? C.warning
          : C.danger
        const isHovered = hoveredCol === col.column

        return (
          <div key={col.column}
            title={`${col.n_outliers} outlier${col.n_outliers !== 1 ? 's' : ''} in ${col.column} — click to inspect`}
            onClick={() => onSelectColumn(col.column)}
            onMouseEnter={() => setHoveredCol(col.column)}
            onMouseLeave={() => setHoveredCol(null)}
            style={{
              display: 'flex', alignItems: 'center', gap: compact ? 8 : 14,
              padding: compact ? '5px 6px' : '6px 10px', borderRadius: 8, cursor: 'pointer',
              background: isHovered ? `${color}10` : 'transparent',
              transition: 'background 0.15s', marginBottom: 4,
            }}>
            <div style={{
              width: labelWidth, fontSize: compact ? 11 : 12, fontWeight: 600, color: C.text, textAlign: 'right',
              flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {col.column}
            </div>
            <div style={{ flex: 1, height: compact ? 16 : 20, background: C.light, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`, height: '100%', background: color, borderRadius: 4,
                transition: 'width 0.5s ease', minWidth: col.n_outliers > 0 ? 16 : 0,
              }} />
            </div>
            <div style={{ width: compact ? 26 : 46, fontSize: compact ? 11 : 12, fontWeight: 800,
              color: col.n_outliers > 0 ? color : '#94a3b8', textAlign: 'right', flexShrink: 0 }}>
              {col.n_outliers}
            </div>
            {!compact && (
              <div style={{
                width: 46, fontSize: 10, fontWeight: 700, flexShrink: 0, textAlign: 'center',
                color: col.method === 'zscore' ? C.primary : C.warning,
                background: col.method === 'zscore' ? C.primarySoft : C.warningSoft,
                borderRadius: 6, padding: '2px 6px',
              }}>
                {col.method === 'zscore' ? 'Z' : 'IQR'}
              </div>
            )}
          </div>
        )
      })}
      <div style={{ fontSize: compact ? 10 : 11, color: C.muted, marginTop: 12,
        paddingLeft: compact ? 8 : 144 }}>
        {compact ? 'Click a bar to inspect ›' : "Click any bar to inspect that column's outliers in detail ›"}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW: COMPLETENESS BAR — replaces the plain "Status" column in the
// per-column imputation table with a small colored progress bar
// ─────────────────────────────────────────────────────────────────────────────
function CompletenessBar({ presentPct }) {
  const pct = presentPct * 100
  const color = pct > 90 ? C.success : pct > 60 ? C.warning : C.danger
  return (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{pct.toFixed(1)}% present</div>
      <div style={{ height: 6, background: C.light, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW: EXPANDABLE CHART — wraps every visualization (and the dataset preview
// table) with a full-screen modal expand option
// ─────────────────────────────────────────────────────────────────────────────
function ExpandableChart({ title, subtitle, children, minHeight = 260 }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div style={{ position: 'relative', background: C.white, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: '16px 20px 20px', boxShadow: shadow2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
        </div>
        <button onClick={() => setExpanded(true)} title="Expand"
          style={{ background: C.light, border: 'none', borderRadius: 6, width: 28, height: 28,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, color: C.muted, flexShrink: 0 }}>
          ⤢
        </button>
      </div>
      <div style={{ minHeight }}>{children}</div>

      {expanded && (
        <div onClick={() => setExpanded(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: C.white, borderRadius: 20, padding: 32, width: 'min(1100px,92vw)',
              maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>{title}</div>
                {subtitle && <div style={{ fontSize: 12, color: C.muted }}>{subtitle}</div>}
              </div>
              <button onClick={() => setExpanded(false)}
                style={{ background: C.light, border: 'none', borderRadius: 8, padding: '6px 14px',
                  cursor: 'pointer', fontSize: 13, fontWeight: 600, color: C.muted }}>
                ✕ Close
              </button>
            </div>
            <div style={{ minHeight: 450 }}>{children}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COLLAPSIBLE RAIL — a small reusable shell: expanded = a labeled card of a
// given width, collapsed = a vertical pill with the label rotated onto it.
// Used for both the column list and (in OutliersTab) the outliers-per-column
// chart, so multiple rails can sit side by side and collapse independently.
// ─────────────────────────────────────────────────────────────────────────────
function CollapsibleRail({ label, isOpen, setIsOpen, width = 200, collapsedHeight = 120, children }) {
  if (!isOpen) {
    return (
      <div style={{ width: 28, minWidth: 28, marginRight: 12 }}>
        <div onClick={() => setIsOpen(true)}
          style={{ width: 28, height: collapsedHeight, borderRadius: 20, background: C.white,
            border: `1px solid ${C.border}`, boxShadow: shadow2, display: 'flex',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            writingMode: 'vertical-rl', fontSize: 10, fontWeight: 700, color: C.muted,
            letterSpacing: 1, userSelect: 'none' }}>
          ▶ {label}
        </div>
      </div>
    )
  }
  return (
    <div style={{ width, minWidth: width, maxWidth: width, marginRight: 16 }}>
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12,
        boxShadow: shadow2, maxHeight: 'calc(100vh - 280px)', overflowY: 'auto',
        display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 12px', fontWeight: 700, fontSize: 11, letterSpacing: 1,
          textTransform: 'uppercase', color: C.muted, borderBottom: `1px solid ${C.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {label}
          <button onClick={() => setIsOpen(false)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.muted }}>
            ◀
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ColumnListItems({ columns, selected, onSelect, countsMap = {}, colorKey }) {
  const colColors = { dup: C.warning, out: C.danger, mis: C.primary }
  const accent = colColors[colorKey] || C.primary
  return columns.map(col => {
    const cnt = countsMap[col]
    const isActive = selected === col
    return (
      <div key={col} onClick={() => onSelect(col)}
        style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between',
          background: isActive ? `${accent}12` : 'transparent',
          borderLeft: isActive ? `3px solid ${accent}` : '3px solid transparent' }}>
        <span style={{ fontWeight: isActive ? 700 : 400, fontSize: 12, color: C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {col}
        </span>
        {cnt !== undefined && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: cnt > 0 ? C.danger : C.success,
            background: cnt > 0 ? C.dangerSoft : C.successSoft,
            padding: '1px 6px', borderRadius: 20, flexShrink: 0, marginLeft: 4,
          }}>
            {cnt}
          </span>
        )}
      </div>
    )
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN PANEL — split-pane: 200px collapsible left rail (column list) +
// children on the right. Used as-is by MissingTab. OutliersTab instead
// composes CollapsibleRail + ColumnListItems directly, alongside a second
// rail for the outliers-per-column chart — see OutliersTab below.
// ─────────────────────────────────────────────────────────────────────────────
function ColumnPanel({ columns, selected, onSelect, countsMap = {}, colorKey, children }) {
  const [isOpen, setIsOpen] = useState(true)
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', width: '100%' }}>
      <CollapsibleRail label="Columns" isOpen={isOpen} setIsOpen={setIsOpen}>
        <ColumnListItems columns={columns} selected={selected} onSelect={onSelect}
          countsMap={countsMap} colorKey={colorKey} />
      </CollapsibleRail>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW: METHOD SELECTOR — column name + normality result on the left,
// IQR/Z-Score toggle + threshold on the right, in one clear horizontal card
// ─────────────────────────────────────────────────────────────────────────────
function MethodSelector({ colData, method, setMethod, zThresh, setZThresh, iqrMult, setIqrMult }) {
  const suggested = colData.suggested_method
  const testLabel = colData.test_name === 'shapiro-wilk' ? 'Shapiro–Wilk'
    : colData.test_name === 'dagostino-pearson' ? "D'Agostino-Pearson"
    : 'Normality test'

  return (
    <div style={{ background: '#f8fafc', border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '14px 20px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{colData.column}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            {testLabel} p = {colData.p_value} ({colData.p_value > 0.05 ? '> 0.05' : '≤ 0.05'}) → data{' '}
            {colData.is_normal ? 'looks normal' : 'is skewed'}, {suggested === 'zscore' ? 'Z-Score' : 'IQR'} suggested.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {['iqr', 'zscore'].map(m => {
            const active = method === m
            return (
              <button key={m} onClick={() => setMethod(m)}
                style={{ padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  background: active ? C.slate : 'transparent', color: active ? 'white' : C.slate,
                  border: active ? 'none' : `1.5px solid ${C.border}` }}>
                {m === 'iqr' ? 'IQR' : 'Z-Score'}
              </button>
            )
          })}
          {method === suggested && (
            <span style={{ fontSize: 12, color: C.muted }}>
              <span style={{ color: C.warning }}>✦</span> suggested for this column
            </span>
          )}
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {method === 'zscore' ? (
          <>
            <span style={{ fontSize: 12, color: C.muted }}>Z-Score threshold</span>
            <input type="range" min={1.5} max={4} step={0.1} value={zThresh}
              onChange={e => setZThresh(+e.target.value)} style={{ width: 180, accentColor: C.primary }} />
            <strong style={{ fontSize: 13, color: C.text }}>{zThresh.toFixed(1)}σ</strong>
            <span style={{ fontSize: 11, color: C.muted }}>
              = flag values beyond {zThresh.toFixed(1)} standard deviations from the mean
            </span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 12, color: C.muted }}>IQR multiplier</span>
            <input type="range" min={0.5} max={3} step={0.1} value={iqrMult}
              onChange={e => setIqrMult(+e.target.value)} style={{ width: 180, accentColor: C.primary }} />
            <strong style={{ fontSize: 13, color: C.text }}>{iqrMult.toFixed(1)}×</strong>
            <span style={{ fontSize: 11, color: C.muted }}>
              = flag values beyond {iqrMult.toFixed(1)}× the interquartile range
            </span>
          </>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW: INFO WIDGET — pulsing, attention-grabbing "i" button; collapsed by
// default, expands inline to show the analysis note for the current tab
// ─────────────────────────────────────────────────────────────────────────────
function InfoWidget({ text }) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <div onClick={() => setOpen(true)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10,
          padding: '10px 16px', marginBottom: 20 }}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', border: '2px solid #f59e0b',
          background: 'white', color: '#f59e0b', fontWeight: 900, fontSize: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 8px rgba(245,158,11,0.35)', animation: 'infoPulse 2s ease-in-out infinite' }}>
          i
        </span>
        <span style={{ fontSize: 12, color: '#92400e', fontWeight: 600 }}>Click to see analysis notes</span>
        <style>{`@keyframes infoPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }`}</style>
      </div>
    )
  }

  return (
    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10,
      padding: '14px 16px', marginBottom: 20, position: 'relative' }}>
      <button onClick={() => setOpen(false)}
        style={{ position: 'absolute', top: 10, right: 12, background: 'none', border: 'none',
          cursor: 'pointer', fontSize: 13, color: '#92400e' }}>
        ✕
      </button>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#f59e0b', color: 'white',
          fontWeight: 900, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          i
        </span>
        <p style={{ fontSize: 13, color: '#92400e', lineHeight: 1.6, margin: 0, paddingRight: 20 }}>{text}</p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED SMALL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
const thStyle = {
  padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
  color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5,
  background: C.light, borderBottom: `1px solid ${C.border}`,
}
const tdStyle = { padding: '9px 14px', color: C.text }

function StatCard({ label, value, subtitle, color }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14,
      padding: '16px 20px', boxShadow: shadow2 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: C.muted, textTransform: 'uppercase',
        letterSpacing: 1.2, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 900, color: color || C.text, marginBottom: 4 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {subtitle && <div style={{ fontSize: 11, color: '#94a3b8' }}>{subtitle}</div>}
    </div>
  )
}

function Loader({ text }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0' }}>
      <div style={{ fontSize: 28, marginBottom: 12, animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚙</div>
      <p style={{ color: C.muted, fontSize: 14 }}>{text}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function ErrBanner({ msg }) {
  return (
    <div style={{ background: C.dangerSoft, border: `1px solid ${C.danger}`,
      borderRadius: 10, padding: '12px 16px', color: C.danger, fontSize: 13 }}>
      ⚠ {msg}
    </div>
  )
}

function Notice({ type, msg, inline }) {
  const colors = {
    success: { bg: C.successSoft, border: C.success, color: C.success, icon: '✓' },
    warning: { bg: C.warningSoft, border: C.warning, color: C.warning, icon: '⚡' },
  }
  const s = colors[type] || colors.success
  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10,
      padding: '10px 16px', color: s.color, fontSize: 13,
      display: inline ? 'inline-flex' : 'flex', alignItems: 'center', gap: 8 }}>
      <span>{s.icon}</span> {msg}
    </div>
  )
}

function Legend({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span style={{ fontSize: 11, color: C.muted }}>{label}</span>
    </div>
  )
}

function SectionHeader({ title, description }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ fontSize: 26, fontWeight: 900, color: C.text, marginBottom: 6 }}>{title}</h1>
      <p style={{ fontSize: 14, color: C.muted, maxWidth: 640, lineHeight: 1.6, margin: 0 }}>{description}</p>
    </div>
  )
}

const TABS = [
  { id: 'duplicates', label: 'Duplicates', icon: '⬥' },
  { id: 'outliers',   label: 'Outliers',   icon: '⚡' },
  { id: 'missing',    label: 'Missing Values', icon: '○' },
]

function PRISMHeader({ activeTab, setActiveTab }) {
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 100, background: C.white,
      borderBottom: `1px solid ${C.border}`, padding: '14px 24px', borderRadius: '20px 20px 0 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20, color: C.primary }}>△</span>
            <span style={{ fontSize: 18, fontWeight: 900, color: C.text, letterSpacing: 0.5 }}>PRISM</span>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.primary,
              background: '#ede9fe', padding: '3px 10px', borderRadius: 20 }}>
              STAGE {STAGE_NUMBER}
            </span>
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Cleaning · Data quality correction</div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: C.light, borderRadius: 10, padding: 4 }}>
          {TABS.map(tab => {
            const active = activeTab === tab.id
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: active ? C.white : 'transparent', color: active ? C.text : C.muted,
                  fontWeight: active ? 700 : 500, fontSize: 13, boxShadow: active ? shadow2 : 'none',
                  transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{tab.icon}</span>{tab.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function VersionsBar({ versions }) {
  return (
    <div style={{ position: 'sticky', top: 72, zIndex: 99, background: C.white,
      borderBottom: `1px solid ${C.border}`, padding: '8px 24px',
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13 }}>⏱</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>Versions:</span>
      {versions.map((v, i) => {
        const isLast = i === versions.length - 1
        return (
          <div key={`${v.stepName}-${i}`}
            style={{ display: 'flex', alignItems: 'center', gap: 4, borderRadius: 20,
              padding: '3px 6px 3px 12px', fontSize: 12, fontWeight: 600,
              border: isLast ? 'none' : `1.5px solid ${C.border}`,
              background: isLast ? C.primary : 'transparent',
              color: isLast ? 'white' : C.muted }}>
            <span>{v.label}</span>
            <button title={`Download ${v.label}`}
              onClick={() => downloadDataset(v.filePath, `${v.label.replace(/\s+/g, '_')}.csv`)}
              style={{ width: 20, height: 20, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: isLast ? 'rgba(255,255,255,0.22)' : C.light,
                color: isLast ? 'white' : C.muted, fontSize: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ⬇
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW: REDO WARNING MODAL — shown only when redoing a step would actually
// delete downstream work (never for a plain first-time or same-step action)
// ─────────────────────────────────────────────────────────────────────────────
function RedoWarningModal({ toInvalidate, onConfirm, onCancel }) {
  return (
    <div onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 3000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: C.white, borderRadius: 16, padding: 28, maxWidth: 440, width: '90vw',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, color: C.text }}>Redo this step?</div>
        <p style={{ fontSize: 13, color: C.muted, marginBottom: 14, lineHeight: 1.5 }}>
          This will delete the following completed work. You'll need to redo it:
        </p>
        <ul style={{ margin: '0 0 20px', padding: 0, listStyle: 'none' }}>
          {toInvalidate.map(v => (
            <li key={`${v.stepName}-${v.label}`} style={{ fontSize: 13, color: C.danger, padding: '6px 0',
              borderBottom: `1px solid ${C.light}` }}>
              ✕ {v.label}
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel}
            style={{ padding: '10px 20px', borderRadius: 8, border: `1px solid ${C.border}`,
              background: 'white', color: C.text, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
            Cancel
          </button>
          <button onClick={onConfirm} style={btn(C.danger, 'white', { padding: '10px 20px' })}>
            Yes, redo and delete downstream
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DUPLICATES TAB
// ─────────────────────────────────────────────────────────────────────────────
function DuplicatesTab({ filePath, stepName, done, confirmBeforeAction, registerVersion }) {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [removing, setRem]      = useState(false)
  const [error, setError]       = useState('')
  const [previewMode, setPreviewMode] = useState('all') // 'all' | 'duplicates'

  useEffect(() => {
    if (!filePath) return
    setLoading(true); setError('')
    callCleaning('profile-duplicates', { file_path: filePath })
      .then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [filePath])

  const remove = async () => {
    const ok = await confirmBeforeAction(stepName)
    if (!ok) return
    setRem(true)
    try {
      const res = await callCleaning('remove-duplicates', { file_path: filePath })
      await registerVersion(stepName, res.new_file_path, 'Duplicate Removed', res.new_row_count,
        { rows_removed: res.rows_removed })
    } catch (e) { setError(e.message) }
    finally { setRem(false) }
  }

  const redo = async () => { await confirmBeforeAction(stepName) }

  if (loading) return <Loader text="Scanning for duplicates…" />
  if (error)   return <ErrBanner msg={error} />
  if (!data)   return null

  const infoText = `Level 2 (rule-based): ${data.total_dup_rows} exact duplicate row${data.total_dup_rows !== 1 ? 's' : ''} found across ${data.total_groups} group${data.total_groups !== 1 ? 's' : ''}. Duplicated rows are highlighted below so you can verify them before removing. The first occurrence of each group is kept.`

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
        <StatCard label="Duplicate rows" value={data.total_dup_rows} subtitle="exact row matches" color={C.warning} />
        <StatCard label="Duplicate groups" value={data.total_groups} subtitle="sets of matching rows" color={C.warning} />
        <StatCard label="Rows before" value={data.total_rows} subtitle="original dataset" color={C.primary} />
        <StatCard label="Rows after"
          value={done ? data.total_rows - data.real_duplicates : data.total_rows}
          subtitle={done ? 'after removal' : 'pending removal'}
          color={done ? C.success : '#94a3b8'} />
      </div>

      <InfoWidget text={infoText} />

      {data.total_dup_rows === 0 && (
        <Notice type="success" msg="No duplicate rows found. Your dataset is clean." />
      )}

      <div style={{ marginTop: data.total_dup_rows === 0 ? 16 : 0 }}>
        <ExpandableChart
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>Dataset preview</span>
              {data.total_dup_rows > 0 && (
                <button onClick={() => setPreviewMode(m => m === 'all' ? 'duplicates' : 'all')}
                  style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                    border: `1px solid ${previewMode === 'duplicates' ? C.warning : C.border}`,
                    background: previewMode === 'duplicates' ? 'rgba(245,158,11,0.15)' : C.white,
                    color: previewMode === 'duplicates' ? '#92400e' : C.muted, cursor: 'pointer' }}>
                  {previewMode === 'duplicates' ? `● Showing duplicates only (${data.total_dup_rows})` : '☰ Show duplicates only'}
                </button>
              )}
            </div>
          }
          subtitle={`● duplicate row · ${data.total_dup_rows} of ${data.total_rows} rows flagged · # is the row's position in the full dataset · scroll to inspect`}
          minHeight={0}>
          <div style={{ maxHeight: 460, overflowY: 'auto', overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                <tr>
                  <th style={thStyle}>#</th>
                  {data.columns.map(col => <th key={col} style={thStyle}>{col}</th>)}
                  <th style={thStyle}>FLAG</th>
                </tr>
              </thead>
              <tbody>
                {data.rows
                  .map((row, ri) => ({ row, ri }))
                  .filter(({ row }) => previewMode === 'all' || row._is_dup)
                  .map(({ row, ri }) => {
                  const isDup = row._is_dup
                  return (
                    <tr key={ri} style={{
                      background: isDup ? '#fffbeb' : 'transparent',
                      borderLeft: isDup ? '3px solid #f59e0b' : '3px solid transparent',
                    }}>
                      <td style={tdStyle}>{ri + 1}</td>
                      {data.columns.map(col => (
                        <td key={col} style={tdStyle}>{String(row[col] ?? '')}</td>
                      ))}
                      <td style={tdStyle}>
                        {row._dup_group ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#92400e',
                            background: 'rgba(245,158,11,0.2)', border: '1px solid #fde68a',
                            borderRadius: 20, padding: '2px 8px' }}>
                            dup · {row._dup_group}
                          </span>
                        ) : (
                          <span style={{ color: C.muted }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </ExpandableChart>
      </div>

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {!done && data.total_dup_rows > 0 && (
          <button style={btn(C.danger, 'white', { padding: '12px 28px', fontSize: 14 })}
            onClick={remove} disabled={removing}>
            {removing ? '⏳ Removing…' : `Remove ${data.real_duplicates} Duplicate${data.real_duplicates !== 1 ? 's' : ''}`}
          </button>
        )}
        {done && (
          <>
            <Notice type="success" msg="✓ Duplicate removal complete for this dataset." />
            <button onClick={redo}
              style={{ fontSize: 12, color: C.muted, background: 'transparent', border: `1px solid ${C.border}`,
                borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}>
              ↺ Redo this step
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTLIERS TAB
// ─────────────────────────────────────────────────────────────────────────────
function OutliersTab({ filePath, stepName, done, confirmBeforeAction, registerVersion, initialSettings, saveSettings }) {
  const [globalData, setGlobal]     = useState(null)
  const [colData, setColData]       = useState(null)
  const [selCol, setSelCol]         = useState(null)
  const [loading, setLoading]       = useState(false)
  const [colLoading, setColLoad]    = useState(false)
  const [graphType, setGraphType]   = useState('histogram')
  const [method, setMethod]         = useState(null)
  const [zThresh, setZThresh]       = useState(initialSettings?.z_threshold ?? 3.0)
  const [iqrMult, setIqrMult]       = useState(initialSettings?.iqr_mult ?? 1.5)
  const [keptRows, setKeptRows]     = useState(new Set())
  const [removing, setRemoving]     = useState(false)
  const [removingAll, setRemovingAll] = useState(false)
  const [error, setError]           = useState('')
  const [colListOpen, setColListOpen]   = useState(true)
  const [chartRailOpen, setChartRailOpen] = useState(true)

  useEffect(() => {
    if (!filePath) return
    setLoading(true); setSelCol(null); setColData(null); setError('')
    callCleaning('profile-outliers-global', { file_path: filePath })
      .then(setGlobal).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [filePath])

  useEffect(() => { saveSettings({ z_threshold: zThresh, iqr_mult: iqrMult }) }, [zThresh, iqrMult]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadColumn = async (col) => {
    // The "Outliers per Column" chart collapses into its rail once the user
    // drills into a specific column — it stays reachable (click to reopen),
    // it just doesn't take over the main content area or disappear outright.
    setChartRailOpen(false)
    setSelCol(col); setColData(null); setColLoad(true); setKeptRows(new Set())
    try {
      const d = await callCleaning('profile-outliers-column', { file_path: filePath, column: col })
      setColData(d)
      setMethod(d.suggested_method)
    } catch (e) { setError(e.message) }
    finally { setColLoad(false) }
  }

  const toggleRow = useCallback((ri) => {
    setKeptRows(prev => {
      const next = new Set(prev)
      next.has(ri) ? next.delete(ri) : next.add(ri)
      return next
    })
  }, [])

  const removeSelected = async () => {
    if (!colData) return
    const ok = await confirmBeforeAction(stepName)
    if (!ok) return
    setRemoving(true)
    const computedAll = computeOutliers(colData.all_values, method, zThresh, iqrMult, colData.stats)
    const toRemove = computedAll.filter(v => v.isOutlier && !keptRows.has(v.row_index))
      .map(v => v.row_index)
    try {
      const res = await callCleaning('remove-outliers', {
        file_path: filePath, column: selCol, rows_to_remove: toRemove,
      })
      await registerVersion(stepName, res.new_file_path, 'Outliers Removed', res.new_row_count,
        { column: selCol, rows_removed: res.rows_removed })
      setSelCol(null)
      setChartRailOpen(true)
    } catch (e) { setError(e.message) }
    finally { setRemoving(false) }
  }

  // "Remove All Outliers" from the global (no column selected) view: chains
  // remove-outliers once per affected column, using each call's returned
  // new_file_path as the next call's input — the union of every column's
  // outlier rows, without needing a new backend endpoint.
  const removeAllOutliers = async () => {
    if (!globalData) return
    const ok = await confirmBeforeAction(stepName)
    if (!ok) return
    setRemovingAll(true)
    let workingPath = filePath
    let totalRemoved = 0
    const columnsWithOutliers = globalData.column_summary.filter(c => c.n_outliers > 0)
    try {
      for (const col of columnsWithOutliers) {
        const detail = await callCleaning('profile-outliers-column', { file_path: workingPath, column: col.column })
        const computed = computeOutliers(detail.all_values, detail.suggested_method, 3.0, 1.5, detail.stats)
        const rowsToRemove = computed.filter(v => v.isOutlier).map(v => v.row_index)
        if (rowsToRemove.length === 0) continue
        const res = await callCleaning('remove-outliers', {
          file_path: workingPath, column: col.column, rows_to_remove: rowsToRemove,
        })
        workingPath = res.new_file_path
        totalRemoved += res.rows_removed
      }
      await registerVersion(stepName, workingPath, 'Outliers Removed', null,
        { rows_removed: totalRemoved, columns_cleaned: columnsWithOutliers.length })
    } catch (e) { setError(e.message) }
    finally { setRemovingAll(false) }
  }

  const startOver = async () => { await confirmBeforeAction(stepName) }

  const computedValues = useMemo(() => {
    if (!colData) return []
    return computeOutliers(colData.all_values, method || 'iqr', zThresh, iqrMult, colData.stats)
  }, [colData, method, zThresh, iqrMult])

  const outlierRows = computedValues.filter(v => v.isOutlier)
  const toRemoveCount = outlierRows.filter(v => !keptRows.has(v.row_index)).length

  const histBins = useMemo(() => colData ? computeHistBins(colData.all_values) : [], [colData])

  const getBounds = () => {
    if (!colData) return {}
    const s = colData.stats
    return {
      iqrUpper: s.Q3 + iqrMult * s.IQR, iqrLower: s.Q1 - iqrMult * s.IQR,
      zUpper: s.mean + zThresh * s.std,  zLower: s.mean - zThresh * s.std,
    }
  }
  const bounds = getBounds()

  const colCounts = {}
  globalData?.column_summary?.forEach(c => { colCounts[c.column] = c.n_outliers })

  if (loading) return <Loader text="Detecting outliers across all columns…" />
  if (error)   return <ErrBanner msg={error} />
  if (!globalData) return null

  const numCols = globalData.column_summary.map(c => c.column)
  const infoText = "Select a column below to drill in. Points flagged as outliers are shown in red. Normality is tested per column (Shapiro-Wilk / D'Agostino-Pearson); IQR is suggested for skewed data, Z-Score for normal distributions."

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        <StatCard label="Total outliers" value={globalData.total_outliers} subtitle="across all numeric columns" color={C.danger} />
        <StatCard label="Numeric columns" value={numCols.length} subtitle="tested for normality" color={C.primary} />
        <StatCard label="Columns with outliers"
          value={globalData.column_summary.filter(c => c.n_outliers > 0).length}
          subtitle="have extreme values" color={C.warning} />
      </div>

      <InfoWidget text={infoText} />

      {done && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: C.successSoft, border: `1px solid ${C.success}`, borderRadius: 10,
          padding: '8px 16px', marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: C.success, fontWeight: 600 }}>✓ Progress saved for this step</span>
          <button onClick={startOver}
            style={{ fontSize: 11, color: C.muted, background: 'white', border: `1px solid ${C.border}`,
              borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontWeight: 600 }}>
            ↺ Start over
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', width: '100%' }}>
        <CollapsibleRail label="Columns" isOpen={colListOpen} setIsOpen={setColListOpen}>
          <ColumnListItems columns={numCols} selected={selCol} onSelect={loadColumn}
            countsMap={colCounts} colorKey="out" />
        </CollapsibleRail>

        <CollapsibleRail label="Outliers per Column" isOpen={chartRailOpen} setIsOpen={setChartRailOpen}
          width={260} collapsedHeight={170}>
          <div style={{ padding: '8px 6px' }}>
            <OutlierColumnBarChart columnSummary={globalData.column_summary} onSelectColumn={loadColumn} compact />
          </div>
        </CollapsibleRail>

      <div style={{ flex: 1, minWidth: 0 }}>
        {!selCol && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <ExpandableChart title="Dimensionality Reduction (PCA)" subtitle="Each dot = 1 row. Red dots are outliers.">
                <ResponsiveContainer width="100%" height={240}>
                  <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="x" type="number" name="PC1"
                      tick={{ fontSize: 10, fill: C.muted }}
                      label={{ value: 'PC1', position: 'insideBottomRight', offset: -4, fontSize: 10 }} />
                    <YAxis dataKey="y" type="number" name="PC2"
                      tick={{ fontSize: 10, fill: C.muted }}
                      label={{ value: 'PC2', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                    <ZAxis range={[18, 18]} />
                    <Tooltip formatter={(v) => v.toFixed(3)} />
                    <Scatter name="Normal"
                      data={globalData.pca_scatter.filter(p => !p.is_outlier)}
                      fill={C.primary} opacity={0.45} />
                    <Scatter name="Outlier"
                      data={globalData.pca_scatter.filter(p => p.is_outlier)}
                      fill={C.danger} opacity={0.85} />
                  </ScatterChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 6 }}>
                  <Legend color={C.primary} label="Normal" />
                  <Legend color={C.danger} label="Outlier" />
                </div>
              </ExpandableChart>

              <ExpandableChart title="Outlier Score by Row Index" subtitle="Higher score = more anomalous. Red = detected outlier.">
                <ResponsiveContainer width="100%" height={240}>
                  <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="index" type="number" name="Row Index"
                      tick={{ fontSize: 10, fill: C.muted }}
                      label={{ value: 'Row Index', position: 'insideBottomRight', offset: -4, fontSize: 10 }} />
                    <YAxis dataKey="score" type="number" name="Outlier Score"
                      domain={[0, 1]} tick={{ fontSize: 10, fill: C.muted }} />
                    <ZAxis range={[12, 12]} />
                    <Tooltip formatter={(v) => typeof v === 'number' ? v.toFixed(3) : v} />
                    <Scatter name="Normal"
                      data={globalData.outlier_index_plot.filter(p => !p.is_outlier)}
                      fill={C.primary} opacity={0.35} />
                    <Scatter name="Outlier"
                      data={globalData.outlier_index_plot.filter(p => p.is_outlier)}
                      fill={C.danger} opacity={0.9} />
                    <ReferenceLine y={0.5} stroke={C.warning} strokeDasharray="4,3"
                      label={{ value: 'Threshold', fontSize: 9, fill: C.warning }} />
                  </ScatterChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 6 }}>
                  <Legend color={C.primary} label="Normal" />
                  <Legend color={C.danger} label="Outlier" />
                </div>
              </ExpandableChart>
            </div>

            {globalData.total_outliers > 0 && (
              <div style={{ marginTop: 20 }}>
                <button style={btn(C.danger, 'white', { padding: '12px 28px', fontSize: 14 })}
                  onClick={removeAllOutliers} disabled={removingAll}>
                  {removingAll ? '⏳ Removing across all columns…' : `Remove All ${globalData.total_outliers} Outliers`}
                </button>
              </div>
            )}
          </div>
        )}

        {selCol && (
          <div>
            {colLoading && <Loader text={`Analysing "${selCol}"…`} />}
            {!colLoading && colData && (
              <>
                <MethodSelector colData={colData} method={method} setMethod={setMethod}
                  zThresh={zThresh} setZThresh={setZThresh} iqrMult={iqrMult} setIqrMult={setIqrMult} />

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 14 }}>
                  {['histogram', 'strip'].map(t => (
                    <button key={t} onClick={() => setGraphType(t)}
                      style={btn(graphType === t ? C.primary : C.light,
                        graphType === t ? 'white' : C.muted, { fontSize: 12 })}>
                      {t === 'histogram' ? '📊 Histogram' : '⠿ Strip Plot'}
                    </button>
                  ))}
                </div>

                {graphType === 'histogram' && (
                  <ExpandableChart title={`Distribution — "${selCol}"`}
                    subtitle="Amber lines = IQR bounds · Pink dashed = Z-Score bounds · Red bars = outlier zone">
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={histBins} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis dataKey="mid" type="number"
                          domain={[histBins[0]?.mid, histBins[histBins.length - 1]?.mid]}
                          tickFormatter={v => v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}
                          tick={{ fontSize: 10, fill: C.muted }} />
                        <YAxis tick={{ fontSize: 10, fill: C.muted }} />
                        <Tooltip
                          formatter={(v) => [v, 'Count']}
                          labelFormatter={v => `Value ≈ ${Number(v).toFixed(2)}`}
                          contentStyle={{ borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, boxShadow: shadow2 }}
                        />
                        <ReferenceArea x1={bounds.iqrLower} x2={bounds.iqrUpper} fill="rgba(16,185,129,0.06)" />
                        <ReferenceLine x={bounds.iqrUpper} stroke={C.amber} strokeWidth={2}
                          label={{ value: 'IQR+', fontSize: 9, fill: C.amber }} />
                        <ReferenceLine x={bounds.iqrLower} stroke={C.amber} strokeWidth={2}
                          label={{ value: 'IQR−', fontSize: 9, fill: C.amber }} />
                        <ReferenceLine x={bounds.zUpper} stroke={C.pink} strokeWidth={1.5} strokeDasharray="5,3"
                          label={{ value: 'Z+', fontSize: 9, fill: C.pink }} />
                        <ReferenceLine x={bounds.zLower} stroke={C.pink} strokeWidth={1.5} strokeDasharray="5,3"
                          label={{ value: 'Z−', fontSize: 9, fill: C.pink }} />
                        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                          {histBins.map((bin, i) => {
                            const isOut = bin.mid > bounds.iqrUpper || bin.mid < bounds.iqrLower
                            return <Cell key={i} fill={isOut ? 'rgba(239,68,68,0.65)' : '#818cf8'} />
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <svg width={20} height={10}><line x1={0} y1={5} x2={20} y2={5} stroke={C.amber} strokeWidth={2} /></svg>
                        <span style={{ fontSize: 11, color: C.muted }}>IQR bound</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <svg width={20} height={10}><line x1={0} y1={5} x2={20} y2={5} stroke={C.pink} strokeWidth={1.5} strokeDasharray="4,3" /></svg>
                        <span style={{ fontSize: 11, color: C.muted }}>Z-Score bound</span>
                      </div>
                    </div>
                  </ExpandableChart>
                )}

                {graphType === 'strip' && (
                  <ExpandableChart title={`Strip Plot — "${selCol}"`}
                    subtitle="Click a red dot to mark it as 'keep'. Gray = user chose to keep.">
                    <StripPlot
                      computedValues={computedValues}
                      stats={colData.stats}
                      method={method || 'iqr'}
                      zThresh={zThresh} iqrMult={iqrMult}
                      keptRows={keptRows} onToggleRow={toggleRow}
                    />
                  </ExpandableChart>
                )}

                {outlierRows.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>Detected Outliers</h4>
                      <span style={{ fontSize: 12, color: C.muted, background: C.light, padding: '3px 10px', borderRadius: 20 }}>
                        {outlierRows.length} detected ·{' '}
                        <span style={{ color: C.danger }}>{toRemoveCount} to remove</span> ·{' '}
                        <span style={{ color: C.success }}>{keptRows.size} kept</span>
                      </span>
                      <button style={{ ...btn(C.light, C.muted, { fontSize: 11, marginLeft: 'auto' }), border: `1px solid ${C.border}` }}
                        onClick={() => setKeptRows(new Set())}>
                        Reset selections
                      </button>
                    </div>

                    <div style={{ maxHeight: 300, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 10 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead style={{ position: 'sticky', top: 0, background: C.light, zIndex: 2 }}>
                          <tr>
                            <th style={thStyle}>Row #</th>
                            <th style={thStyle}>Value</th>
                            <th style={thStyle}>Score</th>
                            <th style={thStyle}>Type</th>
                            <th style={thStyle}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {outlierRows.map((v) => {
                            const keep = keptRows.has(v.row_index)
                            const isAbove = v.value > (method === 'zscore' ? colData.stats.mean : colData.stats.Q3)
                            return (
                              <tr key={v.row_index} style={{ background: keep ? 'rgba(148,163,184,0.08)' : C.dangerSoft }}>
                                <td style={tdStyle}>{v.row_index}</td>
                                <td style={{ ...tdStyle, fontWeight: 700, color: C.text }}>{v.value}</td>
                                <td style={tdStyle}>{v.score.toFixed(3)}</td>
                                <td style={tdStyle}>
                                  <span style={{ fontSize: 10, fontWeight: 700,
                                    color: isAbove ? C.danger : C.warning,
                                    background: isAbove ? C.dangerSoft : C.warningSoft,
                                    padding: '2px 8px', borderRadius: 20 }}>
                                    {isAbove ? 'Upper' : 'Lower'}
                                  </span>
                                </td>
                                <td style={tdStyle}>
                                  <button onClick={() => toggleRow(v.row_index)}
                                    style={{ ...btn(keep ? C.light : C.dangerSoft, keep ? C.muted : C.danger,
                                      { fontSize: 11, padding: '4px 10px' }), border: `1px solid ${keep ? C.border : C.danger}` }}>
                                    {keep ? '✓ Keep' : '✗ Remove'}
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {outlierRows.length === 0 && (
                  <Notice type="success" msg="No outliers detected for this column with the current threshold." />
                )}

                {outlierRows.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <button style={btn(C.danger, 'white', { padding: '12px 28px', fontSize: 14 })}
                      onClick={removeSelected} disabled={removing || toRemoveCount === 0}>
                      {removing ? '⏳ Removing…' : `Remove ${toRemoveCount} Row${toRemoveCount !== 1 ? 's' : ''}`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MISSING VALUES TAB
// ─────────────────────────────────────────────────────────────────────────────
function MissingTab({ filePath, stepName, done, confirmBeforeAction, registerVersion, initialSettings, saveSettings }) {
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(false)
  const [rowMin, setRowMin]       = useState(null)
  const [rowApplying, setRowApp]  = useState(false)
  const [colMethod, setColMethod] = useState(initialSettings?.missing_methods || {})
  const [applying, setApplying]   = useState(null)
  const [results, setResults]     = useState({})
  const [error, setError]         = useState('')

  useEffect(() => {
    if (!filePath) return
    setLoading(true); setResults({}); setError('')
    callCleaning('profile-missing-global', { file_path: filePath })
      .then(d => { setData(d); setRowMin(initialSettings?.row_threshold ?? d.total_cols) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [filePath]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (rowMin == null) return
    saveSettings({ missing_methods: colMethod, row_threshold: rowMin })
  }, [colMethod, rowMin]) // eslint-disable-line react-hooks/exhaustive-deps

  const rowsToDrop = data
    ? data.row_completeness
        .filter(r => (data.total_cols - r.missing_per_row) < (rowMin ?? data.total_cols))
        .reduce((sum, r) => sum + r.row_count, 0)
    : 0

  const applyRowThreshold = async () => {
    const ok = await confirmBeforeAction(stepName)
    if (!ok) return
    setRowApp(true)
    try {
      const res = await callCleaning('apply-row-threshold', { file_path: filePath, min_present: rowMin })
      await registerVersion(stepName, res.new_file_path, 'Incomplete Rows Dropped', res.new_row_count,
        { rows_removed: res.rows_removed })
    } catch (e) { setError(e.message) }
    finally { setRowApp(false) }
  }

  const applyColumn = async (col) => {
    const m = colMethod[col]
    if (!m) return
    const ok = await confirmBeforeAction(stepName)
    if (!ok) return
    setApplying(col)
    try {
      const res = await callCleaning('apply-missing-column', { file_path: filePath, column: col, method: m })
      setResults(prev => ({ ...prev, [col]: res }))
      await registerVersion(stepName, res.new_file_path, 'Missing Values Imputed', null,
        { column: col, method: m })
    } catch (e) { setError(e.message) }
    finally { setApplying(null) }
  }

  const startOver = async () => { await confirmBeforeAction(stepName) }

  if (loading) return <Loader text="Analysing missing values…" />
  if (error)   return <ErrBanner msg={error} />
  if (!data)   return null

  const methodOptions = (type) => {
    const all = [
      { value: 'mean',          label: 'Fill with mean', numOnly: true },
      { value: 'mode',          label: 'Fill with mode', numOnly: false },
      { value: 'knn',           label: 'KNN Imputer',    numOnly: true },
      { value: 'interpolation', label: 'Interpolation',  numOnly: true },
      { value: 'drop_rows',     label: 'Drop rows',      numOnly: false },
      { value: 'drop_column',   label: 'Drop entire column', numOnly: false },
    ]
    return all.filter(o => type === 'numerical' || !o.numOnly)
  }

  const colsWithMissing = data.bar_data.filter(b => b.missing > 0)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
        <StatCard label="Missing cells" value={data.total_missing} subtitle="across the dataset" color={C.danger} />
        <StatCard label="Columns affected" value={`${data.cols_with_missing} / ${data.total_cols}`}
          subtitle="have missing values" color={C.warning} />
        <StatCard label="Complete rows" value={data.complete_rows} subtitle={`${data.complete_rows_pct}% of rows`} color={C.success} />
        <StatCard label="Total rows" value={data.total_rows} color={C.primary} />
      </div>

      {done && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: C.successSoft, border: `1px solid ${C.success}`, borderRadius: 10,
          padding: '8px 16px', marginBottom: 20 }}>
          <span style={{ fontSize: 12, color: C.success, fontWeight: 600 }}>✓ Progress saved for this step</span>
          <button onClick={startOver}
            style={{ fontSize: 11, color: C.muted, background: 'white', border: `1px solid ${C.border}`,
              borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontWeight: 600 }}>
            ↺ Start over
          </button>
        </div>
      )}

      {data.total_missing > 0 && (
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14,
          padding: '22px 24px', marginBottom: 24 }}>
          <h4 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, color: C.text }}>
            ✂ Drop rows that don't satisfy the minimum number of features first
          </h4>
          <p style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
            Set the minimum number of present values a row must have. Rows below this are dropped before any imputation.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: C.muted }}>min present values / row</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{rowMin} / {data.total_cols}</span>
              </div>
              <input type="range" min={1} max={data.total_cols} step={1}
                value={rowMin ?? data.total_cols}
                onChange={e => setRowMin(+e.target.value)}
                style={{ width: '100%', accentColor: C.primary }} />
              <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
                = allow at most {data.total_cols - (rowMin ?? data.total_cols)} missing features per row
              </div>
            </div>

            <div style={{ background: '#f8fafc', border: `1px solid ${C.border}`, borderRadius: 12,
              padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div>
                <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>Rows dropped</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: C.danger }}>{rowsToDrop}</div>
              </div>
              <span style={{ fontSize: 16, color: '#94a3b8' }}>→</span>
              <div>
                <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>Rows kept</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: C.success }}>{data.total_rows - rowsToDrop}</div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
            <span style={{ fontSize: 12, color: C.muted }}>Applies before per-column imputation.</span>
            <button style={btn(C.slate, 'white', { padding: '10px 22px' })} onClick={applyRowThreshold} disabled={rowApplying}>
              {rowApplying ? '⏳ Applying…' : '✂ Drop rows below threshold'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24, alignItems: 'start' }}>
        <ExpandableChart title="Non-null ratio per column" subtitle="Green ≥ 90% present · Amber ≥ 70% · Red below" minHeight={0}>
          <MissingBarChart barData={data.bar_data} />
        </ExpandableChart>
        <ExpandableChart title="Missing value matrix"
          subtitle="Dark = value present · Light = missing. Each row = one data row (sampled)." minHeight={0}>
          <MissingMatrix matrixData={data.matrix_data} />
        </ExpandableChart>
      </div>

      <div>
        <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: C.text }}>Per-Column Imputation</h4>
        {colsWithMissing.length === 0 ? (
          <Notice type="success" msg="No missing values remain in this dataset." />
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.light }}>
                  <th style={thStyle}>Column</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Missing</th>
                  <th style={thStyle}>%</th>
                  <th style={thStyle}>Choose method</th>
                  <th style={thStyle}>Completeness</th>
                </tr>
              </thead>
              <tbody>
                {colsWithMissing.map((col) => {
                  const done = results[col.column]
                  const isApplying = applying === col.column
                  const severity = col.missing_pct > 30 ? 'high' : col.missing_pct > 10 ? 'medium' : 'low'
                  const sevColor = { high: C.danger, medium: C.warning, low: C.muted }[severity]
                  const currentPresentPct = done
                    ? 1 - (done.after_missing / data.total_rows)
                    : col.present_pct
                  return (
                    <tr key={col.column} style={{ borderTop: `1px solid ${C.border}`, background: done ? C.successSoft : 'transparent' }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{col.column}</td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600,
                          background: col.type === 'numerical' ? 'rgba(99,102,241,0.1)' : 'rgba(20,184,166,0.1)',
                          color: col.type === 'numerical' ? C.primary : '#0d9488' }}>
                          {col.type}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, color: sevColor, fontWeight: 700 }}>{col.missing}</td>
                      <td style={{ ...tdStyle, color: sevColor }}>{col.missing_pct}%</td>
                      <td style={tdStyle}>
                        {done ? (
                          <span style={{ color: C.success, fontSize: 12 }}>✓ {colMethod[col.column]}</span>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <select
                              value={colMethod[col.column] || ''}
                              onChange={e => setColMethod(p => ({ ...p, [col.column]: e.target.value }))}
                              style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '5px 10px',
                                fontSize: 12, background: C.white, color: C.text, cursor: 'pointer' }}>
                              <option value="">— select method —</option>
                              {methodOptions(col.type).map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                            <button
                              style={btn(C.primary, 'white', { fontSize: 11, padding: '5px 14px',
                                opacity: colMethod[col.column] ? 1 : 0.4 })}
                              disabled={!colMethod[col.column] || isApplying}
                              onClick={() => applyColumn(col.column)}>
                              {isApplying ? '⏳' : 'Apply'}
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <CompletenessBar presentPct={currentPresentPct} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN CLEANING PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function CleaningPage({ projectData, onNext, onUpdateData }) {
  const { projectId } = projectData
  const [activeTab, setActiveTab] = useState('duplicates')
  const [versions, setVersions] = useState([{
    id: null, stepName: 'upload', label: 'Original Dataset',
    filePath: projectData.cleanedFilePath || projectData.filePath,
    rowCount: null,
  }])
  const [cleaningSettings, setCleaningSettings] = useState({})
  const [redoModal, setRedoModal] = useState(null) // { toInvalidate, onConfirm, onCancel }
  const settingsSaveTimer = useRef(null)

  // Hydrate from Django on mount, if we have a projectId — restores the
  // versions bar and cached settings across a refresh. If Django is
  // unreachable (or projectId is absent), the page still works with the
  // local-only versions state seeded above — same "optional backend never
  // breaks the page" principle as the FastAPI profiling call in
  // datasets/views.py's DatasetUploadView.
  useEffect(() => {
    if (!projectId) return
    (async () => {
      try {
        const [{ data: remoteVersions }, { data: workflow }] = await Promise.all([
          versionsAPI.list(projectId),
          workflowAPI.get(projectId),
        ])
        if (remoteVersions.length) {
          setVersions(remoteVersions.map(v => ({
            id: v.id, stepName: v.step_name, label: v.version_label,
            filePath: v.file_path, rowCount: v.row_count,
          })))
        }
        setCleaningSettings(workflow.step_settings?.cleaning || {})
      } catch {
        // Django/network unavailable — local-only version tracking still works.
      }
    })()
  }, [projectId])

  // DISPLAY RULE: if this step already has its own version, show THAT
  // (the output the user just created) — never the input forever. Only
  // fall back to the nearest earlier version when this step hasn't run
  // yet. Getting this backwards was the bug: the old getFilePath always
  // returned the input, so a tab could never show its own results.
  const getDisplayPath = useCallback((stepName) => {
    const thisStepVersion = versions.find(v => v.stepName === stepName)
    if (thisStepVersion) return thisStepVersion.filePath

    const order = STEP_ORDER[stepName]
    const candidates = versions
      .filter(v => STEP_ORDER[v.stepName] < order)
      .sort((a, b) => STEP_ORDER[b.stepName] - STEP_ORDER[a.stepName])
    return candidates[0]?.filePath || projectData.filePath
  }, [versions, projectData.filePath])

  const isStepDone = useCallback((stepName) => versions.some(v => v.stepName === stepName), [versions])

  // Before running a cleaning action for `stepName`, check whether it would
  // invalidate later-step versions that already exist (the user redoing an
  // earlier step after already finishing later ones, or explicitly hitting
  // "Redo"/"Start over"). If so, show RedoWarningModal — Global Rule 3
  // forbids silent destructive action — and cascade-delete (local + Django)
  // only on confirmation. When nothing downstream exists, this silently
  // clears any existing version for THIS step and resolves true — that's
  // what makes a same-step re-run (redoing outliers with a new threshold,
  // clicking "Redo" on an already-done step) work without a prompt.
  const confirmBeforeAction = useCallback((stepName) => {
    const order = STEP_ORDER[stepName]
    const toInvalidate = versions.filter(v => STEP_ORDER[v.stepName] > order)

    const proceed = async () => {
      setVersions(prev => prev.filter(v => STEP_ORDER[v.stepName] < order))
      if (projectId) {
        try { await versionsAPI.cascadeDelete(projectId, stepName) } catch { /* Django optional */ }
      }
      return true
    }

    if (toInvalidate.length === 0) return proceed()

    return new Promise(resolve => {
      setRedoModal({
        toInvalidate,
        onConfirm: async () => { setRedoModal(null); resolve(await proceed()) },
        onCancel: () => { setRedoModal(null); resolve(false) },
      })
    })
  }, [versions, projectId])

  // REGISTER RULE: keep only versions strictly before this step, then add
  // the new one. This removes any existing version for THIS SAME step
  // (so redoing/re-running never accumulates duplicates) and cascades away
  // anything downstream, unconditionally — a safety net independent of
  // whether confirmBeforeAction already did this, so sequential same-step
  // edits (imputing column B right after column A) never pile up either.
  const registerVersion = useCallback(async (stepName, filePath, label, rowCount, summary = {}) => {
    const order = STEP_ORDER[stepName]
    setVersions(prev => [
      ...prev.filter(v => STEP_ORDER[v.stepName] < order),
      { id: null, stepName, label, filePath, rowCount },
    ])
    onUpdateData({ cleanedFilePath: filePath })
    if (!projectId) return
    try {
      await versionsAPI.cascadeDelete(projectId, stepName)
      const { data } = await versionsAPI.register(projectId, {
        step_name: stepName, file_path: filePath, version_label: label,
        row_count: rowCount || 0, summary,
      })
      setVersions(prev => prev.map(v => (v.stepName === stepName && v.filePath === filePath) ? { ...v, id: data.id } : v))
    } catch { /* Django optional — same resilience principle as FastAPI profiling in datasets/views.py */ }
  }, [projectId, onUpdateData])

  const saveCleaningSettings = useCallback((patch) => {
    setCleaningSettings(prev => ({ ...prev, ...patch }))
    if (!projectId) return
    clearTimeout(settingsSaveTimer.current)
    settingsSaveTimer.current = setTimeout(() => {
      workflowAPI.patch(projectId, { step_settings: { cleaning: patch } }).catch(() => {})
    }, 500)
  }, [projectId])

  if (!versions[0]?.filePath) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
        <p style={{ color: C.muted }}>No dataset found. Please go back and upload a file.</p>
        <button style={{ ...btn(C.primary), marginTop: 16 }} onClick={() => onNext('upload', {})}>
          ← Back to Upload
        </button>
      </div>
    )
  }

  return (
    <div className="anim-up">
      <div style={{ background: C.white, borderRadius: 20, border: `1.5px solid ${C.border}`, boxShadow: shadow, overflow: 'hidden' }}>
        <PRISMHeader activeTab={activeTab} setActiveTab={setActiveTab} />
        <VersionsBar versions={versions} />

        <div style={{ padding: 32 }}>
          {activeTab === 'duplicates' && (
            <>
              <SectionHeader title={STEP_INFO.duplicates.title} description={STEP_INFO.duplicates.description} />
              <DuplicatesTab
                filePath={getDisplayPath('cleaning_duplicates')}
                stepName="cleaning_duplicates"
                done={isStepDone('cleaning_duplicates')}
                confirmBeforeAction={confirmBeforeAction}
                registerVersion={registerVersion}
              />
            </>
          )}
          {activeTab === 'outliers' && (
            <>
              <SectionHeader title={STEP_INFO.outliers.title} description={STEP_INFO.outliers.description} />
              <OutliersTab
                filePath={getDisplayPath('cleaning_outliers')}
                stepName="cleaning_outliers"
                done={isStepDone('cleaning_outliers')}
                confirmBeforeAction={confirmBeforeAction}
                registerVersion={registerVersion}
                initialSettings={cleaningSettings}
                saveSettings={saveCleaningSettings}
              />
            </>
          )}
          {activeTab === 'missing' && (
            <>
              <SectionHeader title={STEP_INFO.missing.title} description={STEP_INFO.missing.description} />
              <MissingTab
                filePath={getDisplayPath('cleaning_missing')}
                stepName="cleaning_missing"
                done={isStepDone('cleaning_missing')}
                confirmBeforeAction={confirmBeforeAction}
                registerVersion={registerVersion}
                initialSettings={cleaningSettings}
                saveSettings={saveCleaningSettings}
              />
            </>
          )}
        </div>
      </div>

      {redoModal && (
        <RedoWarningModal
          toInvalidate={redoModal.toInvalidate}
          onConfirm={redoModal.onConfirm}
          onCancel={redoModal.onCancel}
        />
      )}
    </div>
  )
}
