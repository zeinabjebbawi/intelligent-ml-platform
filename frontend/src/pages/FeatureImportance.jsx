/**
 * PRISM — Feature Importance Page
 *
 * Layout follows the user's own hand-drawn mockup exactly: a 50/50 grid
 * (SHAP Global Summary | Feature Importance with Weight/Gain/Coverage tabs),
 * each chart with its own description card underneath, then a full-width
 * Suggestions section (SHAP-guided "wrapper method" — go back to Feature
 * Selection, never auto-remove anything), then the page's own forward
 * button at the bottom. No dataset version is produced here — this page is
 * pure analysis of the model already trained on the Train and Test page.
 *
 * Design: shares the app-wide theme system (../theme.jsx) — same C tokens,
 * shadow/ChartCard/MetricCard/InfoIcon conventions established in
 * TrainTest.jsx / DataReadiness.jsx / Encoding.jsx. No hardcoded palette of
 * its own (a pasted first draft of this page invented its own indigo
 * palette from scratch — not used, see memory: theme system discipline).
 */
import { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts'
import { useTheme } from '../theme'
import TopNav from '../components/TopNav'
import VersionsBar from '../components/VersionsBar'

const shadow  = '0 4px 24px rgba(0,0,0,0.07)'
const shadow2 = '0 2px 8px rgba(0,0,0,0.05)'
const cardR   = 14

// 127.0.0.1, not "localhost" — this machine resolves "localhost" to both
// ::1 and 127.0.0.1, and the FastAPI dev server only binds IPv4.
const ML_API = 'http://127.0.0.1:8001'

const callFI = async (body) => {
  const res = await fetch(`${ML_API}/feature-impact/compute`, {
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
// INFO ICON — same click-to-open ⓘ popover pattern as TrainTest.jsx.
// ─────────────────────────────────────────────────────────────────────────────
const InfoIcon = ({ content, width = 320 }) => {
  const { C } = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
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
// CHART CARD — matches TrainTest.jsx's ChartCard exactly.
// ─────────────────────────────────────────────────────────────────────────────
const ChartCard = ({ title, children, badge, sub, style: extra }) => {
  const { C } = useTheme()
  return (
    <div style={{ background: C.card, borderRadius: cardR, padding: '18px 20px',
      boxShadow: shadow2, border: `1px solid ${C.border}`, ...extra }}>
      {(title || badge) && (
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', marginBottom: 14, gap: 10 }}>
          <div>
            {title && <div style={{ fontWeight: 700, fontSize: 13, color: C.text, display: 'flex', alignItems: 'center' }}>{title}</div>}
            {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{sub}</div>}
          </div>
          {badge}
        </div>
      )}
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SHAP BEESWARM — custom SVG (Recharts has no beeswarm primitive; matches
// this project's established "custom SVG for signature visuals" pattern
// already used for the Decision Tree / Naive Bayes network / confusion
// matrix on the Train and Test page). Each dot = one sample. Color is
// pre-computed server-side on the standard SHAP blue→red convention — every
// ML practitioner recognizes this exact palette, so it deliberately does
// NOT follow the app's teal theme.
// ─────────────────────────────────────────────────────────────────────────────
const SHAPBeeswarm = ({ data }) => {
  const { C } = useTheme()
  if (!data?.length) return (
    <div style={{ textAlign: 'center', padding: '50px 0', color: C.muted, fontSize: 12.5 }}>
      No SHAP data available for this model type.
    </div>
  )

  const ROW_H = 27, PAD_L = 108, PAD_R = 56, PAD_T = 30, PAD_B = 30
  const W = 560
  const H = data.length * ROW_H + PAD_T + PAD_B

  const allShap = data.flatMap(d => d.samples.map(s => s.shap))
  const maxAbs  = Math.max(...allShap.map(Math.abs), 0.001) * 1.1

  const xPx = (v) => PAD_L + ((v + maxAbs) / (2 * maxAbs)) * (W - PAD_L - PAD_R)
  const yRow = (rank) => PAD_T + rank * ROW_H + ROW_H / 2
  const xTicks = [-maxAbs * 0.75, -maxAbs * 0.25, 0, maxAbs * 0.25, maxAbs * 0.75]

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} style={{ display: 'block', minWidth: W }}>
        <line x1={xPx(0)} y1={PAD_T - 10} x2={xPx(0)} y2={H - PAD_B} stroke={C.border} strokeWidth={1.5} />
        {xTicks.map(v => (
          <g key={v}>
            <line x1={xPx(v)} y1={H - PAD_B} x2={xPx(v)} y2={H - PAD_B + 3} stroke={C.border} />
            <text x={xPx(v)} y={H - PAD_B + 14} textAnchor="middle" fontSize={8.5} fill={C.muted}>{v.toFixed(2)}</text>
          </g>
        ))}
        <text x={(W - PAD_L - PAD_R) / 2 + PAD_L} y={H - 3} textAnchor="middle" fontSize={9.5} fill={C.muted}>
          SHAP value (impact on model output)
        </text>

        {data.map((d, ri) => {
          const y = yRow(ri)
          return (
            <g key={d.feature}>
              <line x1={PAD_L - 4} y1={y + ROW_H / 2 - 1} x2={W - PAD_R + 4} y2={y + ROW_H / 2 - 1}
                stroke={ri < data.length - 1 ? C.border : 'transparent'} strokeWidth={0.5} opacity={0.5} />
              <text x={PAD_L - 8} y={y + 4} textAnchor="end" fontSize={10.5} fill={C.text} fontWeight={600}>
                {d.feature.length > 15 ? d.feature.slice(0, 13) + '…' : d.feature}
              </text>
              {d.samples.map((s, si) => (
                <circle key={si} cx={xPx(s.shap)} cy={y + s.jitter * ROW_H} r={2.8} fill={s.color} opacity={0.8} />
              ))}
              <text x={W - PAD_R + 6} y={y + 4} fontSize={9} fill={C.muted}>{d.mean_abs_shap.toFixed(3)}</text>
            </g>
          )
        })}

        <defs>
          <linearGradient id="shap-grad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="rgb(30,120,255)" />
            <stop offset="50%" stopColor="rgb(230,230,230)" />
            <stop offset="100%" stopColor="rgb(255,60,60)" />
          </linearGradient>
        </defs>
        <rect x={W - PAD_R - 62} y={4} width={56} height={7} rx={3.5} fill="url(#shap-grad)" />
        <text x={W - PAD_R - 62} y={20} fontSize={8} fill={C.muted}>Low</text>
        <text x={W - PAD_R - 6} y={20} fontSize={8} fill={C.muted} textAnchor="end">High</text>
        <text x={W - PAD_R - 34} y={2} fontSize={8} fill={C.muted} textAnchor="middle">Feature value</text>
      </svg>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE IMPORTANCE BAR CHART — Recharts horizontal, switchable Weight/
// Gain/Coverage. Bar shade ranks by opacity of the app's real primary
// color (was a hardcoded indigo in the first pasted draft).
// ─────────────────────────────────────────────────────────────────────────────
const FIBarChart = ({ data, label }) => {
  const { C } = useTheme()
  const isEmpty = !data?.length || data.every(d => d.value === 0)
  if (isEmpty) return (
    <div style={{ textAlign: 'center', padding: '50px 0', color: C.muted, fontSize: 12.5 }}>
      Not available for this model type — this metric has no meaning for a model without a
      native split-based importance score. See the SHAP chart for a model-agnostic view instead.
    </div>
  )
  const rows   = data.slice(0, 15)
  const H      = Math.max(210, rows.length * 27 + 40)
  const isDark = C.bg === '#0a0e15'

  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={rows} layout="vertical" margin={{ left: 92, right: 40, top: 6, bottom: 6 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} opacity={0.5} />
        <XAxis type="number" tick={{ fontSize: 10, fill: C.muted }} tickFormatter={v => v.toFixed(3)} />
        <YAxis dataKey="feature" type="category" tick={{ fontSize: 10.5, fill: C.text }} width={92}
          tickFormatter={f => f.length > 15 ? f.slice(0, 13) + '…' : f} />
        <Tooltip
          contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text }}
          formatter={(v, n, p) => [`${p.payload.pct.toFixed(1)}%  (${v.toFixed(4)})`, label]} />
        <Bar dataKey="value" radius={[0, 5, 5, 0]}>
          {rows.map((d, i) => (
            <Cell key={i} fill={hexToRgba(C.primary, isDark ? 0.95 - (i / rows.length) * 0.65 : 0.9 - (i / rows.length) * 0.6)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DESCRIPTION CARD — general explanation + a "what this tells you" line
// that surfaces the actual finding from THIS dataset's numbers.
// ─────────────────────────────────────────────────────────────────────────────
const DescriptionCard = ({ generalText, conclusionText, accent }) => {
  const { C } = useTheme()
  const ac = accent || C.primary
  return (
    <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`,
      boxShadow: shadow2, padding: '16px 18px', borderLeft: `3px solid ${ac}` }}>
      <p style={{ fontSize: 12, color: C.text, lineHeight: 1.7, margin: 0, marginBottom: conclusionText ? 10 : 0 }}>
        {generalText}
      </p>
      {conclusionText && (
        <div style={{ paddingTop: 10, borderTop: `1px dashed ${C.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: ac, marginBottom: 4 }}>
            What this tells you
          </div>
          <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.65, margin: 0 }}>{conclusionText}</p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB BUTTON — weight / gain / coverage
// ─────────────────────────────────────────────────────────────────────────────
const TabBtn = ({ label, active, onClick, disabled }) => {
  const { C } = useTheme()
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding: '6px 13px', borderRadius: 7, fontWeight: active ? 700 : 500,
        fontSize: 11.5, cursor: disabled ? 'default' : 'pointer', border: 'none',
        background: active ? C.primary : C.faint,
        color: active ? 'white' : disabled ? C.muted : C.text,
        opacity: disabled ? 0.4 : 1, transition: 'all 0.15s' }}>
      {label}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SUGGESTION SECTION — Level 2 (rule-based) suggestion. Never auto-removes
// anything; only points back to Feature Selection ("wrapper method").
// ─────────────────────────────────────────────────────────────────────────────
const SuggestionSection = ({ suggestions, onGoToFeatureSelection }) => {
  const { C } = useTheme()
  if (!suggestions?.length) {
    return (
      <div style={{ background: C.successSoft, border: `1px solid ${C.success}33`,
        borderRadius: 14, padding: '20px 24px', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.success, marginBottom: 4 }}>
            ✓ All features are contributing meaningfully
          </div>
          <div style={{ fontSize: 12.5, color: C.muted }}>
            No low-SHAP features detected — every feature clears the 5% relevance bar. Your current
            feature set appears well-selected for this model.
          </div>
        </div>
      </div>
    )
  }
  const s = suggestions[0]
  return (
    <div style={{ background: C.warningSoft, border: `1px solid ${C.warning}40`, borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: C.warning, marginBottom: 8 }}>
            ⚠ SHAP-Based Suggestion — Consider Removing Low-Impact Features
          </div>
          <p style={{ fontSize: 12.5, color: C.text, lineHeight: 1.7, margin: 0, marginBottom: 10 }}>{s.message}</p>
          <p style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, margin: 0 }}>
            <strong style={{ color: C.text }}>Wrapper method:</strong> using SHAP to guide feature selection is
            called a wrapper approach — more accurate than filter methods because it accounts for actual
            model behavior, not just statistical correlation. Removing noisy features can reduce overfitting
            and sometimes improve accuracy on unseen data.
          </p>
          <p style={{ fontSize: 11.5, color: C.primary, marginTop: 8, lineHeight: 1.5 }}>
            ⓘ A low-SHAP feature might still matter if a correlated feature already captures its signal —
            check the Feature Selection correlation heatmap before removing anything.
          </p>
        </div>
        <button onClick={onGoToFeatureSelection}
          style={{ flexShrink: 0, padding: '10px 20px', borderRadius: 10, border: 'none',
            background: C.warning, color: 'white', fontWeight: 800, fontSize: 13,
            cursor: 'pointer', boxShadow: `0 4px 16px ${C.warning}44`, whiteSpace: 'nowrap' }}>
          ← Go to Feature Selection
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// INFO ICON CONTENT — the deep-explanation copy the user's spec asked for.
// ─────────────────────────────────────────────────────────────────────────────
const INFO_SHAP = `SHAP (SHapley Additive exPlanations)

Based on game theory, SHAP assigns each feature a fair "credit" for a prediction — the same way profit is fairly divided among players who each contributed to a game's outcome.

For every prediction, SHAP asks: "If I remove this feature, how much does the prediction change?" — averaged across every possible ordering of features, giving a stable, fair importance score for each one.

A positive SHAP value means the feature pushed that prediction ABOVE the model's baseline (its average prediction across the training data). A negative value means it pulled the prediction below baseline.

Why SHAP is usually better than a model's built-in importance:
• Works for any model — tree, linear, distance-based, anything
• Shows DIRECTION of impact, not just magnitude
• Reveals how a feature's effect changes across different samples
• Each individual prediction can be fully explained, not just the model as a whole`

const INFO_FI = `Model-Native Feature Importance

Unlike SHAP, this is computed from the STRUCTURE of the trained model itself, not from re-examining individual predictions — so it's much faster, but only available for models that actually track this internally.

For tree-based models (Decision Tree, Random Forest, XGBoost), three views are available:

Weight — how many times the feature was used to split the data across every tree. High weight = consulted often, but not necessarily with large effect each time.

Gain — the average improvement in accuracy each time the feature is used for a split. This is the most meaningful of the three — a high-gain feature genuinely helps the model predict better.

Coverage — the average number of samples affected by the feature's splits. High coverage = the feature acts as a broad "gatekeeper" early in the decision process.

For every other model type, only Gain is shown — using the model's own coefficient magnitude or built-in importance score, whichever it exposes.`

const INFO_WGC = `The three importance views, in plain language:

Weight — how OFTEN a feature gets used. A feature can be split on constantly while only ever moving the needle a little each time — high weight alone doesn't prove it matters.

Gain — how MUCH each use of the feature actually improves the model. This is the one to trust as your primary reference; a high-gain feature is genuinely discriminative.

Coverage — how MANY rows pass through decisions involving this feature. High coverage means the feature influences a broad slice of the dataset, even if each individual split's gain is modest.

Rule of thumb: lead with Gain, use Weight to spot over-used-but-shallow features, use Coverage to see which features have broad vs. narrow reach.`

const INFO_SUGGESTION = `SHAP-Guided Feature Removal (the "wrapper" method)

This suggestion uses the trained model's own SHAP values to flag features that barely influenced any prediction — under 5% of the top feature's impact.

Why this can catch things correlation-based selection misses:
• SHAP reflects actual model behavior, not just a statistical pattern in the raw data
• A feature that looked "significant" in a correlation check might still contribute nothing once the model has other, better features to lean on
• SHAP captures non-linear relationships a simple correlation coefficient can't see at all

The "wrapper" name: the model's own output is used to wrap back around and improve the input feature set — a feedback loop, not a one-shot filter.

⚠ Two things worth knowing before acting on this:
1. Correlated features — if two columns are correlated, SHAP tends to credit only one of them. The other can look "unimportant" here even though removing it might still hurt.
2. Retraining required — removing features means retraining. The new model's SHAP values will look different from this snapshot, possibly quite a bit.`

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function FeatureImportancePage({
  projectData, modelPklPath, onNext, onGoTo,
  getDisplayPath, versions, active, onNavigate, furthestOrder,
}) {
  const { C } = useTheme()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [fiTab,   setFiTab]   = useState('gain')

  const filePath = getDisplayPath ? getDisplayPath('feature_impact') : projectData?.filePath

  useEffect(() => {
    if (!filePath || !modelPklPath) return
    setLoading(true); setError('')
    callFI({
      file_path:      filePath,
      target_column:  projectData?.targetColumn || '',
      model_pkl_path: modelPklPath,
      task_type:      projectData?.taskType || 'classification',
    })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [filePath, modelPklPath])

  const fiData = useMemo(() => (data ? data.feature_importance?.[fiTab] || [] : []), [data, fiTab])
  const fiLabel = { weight: 'Weight (split frequency)', gain: 'Gain (accuracy improvement)', coverage: 'Coverage (samples affected)' }
  const fiDesc  = { weight: data?.descriptions?.weight, gain: data?.descriptions?.gain, coverage: data?.descriptions?.coverage }

  const FI_GENERAL = {
    weight:   'Weight counts how often each feature was chosen as a split criterion across every tree. A feature with high weight appears frequently in the model\'s decisions.',
    gain:     'Gain measures the average improvement in prediction accuracy each time a feature is used for a split. It is the single most reliable indicator of genuine feature importance for a tree model.',
    coverage: 'Coverage measures how many data samples are routed through each feature\'s splits on average. High coverage means the feature influences a broad portion of the dataset.',
  }

  const shapError = data?.shap?.error

  return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <TopNav active={active || 'feature_impact'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
      <VersionsBar versions={versions} />
      <div style={{ padding: '4px 32px 0', fontSize: 11, color: C.muted }}>
        📌 Analysis only — no new dataset version is created on this page. It reads the model
        trained on Train and Test; use the nav above to go back there or to Feature Selection at any time.
      </div>

      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '18px 32px', marginTop: 10 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: C.text, marginBottom: 3 }}>Feature Importance</h1>
        <p style={{ fontSize: 12.5, color: C.muted }}>
          Understand which features actually drive your model's predictions — SHAP explains individual
          predictions; the importance chart explains the model's own internal structure.
        </p>
        {data && (
          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: C.primarySoft, color: C.primary }}>
              Model: {data.model_name}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: C.faint, color: C.muted }}>
              {data.feature_names?.length} features analyzed
            </span>
          </div>
        )}
      </div>

      {!modelPklPath && (
        <div style={{ textAlign: 'center', padding: '90px 0', color: C.muted }}>
          <div style={{ fontSize: 38, marginBottom: 14 }}>🤖</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: C.text, marginBottom: 6 }}>No trained model found</div>
          <div style={{ fontSize: 13, marginBottom: 20 }}>Train a model on the Train and Test page first — Feature Importance analyzes whichever model you trained most recently.</div>
          <button onClick={() => onGoTo && onGoTo('training')}
            style={{ padding: '10px 22px', borderRadius: 10, border: 'none', background: C.primary,
              color: 'white', fontWeight: 800, fontSize: 13, cursor: 'pointer', boxShadow: `0 4px 16px ${C.primary}44` }}>
            ← Go to Train and Test
          </button>
        </div>
      )}

      {modelPklPath && loading && (
        <div style={{ textAlign: 'center', padding: '90px 0', color: C.muted }}>
          <div style={{ fontSize: 26, marginBottom: 12, display: 'inline-block', animation: 'fi-spin 1s linear infinite' }}>◐</div>
          <p>Computing SHAP values and feature importances…</p>
          <style>{`@keyframes fi-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {modelPklPath && !loading && error && (
        <div style={{ background: C.dangerSoft, border: `1px solid ${C.danger}`, borderRadius: 12,
          padding: 20, color: C.danger, margin: '24px 32px', fontSize: 13 }}>
          ⚠ {error}
          {error.toLowerCase().includes('shap') && (
            <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>Install SHAP in the FastAPI venv: pip install shap</div>
          )}
        </div>
      )}

      {modelPklPath && !loading && !error && data && (
        <div style={{ padding: '24px 32px 0' }}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>

            {/* ── LEFT: SHAP ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <ChartCard
                title={<>SHAP Global Summary<InfoIcon content={INFO_SHAP} width={340} /></>}
                sub="Each dot is one sample. X-axis = SHAP value (impact on model output). Color = that sample's own feature value.">
                {shapError ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: C.danger, fontSize: 12.5 }}>⚠ {shapError}</div>
                ) : (
                  <SHAPBeeswarm data={data?.shap?.beeswarm || []} />
                )}
              </ChartCard>
              <DescriptionCard
                accent={C.primary}
                generalText={`SHAP quantifies how much each feature pushed one individual prediction above or below the model's baseline — its average prediction across the whole dataset. It's "model-agnostic," meaning it works the same way no matter what kind of model produced the prediction, and it gives every feature a fair, consistent credit for each one.`}
                conclusionText={data?.descriptions?.shap || ''} />
            </div>

            {/* ── RIGHT: Feature Importance ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <ChartCard
                title={<>Feature Importance<InfoIcon content={INFO_FI} width={340} /></>}
                sub="Switch between Weight, Gain, and Coverage views."
                badge={
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <InfoIcon content={INFO_WGC} width={300} />
                    <TabBtn label="Weight"   active={fiTab === 'weight'}   onClick={() => setFiTab('weight')}   disabled={!data?.supports_wgc} />
                    <TabBtn label="Gain"     active={fiTab === 'gain'}     onClick={() => setFiTab('gain')} />
                    <TabBtn label="Coverage" active={fiTab === 'coverage'} onClick={() => setFiTab('coverage')} disabled={!data?.supports_wgc} />
                  </div>
                }>
                <FIBarChart data={fiData} label={fiLabel[fiTab]} />
                {!data?.supports_wgc && (
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 6, padding: '7px 10px', background: C.faint, borderRadius: 7 }}>
                    ⓘ Weight and Coverage need a tree-based model (Decision Tree, Random Forest, or XGBoost) — this model type only exposes Gain.
                  </div>
                )}
              </ChartCard>
              <DescriptionCard accent="#8b5cf6" generalText={FI_GENERAL[fiTab] || ''} conclusionText={fiDesc[fiTab] || ''} />
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>Suggestions Based on SHAP Analysis</span>
              <InfoIcon content={INFO_SUGGESTION} width={340} />
            </div>
            <SuggestionSection suggestions={data?.suggestions || []} onGoToFeatureSelection={() => onGoTo && onGoTo('feature_selection')} />
          </div>

          {/* Forward-navigation button always at the page's own bottom
              (standing platform rule). Report doesn't exist yet, so onNext
              is a no-op wired in from App.jsx — same "don't fake a
              transition" convention already used across this pipeline. */}
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
