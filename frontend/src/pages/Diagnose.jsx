import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList,
  ResponsiveContainer, ScatterChart, Scatter, ZAxis,
} from 'recharts'
import { DARK, useTheme } from '../theme'
import TopNav from '../components/TopNav'
import SharedVersionsBar from '../components/VersionsBar'

// 127.0.0.1, not "localhost" — dual-stack landmine on this machine, see
// docs/PROJECT_HANDOFF.md §11.2.
const ML_API = 'http://127.0.0.1:8001'

const callDiagnose = async (endpoint, body) => {
  const res = await fetch(`${ML_API}/diagnose/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || `Error ${res.status}`) }
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────────
// THEME — DARK/LIGHT tokens now live in ../theme.jsx (shared across every
// page, one toggle instead of five). Re-exported here under their original
// names since this file still compares `C === DARK` in a couple of places.
// ─────────────────────────────────────────────────────────────────────────────
const PALETTE = ['#2dd4bf', '#f59e0b', '#f87171', '#a78bfa', '#34d399', '#fb923c', '#38bdf8', '#f472b6']

const shadow = '0 4px 24px rgba(0,0,0,0.18)'
const shadow2 = '0 1px 4px rgba(0,0,0,0.12)'
const btn = (bg, color, extra = {}) => ({
  padding: '7px 16px', borderRadius: 8, border: 'none', background: bg, color,
  fontWeight: 700, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s', ...extra,
})

// ─────────────────────────────────────────────────────────────────────────────
// CSV parsing + stats utilities — self-contained (Upload.jsx's equivalents
// aren't exported, and only Diagnose.jsx is meant to be touched here), so
// these are re-implemented locally. Same duplication pattern already present
// in this codebase between ml-core/cleaning.py and cleaning_router_v2.py.
// ─────────────────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false }
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  if (!rows.length) return { columns: [], rows: [] }
  const columns = rows[0].map(c => c.trim())
  const dataRows = rows.slice(1).filter(r => r.length === columns.length)
  const parsed = dataRows.map(r => {
    const obj = {}
    columns.forEach((col, i) => {
      const raw = (r[i] ?? '').trim()
      if (raw === '') { obj[col] = null; return }
      const num = Number(raw)
      obj[col] = (raw !== '' && !isNaN(num)) ? num : raw
    })
    return obj
  })
  return { columns, rows: parsed }
}

function coerceValue(raw, wasNumeric) {
  const trimmed = String(raw).trim()
  if (trimmed === '') return null
  const num = Number(trimmed)
  if (wasNumeric && !isNaN(num)) return num
  if (!wasNumeric && !isNaN(num) && trimmed !== '') return num
  return trimmed
}

const quantile = (sorted, q) => {
  if (!sorted.length) return null
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos), rest = pos - base
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base]
}

function computeColumnStats(col, rows) {
  const raw = rows.map(r => r[col])
  const nonMissing = raw.filter(v => v !== null && v !== undefined)
  const missing = raw.length - nonMissing.length
  const numericVals = nonMissing.filter(v => typeof v === 'number')
  const numericRatio = nonMissing.length ? numericVals.length / nonMissing.length : 0
  const type = numericRatio >= 0.95 ? 'numerical' : numericRatio <= 0.05 ? 'categorical' : 'mixed'
  const unique = new Set(nonMissing).size

  const stats = {
    type, missing, missingPct: raw.length ? +(missing / raw.length * 100).toFixed(2) : 0,
    unique, total: raw.length, numericRatio,
    isBinary: unique === 2,
  }

  if (type === 'numerical' || (type === 'mixed' && numericVals.length > 4)) {
    const sorted = [...numericVals].sort((a, b) => a - b)
    const n = sorted.length
    const mean = sorted.reduce((s, v) => s + v, 0) / (n || 1)
    const variance = n ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n : 0
    const std = Math.sqrt(variance)
    const skew = std > 0 && n > 0 ? (sorted.reduce((s, v) => s + (v - mean) ** 3, 0) / n) / std ** 3 : 0
    const Q1 = quantile(sorted, 0.25), Q3 = quantile(sorted, 0.75)
    const IQR = (Q1 != null && Q3 != null) ? Q3 - Q1 : 0
    const lower = Q1 - 1.5 * IQR, upper = Q3 + 1.5 * IQR
    const outlierCount = sorted.filter(v => v < lower || v > upper).length
    const zeroCount = sorted.filter(v => v === 0).length
    const negativeCount = sorted.filter(v => v < 0).length
    Object.assign(stats, {
      min: sorted[0] ?? null, max: sorted[n - 1] ?? null, mean, std,
      median: quantile(sorted, 0.5), p25: Q1, p75: Q3, IQR, skew,
      outlierCount, zeroCount, negativeCount,
    })
  } else {
    const counts = {}
    nonMissing.forEach(v => { counts[v] = (counts[v] || 0) + 1 })
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
    stats.valueCounts = entries.slice(0, 12).map(([value, count]) => ({
      value, count, pct: +(count / (nonMissing.length || 1) * 100).toFixed(1),
    }))
    stats.mostCommon = entries[0]?.[0] ?? null
    stats.mostCommonPct = entries[0] ? +(entries[0][1] / (nonMissing.length || 1) * 100).toFixed(1) : 0
  }
  return stats
}

function pearsonCorrelation(colA, colB, rows) {
  const pairs = rows
    .map(r => [r[colA], r[colB]])
    .filter(([a, b]) => typeof a === 'number' && typeof b === 'number')
  const n = pairs.length
  if (n < 3) return null
  const meanA = pairs.reduce((s, [a]) => s + a, 0) / n
  const meanB = pairs.reduce((s, [, b]) => s + b, 0) / n
  let num = 0, denA = 0, denB = 0
  pairs.forEach(([a, b]) => { num += (a - meanA) * (b - meanB); denA += (a - meanA) ** 2; denB += (b - meanB) ** 2 })
  const den = Math.sqrt(denA * denB)
  return den > 0 ? num / den : 0
}

const TARGET_HINTS = ['target', 'label', 'class', 'outcome', 'diagnosis', 'species', 'medv', 'y']
const ID_HINTS = ['id', 'key', 'uuid', 'index']
const ZERO_INVALID_HINTS = ['glucose', 'bloodpressure', 'bmi', 'skinthickness', 'insulin', 'heartrate', 'height', 'weight']

function suggestTargetColumn(columns, columnsInfo) {
  const hinted = columns.find(c => TARGET_HINTS.some(h => c.toLowerCase().includes(h)))
  if (hinted) return hinted
  return null
}

function classBalance(col, rows) {
  if (!col) return null
  const values = rows.map(r => r[col]).filter(v => v !== null && v !== undefined)
  if (!values.length) return null
  const counts = {}
  values.forEach(v => { counts[v] = (counts[v] || 0) + 1 })
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const majorityPct = entries[0][1] / values.length * 100
  const level = majorityPct > 70 ? 'Heavily Imbalanced' : majorityPct > 55 ? 'Slightly Imbalanced' : 'Balanced'
  return {
    entries: entries.map(([value, count]) => ({ value, count, pct: +(count / values.length * 100).toFixed(1) })),
    majorityPct, level,
  }
}

// Level-2 rule-based per-column issue detector (Global Rule 1). Everything it
// looks at comes from this page's own loaded data (Global Rule 2).
function detectColumnIssue(col, stats, colLower) {
  const { type, missing, missingPct, unique, total } = stats

  if (unique === 1 && total > 0) {
    return {
      severity: 'warning', label: 'CONSTANT FEATURE', title: 'Constant Feature',
      explanation: `Every non-missing value in "${col}" is identical. A constant column carries no information a model can learn from.`,
      actions: [{ label: 'Drop This Column', type: 'remove' }],
    }
  }

  if (type === 'numerical' && stats.zeroCount > 0 && stats.zeroCount < total * 0.3 && ZERO_INVALID_HINTS.some(h => colLower.includes(h))) {
    return {
      severity: 'danger', label: 'ZERO VALUES DETECTED', title: 'Biological Impossibility',
      explanation: `${stats.zeroCount} row${stats.zeroCount !== 1 ? 's' : ''} have a "${col}" value of 0. This is very unlikely to be a real measurement and probably represents missing data recorded as zero.`,
      actions: [{ label: 'Replace with NaN', type: 'zero-to-nan' }, { label: 'Impute (Mean)', type: 'impute-mean' }],
    }
  }

  if (type === 'numerical' && stats.negativeCount > 0 && ZERO_INVALID_HINTS.concat(['age', 'count', 'price', 'quantity']).some(h => colLower.includes(h))) {
    return {
      severity: 'danger', label: 'INVALID VALUES', title: 'Invalid Values',
      explanation: `${stats.negativeCount} row${stats.negativeCount !== 1 ? 's' : ''} in "${col}" are negative, which isn't physically valid for this kind of measurement.`,
      actions: [{ label: 'Replace with NaN', type: 'negative-to-nan' }],
    }
  }

  if (missingPct > 40) {
    return {
      severity: 'danger', label: 'HIGH MISSINGNESS', title: 'High Missingness',
      explanation: `${missing} of ${total} rows (${missingPct}%) are missing "${col}". Imputation at this level of missingness can introduce significant bias — consider whether this column is usable at all.`,
      actions: [{ label: 'Drop This Column', type: 'remove' }, ...(type === 'numerical' ? [{ label: 'Impute (Mean)', type: 'impute-mean' }] : [{ label: 'Impute (Mode)', type: 'impute-mode' }])],
    }
  }

  if (type === 'mixed') {
    return {
      severity: 'warning', label: 'UNEXPECTED DATA TYPE', title: 'Mixed Data Types',
      explanation: `"${col}" contains a mix of numeric and non-numeric values (${Math.round(stats.numericRatio * 100)}% numeric). This usually means a data-entry inconsistency (e.g. stray text in a numeric column).`,
      actions: [],
    }
  }

  if (type === 'categorical' && ID_HINTS.some(h => colLower.includes(h)) && unique < total) {
    return {
      severity: 'warning', label: 'DUPLICATE VALUES', title: 'Duplicate Values in Identifier',
      explanation: `"${col}" looks like an identifier column, but only ${unique} of ${total} values are unique — it contains duplicates and may not be reliable as a key.`,
      actions: [],
    }
  }

  if (type === 'categorical' && unique > total * 0.85 && total > 20) {
    return {
      severity: 'warning', label: 'HIGH CARDINALITY', title: 'High Cardinality',
      explanation: `"${col}" has ${unique} distinct values across ${total} rows — nearly one per row. This behaves more like an identifier than a predictive feature.`,
      actions: [{ label: 'Drop This Column', type: 'remove' }],
    }
  }

  if (type === 'numerical' && stats.outlierCount > 0 && stats.outlierCount / total > 0.03) {
    return {
      severity: 'warning', label: 'POTENTIAL OUTLIERS', title: 'Potential Outliers',
      explanation: `${stats.outlierCount} value${stats.outlierCount !== 1 ? 's' : ''} in "${col}" fall outside the IQR-based normal range (${(stats.outlierCount / total * 100).toFixed(1)}% of rows). Review these on the Cleaning page's Outliers tab before training.`,
      actions: [],
    }
  }

  if (type === 'categorical' && unique >= 2 && unique <= 8) {
    const majorityPct = stats.mostCommonPct
    if (majorityPct > 70) {
      return {
        severity: 'warning', label: 'CLASS IMBALANCE', title: 'Class Imbalance',
        explanation: `"${stats.mostCommon}" makes up ${majorityPct}% of "${col}". A model can reach high accuracy by just predicting the majority class — consider stratified sampling or class weighting at training time.`,
        actions: [],
      }
    }
  }

  return {
    severity: 'success', label: 'HEALTHY', title: 'No Significant Issues',
    explanation: `"${col}" doesn't trigger any of the rule-based data-quality checks on this page — missingness, distribution, and cardinality all look reasonable.`,
    actions: [],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED EXPANDABLE OVERLAY — one component, reused by Data Preview, Diagnose,
// and Visualize (per spec). Theme-aware (panel surface follows light/dark;
// the scrim stays a dark blur in both themes, which reads correctly either way).
// ─────────────────────────────────────────────────────────────────────────────
function ExpandableSection({ title, subtitle, C, children, expandedContent }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <div style={{ position: 'relative' }}>
        <button onClick={() => setExpanded(true)} title="Expand"
          style={{
            position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: 6,
            background: C.faint, border: `1px solid ${C.border}`, color: C.muted,
            cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 20,
          }}>⤢</button>
        {children}
      </div>

      {expanded && (
        <div onClick={() => setExpanded(false)} style={{
          position: 'fixed', inset: 0, zIndex: 1000, background: C.scrim,
          backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'diagFadeIn 0.2s ease',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '80vw', maxWidth: 1100, maxHeight: '85vh', overflow: 'auto',
            background: C.overlayCard, border: `1px solid ${C.border}`, borderRadius: 20,
            boxShadow: '0 24px 80px rgba(0,0,0,0.6)', padding: 36,
            animation: 'diagSlideUp 0.28s cubic-bezier(0.16,1,0.3,1)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>{title}</div>
                {subtitle && <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{subtitle}</div>}
              </div>
              <button onClick={() => setExpanded(false)} style={{
                background: C.faint, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: '6px 14px', color: C.muted, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}>✕ Close</button>
            </div>
            {expandedContent || children}
          </div>
        </div>
      )}
      <style>{`
        @keyframes diagFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes diagSlideUp { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DATASET STATUS BAR
// ─────────────────────────────────────────────────────────────────────────────
function StatusDivider({ C }) {
  return <div style={{ width: 1, height: 30, background: C.border, margin: '0 18px' }} />
}
function StatusBar({ C, filename, health, missingPct, outlierTotal, dupCount, targetCol, balance, onRedo }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 24px', background: C.cardAlt,
      borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap', rowGap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, color: C.muted }}>▤</span>
          <div>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1, color: C.muted }}>CURRENT DATASET</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{filename}</div>
          </div>
        </div>
        <StatusDivider C={C} />
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1, color: C.muted, marginBottom: 3 }}>HEALTH SCORE</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{health}/100</span>
            <div style={{ width: 60, height: 5, borderRadius: 3, background: C.faint, overflow: 'hidden' }}>
              <div style={{ width: `${health}%`, height: '100%', background: health >= 80 ? C.success : health >= 60 ? C.warning : C.danger }} />
            </div>
          </div>
        </div>
        <StatusDivider C={C} />
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1, color: C.muted }}>MISSING VALUES</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: missingPct > 10 ? C.warning : C.text }}>{missingPct}%</div>
        </div>
        <StatusDivider C={C} />
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1, color: C.muted }}>OUTLIERS</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: outlierTotal > 0 ? C.danger : C.text }}>{outlierTotal} Detected</div>
        </div>
        <StatusDivider C={C} />
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1, color: C.muted }}>DUPLICATES</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{dupCount} Rows</div>
        </div>
        {targetCol && (
          <>
            <StatusDivider C={C} />
            <div>
              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1, color: C.muted }}>TARGET: {targetCol.toUpperCase()}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 60, height: 5, borderRadius: 3, background: C.faint, overflow: 'hidden', display: 'flex' }}>
                  {balance?.entries?.slice(0, 4).map((e, i) => (
                    <div key={e.value} style={{ width: `${e.pct}%`, height: '100%', background: PALETTE[i % PALETTE.length] }} />
                  ))}
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: balance?.level === 'Balanced' ? C.success : C.warning }}>
                  {balance?.level}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
      {/* Redo — same concept/pattern as every other page's Redo action:
          discard this step's own changes, restore the pre-step state. Red
          styling communicates revert/reset, consistent with every other
          Redo button across the app. */}
      <button onClick={onRedo} style={{
        padding: '9px 18px', borderRadius: 9, border: `1px solid ${C.danger}`,
        background: C.dangerSoft, color: C.danger, fontWeight: 700, fontSize: 13,
        cursor: 'pointer', flexShrink: 0,
      }}>
        ↺ Redo
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────
// Outlier-robust histogram binning. The old version spread a fixed 20 bins
// evenly across the raw min..max — a handful of extreme values (or even one)
// could stretch that range so far that every "normal" value landed in a
// single bin, which is exactly the "one giant bar" distortion this replaces.
// Every value is still counted (nothing is dropped or filtered out of the
// underlying data) — values beyond the robust plotting range are simply
// folded into the nearest edge bin, standard practice for a clipped
// histogram, so the x-axis stays readable while the full sample size is
// still represented.
function computeHistBins(values) {
  if (!values.length) return []
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const dataMin = sorted[0], dataMax = sorted[n - 1]
  if (dataMin === dataMax) return [{ mid: dataMin, count: n }]

  const quantile = p => {
    const idx = (n - 1) * p
    const lo = Math.floor(idx), hi = Math.ceil(idx)
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
  }
  const q1 = quantile(0.25), q3 = quantile(0.75)
  const iqr = q3 - q1

  // Robust plotting range: the tighter of the IQR fence (Q1-1.5*IQR to
  // Q3+1.5*IQR) and the 1st/99th percentiles — whichever more tightly
  // wraps the bulk of the data, without letting a long tail dominate.
  let lo = dataMin, hi = dataMax
  if (iqr > 0) {
    lo = Math.max(dataMin, q1 - 1.5 * iqr)
    hi = Math.min(dataMax, q3 + 1.5 * iqr)
  }
  lo = Math.max(lo, quantile(0.01))
  hi = Math.min(hi, quantile(0.99))
  if (hi <= lo) { lo = dataMin; hi = dataMax }   // degenerate guard (e.g. mostly-tied values)

  // Bin count via the Freedman-Diaconis rule on the robust range, falling
  // back to Sturges' rule when IQR is 0 (heavily discrete data) — clamped
  // to a sane window so very small or very large samples still render
  // something readable rather than 2 bars or 200.
  let numBins
  if (iqr > 0) {
    const binWidth = 2 * iqr * Math.pow(n, -1 / 3)
    numBins = binWidth > 0 ? Math.round((hi - lo) / binWidth) : 20
  } else {
    numBins = Math.round(Math.log2(n) + 1)
  }
  numBins = Math.max(8, Math.min(40, numBins || 20))

  const size = (hi - lo) / numBins
  const bins = Array.from({ length: numBins }, (_, i) => ({ mid: lo + (i + 0.5) * size, count: 0 }))
  values.forEach(v => {
    const clamped = Math.min(Math.max(v, lo), hi)
    const idx = Math.max(0, Math.min(Math.floor((clamped - lo) / size), numBins - 1))
    bins[idx].count++
  })
  return bins
}

function MiniHistogram({ values, C, height = 160 }) {
  const bins = useMemo(() => computeHistBins(values), [values])
  if (!bins.length) return <div style={{ fontSize: 12, color: C.muted, padding: 20 }}>No numeric data.</div>
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={bins} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
        <XAxis dataKey="mid" tick={{ fontSize: 9, fill: C.muted }} tickFormatter={v => v.toFixed(1)} />
        <YAxis tick={{ fontSize: 9, fill: C.muted }} width={28} />
        <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, fontSize: 11, borderRadius: 8 }}
          labelFormatter={v => `≈ ${Number(v).toFixed(2)}`} />
        <Bar dataKey="count" fill={C.primary} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// Gaussian KDE, used by the "Show All Relationships" pairplot's diagonal
// density curves (seaborn's default diagonal — replaces a plain histogram).
function silvermanBandwidth(values) {
  const n = values.length
  if (n < 2) return 1
  const mean = values.reduce((s, v) => s + v, 0) / n
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
  const std = Math.sqrt(variance) || 1
  return 1.06 * std * Math.pow(n, -0.2) || 1
}
function gaussianKDE(values, evalPoints, bandwidth) {
  const n = values.length || 1
  return evalPoints.map(x => {
    let sum = 0
    for (const v of values) { const u = (x - v) / bandwidth; sum += Math.exp(-0.5 * u * u) }
    return sum / (n * bandwidth * Math.sqrt(2 * Math.PI))
  })
}

// Bar chart of category counts — used both for the target's class-balance
// view and for any other categorical column selected on its own. Always
// shows count + percentage per bar, since a category imbalance is worth
// seeing whether or not the column happens to be the target.
function CategoryCountChart({ balance, C, height = 180 }) {
  if (!balance) return <div style={{ fontSize: 12, color: C.muted, padding: 20 }}>No categories to show.</div>
  const data = balance.entries.map(e => ({ ...e, labelText: `${e.count} (${e.pct}%)` }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 20, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
        <XAxis dataKey="value" tick={{ fontSize: 10, fill: C.muted }} />
        <YAxis tick={{ fontSize: 10, fill: C.muted }} width={30} />
        <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, fontSize: 11, borderRadius: 8 }}
          formatter={(v, n, props) => [`${props.payload.count} (${props.payload.pct}%)`, 'count']} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          <LabelList dataKey="labelText" position="top" fontSize={10} fontWeight={700} fill={C.text} />
          {data.map((e, i) => <Cell key={e.value} fill={PALETTE[i % PALETTE.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA PREVIEW — editable grid
// ─────────────────────────────────────────────────────────────────────────────
function DataTable({ C, columns, rows, columnsInfo, removedColumns,
  dirtyCells, onCellCommit, onAddRow, onRenameColumn, maxHeight, colWidth }) {
  // editingCell and renamingCol are local to THIS table instance on purpose:
  // the compact and expanded views render two separate DataTable instances
  // of the same data simultaneously. When cell-edit state used to be lifted
  // and shared, clicking a cell in either instance mounted an autoFocus
  // <input> in BOTH at once — whichever mounted second stole focus, firing a
  // blur (and therefore a commit-and-close) on the first, closing edit mode
  // before a single keystroke could land. Scoping both per-instance removes
  // that race entirely — renaming would hit the exact same bug otherwise.
  const [editingCell, setEditingCell] = useState(null)
  const [renamingCol, setRenamingCol] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const startRename = (col) => { setRenamingCol(col); setRenameValue(col) }
  const commitRename = () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== renamingCol) onRenameColumn(renamingCol, trimmed)
    setRenamingCol(null)
  }

  return (
    <div style={{ maxHeight, overflow: 'auto', border: 'none' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed', width: '100%', minWidth: (columns.length + 1) * colWidth }}>
        <thead>
          <tr>
            <th style={{ ...thStyleFor(colWidth * 0.6, C.card), position: 'sticky', top: 0, left: 0, zIndex: 3 }}>#</th>
            {columns.map(col => {
              const removed = removedColumns.has(col)
              const isRenaming = renamingCol === col
              return (
                <th key={col} style={{ ...thStyleFor(colWidth, C.card), position: 'sticky', top: 0, zIndex: 2 }}>
                  {isRenaming ? (
                    <input autoFocus value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenamingCol(null) }}
                      style={{
                        width: '100%', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase',
                        border: 'none', outline: 'none', background: 'transparent', color: 'inherit', padding: 0,
                        colorScheme: C === DARK ? 'dark' : 'light',
                      }} />
                  ) : (
                    <span onClick={() => startRename(col)} title={`${col} — click to rename`}
                      style={{
                        cursor: 'pointer', display: 'block',
                        textDecoration: removed ? 'line-through' : 'none', opacity: removed ? 0.4 : 1,
                        whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.15,
                      }}>{col}</span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              <td style={{ ...tdStyleBase, position: 'sticky', left: 0, zIndex: 1, background: C.card, fontWeight: 700, color: C.muted }}>{ri + 1}</td>
              {columns.map(col => {
                const key = `${ri}:${col}`
                const isEditing = editingCell === key
                const isDirty = dirtyCells.has(key)
                const removed = removedColumns.has(col)
                return (
                  <td key={col}
                    onClick={() => !isEditing && setEditingCell(key)}
                    style={{
                      ...tdStyleBase,
                      background: isDirty ? 'rgba(251,191,36,0.16)' : 'transparent',
                      opacity: removed ? 0.35 : 1, cursor: 'text',
                    }}>
                    {isEditing ? (
                      <input autoFocus defaultValue={row[col] ?? ''}
                        onBlur={e => { onCellCommit(ri, col, e.target.value); setEditingCell(null) }}
                        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingCell(null) }}
                        style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', fontSize: 12, fontFamily: 'inherit', color: 'inherit', colorScheme: C === DARK ? 'dark' : 'light' }}
                      />
                    ) : (row[col] === null || row[col] === undefined ? <span style={{ opacity: 0.35 }}>—</span> : String(row[col]))}
                  </td>
                )
              })}
            </tr>
          ))}
          <tr>
            <td colSpan={columns.length + 1} style={{ padding: 0 }}>
              <button onClick={onAddRow} style={{
                width: '100%', padding: '8px 0', background: 'transparent', border: 'none',
                borderTop: '1px dashed currentColor', opacity: 0.55, cursor: 'pointer', fontSize: 12, fontWeight: 700,
              }}>+ Add row</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
// background must be an explicit opaque color, not 'inherit' — these <th>s
// are position:sticky, and 'inherit' resolves to fully transparent here
// (no ancestor in the table/thead/tr chain sets a real background), so the
// row scrolling underneath showed through as overlapping "ghost text",
// especially visible in dark mode. opacity is also left at 1 for the same
// reason: <opacity> on the cell dims its background too, not just the text.
const thStyleFor = (w, bg) => ({
  minWidth: w, maxWidth: w, padding: '6px 4px', textAlign: 'left', fontSize: 9.5, fontWeight: 800,
  textTransform: 'uppercase', letterSpacing: 0.2, background: bg, borderBottom: '1px solid currentColor',
  borderBottomColor: 'rgba(128,128,128,0.25)',
})
const tdStyleBase = {
  padding: '5px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  borderBottom: '1px solid rgba(128,128,128,0.12)',
}

function DataPreviewCard({ C, dataset, removedColumns, onRenameColumn,
  dirtyCells, onCellCommit, onAddRow, modifiedCount }) {
  const colWidth = Math.max(42, Math.min(80, Math.floor(680 / (dataset.columns.length || 1))))
  return (
    <div className="diag-focus-fix" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: shadow2, color: C.text, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>Data Preview</span>
          {modifiedCount > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: C.warning, background: C.warningSoft, padding: '2px 8px', borderRadius: 20 }}>
              {modifiedCount} modified
            </span>
          )}
        </div>
        <span style={{ fontSize: 11.5, color: C.muted }}>{dataset.rows.length} rows × {dataset.columns.length} columns</span>
      </div>
      <ExpandableSection C={C} title="Data Preview" subtitle={`${dataset.rows.length} rows × ${dataset.columns.length} columns — click any cell to edit, click a header to rename`}
        expandedContent={
          <DataTable C={C} columns={dataset.columns} rows={dataset.rows} columnsInfo={dataset.columnsInfo}
            removedColumns={removedColumns}
            dirtyCells={dirtyCells} onCellCommit={onCellCommit} onAddRow={onAddRow}
            onRenameColumn={onRenameColumn} maxHeight="70vh" colWidth={Math.max(100, colWidth * 1.6)} />
        }>
        <DataTable C={C} columns={dataset.columns} rows={dataset.rows} columnsInfo={dataset.columnsInfo}
          removedColumns={removedColumns}
          dirtyCells={dirtyCells} onCellCommit={onCellCommit} onAddRow={onAddRow}
          onRenameColumn={onRenameColumn} maxHeight={260} colWidth={colWidth} />
      </ExpandableSection>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSE (Column Passport) SECTION
// ─────────────────────────────────────────────────────────────────────────────
function IssueBadge({ issue, C }) {
  const colors = {
    danger: C.danger, warning: C.warning, success: C.success,
  }
  const bg = { danger: C.dangerSoft, warning: C.warningSoft, success: C.successSoft }
  const color = colors[issue.severity]
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color, background: bg[issue.severity],
      padding: '3px 9px', borderRadius: 6, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      {issue.severity === 'success' ? '✓' : '⚠'} {issue.label}
    </span>
  )
}

function IssueCard({ issue, C, onAction, compact }) {
  return (
    <div style={{
      background: issue.severity === 'success' ? C.successSoft : (issue.severity === 'danger' ? C.dangerSoft : C.warningSoft),
      border: `1px solid ${issue.severity === 'success' ? C.success : issue.severity === 'danger' ? C.danger : C.warning}33`,
      borderRadius: 10, padding: compact ? '10px 12px' : '16px 18px',
    }}>
      <div style={{ fontSize: compact ? 12.5 : 14, fontWeight: 800, color: C.text, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        {issue.severity !== 'success' && '⚠'} {issue.title}
      </div>
      <p style={{ fontSize: compact ? 11.5 : 13, color: C.muted, lineHeight: 1.55, margin: 0 }}>{issue.explanation}</p>
      {issue.actions.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: compact ? 10 : 14, flexWrap: 'wrap' }}>
          {issue.actions.map(a => (
            <button key={a.type} onClick={() => onAction(a.type)}
              style={btn(C.card, C.text, { border: `1px solid ${C.border}`, fontSize: compact ? 11 : 12, padding: compact ? '5px 12px' : '7px 16px' })}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TwoColumnCorrelation({ C, colA, colB, rows, infoA, infoB }) {
  const bothNumeric = infoA.type === 'numerical' && infoB.type === 'numerical'
  const r = bothNumeric ? pearsonCorrelation(colA, colB, rows) : null
  const strength = r == null ? null : Math.abs(r) > 0.7 ? 'strong' : Math.abs(r) > 0.4 ? 'moderate' : 'weak'
  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: 15, color: C.text, marginBottom: 8 }}>{colA} ↔ {colB}</div>
      {!bothNumeric ? (
        <p style={{ fontSize: 12.5, color: C.muted }}>Correlation analysis requires two numeric columns.</p>
      ) : (
        <>
          <div style={{ fontSize: 24, fontWeight: 900, color: strength === 'strong' ? C.warning : C.text, marginBottom: 6 }}>
            r = {r.toFixed(3)}
          </div>
          <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, margin: 0 }}>
            {strength === 'strong'
              ? `A strong ${r > 0 ? 'positive' : 'negative'} correlation — these two columns may carry redundant information. Consider dropping one before training.`
              : strength === 'moderate'
              ? `A moderate ${r > 0 ? 'positive' : 'negative'} relationship — worth noting, but not strong enough to call redundant.`
              : `A weak relationship — these columns appear largely independent of each other.`}
          </p>
        </>
      )}
    </div>
  )
}

// Right-hand panel of the single-column Diagnose view: a skew gauge for
// numeric columns, or a "dominant category" readout for categorical ones —
// the categorical-vs-numeric split the reference screenshots call for.
function DistributionPanel({ C, info }) {
  if (info.type === 'numerical') {
    const skew = info.skew ?? 0
    const abs = Math.abs(skew)
    const level = abs < 0.5 ? 'Symmetric' : abs < 1 ? 'Moderate' : 'High'
    const color = abs < 0.5 ? C.success : abs < 1 ? C.primary : C.warning
    const pct = Math.min(100, (abs / 3) * 100)
    const note = abs < 0.5
      ? 'Distribution is roughly normal. No transformation strictly required for robust models.'
      : abs < 1
      ? `Distribution is moderately ${skew > 0 ? 'right' : 'left'}-skewed. Tree-based models handle this fine; linear models may benefit from a transform.`
      : `Distribution is heavily ${skew > 0 ? 'right' : 'left'}-skewed. Consider a log/power transform before using linear or distance-based models.`
    return (
      <div style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, color: C.muted, marginBottom: 10 }}>DISTRIBUTION SKEW</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: C.faint, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, color, whiteSpace: 'nowrap' }}>{skew.toFixed(2)} ({level})</span>
        </div>
        <p style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5, margin: 0 }}>{note}</p>
      </div>
    )
  }
  const dominant = (info.mostCommonPct ?? 0) > 70
  return (
    <div style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, color: C.muted, marginBottom: 10 }}>TOP CATEGORY</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{info.mostCommon ?? '—'}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: dominant ? C.warning : C.primary }}>{info.mostCommonPct ?? 0}%</span>
      </div>
      <p style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5, margin: 0 }}>
        {dominant
          ? 'This category dominates the column — worth checking for imbalance if this is used as a target.'
          : 'Categories are reasonably distributed across the column.'}
      </p>
    </div>
  )
}

function DiagnoseCard({ C, selectedColumns, columns, columnsInfo, rows, statusProps, onAction }) {
  const single = selectedColumns.length === 1 ? selectedColumns[0] : null
  const singleInfo = single ? columnsInfo[single] : null
  const singleIssue = single ? detectColumnIssue(single, singleInfo, single.toLowerCase()) : null

  const compactBody = () => {
    if (selectedColumns.length === 0) return (
      <div style={{ padding: '2px 2px 0' }}>
        <IssueCard compact C={C} issue={{
          severity: 'success', title: 'Dataset Overview', actions: [],
          explanation: `${statusProps.rowCount} rows · ${statusProps.colCount} columns · Health ${statusProps.health}/100 · ${statusProps.missingPct}% missing · ${statusProps.outlierTotal} outliers · ${statusProps.dupCount} duplicate rows. Select a column below for a detailed diagnosis.`,
        }} onAction={() => {}} />
      </div>
    )
    if (selectedColumns.length === 2) return (
      <div style={{ padding: '2px 2px 0' }}>
        <TwoColumnCorrelation C={C} colA={selectedColumns[0]} colB={selectedColumns[1]} rows={rows}
          infoA={columnsInfo[selectedColumns[0]]} infoB={columnsInfo[selectedColumns[1]]} />
      </div>
    )
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>{single}</div>
          <IssueBadge issue={singleIssue} C={C} />
        </div>
        <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 12 }}>
          Type: {singleInfo.type === 'numerical' ? 'Numeric' : singleInfo.type === 'mixed' ? 'Mixed' : 'Categorical'}
          {' | '}Distinct: {singleInfo.unique}
          {' | '}Missing: {singleInfo.missing} ({singleInfo.missingPct}%)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <IssueCard compact C={C} issue={singleIssue} onAction={onAction} />
          <DistributionPanel C={C} info={singleInfo} />
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: shadow2, padding: '14px 18px', color: C.text }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: C.muted, marginBottom: 10 }}>DIAGNOSE</div>
      {compactBody()}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURES CARD
// ─────────────────────────────────────────────────────────────────────────────
function FeaturesCard({ C, columns, columnsInfo, removedColumns, selectedColumns, onToggleSelect, targetCol, onDeleteSelected }) {
  const hasSelection = selectedColumns.length > 0
  return (
    <div className="diag-focus-fix" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: shadow2, color: C.text, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 0.5 }}>FEATURES</span>
        <button onClick={onDeleteSelected} disabled={!hasSelection}
          title={hasSelection ? `Remove ${selectedColumns.join(', ')} from analysis` : 'Select a column first'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            width: 28, height: 28, borderRadius: 8, fontSize: 13,
            background: hasSelection ? C.dangerSoft : C.faint,
            border: `1px solid ${hasSelection ? C.danger : C.border}`,
            cursor: hasSelection ? 'pointer' : 'default', opacity: hasSelection ? 1 : 0.5,
            color: hasSelection ? C.danger : C.muted, transition: 'all 0.15s',
          }}>🗑</button>
      </div>
      <div style={{ maxHeight: 195, overflowY: 'auto' }}>
        {columns.map(col => {
          const info = columnsInfo[col]
          const removed = removedColumns.has(col)
          const isTarget = col === targetCol
          const selected = selectedColumns.includes(col)
          return (
            <div key={col} onClick={() => onToggleSelect(col)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', cursor: 'pointer',
                background: selected ? C.primarySoft : 'transparent',
                borderLeft: selected ? `3px solid ${C.primary}` : '3px solid transparent',
                opacity: removed ? 0.4 : 1,
              }}>
              <input type="checkbox" checked={selected} readOnly
                style={{ accentColor: C.primary, colorScheme: C === DARK ? 'dark' : 'light' }}
                onClick={e => { e.stopPropagation(); onToggleSelect(col) }} />
              <span style={{ fontSize: 12 }}>{info.type === 'numerical' ? '🔢' : '🔤'}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {col}
              </span>
              {isTarget && <span style={{ fontSize: 9, fontWeight: 800, color: C.primary, background: C.primarySoft, padding: '1px 6px', borderRadius: 20 }}>TARGET</span>}
              {!isTarget && info.missing > 0 && <span style={{ fontSize: 10, color: C.muted, flexShrink: 0 }}>{info.missingPct}% missing</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STATISTICS CARD
// ─────────────────────────────────────────────────────────────────────────────
function StatRow({ label, value, C }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
      <span style={{ color: C.muted }}>{label}</span>
      <span style={{ fontWeight: 700, color: C.text }}>{value}</span>
    </div>
  )
}
const fmt = (v, d = 3) => (v === null || v === undefined || isNaN(v)) ? '—' : (+v.toFixed(d)).toLocaleString()

function StatisticsCard({ C, selectedColumns, columns, columnsInfo, rows, rowCount, colCount }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: shadow2, color: C.text, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 0.5 }}>STATISTICS</span>
      </div>
      <div style={{ padding: '10px 16px', maxHeight: 195, overflowY: 'auto' }}>
        {selectedColumns.length === 0 && (
          <>
            <StatRow C={C} label="Total rows" value={rowCount} />
            <StatRow C={C} label="Total columns" value={colCount} />
            <StatRow C={C} label="Numeric columns" value={columns.filter(c => columnsInfo[c].type === 'numerical').length} />
            <StatRow C={C} label="Categorical columns" value={columns.filter(c => columnsInfo[c].type !== 'numerical').length} />
          </>
        )}
        {selectedColumns.length === 1 && (() => {
          const info = columnsInfo[selectedColumns[0]]
          if (info.type === 'numerical') return (
            <>
              <StatRow C={C} label="Minimum" value={fmt(info.min)} />
              <StatRow C={C} label="Maximum" value={fmt(info.max)} />
              <StatRow C={C} label="Mean" value={fmt(info.mean)} />
              <StatRow C={C} label="StdDev" value={fmt(info.std)} />
              <StatRow C={C} label="Median" value={fmt(info.median)} />
              <StatRow C={C} label="25th percentile" value={fmt(info.p25)} />
              <StatRow C={C} label="75th percentile" value={fmt(info.p75)} />
            </>
          )
          return (
            <>
              <StatRow C={C} label="Unique values" value={info.unique} />
              <StatRow C={C} label="Most common" value={info.mostCommon ?? '—'} />
              <StatRow C={C} label="Most common %" value={`${info.mostCommonPct}%`} />
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, color: C.muted, margin: '12px 0 4px' }}>VALUE COUNTS</div>
              {info.valueCounts?.map(v => <StatRow key={v.value} C={C} label={String(v.value)} value={`${v.count} (${v.pct}%)`} />)}
            </>
          )
        })()}
        {selectedColumns.length === 2 && (() => {
          const [a, b] = selectedColumns
          const infoA = columnsInfo[a], infoB = columnsInfo[b]
          const cmpRow = (label, va, vb) => (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '6px 0', borderBottom: `1px solid ${C.border}`, fontSize: 11.5 }}>
              <span style={{ color: C.muted }}>{label}</span>
              <span style={{ fontWeight: 700, color: C.text, textAlign: 'right' }}>{va}</span>
              <span style={{ fontWeight: 700, color: C.text, textAlign: 'right' }}>{vb}</span>
            </div>
          )
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '2px 0 8px', fontSize: 10.5, fontWeight: 800, color: C.muted }}>
                <span></span><span style={{ textAlign: 'right' }}>{a}</span><span style={{ textAlign: 'right' }}>{b}</span>
              </div>
              {infoA.type === 'numerical' && infoB.type === 'numerical' ? (
                <>
                  {cmpRow('Mean', fmt(infoA.mean), fmt(infoB.mean))}
                  {cmpRow('StdDev', fmt(infoA.std), fmt(infoB.std))}
                  {cmpRow('Minimum', fmt(infoA.min), fmt(infoB.min))}
                  {cmpRow('Maximum', fmt(infoA.max), fmt(infoB.max))}
                  {cmpRow('Median', fmt(infoA.median), fmt(infoB.median))}
                </>
              ) : (
                <>
                  {cmpRow('Type', infoA.type, infoB.type)}
                  {cmpRow('Unique values', infoA.unique, infoB.unique)}
                  {cmpRow('Missing %', `${infoA.missingPct}%`, `${infoB.missingPct}%`)}
                </>
              )}
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 10 }}>
                See the Diagnose card for the correlation between these two columns.
              </div>
            </>
          )
        })()}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// VISUALIZE SECTION
// ─────────────────────────────────────────────────────────────────────────────
function VisualizeSection({ C, selectedColumns, columns, columnsInfo, rows, targetCol, balance, onShowAll }) {
  const numericColumns = columns.filter(c => columnsInfo[c].type === 'numerical')

  const renderBody = () => {
    if (selectedColumns.length === 2) {
      const [a, b] = selectedColumns
      const infoA = columnsInfo[a], infoB = columnsInfo[b]
      if (infoA.type !== 'numerical' || infoB.type !== 'numerical') {
        return <div style={{ fontSize: 12.5, color: C.muted, padding: 24 }}>Scatter plots need two numeric columns.</div>
      }
      const pts = rows.map((r, i) => ({ x: r[a], y: r[b], i })).filter(p => typeof p.x === 'number' && typeof p.y === 'number')
      const byClass = {}
      pts.forEach(p => {
        const cls = targetCol ? String(rows[p.i][targetCol]) : 'all'
        if (!byClass[cls]) byClass[cls] = []
        byClass[cls].push(p)
      })
      return (
        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="x" type="number" name={a} tick={{ fontSize: 10, fill: C.muted }}
              label={{ value: a, position: 'insideBottomRight', offset: -4, fontSize: 10, fill: C.muted }} />
            <YAxis dataKey="y" type="number" name={b} tick={{ fontSize: 10, fill: C.muted }}
              label={{ value: b, angle: -90, position: 'insideLeft', fontSize: 10, fill: C.muted }} />
            <ZAxis range={[16, 16]} />
            <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, fontSize: 11, borderRadius: 8 }} />
            {Object.entries(byClass).map(([cls, pts], i) => (
              <Scatter key={cls} name={cls} data={pts} fill={targetCol ? PALETTE[i % PALETTE.length] : C.primary} opacity={0.75} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      )
    }
    if (selectedColumns.length === 1) {
      const col = selectedColumns[0], info = columnsInfo[col]
      if (info.type !== 'numerical') {
        if (info.unique > 15) {
          return (
            <div style={{ fontSize: 12.5, color: C.muted, padding: 24 }}>
              "{col}" has {info.unique} distinct categories — too many to chart as readable bars. It behaves more like an identifier than a category (see the Diagnose card).
            </div>
          )
        }
        const colBalance = classBalance(col, rows)
        return <CategoryCountChart balance={colBalance} C={C} height={280} />
      }
      const values = rows.map(r => r[col]).filter(v => typeof v === 'number')
      return <MiniHistogram values={values} C={C} height={280} />
    }
    // 0 selected: grid of mini histograms + class balance
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14, marginBottom: balance ? 20 : 0 }}>
          {numericColumns.slice(0, 12).map(col => (
            <div key={col} style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 4 }}>{col}</div>
              <MiniHistogram values={rows.map(r => r[col]).filter(v => typeof v === 'number')} C={C} height={90} />
            </div>
          ))}
        </div>
        {balance && (
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text, marginBottom: 6 }}>Class balance — {targetCol}</div>
            <CategoryCountChart balance={balance} C={C} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: shadow2, color: C.text, padding: '14px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 0.5 }}>VISUALIZE</span>
        <button onClick={onShowAll} style={btn(C.faint, C.text, { fontSize: 11, border: `1px solid ${C.border}` })}>
          Show All Relationships ⤢
        </button>
      </div>
      <ExpandableSection C={C} title="Visualize" expandedContent={<div style={{ minHeight: 400 }}>{renderBody()}</div>}>
        {renderBody()}
      </ExpandableSection>
    </div>
  )
}

// Seaborn-style pairplot: full N×N grid, KDE density curves on the diagonal,
// scatter off the diagonal, axis ticks only on the outer edge, one shared
// legend — matching the reference image rather than a flat list of pairs.
// Deliberately rendered on white subplot backgrounds regardless of the
// page's dark/light toggle, since that's the classic seaborn look being
// asked for here.
const fmtTick = (v) => Math.abs(v) >= 100 ? Math.round(v) : Math.abs(v) >= 10 ? +v.toFixed(1) : +v.toFixed(2)

function PairplotOverlay({ C, columns, columnsInfo, rows, targetCol, balance, onClose }) {
  const numericColumns = columns.filter(c => columnsInfo[c].type === 'numerical')
  const n = numericColumns.length
  const [hovered, setHovered] = useState(null) // [i, j] of the cell currently under the pointer

  // Fit the grid to whatever width is actually available rather than always
  // using one fixed cell size: derive cellSize from the measured container
  // width so the total grid width always matches the viewport (never a
  // horizontal scrollbar). If that forces cells below a readable minimum,
  // clamp to the minimum instead and let height overflow into a vertical
  // scroll — width is the hard constraint, height is the flexible one.
  const containerRef = useRef(null)
  const [availWidth, setAvailWidth] = useState(1100)
  useLayoutEffect(() => {
    const measure = () => { if (containerRef.current) setAvailWidth(containerRef.current.clientWidth) }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Discrete target (balance exists) -> one group per real class, same as
  // everywhere else on the page. Continuous/regression target (balance is
  // null, per the class-balance fix) -> still color by it, but bin into a
  // handful of quantile ranges rather than one group per exact value —
  // grouping by exact value would mean hundreds of legend entries and, worse,
  // hundreds of overlapping density curves on the diagonal. No target at all
  // -> everything is one color.
  const classGroups = useMemo(() => {
    if (!targetCol) return [['All', rows.map((_, i) => i)]]
    if (balance) {
      const groups = {}
      rows.forEach((r, i) => {
        const v = r[targetCol]
        if (v === null || v === undefined) return
        const key = String(v)
        ;(groups[key] ||= []).push(i)
      })
      return balance.entries.map(e => [String(e.value), groups[String(e.value)] || []])
    }
    const withVal = rows.map((r, i) => [r[targetCol], i]).filter(([v]) => typeof v === 'number')
    if (!withVal.length) return [['All', rows.map((_, i) => i)]]
    const sorted = [...withVal].sort((a, b) => a[0] - b[0])
    const BIN_COUNT = 6
    const binSize = Math.ceil(sorted.length / BIN_COUNT)
    const bins = []
    for (let b = 0; b < BIN_COUNT; b++) {
      const slice = sorted.slice(b * binSize, (b + 1) * binSize)
      if (!slice.length) continue
      const label = `${fmtTick(slice[0][0])}–${fmtTick(slice[slice.length - 1][0])}`
      bins.push([label, slice.map(([, i]) => i)])
    }
    return bins
  }, [targetCol, balance, rows])

  const colorForClass = (key) => {
    const idx = classGroups.findIndex(([k]) => k === key)
    return idx >= 0 ? PALETTE[idx % PALETTE.length] : C.muted
  }

  const globalRange = useMemo(() => {
    const r = {}
    numericColumns.forEach(col => {
      const vals = rows.map(row => row[col]).filter(v => typeof v === 'number')
      r[col] = vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1]
    })
    return r
  }, [numericColumns, rows])

  const gap = 14, leftMargin = 84, bottomMargin = 60, topMargin = 12
  const legendWidth = targetCol ? 170 : 0
  const MIN_CELL = 56, MAX_CELL = 210

  // Width always fits exactly (this is the hard constraint — never a
  // horizontal scrollbar). If that math would push cells below MIN_CELL
  // (too many columns to stay readable), clamp to MIN_CELL instead and let
  // the resulting taller grid scroll vertically.
  const fitCellSize = n > 0 ? Math.floor((availWidth - leftMargin - 24 - legendWidth - (n - 1) * gap) / n) : MAX_CELL
  const cellSize = Math.max(MIN_CELL, Math.min(MAX_CELL, fitCellSize))
  const gridSpan = n * cellSize + (n - 1) * gap
  const svgW = fitCellSize >= MIN_CELL ? availWidth : leftMargin + gridSpan + 24 + legendWidth
  const svgH = topMargin + gridSpan + bottomMargin

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1200, background: C.scrim, backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '96vw', height: '94vh', background: C.overlayCard, border: `1px solid ${C.border}`,
        borderRadius: 20, boxShadow: '0 24px 80px rgba(0,0,0,0.6)', padding: 28,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: C.text }}>Show All Relationships</div>
            <div style={{ fontSize: 12, color: C.muted }}>{n} numeric columns{targetCol ? ` · colored by ${targetCol}` : ''} · hover any cell or point for detail</div>
          </div>
          <button onClick={onClose} style={btn(C.faint, C.text, { border: `1px solid ${C.border}` })}>✕ Close</button>
        </div>
        {columns.length > 20 && (
          <div style={{ background: C.warningSoft, color: C.warning, borderRadius: 8, padding: '8px 14px', fontSize: 12, marginBottom: 14, flexShrink: 0 }}>
            ⚠ This dataset has {columns.length} columns — rendering every pairwise relationship may be slow.
          </div>
        )}
        <div ref={containerRef} style={{ flex: 1, overflowY: 'scroll', overflowX: 'hidden', display: 'flex', justifyContent: 'center' }}>
          <svg width={svgW} height={svgH} style={{ display: 'block', flexShrink: 0, maxWidth: '100%' }}>
            {Array.from({ length: n }).map((_, i) => Array.from({ length: n }).map((_, j) => {
              const cellX = leftMargin + j * (cellSize + gap)
              const cellY = topMargin + i * (cellSize + gap)
              const xCol = numericColumns[j], yCol = numericColumns[i]
              const [xMin, xMax] = globalRange[xCol]
              const [yMin, yMax] = globalRange[yCol]
              const toX = v => ((v - xMin) / ((xMax - xMin) || 1)) * cellSize
              const toY = v => cellSize - ((v - yMin) / ((yMax - yMin) || 1)) * cellSize
              const isHovered = hovered && hovered[0] === i && hovered[1] === j

              return (
                <g key={`${i}-${j}`} transform={`translate(${cellX},${cellY})`}
                  onMouseEnter={() => setHovered([i, j])} onMouseLeave={() => setHovered(null)}>
                  <rect x={0} y={0} width={cellSize} height={cellSize}
                    fill={C.bg} stroke={isHovered ? C.primary : C.border} strokeWidth={isHovered ? 2 : 1} />
                  {i === j ? (() => {
                    const evalPoints = Array.from({ length: 40 }, (_, k) => xMin + (k / 39) * ((xMax - xMin) || 1))
                    const curves = classGroups.map(([key, idxs]) => {
                      const vals = idxs.map(idx => rows[idx][xCol]).filter(v => typeof v === 'number')
                      if (vals.length < 2) return null
                      const bw = silvermanBandwidth(vals) || 1
                      return { key, density: gaussianKDE(vals, evalPoints, bw) }
                    }).filter(Boolean)
                    const maxD = Math.max(1e-9, ...curves.flatMap(c => c.density))
                    return curves.map(({ key, density }) => {
                      const path = `M ${evalPoints.map((v, k) => `${toX(v)},${cellSize - (density[k] / maxD) * cellSize * 0.92}`).join(' L ')} L ${cellSize},${cellSize} L 0,${cellSize} Z`
                      return <path key={key} d={path} fill={colorForClass(key)} fillOpacity={0.32} stroke={colorForClass(key)} strokeWidth={1.6} />
                    })
                  })() : (
                    <g>
                      {classGroups.map(([key, idxs]) => idxs.map(idx => {
                        const x = rows[idx][xCol], y = rows[idx][yCol]
                        if (typeof x !== 'number' || typeof y !== 'number') return null
                        return (
                          <circle key={idx} cx={toX(x)} cy={toY(y)} r={2.6} fill={colorForClass(key)} opacity={0.78}>
                            <title>{`${xCol}: ${fmtTick(x)}\n${yCol}: ${fmtTick(y)}${targetCol ? `\n${targetCol}: ${key}` : ''}`}</title>
                          </circle>
                        )
                      }))}
                    </g>
                  )}
                  {j === 0 && (
                    <>
                      <text x={-8} y={9} textAnchor="end" fontSize={10} fill={C.muted}>{fmtTick(yMax)}</text>
                      <text x={-8} y={cellSize - 2} textAnchor="end" fontSize={10} fill={C.muted}>{fmtTick(yMin)}</text>
                    </>
                  )}
                  {i === n - 1 && (
                    <>
                      <text x={3} y={cellSize + 16} textAnchor="start" fontSize={10} fill={C.muted}>{fmtTick(xMin)}</text>
                      <text x={cellSize - 3} y={cellSize + 16} textAnchor="end" fontSize={10} fill={C.muted}>{fmtTick(xMax)}</text>
                    </>
                  )}
                </g>
              )
            }))}

            {numericColumns.map((col, i) => (
              <text key={`row-${col}`}
                x={leftMargin - 58} y={topMargin + i * (cellSize + gap) + cellSize / 2}
                textAnchor="middle" fontSize={13} fontWeight={800}
                fill={hovered && hovered[0] === i ? C.primary : C.text}
                transform={`rotate(-90, ${leftMargin - 58}, ${topMargin + i * (cellSize + gap) + cellSize / 2})`}>
                {col}
              </text>
            ))}
            {numericColumns.map((col, j) => (
              <text key={`col-${col}`}
                x={leftMargin + j * (cellSize + gap) + cellSize / 2} y={topMargin + gridSpan + 40}
                textAnchor="middle" fontSize={13} fontWeight={800}
                fill={hovered && hovered[1] === j ? C.primary : C.text}>
                {col}
              </text>
            ))}

            {targetCol && (
              <g transform={`translate(${leftMargin + gridSpan + 32}, ${topMargin + 14})`}>
                <text x={0} y={0} fontSize={13} fontWeight={800} fill={C.text}>{targetCol}</text>
                {classGroups.map(([key], idx) => (
                  <g key={key} transform={`translate(0, ${26 + idx * 26})`}>
                    <circle cx={6} cy={-4} r={6} fill={colorForClass(key)} />
                    <text x={18} y={0} fontSize={12.5} fill={C.text}>{key}</text>
                  </g>
                ))}
              </g>
            )}
          </svg>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LOADER — minimal fallback plumbing when no dataset was handed down via
// projectData (mirrors the pattern already used by App.jsx's original
// LoadDatasetForm before real page-to-page data passing exists).
// ─────────────────────────────────────────────────────────────────────────────
function InlineLoader({ C, onFile, busy }) {
  const inputRef = useRef(null)
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.text }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>▤</div>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>{busy ? 'Reading dataset…' : 'No dataset loaded'}</div>
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 16 }}>Load a CSV to diagnose it.</div>
        <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }}
          onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
        <button onClick={() => inputRef.current?.click()} style={btn(C.primary, C === DARK ? '#04201c' : 'white', { padding: '10px 22px' })}>
          Browse CSV File
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// REDO CONFIRMATION MODAL — same scrim/overlayCard visual pattern already
// established on every other page (Sampling/Encoding/FeatureEngineering/
// FeatureSelection all use this exact shape for their own Redo confirms).
// ─────────────────────────────────────────────────────────────────────────────
function RedoConfirmModal({ C, onCancel, onConfirm, working }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: C.scrim, backdropFilter: 'blur(4px)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.overlayCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: 30,
        maxWidth: 420, width: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8, color: C.text }}>Redo Diagnose?</div>
        <p style={{ fontSize: 13, color: C.muted, marginBottom: 20, lineHeight: 1.6 }}>
          This discards every change made during this Diagnose step — cell edits, added rows, column
          removals/renames — and restores the dataset to exactly the state it had when you first entered
          this page. Versions created before Diagnose are not affected.
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
// MAIN DIAGNOSE PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function DiagnosePage({ projectData, onNext, onUpdateData,
  getInputPath, getDisplayPath, registerVersion, isStepDone, getVersion, resetStep, versions,
  active, onNavigate, furthestOrder }) {
  const { dark, C } = useTheme()

  const [filename, setFilename] = useState(projectData?.datasetFilename || projectData?.filename || null)
  const [columns, setColumns] = useState(projectData?.columns || null)
  const [rows, setRows] = useState(projectData?.rows || null)
  const [busy, setBusy] = useState(false)

  // Defensive re-sync: `columns`/`rows` are normally seeded once, at first
  // mount, from projectData (App.jsx passes the client-parsed Upload data
  // straight through). If this component's very first render ever happens
  // before that data has actually arrived — a mount-order edge case, not the
  // common path — useState's "only used on first render" behavior would
  // otherwise leave it locked on `null` forever, showing "no dataset loaded"
  // even after projectData catches up on a later render. This closes that
  // gap without affecting the normal case (once real data has been loaded,
  // either from here or from a manual Browse, it's never overwritten).
  useEffect(() => {
    if (columns || rows) return
    if (projectData?.columns?.length && projectData?.rows?.length) {
      setColumns(projectData.columns)
      setRows(projectData.rows)
      setOriginalRows(projectData.rows.map(r => ({ ...r })))
      setFilename(projectData.datasetFilename || projectData.filename || null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectData?.columns, projectData?.rows])

  const [removedColumns, setRemovedColumns] = useState(new Set())
  const [selectedColumns, setSelectedColumns] = useState([])
  const [dirtyCells, setDirtyCells] = useState(new Set())
  const [originalRows, setOriginalRows] = useState(null)
  const [showPairplot, setShowPairplot] = useState(false)

  // ── Redo — a true, never-mutated snapshot of this dataset AS FIRST LOADED
  // into Diagnose, captured once and reused by the Redo button below. This
  // is deliberately a SEPARATE thing from `originalRows` above: `originalRows`
  // is a dirty-cell-comparison baseline that renameColumn() intentionally
  // keeps in sync with column renames (so `commitCell`'s "did this cell
  // actually change" check stays correct) — it does NOT stay a pristine copy
  // of the very first state. Captured lazily during render (not an effect)
  // so it's ready the instant columns/rows first arrive, whichever of the
  // two paths (projectData sync effect, or a manual loadFile()) got there
  // first; loadFile() explicitly clears it first so re-Browsing a new file
  // captures a fresh pristine snapshot for THAT file, not the previous one.
  const pristineRef = useRef(null)
  if (pristineRef.current === null && columns && rows) {
    pristineRef.current = { columns: [...columns], rows: rows.map(r => ({ ...r })), filename }
  }
  const [redoModal, setRedoModal] = useState(false)
  const [redoing, setRedoing] = useState(false)

  // Set true the first time any of the 5 mutating actions below fires (cell
  // edit, add row, delete column, rename column, or an issue-card fix).
  // Gates the debounced auto-save effect further down — Diagnose shouldn't
  // register a "Diagnose Edits" version just because the page was opened,
  // only once the data has genuinely diverged from the original upload.
  const [hasEdited, setHasEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const saveTimerRef = useRef(null)

  // The real, on-disk upstream file (the Django upload) — never Diagnose's
  // own output. Used both as "Original Dataset" in the versions bar and as
  // the base name every debounced save writes against (via the backend's
  // suffix-stripping save_version, so repeated saves overwrite the SAME
  // "_diagnose_edited.csv", never chain a new file per edit).
  const originalFilePath = useMemo(() =>
    (getInputPath ? getInputPath('diagnose') : null) || projectData?.filePath || null,
  [getInputPath, projectData])

  // Debounced auto-save: once the user has made a real edit, wait 800ms of
  // quiet (mirrors Cleaning.jsx's own debounce-save convention for step
  // settings) then persist the CURRENT edited dataset — physically dropping
  // any column removed via the Features panel's trash icon, keeping cell
  // edits/added rows/renames — as a real CSV via POST /diagnose/save, then
  // register it as the 'diagnose' version. registerVersion's own semantics
  // (cascade-delete any existing same-step version before registering) mean
  // every one of these calls collapses to exactly ONE 'diagnose' version,
  // continuously updated — never accumulating a new one per edit. If Django/
  // FastAPI aren't reachable, editing still works locally; only the
  // persisted version doesn't appear — same resilience principle used
  // throughout this project.
  useEffect(() => {
    if (!hasEdited || !originalFilePath || !columns || !rows) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true)
      try {
        const keptColumns = columns.filter(c => !removedColumns.has(c))
        const res = await callDiagnose('save', { file_path: originalFilePath, columns: keptColumns, rows })
        if (registerVersion) {
          await registerVersion('diagnose', res.new_file_path, 'Diagnose Edits', res.row_count,
            { modified_cells: dirtyCells.size, removed_columns: [...removedColumns] })
        }
        if (onUpdateData) onUpdateData({ cleanedFilePath: res.new_file_path })
      } catch { /* save/version round-trip failed — local editing is unaffected */ }
      finally { setSaving(false) }
    }, 800)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEdited, rows, columns, removedColumns, originalFilePath])

  // App.jsx swaps Upload -> Diagnose in place (no real page navigation), so
  // the browser keeps whatever scroll position Upload was left at instead of
  // resetting like a normal page load would. Force it back to the top.
  useEffect(() => { window.scrollTo(0, 0) }, [])

  const loadFile = async (file) => {
    setBusy(true)
    try {
      const text = await file.text()
      const parsed = parseCSV(text)
      pristineRef.current = null   // re-Browsing a new file needs its own fresh pristine snapshot
      setColumns(parsed.columns)
      setRows(parsed.rows)
      setOriginalRows(parsed.rows.map(r => ({ ...r })))
      setFilename(file.name)
      setRemovedColumns(new Set()); setSelectedColumns([]); setDirtyCells(new Set())
      setHasEdited(false)
    } finally { setBusy(false) }
  }

  // Discards every edit made during this Diagnose visit and restores the
  // page to exactly the state it was in when the dataset first arrived —
  // same concept as every other page's Redo (Encoding/Sampling/Feature
  // Engineering/Feature Selection): really delete the registered 'diagnose'
  // version server-side (resetStep, real Django cascade-delete), not just
  // hide it client-side. Never touches versions from BEFORE this step.
  const handleRedo = async () => {
    setRedoing(true)
    try {
      if (resetStep) await resetStep('diagnose')
      const pristine = pristineRef.current
      if (pristine) {
        setColumns([...pristine.columns])
        setRows(pristine.rows.map(r => ({ ...r })))
        setOriginalRows(pristine.rows.map(r => ({ ...r })))
        setFilename(pristine.filename)
      }
      setRemovedColumns(new Set()); setSelectedColumns([]); setDirtyCells(new Set())
      setHasEdited(false)
      setRedoModal(false)
    } finally { setRedoing(false) }
  }

  const columnsInfo = useMemo(() => {
    if (!columns || !rows) return {}
    const info = {}
    columns.forEach(col => { info[col] = computeColumnStats(col, rows) })
    return info
  }, [columns, rows])

  const activeColumns = useMemo(() => (columns || []).filter(c => !removedColumns.has(c)), [columns, removedColumns])
  // If the Upload page already ran its own setup drawer, trust its explicit
  // answer (a real user choice) over this page's own name-hint guess — but
  // only while that column still exists and hasn't been removed here.
  const targetCol = useMemo(() => {
    if (!columns) return null
    if (projectData?.isLabeled === false) return null
    if (projectData?.isLabeled === true && projectData?.targetColumn && activeColumns.includes(projectData.targetColumn)) {
      return projectData.targetColumn
    }
    return suggestTargetColumn(activeColumns, columnsInfo)
  }, [columns, activeColumns, columnsInfo, projectData])
  // A "class balance" reading only means something for a discrete target. A
  // continuous regression target (e.g. MEDV) has as many "classes" as rows,
  // which used to render as a wall of hundreds of one-pixel bars — visually
  // just a stray line — instead of a chart. Skip it outright for those.
  const targetLooksDiscrete = targetCol && columnsInfo[targetCol] &&
    (columnsInfo[targetCol].type !== 'numerical' || columnsInfo[targetCol].unique <= 15)
  const balance = useMemo(() => targetLooksDiscrete && rows ? classBalance(targetCol, rows) : null, [targetLooksDiscrete, targetCol, rows])

  const dupCount = useMemo(() => {
    if (!rows) return 0
    const seen = new Set(); let dup = 0
    rows.forEach(r => {
      const key = JSON.stringify(activeColumns.map(c => r[c]))
      if (seen.has(key)) dup++; else seen.add(key)
    })
    return dup
  }, [rows, activeColumns])

  const missingPct = useMemo(() => {
    if (!rows || !activeColumns.length) return 0
    const totalCells = rows.length * activeColumns.length
    const missing = activeColumns.reduce((s, c) => s + (columnsInfo[c]?.missing || 0), 0)
    return totalCells ? +(missing / totalCells * 100).toFixed(1) : 0
  }, [rows, activeColumns, columnsInfo])

  const outlierTotal = useMemo(() => activeColumns.reduce((s, c) => s + (columnsInfo[c]?.outlierCount || 0), 0), [activeColumns, columnsInfo])

  const health = useMemo(() => {
    if (!rows || !rows.length) return 100
    const completeness = 100 - missingPct * 3
    const dupScore = 100 - (dupCount / rows.length) * 100 * 3
    const outlierScore = 100 - Math.min(100, (outlierTotal / (rows.length * (activeColumns.length || 1))) * 1000)
    const balanceScore = balance ? (balance.level === 'Heavily Imbalanced' ? 55 : balance.level === 'Slightly Imbalanced' ? 80 : 100) : 100
    return Math.round(Math.max(0, Math.min(100, completeness * 0.4 + dupScore * 0.2 + outlierScore * 0.2 + balanceScore * 0.2)))
  }, [rows, missingPct, dupCount, outlierTotal, activeColumns, balance])

  const toggleSelect = (col) => setSelectedColumns(prev => {
    if (prev.includes(col)) return prev.filter(c => c !== col)
    if (prev.length >= 2) return [prev[1], col]
    return [...prev, col]
  })

  const commitCell = (rowIndex, col, value) => {
    setHasEdited(true)
    setRows(prev => {
      const next = [...prev]
      const wasNumeric = columnsInfo[col]?.type === 'numerical'
      next[rowIndex] = { ...next[rowIndex], [col]: coerceValue(value, wasNumeric) }
      return next
    })
    const key = `${rowIndex}:${col}`
    const original = originalRows?.[rowIndex]?.[col]
    const wasNumeric = columnsInfo[col]?.type === 'numerical'
    const newVal = coerceValue(value, wasNumeric)
    setDirtyCells(prev => {
      const next = new Set(prev)
      if (String(original ?? '') === String(newVal ?? '')) next.delete(key); else next.add(key)
      return next
    })
  }

  const addRow = () => {
    setHasEdited(true)
    setRows(prev => [...prev, Object.fromEntries(columns.map(c => [c, null]))])
    setOriginalRows(prev => prev ? [...prev, Object.fromEntries(columns.map(c => [c, null]))] : prev)
  }

  const toggleRemoveColumn = (col) => setRemovedColumns(prev => {
    const next = new Set(prev); next.has(col) ? next.delete(col) : next.add(col); return next
  })

  // Bulk-remove whatever is currently checked in the Features list (the same
  // selection used to drive Diagnose/Statistics/Visualize — reusing it here
  // means "select columns" and "select for inspection" are the same action,
  // not two competing selection states).
  const deleteSelectedColumns = () => {
    if (!selectedColumns.length) return
    const label = selectedColumns.length === 1
      ? `column "${selectedColumns[0]}"`
      : `columns ${selectedColumns.join(', ')}`
    const ok = window.confirm(`Remove ${label} from analysis? This can be undone by re-adding it manually if you change your mind, but it won't reappear on its own.`)
    if (!ok) return
    setHasEdited(true)
    setRemovedColumns(prev => new Set([...prev, ...selectedColumns]))
    setSelectedColumns([])
  }

  const renameColumn = (oldName, newName) => {
    if (columns.includes(newName)) return
    setHasEdited(true)
    setColumns(prev => prev.map(c => c === oldName ? newName : c))
    setRows(prev => prev.map(r => {
      const { [oldName]: val, ...rest } = r
      return { ...rest, [newName]: val }
    }))
    setOriginalRows(prev => prev?.map(r => {
      const { [oldName]: val, ...rest } = r
      return { ...rest, [newName]: val }
    }) ?? prev)
    setRemovedColumns(prev => { if (!prev.has(oldName)) return prev; const n = new Set(prev); n.delete(oldName); n.add(newName); return n })
    setSelectedColumns(prev => prev.map(c => c === oldName ? newName : c))
    setDirtyCells(prev => new Set([...prev].map(key => {
      const [ri, col] = key.split(':')
      return col === oldName ? `${ri}:${newName}` : key
    })))
  }

  const applyColumnAction = (type, colOverride) => {
    const col = colOverride || selectedColumns[0]
    if (!col) return
    setHasEdited(true)
    if (type === 'remove') { toggleRemoveColumn(col); return }
    setRows(prev => prev.map((r, ri) => {
      const v = r[col]
      let newVal = v
      if (type === 'zero-to-nan' && v === 0) newVal = null
      if (type === 'negative-to-nan' && typeof v === 'number' && v < 0) newVal = null
      if (type === 'impute-mean' && (v === null || v === undefined)) newVal = +columnsInfo[col].mean?.toFixed(2)
      if (type === 'impute-mode' && (v === null || v === undefined)) newVal = columnsInfo[col].mostCommon
      if (newVal !== v) setDirtyCells(prevD => new Set(prevD).add(`${ri}:${col}`))
      return newVal !== v ? { ...r, [col]: newVal } : r
    }))
  }

  if (!rows || !columns) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, fontFamily: 'system-ui, sans-serif' }}>
        <TopNav active={active || 'diagnose'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
        <InlineLoader C={C} onFile={loadFile} busy={busy} />
      </div>
    )
  }

  const modifiedCount = dirtyCells.size

  // The browser's default focus ring on checkboxes/inputs renders as a
  // light/white-ish ring regardless of page theme, which reads as a stray
  // artifact on the dark theme's cards. Replace it with something theme-
  // aware: the accent color in dark mode, plain white in light mode (where
  // it just blends into the white card instead of standing out).
  const focusRingColor = C === DARK ? C.primary : '#ffffff'

  // Native text selection (::selection) is unstyled by default, so browsers
  // paint it with their own light OS/theme default — that's what shows as a
  // stray light box hugging selected text in Data Preview and Features when
  // the page is in dark mode (there's no custom "selected cell" class doing
  // this; it's the browser's own selection highlight). Tint it with the
  // theme's own accent color instead, background only — text color is left
  // untouched on purpose.
  const selectionBg = `${C.primary}4D`

  return (
    <div className="diagnose-page" style={{ minHeight: '100vh', background: C.bg, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' }}>
      <style>{`
        .diag-focus-fix input:focus-visible { outline: 2px solid ${focusRingColor}; outline-offset: 2px; }
        .diagnose-page ::selection { background-color: ${selectionBg}; }
      `}</style>
      <TopNav active={active || 'diagnose'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
      <StatusBar C={C} filename={filename || 'dataset.csv'} health={health} missingPct={missingPct}
        outlierTotal={outlierTotal} dupCount={dupCount} targetCol={targetCol} balance={balance}
        onRedo={() => setRedoModal(true)} />
      {redoModal && (
        <RedoConfirmModal C={C} onCancel={() => setRedoModal(false)} onConfirm={handleRedo} working={redoing} />
      )}
      <SharedVersionsBar versions={versions} />
      {saving && (
        <div style={{ padding: '4px 24px', fontSize: 11, color: C.muted, fontStyle: 'italic', background: C.cardAlt }}>
          saving edits…
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, padding: 24, alignItems: 'flex-start' }}>
        <div style={{ width: '40%', minWidth: 340, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <DataPreviewCard C={C} dataset={{ columns, rows, columnsInfo }} removedColumns={removedColumns}
            onRenameColumn={renameColumn}
            dirtyCells={dirtyCells} onCellCommit={commitCell} onAddRow={addRow} modifiedCount={modifiedCount} />
          <DiagnoseCard C={C} selectedColumns={selectedColumns} columns={activeColumns}
            columnsInfo={columnsInfo} rows={rows} onAction={applyColumnAction}
            statusProps={{ rowCount: rows.length, colCount: activeColumns.length, health, missingPct, outlierTotal, dupCount }} />
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20, alignItems: 'stretch' }}>
            <FeaturesCard C={C} columns={columns} columnsInfo={columnsInfo} removedColumns={removedColumns}
              selectedColumns={selectedColumns} onToggleSelect={toggleSelect} targetCol={targetCol}
              onDeleteSelected={deleteSelectedColumns} />
            <StatisticsCard C={C} selectedColumns={selectedColumns} columns={activeColumns} columnsInfo={columnsInfo}
              rows={rows} rowCount={rows.length} colCount={activeColumns.length} />
          </div>

          <VisualizeSection C={C} selectedColumns={selectedColumns} columns={activeColumns} columnsInfo={columnsInfo}
            rows={rows} targetCol={targetCol} balance={balance} onShowAll={() => setShowPairplot(true)} />
        </div>
      </div>

      {showPairplot && (
        <PairplotOverlay C={C} columns={activeColumns} columnsInfo={columnsInfo} rows={rows}
          targetCol={targetCol} balance={balance} onClose={() => setShowPairplot(false)} />
      )}
    </div>
  )
}
