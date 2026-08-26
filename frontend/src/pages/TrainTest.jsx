/**
 * PRISM — Train and Test Page
 *
 * Layout (per the user's own hand-drawn mockup): two fixed panels, not a
 * flowing single column like every other page in this pipeline —
 *   LEFT  (settings, sticky, its own scroll)  |  RIGHT (output, its own scroll)
 * Settings persist in this component's own state for the whole session —
 * navigating away via TopNav and back does NOT reset the configured model,
 * because this page is never unmounted while the user bounces around the
 * journey map (App.jsx keeps `stage` as the only thing that changes; this
 * component instance is recreated only on a hard page reload).
 *
 * Design: shares the app-wide theme system (../theme.jsx) — same C tokens,
 * shadow/shadow2 constants, ChartCard/MetricCard conventions established in
 * Encoding.jsx / DataReadiness.jsx. No hardcoded palette of its own.
 *
 * Content/structure below follows the user's own detailed specification
 * and hand-drawn mockup exactly (model/metric buttons → split method →
 * grid search → threshold → train button → model history, left; elbow
 * curve or results, right) — see docs/PROJECT_HANDOFF.md workflow notes.
 * Creative liberty was only taken where the spec explicitly invited it
 * (chart styling, the exact visual language of each model-specific graph).
 */
import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Brush, BarChart, Bar, Cell, ScatterChart,
  Scatter, ZAxis,
} from 'recharts'
import { useTheme } from '../theme'
import TopNav from '../components/TopNav'
import VersionsBar from '../components/VersionsBar'

const shadow  = '0 4px 24px rgba(0,0,0,0.07)'
const shadow2 = '0 2px 8px rgba(0,0,0,0.05)'
const cardR   = 14

// 127.0.0.1, not "localhost" — dual-stack landmine on this machine (see
// docs/PROJECT_HANDOFF.md / memory: localhost resolves to both ::1 and
// 127.0.0.1 here, backends are IPv4-only).
const ML_API = 'http://127.0.0.1:8001'

