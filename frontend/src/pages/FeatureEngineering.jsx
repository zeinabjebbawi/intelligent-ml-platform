/**
 * PRISM — Feature Engineering Page (Bucketizing + Create New Features)
 *
 * Two independent, optional sub-features, switched via a pill tab pair at
 * top-right (same pattern as Cleaning.jsx's PRISMHeader tabs). Both tabs
 * read and write the SAME underlying dataset-version step — 'feature_
 * engineering' (order 7, between encoding=6 and sampling=8 — see
 * frontend/src/hooks/useVersionHistory.js) — via ONE shared `filePath` /
 * `profile` at the page level, rather than each tab tracking its own file.
 *
 * This was deliberately two separate step names ('feature_bucketizing' /
 * 'feature_creation') in an earlier version of this page, each with its own
 * STEP_ORDER slot. That produced a real, reported bug: because the two
 * steps had a fixed relative order, doing Bucketizing after Creation (or
 * vice versa) would cascade-invalidate whichever one was "downstream" in
 * that fixed order — so a column created in one tab could silently vanish
 * from the other tab's table, and re-applying an action in the "upstream"
 * tab would delete the "downstream" tab's version even though nothing
 * about that work was actually stale. Bucketizing and Feature Creation are
 * peers, not a fixed sequence (the user can interleave them in any order),
 * so they now share one step name — exactly like Cleaning.jsx's Missing
 * tab, where every imputation action re-registers the same
 * 'cleaning_missing' step rather than each column having its own slot.
 * Whichever tab's Apply ran most recently just updates the one shared
 * version, and both tabs immediately see the result.
 *
 * Design: shares the same dark/light theme system as every other page (see
 * ../theme.jsx and ../components/TopNav.jsx) rather than its own tokens.
 */
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useTheme } from '../theme'
import TopNav from '../components/TopNav'
import SharedVersionsBar from '../components/VersionsBar'

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS — same values as Cleaning.jsx, reused rather than reinvented
// ─────────────────────────────────────────────────────────────────────────────
const shadow  = '0 4px 24px rgba(0,0,0,0.08)'
const shadow2 = '0 1px 4px rgba(0,0,0,0.06)'
const btn = (bg, color = 'white', extra = {}) => ({
  padding: '9px 20px', borderRadius: 10, border: 'none',
  background: bg, color, fontWeight: 700, fontSize: 13,
  cursor: 'pointer', transition: 'all 0.2s', ...extra,
})

// ─────────────────────────────────────────────────────────────────────────────
// API HELPER — 127.0.0.1, not "localhost" (dual-stack landmine on this
// machine — see docs/PROJECT_HANDOFF.md §11.2)
// ─────────────────────────────────────────────────────────────────────────────
const ML_API = 'http://127.0.0.1:8001'

