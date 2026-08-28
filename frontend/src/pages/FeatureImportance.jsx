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
import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer, ReferenceLine } from 'recharts'
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
    <span style={{ position: 'relative', display: 'inline-block' }}>
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
// CHART CARD — matches TrainTest.jsx's ChartCard exactly.
// ─────────────────────────────────────────────────────────────────────────────
// Same expand/fullscreen control already used on the Feature Selection
// page's charts (heatmap, Redundancy vs Relevance) — identical styling so
// the affordance reads as one consistent pattern across the app.
const ExpandBtn = ({ C, onClick }) => (
  <button onClick={onClick} title="Expand chart"
    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
      borderRadius: 8, border: `1px solid ${C.border}`, background: C.faint, color: C.muted,
      cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>
    ⛶
  </button>
)

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
const SHAPBeeswarm = ({ data, expanded = false }) => {
  const { C } = useTheme()
  if (!data?.length) return (
    <div style={{ textAlign: 'center', padding: '50px 0', color: C.muted, fontSize: 12.5 }}>
      No SHAP data available for this model type.
    </div>
  )

  // Bigger footprint in the fullscreen modal, same pattern as Feature
  // Selection's expandable charts — wider row label gutter too, since
  // `expanded` has real room for full feature names instead of truncating.
  const ROW_H = expanded ? 34 : 27, PAD_L = expanded ? 150 : 108, PAD_R = 56, PAD_T = 30, PAD_B = 30
  const W = expanded ? 860 : 560
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
                {(() => { const max = expanded ? 22 : 15; return d.feature.length > max ? d.feature.slice(0, max - 2) + '…' : d.feature })()}
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
  const errorMsg = data?.[0]?.error
  const isEmpty = !data?.length || errorMsg || data.every(d => d.value === 0)
  if (isEmpty) return (
    <div style={{ textAlign: 'center', padding: '50px 0', color: C.muted, fontSize: 12.5 }}>
      {errorMsg || 'Not available for this model type — this metric has no meaning for a model without a ' +
        'native split-based importance score. See the SHAP chart for a model-agnostic view instead.'}
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
// DIVERGING BAR CHART — signed horizontal bars around a zero reference line.
// Shared by Feature Coefficients (linear models) and Permutation Importance
// (KNN / non-linear-kernel SVM / Naive Bayes) — both are "signed effect per
// feature" concepts FIBarChart's positive-only opacity ramp can't represent:
// sign is the primary signal here (does this feature push the prediction up,
// down, or — for permutation — actually hurt the model when kept), so bars
// are colored solid by sign rather than ranked by shade.
// ─────────────────────────────────────────────────────────────────────────────
const DivergingBarChart = ({ data, label }) => {
  const { C } = useTheme()
  const errorMsg = data?.[0]?.error
  const rows = errorMsg ? [] : (data || []).slice(0, 15)
  if (!rows.length) return (
    <div style={{ textAlign: 'center', padding: '50px 0', color: C.muted, fontSize: 12.5 }}>
      {errorMsg || 'Not available for this model.'}
    </div>
  )
  const H = Math.max(210, rows.length * 27 + 40)
  const maxAbs = Math.max(...rows.map(d => Math.abs(d.value)), 0.0001) * 1.15

  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={rows} layout="vertical" margin={{ left: 92, right: 40, top: 6, bottom: 6 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} opacity={0.5} />
        <XAxis type="number" domain={[-maxAbs, maxAbs]} tick={{ fontSize: 10, fill: C.muted }} tickFormatter={v => v.toFixed(3)} />
        <YAxis dataKey="feature" type="category" tick={{ fontSize: 10.5, fill: C.text }} width={92}
          tickFormatter={f => f.length > 15 ? f.slice(0, 13) + '…' : f} />
        <Tooltip
          contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text }}
          formatter={(v) => [v.toFixed(4), label]} />
        <ReferenceLine x={0} stroke={C.muted} strokeWidth={1.25} />
        <Bar dataKey="value" radius={[3, 3, 3, 3]}>
          {rows.map((d, i) => (
            <Cell key={i} fill={d.value >= 0 ? C.primary : C.danger} />
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
const SuggestionSection = ({ suggestions }) => {
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
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// INFO ICON CONTENT — the deep-explanation copy the user's spec asked for.
// ─────────────────────────────────────────────────────────────────────────────
const INFO_SHAP = {
  itemsTitle: 'SHAP (SHapley Additive exPlanations)',
  items: [
    { label: 'What It Is', desc: 'Based on game theory, SHAP assigns each feature a fair "credit" for a prediction — the same way profit is fairly divided among players who each contributed to a game\'s outcome.' },
    { label: 'How It Works', desc: 'For every prediction, SHAP asks: "If I remove this feature, how much does the prediction change?" — averaged across every possible ordering of features, giving a stable, fair importance score for each one.' },
    { label: 'Reading the Sign', desc: 'A positive SHAP value means the feature pushed that prediction ABOVE the model\'s baseline (its average prediction across the training data). A negative value means it pulled the prediction below baseline.' },
    { label: 'Why It\'s Usually Better', desc: 'Works for any model — tree, linear, distance-based, anything.\nShows DIRECTION of impact, not just magnitude.\nReveals how a feature\'s effect changes across different samples.\nEach individual prediction can be fully explained, not just the model as a whole.' },
  ],
}

const INFO_FI = {
  itemsTitle: 'Model-Native Feature Importance',
  items: [
    { label: 'What It Is', desc: 'Unlike SHAP, this is computed from the STRUCTURE of the trained model itself, not from re-examining individual predictions — so it\'s much faster, but only available for models that actually track this internally.' },
    { label: 'Weight', desc: 'How many times the feature was used to split the data across every tree. High weight = consulted often, but not necessarily with large effect each time.' },
    { label: 'Gain', desc: 'The average improvement in accuracy each time the feature is used for a split. This is the most meaningful of the three — a high-gain feature genuinely helps the model predict better.' },
    { label: 'Coverage', desc: 'The average number of samples affected by the feature\'s splits. High coverage = the feature acts as a broad "gatekeeper" early in the decision process.' },
  ],
}

const INFO_LINEAR = {
  itemsTitle: 'Feature Coefficients (Standardized)',
  items: [
    { label: 'What It Is', desc: 'This model has no split-based importance — instead, since it was trained on standardized features (Encoding & Scaling\'s StandardScaler is baked directly into the model as a pipeline step), each coefficient IS the model\'s importance score.' },
    { label: 'Reading a Value', desc: 'A coefficient of +0.42 means: holding every other feature constant, a one-standard-deviation increase in that feature pushes the prediction up by 0.42 units on the model\'s own output scale. Negative coefficients push the prediction down by the same logic.' },
    { label: 'Why This Works Here', desc: 'Because every feature was scaled to the same mean-0/std-1 range before fitting, coefficients are directly comparable to each other — unlike raw-unit coefficients, where a feature measured in the thousands would look artificially "important" next to one measured in single digits.' },
  ],
}

const INFO_PERM = {
  itemsTitle: 'Permutation Importance',
  items: [
    { label: 'What It Is', desc: 'This model has no built-in importance score and no usable coefficients — so importance is measured empirically instead: shuffle one feature\'s values (breaking its real relationship with the target) and see how much the model\'s score drops.' },
    { label: 'Reading a Value', desc: 'A large drop means the model was leaning heavily on that feature to make correct predictions. A value near zero means the feature barely mattered. A NEGATIVE value means the model actually did slightly better with that feature scrambled — a sign it\'s mostly noise for this model, not a meaningful predictor.' },
    { label: 'Why This Method', desc: 'It works on any trained model regardless of its internal structure, which is why it\'s the standard fallback for distance-based and probabilistic models like these.' },
  ],
}

const INFO_CLUSTER = {
  itemsTitle: 'Cluster Separation Power (ANOVA F-statistic)',
  items: [
    { label: 'What It Is', desc: 'K-Means has no target column to predict and no coefficients — so "importance" here means something different: how much does each feature actually help distinguish the clusters the model found?' },
    { label: 'How It\'s Computed', desc: 'For each feature, this compares the variance BETWEEN cluster means to the variance WITHIN each cluster — the same F-statistic one-way ANOVA uses to test whether group means differ.' },
    { label: 'Reading a Value', desc: 'A high F-statistic means that feature\'s values are tightly grouped within each cluster but very different across clusters — exactly what "drives the separation" should look like. A low F-statistic means that feature looks similar across every cluster and likely contributed little to how the clusters were formed.' },
  ],
}

const INFO_WGC = {
  itemsTitle: 'The Three Importance Views, In Plain Language',
  footer: 'Rule of thumb: lead with Gain, use Weight to spot over-used-but-shallow features, use Coverage to see which features have broad vs. narrow reach.',
  items: [
    { label: 'Weight', desc: 'How OFTEN a feature gets used. A feature can be split on constantly while only ever moving the needle a little each time — high weight alone doesn\'t prove it matters.' },
    { label: 'Gain', desc: 'How MUCH each use of the feature actually improves the model. This is the one to trust as your primary reference; a high-gain feature is genuinely discriminative.' },
    { label: 'Coverage', desc: 'How MANY rows pass through decisions involving this feature. High coverage means the feature influences a broad slice of the dataset, even if each individual split\'s gain is modest.' },
  ],
}

const INFO_SUGGESTION = {
  itemsTitle: 'SHAP-Guided Feature Removal (the "wrapper" method)',
  footer: 'The "wrapper" name: the model\'s own output is used to wrap back around and improve the input feature set — a feedback loop, not a one-shot filter.',
  items: [
    { label: 'What This Suggestion Uses', desc: 'The trained model\'s own SHAP values, to flag features that barely influenced any prediction — under 5% of the top feature\'s impact.' },
    { label: 'Why SHAP Catches What Correlation Misses', desc: 'SHAP reflects actual model behavior, not just a statistical pattern in the raw data.\nA feature that looked "significant" in a correlation check might still contribute nothing once the model has other, better features to lean on.\nSHAP captures non-linear relationships a simple correlation coefficient can\'t see at all.' },
    { label: '⚠ Correlated Features', desc: 'If two columns are correlated, SHAP tends to credit only one of them. The other can look "unimportant" here even though removing it might still hurt.' },
    { label: '⚠ Retraining Required', desc: 'Removing features means retraining. The new model\'s SHAP values will look different from this snapshot, possibly quite a bit.' },
  ],
}

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
  const [shapExpanded, setShapExpanded] = useState(false)
  const [fiExpanded,   setFiExpanded]   = useState(false)

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

  // Which right-panel chart to show — set server-side by
  // feature_impact_router.py's get_model_group() from the actual trained
  // model's type (and, for SVM, its kernel). Defaults to 'tree' only so the
  // panel doesn't flash empty while `data` is still loading.
  const group = data?.model_group || 'tree'
  const rightPanel = data?.right_panel || {}
  const RIGHT_GENERAL = {
    linear:  'Standardized coefficients show each feature\'s direct linear effect on the prediction. Positive bars push the prediction higher; negative bars pull it lower. Bar length = strength of the effect.',
    perm:    'Permutation Importance measures how much the model\'s score drops when a feature is randomly shuffled. A bigger drop means the model relies on that feature more — this works for any model type, regardless of its internal structure.',
    cluster: 'The ANOVA F-statistic measures how well each feature separates the K-Means clusters — comparing variance between clusters to variance within them. Higher F means that feature more strongly defines the cluster boundaries.',
  }

  const shapError = data?.shap?.error

  return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <TopNav active={active || 'feature_impact'} onNavigate={onNavigate} furthestOrder={furthestOrder} taskType={projectData?.taskType} />
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
                title={<>SHAP Global Summary<InfoIcon {...INFO_SHAP} width={340} /></>}
                sub="Each dot is one sample. X-axis = SHAP value (impact on model output). Color = that sample's own feature value."
                badge={<ExpandBtn C={C} onClick={() => setShapExpanded(true)} />}>
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

            {/* ── RIGHT: model-aware panel — tree models keep the Weight/
                Gain/Coverage tabs, every other model family gets one
                dedicated chart instead (see get_model_group() server-side) ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              {group === 'tree' && (
                <ChartCard
                  title={<>Feature Importance<InfoIcon {...INFO_FI} width={340} /></>}
                  sub="Switch between Weight, Gain, and Coverage views."
                  badge={
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <InfoIcon {...INFO_WGC} width={300} />
                      <TabBtn label="Weight"   active={fiTab === 'weight'}   onClick={() => setFiTab('weight')} />
                      <TabBtn label="Gain"     active={fiTab === 'gain'}     onClick={() => setFiTab('gain')} />
                      <TabBtn label="Coverage" active={fiTab === 'coverage'} onClick={() => setFiTab('coverage')} />
                      <ExpandBtn C={C} onClick={() => setFiExpanded(true)} />
                    </div>
                  }>
                  <FIBarChart data={fiData} label={fiLabel[fiTab]} />
                </ChartCard>
              )}

              {group === 'linear' && (
                <ChartCard
                  title={<>Feature Coefficients<InfoIcon {...INFO_LINEAR} width={340} /></>}
                  sub="Standardized coefficients — signed, and directly comparable across features."
                  badge={<ExpandBtn C={C} onClick={() => setFiExpanded(true)} />}>
                  <DivergingBarChart data={rightPanel.coefficients} label="Std. Coefficient" />
                </ChartCard>
              )}

              {group === 'perm' && (
                <ChartCard
                  title={<>Permutation Importance<InfoIcon {...INFO_PERM} width={340} /></>}
                  sub="Score drop when each feature's values are randomly shuffled."
                  badge={<ExpandBtn C={C} onClick={() => setFiExpanded(true)} />}>
                  <DivergingBarChart data={rightPanel.perm_data} label="Score Drop" />
                </ChartCard>
              )}

              {group === 'cluster' && (
                <ChartCard
                  title={<>Cluster Separation Power<InfoIcon {...INFO_CLUSTER} width={340} /></>}
                  sub="ANOVA F-statistic — how strongly each feature distinguishes the clusters."
                  badge={<ExpandBtn C={C} onClick={() => setFiExpanded(true)} />}>
                  <FIBarChart data={rightPanel.f_stat_data} label="F-statistic" />
                </ChartCard>
              )}

              <DescriptionCard
                accent="#8b5cf6"
                generalText={group === 'tree' ? (FI_GENERAL[fiTab] || '') : (RIGHT_GENERAL[group] || '')}
                conclusionText={group === 'tree' ? (fiDesc[fiTab] || '') : (data?.descriptions?.right_panel || '')} />
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>Suggestions Based on SHAP Analysis</span>
              <InfoIcon {...INFO_SUGGESTION} width={340} />
            </div>
            <SuggestionSection suggestions={data?.suggestions || []} />
          </div>

          {/* Forward-navigation button always at the page's own bottom
              (standing platform rule). Report doesn't exist yet, so onNext
              is a no-op wired in from App.jsx — same "don't fake a
              transition" convention already used across this pipeline.
              "Back to Feature Selection" used to live inside SuggestionSection
              and only appeared when the SHAP suggestion recommended it -
              now persistent regardless of that recommendation, paired here
              as a standard back/next row (back left, next right). */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 32px 34px' }}>
            <button onClick={() => onGoTo && onGoTo('feature_selection')}
              style={{ padding: '11px 24px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.card,
                color: C.text, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
              ← Back to Feature Selection
            </button>
            <button onClick={() => onNext && onNext('report', {})}
              style={{ padding: '11px 28px', borderRadius: 10, border: 'none', background: C.primary,
                color: 'white', fontWeight: 800, fontSize: 14, cursor: 'pointer', boxShadow: `0 6px 20px ${C.primary}44` }}>
              Next Page →
            </button>
          </div>
        </div>
      )}

      {/* Fullscreen expand modals — same pattern as Feature Selection's
          expandable charts (heatmap / Redundancy vs Relevance). */}
      {shapExpanded && (
        <div onClick={() => setShapExpanded(false)}
          style={{ position: 'fixed', inset: 0, background: C.scrim, backdropFilter: 'blur(4px)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: C.overlayCard, border: `1px solid ${C.border}`, borderRadius: 16,
              padding: '20px 24px', maxWidth: '94vw', maxHeight: '92vh', overflow: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 20 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>SHAP Global Summary</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2, maxWidth: 560 }}>
                  Each dot is one sample. X-axis = SHAP value (impact on model output). Color = that sample's own feature value.
                </div>
              </div>
              <button onClick={() => setShapExpanded(false)}
                style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.border}`,
                  background: C.faint, color: C.text, cursor: 'pointer', fontSize: 14 }}>✕</button>
            </div>
            {shapError ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: C.danger, fontSize: 12.5 }}>⚠ {shapError}</div>
            ) : (
              <SHAPBeeswarm data={data?.shap?.beeswarm || []} expanded />
            )}
          </div>
        </div>
      )}
      {fiExpanded && (
        <div onClick={() => setFiExpanded(false)}
          style={{ position: 'fixed', inset: 0, background: C.scrim, backdropFilter: 'blur(4px)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: C.overlayCard, border: `1px solid ${C.border}`, borderRadius: 16,
              padding: '20px 24px', maxWidth: '94vw', maxHeight: '92vh', overflow: 'auto', width: 820,
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 20 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>
                  {group === 'tree' ? 'Feature Importance' : group === 'linear' ? 'Feature Coefficients'
                    : group === 'perm' ? 'Permutation Importance' : 'Cluster Separation Power'}
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2, maxWidth: 560 }}>
                  {group === 'tree' ? 'Switch between Weight, Gain, and Coverage views.'
                    : group === 'linear' ? 'Standardized coefficients — signed, and directly comparable across features.'
                    : group === 'perm' ? "Score drop when each feature's values are randomly shuffled."
                    : 'ANOVA F-statistic — how strongly each feature distinguishes the clusters.'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {group === 'tree' && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <TabBtn label="Weight"   active={fiTab === 'weight'}   onClick={() => setFiTab('weight')} />
                    <TabBtn label="Gain"     active={fiTab === 'gain'}     onClick={() => setFiTab('gain')} />
                    <TabBtn label="Coverage" active={fiTab === 'coverage'} onClick={() => setFiTab('coverage')} />
                  </div>
                )}
                <button onClick={() => setFiExpanded(false)}
                  style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.border}`,
                    background: C.faint, color: C.text, cursor: 'pointer', fontSize: 14 }}>✕</button>
              </div>
            </div>
            {group === 'tree' && <FIBarChart data={fiData} label={fiLabel[fiTab]} />}
            {group === 'linear' && <DivergingBarChart data={rightPanel.coefficients} label="Std. Coefficient" />}
            {group === 'perm' && <DivergingBarChart data={rightPanel.perm_data} label="Score Drop" />}
            {group === 'cluster' && <FIBarChart data={rightPanel.f_stat_data} label="F-statistic" />}
          </div>
        </div>
      )}
    </div>
  )
}
