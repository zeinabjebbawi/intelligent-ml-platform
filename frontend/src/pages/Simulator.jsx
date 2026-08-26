/**
 * PRISM — Simulator Page
 *
 * Layout follows the user's own hand-drawn mockup exactly:
 *   LEFT (50%):  mode toggle, then EITHER Section 1 (single-entry sliders/
 *                dropdowns) OR Section 2 (batch CSV drag-and-drop) — never both.
 *   RIGHT (50%): Section 3 (prediction result) stacked above Section 4
 *                (instance-level SHAP waterfall).
 * No dataset version is produced here — pure analysis/exploration of the
 * model trained on Train and Test, same convention as Feature Importance
 * and Learning Curve before it.
 *
 * Design: shares the app-wide theme system (../theme.jsx) — same C tokens,
 * ChartCard/InfoIcon conventions established in TrainTest.jsx /
 * FeatureImportance.jsx / LearningCurve.jsx. No hardcoded palette of its
 * own (a pasted first draft invented its own indigo palette from scratch —
 * not used, see memory: theme system discipline).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTheme } from '../theme'
import TopNav from '../components/TopNav'
import VersionsBar from '../components/VersionsBar'

const shadow  = '0 4px 24px rgba(0,0,0,0.07)'
const shadow2 = '0 2px 8px rgba(0,0,0,0.05)'
const cardR   = 14

// 127.0.0.1, not "localhost" — this machine resolves "localhost" to both
// ::1 and 127.0.0.1, and the FastAPI dev server only binds IPv4.
const ML_API = 'http://127.0.0.1:8001'

function debounce(fn, ms) {
  let t
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
}

const callSim = async (endpoint, body) => {
  const res = await fetch(`${ML_API}/simulator/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || `Error ${res.status}`) }
  return res.json()
}

const callBatch = async (modelPklPath, taskType, file) => {
  const fd = new FormData()
  fd.append('model_pkl_path', modelPklPath)
  fd.append('task_type', taskType)
  fd.append('file', file)
  const res = await fetch(`${ML_API}/simulator/predict-batch`, { method: 'POST', body: fd })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || `Error ${res.status}`) }
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────────
// INFO ICON — same click-to-open ⓘ popover pattern as the rest of the pipeline.
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
// SHAP WATERFALL CHART — custom SVG, arrow-tip bars matching the reference
// image's exact style. Red = pushed the prediction up, blue = pushed it
// down — the standard SHAP waterfall convention, deliberately independent
// of the app's teal theme (same reasoning as the Feature Importance page's
// beeswarm colors).
// ─────────────────────────────────────────────────────────────────────────────
const WaterfallChart = ({ data }) => {
  const { C } = useTheme()
  if (!data || data.error) return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted, fontSize: 12.5 }}>
      {data?.error ? `⚠ SHAP: ${data.error}` : 'Run a prediction to see the waterfall chart.'}
    </div>
  )

  const { base_value, final_value, features } = data
  const MAX_BARS = 10
  // A real fix over the first pasted draft: it silently truncated to the
  // top 10 features by |SHAP| and walked the waterfall through only those,
  // so for any model with >10 features the bars never actually reached
  // f(x) — the excluded features' contributions just vanished visually.
  // When there are more than MAX_BARS, the remainder are folded into one
  // "N other features" bar so the walk always lands exactly on final_value.
  let rows = features
  if (features.length > MAX_BARS) {
    const top = features.slice(0, MAX_BARS - 1)
    const rest = features.slice(MAX_BARS - 1)
    const restSum = rest.reduce((s, f) => s + f.shap, 0)
    rows = [...top, { name: `${rest.length} other feature${rest.length === 1 ? '' : 's'}`, value: null, shap: restSum, isAggregate: true }]
  }

  let running = base_value
  const bars = rows.map(f => {
    const start = running
    const end = running + f.shap
    running += f.shap
    return { ...f, start, end }
  })

  const allX = [base_value, final_value, ...bars.flatMap(b => [b.start, b.end])]
  const xMin = Math.min(...allX) - Math.abs(final_value - base_value) * 0.12
  const xMax = Math.max(...allX) + Math.abs(final_value - base_value) * 0.12
  const xRange = xMax - xMin || 1

  const W = 500, ROW_H = 30, PAD_L = 148, PAD_R = 18, PAD_T = 44, PAD_B = 28
  const H = rows.length * ROW_H + PAD_T + PAD_B

  const xPx = v => PAD_L + ((v - xMin) / xRange) * (W - PAD_L - PAD_R)
  const baseX = xPx(base_value)
  const finalX = xPx(final_value)

  const nTicks = 5
  const tickVals = Array.from({ length: nTicks }, (_, i) => xMin + (xRange * i / (nTicks - 1)))

  const POS = '#e0245e', NEG = '#1d9bf0'

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} style={{ display: 'block', minWidth: W }}>
        <line x1={finalX} y1={PAD_T - 18} x2={finalX} y2={H - PAD_B} stroke={C.muted} strokeDasharray="4,3" strokeWidth={1} />
        <text x={finalX + 4} y={PAD_T - 6} fontSize={10} fill={C.text} fontWeight={700}>f(x) = {final_value.toFixed(3)}</text>

        <line x1={baseX} y1={PAD_T} x2={baseX} y2={H - PAD_B} stroke={C.muted} strokeDasharray="4,3" strokeWidth={0.8} />
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke={C.border} strokeWidth={1} />

        {tickVals.map((v, i) => (
          <g key={i}>
            <line x1={xPx(v)} y1={H - PAD_B} x2={xPx(v)} y2={H - PAD_B + 3} stroke={C.border} />
            <text x={xPx(v)} y={H - PAD_B + 13} textAnchor="middle" fontSize={8} fill={C.muted}>{v.toFixed(2)}</text>
          </g>
        ))}
        <text x={baseX} y={H - PAD_B + 22} textAnchor="middle" fontSize={9} fill={C.muted}>E[f(x)] = {base_value.toFixed(3)}</text>

        {bars.map((b, ri) => {
          const y = PAD_T + ri * ROW_H
          const xA = xPx(b.start), xB = xPx(b.end)
          const barX = Math.min(xA, xB)
          const barW = Math.abs(xB - xA) || 2
          const pos = b.shap > 0
          const barColor = pos ? POS : NEG
          const shortName = b.name.length > 20 ? b.name.slice(0, 18) + '…' : b.name

          return (
            <g key={b.name}>
              <line x1={PAD_L - 4} y1={y + ROW_H} x2={W - PAD_R} y2={y + ROW_H} stroke={C.border} strokeWidth={0.5} opacity={0.5} />
              <text x={PAD_L - 8} y={y + ROW_H / 2 + 4} textAnchor="end" fontSize={10}>
                {b.value != null && <tspan fill={C.muted}>{b.value.toFixed(2)} = </tspan>}
                <tspan fill={C.text} fontWeight="700" fontStyle={b.isAggregate ? 'italic' : 'normal'}>{shortName}</tspan>
              </text>

              <polygon
                points={pos
                  ? `${barX},${y + 4} ${barX + barW - 6},${y + 4} ${barX + barW},${y + ROW_H / 2} ${barX + barW - 6},${y + ROW_H - 4} ${barX},${y + ROW_H - 4}`
                  : `${barX + 6},${y + 4} ${barX + barW},${y + 4} ${barX + barW},${y + ROW_H - 4} ${barX + 6},${y + ROW_H - 4} ${barX},${y + ROW_H / 2}`}
                fill={barColor} opacity={b.isAggregate ? 0.55 : 0.9} />

              {barW > 28 ? (
                <text x={barX + barW / 2} y={y + ROW_H / 2 + 4} textAnchor="middle" fontSize={10} fontWeight="700" fill="white">
                  {pos ? '+' : ''}{b.shap.toFixed(2)}
                </text>
              ) : (
                <text x={pos ? barX + barW + 3 : barX - 3} y={y + ROW_H / 2 + 4} textAnchor={pos ? 'start' : 'end'} fontSize={9} fontWeight="700" fill={barColor}>
                  {pos ? '+' : ''}{b.shap.toFixed(2)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Prediction Display
// ─────────────────────────────────────────────────────────────────────────────
const PredictionDisplay = ({ prediction, batchData }) => {
  const { C } = useTheme()
  if (!prediction && !batchData) return (
    <div style={{ textAlign: 'center', padding: '50px 20px', color: C.muted }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>🔮</div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, color: C.text }}>No prediction yet</div>
      <div style={{ fontSize: 12 }}>Adjust sliders on the left, or upload a CSV, to see results here.</div>
    </div>
  )

  if (batchData) {
    const cols = batchData.all_columns?.slice(0, 8) || []
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Batch Results — {batchData.row_count} rows predicted</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>New "Predicted" column appended to your dataset</div>
          </div>
          <a href={`${ML_API}/simulator/download-batch?result_path=${encodeURIComponent(batchData.result_path)}&filename=predictions.csv`}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: C.success, color: 'white',
              fontWeight: 700, fontSize: 12, textDecoration: 'none', display: 'inline-block' }}>
            ⬇ Download CSV
          </a>
        </div>
        {batchData.missing_columns?.length > 0 && (
          <div style={{ fontSize: 11, color: C.warning, background: C.warningSoft, borderRadius: 8, padding: '7px 10px', marginBottom: 10 }}>
            ⚠ {batchData.missing_columns.length} training feature(s) missing from this file, filled with 0: {batchData.missing_columns.join(', ')}
          </div>
        )}
        <div style={{ overflowX: 'auto', maxHeight: 280, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 10 }}>
          <table style={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: 11 }}>
            <thead style={{ position: 'sticky', top: 0, background: C.faint }}>
              <tr>
                {cols.map(c => (
                  <th key={c} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700,
                    color: (c === 'Predicted' || c === 'Confidence' || c === 'Predicted_Cluster') ? C.success : C.muted, whiteSpace: 'nowrap' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(batchData.preview_rows || []).map((row, ri) => (
                <tr key={ri} style={{ borderTop: `1px solid ${C.border}` }}>
                  {cols.map(c => (
                    <td key={c} style={{ padding: '7px 12px',
                      fontWeight: (c === 'Predicted' || c === 'Predicted_Cluster') ? 700 : 400,
                      color: (c === 'Predicted' || c === 'Predicted_Cluster') ? C.success : C.text }}>
                      {String(row[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const p = prediction
  if (p.type === 'classification') {
    const pct = p.confidence != null ? Math.round(p.confidence * 100) : null
    const ranked = p.proba ? Object.entries(p.proba).sort((a, b) => b[1] - a[1]) : []
    return (
      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: C.muted, marginBottom: 8 }}>Predicted Class</div>
          <div style={{ fontSize: 44, fontWeight: 900, color: C.primary, lineHeight: 1 }}>{p.label}</div>
          {pct != null && <div style={{ fontSize: 20, fontWeight: 700, color: C.success, marginTop: 6 }}>{pct}% confidence</div>}
        </div>
        {ranked.length > 0 && (
          <div style={{ textAlign: 'left', maxWidth: 320, margin: '0 auto' }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: C.muted, marginBottom: 10 }}>Class Probabilities</div>
            {ranked.map(([cls, prob], i) => (
              <div key={cls} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3, fontWeight: 600 }}>
                  <span style={{ color: C.text }}>{cls}</span>
                  <span style={{ color: prob > 0.5 ? C.success : C.muted }}>{(prob * 100).toFixed(1)}%</span>
                </div>
                <div style={{ height: 10, background: C.faint, borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ width: `${prob * 100}%`, height: '100%', background: i === 0 ? C.primary : C.muted, borderRadius: 5, transition: 'width 0.4s ease' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (p.type === 'regression') return (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: C.muted, marginBottom: 8 }}>Predicted Value</div>
      <div style={{ fontSize: 48, fontWeight: 900, color: C.primary }}>{p.value}</div>
    </div>
  )

  if (p.type === 'cluster') return (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: C.muted, marginBottom: 8 }}>Assigned Cluster</div>
      <div style={{ fontSize: 48, fontWeight: 900, color: '#8b5cf6' }}>#{p.label}</div>
    </div>
  )

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Single Entry Controls
// ─────────────────────────────────────────────────────────────────────────────
const SingleEntrySection = ({ features, values, onChange, predicting }) => {
  const { C } = useTheme()
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ maxHeight: 460, overflowY: 'auto', paddingRight: 4 }}>
        {features.map(feat => {
          const val = values[feat.name] ?? feat.default
          return (
            <div key={feat.name} style={{ padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{feat.name}</label>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.primary, background: C.primarySoft, padding: '2px 8px', borderRadius: 6 }}>
                  {feat.type === 'categorical' ? String(val) : Number(val).toFixed(2)}
                </span>
              </div>

              {feat.type === 'numeric' && (
                <input type="range" min={feat.min} max={feat.max} step={feat.step || 0.01} value={val}
                  onChange={e => onChange(feat.name, parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: C.primary, cursor: 'pointer' }} />
              )}

              {feat.type === 'binary' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {[0, 1].map(opt => (
                    <button key={opt} onClick={() => onChange(feat.name, opt)}
                      style={{ flex: 1, padding: '5px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12,
                        background: val === opt ? C.primary : C.faint, color: val === opt ? 'white' : C.muted }}>
                      {opt === 1 ? 'Yes (1)' : 'No (0)'}
                    </button>
                  ))}
                </div>
              )}

              {feat.type === 'categorical' && (
                <select value={val} onChange={e => onChange(feat.name, e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`,
                    fontSize: 12, background: C.card, color: C.text, cursor: 'pointer', outline: 'none' }}>
                  {feat.categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </div>
          )
        })}
      </div>
      {predicting && <div style={{ fontSize: 11, color: C.primary, marginTop: 6, textAlign: 'center' }}>⏳ Computing…</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Batch Upload (Drag + Drop)
// ─────────────────────────────────────────────────────────────────────────────
const BatchUploadSection = ({ onFile, uploading, batchData }) => {
  const { C } = useTheme()
  const [dragging, setDragging] = useState(false)
  const ref = useRef()

  const handleFile = f => { if (f && f.name.endsWith('.csv')) onFile(f) }

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }}
        onClick={() => ref.current?.click()}
        style={{
          border: `2px dashed ${dragging ? C.primary : C.border}`, borderRadius: 12, padding: '22px 16px',
          textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s',
          background: dragging ? C.primarySoft : C.faint, marginBottom: 12,
        }}>
        <input ref={ref} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
        <div style={{ fontSize: 28, marginBottom: 6 }}>📂</div>
        <div style={{ fontWeight: 700, fontSize: 13, color: dragging ? C.primary : C.text }}>
          {uploading ? 'Processing…' : 'Drop your CSV file here'}
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
          Upload a CSV without the target column — predictions are added automatically
        </div>
      </div>

      {batchData && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ background: C.successSoft, border: `1px solid ${C.success}33`, borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: C.success, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>✓ Columns found</div>
            <div style={{ fontSize: 11, color: C.text }}>
              {batchData.all_columns?.filter(c => !['Predicted', 'Confidence', 'Predicted_Cluster'].includes(c)).slice(0, 4).join(', ')}
              {batchData.all_columns?.length > 4 && '…'}
            </div>
          </div>
          <div style={{ background: C.primarySoft, border: `1px solid ${C.primary}33`, borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: C.primary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>🔮 Predicted</div>
            <div style={{ fontSize: 11, color: C.text }}>
              {batchData.all_columns?.filter(c => ['Predicted', 'Confidence', 'Predicted_Cluster'].includes(c)).join(', ') || '—'}
              <span style={{ color: C.success, marginLeft: 4 }}>· new column</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// INFO CONTENT
// ─────────────────────────────────────────────────────────────────────────────
const INFO_SIMULATOR = `What-If Simulator

Each slider or dropdown represents one feature your model was trained on. As you adjust values, the model makes a new prediction in near-real-time.

Use this to ask "What-If" questions:
• "What if this patient's glucose level was 180 instead of 90?"
• "How does the prediction change if study hours drop from 6 to 2?"
• "Is the model sensitive to age, or is GPA more decisive?"

The SHAP waterfall below shows WHY the model made its decision for the exact values you set — not just what it predicted, but which features pushed the outcome in each direction.`

const INFO_BATCH = `Batch Prediction

Upload a CSV file with feature columns but NO target column. The model predicts the outcome for every row and returns your file with a new "Predicted" column appended.

Requirements:
• The CSV must contain at least the feature columns the model was trained on
• The target column should be absent (it's ignored if present)
• Column names must match exactly (case-sensitive)

After prediction: a "Predicted" column and (for classification) a "Confidence" column are added. Download the result as a new CSV.`

const INFO_WATERFALL = `SHAP Waterfall Chart — Why did the model predict this?

The waterfall chart explains one specific prediction by showing how each feature contributed to moving the model's output from its baseline to the final result.

Reading the chart:
• f(x) at the top = the actual prediction for this input
• E[f(x)] at the bottom = the model's average prediction across the training data
• Each bar shows how much one feature shifted the prediction:
  – Red bar = pushed the prediction HIGHER (toward the positive class)
  – Blue bar = pushed the prediction LOWER (toward the negative class)
• Bars are sorted by absolute impact — the most influential feature is at the top.

Example: "Glucose: +0.34" means this glucose value increased the predicted probability by 0.34 compared to the baseline.`

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function SimulatorPage({
  projectData, modelPklPath, onNext, onGoTo,
  getDisplayPath, versions, active, onNavigate, furthestOrder,
}) {
  const { C } = useTheme()
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [mode, setMode] = useState('single')

  const [values, setValues] = useState({})
  const [predicting, setPredicting] = useState(false)
  const [prediction, setPrediction] = useState(null)
  const [shapData, setShapData] = useState(null)

  const [uploading, setUploading] = useState(false)
  const [batchData, setBatchData] = useState(null)

  const filePath = getDisplayPath ? getDisplayPath('simulator') : projectData?.filePath

  useEffect(() => {
    if (!filePath || !modelPklPath) return
    setLoading(true); setError('')
    callSim('defaults', { file_path: filePath, target_column: projectData?.targetColumn || '', model_pkl_path: modelPklPath })
      .then(d => {
        setConfig(d)
        const defaults = {}
        d.features.forEach(f => { defaults[f.name] = f.default })
        setValues(defaults)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [filePath, modelPklPath])

  const debouncedPredict = useMemo(() => debounce(async vals => {
    if (!filePath || !modelPklPath) return
    setPredicting(true)
    try {
      const res = await callSim('predict-single', {
        file_path: filePath, target_column: projectData?.targetColumn || '', model_pkl_path: modelPklPath,
        task_type: projectData?.taskType || 'classification', feature_values: vals,
      })
      setPrediction(res.prediction)
      setShapData(res.shap)
    } catch (e) { setError(e.message) }
    finally { setPredicting(false) }
  }, 300), [filePath, modelPklPath, projectData?.targetColumn, projectData?.taskType])

  const handleValueChange = useCallback((name, val) => {
    setValues(prev => {
      const next = { ...prev, [name]: val }
      debouncedPredict(next)
      return next
    })
  }, [debouncedPredict])

  useEffect(() => {
    if (Object.keys(values).length > 0 && mode === 'single') debouncedPredict(values)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  const handleBatchFile = useCallback(async file => {
    setUploading(true); setBatchData(null); setError('')
    try {
      const res = await callBatch(modelPklPath, projectData?.taskType || 'classification', file)
      setBatchData(res)
      if (res.shap) setShapData(res.shap)
      if (res.first_pred?.prediction) setPrediction(res.first_pred.prediction)
    } catch (e) { setError(e.message) }
    finally { setUploading(false) }
  }, [modelPklPath, projectData?.taskType])

  const features = config?.features || []

  return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <TopNav active={active || 'simulator'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
      <VersionsBar versions={versions} />
      <div style={{ padding: '4px 32px 0', fontSize: 11, color: C.muted }}>
        📌 Analysis only — no new dataset version is created on this page. It reads the model trained on
        Train and Test; use the nav above to go back there at any time.
      </div>

      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '18px 32px', marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 900, color: C.text, marginBottom: 3 }}>Simulator</h1>
            <p style={{ fontSize: 12.5, color: C.muted }}>
              Explore model behavior with custom inputs, or predict an entire unlabeled dataset in one batch.
            </p>
          </div>
          {config && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: C.primarySoft, color: C.primary }}>
                Model: {config.model_name}
              </span>
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: C.faint, color: C.muted }}>
                {features.length} features
              </span>
            </div>
          )}
        </div>
      </div>

      {!modelPklPath && (
        <div style={{ textAlign: 'center', padding: '90px 0', color: C.muted }}>
          <div style={{ fontSize: 38, marginBottom: 14 }}>🔮</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: C.text, marginBottom: 6 }}>No trained model found</div>
          <div style={{ fontSize: 13, marginBottom: 20 }}>Train a model on the Train and Test page first — the Simulator explores whichever model you trained most recently.</div>
          <button onClick={() => onGoTo && onGoTo('training')}
            style={{ padding: '10px 22px', borderRadius: 10, border: 'none', background: C.primary,
              color: 'white', fontWeight: 800, fontSize: 13, cursor: 'pointer', boxShadow: `0 4px 16px ${C.primary}44` }}>
            ← Go to Train and Test
          </button>
        </div>
      )}

      {modelPklPath && loading && (
        <div style={{ textAlign: 'center', padding: '90px 0', color: C.muted }}>
          <div style={{ fontSize: 26, marginBottom: 12, display: 'inline-block', animation: 'sim-spin 1s linear infinite' }}>◐</div>
          <p>Loading feature configuration…</p>
          <style>{`@keyframes sim-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {modelPklPath && !loading && error && (
        <div style={{ background: C.dangerSoft, border: `1px solid ${C.danger}`, borderRadius: 12,
          padding: 20, color: C.danger, margin: '24px 32px', fontSize: 13 }}>⚠ {error}</div>
      )}

      {modelPklPath && !loading && !error && config && (
        <div style={{ padding: '24px 32px 0' }}>

          {/* ── Mode Toggle ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 20, width: 'fit-content',
            background: C.faint, borderRadius: 12, padding: 4, border: `1px solid ${C.border}` }}>
            {[
              { key: 'single', label: '🎚 Single Entry', info: INFO_SIMULATOR },
              { key: 'batch', label: '📁 Batch Upload', info: INFO_BATCH },
            ].map(m => (
              <button key={m.key} onClick={() => setMode(m.key)}
                style={{ padding: '8px 20px', borderRadius: 9, border: 'none',
                  background: mode === m.key ? C.card : 'transparent',
                  color: mode === m.key ? C.primary : C.muted,
                  fontWeight: mode === m.key ? 700 : 500, fontSize: 13, cursor: 'pointer',
                  boxShadow: mode === m.key ? shadow2 : 'none', transition: 'all 0.15s' }}>
                {m.label}
              </button>
            ))}
            <InfoIcon content={mode === 'single' ? INFO_SIMULATOR : INFO_BATCH} width={320} />
          </div>

          {/* ── Main Two-Column Layout ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

            {/* ── LEFT PANEL ── */}
            <div style={{ minWidth: 0 }}>
              {mode === 'single' ? (
                <div style={{ background: C.card, borderRadius: cardR, padding: '18px 20px', boxShadow: shadow2, border: `1px solid ${C.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Settings for One Entry</div>
                    <InfoIcon content={INFO_SIMULATOR} width={300} />
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
                    Adjust sliders and dropdowns — prediction updates automatically after 300ms.
                  </div>
                  <SingleEntrySection features={features} values={values} onChange={handleValueChange} predicting={predicting} />
                </div>
              ) : (
                <div style={{ background: C.card, borderRadius: cardR, padding: '18px 20px', boxShadow: shadow2, border: `1px solid ${C.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Batch CSV Upload</div>
                    <InfoIcon content={INFO_BATCH} width={300} />
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>
                    Upload a CSV without the target column. All rows are predicted simultaneously.
                  </div>
                  <BatchUploadSection onFile={handleBatchFile} uploading={uploading} batchData={batchData} />
                </div>
              )}
            </div>

            {/* ── RIGHT PANEL ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <div style={{ background: C.card, borderRadius: cardR, padding: '18px 20px', boxShadow: shadow2,
                border: `1px solid ${C.border}`, borderTop: `3px solid ${C.primary}` }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 12 }}>
                  {mode === 'batch' ? '📊 Batch Prediction Results' : '🔮 Prediction'}
                  {predicting && <span style={{ color: C.primary, fontSize: 11, fontWeight: 400, marginLeft: 8 }}>⏳ updating…</span>}
                </div>
                <PredictionDisplay
                  prediction={mode === 'single' ? prediction : batchData?.first_pred?.prediction}
                  batchData={mode === 'batch' ? batchData : null} />
              </div>

              <div style={{ background: C.card, borderRadius: cardR, padding: '18px 20px', boxShadow: shadow2, border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>SHAP Waterfall — Why this prediction?</div>
                  <InfoIcon content={INFO_WATERFALL} width={340} />
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
                  Each bar shows how one feature pushed the prediction above or below the model's average.
                </div>
                <WaterfallChart data={shapData} />
              </div>
            </div>
          </div>

          {/* Forward-navigation button always at the page's own bottom
              (standing platform rule). */}
          <div style={{ textAlign: 'center', padding: '24px 0 34px', marginTop: 20, borderTop: `1px solid ${C.border}` }}>
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