const callTraining = async (endpoint, body) => {
  const res = await fetch(`${ML_API}/training/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || `Error ${res.status}`) }
  return res.json()
}

const CLASS_COLORS = ['#2dd4bf', '#8b5cf6', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#84cc16', '#06b6d4']

// ─────────────────────────────────────────────────────────────────────────────
// MODEL CATALOG — grouped by task type, matching the user's exact model list.
// ─────────────────────────────────────────────────────────────────────────────
const MODEL_GROUPS = {
  classification: [
    { group: 'Tree-Based', models: [
      { id: 'decision_tree', label: 'Decision Tree (CART / ID3)', icon: '🌳' },
      { id: 'random_forest', label: 'Random Forest', icon: '🌲' },
      { id: 'xgboost', label: 'XGBoost', icon: '🚀' },
    ]},
    { group: 'Linear', models: [
      { id: 'logistic_regression', label: 'Logistic Regression', icon: '📈' },
    ]},
    { group: 'Distance-Based', models: [
      { id: 'knn', label: 'K-Nearest Neighbors', icon: '🔵' },
    ]},
    { group: 'Boundary-Based', models: [
      { id: 'svm', label: 'Support Vector Machine', icon: '⚔' },
    ]},
    { group: 'Probabilistic', models: [
      { id: 'naive_bayes', label: 'Naive Bayes', icon: '🎲' },
    ]},
  ],
  regression: [
    { group: 'Linear', models: [
      { id: 'linear_regression', label: 'Linear Regression', icon: '📏' },
      { id: 'ridge_regression', label: 'Ridge Regression', icon: '📐' },
    ]},
    { group: 'Ensemble', models: [
      { id: 'random_forest_regressor', label: 'Random Forest Regressor', icon: '🌲' },
    ]},
  ],
  clustering: [
    { group: 'Centroid-Based', models: [
      { id: 'kmeans', label: 'K-Means', icon: '🎯' },
    ]},
  ],
}
const ALL_MODELS = Object.values(MODEL_GROUPS).flat().flatMap(g => g.models)
const modelLabel = (id) => ALL_MODELS.find(m => m.id === id)?.label || id

const MODEL_DESCRIPTIONS = {
  knn: 'Classifies by majority vote of the K nearest neighbors. Makes no assumption about data shape. Works best on small-to-medium datasets with scaled features.',
  decision_tree: 'Splits data using feature thresholds into an inverted tree. Fully interpretable but prone to overfitting without depth limits.',
  random_forest: 'An ensemble of many decision trees, each voting on the outcome. Robust, handles noisy data well, usually a strong default performer on tabular data.',
  logistic_regression: 'Models the probability of each class using a sigmoid function. Assumes a roughly linear decision boundary. Fast, interpretable, works best on scaled features.',
  svm: 'Finds the hyperplane that maximizes the margin between classes. Strong in high-dimensional spaces; can be slower to train on large datasets.',
  xgboost: 'Sequential gradient-boosted trees, each one correcting the errors of the last. Frequently the top performer on structured/tabular data.',
  naive_bayes: 'A probabilistic classifier that assumes features are independent given the class. Very fast, a strong baseline, especially with limited data.',
  linear_regression: 'Fits a straight line (or hyperplane) that minimizes squared error against the target. No hyperparameters — trains immediately.',
  ridge_regression: 'Linear regression with L2 regularization — shrinks coefficients to reduce overfitting, especially helpful when features are correlated.',
  random_forest_regressor: 'An ensemble of regression trees averaged together. Robust to outliers and non-linear relationships, minimal tuning required.',
  kmeans: 'Groups rows into K clusters by iteratively minimizing distance to each cluster\'s centroid. Requires choosing K — use the elbow curve to find a good value.',
}

const METRIC_INFO = {
  accuracy:  { label: 'Accuracy',  desc: '(TP+TN) / total. Overall correctness. Best when classes are roughly balanced — can be misleading otherwise.' },
  f1:        { label: 'F1-Score',  desc: 'Harmonic mean of Precision and Recall. Best when you want a balance of both — e.g. spam detection.' },
  precision: { label: 'Precision', desc: 'Of everything predicted positive, how many truly were? Use when false positives are costly — e.g. flagging legitimate customers.' },
  recall:    { label: 'Recall',    desc: 'Of all actual positives, how many did the model catch? Use when false negatives are costly — e.g. missing a real diagnosis.' },
}

// ─────────────────────────────────────────────────────────────────────────────
// GRID SEARCH — default parameter cards per model (from the user's own list)
// and the full parameter set for "Edit Attributes Manually" (superset).
// ─────────────────────────────────────────────────────────────────────────────
const GRID_SEARCH_DEFAULTS = {
  knn:                      [{ name: 'metric', label: 'Distance metric', values: ['euclidean', 'manhattan'] }],
  decision_tree:            [{ name: 'criterion', label: 'Criterion', values: ['gini', 'entropy'] },
                              { name: 'max_depth', label: 'Max depth', values: [3, 5, 10] },
                              { name: 'min_samples_split', label: 'Min samples split', values: [2, 5] }],
  random_forest:            [{ name: 'n_estimators', label: 'Number of trees', values: [50, 100, 200] },
                              { name: 'max_depth', label: 'Max depth', values: [3, 5, 10] },
                              { name: 'min_samples_split', label: 'Min samples split', values: [2, 5] }],
  logistic_regression:      [{ name: 'max_iter', label: 'Max iterations', values: [100, 500] },
                              { name: 'penalty', label: 'Regularization', values: ['l2', 'l1'] }],
  svm:                      [{ name: 'kernel', label: 'Kernel', values: ['linear', 'rbf'] },
                              { name: 'C', label: 'C (regularization)', values: [0.1, 1.0, 10.0] },
                              { name: 'gamma', label: 'Gamma (RBF/poly)', values: ['scale', 'auto'] }],
  xgboost:                  [{ name: 'learning_rate', label: 'Learning rate', values: [0.01, 0.1] },
                              { name: 'max_depth', label: 'Max depth', values: [3, 5, 7] },
                              { name: 'n_estimators', label: 'Number of trees', values: [50, 100] }],
  naive_bayes:              [],
  linear_regression:        [],
  ridge_regression:         [{ name: 'alpha', label: 'Alpha (regularization)', values: [0.1, 1.0, 10.0] }],
  random_forest_regressor:  [{ name: 'n_estimators', label: 'Number of trees', values: [50, 100, 200] },
                              { name: 'max_depth', label: 'Max depth', values: [3, 5, 10] }],
  kmeans:                   [{ name: 'max_iter', label: 'Max iterations', values: [100, 300] }],
}

const MODEL_PARAM_DEFS = {
  knn: [
    { name: 'n_neighbors', label: 'K (neighbors)', type: 'number', default: 5, min: 1, max: 99 },
    { name: 'metric', label: 'Distance metric', type: 'select', options: ['euclidean', 'manhattan'], default: 'euclidean' },
  ],
  decision_tree: [
    { name: 'criterion', label: 'Criterion', type: 'select', options: ['gini', 'entropy'], default: 'gini' },
    { name: 'max_depth', label: 'Max depth', type: 'number', default: 6, min: 1, max: 50 },
    { name: 'min_samples_split', label: 'Min samples split', type: 'number', default: 2, min: 2 },
  ],
  random_forest: [
    { name: 'n_estimators', label: 'Number of trees', type: 'number', default: 100, min: 10, max: 1000 },
    { name: 'max_depth', label: 'Max depth', type: 'number', default: 10, min: 1, max: 50 },
    { name: 'min_samples_split', label: 'Min samples split', type: 'number', default: 2, min: 2 },
  ],
  logistic_regression: [
    { name: 'max_iter', label: 'Max iterations', type: 'number', default: 1000, min: 100, max: 5000 },
    { name: 'C', label: 'Regularization (C)', type: 'number', default: 1.0, step: 0.1 },
    { name: 'penalty', label: 'Penalty', type: 'select', options: ['l2', 'l1'], default: 'l2' },
  ],
  svm: [
    { name: 'kernel', label: 'Kernel', type: 'select', options: ['rbf', 'linear', 'poly'], default: 'rbf' },
    { name: 'C', label: 'C (regularization)', type: 'number', default: 1.0, step: 0.1 },
    { name: 'gamma', label: 'Gamma', type: 'select', options: ['scale', 'auto'], default: 'scale' },
  ],
  xgboost: [
    { name: 'n_estimators', label: 'Estimators', type: 'number', default: 100, min: 10, max: 1000 },
    { name: 'max_depth', label: 'Max depth', type: 'number', default: 6, min: 1, max: 20 },
    { name: 'learning_rate', label: 'Learning rate', type: 'number', default: 0.1, step: 0.01 },
    { name: 'subsample', label: 'Subsample ratio', type: 'number', default: 1.0, step: 0.1, min: 0.1, max: 1.0 },
  ],
  naive_bayes: [],
  linear_regression: [],
  ridge_regression: [{ name: 'alpha', label: 'Alpha', type: 'number', default: 1.0, step: 0.1 }],
  random_forest_regressor: [
    { name: 'n_estimators', label: 'Number of trees', type: 'number', default: 100, min: 10, max: 1000 },
    { name: 'max_depth', label: 'Max depth', type: 'number', default: 10, min: 1, max: 50 },
  ],
  kmeans: [
    { name: 'n_clusters', label: 'Number of clusters (K)', type: 'number', default: 3, min: 2, max: 30 },
    { name: 'max_iter', label: 'Max iterations', type: 'number', default: 300, min: 10 },
    { name: 'random_state', label: 'Random state', type: 'number', default: 42 },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// INFO ICON — small "ⓘ" popovers, placed at the 5 primary explanation spots
// the user specified (metric, model, split/CV, grid search, threshold).
// ─────────────────────────────────────────────────────────────────────────────
const InfoIcon = ({ content }) => {
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
            padding: '14px 16px', width: 300, boxShadow: shadow, fontSize: 12,
            color: C.text, lineHeight: 1.65, whiteSpace: 'pre-line',
          }}>
            {content}
          </div>
        </>
      )}
    </span>
  )
}

const SectionLabel = ({ children, info }) => {
  const { C } = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 800,
      color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
      {children}{info}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL DROPDOWN — grouped, scrollable card list
// ─────────────────────────────────────────────────────────────────────────────
const ModelDropdown = ({ taskType, selected, onSelect, onClose }) => {
  const { C } = useTheme()
  const groups = MODEL_GROUPS[taskType] || []
  return (
    <div style={{
      position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 300,
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      boxShadow: shadow, width: 300, maxHeight: 340, overflowY: 'auto', padding: 6,
    }}>
      {groups.map(g => (
        <div key={g.group} style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: C.muted, textTransform: 'uppercase',
            letterSpacing: 0.8, padding: '8px 10px 4px' }}>{g.group}</div>
          {g.models.map(m => (
            <div key={m.id} onClick={() => { onSelect(m.id); onClose() }}
              style={{
                padding: '9px 12px', borderRadius: 8, cursor: 'pointer', display: 'flex',
                alignItems: 'center', gap: 8, fontSize: 13,
                fontWeight: selected === m.id ? 700 : 500,
                color: selected === m.id ? C.primary : C.text,
                background: selected === m.id ? C.primarySoft : 'transparent',
              }}
              onMouseEnter={e => { if (selected !== m.id) e.currentTarget.style.background = C.faint }}
              onMouseLeave={e => { if (selected !== m.id) e.currentTarget.style.background = 'transparent' }}>
              <span>{m.icon}</span>{m.label}
            </div>
          ))}
        </div>
      ))}
      {groups.length === 0 && (
        <div style={{ padding: 16, fontSize: 12, color: C.muted, textAlign: 'center' }}>
          No models available for this task type.
        </div>
      )}
    </div>
  )
}

const MetricDropdown = ({ selected, onSelect, onClose }) => {
  const { C } = useTheme()
  return (
    <div style={{
      position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 300,
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      boxShadow: shadow, width: 280, padding: 6,
    }}>
      {Object.entries(METRIC_INFO).map(([key, info]) => (
        <div key={key} onClick={() => { onSelect(key); onClose() }}
          style={{
            padding: '9px 12px', borderRadius: 8, cursor: 'pointer', marginBottom: 2,
            background: selected === key ? C.primarySoft : 'transparent',
          }}
          onMouseEnter={e => { if (selected !== key) e.currentTarget.style.background = C.faint }}
          onMouseLeave={e => { if (selected !== key) e.currentTarget.style.background = 'transparent' }}>
          <div style={{ fontSize: 13, fontWeight: selected === key ? 700 : 600,
            color: selected === key ? C.primary : C.text }}>{info.label}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{info.desc}</div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ELBOW CHART — shared by KNN (metric vs k) and K-Means (inertia vs k).
// Click anywhere on the line to pick that k; best-k point pulses; Brush
// gives zoom/pan; Tooltip shows precise x/y on hover.
// ─────────────────────────────────────────────────────────────────────────────
const ElbowChart = ({ kValues, values, bestK, yLabel, currentK, onPick }) => {
  const { C } = useTheme()
  const data = kValues.map((k, i) => ({ k, value: values[i] }))

  const handleClick = (e) => {
    if (!e || !e.activeLabel) return
    // Snap to the nearest k actually present in the data (odd values for
    // KNN, contiguous for K-Means) rather than trusting the raw pixel x.
    const clickedK = Number(e.activeLabel)
    const nearest = kValues.reduce((best, k) => Math.abs(k - clickedK) < Math.abs(best - clickedK) ? k : best, kValues[0])
    onPick(nearest)
  }

  const CustomDot = (props) => {
    const { cx, cy, payload } = props
    const isBest = payload.k === bestK
    const isCurrent = payload.k === currentK
    if (isBest) {
      return (
        <g>
          <circle cx={cx} cy={cy} r={9} fill={C.success} opacity={0.25}>
            <animate attributeName="r" values="7;12;7" dur="1.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.35;0.05;0.35" dur="1.8s" repeatCount="indefinite" />
          </circle>
          <circle cx={cx} cy={cy} r={6} fill={C.success} stroke="white" strokeWidth={2} />
        </g>
      )
    }
    if (isCurrent) return <circle cx={cx} cy={cy} r={5} fill={C.primary} stroke="white" strokeWidth={1.5} />
    return <circle cx={cx} cy={cy} r={2.5} fill={C.primary} opacity={0.5} />
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} onClick={handleClick} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}
          style={{ cursor: 'pointer' }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.faint} />
          <XAxis dataKey="k" type="number" domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 11, fill: C.muted }} label={{ value: 'k', position: 'insideBottom', offset: -2, fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11, fill: C.muted }}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11 }} />
          <Tooltip
            formatter={(v) => [Number(v).toFixed(4), yLabel]}
            labelFormatter={(k) => `k = ${k}`}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.border}` }} />
          {bestK != null && (
            <ReferenceLine x={bestK} stroke={C.success} strokeDasharray="5,3"
              label={{ value: `Best k = ${bestK}`, position: 'top', fill: C.success, fontSize: 12, fontWeight: 700 }} />
          )}
          <Line type="monotone" dataKey="value" stroke={C.primary} strokeWidth={2.5} dot={<CustomDot />} isAnimationActive={false} />
          <Brush dataKey="k" height={22} stroke={C.primary} fill={C.faint} travellerWidth={8} />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 11.5, color: C.muted, textAlign: 'center', marginTop: 2 }}>
        Click anywhere on the curve to select k · currently k = <strong style={{ color: C.text }}>{currentK}</strong> · drag the strip below to zoom
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFUSION MATRIX — custom SVG heatmap. Diagonal (correct) green-tinted,
// off-diagonal (errors) red-tinted, intensity scales with count.
// ─────────────────────────────────────────────────────────────────────────────
const ConfusionMatrix = ({ matrix, classes }) => {
  const { C } = useTheme()
  if (!matrix?.length) return null
  const N = classes.length
  const CELL = Math.max(46, Math.min(80, 340 / N))
  const LABEL_W = 90
  const maxVal = Math.max(1, ...matrix.flat())
  const short = (s) => (s.length > 10 ? s.slice(0, 9) + '…' : s)

  const cellFill = (val, isDiag) => {
    const intensity = val / maxVal
    return isDiag ? `rgba(16,185,129,${0.08 + intensity * 0.75})` : `rgba(239,68,68,${0.05 + intensity * 0.65})`
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={LABEL_W + N * CELL + 20} height={LABEL_W + N * CELL + 20}>
        <text x={LABEL_W + (N * CELL) / 2} y={14} textAnchor="middle" fontSize={11} fontWeight={700} fill={C.muted}>
          Predicted
        </text>
        <text x={14} y={LABEL_W + (N * CELL) / 2} textAnchor="middle" fontSize={11} fontWeight={700}
          fill={C.muted} transform={`rotate(-90, 14, ${LABEL_W + (N * CELL) / 2})`}>Actual</text>
        {classes.map((cls, j) => (
          <text key={j} x={LABEL_W + j * CELL + CELL / 2} y={LABEL_W - 8}
            textAnchor="middle" fontSize={10.5} fontWeight={700} fill={C.text}>{short(cls)}</text>
        ))}
        {classes.map((cls, i) => (
          <text key={i} x={LABEL_W - 8} y={LABEL_W + i * CELL + CELL / 2 + 4}
            textAnchor="end" fontSize={10.5} fontWeight={700} fill={C.text}>{short(cls)}</text>
        ))}
        {matrix.map((row, i) => row.map((val, j) => {
          const isDiag = i === j
          return (
            <g key={`${i}-${j}`}>
              <rect x={LABEL_W + j * CELL} y={LABEL_W + i * CELL} width={CELL - 3} height={CELL - 3}
                rx={6} fill={cellFill(val, isDiag)} stroke={isDiag ? C.success : C.border} strokeWidth={isDiag ? 1.5 : 1} />
              <text x={LABEL_W + j * CELL + (CELL - 3) / 2} y={LABEL_W + i * CELL + (CELL - 3) / 2 + 5}
                textAnchor="middle" fontSize={13} fontWeight={800} fill={isDiag ? '#065f46' : C.text}>{val}</text>
            </g>
          )
        }))}
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: C.muted }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'rgba(16,185,129,0.5)', marginRight: 5 }} />Correct</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'rgba(239,68,68,0.4)', marginRight: 5 }} />Misclassified</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DECISION TREE — recursive custom SVG renderer, zoomable.
// ─────────────────────────────────────────────────────────────────────────────
const TreeNode = ({ node, x, y, width, C }) => {
  if (!node) return null
  const nodeW = 132, nodeH = 50, gap = 24

  if (node.type === 'leaf') {
    return (
      <g>
        <rect x={x - nodeW / 2} y={y} width={nodeW} height={nodeH} rx={10}
          fill={C.successSoft} stroke={C.success} strokeWidth={1.5} />
        <text x={x} y={y + 19} textAnchor="middle" fontSize={11} fontWeight={800} fill={C.text}>
          {String(node.class).length > 14 ? String(node.class).slice(0, 13) + '…' : node.class}
        </text>
        <text x={x} y={y + 35} textAnchor="middle" fontSize={9.5} fill={C.muted}>
          {node.samples} samples · {(node.confidence * 100).toFixed(0)}%{node.truncated ? ' ⋯' : ''}
        </text>
      </g>
    )
  }
  const leftX = x - width / 4, rightX = x + width / 4, childY = y + nodeH + gap + 26
  return (
    <g>
      <line x1={x} y1={y + nodeH} x2={leftX} y2={childY} stroke={C.border} strokeWidth={1.5} />
      <line x1={x} y1={y + nodeH} x2={rightX} y2={childY} stroke={C.border} strokeWidth={1.5} />
      <text x={(x + leftX) / 2 - 4} y={y + nodeH + 15} fontSize={9.5} fontWeight={700} fill={C.success}>Yes</text>
      <text x={(x + rightX) / 2 + 4} y={y + nodeH + 15} fontSize={9.5} fontWeight={700} fill={C.danger}>No</text>
      <rect x={x - nodeW / 2} y={y} width={nodeW} height={nodeH} rx={8}
        fill={C.primarySoft} stroke={C.primary} strokeWidth={1.5} />
      <text x={x} y={y + 18} textAnchor="middle" fontSize={10.5} fontWeight={800} fill={C.primary}>
        {String(node.feature).length > 15 ? String(node.feature).slice(0, 14) + '…' : node.feature}
      </text>
      <text x={x} y={y + 33} textAnchor="middle" fontSize={9.5} fill={C.muted}>≤ {node.threshold}</text>
      <text x={x} y={y + 46} textAnchor="middle" fontSize={8.5} fill={C.muted}>{node.samples} samples</text>
      <TreeNode node={node.left} x={leftX} y={childY} width={width / 2} C={C} />
      <TreeNode node={node.right} x={rightX} y={childY} width={width / 2} C={C} />
    </g>
  )
}

