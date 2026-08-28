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
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Brush, BarChart, Bar, Cell, ScatterChart,
  Scatter, ZAxis, ComposedChart, Legend,
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

// Persists a piece of left-panel state to localStorage under
// "prism_training_<filePath>__<key>" so navigating away (TopNav) and back
// doesn't lose the user's configured model/settings/history — this
// component instance gets torn down and recreated on that round trip
// (unlike every OTHER journey-map page, which App.jsx keeps mounted; see
// the top-of-file note). Scoped by `filePath` (the dataset THIS training
// session is actually running against) - without that scope, a fresh
// upload of a completely different dataset silently inherited whatever
// model/elbow-curve/history a PREVIOUS dataset's session had left in
// localStorage under the same fixed key, showing a KNN elbow curve and
// model history for a run that never happened on the new data (confirmed
// live: reported by the user on a first-ever visit to Training right after
// a brand-new upload). Same file path across a simple "leave and come
// back" round trip -> state correctly persists; a genuinely different
// file (new upload, or an upstream step redone into a new version) ->
// starts clean, exactly as it should. JSON round-trips every value
// uniformly (strings/numbers/booleans/objects/arrays/null all survive
// it), so one hook covers every persisted field without a separate
// raw-string path for the JSON ones.
const LS_PREFIX = 'prism_training_'
function usePersisted(scope, key, defaultValue) {
  const storageKey = `${LS_PREFIX}${scope || 'unscoped'}__${key}`
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw != null ? JSON.parse(raw) : defaultValue
    } catch { return defaultValue }
  })
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(value)) } catch {}
  }, [storageKey, value])
  return [value, setValue]
}

const CLASS_COLORS = ['#2dd4bf', '#8b5cf6', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#84cc16', '#06b6d4']

// 0-1 ratio -> percentage string, e.g. 0.9867 -> "98.67%". `safe_round()` on
// the backend can legitimately return null for a NaN/degenerate metric (a
// class entirely absent from a tiny CV fold, etc.) - null*100 silently
// coerces to 0 in JS, which would misrepresent an unknown value as a real
// 0% score, so that case is handled explicitly rather than falling through
// the multiplication.
const pct = (v, nd = 2) => (v == null ? '—' : `${(v * 100).toFixed(nd)}%`)

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
                              { name: 'penalty', label: 'Regularization', values: ['l2', 'l1'] },
                              { name: 'solver', label: 'Solver', values: ['lbfgs', 'liblinear'] }],
  svm:                      [{ name: 'kernel', label: 'Kernel', values: ['linear', 'rbf', 'poly'] },
                              { name: 'C', label: 'C (regularization)', values: [0.1, 1.0, 10.0] },
                              { name: 'gamma', label: 'Gamma (RBF/poly)', values: ['scale', 'auto'] }],
  xgboost:                  [{ name: 'learning_rate', label: 'Learning rate', values: [0.01, 0.1] },
                              { name: 'max_depth', label: 'Max depth', values: [3, 5, 7] },
                              { name: 'n_estimators', label: 'Number of trees', values: [50, 100] },
                              { name: 'subsample', label: 'Subsample ratio', values: [0.8, 1.0] }],
  naive_bayes:              [],
  linear_regression:        [],
  ridge_regression:         [{ name: 'alpha', label: 'Alpha (regularization)', values: [0.1, 1.0, 10.0] }],
  random_forest_regressor:  [{ name: 'n_estimators', label: 'Number of trees', values: [50, 100, 200] },
                              { name: 'max_depth', label: 'Max depth', values: [3, 5, 10] }],
  kmeans:                   [{ name: 'max_iter', label: 'Max iterations', values: [100, 300] }],
}

