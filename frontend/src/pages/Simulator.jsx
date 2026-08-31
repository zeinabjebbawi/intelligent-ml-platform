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
import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
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

  // ROW_H shrinks as the bar count grows (capped at MAX_BARS=10 above) so
  // the whole chart fits within one screen's height without its own
  // scrollbar, instead of a fixed row height letting a 10-bar chart run
  // taller than the space freed up elsewhere on the page.
  const W = 640, ROW_H = Math.max(20, Math.min(38, 300 / rows.length)), PAD_L = 162, PAD_R = 22, PAD_T = 40, PAD_B = 26
  const H = rows.length * ROW_H + PAD_T + PAD_B

  const xPx = v => PAD_L + ((v - xMin) / xRange) * (W - PAD_L - PAD_R)
  const baseX = xPx(base_value)
  const finalX = xPx(final_value)

  const nTicks = 5
  const tickVals = Array.from({ length: nTicks }, (_, i) => xMin + (xRange * i / (nTicks - 1)))

  const POS = '#e0245e', NEG = '#1d9bf0'

  return (
    <div style={{ overflowX: 'auto', flex: 1, display: 'flex', alignItems: 'flex-start' }}>
      {/* width:100% + preserveAspectRatio="none" lets the chart genuinely
          fill however wide its card is (the card grew once Prediction
          shrank) instead of sitting fixed-width with dead space beside it -
          height stays tied to actual row content via the H viewBox unit. */}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block', minWidth: 420 }}>
        <line x1={finalX} y1={PAD_T - 20} x2={finalX} y2={H - PAD_B} stroke={C.muted} strokeDasharray="4,3" strokeWidth={1} />
        <text x={finalX + 4} y={PAD_T - 8} fontSize={12} fill={C.text} fontWeight={700}>f(x) = {final_value.toFixed(3)}</text>

        <line x1={baseX} y1={PAD_T} x2={baseX} y2={H - PAD_B} stroke={C.muted} strokeDasharray="4,3" strokeWidth={0.8} />
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke={C.border} strokeWidth={1} />

        {tickVals.map((v, i) => (
          <g key={i}>
            <line x1={xPx(v)} y1={H - PAD_B} x2={xPx(v)} y2={H - PAD_B + 3} stroke={C.border} />
            <text x={xPx(v)} y={H - PAD_B + 15} textAnchor="middle" fontSize={9.5} fill={C.muted}>{v.toFixed(2)}</text>
          </g>
        ))}
        <text x={baseX} y={H - PAD_B + 26} textAnchor="middle" fontSize={10.5} fill={C.muted}>E[f(x)] = {base_value.toFixed(3)}</text>

        {bars.map((b, ri) => {
          const y = PAD_T + ri * ROW_H
          const xA = xPx(b.start), xB = xPx(b.end)
          const barX = Math.min(xA, xB)
          const barW = Math.abs(xB - xA) || 2
          const pos = b.shap > 0
          const barColor = pos ? POS : NEG
          const shortName = b.name.length > 24 ? b.name.slice(0, 22) + '…' : b.name

          return (
            <g key={b.name}>
              <line x1={PAD_L - 4} y1={y + ROW_H} x2={W - PAD_R} y2={y + ROW_H} stroke={C.border} strokeWidth={0.5} opacity={0.5} />
              <text x={PAD_L - 8} y={y + ROW_H / 2 + 4} textAnchor="end" fontSize={12}>
                {b.value != null && <tspan fill={C.muted}>{b.value.toFixed(2)} = </tspan>}
                <tspan fill={C.text} fontWeight="700" fontStyle={b.isAggregate ? 'italic' : 'normal'}>{shortName}</tspan>
              </text>

              <polygon
                points={pos
                  ? `${barX},${y + 5} ${barX + barW - 7},${y + 5} ${barX + barW},${y + ROW_H / 2} ${barX + barW - 7},${y + ROW_H - 5} ${barX},${y + ROW_H - 5}`
                  : `${barX + 7},${y + 5} ${barX + barW},${y + 5} ${barX + barW},${y + ROW_H - 5} ${barX + 7},${y + ROW_H - 5} ${barX},${y + ROW_H / 2}`}
                fill={barColor} opacity={b.isAggregate ? 0.55 : 0.9} />

              {barW > 32 ? (
                <text x={barX + barW / 2} y={y + ROW_H / 2 + 4} textAnchor="middle" fontSize={12} fontWeight="700" fill="white">
                  {pos ? '+' : ''}{b.shap.toFixed(2)}
                </text>
              ) : (
                <text x={pos ? barX + barW + 3 : barX - 3} y={y + ROW_H / 2 + 4} textAnchor={pos ? 'start' : 'end'} fontSize={11} fontWeight="700" fill={barColor}>
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
const PredictionDisplay = ({ prediction, batchData, compact }) => {
  const { C } = useTheme()
  if (!prediction && !batchData) return (
    <div style={{ textAlign: 'center', padding: compact ? '14px 20px' : '50px 20px', color: C.muted }}>
      <div style={{ fontSize: compact ? 22 : 36, marginBottom: compact ? 6 : 12 }}>🔮</div>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: C.text }}>No prediction yet</div>
      <div style={{ fontSize: 11 }}>Adjust sliders on the left, or upload a CSV, to see results here.</div>
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
      <div style={{ textAlign: 'center', padding: compact ? '2px 0' : '16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 10, marginBottom: compact ? 10 : 20, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: C.muted }}>Predicted Class</div>
          <div style={{ fontSize: compact ? 26 : 44, fontWeight: 900, color: C.primary, lineHeight: 1 }}>{p.label}</div>
          {pct != null && <div style={{ fontSize: compact ? 13 : 20, fontWeight: 700, color: C.success }}>{pct}% confidence</div>}
        </div>
        {ranked.length > 0 && (
          <div style={{ textAlign: 'left', maxWidth: 320, margin: '0 auto' }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: C.muted, marginBottom: compact ? 5 : 10 }}>Class Probabilities</div>
            {ranked.map(([cls, prob], i) => (
              <div key={cls} style={{ marginBottom: compact ? 5 : 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2, fontWeight: 600 }}>
                  <span style={{ color: C.text }}>{cls}</span>
                  <span style={{ color: prob > 0.5 ? C.success : C.muted }}>{(prob * 100).toFixed(1)}%</span>
                </div>
                <div style={{ height: compact ? 6 : 10, background: C.faint, borderRadius: 5, overflow: 'hidden' }}>
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
    <div style={{ textAlign: 'center', padding: compact ? '2px 0' : '24px 0' }}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: C.muted, marginBottom: 4 }}>Predicted Value</div>
      <div style={{ fontSize: compact ? 30 : 48, fontWeight: 900, color: C.primary }}>{p.value}</div>
    </div>
  )

  if (p.type === 'cluster') return (
    <div style={{ textAlign: 'center', padding: compact ? '2px 0' : '24px 0' }}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: C.muted, marginBottom: 4 }}>Assigned Cluster</div>
      <div style={{ fontSize: compact ? 30 : 48, fontWeight: 900, color: '#8b5cf6' }}>#{p.label}</div>
    </div>
  )

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Single Entry Controls
// ─────────────────────────────────────────────────────────────────────────────
const SingleEntrySection = ({ features, values, onChange, predicting, fillHeight }) => {
  const { C } = useTheme()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: fillHeight ? 1 : undefined, minHeight: 0 }}>
      <div style={fillHeight
        ? { flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }
        : { maxHeight: 460, overflowY: 'auto', paddingRight: 4 }}>
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
const INFO_SIMULATOR = {
  itemsTitle: 'What-If Simulator',
  footer: 'The SHAP waterfall below shows WHY the model made its decision for the exact values you set — not just what it predicted, but which features pushed the outcome in each direction.',
  items: [
    { label: 'How It Works', desc: 'Each slider or dropdown represents one feature your model was trained on. As you adjust values, the model makes a new prediction in near-real-time.' },
    { label: 'What-If Questions', desc: '"What if this patient\'s glucose level was 180 instead of 90?"\n"How does the prediction change if study hours drop from 6 to 2?"\n"Is the model sensitive to age, or is GPA more decisive?"' },
  ],
}

const INFO_BATCH = {
  itemsTitle: 'Batch Prediction',
  items: [
    { label: 'How It Works', desc: 'Upload a CSV file with feature columns but NO target column. The model predicts the outcome for every row and returns your file with a new "Predicted" column appended.' },
    { label: 'Requirements', desc: 'The CSV must contain at least the feature columns the model was trained on.\nThe target column should be absent (it\'s ignored if present).\nColumn names must match exactly (case-sensitive).' },
    { label: 'After Prediction', desc: 'A "Predicted" column and (for classification) a "Confidence" column are added. Download the result as a new CSV.' },
  ],
}

const INFO_WATERFALL = {
  itemsTitle: 'SHAP Waterfall Chart — Why Did The Model Predict This?',
  footer: 'Example: "Glucose: +0.34" means this glucose value increased the predicted probability by 0.34 compared to the baseline.',
  items: [
    { label: 'What It Explains', desc: 'The waterfall chart explains one specific prediction by showing how each feature contributed to moving the model\'s output from its baseline to the final result.' },
    { label: 'f(x) and E[f(x)]', desc: 'f(x) at the top = the actual prediction for this input.\nE[f(x)] at the bottom = the model\'s average prediction across the training data.' },
    { label: 'Reading a Bar', desc: 'Red bar = pushed the prediction HIGHER (toward the positive class).\nBlue bar = pushed the prediction LOWER (toward the negative class).\nBars are sorted by absolute impact — the most influential feature is at the top.' },
  ],
}

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
  // `error` stays load-only (config defaults failed to load — the panel
  // below genuinely has nothing to render yet). debouncedPredict fires on
  // every slider move and handleBatchFile on every upload, both AFTER the
  // panel is already showing sliders/mode-toggle/chart — routing either
  // through `error` hid that whole panel behind a bare banner on every
  // single failed prediction, with no way back to adjust inputs and retry.
  const [actionError, setActionError] = useState('')

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

  // Each slider tick fires a new debounced predict-single call, but nothing
  // guaranteed the responses came back in the order they were sent - a
  // request for an earlier slider position that happens to take longer
  // (e.g. a heavier model/dataset pushing SHAP's KernelExplainer past a
  // faster later request) could resolve last and silently overwrite a
  // fresher prediction with a stale one, making the result panel look
  // "stuck" while nothing was visibly wrong with the request/response
  // wiring itself. requestIdRef makes only the most-recently-issued call's
  // response actually get applied to state.
  const requestIdRef = useRef(0)

  const debouncedPredict = useMemo(() => debounce(async vals => {
    if (!filePath || !modelPklPath) return
    const myRequestId = ++requestIdRef.current
    setPredicting(true)
    setActionError('')
    try {
      const res = await callSim('predict-single', {
        file_path: filePath, target_column: projectData?.targetColumn || '', model_pkl_path: modelPklPath,
        task_type: projectData?.taskType || 'classification', feature_values: vals,
      })
      if (myRequestId !== requestIdRef.current) return // superseded by a newer request
      setPrediction(res.prediction)
      setShapData(res.shap)
    } catch (e) { if (myRequestId === requestIdRef.current) setActionError(e.message) }
    finally { if (myRequestId === requestIdRef.current) setPredicting(false) }
  }, 300), [filePath, modelPklPath, projectData?.targetColumn, projectData?.taskType])

  const handleValueChange = useCallback((name, val) => {
    setValues(prev => ({ ...prev, [name]: val }))
  }, [])

  useEffect(() => {
    if (Object.keys(values).length > 0 && mode === 'single') debouncedPredict(values)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values])

  useEffect(() => {
    if (Object.keys(values).length > 0 && mode === 'single') debouncedPredict(values)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  const handleBatchFile = useCallback(async file => {
    setUploading(true); setBatchData(null); setActionError('')
    try {
      const res = await callBatch(modelPklPath, projectData?.taskType || 'classification', file)
      setBatchData(res)
      if (res.shap) setShapData(res.shap)
      if (res.first_pred?.prediction) setPrediction(res.first_pred.prediction)
    } catch (e) { setActionError(e.message) }
    finally { setUploading(false) }
  }, [modelPklPath, projectData?.taskType])

  const features = config?.features || []

  return (
    <div style={{ background: C.bg, height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <TopNav active={active || 'simulator'} onNavigate={onNavigate} furthestOrder={furthestOrder} taskType={projectData?.taskType} />
      <VersionsBar versions={versions} />
      {/* Header condensed to one row (was a title + a full description
          paragraph + a separate banner line stacked above it) - freed
          space is what lets the SHAP waterfall grow to fit without an
          internal scroll below. */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '10px 32px', flexShrink: 0,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 16, fontWeight: 900, color: C.text }}>Simulator</h1>
          <span style={{ fontSize: 11, color: C.muted }}>
            📌 Reads the model trained on Train and Test — no new dataset version is created here.
          </span>
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

      {!modelPklPath && (
        <div style={{ textAlign: 'center', padding: '90px 0', color: C.muted, flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
        <div style={{ textAlign: 'center', padding: '90px 0', color: C.muted, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div style={{ fontSize: 26, marginBottom: 12, display: 'inline-block', animation: 'sim-spin 1s linear infinite' }}>◐</div>
          <p>Loading feature configuration…</p>
          <style>{`@keyframes sim-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {modelPklPath && !loading && error && (
        <div style={{ background: C.dangerSoft, border: `1px solid ${C.danger}`, borderRadius: 12,
          padding: 20, color: C.danger, margin: '24px 32px', fontSize: 13, flex: 1, minHeight: 0, overflowY: 'auto' }}>⚠ {error}</div>
      )}

      {modelPklPath && !loading && !error && config && (
        <div style={{ padding: '10px 32px 0', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>

          {actionError && (
            <div style={{ background: C.dangerSoft, border: `1px solid ${C.danger}`, borderRadius: 10,
              padding: '10px 16px', color: C.danger, fontSize: 13, marginBottom: 10, flexShrink: 0 }}>
              ⚠ {actionError}
            </div>
          )}

          {/* ── Mode Toggle ── (compact - freed vertical space goes to the
              SHAP chart below so it fits without its own scroll) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10, width: 'fit-content', flexShrink: 0,
            background: C.faint, borderRadius: 10, padding: 3, border: `1px solid ${C.border}` }}>
            {[
              { key: 'single', label: '🎚 Single Entry', info: INFO_SIMULATOR },
              { key: 'batch', label: '📁 Batch Upload', info: INFO_BATCH },
            ].map(m => (
              <button key={m.key} onClick={() => setMode(m.key)}
                style={{ padding: '5px 14px', borderRadius: 7, border: 'none',
                  background: mode === m.key ? C.card : 'transparent',
                  color: mode === m.key ? C.primary : C.muted,
                  fontWeight: mode === m.key ? 700 : 500, fontSize: 12, cursor: 'pointer',
                  boxShadow: mode === m.key ? shadow2 : 'none', transition: 'all 0.15s' }}>
                {m.label}
              </button>
            ))}
            <InfoIcon {...(mode === 'single' ? INFO_SIMULATOR : INFO_BATCH)} width={320} />
          </div>

          {/* ── Main Two-Column Layout ──
              LEFT stretches to match the RIGHT column's total height (grid's
              default align-items:stretch) so "Settings for One Entry" always
              reaches the page bottom. RIGHT is a flex column where the
              Prediction card sizes to its own content (secondary, de-emphasized)
              and the SHAP card absorbs all the height that frees up. The grid
              itself is flex:1/minHeight:0/overflow:hidden — bounded to
              whatever vertical space is left in the page (no page-level
              scroll at all, matching the platform's fixed-viewport pages) —
              so any content taller than that space scrolls inside its OWN
              card (the settings list, the SHAP chart) instead of growing
              the page. */}
          <div style={{ display: 'grid', gridTemplateColumns: '0.82fr 1.18fr', gap: 20, flex: 1, minHeight: 0, overflow: 'hidden' }}>

            {/* ── LEFT PANEL ── */}
            <div style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {mode === 'single' ? (
                <div style={{ background: C.card, borderRadius: cardR, padding: '18px 20px', boxShadow: shadow2,
                  border: `1px solid ${C.border}`, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Settings for One Entry</div>
                    <InfoIcon {...INFO_SIMULATOR} width={300} />
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 12, flexShrink: 0 }}>
                    Adjust sliders and dropdowns — prediction updates automatically after 300ms.
                  </div>
                  <SingleEntrySection features={features} values={values} onChange={handleValueChange} predicting={predicting} fillHeight />
                </div>
              ) : (
                <div style={{ background: C.card, borderRadius: cardR, padding: '18px 20px', boxShadow: shadow2, border: `1px solid ${C.border}`, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Batch CSV Upload</div>
                    <InfoIcon {...INFO_BATCH} width={300} />
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>
                    Upload a CSV without the target column. All rows are predicted simultaneously.
                  </div>
                  <BatchUploadSection onFile={handleBatchFile} uploading={uploading} batchData={batchData} />
                </div>
              )}
            </div>

            {/* ── RIGHT PANEL ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, minHeight: 0 }}>
              <div style={{ background: C.card, borderRadius: cardR, padding: '12px 18px', boxShadow: shadow2,
                border: `1px solid ${C.border}`, borderTop: `3px solid ${C.primary}`, flex: '0 0 auto' }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: C.text, marginBottom: 8 }}>
                  {mode === 'batch' ? '📊 Batch Prediction Results' : '🔮 Prediction'}
                  {predicting && <span style={{ color: C.primary, fontSize: 11, fontWeight: 400, marginLeft: 8 }}>⏳ updating…</span>}
                </div>
                <PredictionDisplay
                  prediction={mode === 'single' ? prediction : batchData?.first_pred?.prediction}
                  batchData={mode === 'batch' ? batchData : null} compact />
              </div>

              <div style={{ background: C.card, borderRadius: cardR, padding: '14px 18px', boxShadow: shadow2, border: `1px solid ${C.border}`,
                flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>SHAP Waterfall — Why this prediction?</div>
                  <InfoIcon {...INFO_WATERFALL} width={340} />
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, flexShrink: 0 }}>
                  Each bar shows how one feature pushed the prediction above or below the model's average.
                </div>
                {/* No scroll here on purpose - WaterfallChart's own ROW_H
                    shrinks as bar count grows (capped at 10 bars) so the
                    whole chart fits this space; centered in case the
                    freed-up card is taller than the chart needs. */}
                <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                  <WaterfallChart data={shapData} />
                </div>
              </div>
            </div>
          </div>

          {/* Forward-navigation button always at the page's own bottom
              (standing platform rule) - flexShrink:0 so it stays pinned and
              visible rather than being pushed out by the grid above. */}
          <div style={{ textAlign: 'center', padding: '16px 0', marginTop: 14, borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
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