const callFeature = async (endpoint, body) => {
  const res = await fetch(`${ML_API}/feature/${endpoint}`, {
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

const fmtCell = (v) => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3)
  return String(v)
}

const OP_SYMBOL = { add: '+', subtract: '−', multiply: '×', divide: '÷', custom: 'ƒ' }
const OP_DESC = (a, b) => ({
  add:      `${a} + ${b}`,
  subtract: `${a} − ${b}`,
  multiply: 'Interaction feature',
  divide:   'Ratio feature (÷0 → NaN)',
  custom:   'Write your own formula',
})
const STRATEGIES = [
  { value: 'equal_width', label: 'Equal Intervals',     short: 'Same range per bucket',  hint: 'I ask: how many buckets? The code auto-finds the column min/max for you.', max: 20, defaultN: 5 },
  { value: 'equal_freq',  label: 'Equal Distribution',  short: 'Same count per bucket',  hint: 'I ask: how many buckets? Each one ends up holding roughly equal data.',      max: 10, defaultN: 4 },
  { value: 'custom',      label: 'Custom Ranges',       short: 'You define the bins',    hint: 'I ask: comma-separated cutoff values, e.g. 20, 40, 60.' },
]

const severityStyle = (C) => ({
  error:   { color: C.danger,  soft: C.dangerSoft,  icon: '⛔' },
  warning: { color: C.warning, soft: C.warningSoft, icon: '⚠' },
  info:    { color: C.primary, soft: C.primarySoft, icon: 'ℹ' },
  ok:      { color: C.success, soft: C.successSoft, icon: '✓' },
})

// ─────────────────────────────────────────────────────────────────────────────
// DESCRIPTION CONTENT — verbatim-in-spirit from the user's reference material,
// kept long and complete per their explicit "don't make it too short" request.
// ─────────────────────────────────────────────────────────────────────────────
const BUCKETIZING_DESCRIPTION = {
  title: 'What is Bucketizing?',
  paragraphs: [
    `Bucketizing (also called Binning) converts a continuous numerical feature into ordered categories. Instead of the exact age 31.8, the model sees "30–35." This turns curved paths into straight steps: linear models can only draw straight lines, so predicting spending habits from raw age fails because teenagers, 30-year-olds, and retirees spend very differently. Grouping age into buckets like 13–19, 20–35, and 65+ lets the model assign a separate rule to each group — capturing a curve it could never see as one continuous number.`,
    `It also tames wild numbers. If most houses cost $300,000 but one mansion costs $50,000,000, that single value can break a model's math — averages and scaled ranges stretch to accommodate it. Bucketed into "Low / Medium / High / Luxury," the mansion just sits quietly in the top bucket without distorting anything else. And it suppresses noise: a 31.2-year-old and a 31.8-year-old behave the same in practice, so grouping them into "30–35" removes a meaningless decimal difference and lets the model focus on the pattern that actually matters.`,
  ],
  bullets: [
    { icon: '📈', title: 'Captures Non-Linear Relationships', text: 'Assigns a separate weight to each range, letting simple models learn curves they otherwise cannot see.' },
    { icon: '🛡️', title: 'Neutralizes Outliers', text: 'Extreme values are safely absorbed into a boundary bucket instead of stretching the whole scale.' },
    { icon: '🔇', title: 'Suppresses Data Noise', text: 'Aggregates near-identical values, smoothing out irrelevant micro-fluctuations.' },
    { icon: '🗂️', title: 'Lowers Categorical Cardinality', text: 'Groups rare or unique values into broader buckets, reducing dimensionality and overfitting risk.' },
    { icon: '👁️', title: 'Boosts Interpretability', text: '"Age 18–25" reads instantly; 24.7321 does not.' },
    { icon: '⚙️', title: 'Optimizes Compute Efficiency', text: 'Pre-organized buckets reduce network shuffles during large-scale join operations.' },
  ],
  dataTypes: 'Bucketizing is almost exclusively used on continuous numerical data — time & age (minutes → "Gen Z / Millennials / Boomers"), money (salary → "Low / Middle / High" income brackets), and physical measurements (temperature → "Freezing / Warm / Hot").',
  algoNote: {
    high: 'Linear Models & Neural Networks — these can only draw straight lines and are blind to curves. Bucketizing forces them to treat ranges independently, unlocking non-linear relationships they would otherwise miss entirely.',
    low: 'Tree-Based Models (Decision Trees, Random Forest, XGBoost) — these already bucket data automatically by searching for the best split points. Pre-bucketizing is usually unnecessary for them, though it can occasionally speed up training.',
  },
}

const CREATE_FEATURE_DESCRIPTION = {
  title: 'Why Create New Features?',
  paragraphs: [
    `Raw columns rarely contain the whole story. Algorithms evaluate features independently unless you explicitly tell them not to — combining two existing columns forces the model to look at their joint effect. Height and Weight in isolation say little about health risk; combined into Body Mass Index, they instantly provide a globally recognized signal no single column could represent alone.`,
    `Combining columns also normalizes scale: comparing countries by raw GDP or Population naturally favors massive nations, but GDP per capita puts every country on a fair baseline regardless of size. And it simplifies structures that are meaningless to a model in raw form — a timestamp like "2026-12-25" says nothing to an algorithm, but extracting Day of the Week or Is_Weekend can expose real weekly or seasonal demand patterns a retail or ride-sharing model depends on.`,
    `Engineered features also fight overfitting: when you hand the model the exact relationship it needs, it doesn't have to guess at noisy patterns in the training data, which helps it generalize to data it has never seen. And in regulated industries like healthcare or finance, a feature built on real-world logic (like Debt-to-Income) is something a human stakeholder can actually audit — a raw coefficient on two unrelated columns is not.`,
  ],
  bullets: [
    { icon: '🔢', title: 'Interaction Features', text: 'Multiply or divide your two most important numerical columns together.' },
    { icon: '📦', title: 'Binning', text: 'Group continuous numbers into buckets — see the Bucketizing tab.' },
    { icon: '🧮', title: 'Aggregations', text: 'Group by a category and summarize — e.g. average salary for a job title.' },
    { icon: '🚩', title: 'Flagging', text: 'Create True/False columns for a threshold — e.g. Is_Overdue if days unpaid > 30.' },
  ],
  dataTypes: 'Most critical for tabular data: dates/times (break "10/24/2026" into Month, Day of Week, Is_Weekend), financial data (turn raw prices into Average Spend Per Month), geographic data (turn lat/long into Distance to Nearest City), and text (Word Count, Sentiment Score).',
  algoNote: {
    high: 'Linear Models (Linear/Logistic Regression) — completely blind to curves. If Feature A × Feature B matters, you must build that interaction column yourself, or the model will never see it.',
    low: 'Tree-Based Models (Random Forest, XGBoost) — great at splitting on raw columns, but they struggle with division. A pre-computed ratio like Debt-to-Income still meaningfully helps them.',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED SMALL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function SectionTag({ label, sub }) {
  const { C } = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: C.primary }}>{label}</span>
      {sub && <span style={{ fontSize: 11, color: C.muted }}>{sub}</span>}
    </div>
  )
}