// "Edit Attributes Manually" — the FULL per-model parameter set (unlike
// GRID_SEARCH_DEFAULTS above, which only holds the small number of values
// picked as grid-search-worthy defaults). Modeled on Weka's own Generic
// Object Editor field list per algorithm (IBk/J48/RandomForest/SMO/
// Logistic/NaiveBayes), translated to this platform's actual sklearn/
// XGBoost backend: every field here is a real, valid constructor kwarg
// that build_model() in training_router.py passes straight through.
// Deliberately dropped: Weka-internal/Java fields with no sklearn
// equivalent or no meaning here (batchSize, debug, doNotCheckCapabilities,
// numDecimalPlaces, printClassifiers, seed-as-string, etc.) and boolean
// toggles this popup's <select> can't safely represent as real booleans
// (calcOutOfBag, breakTiesRandomly, ...) - "choose wisely, not everything
// applies" per the same reasoning already used for the model-history menu
// and Edit Output popup elsewhere on this page.
const MODEL_PARAM_DEFS = {
  knn: [
    { name: 'n_neighbors', label: 'K (neighbors)', type: 'number', default: 5, min: 1, max: 99 },
    { name: 'metric', label: 'Distance metric', type: 'select', options: ['euclidean', 'manhattan'], default: 'euclidean' },
    { name: 'weights', label: 'Weighting', type: 'select', options: ['uniform', 'distance'], default: 'uniform' },
    { name: 'algorithm', label: 'Search algorithm', type: 'select', options: ['auto', 'ball_tree', 'kd_tree', 'brute'], default: 'auto' },
  ],
  decision_tree: [
    // Criterion (gini/entropy = CART/ID3) is deliberately NOT duplicated
    // here - it already has its own dedicated toggle right under the
    // Model picker when Decision Tree is selected.
    { name: 'max_depth', label: 'Max depth', type: 'number', default: 6, min: 1, max: 50 },
    { name: 'min_samples_split', label: 'Min samples split', type: 'number', default: 2, min: 2 },
    { name: 'min_samples_leaf', label: 'Min samples leaf', type: 'number', default: 1, min: 1 },
    { name: 'max_features', label: 'Max features', type: 'select', options: ['sqrt', 'log2'], default: 'sqrt' },
    { name: 'splitter', label: 'Splitter', type: 'select', options: ['best', 'random'], default: 'best' },
    { name: 'ccp_alpha', label: 'Pruning (ccp alpha)', type: 'number', default: 0.0, step: 0.001, min: 0 },
    { name: 'random_state', label: 'Random state', type: 'number', default: 42 },
  ],
  random_forest: [
    { name: 'n_estimators', label: 'Number of trees', type: 'number', default: 100, min: 10, max: 1000 },
    { name: 'max_depth', label: 'Max depth', type: 'number', default: 10, min: 1, max: 50 },
    { name: 'min_samples_split', label: 'Min samples split', type: 'number', default: 2, min: 2 },
    { name: 'min_samples_leaf', label: 'Min samples leaf', type: 'number', default: 1, min: 1 },
    { name: 'max_features', label: 'Max features', type: 'select', options: ['sqrt', 'log2'], default: 'sqrt' },
    { name: 'random_state', label: 'Random state', type: 'number', default: 42 },
  ],
  logistic_regression: [
    { name: 'max_iter', label: 'Max iterations', type: 'number', default: 1000, min: 100, max: 5000 },
    { name: 'C', label: 'Regularization (C)', type: 'number', default: 1.0, step: 0.1 },
    { name: 'penalty', label: 'Penalty', type: 'select', options: ['l2', 'l1'], default: 'l2' },
    { name: 'solver', label: 'Solver', type: 'select', options: ['lbfgs', 'liblinear'], default: 'lbfgs' },
    { name: 'random_state', label: 'Random state', type: 'number', default: 42 },
  ],
  svm: [
    { name: 'kernel', label: 'Kernel', type: 'select', options: ['rbf', 'linear', 'poly'], default: 'rbf' },
    { name: 'C', label: 'C (regularization)', type: 'number', default: 1.0, step: 0.1 },
    { name: 'gamma', label: 'Gamma', type: 'select', options: ['scale', 'auto'], default: 'scale' },
    { name: 'degree', label: 'Degree (poly kernel)', type: 'number', default: 3, min: 1, max: 10 },
    { name: 'tol', label: 'Tolerance', type: 'number', default: 0.001, step: 0.0001, min: 0 },
    { name: 'random_state', label: 'Random state', type: 'number', default: 42 },
  ],
  xgboost: [
    { name: 'n_estimators', label: 'Estimators', type: 'number', default: 100, min: 10, max: 1000 },
    { name: 'max_depth', label: 'Max depth', type: 'number', default: 6, min: 1, max: 20 },
    { name: 'learning_rate', label: 'Learning rate', type: 'number', default: 0.1, step: 0.01 },
    { name: 'subsample', label: 'Subsample ratio', type: 'number', default: 1.0, step: 0.1, min: 0.1, max: 1.0 },
    { name: 'colsample_bytree', label: 'Column sample ratio', type: 'number', default: 1.0, step: 0.1, min: 0.1, max: 1.0 },
    { name: 'gamma', label: 'Min split loss (gamma)', type: 'number', default: 0, step: 0.1, min: 0 },
  ],
  naive_bayes: [
    { name: 'var_smoothing', label: 'Variance smoothing', type: 'number', default: 1e-9, step: 1e-9, min: 0 },
  ],
  linear_regression: [],
  ridge_regression: [
    { name: 'alpha', label: 'Alpha', type: 'number', default: 1.0, step: 0.1 },
    { name: 'solver', label: 'Solver', type: 'select', options: ['auto', 'svd', 'cholesky'], default: 'auto' },
    { name: 'max_iter', label: 'Max iterations', type: 'number', default: 1000, min: 100 },
  ],
  random_forest_regressor: [
    { name: 'n_estimators', label: 'Number of trees', type: 'number', default: 100, min: 10, max: 1000 },
    { name: 'max_depth', label: 'Max depth', type: 'number', default: 10, min: 1, max: 50 },
    { name: 'min_samples_split', label: 'Min samples split', type: 'number', default: 2, min: 2 },
    { name: 'min_samples_leaf', label: 'Min samples leaf', type: 'number', default: 1, min: 1 },
    { name: 'max_features', label: 'Max features', type: 'select', options: ['sqrt', 'log2'], default: 'sqrt' },
    { name: 'random_state', label: 'Random state', type: 'number', default: 42 },
  ],
  kmeans: [
    { name: 'n_clusters', label: 'Number of clusters (K)', type: 'number', default: 3, min: 2, max: 30 },
    { name: 'max_iter', label: 'Max iterations', type: 'number', default: 300, min: 10 },
    { name: 'n_init', label: 'Number of initializations', type: 'number', default: 10, min: 1, max: 50 },
    { name: 'algorithm', label: 'Algorithm', type: 'select', options: ['lloyd', 'elkan'], default: 'lloyd' },
    { name: 'random_state', label: 'Random state', type: 'number', default: 42 },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// INFO ICON — small circular "i" popovers, placed at the 5 primary
// explanation spots the user specified (metric, model, split/CV, grid
// search, threshold).
//
// Two content modes:
//   - `content` (plain pre-line string) — the original narrow single-column
//     popover, anchored just right of the icon. Still used by the 3 spots
//     that are naturally a short paragraph or two (Evaluation Method, Grid
//     Search CV, Decision Threshold) — unchanged.
//   - `items` (array of {label, desc}, optionally with `itemsTitle` and a
//     closing `footer` line) — a wider, multi-column popover for the 2
//     spots that are really a LIST of many short entries (Model, Focus
//     Metric): a single narrow column made those tall-and-scrolling with
//     every line looking the same weight. CSS multi-column layout spreads
//     them horizontally instead, with the label bold and the description
//     normal-weight. Positioned via `position:fixed` + the button's real
//     on-screen rect (measured on open, not guessed) and clamped to the
//     viewport so it can never render off-screen or get clipped — this is
//     what actually fixes the Focus Metric card's fixed-offset "always
//     opens 22px right of the icon" positioning, which is what clipped it
//     when the icon itself was already more than halfway across the page.
// ─────────────────────────────────────────────────────────────────────────────
const WIDE_POPUP_W = 560
const NARROW_POPUP_W = 300

const InfoIcon = ({ content, items, itemsTitle, footer }) => {
  const { C } = useTheme()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const popupRef = useRef(null)
  const isWide = !!items
  const popupW = isWide ? WIDE_POPUP_W : NARROW_POPUP_W

  // Both popup shapes measure the icon's REAL on-screen position on open and
  // clamp against the viewport - the narrow (`content`) popup used to be
  // `position:'absolute', left:22, top:-6` with no clamping at all, which is
  // exactly why it clipped/forced a page-level horizontal scrollbar whenever
  // the icon sat anywhere near the left panel's own right edge (Evaluation
  // Method, Grid Search CV, Decision Threshold all do). Clamping `left`
  // against a known fixed width is enough on its own, but clamping `top`
  // needs the popup's actual rendered HEIGHT (content-driven, unknown until
  // it renders) - a layout effect measures the just-mounted popup via
  // popupRef and corrects `top` before the browser paints, so there's no
  // visible flicker and no need to let it clip or scroll internally instead.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    // Measure the popup's REAL rendered box, not the declared `width`
    // constant - these divs use default content-box sizing, so padding
    // and border add on top of `width` (e.g. WIDE_POPUP_W=560 renders at
    // 602px). Clamping against the constant instead of the true size let
    // popups clip by exactly that padding+border margin in a tight
    // viewport - offsetWidth/offsetHeight report the true box regardless.
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
              padding: '16px 20px', width: WIDE_POPUP_W, maxWidth: 'calc(100vw - 24px)',
              maxHeight: 'calc(100vh - 24px)', overflowY: 'auto', boxShadow: shadow,
              fontSize: 12, color: C.text,
              // Reset explicitly, don't inherit: this popup is a DOM child of
              // SectionLabel's own div (`<SectionLabel info={<InfoIcon/>}>`),
              // which sets fontWeight:800 + textTransform:uppercase for ITS
              // OWN caption text. Both properties inherit by default, and the
              // original popup never broke that inheritance - which is the
              // actual root cause of the "everything renders bold" report,
              // not a one-off styling miss on the description text alone.
              fontWeight: 400, textTransform: 'none', letterSpacing: 'normal',
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
              padding: '14px 16px', width: NARROW_POPUP_W, maxWidth: 'calc(100vw - 24px)',
              maxHeight: 'calc(100vh - 24px)', overflowY: 'auto', boxShadow: shadow, fontSize: 12,
              color: C.text, lineHeight: 1.65, whiteSpace: 'pre-line',
              // Same inheritance reset as the wide popup above - this one is
              // also a DOM child of SectionLabel's bold-uppercase caption div.
              fontWeight: 400, textTransform: 'none', letterSpacing: 'normal',
            }}>
              {content}
            </div>
          )}
        </>
      )}
    </span>
  )
}

// Pre-selected default (see the `defaults` load effect) is still just the
// initial state - clicking the other radio switches away from it exactly
// like any other radio button. This badge is purely informational, marking
// WHICH option that initial state matches, not a constraint on the choice.
const RecommendedBadge = ({ C }) => (
  <span style={{
    marginLeft: 'auto', flexShrink: 0, fontSize: 9.5, fontWeight: 800,
    padding: '2px 8px', borderRadius: 20, background: C.successSoft, color: C.success,
    textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap',
  }}>✓ Recommended</span>
)

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
        <LineChart data={data} onClick={handleClick} margin={{ top: 26, right: 20, bottom: 0, left: 0 }}
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
// K-MEANS ELBOW CHART — inertia AND entropy together, both normalized to a
// shared 0-100 scale (done server-side in training_router.py's
// normalize_to_100) so two differently-scaled curves can share one Y axis.
// Click-to-pick-k, best-k reference line, and zoom Brush all mirror the
// single-line ElbowChart above; the custom tooltip reads back the RAW
// (un-normalized) values from elbowData by k, not the normalized ones being
// plotted, since "58.3 (normalized)" means nothing to the user.
// ─────────────────────────────────────────────────────────────────────────────
const KMeansElbowTooltip = ({ active, payload, label, elbowData, C }) => {
  if (!active || !payload?.length) return null
  const idx = elbowData.k_values.indexOf(label)
  const inertiaRaw = idx >= 0 ? elbowData.inertias?.[idx] : null
  const entropyRaw = idx >= 0 ? elbowData.entropies?.[idx] : null
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, color: C.text, marginBottom: 4 }}>K = {label}</div>
      {inertiaRaw != null && <div style={{ color: C.warning }}>Inertia: {inertiaRaw.toFixed(2)} (raw)</div>}
      {entropyRaw != null && <div style={{ color: C.primary }}>Entropy: {entropyRaw.toFixed(4)} bits</div>}
    </div>
  )
}

