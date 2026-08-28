/**
 * PRISM — Learning Curve Page
 *
 * Layout follows the user's own hand-drawn mockup exactly: 4 metric tabs
 * above the chart, a 60/38 two-column split (chart | description), a
 * full-width Suggestions section with "Return to Sampling/Training"
 * buttons, then the page's own forward button at the bottom. No dataset
 * version is produced here — pure analysis of the model trained on Train
 * and Test, exactly like the Feature Importance page before it.
 *
 * Design: shares the app-wide theme system (../theme.jsx) — same C tokens,
 * shadow/ChartCard/InfoIcon conventions established in TrainTest.jsx /
 * FeatureImportance.jsx. No hardcoded palette of its own (a pasted first
 * draft of this page invented its own indigo palette from scratch — not
 * used, see memory: theme system discipline).
 */
import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, Brush, ResponsiveContainer,
} from 'recharts'
import { useTheme } from '../theme'
import TopNav from '../components/TopNav'
import VersionsBar from '../components/VersionsBar'

const shadow  = '0 4px 24px rgba(0,0,0,0.07)'
const shadow2 = '0 2px 8px rgba(0,0,0,0.05)'
const cardR   = 14

// 127.0.0.1, not "localhost" — this machine resolves "localhost" to both
// ::1 and 127.0.0.1, and the FastAPI dev server only binds IPv4.
const ML_API = 'http://127.0.0.1:8001'

const callLC = async (body) => {
  const res = await fetch(`${ML_API}/learning-curve/compute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || `Error ${res.status}`) }
  return res.json()
}

const hexToRgba = (hex, alpha) => {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ─────────────────────────────────────────────────────────────────────────────
// INFO ICON — same click-to-open ⓘ popover pattern as TrainTest.jsx / FeatureImportance.jsx.
// ─────────────────────────────────────────────────────────────────────────────
// Two content modes (same convention as TrainTest.jsx's InfoIcon):
// `content` (plain pre-line string) for a short paragraph or two, or
// `items` (array of {label, desc}, plus optional `itemsTitle`/`footer`)
// for a wider, bold-labeled multi-column popover — used for every
// explanation on this page now, since a single undifferentiated paragraph
// reads as one flat wall of text no matter how it's organized internally.
const InfoIcon = ({ content, items, itemsTitle, footer, width = 320 }) => {
  const { C } = useTheme()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const popupRef = useRef(null)
  const isWide = !!items
  const popupW = isWide ? 560 : width

  // Clamping `left` against a known fixed width is easy, but clamping `top`
  // needs the popup's actual rendered HEIGHT (content-driven, unknown until
  // it renders) - this measures the just-mounted popup via popupRef and
  // corrects `top` before the browser paints (useLayoutEffect runs
  // synchronously pre-paint, so there's no visible flicker), instead of
  // letting a tall popup clip past the viewport bottom or forcing internal
  // scroll. Old version was `position:'absolute', left:22, top:-6` with no
  // clamping at all, which clipped/forced a page-level horizontal scrollbar
  // whenever the icon sat near a panel's right edge.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    // Measure the popup's REAL rendered box, not the declared width -
    // these divs use default content-box sizing, so padding/border add on
    // top of it. offsetWidth/offsetHeight report the true box.
    const w = popupRef.current?.offsetWidth || popupW
    const h = popupRef.current?.offsetHeight || 0
    const left = Math.max(12, Math.min(r.right + 8, window.innerWidth - w - 12))
    const top  = Math.max(12, Math.min(r.top - 6, window.innerHeight - h - 12))
    setPos({ left, top })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <span style={{ position: 'relative', display: 'inline-block', verticalAlign: 'middle' }}>
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
              padding: '16px 20px', width: 560, maxWidth: 'calc(100vw - 24px)',
              maxHeight: 'calc(100vh - 24px)', overflowY: 'auto', boxShadow: shadow,
              fontSize: 12, color: C.text,
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
              padding: '14px 16px', width, maxWidth: 'calc(100vw - 24px)',
              maxHeight: 'calc(100vh - 24px)', overflowY: 'auto', boxShadow: shadow, fontSize: 12,
              color: C.text, lineHeight: 1.7, whiteSpace: 'pre-line',
            }}>
              {content}
            </div>
          )}
        </>
      )}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// METRIC TAB BUTTON
// ─────────────────────────────────────────────────────────────────────────────
const MetricTab = ({ label, active, onClick, disabled }) => {
  const { C } = useTheme()
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '7px 17px', borderRadius: 8, fontWeight: active ? 700 : 500, fontSize: 12.5,
      cursor: disabled ? 'default' : 'pointer', transition: 'all 0.15s',
      background: active ? C.primary : C.card,
      color: active ? 'white' : disabled ? C.muted : C.text,
      boxShadow: active ? `0 4px 14px ${C.primary}44` : shadow2,
      opacity: disabled ? 0.4 : 1,
      border: active ? 'none' : `1px solid ${C.border}`,
    }}>{label}</button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM TOOLTIP — training size, both scores, and the generalization gap
// for that exact point, per the user's "hover shows exact coordinates" spec.
// ─────────────────────────────────────────────────────────────────────────────
const LCTooltip = ({ active, payload, label, C, metricLabel }) => {
  if (!active || !payload?.length) return null
  const train = payload.find(p => p.dataKey?.includes('train'))?.value
  const val   = payload.find(p => p.dataKey?.includes('val'))?.value
  const gap   = (train != null && val != null) ? Math.abs(train - val) : null
  // `label` is the percentage (the axis's own dataKey); the absolute
  // sample count for the SAME point rides along on the hovered payload's
  // own data object regardless of which line (train/val) triggered it.
  const absSize = payload[0]?.payload?.training_size

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '10px 14px', boxShadow: shadow, minWidth: 200 }}>
      <div style={{ fontWeight: 700, fontSize: 12, color: C.text, marginBottom: 8 }}>
        Training Size: {Number(label).toFixed(1)}%{absSize != null ? ` (${absSize.toLocaleString()} samples)` : ''}
      </div>
      {train != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 12 }}>
          <div style={{ width: 10, height: 3, background: C.primary, borderRadius: 2 }} />
          <span style={{ color: C.muted }}>Training {metricLabel}:</span>
          <span style={{ fontWeight: 700, color: C.primary }}>{train.toFixed(4)}</span>
        </div>
      )}
      {val != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 12 }}>
          <div style={{ width: 10, height: 3, background: C.warning, borderRadius: 2 }} />
          <span style={{ color: C.muted }}>Validation {metricLabel}:</span>
          <span style={{ fontWeight: 700, color: C.warning }}>{val.toFixed(4)}</span>
        </div>
      )}
      {gap != null && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${C.border}`, fontSize: 11, color: C.muted }}>
          Generalization Gap:
          <span style={{ fontWeight: 700, marginLeft: 6,
            color: gap > 0.1 ? C.danger : gap > 0.05 ? C.warning : C.success }}>{gap.toFixed(4)}</span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SUGGESTION SECTION