const DecisionTreeViz = ({ tree }) => {
  const { C } = useTheme()
  const [zoom, setZoom] = useState(1)
  if (!tree) return null
  return (
    <div>
      <div style={{ overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 12, background: C.faint, maxHeight: 480 }}>
        <svg width={1000 * zoom} height={620 * zoom} style={{ display: 'block' }}>
          <g transform={`scale(${zoom})`}>
            <TreeNode node={tree} x={500} y={16} width={960} C={C} />
          </g>
        </svg>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button onClick={() => setZoom(z => Math.max(0.4, +(z - 0.2).toFixed(1)))}
          style={zoomBtnStyle(C)}>🔍−</button>
        <button onClick={() => setZoom(1)} style={zoomBtnStyle(C)}>Reset</button>
        <button onClick={() => setZoom(z => Math.min(2, +(z + 0.2).toFixed(1)))}
          style={zoomBtnStyle(C)}>🔍+</button>
        <span style={{ fontSize: 11, color: C.muted, marginLeft: 4 }}>{Math.round(zoom * 100)}%</span>
        {tree && <span style={{ fontSize: 11, color: C.muted, marginLeft: 'auto' }}>Depth capped at 5 for display — the trained model itself is unaffected.</span>}
      </div>
    </div>
  )
}
const zoomBtnStyle = (C) => ({
  padding: '5px 12px', borderRadius: 7, border: `1px solid ${C.border}`,
  background: C.card, color: C.text, fontSize: 12, fontWeight: 600, cursor: 'pointer',
})

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE IMPORTANCE / COEFFICIENTS — horizontal bar chart
// ─────────────────────────────────────────────────────────────────────────────
const ImportanceBar = ({ data, valueKey, labelKey, title }) => {
  const { C } = useTheme()
  if (!data?.length) return null
  const chartData = [...data].slice(0, 15).map(d => ({ ...d, __abs: Math.abs(d[valueKey]) }))
  chartData.sort((a, b) => b.__abs - a.__abs)
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 28)}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.faint} />
          <XAxis type="number" tick={{ fontSize: 10, fill: C.muted }} />
          <YAxis dataKey={labelKey} type="category" width={110} tick={{ fontSize: 11, fill: C.text }} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
          <ReferenceLine x={0} stroke={C.border} />
          <Bar dataKey={valueKey} radius={[0, 4, 4, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d[valueKey] >= 0 ? C.primary : C.danger} opacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

const SigmoidChart = ({ points, threshold }) => {
  const { C } = useTheme()
  if (!points?.length) return null
  return (
    <ChartCard title="Sigmoid Function" sub="How Logistic Regression converts a raw score into a class probability.">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={points} margin={{ left: -10, right: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.faint} />
          <XAxis dataKey="x" tick={{ fontSize: 10, fill: C.muted }} label={{ value: 'raw score', position: 'insideBottom', offset: -2, fontSize: 10 }} />
          <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: C.muted }} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={v => Number(v).toFixed(3)} />
          <ReferenceLine y={threshold} stroke={C.warning} strokeDasharray="4,2"
            label={{ value: `threshold ${threshold}`, fontSize: 10, fill: C.warning, position: 'insideTopRight' }} />
          <Line type="monotone" dataKey="y" stroke={C.primary} strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

const RegressionScatterChart = ({ scatter }) => {
  const { C } = useTheme()
  if (!scatter?.length) return null
  const vals = scatter.flatMap(d => [d.actual, d.predicted]).filter(v => v != null)
  const lo = Math.min(...vals), hi = Math.max(...vals)
  return (
    <ChartCard title="Actual vs. Predicted" sub="Points on the red dashed line are perfect predictions.">
      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.faint} />
          <XAxis dataKey="actual" type="number" name="Actual" domain={[lo, hi]} tick={{ fontSize: 10, fill: C.muted }} />
          <YAxis dataKey="predicted" type="number" name="Predicted" domain={[lo, hi]} tick={{ fontSize: 10, fill: C.muted }} />
          <ZAxis range={[16, 16]} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={v => Number(v).toFixed(3)} />
          <Scatter data={scatter} fill={C.primary} opacity={0.55} />
          <ReferenceLine segment={[{ x: lo, y: lo }, { x: hi, y: hi }]} stroke={C.danger} strokeDasharray="5,3" strokeWidth={1.5} />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

const CoefficientsTable = ({ coefficients, intercept }) => {
  const { C } = useTheme()
  if (!coefficients?.length) return null
  return (
    <ChartCard title="Coefficients" sub={intercept != null ? `Intercept: ${intercept}` : undefined}>
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr style={{ background: C.faint }}>
            <th style={thStyle(C)}>Feature</th><th style={thStyle(C)}>Coefficient</th>
          </tr></thead>
          <tbody>
            {[...coefficients].sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef)).map((c, i) => (
              <tr key={c.feature} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? C.faint : 'transparent' }}>
                <td style={tdStyle(C)}>{c.feature}</td>
                <td style={{ ...tdStyle(C), fontWeight: 700, color: c.coef >= 0 ? C.primary : C.danger }}>{c.coef}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  )
}
const thStyle = (C) => ({ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6 })
const tdStyle = (C) => ({ padding: '8px 12px', color: C.text })

// ─────────────────────────────────────────────────────────────────────────────
// NAIVE BAYES — small custom Bayesian network: one Class node, edges out to
// every feature, edge weight = how much that feature's per-class mean
// varies (the NB-native "this feature actually helps discriminate" signal).
// ─────────────────────────────────────────────────────────────────────────────
const BayesNetworkViz = ({ network }) => {
  const { C } = useTheme()
  if (!network?.features?.length) return null
  const feats = network.features.slice(0, 8)
  const N = feats.length
  const CX = 160, CY = 200, R = 150
  const maxInfluence = Math.max(...feats.map(f => f.influence), 0.001)
  return (
    <ChartCard title="Feature Influence Network (Naive Bayes)"
      sub="Thicker edge = that feature's mean differs more across classes — the signal Naive Bayes actually relies on.">
      <svg width={340} height={400}>
        <circle cx={CX} cy={CY} r={34} fill={C.primary} opacity={0.15} stroke={C.primary} strokeWidth={2} />
        <text x={CX} y={CY - 4} textAnchor="middle" fontSize={11} fontWeight={800} fill={C.primary}>Class</text>
        <text x={CX} y={CY + 10} textAnchor="middle" fontSize={8.5} fill={C.muted}>{network.classes?.length || 0} classes</text>
        {feats.map((f, i) => {
          const angle = (i / N) * 2 * Math.PI - Math.PI / 2
          const fx = CX + R * Math.cos(angle), fy = CY + R * Math.sin(angle)
          const w = 1 + (f.influence / maxInfluence) * 5
          return (
            <g key={f.feature}>
              <line x1={CX} y1={CY} x2={fx} y2={fy} stroke={C.success} strokeWidth={w} opacity={0.5} />
              <circle cx={fx} cy={fy} r={26} fill={C.successSoft} stroke={C.success} strokeWidth={1.5} />
              <text x={fx} y={fy - 2} textAnchor="middle" fontSize={9} fontWeight={700} fill={C.text}>
                {f.feature.length > 9 ? f.feature.slice(0, 8) + '…' : f.feature}
              </text>
              <text x={fx} y={fy + 10} textAnchor="middle" fontSize={8} fill={C.muted}>{f.influence}</text>
            </g>
          )
        })}
      </svg>
    </ChartCard>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CLUSTERING VIZ — scatter with centroids, cluster size histogram, entropy.
// ─────────────────────────────────────────────────────────────────────────────
const ClusterScatterChart = ({ viz }) => {
  const { C } = useTheme()
  if (!viz?.scatter) return null
  const byCluster = {}
  viz.scatter.forEach(p => { (byCluster[p.cluster] ??= []).push(p) })
  return (
    <ChartCard title="Cluster Map" sub={`${viz.x_label} vs. ${viz.y_label} — ✦ marks each cluster's centroid.`}>
      <ResponsiveContainer width="100%" height={340}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.faint} />
          <XAxis dataKey="x" type="number" name={viz.x_label} tick={{ fontSize: 10, fill: C.muted }} />
          <YAxis dataKey="y" type="number" name={viz.y_label} tick={{ fontSize: 10, fill: C.muted }} />
          <ZAxis range={[16, 16]} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
          {Object.entries(byCluster).map(([cl, pts]) => (
            <Scatter key={cl} name={`Cluster ${cl}`} data={pts} fill={CLASS_COLORS[cl % CLASS_COLORS.length]} opacity={0.55} />
          ))}
          <Scatter name="Centroids" data={viz.centroids} shape="star"
            fill="none" legendType="none">
            {viz.centroids.map((c, i) => (
              <Cell key={i} fill={CLASS_COLORS[c.cluster % CLASS_COLORS.length]} stroke={C.text} strokeWidth={1.5} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// METRIC CARD — matches the left-border-accent style established in
// DataReadiness.jsx (explicit prior feedback: no plain bordered boxes).
// ─────────────────────────────────────────────────────────────────────────────
const MetricCard = ({ label, value, sub, accent }) => {
  const { C } = useTheme()
  const ac = accent || C.primary
  return (
    <div style={{
      background: C.card, borderRadius: cardR, padding: '16px 18px', position: 'relative',
      overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.03)',
      borderLeft: `4px solid ${ac}`,
    }}>
      <div style={{ position: 'absolute', top: -26, right: -26, width: 70, height: 70, borderRadius: '50%', background: `${ac}12` }} />
      <div style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: C.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: C.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

const ChartCard = ({ title, sub, children, action, style: extraStyle }) => {
  const { C } = useTheme()
  return (
    <div style={{ background: C.card, borderRadius: 14, padding: '16px 18px', boxShadow: shadow2, border: `1px solid ${C.border}`, ...extraStyle }}>
      {(title || action) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            {title && <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{title}</div>}
            {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EDIT ATTRIBUTES POPUP
// ─────────────────────────────────────────────────────────────────────────────
const EditAttributesPopup = ({ modelId, values, onApply, onClose }) => {
  const { C } = useTheme()
  const defs = MODEL_PARAM_DEFS[modelId] || []
  const [local, setLocal] = useState(() => {
    const init = {}
    defs.forEach(d => { init[d.name] = values?.[d.name] ?? d.default })
    return init
  })
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, borderRadius: 16, padding: 26, width: 480, maxWidth: '90vw',
        maxHeight: '82vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
      }}>
        <div style={{ fontWeight: 900, fontSize: 17, color: C.text, marginBottom: 2 }}>
          Model Parameters — {modelLabel(modelId)}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>
          {defs.length ? 'Edit the exact values this model will train with.' : 'This model has no tunable parameters — it trains immediately.'}
        </div>
        {defs.map(d => (
          <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{d.label}</span>
            {d.type === 'select' ? (
              <select value={local[d.name]} onChange={e => setLocal(p => ({ ...p, [d.name]: e.target.value }))}
                style={selectStyle(C)}>
                {d.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type="number" step={d.step || 1} min={d.min} max={d.max}
                value={local[d.name]}
                onChange={e => setLocal(p => ({ ...p, [d.name]: e.target.value === '' ? '' : Number(e.target.value) }))}
                style={inputStyle(C)} />
            )}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={ghostBtnStyle(C)}>Cancel</button>
          <button onClick={() => { onApply(local); onClose() }} style={primaryBtnStyle(C)}>Apply</button>
        </div>
      </div>
    </div>
  )
}
const selectStyle = (C) => ({ padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 12.5 })
const inputStyle = (C) => ({ width: 100, padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 12.5, textAlign: 'right' })
const ghostBtnStyle = (C) => ({ padding: '9px 18px', borderRadius: 9, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontWeight: 700, fontSize: 13, cursor: 'pointer' })
const primaryBtnStyle = (C) => ({ padding: '9px 20px', borderRadius: 9, border: 'none', background: C.primary, color: 'white', fontWeight: 800, fontSize: 13, cursor: 'pointer', boxShadow: `0 4px 14px ${C.primary}44` })

// ─────────────────────────────────────────────────────────────────────────────
// EDIT OUTPUT POPUP
// ─────────────────────────────────────────────────────────────────────────────
const EditOutputPopup = ({ options, onApply, onClose }) => {
  const { C } = useTheme()
  const [local, setLocal] = useState(options)
  const ROWS = [
    ['confusion_matrix', 'Confusion matrix'],
    ['per_class_stats', 'Per-class statistics (precision / recall / F1)'],
    ['model_summary', 'Model summary'],
    ['learning_curve', 'Learning curve (slower — reruns the model)'],
  ]
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, borderRadius: 16, padding: 26, width: 380, boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
      }}>
        <div style={{ fontWeight: 900, fontSize: 16, color: C.text, marginBottom: 16 }}>Output Options</div>
        {ROWS.map(([key, label]) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', cursor: 'pointer', fontSize: 13, color: C.text }}>
            <input type="checkbox" checked={!!local[key]} onChange={e => setLocal(p => ({ ...p, [key]: e.target.checked }))} />
            {label}
          </label>
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={ghostBtnStyle(C)}>Cancel</button>
          <button onClick={() => { onApply(local); onClose() }} style={primaryBtnStyle(C)}>Apply</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL ACTIONS MENU (⋮ on a history row)
// ─────────────────────────────────────────────────────────────────────────────
const ModelActionsMenu = ({ entry, onView, onDownload, onVisualizeTree, onDelete, onClose }) => {
  const { C } = useTheme()
  const isTree = entry.model_name === 'decision_tree'
  const items = [
    ['👁', 'View output', onView],
    ['⬇', 'Download model (.pkl)', onDownload],
    ...(isTree ? [['🌳', 'Visualize tree', onVisualizeTree]] : []),
    ['🗑', 'Delete from history', onDelete],
  ]
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
      <div style={{
        position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 999,
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
        boxShadow: shadow, width: 210, padding: 5,
      }}>
        {items.map(([icon, label, fn]) => (
          <div key={label} onClick={() => { fn(); onClose() }}
            style={{ padding: '8px 10px', borderRadius: 7, fontSize: 12.5, color: C.text, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center' }}
            onMouseEnter={e => e.currentTarget.style.background = C.faint}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <span>{icon}</span>{label}
          </div>
        ))}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function TrainTestPage({ projectData, onNext, onUpdateData,
  getDisplayPath, versions, active, onNavigate, furthestOrder }) {
  const { C } = useTheme()

  const filePath = getDisplayPath ? getDisplayPath('training') : projectData?.filePath
  const targetColumn = projectData?.targetColumn || null
  const taskType = projectData?.taskType === 'regression' ? 'regression'
    : projectData?.taskType === 'clustering' ? 'clustering' : 'classification'

  // ── Settings state (persists for the page's lifetime) ──────────────────
  const [selectedModel, setSelectedModel] = useState('')
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [selectedMetric, setSelectedMetric] = useState('accuracy')
  const [metricDropdownOpen, setMetricDropdownOpen] = useState(false)
  const [treeCriterion, setTreeCriterion] = useState('gini')

  const [kValue, setKValue] = useState(null)
  const [elbowData, setElbowData] = useState(null)
  const [elbowLoading, setElbowLoading] = useState(false)

  const [splitMethod, setSplitMethod] = useState('train_test')
  const [splitRatio, setSplitRatio] = useState(0.8)
  const [cvFolds, setCvFolds] = useState(5)
  const [stratified, setStratified] = useState(true)

  const [gridSearchEnabled, setGridSearchEnabled] = useState(false)
  const [gridParams, setGridParams] = useState([])
  const [gridSearchResult, setGridSearchResult] = useState(null)
  const [gridSearchLoading, setGridSearchLoading] = useState(false)
  const [gridError, setGridError] = useState('')

  const [modelParams, setModelParams] = useState({})
  const [showEditParams, setShowEditParams] = useState(false)

  const [threshold, setThreshold] = useState(0.5)

  const [trainingLoading, setTrainingLoading] = useState(false)
  const [trainingError, setTrainingError] = useState('')

  const [outputOptions, setOutputOptions] = useState({
    confusion_matrix: true, per_class_stats: true, model_summary: true, learning_curve: false,
  })
  const [showEditOutput, setShowEditOutput] = useState(false)

  const [modelHistory, setModelHistory] = useState([])
  const [activeResult, setActiveResult] = useState(null)
  const [historyMenuOpen, setHistoryMenuOpen] = useState(null)
  const [treePopupEntry, setTreePopupEntry] = useState(null)

  const [defaults, setDefaults] = useState(null)

  // ── Load defaults once we know the dataset ──────────────────────────────
  useEffect(() => {
    if (!filePath) return
    callTraining('defaults', { file_path: filePath, target_column: targetColumn })
      .then(d => {
        setDefaults(d)
        if (d.split_ratio?.train) setSplitRatio(d.split_ratio.train)
        if (d.split_ratio?.recommend_cv) setSplitMethod('cross_validation')
        if (d.k_folds) setCvFolds(d.k_folds)
      })
      .catch(() => {})
  }, [filePath, targetColumn])

  // ── Elbow curve on model selection (KNN / K-Means) ──────────────────────
  useEffect(() => {
    if (!filePath) return
    if (selectedModel === 'knn') {
      setElbowLoading(true); setElbowData(null)
      callTraining('elbow-knn', { file_path: filePath, target_column: targetColumn, metric: selectedMetric })
        .then(d => { setElbowData(d); setKValue(d.best_k) })
        .catch(e => setTrainingError(e.message))
        .finally(() => setElbowLoading(false))
    } else if (selectedModel === 'kmeans') {
      setElbowLoading(true); setElbowData(null)
      callTraining('elbow-kmeans', { file_path: filePath, max_k: 15 })
        .then(d => { setElbowData(d); setKValue(d.best_k) })
        .catch(e => setTrainingError(e.message))
        .finally(() => setElbowLoading(false))
    } else {
      setElbowData(null); setKValue(null)
    }
  }, [selectedModel, filePath])

  // Re-run KNN elbow when the metric focus changes (Y-axis depends on it)
  useEffect(() => {
    if (selectedModel !== 'knn' || !filePath || !elbowData) return
    callTraining('elbow-knn', { file_path: filePath, target_column: targetColumn, metric: selectedMetric })
      .then(d => setElbowData(prev => ({ ...d, best_k: prev?.best_k === kValue ? d.best_k : prev.best_k })))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMetric])

  // ── Grid search parameter cards reset when model changes ───────────────
  useEffect(() => {
    setGridParams((GRID_SEARCH_DEFAULTS[selectedModel] || []).map(p => ({ ...p, best: null })))
    setGridSearchResult(null)
    setModelParams({})
  }, [selectedModel])

  const handleModelSelect = (id) => {
    setSelectedModel(id)
    setActiveResult(null)
    if (id === 'kmeans') setModelParams(p => ({ ...p, n_clusters: kValue || 3 }))
    if (id === 'knn') setModelParams(p => ({ ...p, n_neighbors: kValue || 5 }))
  }

  const handleKPick = (k) => {
    setKValue(k)
    if (selectedModel === 'knn') setModelParams(p => ({ ...p, n_neighbors: k }))
    if (selectedModel === 'kmeans') setModelParams(p => ({ ...p, n_clusters: k }))
  }

  const addGridParam = () => setGridParams(p => [...p, { name: '', label: '', values: [], best: null, custom: true }])
  const updateGridParam = (i, patch) => setGridParams(p => p.map((g, idx) => idx === i ? { ...g, ...patch } : g))
  const removeGridParam = (i) => setGridParams(p => p.filter((_, idx) => idx !== i))

  const runGridSearch = async () => {
    setGridSearchLoading(true); setGridError(''); setGridSearchResult(null)
    try {
      const grid = {}
      gridParams.forEach(p => { if (p.name && p.values?.length) grid[p.name] = p.values })
      const result = await callTraining('grid-search', {
        file_path: filePath, target_column: targetColumn, task_type: taskType,
        model_name: selectedModel, param_grid: grid, metric: selectedMetric,
        cv_folds: cvFolds, stratified,
      })
      setGridSearchResult(result)
      setGridParams(p => p.map(g => ({ ...g, best: result.best_params?.[g.name] ?? null })))
    } catch (e) { setGridError(e.message) }
    finally { setGridSearchLoading(false) }
  }

  const applyGridSearch = () => {
    if (!gridSearchResult) return
    setModelParams(p => ({ ...p, ...gridSearchResult.best_params }))
  }

  const handleTrain = async () => {
    if (!selectedModel) return
    setTrainingLoading(true); setTrainingError('')
    try {
      const params = { ...modelParams }
      if (selectedModel === 'decision_tree' && !params.criterion) params.criterion = treeCriterion
      const result = await callTraining('train', {
        file_path: filePath, target_column: taskType === 'clustering' ? null : targetColumn,
        task_type: taskType, model_name: selectedModel, model_params: params,
        split_method: splitMethod, split_ratio: splitRatio, cv_folds: cvFolds, stratified,
        metric: selectedMetric, threshold, output_options: outputOptions,
      })
      setModelHistory(h => [result, ...h])
      setActiveResult(result)
      // Threads the freshly-saved .pkl path (and enough of this run's own
      // result to build the Report page's Key Findings/metrics strip
      // without Report having to re-derive or re-run anything) up to
      // App.jsx — always the MOST RECENT successful training run, matching
      // the pasted integration spec's `projectData?.lastModelPath`.
      const metricsByTask = {
        classification: { accuracy: result.accuracy, f1: result.f1, precision: result.precision, recall: result.recall },
        regression:     { r2: result.r2, mae: result.mae, rmse: result.rmse },
        clustering:     { n_clusters: result.n_clusters, inertia: result.inertia, entropy: result.entropy },
      }
      if (onUpdateData) onUpdateData({
        lastModelPath: result.model_file,
        lastModelName: result.model_name,
        lastModelParams: params,
        lastMetrics: metricsByTask[taskType] || {},
        trainRatio: splitRatio,
      })
    } catch (e) { setTrainingError(e.message) }
    finally { setTrainingLoading(false) }
  }

  const downloadModel = (entry) => {
    const url = `${ML_API}/training/model/download?model_file=${encodeURIComponent(entry.model_file)}&model_name=${encodeURIComponent(entry.model_name)}`
    const a = document.createElement('a'); a.href = url; a.download = `${entry.model_name}.pkl`; a.click()
  }

  const currentMetricInfo = METRIC_INFO[selectedMetric]

  if (!filePath) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh' }}>
        <TopNav active={active || 'training'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
        <div style={{ textAlign: 'center', padding: '80px 0', color: C.muted }}>
          No dataset found. Complete the earlier pipeline steps first.
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <TopNav active={active || 'training'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
      <VersionsBar versions={versions} />

      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '18px 32px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: C.text, marginBottom: 3 }}>Train and Test</h1>
        <p style={{ fontSize: 12.5, color: C.muted }}>Configure your model, evaluate performance, and inspect every result.</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start' }}>

        {/* ══════════════════ LEFT PANEL — settings ══════════════════ */}
        <div style={{
          width: '34%', minWidth: 340, maxWidth: 460, flexShrink: 0,
          position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
          borderRight: `1px solid ${C.border}`, padding: '20px 20px 40px', background: C.card,
        }}>
          {/* Model + Metric row */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1.2, position: 'relative' }}>
              <SectionLabel info={<InfoIcon content={
                Object.entries(MODEL_DESCRIPTIONS).map(([id, d]) => `${modelLabel(id)} — ${d}`).join('\n\n')
              } />}>Model</SectionLabel>
              <button onClick={() => { setModelDropdownOpen(o => !o); setMetricDropdownOpen(false) }}
                style={dropdownBtnStyle(C)}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedModel ? `${ALL_MODELS.find(m => m.id === selectedModel)?.icon} ${modelLabel(selectedModel)}` : 'Choose Model'}
                </span>
                <span>▾</span>
              </button>
              {modelDropdownOpen && (
                <>
                  <div onClick={() => setModelDropdownOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 200 }} />
                  <ModelDropdown taskType={taskType} selected={selectedModel} onSelect={handleModelSelect} onClose={() => setModelDropdownOpen(false)} />
                </>
              )}
              {selectedModel === 'decision_tree' && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {['gini', 'entropy'].map(c => (
                    <button key={c} onClick={() => { setTreeCriterion(c); setModelParams(p => ({ ...p, criterion: c })) }}
                      style={{
                        flex: 1, padding: '5px 8px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        border: `1.5px solid ${(modelParams.criterion || treeCriterion) === c ? C.primary : C.border}`,
                        background: (modelParams.criterion || treeCriterion) === c ? C.primarySoft : 'transparent',
                        color: (modelParams.criterion || treeCriterion) === c ? C.primary : C.muted,
                      }}>{c === 'gini' ? 'CART (gini)' : 'ID3 (entropy)'}</button>
                  ))}
                </div>
              )}
            </div>

            {taskType !== 'clustering' && (
              <div style={{ flex: 1, position: 'relative' }}>
                <SectionLabel info={<InfoIcon content={
                  Object.values(METRIC_INFO).map(m => `${m.label} — ${m.desc}`).join('\n\n') +
                  '\n\nRule of thumb:\n• Medical / fraud / safety → Recall\n• Marketing / outreach → Precision\n• General purpose → Accuracy or F1'
                } />}>Focus Metric</SectionLabel>
                <button onClick={() => { setMetricDropdownOpen(o => !o); setModelDropdownOpen(false) }}
                  style={dropdownBtnStyle(C)}>
                  <span>{currentMetricInfo.label}</span><span>▾</span>
                </button>
                {metricDropdownOpen && (
                  <>
                    <div onClick={() => setMetricDropdownOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 200 }} />
                    <MetricDropdown selected={selectedMetric} onSelect={setSelectedMetric} onClose={() => setMetricDropdownOpen(false)} />
                  </>
                )}
              </div>
            )}
          </div>

          {/* K placeholder — KNN / K-Means only */}
          {(selectedModel === 'knn' || selectedModel === 'kmeans') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
              padding: '9px 12px', background: C.primarySoft, borderRadius: 10, border: `1px solid ${C.primary}33` }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.primary }}>
                {selectedModel === 'knn' ? 'K (neighbors)' : 'K (clusters)'}
              </span>
              <input type="number" min={1} max={selectedModel === 'knn' ? 99 : 30}
                step={selectedModel === 'knn' ? 2 : 1}
                value={kValue ?? ''} onChange={e => handleKPick(Number(e.target.value))}
                style={{ width: 60, padding: '4px 8px', borderRadius: 7, border: `1px solid ${C.primary}55`, textAlign: 'center', fontWeight: 800, color: C.text, background: C.card }} />
              <span style={{ fontSize: 10.5, color: C.muted, marginLeft: 'auto' }}>from elbow graph →</span>
            </div>
          )}

          {/* Split method */}
          {taskType !== 'clustering' && (
            <div style={{ marginBottom: 16 }}>
              <SectionLabel info={<InfoIcon content={
                'Train/Test Split:\n• Splits your data once — e.g. 80% to train, 20% to test.\n• Fast; best for larger datasets (1,000+ rows).\n\n' +
                'K-Fold Cross-Validation:\n• Splits data k times; each fold is used as the test set once.\n• Scores are averaged — a more reliable estimate.\n• Higher computation cost; best for smaller datasets.\n\n' +
                'Stratified vs Not Stratified:\n• Stratified keeps each fold\'s class ratio matching the full dataset — recommended for classification.\n• Not Stratified splits purely randomly.\n\n' +
                'PRISM auto-suggests split/k from your dataset size.'
              } />}>Evaluation Method</SectionLabel>

              <label style={radioRowStyle(C, splitMethod === 'train_test')}>
                <input type="radio" checked={splitMethod === 'train_test'} onChange={() => setSplitMethod('train_test')} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>Train / Test Split</span>
              </label>
              {splitMethod === 'train_test' && (
                <div style={{ padding: '8px 4px 4px 26px' }}>
                  <input type="range" min={0.5} max={0.95} step={0.05} value={splitRatio}
                    onChange={e => setSplitRatio(Number(e.target.value))} style={{ width: '100%' }} />
                  <div style={{ fontSize: 12, color: C.text, fontWeight: 700 }}>
                    Train {Math.round(splitRatio * 100)}% · Test {Math.round((1 - splitRatio) * 100)}%
                  </div>
                  {defaults?.split_ratio?.train && (
                    <div style={{ fontSize: 10.5, color: C.muted }}>
                      Suggested for {defaults.row_count.toLocaleString()} rows: {Math.round(defaults.split_ratio.train * 100)}% / {Math.round(defaults.split_ratio.test * 100)}%
                    </div>
                  )}
                </div>
              )}

              <label style={{ ...radioRowStyle(C, splitMethod === 'cross_validation'), marginTop: 6 }}>
                <input type="radio" checked={splitMethod === 'cross_validation'} onChange={() => setSplitMethod('cross_validation')} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>K-Fold Cross-Validation</span>
              </label>
              {splitMethod === 'cross_validation' && (
                <div style={{ padding: '8px 4px 4px 26px', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: C.muted }}>k =</span>
                  <input type="number" min={2} max={20} value={cvFolds} onChange={e => setCvFolds(Number(e.target.value))}
                    style={{ width: 54, padding: '4px 8px', borderRadius: 7, border: `1px solid ${C.border}`, background: C.card, color: C.text }} />
                  {taskType === 'classification' && (
                    <select value={stratified ? 'strat' : 'notstrat'} onChange={e => setStratified(e.target.value === 'strat')}
                      style={{ ...selectStyle(C), flex: 1 }}>
                      <option value="strat">Stratified</option>
                      <option value="notstrat">Not Stratified</option>
                    </select>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Grid Search CV */}
          {taskType !== 'clustering' && (
            <div style={{ marginBottom: 16, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <SectionLabel info={<InfoIcon content={
                  'Grid Search CV — what it does:\n\nSystematically tests every combination of the parameter values you specify, scoring each with cross-validation, and returns the best-performing combination on your chosen metric.\n\n' +
                  'Optional but often worthwhile — commonly a 2-5% accuracy gain on typical datasets.\n\n' +
                  'Limited to a small number of values per parameter here to keep search time reasonable.\n\n' +
                  'Process: 1) parameter cards are pre-filled with sensible defaults  2) click Search  3) best values appear beside each card  4) click Apply to load them into your model settings.'
                } />}>Grid Search CV</SectionLabel>
                <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                  <span style={{ position: 'relative', width: 34, height: 19, display: 'inline-block' }}>
                    <input type="checkbox" checked={gridSearchEnabled} onChange={e => setGridSearchEnabled(e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0 }} />
                    <span onClick={() => setGridSearchEnabled(v => !v)} style={{
                      position: 'absolute', inset: 0, borderRadius: 20, cursor: 'pointer',
                      background: gridSearchEnabled ? C.primary : C.border, transition: 'background 0.15s',
                    }}>
                      <span style={{
                        position: 'absolute', top: 2, left: gridSearchEnabled ? 17 : 2, width: 15, height: 15,
                        borderRadius: '50%', background: 'white', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                      }} />
                    </span>
                  </span>
                </label>
              </div>

              {gridSearchEnabled && (
                <div style={{ marginBottom: 10 }}>
                  {gridParams.map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
                      padding: '7px 9px', background: C.faint, borderRadius: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {p.custom ? (
                          <input placeholder="param name" value={p.name} onChange={e => updateGridParam(i, { name: e.target.value })}
                            style={{ width: '100%', fontSize: 11.5, border: 'none', background: 'transparent', color: C.text, fontWeight: 700 }} />
                        ) : (
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text }}>{p.label}</div>
                        )}
                        <input placeholder="value1, value2" defaultValue={p.values.join(', ')}
                          onBlur={e => updateGridParam(i, { values: e.target.value.split(',').map(s => s.trim()).filter(Boolean).map(v => (isNaN(v) ? v : Number(v))) })}
                          style={{ width: '100%', fontSize: 11, border: 'none', background: 'transparent', color: C.muted, marginTop: 1 }} />
                        {p.best !== null && p.best !== undefined && (
                          <div style={{ fontSize: 10.5, color: C.success, fontWeight: 700, marginTop: 2 }}>✓ best: {String(p.best)}</div>
                        )}
                      </div>
                      <button onClick={() => removeGridParam(i)} title="Remove"
                        style={{ border: 'none', background: 'none', color: C.muted, cursor: 'pointer', fontSize: 13 }}>✕</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={addGridParam} style={smallBtnStyle(C, false)}>＋</button>
                    <button onClick={runGridSearch} disabled={gridSearchLoading || !gridParams.length}
                      style={{ ...smallBtnStyle(C, true), flex: 1, opacity: gridSearchLoading || !gridParams.length ? 0.55 : 1 }}>
                      {gridSearchLoading ? '⏳ Searching…' : '🔍 Search'}
                    </button>
                    <button onClick={applyGridSearch} disabled={!gridSearchResult}
                      style={{ ...smallBtnStyle(C, false), background: gridSearchResult ? C.successSoft : C.faint,
                        color: gridSearchResult ? C.success : C.muted, borderColor: gridSearchResult ? C.success : C.border,
                        opacity: gridSearchResult ? 1 : 0.55 }}>Apply</button>
                  </div>
                  {gridError && <div style={{ fontSize: 11, color: C.danger, marginTop: 6 }}>{gridError}</div>}
                  {gridSearchResult && (
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
                      Best {selectedMetric}: <strong style={{ color: C.text }}>{gridSearchResult.best_score}</strong> · {gridSearchResult.elapsed_sec}s
                    </div>
                  )}
                </div>
              )}

              <button onClick={() => setShowEditParams(true)} style={{ ...smallBtnStyle(C, false), width: '100%' }}>
                Edit Attributes Manually
              </button>
            </div>
          )}

          {/* Threshold */}
          {taskType === 'classification' && (
            <div style={{ marginBottom: 18, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
              <SectionLabel info={<InfoIcon content={
                'Classification Threshold:\n\nYour model outputs a probability. The threshold decides the cutoff:\n' +
                '• P(positive) ≥ threshold → predict "Positive"\n• below it → predict "Negative"\n\n' +
                'Default: 50%.\nLower threshold → more positives flagged → higher Recall, lower Precision.\nHigher threshold → fewer positives flagged → higher Precision, lower Recall.\n\n' +
                'Example: lower it for cancer screening (catching a real case matters more than a false alarm). Raise it for fraud alerts (avoid annoying legitimate customers).\n\n' +
                'Only applies to binary classification.'
              } />}>Decision Threshold</SectionLabel>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="range" min={0.01} max={0.99} step={0.01} value={threshold}
                  onChange={e => setThreshold(Number(e.target.value))} style={{ flex: 1 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <input type="number" min={1} max={99} value={Math.round(threshold * 100)}
                    onChange={e => setThreshold(Math.min(99, Math.max(1, Number(e.target.value))) / 100)}
                    style={{ width: 44, padding: '4px 6px', borderRadius: 7, border: `1px solid ${C.border}`, background: C.card, color: C.text, textAlign: 'center' }} />
                  <span style={{ fontSize: 12, color: C.muted }}>%</span>
                </div>
              </div>
            </div>
          )}

          {/* Train button */}
          <button onClick={handleTrain} disabled={!selectedModel || trainingLoading}
            style={{
              width: '100%', padding: '13px', borderRadius: 11, border: 'none',
              background: selectedModel ? C.primary : C.faint,
              color: selectedModel ? 'white' : C.muted, fontWeight: 800, fontSize: 14.5,
              cursor: selectedModel ? 'pointer' : 'default',
              boxShadow: selectedModel ? `0 6px 18px ${C.primary}44` : 'none',
            }}>
            {trainingLoading ? '⏳ Training…' : taskType === 'clustering' ? '▶ Train Clusters'
              : splitMethod === 'train_test' ? '▶ Train and Test' : '▶ Train and Validate'}
          </button>
          {trainingError && <div style={{ fontSize: 11.5, color: C.danger, marginTop: 8 }}>⚠ {trainingError}</div>}

          {/* Model History */}
          <div style={{ marginTop: 26, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <SectionLabel>Model History</SectionLabel>
            {modelHistory.length === 0 ? (
              <div style={{ fontSize: 11.5, color: C.muted, padding: '8px 0' }}>No models trained yet this session.</div>
            ) : (
              modelHistory.map((m, i) => (
                <div key={m.model_id} style={{
                  position: 'relative', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 9px', borderRadius: 9, marginBottom: 4, cursor: 'pointer',
                  background: activeResult?.model_id === m.model_id ? C.primarySoft : 'transparent',
                  borderLeft: i === 0 ? `3px solid ${C.primary}` : '3px solid transparent',
                }} onClick={() => setActiveResult(m)}>
                  <span style={{ fontSize: 10.5, color: C.muted, fontFamily: 'monospace', flexShrink: 0 }}>{m.timestamp}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {modelLabel(m.model_name)}
                  </span>
                  <span style={{ fontSize: 10.5, color: C.muted, flexShrink: 0 }}>
                    {m.task_type === 'clustering' ? `k=${m.n_clusters}` : m[m.metric] != null ? `${m.metric}: ${m[m.metric]}` : ''}
                  </span>
                  <button onClick={e => { e.stopPropagation(); setHistoryMenuOpen(historyMenuOpen === m.model_id ? null : m.model_id) }}
                    style={{ border: 'none', background: 'none', color: C.muted, cursor: 'pointer', fontSize: 13, position: 'relative' }}>
                    ⋮
                    {historyMenuOpen === m.model_id && (
                      <ModelActionsMenu entry={m}
                        onView={() => setActiveResult(m)}
                        onDownload={() => downloadModel(m)}
                        onVisualizeTree={() => setTreePopupEntry(m)}
                        onDelete={() => { setModelHistory(h => h.filter(x => x.model_id !== m.model_id)); if (activeResult?.model_id === m.model_id) setActiveResult(null) }}
                        onClose={() => setHistoryMenuOpen(null)} />
                    )}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ══════════════════ RIGHT PANEL — output ══════════════════ */}
        <div style={{ flex: 1, minWidth: 0, height: '100vh', overflowY: 'auto', padding: '20px 28px 60px' }}>

          {!selectedModel && !activeResult && (
            <div style={{ textAlign: 'center', padding: '120px 0', color: C.muted }}>
              <div style={{ fontSize: 40, marginBottom: 14 }}>🤖</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: C.text, marginBottom: 6 }}>Train and Test</div>
              <div style={{ fontSize: 13 }}>Select a model and configure settings on the left to begin.</div>
            </div>
          )}

          {selectedModel && !activeResult && (selectedModel === 'knn' || selectedModel === 'kmeans') && (
            <ChartCard title={selectedModel === 'knn' ? 'KNN — Optimal K Search' : 'K-Means — Optimal Clusters (Elbow Method)'}
              sub={selectedModel === 'knn'
                ? `Odd values of k from 1 to 39. Y-axis: ${currentMetricInfo.label}. Best k highlighted.`
                : 'Inertia (within-cluster sum of squares) for k from 2 to 15. Elbow = best trade-off.'}>
              {elbowLoading && <div style={{ textAlign: 'center', padding: 60, color: C.muted }}>⏳ Computing elbow curve…</div>}
              {!elbowLoading && elbowData && (
                <ElbowChart
                  kValues={elbowData.k_values}
                  values={selectedModel === 'knn' ? elbowData.scores : elbowData.inertias}
                  bestK={elbowData.best_k}
                  currentK={kValue}
                  yLabel={selectedModel === 'knn' ? currentMetricInfo.label : 'Inertia'}
                  onPick={handleKPick}
                />
              )}
            </ChartCard>
          )}

          {selectedModel && !activeResult && selectedModel !== 'knn' && selectedModel !== 'kmeans' && (
            <div style={{ textAlign: 'center', padding: '100px 0', color: C.muted }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>{ALL_MODELS.find(m => m.id === selectedModel)?.icon}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>{modelLabel(selectedModel)} ready to train</div>
              <div style={{ fontSize: 12.5, maxWidth: 420, margin: '0 auto' }}>{MODEL_DESCRIPTIONS[selectedModel]}</div>
            </div>
          )}

          {activeResult && (
            <TrainingResults result={activeResult} outputOptions={outputOptions}
              onEditOutput={() => setShowEditOutput(true)} threshold={threshold} />
          )}
        </div>
      </div>

      {/* Forward-navigation button always lives at the page's own bottom
          (standing platform rule) — Training renders its own two-panel
          layout rather than using App.jsx's shared footer slot, so this is
          THE bottom of the page's normal document flow, sitting below both
          sticky/scrolling panels once the page itself is scrolled down. */}
      <div style={{ textAlign: 'center', padding: '18px 0 26px' }}>
        <button onClick={() => onNext && onNext()} disabled={!activeResult}
          style={{
            padding: '11px 26px', borderRadius: 10, border: 'none',
            background: activeResult ? C.primary : C.faint,
            color: activeResult ? 'white' : C.muted, fontWeight: 800, fontSize: 13.5,
            cursor: activeResult ? 'pointer' : 'default',
            boxShadow: activeResult ? `0 4px 16px ${C.primary}44` : 'none',
          }}>
          {activeResult ? 'Continue to Feature Importance →' : 'Train a model to continue →'}
        </button>
      </div>

      {showEditParams && (
        <EditAttributesPopup modelId={selectedModel} values={{ ...MODEL_PARAM_DEFS[selectedModel]?.reduce((a, d) => ({ ...a, [d.name]: d.default }), {}), ...modelParams }}
          onApply={vals => setModelParams(p => ({ ...p, ...vals }))} onClose={() => setShowEditParams(false)} />
      )}
      {showEditOutput && (
        <EditOutputPopup options={outputOptions} onApply={setOutputOptions} onClose={() => setShowEditOutput(false)} />
      )}
      {treePopupEntry && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setTreePopupEntry(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: C.card, borderRadius: 16, padding: 24, width: 'min(1040px, 94vw)',
            maxHeight: '88vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontWeight: 900, fontSize: 16, color: C.text }}>{treePopupEntry.display_name}</div>
              <button onClick={() => setTreePopupEntry(null)} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: C.muted }}>✕</button>
            </div>
            <DecisionTreeViz tree={treePopupEntry.model_viz?.tree} />
          </div>
        </div>
      )}
    </div>
  )
}

const dropdownBtnStyle = (C) => ({
  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '9px 12px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.card,
  color: C.text, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
})
const radioRowStyle = (C, active) => ({
  display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderRadius: 9,
  border: `1.5px solid ${active ? C.primary : C.border}`, background: active ? C.primarySoft : 'transparent', cursor: 'pointer',
})
const smallBtnStyle = (C, primary) => ({
  padding: '7px 12px', borderRadius: 8, border: `1px solid ${primary ? C.primary : C.border}`,
  background: primary ? C.primary : C.card, color: primary ? 'white' : C.text,
  fontWeight: 700, fontSize: 11.5, cursor: 'pointer',
})

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS — renders after training. Model-specific visualization always
// last, per spec ("graphs must be at the bottom of the output division").
// ─────────────────────────────────────────────────────────────────────────────
function TrainingResults({ result, outputOptions, onEditOutput, threshold }) {
  const { C } = useTheme()

  if (result.task_type === 'clustering') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <TopBar result={result} onEditOutput={onEditOutput} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 12 }}>
          <MetricCard label="Clusters" value={result.n_clusters} accent={C.primary} />
          <MetricCard label="Inertia" value={result.inertia} accent="#8b5cf6" sub="within-cluster sum of squares" />
          <MetricCard label="Entropy" value={result.entropy} accent={C.warning} sub="0 = perfectly uneven sizes, higher = more even" />
          <MetricCard label="Training Time" value={`${result.training_time}s`} accent={C.success} />
        </div>
        <ChartCard title="Dataset Preview — with cluster label" sub="The new 'cluster' column is highlighted.">
          <div style={{ maxHeight: 280, overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: C.faint, position: 'sticky', top: 0 }}>
                {result.preview_cols.map(c => (
                  <th key={c} style={{ ...thStyle(C), background: c === 'cluster' ? '#fef3c7' : C.faint, color: c === 'cluster' ? '#92400e' : C.muted }}>{c}</th>
                ))}
              </tr></thead>
              <tbody>
                {result.preview_rows.map((row, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                    {result.preview_cols.map(c => (
                      <td key={c} style={{ ...tdStyle(C), background: c === 'cluster' ? '#fffbeb' : 'transparent',
                        fontWeight: c === 'cluster' ? 800 : 400, color: c === 'cluster' ? '#92400e' : C.text }}>{String(row[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 16 }}>
          <ClusterScatterChart viz={result.cluster_viz} />
          <ChartCard title="Cluster Sizes">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={result.cluster_dist} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.faint} />
                <XAxis dataKey="cluster" tick={{ fontSize: 11, fill: C.muted }} tickFormatter={c => `C${c}`} />
                <YAxis tick={{ fontSize: 11, fill: C.muted }} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {result.cluster_dist.map((d, i) => <Cell key={i} fill={CLASS_COLORS[d.cluster % CLASS_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>
    )
  }

  const isClassification = result.task_type === 'classification'
  const viz = result.model_viz || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TopBar result={result} onEditOutput={onEditOutput} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 12 }}>
        {isClassification ? (
          <>
            <MetricCard label="Accuracy" value={result.accuracy} accent={C.primary} />
            <MetricCard label="F1-Score" value={result.f1} accent="#8b5cf6" />
            <MetricCard label="Precision" value={result.precision} accent={C.success} />
            <MetricCard label="Recall" value={result.recall} accent={C.warning} />
          </>
        ) : (
          <>
            <MetricCard label="R²" value={result.r2} accent={C.primary} />
            <MetricCard label="MAE" value={result.mae} accent="#8b5cf6" />
            <MetricCard label="RMSE" value={result.rmse} accent={C.warning} />
            <MetricCard label="MSE" value={result.mse} accent={C.danger} />
          </>
        )}
      </div>

      {result.cv_scores?.length > 0 && (
        <div style={{ background: C.primarySoft, borderRadius: 10, padding: '10px 16px', display: 'flex',
          flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: C.primary }}>{result.cv_scores.length}-Fold CV:</span>
          {result.cv_scores.map((s, i) => (
            <span key={i} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: C.primary, color: 'white' }}>{s}</span>
          ))}
          <span style={{ fontSize: 12, color: C.text, marginLeft: 6 }}>Mean: <strong>{result.cv_mean}</strong> ± {result.cv_std}</span>
        </div>
      )}

      {isClassification && outputOptions.confusion_matrix && result.confusion_matrix && (
        <ChartCard title="Confusion Matrix">
          <ConfusionMatrix matrix={result.confusion_matrix} classes={result.class_names} />
        </ChartCard>
      )}

      {isClassification && outputOptions.per_class_stats && result.per_class?.length > 0 && (
        <ChartCard title="Per-Class Breakdown">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 420 }}>
              <thead><tr style={{ background: C.faint }}>
                <th style={thStyle(C)}>Class</th><th style={thStyle(C)}>Precision</th><th style={thStyle(C)}>Recall</th><th style={thStyle(C)}>F1</th><th style={thStyle(C)}>Support</th>
              </tr></thead>
              <tbody>
                {result.per_class.map((r, i) => (
                  <tr key={r.class} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? C.faint : 'transparent' }}>
                    <td style={{ ...tdStyle(C), fontWeight: 700 }}>{r.class}</td>
                    <td style={tdStyle(C)}>{r.precision}</td><td style={tdStyle(C)}>{r.recall}</td><td style={tdStyle(C)}>{r.f1}</td><td style={tdStyle(C)}>{r.support}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      )}

      {/* ── Model-specific visualization — always last ─────────────────── */}
      {viz.tree && <ChartCard title="Decision Tree"><DecisionTreeViz tree={viz.tree} /></ChartCard>}
      {viz.feature_importance && <ImportanceBar data={viz.feature_importance} valueKey="importance" labelKey="feature" title="Feature Importance" />}
      {viz.sigmoid_curve && <SigmoidChart points={viz.sigmoid_curve} threshold={threshold} />}
      {viz.coefficients && !viz.sigmoid_curve && <CoefficientsTable coefficients={viz.coefficients} intercept={viz.intercept} />}
      {viz.coefficients && viz.sigmoid_curve && <CoefficientsTable coefficients={viz.coefficients} />}
      {result.regression_scatter && <RegressionScatterChart scatter={result.regression_scatter} />}
      {viz.bayes_network && <BayesNetworkViz network={viz.bayes_network} />}
    </div>
  )
}

function TopBar({ result, onEditOutput }) {
  const { C } = useTheme()
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      position: 'sticky', top: 0, zIndex: 5, background: C.bg, paddingBottom: 4 }}>
      <div>
        <span style={{ fontWeight: 800, fontSize: 15, color: C.text }}>{modelLabel(result.model_name)}</span>
        <span style={{ fontSize: 11.5, color: C.muted, marginLeft: 10 }}>{result.timestamp} · {result.training_time}s</span>
      </div>
      {result.task_type !== 'clustering' && (
        <button onClick={onEditOutput} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
          background: C.card, color: C.text, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Edit Output ⚙</button>
      )}
    </div>
  )
}