const KMeansElbowChart = ({ elbowData, currentK, onPick, C }) => {
  const data = elbowData.k_values.map((k, i) => ({
    k, inertia_norm: elbowData.inertia_normalized?.[i], entropy_norm: elbowData.entropy_normalized?.[i],
  }))

  const handleClick = (e) => {
    if (!e || !e.activeLabel) return
    const clickedK = Number(e.activeLabel)
    const nearest = elbowData.k_values.reduce((best, k) => Math.abs(k - clickedK) < Math.abs(best - clickedK) ? k : best, elbowData.k_values[0])
    onPick(nearest)
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={data} onClick={handleClick} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}
          style={{ cursor: 'pointer' }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.faint} />
          <XAxis dataKey="k" type="number" domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 11, fill: C.muted }} label={{ value: 'Number of Clusters (K)', position: 'insideBottom', offset: -2, fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11, fill: C.muted }}
            label={{ value: 'Score Magnitude (Relative Scale)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
          <Tooltip content={<KMeansElbowTooltip elbowData={elbowData} C={C} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {elbowData.best_k != null && (
            <ReferenceLine x={elbowData.best_k} stroke={C.muted} strokeDasharray="6,4"
              label={{ value: `Optimal Elbow Point (K=${elbowData.best_k})`, position: 'insideTopRight', fill: C.muted, fontSize: 10 }} />
          )}
          <Line type="monotone" dataKey="inertia_norm" name="Inertia" stroke={C.warning} strokeWidth={2.5} dot={{ r: 4 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="entropy_norm" name="Entropy" stroke={C.primary} strokeWidth={2.5} dot={{ r: 4 }} isAnimationActive={false} />
          <Brush dataKey="k" height={22} stroke={C.primary} fill={C.faint} travellerWidth={8} />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 11.5, color: C.muted, textAlign: 'center', marginTop: 2 }}>
        Click anywhere on the curve to select k · currently k = <strong style={{ color: C.text }}>{currentK}</strong> · drag the strip below to zoom
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ELBOW EXPLANATION CARD — what inertia/entropy mean and how to read the
// chart above together, K-Means only. Same "uppercase label + dashed
// section divider" convention as FeatureImportance.jsx's DescriptionCard.
// ─────────────────────────────────────────────────────────────────────────────
const ElbowExplanationCard = ({ C }) => {
  const Section = ({ label, color, text }) => (
    <div>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color, marginBottom: 5 }}>{label}</div>
      <p style={{ fontSize: 12.5, color: C.text, lineHeight: 1.7, margin: 0 }}>{text}</p>
    </div>
  )
  return (
    <ChartCard title="Understanding the Elbow Chart">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Section label="What is Inertia?" color={C.warning} text={
          `Inertia (also called Within-Cluster Sum of Squares, WCSS) measures the total distance between every data point and its assigned cluster center. A low inertia means points are tightly packed around their cluster centers — the clusters are compact and internally consistent. As you increase K, inertia always decreases: with more clusters, each cluster is smaller and tighter. The key is finding where inertia stops dropping sharply — where adding one more cluster gives you very little extra compactness. That point of diminishing returns is the elbow.`
        } />
        <div style={{ paddingTop: 14, borderTop: `1px dashed ${C.border}` }}>
          <Section label="What is Entropy?" color={C.primary} text={
            `Shannon Entropy measures how evenly your data points are distributed across the K clusters. An entropy of 0 means all points landed in one cluster (perfectly uneven — useless). Maximum entropy means every cluster has exactly the same number of points (perfectly even distribution). For a good clustering, you want high entropy — no cluster should be nearly empty while another is enormous. As K increases, entropy generally increases because the algorithm has more buckets to spread points across. When entropy starts to flatten, splitting into more clusters is no longer creating meaningfully different groups — it is just subdividing existing ones.`
          } />
        </div>
        <div style={{ paddingTop: 14, borderTop: `1px dashed ${C.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: C.success, marginBottom: 5 }}>What To Look For</div>
          <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.7, margin: 0 }}>
            The optimal K is where BOTH curves change behavior simultaneously: inertia stops dropping steeply (the "elbow" bends) AND entropy starts flattening (adding more clusters no longer improves distribution). When these two signals agree, you have strong evidence for that K value. If they disagree — for example, inertia says K=3 but entropy keeps rising until K=5 — the data may have ambiguous cluster structure, and you should try both values and compare the resulting cluster scatter plots.
          </p>
        </div>
      </div>
    </ChartCard>
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
// Small pill tabs for the Cluster Map's "Best Features" / "PCA" toggle —
// same active/inactive visual language as radioRowStyle/smallBtnStyle
// elsewhere on this page, just compact enough to sit in a ChartCard header.
const ViewTabBtn = ({ active, onClick, children, C }) => (
  <button onClick={onClick} style={{
    padding: '4px 11px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
    border: `1px solid ${active ? C.primary : C.border}`,
    background: active ? C.primarySoft : C.card, color: active ? C.primary : C.muted,
  }}>{children}</button>
)

// One scatter, reused for both the "Best Features" and "PCA" views — they
// differ only in which 2D projection (viz vs viz.pca) feeds x/y/centroids.
const ClusterScatter2D = ({ scatter, centroids, xLabel, yLabel, C }) => {
  const byCluster = {}
  scatter.forEach(p => { (byCluster[p.cluster] ??= []).push(p) })
  return (
    <ResponsiveContainer width="100%" height={340}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.faint} />
        <XAxis dataKey="x" type="number" name={xLabel} tick={{ fontSize: 10, fill: C.muted }} />
        <YAxis dataKey="y" type="number" name={yLabel} tick={{ fontSize: 10, fill: C.muted }} />
        <ZAxis range={[16, 16]} />
        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
        {Object.entries(byCluster).map(([cl, pts]) => (
          <Scatter key={cl} name={`Cluster ${cl}`} data={pts} fill={CLASS_COLORS[cl % CLASS_COLORS.length]} opacity={0.55} />
        ))}
        <Scatter name="Centroids" data={centroids} shape="star" fill="none" legendType="none">
          {centroids.map((c, i) => (
            <Cell key={i} fill={CLASS_COLORS[c.cluster % CLASS_COLORS.length]} stroke={C.text} strokeWidth={1.5} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  )
}

// Grid of small unlabeled-axis scatters, one per feature pair — only ever
// mounted while AllPairsSection's toggle is expanded, so an unopened
// toggle costs nothing. No Tooltip/animation per mini-chart:
// with dozens of these on screen at once, both are pure overhead a tiny
// 120px chart can't usefully show anyway.
const AllPairsGrid = ({ allPairs, C }) => {
  const { feature_names: feats, rows, cluster } = allPairs
  const pairs = useMemo(() => {
    const out = []
    for (let i = 0; i < feats.length; i++)
      for (let j = i + 1; j < feats.length; j++)
        out.push({ fx: feats[i], fy: feats[j], xi: i, yi: j })
    return out
  }, [feats])
  const clusterIds = useMemo(() => [...new Set(cluster)].sort((a, b) => a - b), [cluster])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
      {pairs.map(({ fx, fy, xi, yi }) => {
        const data = rows.map((r, i) => ({ x: r[xi], y: r[yi], cluster: cluster[i] }))
        return (
          <div key={`${fx}||${fy}`} style={{ background: C.faint, borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.text, marginBottom: 4,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fx} × {fy}</div>
            <ResponsiveContainer width="100%" height={120}>
              <ScatterChart margin={{ top: 4, right: 4, bottom: 2, left: -22 }}>
                <XAxis dataKey="x" type="number" tick={{ fontSize: 8, fill: C.muted }} height={14} />
                <YAxis dataKey="y" type="number" tick={{ fontSize: 8, fill: C.muted }} width={26} />
                {clusterIds.map(cl => (
                  <Scatter key={cl} data={data.filter(p => p.cluster === cl)}
                    fill={CLASS_COLORS[cl % CLASS_COLORS.length]} opacity={0.6} isAnimationActive={false} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )
      })}
    </div>
  )
}

// Above this, a scatter can only ever show 105 tiny multiples at once (15
// features) before it stops being something a person can actually scan -
// past that it's not a performance decision, it's a legibility one.
const MAX_RENDERED_PAIRS = 105

const ClusterScatterChart = ({ viz }) => {
  const { C } = useTheme()
  const [view, setView] = useState('top2')       // 'top2' | 'pca'
  if (!viz?.scatter) return null

  const usingPca = view === 'pca' && viz.pca
  const active = usingPca ? viz.pca : viz

  return (
    <ChartCard title="Cluster Map"
      sub={usingPca
        ? `Every feature projected onto its 2 directions of maximum variance at once (${active.x_label}, ${active.y_label}) — a different, complementary view from "Best Features".`
        : viz.selection_reason}
      action={viz.pca && (
        <div style={{ display: 'flex', gap: 6 }}>
          <ViewTabBtn C={C} active={!usingPca} onClick={() => setView('top2')}>Best Features</ViewTabBtn>
          <ViewTabBtn C={C} active={usingPca} onClick={() => setView('pca')}>PCA View</ViewTabBtn>
        </div>
      )}>
      <ClusterScatter2D scatter={active.scatter} centroids={active.centroids}
        xLabel={active.x_label} yLabel={active.y_label} C={C} />
      <div style={{ fontSize: 10.5, color: C.muted, textAlign: 'center', marginTop: 2 }}>
        ✦ marks each cluster's centroid.
      </div>
    </ChartCard>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ALL FEATURE PAIRS — full-width section (not squeezed into the Cluster
// Map's 1.4fr grid column, and not a dropdown/accordion): a standard
// secondary button toggles a regular, always-mounted ChartCard below it
// (display:none when closed, same as every other chart card when open) —
// its own internally-scrollable grid of mini scatters, not the page itself,
// grows for a large feature count.
// ─────────────────────────────────────────────────────────────────────────────
const AllPairsSection = ({ viz }) => {
  const { C } = useTheme()
  const [showAllPairs, setShowAllPairs] = useState(false)
  const featCount = viz?.all_pairs?.feature_names?.length || 0
  if (featCount <= 2) return null
  const nPairs = viz.n_pairs || 0
  const pairsTooMany = nPairs > MAX_RENDERED_PAIRS

  return (
    <>
      <button onClick={() => setShowAllPairs(p => !p)} style={{ ...smallBtnStyle(C, false), alignSelf: 'flex-start' }}>
        {showAllPairs ? '✕ Hide Feature Pair Scatters' : `📊 Show All Feature Pair Scatters (${nPairs} plots)`}
      </button>

      <ChartCard style={{ display: showAllPairs ? 'block' : 'none' }}
        title="All Feature Pair Combinations"
        sub="Scroll to explore every 2-feature view of cluster structure.">
        {pairsTooMany ? (
          <div style={{ fontSize: 12, color: C.muted, textAlign: 'center', padding: '20px 10px' }}>
            This dataset has {featCount} features → {nPairs} possible pairs, too many to render
            individually and still be readable. Narrow the feature set on Feature Selection first,
            or use the PCA view above for a single all-features summary.
          </div>
        ) : showAllPairs ? (
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            <AllPairsGrid allPairs={viz.all_pairs} C={C} />
          </div>
        ) : null}
      </ChartCard>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// METRIC CARD — v2. The blurred decorative circle carried no information
// (same size/opacity regardless of the metric's actual value); replaced
// with a ring that actually fills to the metric's own ratio when one is
// available (`ratio`, the raw 0-1 number — accuracy/F1/precision/recall).
// Top accent border matches the KPICard convention already established in
// Sampling.jsx rather than this page's old left-border strip. `ratio` is
// left unset for cards with no natural 0-1 reading (cluster count,
// inertia, MAE/RMSE/MSE, training time) — the ring simply doesn't render.
// ─────────────────────────────────────────────────────────────────────────────
const MetricRing = ({ ratio, color, C, size = 46 }) => {
  const stroke = 4.5
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, ratio))
  return (
    <svg width={size} height={size} style={{ flexShrink: 0, transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.faint} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={circ * (1 - clamped)} strokeLinecap="round" />
    </svg>
  )
}

const MetricCard = ({ label, value, sub, accent, icon, ratio }) => {
  const { C } = useTheme()
  const ac = accent || C.primary
  return (
    <div style={{
      background: C.card, borderRadius: cardR, padding: '14px 16px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.03)',
      borderTop: `3px solid ${ac}`, display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
          {icon && <span style={{ fontSize: 12.5 }}>{icon}</span>}
          <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: C.muted }}>{label}</span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, color: C.text, lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{sub}</div>}
      </div>
      {ratio != null && <MetricRing ratio={ratio} color={ac} C={C} />}
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
const ModelActionsMenu = ({ entry, pos, popupRef, onView, onDownload, onVisualizeTree, onDelete, onClose }) => {
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
      <div ref={popupRef} style={{
        position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden', zIndex: 999,
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

// Grid Search CV's ＋ button opens this - a plain pick-a-parameter list (no
// typing) drawn from the model's real MODEL_PARAM_DEFS, already excluding
// whatever's been added. Same fixed-position/viewport-clamp convention as
// ModelActionsMenu above.
const GridParamPickerPopup = ({ options, pos, popupRef, onPick, onClose }) => {
  const { C } = useTheme()
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
      <div ref={popupRef} style={{
        position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden', zIndex: 999,
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
        boxShadow: shadow, width: 220, maxHeight: 260, overflowY: 'auto', padding: 5,
      }}>
        {options.length === 0 ? (
          <div style={{ padding: '10px 8px', fontSize: 11.5, color: C.muted }}>Every available parameter has already been added.</div>
        ) : options.map(def => (
          <div key={def.name} onClick={() => onPick(def)}
            style={{ padding: '8px 10px', borderRadius: 7, fontSize: 12, color: C.text, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = C.faint}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            {def.label}
          </div>
        ))}
      </div>
    </>
  )
}

// Opens right after a parameter is picked above (or when re-clicking an
// existing card's values) - a checkbox list of concrete candidate values
// (see candidateValuesFor), never a free-text field.
const GridValuePickerPopup = ({ def, checked, candidates, pos, popupRef, onToggle, onSave, onClose }) => {
  const { C } = useTheme()
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
      <div ref={popupRef} style={{
        position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden', zIndex: 999,
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
        boxShadow: shadow, width: 230, padding: 10,
      }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: C.text, marginBottom: 8 }}>{def.label}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10, maxHeight: 200, overflowY: 'auto' }}>
          {candidates.map(v => (
            <label key={String(v)} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: C.text, cursor: 'pointer' }}>
              <input type="checkbox" checked={checked.has(v)} onChange={() => onToggle(v)} />
              {String(v)}
            </label>
          ))}
        </div>
        <button onClick={onSave} style={{
          width: '100%', padding: '7px', borderRadius: 8, border: 'none', background: C.primary,
          color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer',
        }}>Save</button>
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

  // ── Settings state — persisted to localStorage (see usePersisted above)
  // so it survives navigating away via TopNav and back, on top of already
  // persisting for the page's lifetime while mounted. Scoped by `filePath`
  // so a different dataset never inherits a previous one's state. ────────
  const [selectedModel, setSelectedModel] = usePersisted(filePath, 'model', '')
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [selectedMetric, setSelectedMetric] = usePersisted(filePath, 'metric', 'accuracy')
  const [metricDropdownOpen, setMetricDropdownOpen] = useState(false)
  const [treeCriterion, setTreeCriterion] = useState('gini')

  const [kValue, setKValue] = usePersisted(filePath, 'k_value', null)
  const [elbowData, setElbowData] = usePersisted(filePath, 'elbow_data', null)
  const [elbowLoading, setElbowLoading] = useState(false)

  const [splitMethod, setSplitMethod] = usePersisted(filePath, 'split_method', 'train_test')
  const [splitRatio, setSplitRatio] = usePersisted(filePath, 'split_ratio', 0.8)
  const [cvFolds, setCvFolds] = usePersisted(filePath, 'cv_folds', 5)
  const [stratified, setStratified] = usePersisted(filePath, 'stratified', true)

  const [gridSearchEnabled, setGridSearchEnabled] = usePersisted(filePath, 'grid_enabled', false)
  const [gridParams, setGridParams] = usePersisted(filePath, 'grid_params', [])
  const [gridSearchResult, setGridSearchResult] = useState(null)
  const [gridSearchLoading, setGridSearchLoading] = useState(false)
  const [gridError, setGridError] = useState('')

  const [modelParams, setModelParams] = usePersisted(filePath, 'model_params', {})
  const [showEditParams, setShowEditParams] = useState(false)

  const [threshold, setThreshold] = usePersisted(filePath, 'threshold', 0.5)

  const [trainingLoading, setTrainingLoading] = useState(false)
  const [trainingError, setTrainingError] = useState('')

  const [outputOptions, setOutputOptions] = useState({
    confusion_matrix: true, per_class_stats: true, model_summary: true, learning_curve: false,
  })
  const [showEditOutput, setShowEditOutput] = useState(false)

  const [modelHistory, setModelHistory] = usePersisted(filePath, 'history', [])
  // Persisted for classification/regression - coming back to this page (in
  // the same back-and-forth-navigation sense as everything else above)
  // should show exactly the last output that was on screen, per explicit
  // request. Clustering is the deliberate exception: it always defaults to
  // the elbow/K graph instead, regardless of any restored result - handled
  // right below, once taskType is known, rather than by not persisting at
  // all (past results still need to stay reachable and restorable there
  // too via clicking a Model History entry, same as the other task types).
  const [activeResult, setActiveResult] = usePersisted(filePath, 'active_result', null)
  // Mount-only (empty deps), NOT a plain "if clustering && truthy" check on
  // every render: handleTrain's own setActiveResult(result) after a real
  // training run also makes activeResult truthy, and a per-render guard
  // fired on THAT too, silently wiping out a just-trained clustering result
  // a moment after it appeared (confirmed live - the /training/train call
  // succeeded but the Cluster Map never rendered). useLayoutEffect with []
  // runs exactly once, before the browser paints (so a stale RESTORED
  // result never flashes on screen either), and never runs again for the
  // rest of this mount - so it only ever clears what was restored from
  // localStorage on load, never a fresh in-session result.
  useLayoutEffect(() => {
    if (taskType === 'clustering') setActiveResult(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [historyMenuOpen, setHistoryMenuOpen] = useState(null)
  const [treePopupEntry, setTreePopupEntry] = useState(null)

  // The ⋮ menu used to render as a position:absolute child of its button,
  // which lived inside Model History's own overflowY:auto scroll box - any
  // row near the bottom got its menu clipped by that box's bounds no
  // matter the z-index, since absolute positioning still respects an
  // ancestor's overflow clipping. It's rendered once at the page root
  // instead (same convention as EditAttributesPopup/treePopupEntry below)
  // and positioned via position:fixed off the button's real on-screen
  // rect - fixed positioning isn't clipped by ancestor overflow at all,
  // and matches the InfoIcon popups' already-proven clamp-to-viewport
  // pattern elsewhere in this file.
  const historyMenuBtnRefs = useRef({})
  const historyMenuPopupRef = useRef(null)
  const [historyMenuPos, setHistoryMenuPos] = useState(null)
  useLayoutEffect(() => {
    if (!historyMenuOpen) { setHistoryMenuPos(null); return }
    const btn = historyMenuBtnRefs.current[historyMenuOpen]
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const w = historyMenuPopupRef.current?.offsetWidth || 210
    const h = historyMenuPopupRef.current?.offsetHeight || 0
    const left = Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12))
    const top = Math.max(12, Math.min(r.bottom + 4, window.innerHeight - h - 12))
    setHistoryMenuPos({ left, top })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyMenuOpen])

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
  // Skips the network round-trip when elbowData is already populated for
  // this model (restored from localStorage on mount, e.g. after leaving
  // and returning to this page) - the `else` branch below always clears
  // elbowData the moment selectedModel stops being knn/kmeans, so by the
  // time the user re-selects either one during a live session it's
  // guaranteed null again and this still refetches normally.
  useEffect(() => {
    if (!filePath) return
    if (selectedModel === 'knn') {
      if (elbowData) return
      setElbowLoading(true); setElbowData(null)
      callTraining('elbow-knn', { file_path: filePath, target_column: targetColumn, metric: selectedMetric })
        .then(d => { setElbowData(d); setKValue(d.best_k) })
        .catch(e => setTrainingError(e.message))
        .finally(() => setElbowLoading(false))
    } else if (selectedModel === 'kmeans') {
      if (elbowData) return
      setElbowLoading(true); setElbowData(null)
      callTraining('elbow-kmeans', { file_path: filePath, max_k: 15 })
        .then(d => { setElbowData(d); setKValue(d.best_k) })
        .catch(e => setTrainingError(e.message))
        .finally(() => setElbowLoading(false))
    } else {
      setElbowData(null); setKValue(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // Skipped on mount: selectedModel/gridParams/modelParams are all restored
  // together from localStorage, and this effect firing on that first render
  // would immediately stomp the restored gridParams/modelParams back to
  // fresh defaults before the user ever sees them.
  const didMountModelEffect = useRef(false)
  useEffect(() => {
    if (!didMountModelEffect.current) { didMountModelEffect.current = true; return }
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

  const updateGridParam = (i, patch) => setGridParams(p => p.map((g, idx) => idx === i ? { ...g, ...patch } : g))
  const removeGridParam = (i) => setGridParams(p => p.filter((_, idx) => idx !== i))

  // Parameter + value picking - see the pop-ups rendered near the ＋ button
  // below. Replaces the old free-text "param name" / "v1, v2" inputs (no
  // typing required for either step anymore): the ＋ button opens a list of
  // this model's REAL constructor parameters (from MODEL_PARAM_DEFS, the
  // same source "Edit Attributes Manually" uses) to pick a name from, then
  // immediately opens a second pop-up of concrete candidate values to check
  // off for that parameter. Existing cards' values are editable the same
  // way by clicking their value pill again.
  const [paramPickerOpen, setParamPickerOpen] = useState(false)
  const [valuePicker, setValuePicker] = useState(null) // { index, def } - index -1 = adding a new param
  const addParamBtnRef = useRef(null)
  const valuePillRefs = useRef({})
  const [paramPickerPos, setParamPickerPos] = useState(null)
  const [valuePickerPos, setValuePickerPos] = useState(null)
  const paramPickerPopupRef = useRef(null)
  const valuePickerPopupRef = useRef(null)

  useLayoutEffect(() => {
    if (!paramPickerOpen || !addParamBtnRef.current) { setParamPickerPos(null); return }
    const r = addParamBtnRef.current.getBoundingClientRect()
    const w = paramPickerPopupRef.current?.offsetWidth || 220
    const h = paramPickerPopupRef.current?.offsetHeight || 0
    setParamPickerPos({
      left: Math.max(12, Math.min(r.left, window.innerWidth - w - 12)),
      top: Math.max(12, Math.min(r.bottom + 6, window.innerHeight - h - 12)),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramPickerOpen])

  useLayoutEffect(() => {
    if (!valuePicker) { setValuePickerPos(null); return }
    // index -1 = a brand-new param just picked from GridParamPickerPopup,
    // which has no value-pill of its own yet - anchor off the ＋ button
    // it was opened from instead.
    const btn = valuePicker.index === -1 ? addParamBtnRef.current : valuePillRefs.current[valuePicker.index]
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const w = valuePickerPopupRef.current?.offsetWidth || 230
    const h = valuePickerPopupRef.current?.offsetHeight || 0
    setValuePickerPos({
      left: Math.max(12, Math.min(r.left, window.innerWidth - w - 12)),
      top: Math.max(12, Math.min(r.bottom + 6, window.innerHeight - h - 12)),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuePicker])

  // Candidate values offered for a parameter: reuse GRID_SEARCH_DEFAULTS'
  // own curated set when this exact param already has one (better choices
  // than anything generated), a select field's own options otherwise, or a
  // small spread around the numeric default as a last resort.
  const candidateValuesFor = (def) => {
    const curated = GRID_SEARCH_DEFAULTS[selectedModel]?.find(g => g.name === def.name)?.values
    if (curated?.length) return curated
    if (def.type === 'select') return def.options || []
    const d = def.default
    if (typeof d !== 'number') return [d]
    if (def.min != null && def.max != null && def.max > def.min) {
      return [...new Set([def.min, Math.round((def.min + def.max) / 2), def.max])]
    }
    if (!d) return [0, 0.01, 0.1]
    return [...new Set([d / 2, d, d * 2].map(v => Math.round(v * 1e6) / 1e6))]
  }

  const openParamPicker = () => setParamPickerOpen(o => !o)
  const pickParam = (def) => {
    setParamPickerOpen(false)
    setValuePicker({ index: -1, def, checked: new Set([def.default]) })
  }
  const openValuePickerForExisting = (i) => {
    const def = MODEL_PARAM_DEFS[selectedModel]?.find(d => d.name === gridParams[i].name)
      || { name: gridParams[i].name, label: gridParams[i].label || gridParams[i].name, type: 'number', default: gridParams[i].values[0] }
    setValuePicker({ index: i, def, checked: new Set(gridParams[i].values) })
  }
  const toggleValuePickerChecked = (v) => {
    setValuePicker(vp => {
      const next = new Set(vp.checked)
      next.has(v) ? next.delete(v) : next.add(v)
      return { ...vp, checked: next }
    })
  }
  const saveValuePicker = () => {
    if (!valuePicker) return
    const values = [...valuePicker.checked]
    if (!values.length) { setValuePicker(null); return }
    if (valuePicker.index === -1) {
      setGridParams(p => [...p, { name: valuePicker.def.name, label: valuePicker.def.label, values, best: null, custom: false }])
    } else {
      updateGridParam(valuePicker.index, { values })
    }
    setValuePicker(null)
  }

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

  const [gridApplyFlash, setGridApplyFlash] = useState(false)
  const applyGridSearch = () => {
    if (!gridSearchResult) return
    setModelParams(p => ({ ...p, ...gridSearchResult.best_params }))
    // Applying itself is instant (just merges into local state), so
    // without this the button gave zero feedback that a click landed -
    // a brief "✓ Applied" swap is enough to confirm it actually happened.
    setGridApplyFlash(true)
    setTimeout(() => setGridApplyFlash(false), 1400)
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

  // A single decision threshold has no defined meaning once there are more
  // than 2 classes (there's no one "positive" probability to cut against) -
  // _apply_threshold in training_router.py already correctly ignores it for
  // multiclass and always falls back to argmax, so a 3+-class model's
  // results genuinely never change no matter where the slider sits. That
  // was never a bug, but the page gave zero indication of it, so a
  // multiclass result and a bogus "threshold does nothing" bug looked
  // identical from the user's side - this makes the limitation visible
  // instead of silent.
  const isThresholdInapplicable = activeResult?.task_type === 'classification' && (activeResult?.class_names?.length || 0) > 2

  // A model whose predict_proba is 0%/100% for EVERY prediction has no
  // middle ground for the threshold to move through either - not a bug,
  // but easy to mistake for one. Decision Tree is the standout case: by
  // default it grows until every leaf is pure, so its "probability" is
  // just which side of a hard split a row landed on, never anything in
  // between (confirmed directly: every one of a real run's probabilities
  // came back as exactly 0.0 or 1.0). Other models normally return smooth
  // in-between values instead. Purely informational (unlike the multiclass
  // case above, the threshold IS genuinely being applied here) - it just
  // won't visibly change anything across most of the slider's range.
  const isThresholdDegenerate = !isThresholdInapplicable && activeResult?.threshold_proba?.length > 0
    && activeResult.threshold_proba.every(p => p === 0 || p === 1)

  // The Decision Threshold slider used to have zero effect until the user
  // clicked "Train and Validate" again - it only ever got sent as a param
  // on the NEXT full retrain, so dragging it against an already-trained
  // result silently did nothing (confirmed against the backend directly:
  // re-running /training/train with the same model but a different
  // threshold DOES change accuracy/confusion matrix correctly - the bug was
  // that nothing here ever re-ran it). Binary classification results now
  // carry the held-out set's raw positive-class probabilities
  // (threshold_proba/threshold_y_true), so the slider can be re-applied to
  // THIS result's own predictions instantly, no refit needed - mirrors
  // _classification_results' sklearn metrics (average='weighted',
  // zero_division=0) for the binary case exactly. Falls back to the
  // trained result unchanged for regression/clustering, multiclass (no
  // single cutoff applies), and any older cached history entry from before
  // this fix that doesn't carry those two fields.
  const displayedResult = useMemo(() => {
    const probaPos = activeResult?.threshold_proba
    const yTrue = activeResult?.threshold_y_true
    if (!activeResult || activeResult.task_type !== 'classification' || !probaPos || !yTrue || probaPos.length !== yTrue.length) {
      return activeResult
    }
    const n = probaPos.length
    let tn = 0, fp = 0, fn = 0, tp = 0
    for (let i = 0; i < n; i++) {
      const t = yTrue[i], p = probaPos[i] >= threshold ? 1 : 0
      if (t === 0 && p === 0) tn++
      else if (t === 0 && p === 1) fp++
      else if (t === 1 && p === 0) fn++
      else tp++
    }
    const classNames = activeResult.class_names || ['0', '1']
    const perClass = (cls, idx) => {
      const support = idx === 0 ? tn + fp : fn + tp
      const predictedCount = idx === 0 ? tn + fn : fp + tp
      const truePositive = idx === 0 ? tn : tp
      const precision = predictedCount > 0 ? truePositive / predictedCount : 0
      const recall = support > 0 ? truePositive / support : 0
      const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0
      return { class: cls, precision, recall, f1, support }
    }
    const c0 = perClass(classNames[0], 0)
    const c1 = perClass(classNames[1], 1)
    const round5 = v => Math.round(v * 1e5) / 1e5
    const updated = {
      ...activeResult,
      accuracy:  round5(n > 0 ? (tp + tn) / n : 0),
      precision: round5(n > 0 ? (c0.precision * c0.support + c1.precision * c1.support) / n : 0),
      recall:    round5(n > 0 ? (c0.recall * c0.support + c1.recall * c1.support) / n : 0),
      f1:        round5(n > 0 ? (c0.f1 * c0.support + c1.f1 * c1.support) / n : 0),
    }
    if (activeResult.confusion_matrix) updated.confusion_matrix = [[tn, fp], [fn, tp]]
    if (activeResult.per_class) updated.per_class = [
      { ...c0, precision: round5(c0.precision), recall: round5(c0.recall), f1: round5(c0.f1) },
      { ...c1, precision: round5(c1.precision), recall: round5(c1.recall), f1: round5(c1.f1) },
    ]
    return updated
  }, [activeResult, threshold])

  if (!filePath) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh' }}>
        <TopNav active={active || 'training'} onNavigate={onNavigate} furthestOrder={furthestOrder} taskType={taskType} />
        <div style={{ textAlign: 'center', padding: '80px 0', color: C.muted }}>
          No dataset found. Complete the earlier pipeline steps first.
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: C.bg, height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <TopNav active={active || 'training'} onNavigate={onNavigate} furthestOrder={furthestOrder} taskType={taskType} />
      <VersionsBar versions={versions} />

      {/* No page title/description bar here on purpose (removed per explicit
          request — it cost vertical space the page can't spare once nothing
          scrolls at the page level). This row fills whatever height TopNav +
          VersionsBar didn't use (`flex:1, minHeight:0` — the minHeight:0 is
          the actual fix: without it a flex child won't shrink below its
          content size, which silently defeats the panels' own
          height:100%+overflowY:auto below and page-level scroll comes right
          back). Both panels below get their scroll from THIS row's real,
          computed height, not a guessed pixel offset from the viewport. */}
      <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, minHeight: 0 }}>

        {/* ══════════════════ LEFT PANEL — settings ══════════════════ */}
        {/* Classification/regression: the whole panel scrolls as one column
            (Grid Search CV + Decision Threshold pushed this past what
            reliably fits without scrolling on shorter viewports) - Model
            History just grows with it instead of getting its own separate
            inner scroll region. Clustering keeps the older layout (no
            scroll on this panel, only Model History scrolls internally) -
            its settings are short enough that it never needed this. */}
        <div style={{
          width: '34%', minWidth: 340, maxWidth: 460, flexShrink: 0,
          minHeight: 0, display: 'flex', flexDirection: 'column',
          borderRight: `1px solid ${C.border}`, padding: '20px 20px 40px', background: C.card,
          overflowY: taskType !== 'clustering' ? 'auto' : 'visible',
        }}>
          {/* Model + Metric row */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1.2, position: 'relative' }}>
              <SectionLabel info={<InfoIcon itemsTitle="Model Types" items={
                Object.entries(MODEL_DESCRIPTIONS).map(([id, d]) => ({ label: modelLabel(id), desc: d }))
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
                <SectionLabel info={<InfoIcon itemsTitle="Focus Metrics" items={
                  Object.values(METRIC_INFO).map(m => ({ label: m.label, desc: m.desc }))
                } footer="Rule of thumb — Medical / fraud / safety → Recall · Marketing / outreach → Precision · General purpose → Accuracy or F1" />}>Focus Metric</SectionLabel>
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
              <SectionLabel info={<InfoIcon itemsTitle="Evaluation Method" footer="PRISM auto-suggests a split ratio / k from your dataset size." items={[
                { label: 'Train / Test Split', desc: 'Splits your data once — e.g. 80% to train, 20% to test.\nFast; best for larger datasets (1,000+ rows).' },
                { label: 'K-Fold Cross-Validation', desc: 'Splits data k times; each fold is used as the test set once.\nScores are averaged — a more reliable estimate.\nHigher computation cost; best for smaller datasets.' },
                { label: 'Stratified vs Not Stratified', desc: 'Stratified keeps each fold\'s class ratio matching the full dataset — recommended for classification.\nNot Stratified splits purely randomly.' },
              ]} />}>Evaluation Method</SectionLabel>

              <label style={radioRowStyle(C, splitMethod === 'train_test')}>
                <input type="radio" checked={splitMethod === 'train_test'} onChange={() => setSplitMethod('train_test')} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>Train / Test Split</span>
                {defaults && !defaults.split_ratio?.recommend_cv && <RecommendedBadge C={C} />}
              </label>
              {splitMethod === 'train_test' && (
                <div style={{ padding: '8px 4px 4px 26px' }}>
                  <input type="range" min={0.5} max={0.95} step={0.05} value={splitRatio}
                    onChange={e => setSplitRatio(Number(e.target.value))} style={{ width: '100%' }} />
                  <div style={{ fontSize: 12, color: C.text, fontWeight: 700 }}>
                    Train {Math.round(splitRatio * 100)}% · Test {Math.round((1 - splitRatio) * 100)}%
                  </div>
                  {defaults?.split_ratio?.train && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 5,
                      padding: '3px 9px', borderRadius: 20, fontSize: 10.5, fontWeight: 700,
                      background: C.primarySoft, color: C.primary,
                    }}>
                      💡 Suggested for {defaults.row_count.toLocaleString()} rows: {Math.round(defaults.split_ratio.train * 100)}% / {Math.round(defaults.split_ratio.test * 100)}%
                    </div>
                  )}
                </div>
              )}

              <label style={{ ...radioRowStyle(C, splitMethod === 'cross_validation'), marginTop: 6 }}>
                <input type="radio" checked={splitMethod === 'cross_validation'} onChange={() => setSplitMethod('cross_validation')} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>K-Fold Cross-Validation</span>
                {defaults?.split_ratio?.recommend_cv && <RecommendedBadge C={C} />}
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
                <SectionLabel info={<InfoIcon itemsTitle="Grid Search CV" items={[
                  { label: 'What It Does', desc: 'Systematically tests every combination of the parameter values you specify, scoring each with cross-validation, and returns the best-performing combination on your chosen metric.' },
                  { label: 'Why Use It', desc: 'Optional but often worthwhile — commonly a 2-5% accuracy gain on typical datasets.' },
                  { label: 'Limitation', desc: 'Limited to a small number of values per parameter here to keep search time reasonable.' },
                  { label: 'Process', desc: '1) Parameter cards are pre-filled with sensible defaults.\n2) Click Search.\n3) Best values appear beside each card.\n4) Click Apply to load them into your model settings.' },
                ]} />}>Grid Search CV</SectionLabel>
                <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                  <span style={{ position: 'relative', width: 34, height: 19, display: 'inline-block' }}>
                    <input type="checkbox" checked={gridSearchEnabled} onChange={e => setGridSearchEnabled(e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0 }} />
                    {/* No onClick here on purpose: this span sits inside the
                        <label> that wraps the real checkbox, so a click on
                        it ALSO triggers the browser's native label->checkbox
                        forwarding (a real, separate click dispatched on the
                        input right after this one). Two toggle paths on one
                        click reliably canceled each other out - confirmed
                        live, `checked` never left `false` no matter how many
                        times it was clicked. The input's onChange above is
                        now the only source of truth; this span is purely
                        visual and reads gridSearchEnabled to render. */}
                    <span style={{
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
                  {/* Small cards side-by-side (2 per row in the left panel's
                      own width), not stacked full-width rows - matches the
                      user's own mockup and keeps this section from eating
                      the vertical space the no-scroll left panel can't spare. */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 5, marginBottom: 6 }}>
                    {gridParams.map((p, i) => (
                      <div key={i} style={{ position: 'relative', padding: '6px 18px 6px 7px', background: C.faint, borderRadius: 7 }}>
                        <button onClick={() => removeGridParam(i)} title="Remove"
                          style={{ position: 'absolute', top: 3, right: 4, border: 'none', background: 'none', color: C.muted, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0 }}>✕</button>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label || p.name}</div>
                        {/* Clicking the values re-opens the same
                            checkbox-picker used to add them - no free-text
                            editing of values either. */}
                        <button ref={el => { valuePillRefs.current[i] = el }} onClick={() => openValuePickerForExisting(i)}
                          title="Choose values" style={{
                            display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: 0,
                            fontSize: 10, color: C.primary, marginTop: 1, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                          {p.values.join(', ') || 'choose values…'}
                        </button>
                        {p.best !== null && p.best !== undefined && (
                          <div style={{ fontSize: 9.5, color: C.success, fontWeight: 700, marginTop: 2 }}>✓ {String(p.best)}</div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button ref={addParamBtnRef} onClick={openParamPicker} style={smallBtnStyle(C, false)}>＋</button>
                    <button onClick={runGridSearch} disabled={gridSearchLoading || !gridParams.length}
                      style={{ ...smallBtnStyle(C, true), flex: 1, opacity: gridSearchLoading || !gridParams.length ? 0.55 : 1 }}>
                      {gridSearchLoading ? '⏳ Searching…' : '🔍 Search'}
                    </button>
                    <button onClick={applyGridSearch} disabled={!gridSearchResult}
                      style={{ ...smallBtnStyle(C, false), background: gridApplyFlash ? C.success : gridSearchResult ? C.successSoft : C.faint,
                        color: gridApplyFlash ? 'white' : gridSearchResult ? C.success : C.muted, borderColor: gridSearchResult ? C.success : C.border,
                        opacity: gridSearchResult ? 1 : 0.55, transition: 'background 0.15s, color 0.15s' }}>
                      {gridApplyFlash ? '✓ Applied' : 'Apply'}
                    </button>
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
              <SectionLabel info={<InfoIcon itemsTitle="Decision Threshold" footer="Only applies to binary classification." items={[
                { label: 'How It Works', desc: 'Your model outputs a probability. The threshold decides the cutoff:\nP(positive) ≥ threshold → predict "Positive"\nbelow it → predict "Negative"' },
                { label: 'Default & Effect', desc: 'Default: 50%.\nLower threshold → more positives flagged → higher Recall, lower Precision.\nHigher threshold → fewer positives flagged → higher Precision, lower Recall.' },
                { label: 'Example', desc: 'Lower it for cancer screening (catching a real case matters more than a false alarm). Raise it for fraud alerts (avoid annoying legitimate customers).' },
              ]} />}>Decision Threshold</SectionLabel>
              {/* Always visible (not just buried in the ⓘ popup) so a
                  multiclass result never looks like a silently broken
                  slider - swaps to a more specific, ✕-marked line once a
                  trained result actually confirms >2 classes, or an amber
                  note if the model's own probabilities are all-or-nothing
                  (Decision Tree's default behavior - see
                  isThresholdDegenerate above). */}
              <div style={{ fontSize: 10.5, color: isThresholdInapplicable ? C.danger : isThresholdDegenerate ? C.warning : C.muted, marginBottom: 6 }}>
                {isThresholdInapplicable
                  ? `✕ Not applied — this model has ${activeResult.class_names.length} classes (threshold only works for binary/2-class models).`
                  : isThresholdDegenerate
                  ? '⚠ This model is 0% or 100% confident on every prediction (decision trees fully split by default), so most threshold values won\'t change the result.'
                  : 'Only affects binary (2-class) classification.'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: isThresholdInapplicable ? 0.45 : 1 }}>
                <input type="range" min={0.01} max={0.99} step={0.01} value={threshold} disabled={isThresholdInapplicable}
                  onChange={e => setThreshold(Number(e.target.value))} style={{ flex: 1, cursor: isThresholdInapplicable ? 'not-allowed' : 'pointer' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <input type="number" min={1} max={99} value={Math.round(threshold * 100)} disabled={isThresholdInapplicable}
                    onChange={e => setThreshold(Math.min(99, Math.max(1, Number(e.target.value))) / 100)}
                    style={{ width: 44, padding: '4px 6px', borderRadius: 7, border: `1px solid ${C.border}`, background: C.card, color: C.text,
                      textAlign: 'center', cursor: isThresholdInapplicable ? 'not-allowed' : 'text' }} />
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

          {/* Model History. For clustering (outer panel doesn't scroll -
              see above) this is the one thing in the panel that scrolls
              internally, so its wrapper/inner list use flex:1/minHeight:0
              (not a fixed maxHeight) to always extend to the panel's own
              bottom. For classification/regression the OUTER panel now
              scrolls as a whole, so this just grows naturally with its
              content instead of getting its own separate inner scrollbar -
              two independent scroll regions stacked on each other reads as
              broken, not helpful. The ⋮ menu itself is rendered once at
              the page root (see historyMenuOpen below) instead of nested in
              this box, since a nested position:absolute popup still gets
              clipped by an ancestor's overflow:auto no matter its z-index. */}
          <div style={taskType === 'clustering'
            ? { marginTop: 26, paddingTop: 14, borderTop: `1px solid ${C.border}`, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
            : { marginTop: 26, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <SectionLabel>Model History</SectionLabel>
            <div style={taskType === 'clustering'
              ? { flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }
              : {}}>
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
                    {m.task_type === 'clustering' ? `k=${m.n_clusters}`
                      : m[m.metric] != null ? `${m.metric}: ${m.task_type === 'classification' ? pct(m[m.metric]) : m[m.metric]}` : ''}
                  </span>
                  <button ref={el => { historyMenuBtnRefs.current[m.model_id] = el }}
                    onClick={e => { e.stopPropagation(); setHistoryMenuOpen(historyMenuOpen === m.model_id ? null : m.model_id) }}
                    style={{ border: 'none', background: 'none', color: C.muted, cursor: 'pointer', fontSize: 13 }}>
                    ⋮
                  </button>
                </div>
              ))
            )}
            </div>
          </div>
        </div>

        {/* ══════════════════ RIGHT PANEL — output ══════════════════ */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', padding: '20px 28px 60px' }}>

          {!selectedModel && !activeResult && (
            <div style={{ textAlign: 'center', padding: '120px 0', color: C.muted }}>
              <div style={{ fontSize: 40, marginBottom: 14 }}>🤖</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: C.text, marginBottom: 6 }}>Train and Test</div>
              <div style={{ fontSize: 13 }}>Select a model and configure settings on the left to begin.</div>
            </div>
          )}

          {/* Shows whenever there's elbow data (or it's loading) and no
              trained result yet — including right after this page remounts
              with elbowData restored from localStorage, so the user never
              has to re-pick KNN/K-Means just to see the curve again. */}
          {!activeResult && (elbowLoading || elbowData) && selectedModel === 'knn' && (
            <ChartCard title="KNN — Optimal K Search"
              sub={`Odd values of k from 1 to 39. Y-axis: ${currentMetricInfo.label}. Best k highlighted.`}>
              {elbowLoading && <div style={{ textAlign: 'center', padding: 60, color: C.muted }}>⏳ Computing elbow curve…</div>}
              {!elbowLoading && elbowData && (
                <ElbowChart
                  kValues={elbowData.k_values}
                  values={elbowData.scores}
                  bestK={elbowData.best_k}
                  currentK={kValue}
                  yLabel={currentMetricInfo.label}
                  onPick={handleKPick}
                />
              )}
            </ChartCard>
          )}

          {!activeResult && (elbowLoading || elbowData) && selectedModel === 'kmeans' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <ChartCard title="Elbow Method — Inertia & Entropy"
                sub="Both curves normalized to a 0–100 relative scale for comparison.">
                {elbowLoading && <div style={{ textAlign: 'center', padding: 60, color: C.muted }}>⏳ Computing elbow curve…</div>}
                {!elbowLoading && elbowData && (
                  <KMeansElbowChart elbowData={elbowData} currentK={kValue} onPick={handleKPick} C={C} />
                )}
              </ChartCard>
              {!elbowLoading && elbowData && <ElbowExplanationCard C={C} />}
            </div>
          )}

          {selectedModel && !activeResult && selectedModel !== 'knn' && selectedModel !== 'kmeans' && (
            <div style={{ textAlign: 'center', padding: '100px 0', color: C.muted }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>{ALL_MODELS.find(m => m.id === selectedModel)?.icon}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>{modelLabel(selectedModel)} ready to train</div>
              <div style={{ fontSize: 12.5, maxWidth: 420, margin: '0 auto' }}>{MODEL_DESCRIPTIONS[selectedModel]}</div>
            </div>
          )}

          {activeResult && (
            <TrainingResults result={displayedResult} outputOptions={outputOptions}
              onEditOutput={() => setShowEditOutput(true)} threshold={threshold} />
          )}
        </div>
      </div>

      {/* Forward-navigation button — only rendered once there's an actual
          result to continue with. The disabled "Train a model to continue"
          placeholder (shown whenever nothing was trained yet) was removed
          per explicit request; the real button still needs to exist once
          a result exists, since this page is the only way to reach Feature
          Importance (App.jsx's forward navigation is exclusively through
          each page's own "Continue" button - TopNav is backward-only). */}
      {activeResult && (
        <div style={{ textAlign: 'center', padding: '14px 0 16px', flexShrink: 0, borderTop: `1px solid ${C.border}` }}>
          <button onClick={() => onNext && onNext()}
            style={{
              padding: '11px 26px', borderRadius: 10, border: 'none',
              background: C.primary, color: 'white', fontWeight: 800, fontSize: 13.5,
              cursor: 'pointer', boxShadow: `0 4px 16px ${C.primary}44`,
            }}>
            Continue to Feature Importance →
          </button>
        </div>
      )}

      {historyMenuOpen && modelHistory.find(m => m.model_id === historyMenuOpen) && (
        <ModelActionsMenu entry={modelHistory.find(m => m.model_id === historyMenuOpen)}
          pos={historyMenuPos} popupRef={historyMenuPopupRef}
          onView={() => setActiveResult(modelHistory.find(m => m.model_id === historyMenuOpen))}
          onDownload={() => downloadModel(modelHistory.find(m => m.model_id === historyMenuOpen))}
          onVisualizeTree={() => setTreePopupEntry(modelHistory.find(m => m.model_id === historyMenuOpen))}
          onDelete={() => {
            setModelHistory(h => h.filter(x => x.model_id !== historyMenuOpen))
            if (activeResult?.model_id === historyMenuOpen) setActiveResult(null)
          }}
          onClose={() => setHistoryMenuOpen(null)} />
      )}

      {paramPickerOpen && (
        <GridParamPickerPopup
          options={(MODEL_PARAM_DEFS[selectedModel] || []).filter(d => !gridParams.some(g => g.name === d.name))}
          pos={paramPickerPos} popupRef={paramPickerPopupRef}
          onPick={pickParam} onClose={() => setParamPickerOpen(false)} />
      )}

      {valuePicker && (
        <GridValuePickerPopup
          def={valuePicker.def} checked={valuePicker.checked} candidates={candidateValuesFor(valuePicker.def)}
          pos={valuePickerPos} popupRef={valuePickerPopupRef}
          onToggle={toggleValuePickerChecked} onSave={saveValuePicker} onClose={() => setValuePicker(null)} />
      )}

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
        <AllPairsSection viz={result.cluster_viz} />
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
            <MetricCard label="Accuracy" icon="🎯" value={pct(result.accuracy)} ratio={result.accuracy} accent={C.primary} />
            <MetricCard label="F1-Score" icon="⚖" value={pct(result.f1)} ratio={result.f1} accent="#8b5cf6" />
            <MetricCard label="Precision" icon="🔬" value={pct(result.precision)} ratio={result.precision} accent={C.success} />
            <MetricCard label="Recall" icon="📡" value={pct(result.recall)} ratio={result.recall} accent={C.warning} />
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
            <span key={i} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: C.primary, color: 'white' }}>{pct(s)}</span>
          ))}
          <span style={{ fontSize: 12, color: C.text, marginLeft: 6 }}>Mean: <strong>{pct(result.cv_mean)}</strong> ± {pct(result.cv_std)}</span>
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