// ─────────────────────────────────────────────────────────────────────────────
const SuggestionSection = ({ suggestion, onGoToSampling, onGoToTraining }) => {
  const { C } = useTheme()
  if (!suggestion) return null
  const SEVERITY = {
    success: { bg: C.successSoft, border: `${C.success}40`, title: C.success },
    warning: { bg: C.warningSoft, border: `${C.warning}40`, title: C.warning },
    danger:  { bg: C.dangerSoft,  border: `${C.danger}40`,  title: C.danger },
    info:    { bg: C.primarySoft, border: `${C.primary}40`, title: C.primary },
  }
  const sev = SEVERITY[suggestion.severity] || SEVERITY.info
  const showSampling = suggestion.target === 'sampling'
  const showTraining = suggestion.target === 'training'

  return (
    <div style={{ background: sev.bg, border: `1px solid ${sev.border}`, borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: sev.title, marginBottom: 10 }}>{suggestion.title}</div>
          <p style={{ fontSize: 13, color: C.text, lineHeight: 1.7, margin: 0, marginBottom: 10 }}>{suggestion.message}</p>
          <div style={{ padding: '10px 14px', background: C.faint, borderRadius: 8, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
            <strong style={{ color: C.text }}>Why this matters: </strong>{suggestion.why}
          </div>
        </div>
        {(showSampling || showTraining) && (
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {showSampling && (
              <button onClick={onGoToSampling} style={{
                padding: '10px 18px', borderRadius: 10, border: 'none', background: C.warning,
                color: 'white', fontWeight: 800, fontSize: 13, cursor: 'pointer',
                boxShadow: `0 4px 16px ${C.warning}44`, whiteSpace: 'nowrap',
              }}>← Return to Sampling Page</button>
            )}
            {showTraining && (
              <button onClick={onGoToTraining} style={{
                padding: '10px 18px', borderRadius: 10, border: 'none', background: C.primary,
                color: 'white', fontWeight: 800, fontSize: 13, cursor: 'pointer',
                boxShadow: `0 4px 16px ${C.primary}44`, whiteSpace: 'nowrap',
              }}>← Return to Training Page</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// INFO ICON CONTENT
// ─────────────────────────────────────────────────────────────────────────────
const INFO_LC = {
  itemsTitle: 'Learning Curve',
  footer: 'The vertical dashed line marks the Optimal Data Threshold — where validation performance plateaued. More data beyond this point is unlikely to help.',
  items: [
    { label: 'What It Answers', desc: 'A learning curve answers one question: "Does my model get better if I give it more training data?"' },
    { label: 'Training Curve (teal)', desc: 'Shows how well the model fits its own training data. It usually starts high and can dip slightly as more data is added — it gets harder to perfectly fit a bigger set.' },
    { label: 'Validation Curve (amber)', desc: 'Shows how well the model generalizes to unseen data. It usually starts low (too little data to generalize from) and rises as more data is added.' },
    { label: 'Reading the Gap', desc: 'Narrow gap + both high → Good fit (ideal).\nWide gap, training high, validation low → Overfitting.\nNarrow gap + both low → Underfitting.\nBoth still rising at the rightmost point → Model needs more data.' },
  ],
}

const INFO_GAP = {
  itemsTitle: 'The Generalization Gap',
  items: [
    { label: 'What It Is', desc: 'The shaded region between the Training and Validation curves is the Generalization Gap.' },
    { label: 'Small Gap, Both High', desc: 'The model generalizes well — the target state.' },
    { label: 'Wide Gap, Training >> Validation', desc: 'Overfitting — the model memorized training data and struggles on new examples.' },
    { label: 'Gap Stays Wide at Large Sizes', desc: 'More data will only partially help — the model itself may be too complex.' },
    { label: 'Gap Narrows as Size Increases', desc: 'The overfitting is data-related — more data (or oversampling) would help.' },
    { label: 'Both Low, Small Gap', desc: 'Underfitting — the model is too simple to learn the pattern at all.' },
  ],
}

const INFO_OPTIMAL = {
  itemsTitle: 'Optimal Data Threshold',
  items: [
    { label: 'What The Line Marks', desc: 'The vertical dashed line marks the training size where validation performance stopped improving meaningfully (less than 0.3% per step).' },
    { label: 'Beyond This Point', desc: 'More training data brings diminishing returns — the model has learned what it can from this architecture.' },
    { label: 'If Threshold Is Well Below Full Size', desc: 'You likely have more data than the model benefits from — undersampling could save computation time without hurting accuracy.' },
    { label: 'If Threshold Is At/Beyond Full Size', desc: 'The model is still improving. More data would help — consider oversampling or collecting more real data.' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function LearningCurvePage({
  projectData, modelPklPath, onNext, onGoTo,
  getDisplayPath, versions, active, onNavigate, furthestOrder,
}) {
  const { C } = useTheme()
  const [data,      setData]     = useState(null)
  const [loading,   setLoading]  = useState(false)
  const [error,     setError]    = useState('')
  const [metric,    setMetric]   = useState('accuracy')

  const filePath = getDisplayPath ? getDisplayPath('learning_curve') : projectData?.filePath

  useEffect(() => {
    if (!filePath || !modelPklPath) return
    setLoading(true); setError('')
    callLC({
      file_path: filePath, target_column: projectData?.targetColumn || '',
      model_pkl_path: modelPklPath, task_type: projectData?.taskType || 'classification',
      train_ratio: projectData?.trainRatio || 0.80, cv_folds: 3, n_sizes: 8, stratified: true,
    })
      .then(d => { setData(d); setMetric(d.primary_metric || 'accuracy') })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [filePath, modelPklPath])

  const isRegression = data?.task_type === 'regression'
  // Real bug fixed from the first pasted draft: it hardcoded the 4
  // classification tab labels regardless of task type, so a regression
  // model (whose curves are keyed "r2"/"mae", not "accuracy"/"f1"/...)
  // showed every tab permanently disabled and "No data for this metric"
  // forever. Tabs now switch with the model's real task type.
  const METRIC_SET = isRegression ? ['r2', 'mae'] : ['accuracy', 'f1', 'precision', 'recall']
  const METRIC_LABELS = { accuracy: 'Accuracy', f1: 'F1-Score', precision: 'Precision', recall: 'Recall', r2: 'R²', mae: 'MAE' }

  const availableMetrics = useMemo(() => {
    if (!data) return []
    return Object.keys(data.curves).filter(k => !data.curves[k].error)
  }, [data])

  const chartData = useMemo(() => {
    if (!data || !data.curves[metric] || data.curves[metric].error) return []
    const c = data.curves[metric]
    return c.training_sizes.map((size, i) => ({
      training_size: size,
      training_pct: c.training_pct?.[i],
      train_mean: c.train_mean[i], val_mean: c.val_mean[i],
      gap_low:  Math.min(c.train_mean[i] ?? 0, c.val_mean[i] ?? 0),
      gap_size: Math.abs((c.train_mean[i] ?? 0) - (c.val_mean[i] ?? 0)),
    }))
  }, [data, metric])

  const optimalSize  = data?.optimal_size
  const optimalPct   = data?.optimal_pct
  const pattern       = data?.pattern
  const PATTERN_META = {
    good_fit:        { label: '✓ Good Fit',        color: C.success, bg: C.successSoft },
    overfitting:     { label: '⚠ Overfitting',      color: C.warning, bg: C.warningSoft },
    underfitting:    { label: '⚠ Underfitting',     color: C.danger,  bg: C.dangerSoft },
    needs_more_data: { label: '↗ Needs More Data',  color: C.primary, bg: C.primarySoft },
    unknown:         { label: '? Unknown',          color: C.muted,   bg: C.faint },
  }
  const patternMeta   = PATTERN_META[pattern?.type || 'unknown']
  const descriptions  = data?.descriptions || {}
  const metricLabel   = METRIC_LABELS[metric] || metric

  return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <TopNav active={active || 'learning_curve'} onNavigate={onNavigate} furthestOrder={furthestOrder} taskType={projectData?.taskType} />
      <VersionsBar versions={versions} />
      <div style={{ padding: '4px 32px 0', fontSize: 11, color: C.muted }}>
        📌 Analysis only — no new dataset version is created on this page. It reads the model trained on
        Train and Test; use the nav above to go back there, or to Sampling, at any time.
      </div>

      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '18px 32px', marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 900, color: C.text, marginBottom: 3 }}>Learning Curve</h1>
            <p style={{ fontSize: 12.5, color: C.muted }}>
              How model performance scales with training data size — reveals overfitting, underfitting, and data needs.
            </p>
          </div>
          {data && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: patternMeta.bg, color: patternMeta.color }}>
                {patternMeta.label}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: C.faint, color: C.muted }}>
                Model: {data.model_name}
              </span>
              <span style={{ fontSize: 11, color: C.muted }}>
                Optimal threshold: {optimalSize?.toLocaleString()} of {data.n_total?.toLocaleString()} samples
              </span>
            </div>
          )}
        </div>
      </div>

      {!modelPklPath && (
        <div style={{ textAlign: 'center', padding: '90px 0', color: C.muted }}>
          <div style={{ fontSize: 38, marginBottom: 14 }}>📉</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: C.text, marginBottom: 6 }}>No trained model found</div>
          <div style={{ fontSize: 13, marginBottom: 20 }}>Train a model on the Train and Test page first — Learning Curve analyzes whichever model you trained most recently.</div>
          <button onClick={() => onGoTo && onGoTo('training')}
            style={{ padding: '10px 22px', borderRadius: 10, border: 'none', background: C.primary,
              color: 'white', fontWeight: 800, fontSize: 13, cursor: 'pointer', boxShadow: `0 4px 16px ${C.primary}44` }}>
            ← Go to Train and Test
          </button>
        </div>
      )}

      {modelPklPath && loading && (
        <div style={{ textAlign: 'center', padding: '90px 0', color: C.muted }}>
          <div style={{ fontSize: 26, marginBottom: 12, display: 'inline-block', animation: 'lc-spin 1s linear infinite' }}>◐</div>
          <p>Computing learning curves — training the model at multiple sizes…</p>
          <p style={{ fontSize: 12, color: C.muted }}>This can take 10–60 seconds depending on the model and dataset size.</p>
          <style>{`@keyframes lc-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {modelPklPath && !loading && error && (
        <div style={{ background: C.dangerSoft, border: `1px solid ${C.danger}`, borderRadius: 12,
          padding: 20, color: C.danger, margin: '24px 32px', fontSize: 13 }}>
          ⚠ {error}
          {error.toLowerCase().includes('clustering') && (
            <button onClick={() => onGoTo && onGoTo('training')}
              style={{ display: 'block', marginTop: 12, padding: '8px 16px', borderRadius: 8, border: 'none',
                background: C.primary, color: 'white', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
              ← Go to Train and Test
            </button>
          )}
        </div>
      )}

      {modelPklPath && !loading && !error && data && (
        <div style={{ padding: '24px 32px 0' }}>

          {/* ── Metric tabs (above chart) ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {METRIC_SET.map(m => (
                <MetricTab key={m} label={METRIC_LABELS[m] || m} active={metric === m}
                  disabled={!availableMetrics.includes(m)} onClick={() => setMetric(m)} />
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <InfoIcon {...INFO_LC} width={340} />
          </div>

          {/* ── MAIN TWO-COLUMN LAYOUT (60/38-ish, via fr units) ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 20, marginBottom: 20 }}>

            {/* ── LEFT: Learning Curve Chart ── */}
            <div style={{ background: C.card, borderRadius: cardR, padding: '18px 16px', boxShadow: shadow2,
              border: `1px solid ${C.border}`, minWidth: 0 }}>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{metricLabel} vs. Training Set Size</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2, display: 'flex', alignItems: 'center' }}>
                    {descriptions.metrics?.[metric] || ''}
                    <InfoIcon {...INFO_GAP} width={300} />
                  </div>
                </div>
                <span style={{ fontSize: 10, color: C.muted, whiteSpace: 'nowrap' }}>Drag below to zoom</span>
              </div>

              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={340}>
                  <ComposedChart data={chartData} margin={{ top: 12, right: 24, bottom: 30, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} opacity={0.5} vertical={false} />
                    {/* Percentage of the available training data, not raw
                        sample count - a fixed 0-100 domain only makes sense
                        as a percentage (dataset-size-independent); absolute
                        sample counts can't universally span "0 to 100" at
                        all (a large dataset would run into the thousands).
                        domain={[0,100]} pins the axis to the full range
                        regardless of where the first/last real data point
                        falls, so the curve always starts right at the
                        y-axis and reaches the right edge. */}
                    <XAxis dataKey="training_pct" type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: C.muted }}
                      tickFormatter={v => `${v}%`}
                      label={{ value: 'Training Set Size (% of available data)', position: 'insideBottom', offset: -18, fontSize: 11, fill: C.muted }} />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: C.muted }}
                      tickFormatter={v => v.toFixed(2)}
                      label={{ value: metricLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: C.muted, dx: 12 }} />

                    {/* Generalization-gap shading: a transparent base Area
                        up to the lower line, then a visible Area stacked on
                        top spanning exactly the gap between the two lines —
                        the standard trick for shading "between two lines"
                        with plain stacked Areas instead of custom SVG. */}
                    <Area dataKey="gap_low" stackId="gap" fill="transparent" stroke="none" legendType="none" activeDot={false} isAnimationActive={false} />
                    <Area dataKey="gap_size" stackId="gap" fill={hexToRgba(C.warning, 0.16)} stroke="none"
                      name="Generalization Gap" activeDot={false} legendType="square" isAnimationActive={false} />

                    <Line type="monotone" dataKey="train_mean" stroke={C.primary} strokeWidth={2.5}
                      dot={{ r: 3, fill: C.primary, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 0 }} name="Training" isAnimationActive={false} />
                    <Line type="monotone" dataKey="val_mean" stroke={C.warning} strokeWidth={2.5}
                      dot={{ r: 3, fill: C.warning, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 0 }} name="Validation" isAnimationActive={false} />

                    {optimalPct != null && (
                      <ReferenceLine x={optimalPct} stroke={C.muted} strokeDasharray="6,4" strokeWidth={1.5}
                        label={{ value: 'Optimal Threshold', position: 'insideTopLeft', fontSize: 9, fill: C.muted, dy: -4 }} />
                    )}

                    <Tooltip content={<LCTooltip C={C} metricLabel={metricLabel} />} />
                    <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 11, paddingBottom: 6 }}
                      formatter={val => <span style={{ color: C.muted }}>{val}</span>} />
                    <Brush dataKey="training_pct" height={22} stroke={C.border} fill={C.faint} travellerWidth={6}
                      tickFormatter={v => `${v}%`} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted, fontSize: 12.5 }}>
                  {data?.curves?.[metric]?.error ? `⚠ ${data.curves[metric].error}` : 'No data for this metric.'}
                </div>
              )}

              {pattern && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 22, marginTop: 10, flexWrap: 'wrap' }}>
                  <LegendDot color={C.primary} label="Training Curve" C={C} />
                  <LegendDot color={C.warning} label="Validation Curve" C={C} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <div style={{ width: 16, height: 12, background: hexToRgba(C.warning, 0.2), borderRadius: 3, border: `1px solid ${C.warning}55` }} />
                    <span style={{ color: C.muted }}>Generalization Gap</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <span style={{ color: C.muted, letterSpacing: 2 }}>- - -</span>
                    <span style={{ color: C.muted }}>Optimal Threshold</span>
                    <InfoIcon {...INFO_OPTIMAL} width={280} />
                  </div>
                </div>
              )}
            </div>

            {/* ── RIGHT: Description Card ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              {pattern && (
                <div style={{ background: patternMeta.bg, borderRadius: 12, padding: '14px 16px', border: `1px solid ${patternMeta.color}33` }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: patternMeta.color, marginBottom: 8 }}>{patternMeta.label}</div>
                  <div style={{ display: 'flex', gap: 14, fontSize: 11, color: C.muted, flexWrap: 'wrap' }}>
                    <div><span style={{ fontWeight: 600 }}>Final Training: </span><span style={{ color: C.primary, fontWeight: 700 }}>{pattern.final_train?.toFixed(4)}</span></div>
                    <div><span style={{ fontWeight: 600 }}>Final Validation: </span><span style={{ color: C.warning, fontWeight: 700 }}>{pattern.final_val?.toFixed(4)}</span></div>
                    <div><span style={{ fontWeight: 600 }}>Gap: </span><span style={{ color: pattern.gap > 0.1 ? C.danger : C.success, fontWeight: 700 }}>{pattern.gap?.toFixed(4)}</span></div>
                  </div>
                </div>
              )}

              <div style={{ background: C.card, borderRadius: cardR, padding: '18px 18px', boxShadow: shadow2,
                border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.primary}`, flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: C.primary, marginBottom: 10 }}>
                  What the learning curve shows
                </div>
                <p style={{ fontSize: 12.5, color: C.text, lineHeight: 1.75, margin: 0 }}>{descriptions.general || ''}</p>
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${C.border}` }}>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: '#8b5cf6', marginBottom: 8 }}>
                    What to conclude from this dataset
                  </div>
                  <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.75, margin: 0 }}>{descriptions.insight || ''}</p>
                </div>
                {descriptions.metrics?.[metric] && (
                  <div style={{ marginTop: 12, padding: '8px 12px', background: C.faint, borderRadius: 8, fontSize: 11, color: C.muted }}>
                    ⓘ {descriptions.metrics[metric]}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── SUGGESTION SECTION (full width) ── */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>Learning Curve Diagnosis &amp; Suggestions</span>
            </div>
            <SuggestionSection suggestion={data?.suggestion}
              onGoToSampling={() => onGoTo && onGoTo('sampling')}
              onGoToTraining={() => onGoTo && onGoTo('training')} />
          </div>

          {/* Forward-navigation button always at the page's own bottom
              (standing platform rule). */}
          <div style={{ textAlign: 'center', padding: '4px 0 34px' }}>
            <button onClick={() => onNext && onNext('report', {})}
              style={{ padding: '11px 28px', borderRadius: 10, border: 'none', background: C.primary,
                color: 'white', fontWeight: 800, fontSize: 14, cursor: 'pointer', boxShadow: `0 6px 20px ${C.primary}44` }}>
              Next Page →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const LegendDot = ({ color, label, C }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
    <div style={{ width: 22, height: 3, background: color, borderRadius: 2 }} />
    <span style={{ color: C.muted }}>{label}</span>
  </div>
)
