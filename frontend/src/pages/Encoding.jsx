/**
 * PRISM — Encoding & Scaling Page
 *
 * Rewritten per the 2026-08-21 edit request. Layout:
 *   TopNav (reused from Diagnose.jsx — same links, same active-underline
 *   behavior, same dark/light mechanism)
 *   Versions bar (Original Dataset always; Encoding & Scaling vN once applied)
 *   ── 75/25 split ──
 *   LEFT (~75%): dataset table with encoding controls directly above their
 *     categorical columns and scaling controls directly below their numeric
 *     columns (scaling locked until every categorical column is encoded) →
 *     transformation preview (only transformed columns, pre-Apply; the full
 *     merged dataset, post-Apply) → Apply / Redo
 *   RIGHT (~25%): Guidance
 */
import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react'
import { useTheme } from '../theme'
import TopNav from '../components/TopNav'
import SharedVersionsBar from '../components/VersionsBar'

const shadow  = '0 4px 24px rgba(0,0,0,0.18)'
const shadow2 = '0 1px 4px rgba(0,0,0,0.12)'
const btn = (bg, color, extra = {}) => ({
  padding: '9px 18px', borderRadius: 9, border: 'none', background: bg, color,
  fontWeight: 700, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s', ...extra,
})

const TYPE_COLORS_DARK  = { numeric: '#2dd4bf', categorical: '#fbbf24' }
const TYPE_COLORS_LIGHT = { numeric: '#0d9488', categorical: '#d97706' }

// Column width is now computed per-render from the actually-available
// container width (see useContainerWidth/computeColWidth below), not a
// single fixed constant — a 5-column dataset gets wide, easy-to-read
// columns that fill the card; a 50-column dataset clamps down to MIN_COL_W
// and scrolls horizontally. ROW_N_W stays fixed (the "#" column never needs
// to grow). MIN/MAX_COL_W are the clamp bounds.
const ROW_N_W    = 34
const MIN_COL_W  = 76
const MAX_COL_W  = 240
const MIN_SUBCOL_W = 40 // one-hot generated sub-columns never go below this

// Both dataset-preview tables (Original — Before, Modified — After) can
// carry up to 50 rows, which used to push the Apply button (or, post-
// Apply, the second table) far down the page. Capping the table BODY at
// this height (~12-13 rows depending on the responsive row padding — see
// computeRowPad) and scrolling internally, with a sticky header so column
// names stay visible, keeps the page's own scroll position stable instead
// of requiring a long scroll just to reach a button below the table.
const TABLE_BODY_MAX_HEIGHT = 420

// Measures the actual rendered width of a container (via ResizeObserver, so
// it re-measures on window resize and on the sidebar/modal layout changing)
// rather than assuming a fixed page width. useLayoutEffect (not useEffect)
// so the corrected width applies before the browser paints, avoiding a
// visible flash at the fallback width on first render.
function useContainerWidth(fallback = 900) {
  const ref = useRef(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

// Fits numCols columns into availWidth, clamped to [MIN_COL_W, MAX_COL_W].
// Few columns in a wide container -> each gets a generous share (clamped at
// MAX_COL_W so a 1-2 column dataset doesn't produce absurdly wide columns).
// Many columns -> clamps to MIN_COL_W, and the table's total width then
// exceeds the container, so the existing overflow-x:auto wrapper scrolls —
// exactly the "narrow + scroll" fallback for large datasets.
export function computeColWidth(availWidth, numCols) {
  if (numCols <= 0) return MAX_COL_W
  const fit = Math.floor((availWidth - ROW_N_W - 4) / numCols)
  return Math.max(MIN_COL_W, Math.min(MAX_COL_W, fit))
}

// Row height scales with the SAME density signal as column width, not with
// row count directly — a small dataset (few columns -> wide columns) reads
// as cramped if the rows stay at the narrow-table's compact padding, so
// vertical padding grows smoothly alongside colWidth: MIN_COL_W -> the old
// compact 4px, MAX_COL_W -> a roomier 10px. Purely a visual sizing change —
// never touches cell values.
function computeRowPad(colWidth) {
  const t = Math.max(0, Math.min(1, (colWidth - MIN_COL_W) / (MAX_COL_W - MIN_COL_W)))
  return Math.round(4 + t * 6)
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS — unchanged content from the previous version of this page
// ─────────────────────────────────────────────────────────────────────────────
const SCALER_INFO = {
  minmax: {
    label:   'Min-Max scaling',
    short:   'Scales values to [0, 1].',
    detail:  'Good for KNN and neural networks. Sensitive to outliers because extreme values stretch the range.',
  },
  standard: {
    label:   'Standard scaling',
    short:   'Centers around mean=0, std=1.',
    detail:  'Good for SVM and Logistic Regression. Works especially well when the data is roughly normally distributed.',
  },
  robust: {
    label:   'Robust scaling',
    short:   'Uses median & IQR — outlier-resistant.',
    detail:  'Best when your dataset has unusual or extreme values you do not want to distort the scaling.',
  },
  none: { label: 'None', short: 'Leave column unchanged.', detail: '' },
}

const ENCODING_INFO = {
  label: {
    label:  'Label encoding',
    detail: 'Maps categories to integers (0, 1, 2…). Best when categories have a natural order (Small → Medium → Large) or for binary columns.',
  },
  one_hot: {
    label:  'One-hot encoding',
    detail: 'Creates one binary column per category. Best for nominal data with no natural order (City, Color, Country).',
  },
}

const ALGORITHM_MAP = {
  knn:                 { scaler: 'minmax',   reason: 'KNN computes distances — Min-Max keeps all features on equal scale.' },
  logistic_regression: { scaler: 'standard', reason: 'Gradient-based optimisation converges better with Standard scaling.' },
  svm:                 { scaler: 'standard', reason: 'SVMs are very sensitive to feature magnitude.' },
  neural_network:      { scaler: 'minmax',   reason: 'Min-Max keeps values in [0,1] which suits most activation functions.' },
  linear_regression:   { scaler: 'standard', reason: 'Standard scaling stabilises coefficient interpretation.' },
  random_forest:       { scaler: 'none',     reason: 'Tree-based models are scale-invariant. Scaling is optional.' },
  decision_tree:       { scaler: 'none',     reason: 'Decision trees split on values — scale does not matter.' },
  gradient_boosting:   { scaler: 'none',     reason: 'Boosting is also tree-based and not sensitive to scale.' },
}

// ─────────────────────────────────────────────────────────────────────────────
// API HELPER — unchanged (127.0.0.1, not "localhost" — see frontend/src/api.js)
// ─────────────────────────────────────────────────────────────────────────────
const ML_API = 'http://127.0.0.1:8001'

const callEncoding = async (endpoint, body) => {
  const res = await fetch(`${ML_API}/encoding/${endpoint}`, {
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


// Narrow-column-friendly numeric formatting — raw floats from pandas can run
// to 12+ decimal places, which is unreadable at any of this page's column
// widths regardless of truncation. Purely a display concern; the actual
// values sent to/received from the backend are never touched.
const fmtCell = (v) => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3)
  return String(v)
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL SHARED COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
const SectionTag = ({ icon, label, sub, C }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
    <span style={{ fontSize: 13 }}>{icon}</span>
    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
      textTransform: 'uppercase', color: C.primary }}>{label}</span>
    {sub && <span style={{ fontSize: 11, color: C.muted }}>{sub}</span>}
  </div>
)

const InfoPopover = ({ text, C }) => {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: 16, height: 16, borderRadius: '50%', border: `1px solid ${C.border}`,
          background: C.card, color: C.muted, fontSize: 10, fontWeight: 700,
          cursor: 'pointer', lineHeight: 1, padding: 0, marginLeft: 4 }}>ⓘ</button>
      {open && (
        <div style={{ position: 'absolute', top: 22, left: 0, zIndex: 200,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: '10px 14px', width: 260, fontSize: 12, color: C.text,
          lineHeight: 1.6, boxShadow: shadow }}>
          {text}
          <button onClick={() => setOpen(false)}
            style={{ position: 'absolute', top: 6, right: 8, background: 'none',
              border: 'none', cursor: 'pointer', color: C.muted, fontSize: 12 }}>✕</button>
        </div>
      )}
    </span>
  )
}