function Loader({ text }) {
  const { C } = useTheme()
  return (
    <div style={{ textAlign: 'center', padding: '48px 0' }}>
      <div style={{ fontSize: 28, marginBottom: 12, animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚙</div>
      <p style={{ color: C.muted, fontSize: 14 }}>{text}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function ErrBanner({ msg }) {
  const { C } = useTheme()
  return (
    <div style={{ background: C.dangerSoft, border: `1px solid ${C.danger}`, borderRadius: 10, padding: '12px 16px', color: C.danger, fontSize: 13 }}>
      ⚠ {msg}
    </div>
  )
}

// Header: title/subtitle left, two pill tab buttons right — matches
// Cleaning.jsx's PRISMHeader tab-group pattern (the "2 buttons on top right
// like in the cleaning page" the user asked for), just with 2 tabs not 3.
function FEHeader({ activeTab, setActiveTab }) {
  const { C } = useTheme()
  const TABS = [
    { id: 'create',      label: 'Create New Features' },
    { id: 'bucketizing', label: 'Bucketizing' },
  ]
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 100, background: C.white,
      borderBottom: `1px solid ${C.border}`, padding: '14px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 900, color: C.text }}>Feature Engineering</span>
          </div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3, maxWidth: 520 }}>
            Enrich your dataset by grouping continuous values into buckets or combining columns into new features.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: C.light, borderRadius: 10, padding: 4 }}>
          {TABS.map(tab => {
            const active = activeTab === tab.id
            return (
              <div key={tab.id} style={{ textAlign: 'center' }}>
                <button onClick={() => setActiveTab(tab.id)}
                  style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: active ? C.white : 'transparent', color: active ? C.text : C.muted,
                    fontWeight: active ? 700 : 500, fontSize: 13, boxShadow: active ? shadow2 : 'none',
                    display: 'block', width: '100%' }}>
                  {tab.label}
                </button>
                <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>optional</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Sticky wrapper around the shared, accumulating VersionsBar — this page's
// FEHeader above it is itself sticky (top: 0), so the versions bar sticks
// directly beneath it (top: 72) rather than scrolling away, matching this
// page's own layout convention (other pages don't have a sticky header, so
// SharedVersionsBar itself stays non-sticky by default).
function StickyVersionsBar({ versions }) {
  return (
    <div style={{ position: 'sticky', top: 72, zIndex: 99 }}>
      <SharedVersionsBar versions={versions} />
    </div>
  )
}

// Description widget — pulsing "i" button, collapsed by default (mirrors
// Cleaning.jsx's InfoWidget), full unclipped content when expanded, plus a
// data-grounded "Algorithm Fit" callout (the "be creative like the scaling
// page's guidance box" ask) built from the same reference material.
function DescriptionWidget({ content }) {
  const { C } = useTheme()
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
          boxShadow: '0 0 8px rgba(245,158,11,0.35)', animation: 'infoPulse 2s ease-in-out infinite' }}>i</span>
        <span style={{ fontSize: 12, color: '#92400e', fontWeight: 600 }}>{content.title} — click to read</span>
        <style>{`@keyframes infoPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }`}</style>
      </div>
    )
  }
  return (
    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10,
      padding: '16px 20px', marginBottom: 20, position: 'relative' }}>
      <button onClick={() => setOpen(false)}
        style={{ position: 'absolute', top: 12, right: 14, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#92400e' }}>✕</button>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#f59e0b', color: 'white',
          fontWeight: 900, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>i</span>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#78350f' }}>{content.title}</div>
      </div>
      {content.paragraphs.map((p, i) => (
        <p key={i} style={{ fontSize: 13, color: '#92400e', lineHeight: 1.7, margin: '0 0 12px', paddingRight: 10 }}>{p}</p>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10, marginTop: 6, marginBottom: 14 }}>
        {content.bullets.map((b, i) => (
          <div key={i} style={{ background: 'white', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#78350f', marginBottom: 3 }}>{b.icon} {b.title}</div>
            <div style={{ fontSize: 11.5, color: '#92400e', lineHeight: 1.5 }}>{b.text}</div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: '#92400e', lineHeight: 1.6, margin: '0 0 14px', fontStyle: 'italic' }}>
        <strong>What data this suits: </strong>{content.dataTypes}
      </p>
      <div style={{ background: 'white', border: `1px solid ${C.primary}33`, borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: C.primary, marginBottom: 8 }}>ANALYST NOTE — DOES IT DEPEND ON THE ALGORITHM?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: C.success, background: C.successSoft, padding: '2px 8px', borderRadius: 20, flexShrink: 0, marginTop: 1 }}>HIGH BENEFIT</span>
            <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{content.algoNote.high}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: C.muted, background: C.light, padding: '2px 8px', borderRadius: 20, flexShrink: 0, marginTop: 1 }}>LOW BENEFIT</span>
            <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{content.algoNote.low}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Both tabs render this SAME DatasetTable for column selection (Bucketizing
// and Create Features just pass different onColClick/getColState) — so
// capping its body height here fixes "the dataset preview table" in both
// parts with one change. Matches Encoding.jsx's TABLE_BODY_MAX_HEIGHT
// convention exactly (~12-13 rows visible, sticky header, inner vertical
// scroll) so a 50-row profile doesn't push the strategy panel / Apply
// button (Bucketizing) or the Combining panel (Create Features) far down
// the page.
const TABLE_BODY_MAX_HEIGHT = 420

// ─────────────────────────────────────────────────────────────────────────────
// DATASET TABLE — shared by both tabs. Hovering any cell highlights the
// whole column; getColState(col) drives per-tab selection styling (single
// select + "done, banned" for Bucketizing; dual colA/colB select for
// Create Features) without this component knowing which tab is active.
// ─────────────────────────────────────────────────────────────────────────────
function DatasetTable({ cols, rows, getColState, onColClick, hoveredCol, setHoveredCol }) {
  const { C } = useTheme()
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ maxHeight: TABLE_BODY_MAX_HEIGHT, overflowY: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: cols.length * 110 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle(C), width: 36, position: 'sticky', top: 0, zIndex: 2, background: C.light }}>#</th>
              {cols.map(col => {
                const st = getColState(col)
                const hovered = hoveredCol === col.name && !st.selected
                return (
                  <th key={col.name}
                    onMouseEnter={() => setHoveredCol(col.name)}
                    onMouseLeave={() => setHoveredCol(null)}
                    onClick={() => st.clickable && onColClick(col)}
                    title={st.disabledReason}
                    style={{
                      ...thStyle(C),
                      position: 'sticky', top: 0, zIndex: 2,
                      cursor: st.clickable ? 'pointer' : 'default',
                      // Always a fully OPAQUE background — this header is
                      // position:sticky, and the previous alpha-tinted
                      // backgrounds (~10% opacity when selected, ~7% on
                      // hover) let row data scrolling underneath show
                      // through, visually colliding with the column name /
                      // row numbers. The border treatment below already
                      // signals selected/hovered state on its own; the
                      // background no longer needs to carry that too.
                      background: C.light,
                      borderTop: st.selected ? `3px solid ${st.selectColor}` : (hovered ? `2px solid ${C.primary}` : '1px solid transparent'),
                      borderLeft: st.selected ? `3px solid ${st.selectColor}` : undefined,
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span>{col.name}</span>
                      {st.badge && (
                        <span style={{ fontSize: 9, fontWeight: 800, color: C.warning, background: C.warningSoft,
                          padding: '1px 6px', borderRadius: 20, textTransform: 'none', letterSpacing: 0 }}>{st.badge}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 9.5, fontWeight: 600, color: col.inferred_type === 'numeric' ? C.primary : C.warning, textTransform: 'lowercase', marginTop: 2 }}>
                      {col.inferred_type}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                <td style={{ ...tdStyle(C), color: '#94a3b8' }}>{ri + 1}</td>
                {cols.map(col => {
                  const st = getColState(col)
                  const hovered = hoveredCol === col.name && !st.selected
                  return (
                    <td key={col.name}
                      onMouseEnter={() => setHoveredCol(col.name)}
                      onMouseLeave={() => setHoveredCol(null)}
                      style={{ ...tdStyle(C), background: st.selected ? st.selectColor + '10' : (hovered ? 'rgba(99,102,241,0.07)' : 'transparent') }}>
                      {fmtCell(row[col.name])}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
// Functions, not plain objects — used to close over a module-level `const
// C`, which no longer exists now that theme comes from useTheme(); every
// call site passes its own component's local `C` in.
const thStyle = (C) => ({
  padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700,
  color: C.muted, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
})
const tdStyle = (C) => ({
  padding: '7px 12px', fontSize: 12, color: C.text, whiteSpace: 'nowrap',
  borderBottom: `1px solid ${C.border}`,
})

// Diagnostic card — the analyst-pipeline result for whichever column was
// last clicked. Action buttons are informational only on this page (per the
// design spec) — they don't take action, they point back to Cleaning.
function DiagnosticCard({ diagnostic, loading }) {
  const { C } = useTheme()
  if (loading) {
    return (
      <div style={{ background: C.light, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', fontSize: 12.5, color: C.muted }}>
        Analyzing column…
      </div>
    )
  }
  if (!diagnostic) {
    return (
      <div style={{ background: C.light, border: `1px dashed ${C.border}`, borderRadius: 10, padding: '12px 16px', fontSize: 12.5, color: C.muted }}>
        Click any numeric column above to see an analyst-style read on it.
      </div>
    )
  }
  const SEVERITY_STYLE = severityStyle(C)
  const s = SEVERITY_STYLE[diagnostic.severity] || SEVERITY_STYLE.info
  return (
    <div style={{ background: s.soft, borderLeft: `3px solid ${s.color}`, borderRadius: 10, padding: '14px 18px' }}>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 4 }}>{diagnostic.column}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: s.color, marginBottom: 4 }}>{s.icon} {diagnostic.title}</div>
      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{diagnostic.message}</div>
      {diagnostic.actions && diagnostic.actions.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {diagnostic.actions.map(a => (
            <button key={a} title="Return to Cleaning page to apply this fix." disabled
              style={{ padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                background: 'white', border: `1px solid ${C.border}`, color: C.muted, cursor: 'default' }}>
              {a}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Shared redo-confirmation modal
function RedoModal({ title, body, onCancel, onConfirm, working }) {
  const { C } = useTheme()
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 16, padding: 30,
        maxWidth: 420, width: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8, color: C.text }}>{title}</div>
        <p style={{ fontSize: 13, color: C.muted, marginBottom: 20, lineHeight: 1.6 }}>{body}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btn(C.light, C.text, { border: `1px solid ${C.border}` })}>Cancel</button>
          <button onClick={onConfirm} disabled={working} style={btn(C.danger, 'white')}>{working ? 'Working…' : 'Yes, redo'}</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BUCKETIZING TAB
// ─────────────────────────────────────────────────────────────────────────────
function BucketizingContent({ filePath, profile, onApplied, doneBucketCols, setDoneBucketCols, bucketResults, setBucketResults, bucketCol, setBucketCol }) {
  const { C } = useTheme()
  const [strategy, setStrategy] = useState('equal_width')
  const [nBins, setNBins] = useState(5)
  const [customEdges, setCustomEdges] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  const strat = STRATEGIES.find(s => s.value === strategy)
  const colStats = bucketCol ? profile.columns.find(c => c.name === bucketCol)?.stats : null

  // bucketCol is selected by clicking the shared DatasetTable up in the
  // parent (FeatureEngineeringPage) — this effect just reacts to that
  // change locally, resetting the strategy panel for whichever column is
  // now selected, regardless of where the selection came from.
  useEffect(() => {
    setPreview(null); setError(''); setStrategy('equal_width'); setNBins(STRATEGIES[0].defaultN)
  }, [bucketCol])

  const handlePreview = async () => {
    setPreviewLoading(true); setError('')
    try {
      const res = await callFeature('bucketize-preview', {
        file_path: filePath, column: bucketCol, strategy,
        n_bins: strategy === 'custom' ? undefined : nBins,
        custom_edges: strategy === 'custom' ? customEdges : undefined,
      })
      setPreview(res)
    } catch (e) { setError(e.message) }
    finally { setPreviewLoading(false) }
  }

  const handleApply = async () => {
    setApplying(true); setError('')
    try {
      const res = await callFeature('bucketize-apply', {
        file_path: filePath, column: bucketCol, strategy,
        n_bins: strategy === 'custom' ? undefined : nBins,
        custom_edges: strategy === 'custom' ? customEdges : undefined,
      })
      setBucketResults(prev => [...prev, {
        colName: bucketCol, newColName: res.new_col_name, strategy, nBins,
        histogram: preview?.histogram || [], preview: preview?.preview || [],
      }])
      setDoneBucketCols(prev => [...prev, bucketCol])
      await onApplied(res.new_file_path, res.row_count)
      setBucketCol(null); setPreview(null); setStrategy('equal_width'); setNBins(5); setCustomEdges('')
    } catch (e) { setError(e.message) }
    finally { setApplying(false) }
  }

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', marginTop: 18 }}>
      {/* LEFT ~55%: strategy panel + stacking histograms */}
      <div style={{ flex: '1 1 55%', minWidth: 0 }}>
        <SectionTag label="Bucketing Strategy" />
        <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 20px', boxShadow: shadow2 }}>
          {!bucketCol ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: C.muted, fontSize: 13 }}>
              Click a numeric column in the table above to begin.
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.text, textTransform: 'uppercase', letterSpacing: 0.5 }}>{bucketCol}</div>
                {colStats && (
                  <div style={{ display: 'flex', gap: 22, marginTop: 10, flexWrap: 'wrap' }}>
                    {[
                      { label: 'MIN', value: colStats.min },
                      { label: 'MAX', value: colStats.max },
                      { label: 'MEAN', value: colStats.mean },
                    ].map(s => (
                      <div key={s.label} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: C.muted }}>{s.label}</span>
                        <span style={{ fontSize: 18, fontWeight: 800, color: C.primary }}>{fmtCell(s.value)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>Bucketing strategy</label>
              <div style={{ display: 'flex', gap: 8, margin: '6px 0 8px', flexWrap: 'wrap' }}>
                {STRATEGIES.map(s => {
                  const active = strategy === s.value
                  return (
                    <button key={s.value}
                      onClick={() => { setStrategy(s.value); setPreview(null); if (s.defaultN) setNBins(s.defaultN) }}
                      style={{
                        flex: '1 1 100px', padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
                        border: `1.5px solid ${active ? C.primary : C.border}`,
                        background: active ? C.primarySoft : 'white', textAlign: 'left',
                      }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: active ? C.primary : C.text }}>{s.label}</div>
                      <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{s.short}</div>
                    </button>
                  )
                })}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>{strat.hint}</div>

              {strategy !== 'custom' ? (
                <>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>
                    {strategy === 'equal_width' ? 'Number of buckets' : 'Number of quantiles'}
                  </label>
                  <input type="number" min={2} max={strat.max} value={nBins}
                    onChange={e => { setNBins(+e.target.value); setPreview(null) }}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, margin: '4px 0' }} />
                </>
              ) : (
                <>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>Cutoff values (comma-separated)</label>
                  <input type="text" value={customEdges} placeholder="20, 40, 60, 80"
                    onChange={e => { setCustomEdges(e.target.value); setPreview(null) }}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, margin: '4px 0' }} />
                </>
              )}

              {error && <div style={{ marginTop: 10 }}><ErrBanner msg={error} /></div>}

              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button onClick={handlePreview} disabled={previewLoading || (strategy === 'custom' && !customEdges.trim())}
                  style={btn(C.light, C.text, { border: `1px solid ${C.border}`, flex: 1 })}>
                  {previewLoading ? 'Previewing…' : 'Preview Buckets'}
                </button>
                <button onClick={handleApply} disabled={!preview || applying}
                  style={btn(preview ? C.success : C.light, preview ? 'white' : C.muted, { flex: 1, cursor: preview ? 'pointer' : 'not-allowed' })}>
                  {applying ? 'Applying…' : '✓ Apply & Save Version'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Stacking histograms */}
        {bucketResults.length > 0 && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {bucketResults.map((r, i) => (
              <div key={i} style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', boxShadow: shadow2 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 8 }}>
                  {r.newColName} — {STRATEGIES.find(s => s.value === r.strategy)?.label} · {r.histogram.length} buckets
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={r.histogram} margin={{ top: 4, right: 8, left: -12, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 9 }} interval={0}
                      tickFormatter={v => v.length > 12 ? v.slice(0, 10) + '…' : v} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip formatter={(v, n, p) => [`${v} rows`, `Bucket: ${p.payload.bucket}`]} />
                    <Bar dataKey="count" fill="#818cf8" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RIGHT ~40%: modified column preview, compiling as more are applied */}
      <div style={{ flex: '1 1 40%', minWidth: 280 }}>
        <SectionTag label="Modified Column" />
        <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: shadow2 }}>
          {bucketResults.length === 0 && !preview ? (
            <div style={{ textAlign: 'center', padding: '28px 16px', color: C.muted, fontSize: 12.5 }}>
              Run "Preview Buckets" to see results here.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    {bucketResults.map((r, gi) => (
                      <th key={gi} colSpan={2} style={{ ...thStyle(C), textAlign: 'center', borderRight: `2px solid ${C.primary}55` }}>
                        {r.colName} → {r.newColName}
                      </th>
                    ))}
                    {preview && (
                      <th colSpan={2} style={{ ...thStyle(C), textAlign: 'center', color: C.success }}>
                        {bucketCol} → {preview.new_col_name} (pending)
                      </th>
                    )}
                  </tr>
                  <tr>
                    {bucketResults.map((r, gi) => (
                      <Fragment key={gi}>
                        <th style={{ ...thStyle(C), fontSize: 9.5 }}>original</th>
                        <th style={{ ...thStyle(C), fontSize: 9.5, borderRight: `2px solid ${C.primary}55` }}>bucket</th>
                      </Fragment>
                    ))}
                    {preview && <><th style={{ ...thStyle(C), fontSize: 9.5 }}>original</th><th style={{ ...thStyle(C), fontSize: 9.5 }}>bucket</th></>}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 15 }).map((_, ri) => (
                    <tr key={ri} style={{ background: ri % 2 ? C.light : 'white' }}>
                      {bucketResults.map((r, gi) => {
                        const cell = r.preview[ri]
                        return (
                          <Fragment key={gi}>
                            <td style={tdStyle(C)}>{cell ? fmtCell(cell.original) : '—'}</td>
                            <td style={{ ...tdStyle(C), color: C.primary, fontWeight: 600, borderRight: `2px solid ${C.primary}55` }}>{cell ? (cell.bucket || '—') : '—'}</td>
                          </Fragment>
                        )
                      })}
                      {preview && (() => {
                        const cell = preview.preview[ri]
                        return <>
                          <td style={tdStyle(C)}>{cell ? fmtCell(cell.original) : '—'}</td>
                          <td style={{ ...tdStyle(C), color: C.success, fontWeight: 600 }}>{cell ? (cell.bucket || '—') : '—'}</td>
                        </>
                      })()}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE NEW FEATURES TAB
// ─────────────────────────────────────────────────────────────────────────────
function CreateFeaturesContent({ filePath, colA, colB, setColA, setColB, onApplied, createdFeatures, setCreatedFeatures }) {
  const { C } = useTheme()
  const [featureOp, setFeatureOp] = useState('multiply')
  const [customExpr, setCustomExpr] = useState('')
  const [newColName, setNewColName] = useState('')
  const [removeOriginals, setRemoveOriginals] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  const bothSelected = colA && colB
  const autoName = bothSelected ? `${colA}_${featureOp}_${colB}` : ''

  useEffect(() => { setPreview(null) }, [colA, colB, featureOp, customExpr])

  const handlePreview = async () => {
    setPreviewLoading(true); setError('')
    try {
      const res = await callFeature('create-preview', {
        file_path: filePath, col_a: colA, col_b: colB, operation: featureOp,
        custom_expr: featureOp === 'custom' ? customExpr : undefined,
        new_col_name: newColName || undefined,
      })
      setPreview(res)
    } catch (e) { setError(e.message) }
    finally { setPreviewLoading(false) }
  }

  const handleApply = async () => {
    setApplying(true); setError('')
    try {
      const res = await callFeature('create-apply', {
        file_path: filePath, col_a: colA, col_b: colB, operation: featureOp,
        custom_expr: featureOp === 'custom' ? customExpr : undefined,
        new_col_name: newColName || undefined,
        keep_originals: !removeOriginals,
      })
      setCreatedFeatures(prev => [...prev, {
        newColName: res.new_col_name, colA, colB, operation: featureOp,
        preview: (preview?.preview || []).slice(0, 5),
      }])
      await onApplied(res.new_file_path, res.row_count)
      setColA(null); setColB(null); setPreview(null); setCustomExpr(''); setNewColName(''); setRemoveOriginals(false)
    } catch (e) { setError(e.message) }
    finally { setApplying(false) }
  }

  const OPS = ['add', 'subtract', 'multiply', 'divide', 'custom']
  const descMap = bothSelected ? OP_DESC(colA, colB) : {}

  return (
    <div style={{ marginTop: 18 }}>
      {/* New Feature Preview (left) and the Combining controls (right) sit
          in ONE flex row, side by side — flexWrap lets the controls panel
          drop below the preview on narrow screens instead of overflowing. */}
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* New Feature Panel — always visible, compact rather than a tall
            box with empty space when there's nothing to preview yet. */}
        <div style={{ flex: '0 0 260px', minWidth: 220 }}>
          <SectionTag label="New Feature Preview" />
          <div style={{ background: 'white', border: `2px solid ${C.primary}`, borderRadius: 12, padding: 14 }}>
            {!bothSelected ? (
              <div style={{ textAlign: 'center', padding: '12px 0', color: C.muted, fontSize: 12.5 }}>
                Select 2 numeric columns from the table<br /><span style={{ fontSize: 20, color: C.primary }}>⇒</span>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>{colA} {OP_SYMBOL[featureOp]} {colB}</div>
                {!preview ? (
                  <div style={{ fontSize: 12, color: C.muted, padding: '8px 0 2px', textAlign: 'center' }}>
                    Select operation below to preview
                  </div>
                ) : (
                  <>
                    <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 8 }}>
                      {preview.preview.slice(0, 15).map((r, i) => (
                        <div key={i} style={{ padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                          <div style={{ fontSize: 10, color: C.muted }}>{fmtCell(r.col_a)} {OP_SYMBOL[featureOp]} {fmtCell(r.col_b)}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.primary }}>= {fmtCell(r.result)}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`, fontSize: 10.5, color: C.muted, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Min: {fmtCell(preview.stats.min)}</span>
                      <span>Max: {fmtCell(preview.stats.max)}</span>
                      <span>Nulls: {preview.stats.null_count}</span>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Combining controls — directly beside the preview panel, grows to
            fill the rest of the row instead of sitting in a separate block
            underneath (that was the bug: an empty flex:1 spacer here left a
            large blank gap to the right of the preview box). */}
        <div style={{ flex: '1 1 380px', minWidth: 300, background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 20px', boxShadow: shadow2 }}>
        {!bothSelected ? (
          <div style={{ textAlign: 'center', padding: '8px 0', color: C.muted, fontSize: 13 }}>
            Select two numeric columns in the table to begin combining them.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>Combining: {colA} and {colB}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {OPS.map(op => {
                const active = featureOp === op
                return (
                  <button key={op} onClick={() => setFeatureOp(op)}
                    style={{ padding: '10px 16px', borderRadius: 10, border: active ? 'none' : `1px solid ${C.border}`,
                      background: active ? C.primary : 'white', color: active ? 'white' : C.text,
                      fontWeight: 700, fontSize: 13, cursor: 'pointer', textAlign: 'center', minWidth: 90 }}>
                    <div>{OP_SYMBOL[op]} {op[0].toUpperCase() + op.slice(1)}</div>
                    <div style={{ fontSize: 9.5, fontWeight: 500, opacity: 0.85, marginTop: 2 }}>{descMap[op]}</div>
                  </button>
                )
              })}
            </div>

            {featureOp === 'custom' && (
              <div style={{ marginBottom: 12 }}>
                <input type="text" value={customExpr} placeholder={`e.g. ${colA} * 2 + ${colB}`}
                  onChange={e => setCustomExpr(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13 }} />
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>⚠ Only math operators (+−×÷), the two selected column names, and numbers are allowed.</div>
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>Name your new column</label>
              <input type="text" value={newColName} placeholder={autoName}
                onChange={e => setNewColName(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, marginTop: 4 }} />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: C.text, marginBottom: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={removeOriginals} onChange={e => setRemoveOriginals(e.target.checked)} />
              Remove {colA} and {colB} after creating the new feature
              <span style={{ fontSize: 11, color: C.muted }}>— uncheck to keep source columns in the final dataset.</span>
            </label>

            {error && <div style={{ marginBottom: 12 }}><ErrBanner msg={error} /></div>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handlePreview} disabled={previewLoading || (featureOp === 'custom' && !customExpr.trim())}
                style={btn(C.light, C.text, { border: `1px solid ${C.border}`, flex: 1 })}>
                {previewLoading ? 'Previewing…' : 'Preview Feature'}
              </button>
              <button onClick={handleApply} disabled={!preview || applying}
                style={btn(preview ? C.success : C.light, preview ? 'white' : C.muted, { flex: 1, cursor: preview ? 'pointer' : 'not-allowed' })}>
                {applying ? 'Creating…' : '✓ Create & Save Version'}
              </button>
            </div>
          </>
        )}
        </div>
      </div>

      {/* Created features list */}
      {createdFeatures.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {createdFeatures.map((f, i) => (
            <div key={i} style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 18px', boxShadow: shadow2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{f.newColName}</div>
                  <div style={{ fontSize: 11.5, color: C.muted }}>{f.colA} {OP_SYMBOL[f.operation]} {f.colB}</div>
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: C.success, background: C.successSoft, padding: '3px 10px', borderRadius: 20 }}>✓ Saved</span>
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {f.preview.map((r, ri) => (
                  <div key={ri} style={{ fontSize: 10.5, color: C.muted, background: C.light, borderRadius: 6, padding: '4px 8px' }}>
                    {fmtCell(r.col_a)} {OP_SYMBOL[f.operation]} {fmtCell(r.col_b)} = <strong style={{ color: C.primary }}>{fmtCell(r.result)}</strong>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function FeatureEngineeringPage({ projectData, onNext, onUpdateData,
  getDisplayPath, registerVersion, isStepDone, getVersion, resetStep, versions,
  active, onNavigate, furthestOrder }) {
  const { C } = useTheme()

  const [activeTab, setActiveTab] = useState('bucketizing')

  // ONE shared working file + profile for BOTH tabs — see the file-header
  // comment for why this replaced two separately-tracked per-tab files.
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [bucketCol, setBucketCol] = useState(null)
  const [doneBucketCols, setDoneBucketCols] = useState([])
  const [bucketResults, setBucketResults] = useState([])

  const [colA, setColA] = useState(null)
  const [colB, setColB] = useState(null)
  const [createdFeatures, setCreatedFeatures] = useState([])

  const [redoModal, setRedoModal] = useState(false)
  const [redoing, setRedoing] = useState(false)

  const [hoveredCol, setHoveredCol] = useState(null)
  const [diagnostic, setDiagnostic] = useState(null)
  const [diagLoading, setDiagLoading] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const filePath = useMemo(() =>
    (getDisplayPath ? getDisplayPath('feature_engineering') : null) || projectData?.filePath,
  [getDisplayPath, projectData])

  const done = isStepDone ? isStepDone('feature_engineering') : false
  const version = getVersion ? getVersion('feature_engineering') : null

  useEffect(() => {
    if (!filePath) return
    setLoading(true)
    callFeature('profile', { file_path: filePath })
      .then(setProfile).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [filePath])

  const runDiagnostics = useCallback(async (colName) => {
    setDiagLoading(true)
    try {
      const res = await callFeature('diagnostics', {
        file_path: filePath, column: colName, target_column: projectData?.targetColumn || null,
      })
      setDiagnostic({ ...res, column: colName })
    } catch { setDiagnostic(null) }
    finally { setDiagLoading(false) }
  }, [filePath, projectData])

  const handleBucketColClick = (col) => {
    if (col.inferred_type !== 'numeric' || doneBucketCols.includes(col.name)) return
    setBucketCol(col.name)
    runDiagnostics(col.name)
  }
  const handleCreateColClick = (col) => {
    if (col.inferred_type !== 'numeric') return
    if (!colA || colA === col.name) setColA(colA === col.name ? null : col.name)
    else setColB(col.name)
    runDiagnostics(col.name)
  }

  // Called by EITHER tab's Apply — both register into the SAME
  // 'feature_engineering' step under the SAME label, so whichever action ran
  // most recently becomes the one shared version (the label never varies by
  // which tab ran — "Feature Bucketizing" vs "Feature Engineering" used to
  // differ by source action, which read as two different features instead
  // of one shared step), and re-fetching the profile here (not per-tab)
  // means the OTHER tab picks up the change the moment it's opened.
  const handleApplied = useCallback(async (newFilePath, rowCount) => {
    if (registerVersion) await registerVersion('feature_engineering', newFilePath, 'Feature Engineering', rowCount)
    if (onUpdateData) onUpdateData({ cleanedFilePath: newFilePath })
    const fresh = await callFeature('profile', { file_path: newFilePath })
    setProfile(fresh)
  }, [registerVersion, onUpdateData])

  // ONE combined Redo — reverts the single shared version, so it has to
  // clear both tabs' local state (a bucketized column and a created
  // feature can each depend on the other if they were interleaved, so
  // there's no such thing as "redo just bucketizing" once they share a file).
  const handleRedo = async () => {
    setRedoing(true)
    try {
      if (resetStep) await resetStep('feature_engineering')
      setBucketCol(null); setDoneBucketCols([]); setBucketResults([])
      setColA(null); setColB(null); setCreatedFeatures([])
      setRedoModal(false)
    } finally { setRedoing(false) }
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' }}>
      <TopNav active={active || 'feature_engineering'} onNavigate={onNavigate} furthestOrder={furthestOrder} taskType={projectData?.taskType} />
      <FEHeader activeTab={activeTab} setActiveTab={setActiveTab} />
      <StickyVersionsBar versions={versions} />

      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '20px 24px 60px' }}>
        {!dismissed && (
          <div style={{ background: C.primarySoft, border: `1px solid ${C.primary}33`, borderRadius: 10,
            padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 12.5, color: C.text }}>
              <strong>ℹ Both parts are optional.</strong> Apply Bucketizing, Create Features, both, or neither — whatever you skip simply carries the dataset forward unchanged. Switching tabs never loses work — both share the same evolving dataset.
            </div>
            <button onClick={() => setDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.primary, fontWeight: 700, fontSize: 12.5, marginLeft: 16 }}>Got it</button>
          </div>
        )}

        <DescriptionWidget content={activeTab === 'bucketizing' ? BUCKETIZING_DESCRIPTION : CREATE_FEATURE_DESCRIPTION} />

        {loading ? <Loader text="Loading dataset…" /> :
         error ? <ErrBanner msg={error} /> :
         profile && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <SectionTag label="Dataset Preview" sub={`${profile.row_count.toLocaleString()} rows · ${profile.col_count} columns`} />
              {done && (
                <button onClick={() => setRedoModal(true)} style={btn(C.dangerSoft, C.danger, { fontSize: 11, padding: '6px 12px', border: `1px solid ${C.danger}` })}>↺ Redo Feature Engineering</button>
              )}
            </div>
            <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: shadow2 }}>
              <DatasetTable
                cols={profile.columns} rows={profile.display_rows}
                hoveredCol={hoveredCol} setHoveredCol={setHoveredCol}
                onColClick={activeTab === 'bucketizing' ? handleBucketColClick : handleCreateColClick}
                getColState={activeTab === 'bucketizing' ? (col) => {
                  const bucketedAlready = doneBucketCols.includes(col.name)
                  return {
                    clickable: col.inferred_type === 'numeric' && !bucketedAlready,
                    selected: bucketCol === col.name,
                    selectColor: C.primary,
                    badge: bucketedAlready ? '✓ bucketed' : null,
                    disabledReason: bucketedAlready ? 'Already bucketized this session — redo to change it' : undefined,
                  }
                } : (col) => {
                  const isA = colA === col.name, isB = colB === col.name
                  return {
                    clickable: col.inferred_type === 'numeric',
                    selected: isA || isB,
                    selectColor: isA ? C.green : C.blue,
                    badge: isA ? 'A' : (isB ? 'B' : null),
                  }
                }}
              />
            </div>
            <div style={{ marginTop: 14 }}>
              <SectionTag label="Column Analysis" sub="click a numeric column above" />
              <DiagnosticCard diagnostic={diagnostic} loading={diagLoading} />
            </div>

            {activeTab === 'bucketizing' ? (
              <BucketizingContent
                filePath={filePath} profile={profile} onApplied={handleApplied}
                doneBucketCols={doneBucketCols} setDoneBucketCols={setDoneBucketCols}
                bucketResults={bucketResults} setBucketResults={setBucketResults}
                bucketCol={bucketCol} setBucketCol={setBucketCol}
              />
            ) : (
              <CreateFeaturesContent
                filePath={filePath} colA={colA} colB={colB} setColA={setColA} setColB={setColB}
                onApplied={handleApplied} createdFeatures={createdFeatures} setCreatedFeatures={setCreatedFeatures}
              />
            )}
          </>
        )}
      </div>

      {redoModal && (
        <RedoModal title="Redo Feature Engineering?"
          body="This removes every bucketized column and every created feature from this step, reverting to the dataset as it was before Feature Engineering — including deleting the current Feature Engineering version. You'll start again from scratch in both tabs."
          onCancel={() => setRedoModal(false)} onConfirm={handleRedo} working={redoing} />
      )}
    </div>
  )
}
