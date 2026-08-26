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
import { useState, useEffect, useMemo } from 'react'
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
const InfoIcon = ({ content, width = 320 }) => {
  const { C } = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block', verticalAlign: 'middle' }}>
      <button onClick={() => setOpen(o => !o)} title="Learn more"
        style={{
          width: 17, height: 17, borderRadius: '50%', border: `1.5px solid ${C.primary}`,
          background: open ? C.primary : 'transparent', color: open ? 'white' : C.primary,
          fontSize: 10, fontWeight: 900, cursor: 'pointer', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', marginLeft: 6, flexShrink: 0, padding: 0,
        }}>ⓘ</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
          <div style={{
            position: 'absolute', left: 22, top: -6, zIndex: 999,
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: '14px 16px', width, boxShadow: shadow, fontSize: 12,
            color: C.text, lineHeight: 1.7, whiteSpace: 'pre-line',
          }}>
            {content}
          </div>
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

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '10px 14px', boxShadow: shadow, minWidth: 200 }}>
      <div style={{ fontWeight: 700, fontSize: 12, color: C.text, marginBottom: 8 }}>
        Training Size: {Number(label).toLocaleString()} samples
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
const INFO_LC = `Learning Curve

A learning curve answers one question: "Does my model get better if I give it more training data?"

The Training Curve (teal) shows how well the model fits its own training data. It usually starts high and can dip slightly as more data is added — it gets harder to perfectly fit a bigger set.

The Validation Curve (amber) shows how well the model generalizes to unseen data. It usually starts low (too little data to generalize from) and rises as more data is added.

The shaded Generalization Gap between the curves is the health indicator:
• Narrow gap + both high → Good fit (ideal)
• Wide gap, training high, validation low → Overfitting
• Narrow gap + both low → Underfitting
• Both still rising at the rightmost point → Model needs more data

The vertical dashed line marks the Optimal Data Threshold — where validation performance plateaued. More data beyond this point is unlikely to help.`

const INFO_SMOOTH = `EMA Smoothing (Exponential Moving Average)

Raw learning curves from cross-validation folds often have small random fluctuations that make the real trend harder to read.

EMA smoothing applies a filter that weights recent points more heavily while preserving the overall direction.

Formula: Smoothed[i] = α × Raw[i] + (1 − α) × Smoothed[i−1]

With α = 0.35 (PRISM's default): each point is 35% its actual value, 65% the previous smoothed value.

Toggle ON to see the trend clearly. Toggle OFF to see the exact raw computed values.`

const INFO_GAP = `The Generalization Gap

The shaded region between the Training and Validation curves is the Generalization Gap.

Small gap, both high: the model generalizes well — the target state.

Wide gap, training much higher than validation: overfitting — the model memorized training data and struggles on new examples.

Gap stays wide even at large training sizes: more data will only partially help — the model itself may be too complex.

Gap narrows as training size increases: the overfitting is data-related — more data (or oversampling) would help.

Both lines low with a small gap: underfitting — the model is too simple to learn the pattern at all.`

const INFO_OPTIMAL = `Optimal Data Threshold

The vertical dashed line marks the training size where validation performance stopped improving meaningfully (less than 0.3% per step).

Beyond this point, more training data brings diminishing returns — the model has learned what it can from this architecture.

If the threshold sits well below your full training size: you likely have more data than the model benefits from — undersampling could save computation time without hurting accuracy.

If the threshold sits at or beyond your full training size: the model is still improving. More data would help — consider oversampling or collecting more real data.`

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
  const [smoothing, setSmoothing] = useState(false)

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
      train_mean: c.train_mean[i], val_mean: c.val_mean[i],
      train_smooth: c.train_smooth?.[i], val_smooth: c.val_smooth?.[i],
      gap_low:  Math.min(c.train_mean[i] ?? 0, c.val_mean[i] ?? 0),
      gap_size: Math.abs((c.train_mean[i] ?? 0) - (c.val_mean[i] ?? 0)),
    }))
  }, [data, metric])

  const optimalSize  = data?.optimal_size
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
      <TopNav active={active || 'learning_curve'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
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

          {/* ── Metric tabs + Smoothing toggle (above chart) ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {METRIC_SET.map(m => (
                <MetricTab key={m} label={METRIC_LABELS[m] || m} active={metric === m}
                  disabled={!availableMetrics.includes(m)} onClick={() => setMetric(m)} />
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <div onClick={() => setSmoothing(s => !s)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px',
                background: C.card, borderRadius: 20, border: `1px solid ${C.border}`, boxShadow: shadow2, cursor: 'pointer' }}>
              <div style={{ width: 32, height: 18, borderRadius: 9, position: 'relative',
                background: smoothing ? C.success : C.border, transition: 'background 0.2s' }}>
                <div style={{ position: 'absolute', top: 2, left: smoothing ? 15 : 2, width: 14, height: 14,
                  borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>EMA Smoothing</span>
              <InfoIcon content={INFO_SMOOTH} width={280} />
            </div>
            <InfoIcon content={INFO_LC} width={340} />
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
                    <InfoIcon content={INFO_GAP} width={300} />
                  </div>
                </div>
                <span style={{ fontSize: 10, color: C.muted, whiteSpace: 'nowrap' }}>Drag below to zoom</span>
              </div>

              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={340}>
                  <ComposedChart data={chartData} margin={{ top: 12, right: 24, bottom: 30, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} opacity={0.5} vertical={false} />
                    <XAxis dataKey="training_size" type="number" tick={{ fontSize: 10, fill: C.muted }}
                      tickFormatter={v => v.toLocaleString()}
                      label={{ value: 'Training Set Size (samples)', position: 'insideBottom', offset: -18, fontSize: 11, fill: C.muted }} />
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

                    <Line type="monotone" dataKey={smoothing ? 'train_smooth' : 'train_mean'} stroke={C.primary} strokeWidth={2.5}
                      dot={{ r: 3, fill: C.primary, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 0 }} name="Training" isAnimationActive={false} />
                    <Line type="monotone" dataKey={smoothing ? 'val_smooth' : 'val_mean'} stroke={C.warning} strokeWidth={2.5}
                      dot={{ r: 3, fill: C.warning, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 0 }} name="Validation" isAnimationActive={false} />

                    {optimalSize != null && (
                      <ReferenceLine x={optimalSize} stroke={C.muted} strokeDasharray="6,4" strokeWidth={1.5}
                        label={{ value: 'Optimal Threshold', position: 'insideTopLeft', fontSize: 9, fill: C.muted, dy: -4 }} />
                    )}

                    <Tooltip content={<LCTooltip C={C} metricLabel={metricLabel} />} />
                    <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 11, paddingBottom: 6 }}
                      formatter={val => <span style={{ color: C.muted }}>{val}</span>} />
                    <Brush dataKey="training_size" height={22} stroke={C.border} fill={C.faint} travellerWidth={6}
                      tickFormatter={v => v?.toLocaleString?.() ?? v} />
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
                    <InfoIcon content={INFO_OPTIMAL} width={280} />
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