// Encoding dropdown — sits directly above its categorical column.
const EncodingDropdown = ({ C, col, value, suggestion, onChange, loading }) => (
  <div style={{ padding: '0 3px' }}>
    <div style={{ position: 'relative' }}>
      <select
        value={value || ''}
        onChange={e => onChange(col.name, e.target.value || null)}
        disabled={loading}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '5px 20px 5px 6px', fontSize: 10.5,
          border: `1px solid ${value ? C.primary : C.border}`,
          borderRadius: 6, fontWeight: value ? 700 : 400,
          background: value ? C.primarySoft : C.card,
          color: value ? C.primary : C.text,
          cursor: 'pointer', appearance: 'none', outline: 'none',
        }}>
        <option value="">— encode</option>
        <option value="label">Label{suggestion === 'label' ? ' ★' : ''}</option>
        <option value="one_hot">One-Hot{suggestion === 'one_hot' ? ' ★' : ''}</option>
      </select>
      <span style={{ position: 'absolute', right: 5, top: '50%',
        transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: 8, color: C.muted }}>▼</span>
    </div>
    {loading && <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>…</div>}
  </div>
)

// Scaling dropdown — sits directly below its numeric column. `locked` (true
// until every categorical column has been encoded) disables it and shows a
// small padlock instead of the usual suggestion star.
const ScalingDropdown = ({ C, col, value, suggestion, onChange, loading, locked }) => (
  <div style={{ padding: '0 3px' }}>
    <div style={{ position: 'relative' }}>
      <select
        value={value || 'none'}
        onChange={e => onChange(col.name, e.target.value === 'none' ? null : e.target.value)}
        disabled={loading || locked}
        title={locked ? 'Finish encoding every categorical column first' : undefined}
        style={{
          width: '100%', padding: '5px 20px 5px 6px', fontSize: 10.5,
          border: `1px solid ${value ? C.primary : C.border}`,
          borderRadius: 6, fontWeight: value ? 700 : 400,
          background: locked ? C.faint : (value ? C.primarySoft : C.card),
          color: locked ? C.muted : (value ? C.primary : C.text),
          cursor: locked ? 'not-allowed' : 'pointer', appearance: 'none', outline: 'none',
          opacity: locked ? 0.6 : 1,
        }}>
        <option value="none">{locked ? '🔒 locked' : '— scale'}</option>
        <option value="minmax">Min-Max{suggestion === 'minmax' ? ' ★' : ''}</option>
        <option value="standard">Standard{suggestion === 'standard' ? ' ★' : ''}</option>
        <option value="robust">Robust{suggestion === 'robust' ? ' ★' : ''}</option>
      </select>
      {!locked && (
        <span style={{ position: 'absolute', right: 5, top: '50%',
          transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: 8, color: C.muted }}>▼</span>
      )}
    </div>
    {loading && <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>…</div>}
  </div>
)

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN GROUP HEADER — a plain column keeps a single-row header; a one-hot
// group gets a shared top row spanning all its generated sub-columns (so the
// group visually reads as belonging to the original column, per the sketch),
// with a bolder outer border distinguishing the group from its neighbors.
// Used by both the dataset table (single columns only) and the preview /
// post-Apply tables (which can contain real groups).
// ─────────────────────────────────────────────────────────────────────────────
function borderCellStyle(C, { right = true, groupEdge = false } = {}) {
  return {
    borderRight: right ? `${groupEdge ? 2 : 1}px solid ${groupEdge ? C.primary + '99' : C.border}` : 'none',
    borderBottom: `1px solid ${C.border}`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPANDABLE TABLE — a ⤢ button that opens the same content in a large
// scrim-blurred modal, ✕ (or click-outside) to collapse back. Mirrors
// Cleaning.jsx's ExpandableChart / Diagnose.jsx's ExpandableSection exactly:
// `children` is mounted TWICE (once inline, once in the modal) rather than
// portaled — each mount gets its own independent state/measurements, which
// is what lets DatasetTable/PreviewTable's own width-measuring hook compute
// a wider column width for the (much wider) modal automatically, with no
// coordination needed between the two.
// ─────────────────────────────────────────────────────────────────────────────
function ExpandableTable({ C, title, children }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <div style={{ position: 'relative' }}>
        <button onClick={() => setExpanded(true)} title="Expand table" aria-label="Expand table" style={{
          position: 'absolute', top: 8, right: 8, zIndex: 6,
          width: 26, height: 26, borderRadius: 6,
          background: C.faint, border: `1px solid ${C.border}`, color: C.muted,
          cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>⤢</button>
        {children}
      </div>

      {expanded && (
        <div onClick={() => setExpanded(false)} style={{
          position: 'fixed', inset: 0, zIndex: 1000, background: C.scrim,
          backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '92vw', maxWidth: 1500, maxHeight: '88vh', overflow: 'auto',
            background: C.overlayCard, border: `1px solid ${C.border}`, borderRadius: 16,
            boxShadow: '0 24px 80px rgba(0,0,0,0.5)', padding: 22,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{title}</div>
              <button onClick={() => setExpanded(false)} style={{
                background: C.faint, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: '6px 14px', color: C.muted, cursor: 'pointer', fontSize: 12, fontWeight: 700,
              }}>✕ Close</button>
            </div>
            {children}
          </div>
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DATASET TABLE — the "old dataset" / "current dataset" table, with the
// encoding controls row directly above and the scaling controls row directly
// below, sharing the exact same per-column width so every control lines up
// with its column. table-layout:fixed is what makes the alignment reliable —
// without it, a long cell value can silently widen a column past its
// declared width and desync it from the control row above/below.
// ─────────────────────────────────────────────────────────────────────────────
function DatasetTable({
  C, cols, rows, typeColors, targetCol,
  encChoices, onEncode, scaleChoices, onScale, loadingCol, scalingLocked,
}) {
  const [containerRef, availWidth] = useContainerWidth()
  const colWidth = computeColWidth(availWidth, cols.length)
  const totalWidth = ROW_N_W + cols.length * colWidth
  const rowPad = computeRowPad(colWidth)

  return (
    <div ref={containerRef} style={{ overflowX: 'auto' }}>
      {/* ENCODING controls row */}
      <div style={{ padding: '10px 16px 4px', borderBottom: `1px dashed ${C.border}` }}>
        <SectionTag C={C} icon="✎" label="Encoding" sub="select for categorical columns" />
      </div>
      <div style={{ display: 'flex', width: totalWidth, padding: '6px 6px 6px', paddingLeft: ROW_N_W + 6 }}>
        {cols.map(col => (
          <div key={col.name} style={{ width: colWidth, flexShrink: 0 }}>
            {col.inferred_type === 'categorical' && col.name !== targetCol && (
              <EncodingDropdown C={C} col={col} value={encChoices[col.name] || ''}
                suggestion={col.suggested_encoding} onChange={onEncode} loading={loadingCol === col.name} />
            )}
            {/* The target column never gets an encoding control (one-hot
                would explode it into multiple columns, breaking every
                later step that expects a single target column by name) —
                a small label in its place instead of leaving a silent,
                unexplained gap where every other categorical column has
                a dropdown. */}
            {col.inferred_type === 'categorical' && col.name === targetCol && (
              <div style={{ textAlign: 'center', fontSize: 9.5, fontWeight: 700, color: C.muted,
                padding: '5px 6px', border: `1px dashed ${C.border}`, borderRadius: 6 }} title="The target column is never encoded here">
                🎯 target
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Dataset table — capped body height, own vertical scroll, sticky
          header (see TABLE_BODY_MAX_HEIGHT) so a 50-row dataset doesn't push
          the encoding/scaling control rows and Apply button far down the
          page; those controls stay in view around this inner scroll area. */}
      <div style={{ maxHeight: TABLE_BODY_MAX_HEIGHT, overflowY: 'auto', overflowX: 'hidden' }}>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: totalWidth }}>
          <colgroup>
            <col style={{ width: ROW_N_W }} />
            {cols.map(col => <col key={col.name} style={{ width: colWidth }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...thStyle(C, rowPad), borderTop: `2px solid ${C.border}`, position: 'sticky', top: 0, zIndex: 2 }}>#</th>
              {cols.map(col => (
                <th key={col.name} style={{ ...thStyle(C, rowPad), ...borderCellStyle(C), borderTop: `2px solid ${C.border}`, position: 'sticky', top: 0, zIndex: 2 }}>
                  <div style={{ fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.name}</div>
                  <div style={{ fontSize: 9, fontWeight: 600, color: typeColors[col.inferred_type] || C.muted,
                    textTransform: 'lowercase', marginTop: 1 }}>{col.inferred_type}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                <td style={{ ...tdStyle(C, rowPad), color: C.muted }}>{ri + 1}</td>
                {cols.map(col => (
                  <td key={col.name} style={{ ...tdStyle(C, rowPad), ...borderCellStyle(C) }}>{fmtCell(row[col.name])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* SCALING controls row */}
      <div style={{ padding: '10px 16px 4px', borderTop: `1px dashed ${C.border}` }}>
        <SectionTag C={C} icon="⚖" label="Scaling" sub={scalingLocked ? '🔒 finish encoding first' : 'numeric columns only'} />
      </div>
      <div style={{ display: 'flex', width: totalWidth, padding: '0 6px 12px', paddingLeft: ROW_N_W + 6 }}>
        {cols.map(col => (
          <div key={col.name} style={{ width: colWidth, flexShrink: 0 }}>
            {col.inferred_type === 'numeric' && (
              <ScalingDropdown C={C} col={col} value={scaleChoices[col.name] || ''}
                suggestion={col.suggested_scaler} onChange={onScale} loading={loadingCol === col.name}
                locked={scalingLocked} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// APPLIED DATA TABLE — a read-only, responsive-width table (no encoding/
// scaling controls). Reused for BOTH post-Apply tables: the "Original
// Dataset — Before" table (sourced from the untouched original `profile`)
// and the "Modified Dataset — After" table (sourced from `appliedProfile`).
// Deliberately generic — it has no idea which one it's rendering, it just
// renders whatever cols/rows it's given.
// ─────────────────────────────────────────────────────────────────────────────
function AppliedDataTable({ C, cols, rows, typeColors }) {
  const [containerRef, availWidth] = useContainerWidth()
  const colWidth = computeColWidth(availWidth, cols.length)
  const totalWidth = ROW_N_W + cols.length * colWidth
  const rowPad = computeRowPad(colWidth)

  return (
    <div ref={containerRef} style={{ overflowX: 'auto' }}>
      {/* Same capped-height, sticky-header inner scroll as DatasetTable —
          this is the "Before"/"After" table, so without a cap a 50-row
          dataset would push the OTHER table (and, pre-comparison, the
          Apply button) far down the page. */}
      <div style={{ maxHeight: TABLE_BODY_MAX_HEIGHT, overflowY: 'auto', overflowX: 'hidden' }}>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: totalWidth }}>
          <colgroup>
            <col style={{ width: ROW_N_W }} />
            {cols.map(col => <col key={col.name} style={{ width: colWidth }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...thStyle(C, rowPad), borderTop: `2px solid ${C.border}`, position: 'sticky', top: 0, zIndex: 2 }}>#</th>
              {cols.map(col => (
                <th key={col.name} style={{ ...thStyle(C, rowPad), ...borderCellStyle(C), borderTop: `2px solid ${C.border}`, position: 'sticky', top: 0, zIndex: 2 }}>
                  <div style={{ fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.name}</div>
                  <div style={{ fontSize: 9, fontWeight: 600, color: typeColors[col.inferred_type] || C.muted, marginTop: 1 }}>
                    {col.inferred_type}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((row, ri) => (
              <tr key={ri}>
                <td style={{ ...tdStyle(C, rowPad), color: C.muted }}>{ri + 1}</td>
                {cols.map(col => (
                  <td key={col.name} style={{ ...tdStyle(C, rowPad), ...borderCellStyle(C) }}>{fmtCell(row[col.name])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// rowPad defaults to the original fixed 5/4px so every existing call site
// (PreviewTable, anything not explicitly passing a computed value) renders
// exactly as before — only DatasetTable/AppliedDataTable opt into the
// responsive row height, via their own computeRowPad(colWidth).
const thStyle = (C, rowPad = 5) => ({
  padding: `${rowPad}px 6px`, textAlign: 'left', fontSize: 9.5, fontWeight: 800,
  color: C.muted, background: C.cardAlt, whiteSpace: 'nowrap', overflow: 'hidden',
})
const tdStyle = (C, rowPad = 4) => ({
  padding: `${rowPad}px 6px`, fontSize: 11, color: C.text, whiteSpace: 'nowrap',
  overflow: 'hidden', textOverflow: 'ellipsis',
})

// ─────────────────────────────────────────────────────────────────────────────
// TRANSFORMATION PREVIEW TABLE (pre-Apply) — only columns that have actually
// been transformed. One-hot columns render as a visually grouped block: one
// shared header cell spanning the generated sub-columns (colSpan), a bold
// outer border around the group, thin borders between the sub-columns inside
// it. The group's sub-columns are narrowed so the group's total width stays
// close to one normal column's computed width, rather than exploding the
// table width.
// ─────────────────────────────────────────────────────────────────────────────
function PreviewTable({ C, profile, encodingResults, scalingResults }) {
  const [containerRef, availWidth] = useContainerWidth()

  const groups = useMemo(() => {
    if (!profile) return []
    const out = []
    profile.columns.forEach(col => {
      const enc = encodingResults[col.name]
      const sc  = scalingResults[col.name]
      if (enc?.method === 'label') {
        out.push({ source: col.name, kind: 'label', subCols: [{ key: col.name, name: col.name, preview: enc.preview }] })
      } else if (enc?.method === 'one_hot') {
        out.push({
          source: col.name, kind: 'one_hot',
          subCols: enc.one_hot_columns.map(oh => ({ key: oh.name, name: oh.name.replace(`${col.name}_`, ''), preview: oh.preview })),
        })
      } else if (sc) {
        out.push({ source: col.name, kind: sc.method, subCols: [{ key: `${col.name}_scaled`, name: col.name, preview: sc.preview }] })
      }
    })
    return out
  }, [profile, encodingResults, scalingResults])

  if (groups.length === 0) {
    return (
      <div ref={containerRef} style={{ textAlign: 'center', padding: '28px 0', color: C.muted, fontSize: 13 }}>
        No modifications yet — choose an encoding or scaling above to see the preview.
      </div>
    )
  }

  const numRows = groups[0]?.subCols[0]?.preview?.length || 0
  const typeLabel = { label: 'label', one_hot: 'one-hot', minmax: 'min-max', standard: 'standard', robust: 'robust' }
  const typeColor = (k) => (k === 'label' || k === 'one_hot') ? C.primary : C.success

  // colWidth is sized per GROUP (original column), same as the main dataset
  // table — a group with multiple one-hot sub-columns then divides that
  // group's own width across its sub-columns, so the group's total width
  // stays close to what one normal column would take, per the visual spec.
  const colWidth = computeColWidth(availWidth, groups.length)
  const totalWidth = ROW_N_W + groups.reduce((s, g) =>
    s + (g.subCols.length > 1 ? Math.max(MIN_SUBCOL_W, Math.floor(colWidth / g.subCols.length)) * g.subCols.length : colWidth), 0)

  return (
    <div ref={containerRef} style={{ overflowX: 'auto', borderRadius: 10, border: `1px solid ${C.border}` }}>
      {/* Capped body height + its own vertical scroll, same convention as
          DatasetTable/AppliedDataTable (TABLE_BODY_MAX_HEIGHT) — without
          this, a many-row dataset made this preview (and the whole page)
          grow arbitrarily tall once any column was actually transformed. */}
      <div style={{ maxHeight: TABLE_BODY_MAX_HEIGHT, overflowY: 'auto', overflowX: 'hidden' }}>
      <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: totalWidth }}>
        <colgroup>
          <col style={{ width: ROW_N_W }} />
          {groups.map(g => {
            const subW = g.subCols.length > 1
              ? Math.max(MIN_SUBCOL_W, Math.floor(colWidth / g.subCols.length))
              : colWidth
            return g.subCols.map(sc => <col key={sc.key} style={{ width: subW }} />)
          })}
        </colgroup>
        <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
          {/* Group row — one cell per original column, spanning its sub-columns */}
          <tr>
            <th rowSpan={2} style={{ ...thStyle(C), borderBottom: `1px solid ${C.border}` }} />
            {groups.map(g => (
              <th key={g.source} colSpan={g.subCols.length}
                style={{
                  ...thStyle(C), textAlign: 'center', fontSize: 10, color: typeColor(g.kind),
                  borderRight: `2px solid ${C.primary}99`, borderBottom: `1px solid ${C.border}`,
                }}>
                {g.source} <span style={{ opacity: 0.7, fontWeight: 600 }}>({typeLabel[g.kind]})</span>
              </th>
            ))}
          </tr>
          {/* Sub-column row */}
          <tr>
            {groups.map(g => g.subCols.map((sc, i) => (
              <th key={sc.key} style={{
                ...thStyle(C), fontSize: 9,
                borderRight: i === g.subCols.length - 1 ? `2px solid ${C.primary}99` : `1px solid ${C.border}`,
              }}>
                {sc.name}
              </th>
            )))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: numRows }).map((_, ri) => (
            <tr key={ri}>
              <td style={{ ...tdStyle(C), color: C.muted, borderBottom: `1px solid ${C.border}` }}>{ri + 1}</td>
              {groups.map(g => g.subCols.map((sc, i) => {
                const cell = sc.preview?.[ri]
                const newVal = cell ? (cell.encoded ?? cell.scaled) : undefined
                return (
                  <td key={sc.key} style={{
                    ...tdStyle(C), fontWeight: 700, color: typeColor(g.kind),
                    borderRight: i === g.subCols.length - 1 ? `2px solid ${C.primary}99` : `1px solid ${C.border}`,
                  }}>
                    {cell ? fmtCell(newVal) : '—'}
                  </td>
                )
              }))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GUIDANCE SECTION — restyled for the ~25% side column
// ─────────────────────────────────────────────────────────────────────────────
function GuidanceSection({ C }) {
  const [algo, setAlgo] = useState('')
  const suggestion = algo ? ALGORITHM_MAP[algo] : null

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: '18px 18px', boxShadow: shadow2, height: '100%' }}>
      <SectionTag C={C} icon="?" label="Guidance" />
      <h3 style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 4 }}>
        Choose with context, not guesswork.
      </h3>
      <p style={{ fontSize: 11.5, color: C.muted, marginBottom: 16, lineHeight: 1.5 }}>
        Educational suggestions based on transparent rules. You're always free to choose differently.
      </p>

      <div style={{ background: C.cardAlt, borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: C.muted, marginBottom: 8 }}>
          CURRENT MODEL ALGORITHM
        </div>
        <select value={algo} onChange={e => setAlgo(e.target.value)}
          style={{ width: '100%', padding: '7px 10px', borderRadius: 8,
            border: `1px solid ${C.border}`, fontSize: 12, background: C.card,
            color: C.text, cursor: 'pointer', outline: 'none' }}>
          <option value="">— select algorithm —</option>
          <option value="knn">K-Nearest Neighbours (KNN)</option>
          <option value="logistic_regression">Logistic Regression</option>
          <option value="svm">Support Vector Machine (SVM)</option>
          <option value="neural_network">Neural Network</option>
          <option value="linear_regression">Linear Regression</option>
          <option value="random_forest">Random Forest</option>
          <option value="decision_tree">Decision Tree</option>
          <option value="gradient_boosting">Gradient Boosting</option>
        </select>
        {suggestion && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: C.primarySoft, borderRadius: 8,
            border: `1px solid ${C.primary}33` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.primary, marginBottom: 4 }}>Rule-based suggestion</div>
            <div style={{ fontSize: 11.5, color: C.text }}>
              <strong>{SCALER_INFO[suggestion.scaler]?.label}</strong> is recommended.
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>{suggestion.reason}</div>
          </div>
        )}
      </div>

      {['minmax', 'standard', 'robust'].map(key => (
        <div key={key} style={{ marginBottom: 12, paddingBottom: 12,
          borderBottom: key !== 'robust' ? `1px solid ${C.border}` : 'none' }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: C.primary, marginBottom: 3 }}>{SCALER_INFO[key].label}</div>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{SCALER_INFO[key].detail}</div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function EncodingPage({ projectData, onNext, onUpdateData,
  getDisplayPath, getInputPath, registerVersion, isStepDone, getVersion, resetStep, versions,
  active, onNavigate, furthestOrder }) {

  const { dark, C } = useTheme()
  const typeColors = dark ? TYPE_COLORS_DARK : TYPE_COLORS_LIGHT

  const [profile,  setProfile]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [dismissed, setDismissed] = useState(false)

  const [encChoices, setEncChoices] = useState({})
  const [encResults, setEncResults] = useState({})
  const [scaleChoices, setScaleChoices] = useState({})
  const [scaleResults, setScaleResults] = useState({})
  const [loadingCol, setLoadingCol] = useState(null)

  const [applying, setApplying] = useState(false)
  const [applied,  setApplied]  = useState(false)
  const [newPath,  setNewPath]  = useState(null)
  const [appliedProfile, setAppliedProfile] = useState(null) // complete post-Apply dataset
  const [redoModal, setRedoModal] = useState(false)
  const [redoing, setRedoing] = useState(false)

  // filePath is Table 1's data source AND the file every encode/scale/apply
  // call operates on. It MUST come from getInputPath, never getDisplayPath —
  // getDisplayPath deliberately flips to 'encoding'’s own output once a
  // version for this step exists (needed elsewhere, e.g. resuming Table 2
  // below), which is exactly backwards for a value that's supposed to be a
  // permanent "before" snapshot: with getDisplayPath here, Table 1 would
  // silently start showing the ALREADY-ENCODED file the moment Apply
  // succeeded, and — worse — Redo wouldn't fix it either, because
  // getDisplayPath's fallback bottoms out at initialFilePath, which is
  // App.jsx's mutable `filePath` state, itself overwritten by Apply via
  // onUpdateData. getInputPath never looks at 'encoding' itself, so none of
  // that matters: this value is identical before Apply, after Apply, and
  // after Redo, always resolving to "whatever step's output really
  // precedes encoding" (e.g. Cleaning's output).
  const filePath = useMemo(() =>
    (getInputPath ? getInputPath('encoding') : null) || projectData?.filePath,
  [getInputPath, projectData])

  // The target column (chosen back on Upload) never gets an encoding
  // control here — one-hot would explode it into multiple columns, and
  // every later step (Sampling, Feature Selection, Training) expects a
  // single target column reachable by this exact name.
  const targetCol = projectData?.targetColumn || null

  const done = isStepDone ? isStepDone('encoding') : applied
  const versionInfo = getVersion ? getVersion('encoding') : null

  // ── Load profile whenever the working (INPUT) file changes. Because
  // filePath now comes from getInputPath (see above), this effect does NOT
  // re-fire on Apply or Redo — Table 1's data was correct from the start and
  // never needed to change. ─────────────────────────────────────────────
  useEffect(() => {
    if (!filePath) return
    setLoading(true)
    callEncoding('profile', { file_path: filePath })
      .then(d => setProfile(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [filePath])

  // ── Resume: if this step ALREADY has a registered version when the page
  // mounts (e.g. the user navigated away after Apply and came back), show
  // the completed before/after comparison immediately instead of the
  // pending controls — fetch Table 2 from that existing version's file via
  // getDisplayPath (which correctly returns 'encoding's own output here).
  useEffect(() => {
    if (!done || applied || appliedProfile) return
    const existingOutputPath = getDisplayPath ? getDisplayPath('encoding') : null
    if (!existingOutputPath) return
    callEncoding('profile', { file_path: existingOutputPath })
      .then(d => { setAppliedProfile(d); setNewPath(existingOutputPath); setApplied(true) })
      .catch(() => { /* if this fails, the page just stays in the pending state */ })
  }, [done, applied, appliedProfile, getDisplayPath])

  const categoricalCols = useMemo(() =>
    (profile?.columns || []).filter(c => c.inferred_type === 'categorical' && c.name !== targetCol),
  [profile, targetCol])
  const encodingComplete = categoricalCols.length === 0 || categoricalCols.every(c => !!encChoices[c.name])

  const handleEncoding = useCallback(async (colName, method) => {
    if (!method) {
      setEncChoices(prev => { const n = { ...prev }; delete n[colName]; return n })
      setEncResults(prev => { const n = { ...prev }; delete n[colName]; return n })
      return
    }
    setEncChoices(prev => ({ ...prev, [colName]: method }))
    setLoadingCol(colName)
    try {
      const res = await callEncoding('encode-column', { file_path: filePath, column: colName, method })
      setEncResults(prev => ({ ...prev, [colName]: res }))
    } catch (e) { setError(e.message) }
    finally { setLoadingCol(null) }
  }, [filePath])

  const handleScaling = useCallback(async (colName, method) => {
    if (!method) {
      setScaleChoices(prev => { const n = { ...prev }; delete n[colName]; return n })
      setScaleResults(prev => { const n = { ...prev }; delete n[colName]; return n })
      return
    }
    setScaleChoices(prev => ({ ...prev, [colName]: method }))
    setLoadingCol(colName)
    try {
      const res = await callEncoding('scale-column', { file_path: filePath, column: colName, method })
      setScaleResults(prev => ({ ...prev, [colName]: res }))
    } catch (e) { setError(e.message) }
    finally { setLoadingCol(null) }
  }, [filePath])

  // ── Apply — commits ONE new dataset version. The second table then shows
  // the COMPLETE merged dataset (transformed + untouched columns), fetched
  // fresh from the applied file rather than assembled client-side, so it's
  // exactly what's actually on disk. ─────────────────────────────────────
  const handleApply = useCallback(async () => {
    setApplying(true)
    try {
      const encoding_decisions = Object.entries(encChoices).map(([column, method]) => ({ column, method }))
      const scaling_decisions  = Object.entries(scaleChoices).map(([column, method]) => ({ column, method }))
      const res = await callEncoding('apply', { file_path: filePath, encoding_decisions, scaling_decisions })
      setNewPath(res.new_file_path)

      const merged = await callEncoding('profile', { file_path: res.new_file_path })
      setAppliedProfile(merged)

      if (registerVersion) await registerVersion('encoding', res.new_file_path, 'Encoding & Scaling', res.row_count)
      if (onUpdateData) onUpdateData({ cleanedFilePath: res.new_file_path })
      setApplied(true)
    } catch (e) { setError(e.message) }
    finally { setApplying(false) }
  }, [filePath, encChoices, scaleChoices, registerVersion, onUpdateData])

  // ── Redo — genuinely returns to the pre-encoding state: clears every
  // pending/applied local state, then actually removes the 'encoding'
  // DatasetVersion (via resetStep, real Django cascade-delete) rather than
  // just hiding it — so getDisplayPath('encoding') naturally falls back to
  // the earlier version again and the profile effect re-fetches the correct
  // (original) data on its own. ─────────────────────────────────────────
  const handleRedo = async () => {
    setRedoing(true)
    try {
      if (resetStep) await resetStep('encoding')
      setEncChoices({}); setEncResults({})
      setScaleChoices({}); setScaleResults({})
      setApplied(false); setNewPath(null); setAppliedProfile(null)
      setRedoModal(false)
    } finally { setRedoing(false) }
  }

  const numEncoded = Object.keys(encChoices).length
  const numScaled  = Object.keys(scaleChoices).length

  // These two early-return states previously hardcoded DARK.bg/DARK.muted/
  // etc. regardless of the app's actual selected theme — a leftover from
  // before this page was migrated onto the shared theme system. Since
  // `/encoding/profile`'s real network round-trip means this loading state
  // is genuinely visible for a moment on every navigation into this page,
  // that hardcoded near-black background was showing as a black flash even
  // in light mode. Now theme-aware like the rest of the file.
  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      <div style={{ textAlign: 'center', padding: '120px 0', color: C.muted }}>
        <div style={{ fontSize: 28, marginBottom: 12, animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</div>
        <p>Loading dataset…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  )
  if (error) return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: 20 }}>
      <div style={{ background: C.dangerSoft, border: `1px solid ${C.danger}`,
        borderRadius: 12, padding: 20, color: C.danger }}>⚠ {error}</div>
    </div>
  )
  if (!profile) return null

  // `cols` (and profile.display_rows) are ALWAYS the original, pre-encoding/
  // scaling data — the first table renders these directly, before AND after
  // Apply, and nothing in this file ever reassigns them to appliedProfile's
  // shape. The complete post-Apply dataset lives entirely in `appliedProfile`
  // and is only ever read directly from there, in the second table.
  const cols = profile.columns

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' }}>
      <TopNav active={active || 'encoding'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
      <SharedVersionsBar versions={versions} />

      {!dismissed && (
        <div style={{ margin: '16px 24px 0', background: C.primarySoft, border: `1px solid ${C.primary}33`,
          borderRadius: 10, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12.5, color: C.text }}>
            <strong>ℹ Start with encoding.</strong> Scaling unlocks once every categorical column is encoded.
          </div>
          <button onClick={() => setDismissed(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.primary, fontWeight: 700, fontSize: 12.5, marginLeft: 16 }}>
            Got it
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, padding: 20, alignItems: 'flex-start' }}>
        {/* ── LEFT ~75%: dataset + preview + apply ─────────────────────────── */}
        <div style={{ flex: '1 1 75%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionTag C={C} icon="▤" label={applied ? 'Original & Modified Dataset' : 'Original Cleaned Dataset'} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: C.muted }}>
              <button onClick={() => setRedoModal(true)}
                style={{ ...btn(C.dangerSoft, C.danger, { fontSize: 11, padding: '6px 12px', border: `1px solid ${C.danger}` }) }}>
                ↺ Redo changes
              </button>
            </div>
          </div>

          {/* FIRST table: the ORIGINAL dataset. Always rendered, sourced ONLY
              from `profile` (the pre-encoding/scaling data) — never from
              appliedProfile — so its values never change no matter what the
              user encodes/scales or applies. Pre-Apply this is the same
              interactive DatasetTable as before (unchanged); post-Apply the
              live controls are replaced by a read-only render of the exact
              same original data, since the choices are already committed and
              live dropdowns with no visible Apply button would be a dead end. */}
          <ExpandableTable C={C} title={applied ? 'Original Dataset — Before' : 'Original Cleaned Dataset'}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: shadow2 }}>
              {applied && (
                <div style={{ padding: '10px 16px 0' }}>
                  <SectionTag C={C} icon="▤" label="Original Dataset — Before"
                    sub={`${profile.row_count.toLocaleString()} rows · ${cols.length} columns · unchanged`} />
                </div>
              )}
              {!applied ? (
                <DatasetTable
                  C={C} cols={cols} rows={profile.display_rows} typeColors={typeColors} targetCol={targetCol}
                  encChoices={encChoices} onEncode={handleEncoding}
                  scaleChoices={scaleChoices} onScale={handleScaling}
                  loadingCol={loadingCol} scalingLocked={!encodingComplete}
                />
              ) : (
                <AppliedDataTable C={C} cols={cols} rows={profile.display_rows} typeColors={typeColors} />
              )}
            </div>
          </ExpandableTable>

          {/* SECOND table: the complete MODIFIED dataset — only once Apply
              has actually succeeded. Sourced from appliedProfile (freshly
              re-fetched from the applied file, see handleApply). The first
              table above is never replaced or hidden to make room for this
              one — both stay visible so the user can compare before/after. */}
          {applied && appliedProfile && (
            <>
              <div style={{ textAlign: 'center', fontSize: 12, color: C.muted, fontWeight: 700 }}>
                ↓ changes
              </div>
              <ExpandableTable C={C} title="Modified Dataset — After">
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: shadow2 }}>
                  <div style={{ padding: '10px 16px 0' }}>
                    <SectionTag C={C} icon="⚡" label="Modified Dataset — After"
                      sub={`${appliedProfile.row_count.toLocaleString()} rows · ${appliedProfile.columns.length} columns · complete result`} />
                  </div>
                  <AppliedDataTable C={C} cols={appliedProfile.columns} rows={appliedProfile.display_rows} typeColors={typeColors} />
                </div>
              </ExpandableTable>
            </>
          )}

          {/* ── Preview / summary / apply ─────────────────────────────────── */}
          {!applied && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
                <SectionTag C={C} icon="⚡" label="Modified Columns" sub="only transformed columns appear here" />
                <div style={{ padding: '3px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: C.primarySoft, color: C.primary, border: `1px solid ${C.primary}33` }}>
                  new version on Apply
                </div>
              </div>

              <ExpandableTable C={C} title="Modified Columns — Preview">
                <PreviewTable C={C} profile={profile} encodingResults={encResults} scalingResults={scaleResults} />
              </ExpandableTable>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14,
                padding: '12px 18px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: shadow2 }}>
                <div style={{ fontSize: 12.5, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {numEncoded > 0 && <span style={{ color: C.primary, fontWeight: 700 }}>✓ {numEncoded} encoded</span>}
                  {numEncoded > 0 && numScaled > 0 && <span>·</span>}
                  {numScaled > 0 && <span style={{ color: C.success, fontWeight: 700 }}>✓ {numScaled} scaled</span>}
                  {numEncoded === 0 && numScaled === 0 && <span>No modifications yet</span>}
                  {categoricalCols.length > 0 && !encodingComplete && (
                    <span style={{ marginLeft: 6, color: C.warning }}>🔒 encode all categorical columns to unlock scaling</span>
                  )}
                </div>
                <button onClick={handleApply}
                  disabled={applying || (numEncoded === 0 && numScaled === 0)}
                  style={btn(
                    (numEncoded > 0 || numScaled > 0) ? C.success : C.faint,
                    (numEncoded > 0 || numScaled > 0) ? (dark ? '#04241a' : 'white') : C.muted,
                    { fontSize: 13, padding: '10px 22px', cursor: (numEncoded === 0 && numScaled === 0) ? 'not-allowed' : 'pointer' }
                  )}>
                  {applying ? '⏳ Applying…' : 'Apply changes & create version ⟶'}
                </button>
              </div>
            </div>
          )}

          {applied && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px',
              background: C.successSoft, border: `1px solid ${C.success}44`, borderRadius: 12 }}>
              <span style={{ fontSize: 12.5, color: C.success, fontWeight: 700 }}>
                ✓ Version created{versionInfo?.versionNumber ? ` — Version ${versionInfo.versionNumber}` : ''}
              </span>
              <span style={{ fontSize: 11.5, color: C.muted }}>
                This dataset is now the working version. Use ↺ Redo changes above if you want to start over.
              </span>
            </div>
          )}
        </div>

        {/* ── RIGHT ~25%: Guidance ──────────────────────────────────────────── */}
        <div style={{ flex: '0 0 25%', maxWidth: '25%', minWidth: 260 }}>
          <GuidanceSection C={C} />
        </div>
      </div>

      {/* ── Redo confirmation modal ───────────────────────────────────────── */}
      {redoModal && (
        <div style={{ position: 'fixed', inset: 0, background: C.scrim, backdropFilter: 'blur(4px)',
          zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: C.overlayCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: 30,
            maxWidth: 420, width: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8, color: C.text }}>Redo Encoding & Scaling?</div>
            <p style={{ fontSize: 13, color: C.muted, marginBottom: 20, lineHeight: 1.6 }}>
              This clears every encoding/scaling choice on this page and returns the dataset to exactly the
              state it was in before you started — including removing the Encoding & Scaling version if one
              was already applied. You'll start again from the beginning.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setRedoModal(false)}
                style={btn(C.faint, C.text, { border: `1px solid ${C.border}` })}>Cancel</button>
              <button onClick={handleRedo} disabled={redoing}
                style={btn(C.danger, 'white')}>{redoing ? 'Working…' : 'Yes, redo'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
