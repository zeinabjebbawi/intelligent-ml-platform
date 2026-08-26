/**
 * PRISM — Report Page (Final Page)
 * Page name: "Report"
 *
 * Sections:
 *   1. Journey Timeline — visual horizontal timeline of every stage
 *   2. Key Findings     — auto-generated summary cards
 *   3. Export Options   — PDF, Notebook, Model download
 *
 * Design: shares the app-wide theme system (../theme.jsx) for the shared
 * TopNav/VersionsBar and every ordinary control, but — deliberately, this
 * is the one page in the pipeline that gets its own distinct gradient
 * header (indigo → purple) rather than the plain page header every other
 * page uses. This is the final deliverable page; marking it visually
 * distinct from the 14 working pages before it is intentional, not a
 * theme-discipline lapse (a pasted first draft's hardcoded indigo/purple
 * hex values were kept for exactly this one deliberate accent — everything
 * else on the page still reads off `C`).
 */
import { useState, useEffect, useRef } from 'react'
import { useTheme } from '../theme'
import TopNav from '../components/TopNav'
import { STEP_ORDER } from '../hooks/useVersionHistory'

const shadow2 = '0 2px 8px rgba(0,0,0,0.05)'
const shadow  = '0 4px 24px rgba(0,0,0,0.07)'

// 127.0.0.1, not "localhost" — this machine resolves "localhost" to both
// ::1 and 127.0.0.1, and the FastAPI dev server only binds IPv4.
const ML_API = 'http://127.0.0.1:8001'

const callReport = async (endpoint, body) => {
  const res = await fetch(`${ML_API}/report/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || `Error ${res.status}`) }
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE DEFINITIONS — order and keys must match the real STEP_ORDER
// (frontend/src/hooks/useVersionHistory.js), not a hand-copied guess. A
// pasted first draft had `feature_engineering` BEFORE `encoding` here,
// which is backwards from the real pipeline (encoding: 6, feature_
// engineering: 7) — fixed by deriving `order` straight from STEP_ORDER
// instead of hardcoding a second, driftable copy of the sequence.
// ─────────────────────────────────────────────────────────────────────────────
const ALL_STAGES = [
  { key: 'upload',              label: 'Upload',              icon: '📤' },
  { key: 'diagnose',            label: 'Diagnose',            icon: '🔍' },
  { key: 'cleaning_duplicates', label: 'Duplicates',          icon: '🧹' },
  { key: 'cleaning_outliers',   label: 'Outliers',            icon: '⚡' },
  { key: 'cleaning_missing',    label: 'Missing Values',      icon: '🧩' },
  { key: 'encoding',            label: 'Encode & Scale',      icon: '🔢' },
  { key: 'feature_engineering', label: 'Feature Eng.',        icon: '✦' },
  { key: 'sampling',            label: 'Sampling',            icon: '⚖' },
  { key: 'data_readiness',      label: 'Visualization',       icon: '📊' },
  { key: 'feature_selection',   label: 'Feature Select.',     icon: '✓' },
  { key: 'training',            label: 'Train & Test',        icon: '🤖' },
  { key: 'feature_impact',      label: 'Feature Importance',  icon: '💡' },
  { key: 'learning_curve',      label: 'Learning Curve',      icon: '📉' },
  { key: 'simulator',           label: 'Simulator',           icon: '🎮' },
  { key: 'report',              label: 'Report',              icon: '📄' },
].map(s => ({ ...s, order: STEP_ORDER[s.key] }))

const STAGE_COLORS = ['#6366f1', '#8b5cf6', '#f59e0b', '#f59e0b', '#f59e0b', '#06b6d4', '#06b6d4',
  '#10b981', '#10b981', '#6366f1', '#6366f1', '#f59e0b', '#06b6d4', '#8b5cf6', '#10b981']

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY TIMELINE
// ─────────────────────────────────────────────────────────────────────────────
const JourneyTimeline = ({ furthestOrder, stepsInfo }) => {
  const { C } = useTheme()
  const [expandedKey, setExpanded] = useState(null)
  const scrollRef = useRef()

  // Real completion state, not a placeholder — a pasted first draft's
  // `isCompleted = (key) => completedSteps?.includes(key) || true` always
  // evaluated to `true` no matter what `completedSteps` held (the `|| true`
  // made the check itself meaningless), so the timeline claimed every
  // stage was done even for a project that had barely started. This uses
  // the SAME `furthestOrder` mechanism App.jsx already tracks for every
  // other page's nav-gating — a stage is "done" once the user has actually
  // advanced past it.
  const isCompleted = (order) => order <= furthestOrder

  return (
    <div>
      <div ref={scrollRef} style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0,
          minWidth: `${ALL_STAGES.length * 90}px`, paddingTop: 24, paddingBottom: 8 }}>
          {ALL_STAGES.map((stage, idx) => {
            const color = STAGE_COLORS[idx]
            const done = isCompleted(stage.order)
            const info = stepsInfo?.[stage.key]
            const isOpen = expandedKey === stage.key

            return (
              <div key={stage.key} style={{ display: 'flex', flexDirection: 'column',
                alignItems: 'center', flex: 1, position: 'relative', minWidth: 84 }}>
                {idx > 0 && (
                  <div style={{ position: 'absolute', top: 19, right: '50%', left: 0, height: 3,
                    background: done ? color : C.border, transition: 'background 0.3s' }} />
                )}
                {idx < ALL_STAGES.length - 1 && (
                  <div style={{ position: 'absolute', top: 19, left: '50%', right: 0, height: 3,
                    background: isCompleted(ALL_STAGES[idx + 1].order) ? STAGE_COLORS[idx + 1] : C.border,
                    transition: 'background 0.3s' }} />
                )}
                <div onClick={() => setExpanded(isOpen ? null : stage.key)}
                  style={{ width: 40, height: 40, borderRadius: '50%', zIndex: 2,
                    background: done ? color : C.faint,
                    border: `3px solid ${done ? color : C.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, cursor: 'pointer', position: 'relative',
                    boxShadow: done ? `0 0 0 4px ${color}22` : 'none', transition: 'all 0.2s' }}>
                  {done ? stage.icon : '○'}
                </div>
                <div style={{ marginTop: 8, fontSize: 9, fontWeight: 600,
                  color: done ? C.text : C.muted, textAlign: 'center', lineHeight: 1.3, maxWidth: 78 }}>
                  {stage.label}
                </div>
                {isOpen && info && (
                  <div style={{ position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)',
                    zIndex: 100, background: C.card, border: `1.5px solid ${color}`, borderRadius: 10,
                    padding: '10px 14px', width: 200, boxShadow: shadow, fontSize: 11, color: C.text, lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 700, color, marginBottom: 4 }}>{stage.icon} {stage.label}</div>
                    {info.decision && <div style={{ color: C.text }}>{info.decision}</div>}
                    {info.version && <div style={{ color: C.muted, marginTop: 3 }}>Version: {info.version}</div>}
                    {info.metric && <div style={{ color: C.success, fontWeight: 600, marginTop: 3 }}>{info.metric}</div>}
                    <button onClick={e => { e.stopPropagation(); setExpanded(null) }}
                      style={{ position: 'absolute', top: 4, right: 6, background: 'none', border: 'none',
                        cursor: 'pointer', color: C.muted, fontSize: 12 }}>✕</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 4 }}>
        Click any stage node to see the decision made at that step. Scroll horizontally to see the full pipeline.
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// KEY FINDINGS CARD
// ─────────────────────────────────────────────────────────────────────────────
const FindingCard = ({ icon, title, text, accent }) => {
  const { C } = useTheme()
  return (
    <div style={{ background: C.card, borderRadius: 12, padding: '16px 18px', boxShadow: shadow2,
      border: `1px solid ${C.border}`, borderLeft: `3px solid ${accent || C.primary}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{title}</span>
      </div>
      <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.7, margin: 0 }}>{text}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// METRICS SUMMARY STRIP — task-type-aware. A pasted first draft only ever
// showed accuracy/F1/precision/recall, which don't exist at all for a
// regression or clustering result — the strip would just silently render
// nothing useful for 2 of this platform's 3 task types.
// ─────────────────────────────────────────────────────────────────────────────
const METRIC_SETS = {
  classification: [
    { key: 'accuracy',  label: 'Accuracy',  pct: true,  color: '#6366f1' },
    { key: 'f1',        label: 'F1-Score',  pct: true,  color: '#10b981' },
    { key: 'precision', label: 'Precision', pct: true,  color: '#f59e0b' },
    { key: 'recall',    label: 'Recall',    pct: true,  color: '#8b5cf6' },
  ],
  regression: [
    { key: 'r2',   label: 'R²',   pct: false, color: '#6366f1' },
    { key: 'mae',  label: 'MAE',  pct: false, color: '#f59e0b' },
    { key: 'rmse', label: 'RMSE', pct: false, color: '#8b5cf6' },
  ],
  clustering: [
    { key: 'n_clusters', label: 'Clusters', pct: false, color: '#6366f1' },
    { key: 'inertia',    label: 'Inertia',  pct: false, color: '#f59e0b' },
    { key: 'entropy',    label: 'Entropy',  pct: false, color: '#8b5cf6' },
  ],
}

const MetricsStrip = ({ metrics, modelName, taskType }) => {
  const { C } = useTheme()
  const set = METRIC_SETS[taskType] || METRIC_SETS.classification
  const entries = set
    .map(e => ({ ...e, value: metrics?.[e.key] }))
    .filter(e => e.value !== undefined && e.value !== null)
  return (
    <div style={{ background: `linear-gradient(135deg, ${C.primary}10, ${C.success}10)`,
      border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 24px',
      display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ borderRight: `1px solid ${C.border}`, paddingRight: 20, marginRight: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: C.muted, textTransform: 'uppercase',
          letterSpacing: 1.5, marginBottom: 4 }}>Best Model</div>
        <div style={{ fontSize: 18, fontWeight: 900, color: C.primary }}>{modelName || '—'}</div>
      </div>
      {entries.map(e => (
        <div key={e.key} style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase',
            letterSpacing: 1, marginBottom: 4 }}>{e.label}</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: e.color }}>
            {e.pct ? `${(e.value * 100).toFixed(1)}%` : Number(e.value).toFixed(e.key === 'n_clusters' ? 0 : 2)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT BUTTON
// ─────────────────────────────────────────────────────────────────────────────
const ExportBtn = ({ icon, label, sub, accent, onClick, loading, disabled }) => {
  const { C } = useTheme()
  return (
    <button onClick={onClick} disabled={loading || disabled}
      style={{ background: C.card, border: `1.5px solid ${disabled ? C.border : (accent || C.border)}`,
        borderRadius: 14, padding: '16px 20px', cursor: (loading || disabled) ? 'default' : 'pointer',
        textAlign: 'left', transition: 'all 0.15s', flex: 1, minWidth: 180,
        boxShadow: shadow2, opacity: (loading || disabled) ? 0.55 : 1 }}
      onMouseEnter={e => { if (!loading && !disabled) e.currentTarget.style.background = `${accent || C.primary}0d` }}
      onMouseLeave={e => { e.currentTarget.style.background = C.card }}>
      <div style={{ fontSize: 24, marginBottom: 6 }}>{loading ? '⏳' : icon}</div>
      <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: C.muted }}>{disabled ? 'No trained model to export yet' : sub}</div>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function ReportPage({
  projectData, versions, stepsInfo, getDisplayPath, modelPklPath,
  active, onNavigate, furthestOrder,
}) {
  const { C } = useTheme()
  const [reportData, setReportData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nbLoading, setNbLoading] = useState(false)
  const reportRef = useRef()

  const modelPath = modelPklPath || projectData?.lastModelPath
  const taskType = projectData?.taskType || 'classification'
  const filePath = getDisplayPath ? getDisplayPath('report') : projectData?.filePath
  // Same pattern DataReadiness.jsx already uses: the true original upload,
  // read directly from the accumulated version history rather than
  // requiring a caller to separately thread an `originalFilePath` through
  // projectData (one less place that field could go stale or unset).
  const originalPath = (versions || []).find(v => v.stepName === 'upload')?.filePath
    || projectData?.originalFilePath || null

  useEffect(() => {
    setLoading(true); setError('')
    callReport('generate', {
      original_file_path: originalPath,
      current_file_path:  filePath,
      target_column:       projectData?.targetColumn || null,
      task_type:           taskType,
      model_pkl_path:      modelPath || null,
      model_name:          projectData?.lastModelName || null,
      model_params:        projectData?.lastModelParams || {},
      feature_names:       projectData?.selectedFeatures || [],
      metrics:             projectData?.lastMetrics || {},
      train_ratio:         projectData?.trainRatio || 0.80,
      cleaning_stats:      projectData?.cleaningStats || {},
      feature_engineering_steps: projectData?.featureEngSteps || [],
      shap_top_features:   projectData?.shapTopFeatures || [],
      pattern_type:        projectData?.lcPattern || null,
      balance_level:       projectData?.balanceLevel || null,
    })
      .then(setReportData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [filePath, originalPath, modelPath])

  const handleExportNotebook = async () => {
    setNbLoading(true); setError('')
    try {
      const body = {
        original_file_path: originalPath,
        current_file_path:  filePath,
        target_column:       projectData?.targetColumn || 'target',
        task_type:            taskType,
        model_pkl_path:       modelPath || null,
        model_name:           projectData?.lastModelName || 'model',
        model_params:         projectData?.lastModelParams || {},
        feature_names:        projectData?.selectedFeatures || [],
        metrics:              projectData?.lastMetrics || {},
        train_ratio:          projectData?.trainRatio || 0.80,
        cleaning_stats:       projectData?.cleaningStats || {},
        feature_engineering_steps: projectData?.featureEngSteps || [],
      }
      const res = await fetch(`${ML_API}/report/export-notebook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || `Error ${res.status}`) }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'prism_ml_pipeline.ipynb'; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { setError(e.message) }
    finally { setNbLoading(false) }
  }

  const handleDownloadModel = () => {
    if (!modelPath) return
    const mn = projectData?.lastModelName || 'model'
    window.open(`${ML_API}/report/download-model?model_pkl_path=${encodeURIComponent(modelPath)}&model_name=${mn}`, '_blank')
  }

  const handlePrint = () => window.print()

  const metrics = projectData?.lastMetrics || {}
  const modelName = projectData?.lastModelName || null
  const hasScoreMetric = metrics.accuracy != null || metrics.r2 != null || metrics.n_clusters != null

  const defaultStepsInfo = {
    upload:              { decision: `Dataset uploaded: ${reportData?.summary_stats?.original_rows?.toLocaleString() || '—'} rows`, version: 'Original' },
    cleaning_duplicates: { decision: `${projectData?.cleaningStats?.duplicates_removed || 0} duplicate rows removed` },
    cleaning_outliers:   { decision: `${projectData?.cleaningStats?.outliers_removed || 0} outlier rows removed via IQR` },
    cleaning_missing:    { decision: 'Missing values imputed using mean/mode' },
    encoding:            { decision: 'Categorical columns encoded; numeric columns scaled' },
    feature_selection:   { decision: `${projectData?.selectedFeatures?.length || '—'} features selected` },
    training:            { decision: `${modelName || 'Model'} trained`, metric: metrics.accuracy != null ? `Accuracy: ${(metrics.accuracy * 100).toFixed(1)}%` : (metrics.r2 != null ? `R²: ${metrics.r2.toFixed(3)}` : '') },
    feature_impact:      { decision: 'SHAP global + waterfall analysis completed' },
    learning_curve:      { decision: projectData?.lcPattern ? `Pattern: ${projectData.lcPattern}` : 'Learning curve analyzed' },
    report:               { decision: 'Final report generated', version: 'Complete' },
  }

  if (loading) return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <TopNav active={active || 'report'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
      <div style={{ textAlign: 'center', padding: '80px 0', color: C.muted }}>
        <div style={{ fontSize: 28, display: 'inline-block', animation: 'rpt-spin 1s linear infinite', marginBottom: 12 }}>◐</div>
        <p>Generating final project report…</p>
        <style>{`@keyframes rpt-spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )

  return (
    <div ref={reportRef} style={{ background: C.bg, minHeight: '100vh', paddingBottom: 60 }} className="report-page">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
          .report-page { padding: 0; }
          * { box-shadow: none !important; }
        }
      `}</style>

      <div className="no-print">
        <TopNav active={active || 'report'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
      </div>

      {/* Deliberately the one distinct-colored header on the platform —
          see file header comment. */}
      <div style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', padding: '32px 40px', color: 'white' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, opacity: 0.75, marginBottom: 8 }}>
              PRISM ML Platform — Final Report
            </div>
            <h1 style={{ fontSize: 32, fontWeight: 900, margin: 0, marginBottom: 6 }}>
              {reportData?.project_title || 'Project Report'}
            </h1>
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              Generated {reportData?.generated_at ? new Date(reportData.generated_at).toLocaleString() : new Date().toLocaleString()}
            </div>
          </div>
          <button onClick={handlePrint} className="no-print"
            style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.35)',
              background: 'rgba(255,255,255,0.15)', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            🖨 Print / PDF
          </button>
        </div>

        {modelName && (
          <div style={{ display: 'flex', gap: 24, marginTop: 20, padding: '14px 20px',
            background: 'rgba(255,255,255,0.14)', borderRadius: 12, flexWrap: 'wrap' }}>
            {[
              { label: 'Model', value: modelName },
              { label: taskType === 'regression' ? 'R²' : taskType === 'clustering' ? 'Clusters' : 'Accuracy',
                value: taskType === 'regression' ? (metrics.r2 != null ? metrics.r2.toFixed(3) : '—')
                  : taskType === 'clustering' ? (metrics.n_clusters ?? '—')
                  : (metrics.accuracy != null ? `${(metrics.accuracy * 100).toFixed(1)}%` : '—') },
              { label: 'F1-Score', value: metrics.f1 != null ? `${(metrics.f1 * 100).toFixed(1)}%` : '—', hide: taskType !== 'classification' },
              { label: 'Features', value: projectData?.selectedFeatures?.length || '—' },
            ].filter(m => !m.hide).map(m => (
              <div key={m.label}>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, opacity: 0.65, marginBottom: 2 }}>{m.label}</div>
                <div style={{ fontSize: 18, fontWeight: 900 }}>{m.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '28px 40px 0' }}>

        {error && (
          <div className="no-print" style={{ background: C.dangerSoft, border: `1px solid ${C.danger}`, borderRadius: 12,
            padding: '14px 18px', color: C.danger, marginBottom: 20, fontSize: 13 }}>⚠ {error}</div>
        )}

        {/* ── SECTION 1: Journey Timeline ── */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: C.text, margin: 0 }}>Project Journey</h2>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>— every stage of the ML pipeline</span>
          </div>
          <div style={{ background: C.card, borderRadius: 16, padding: '24px 28px', boxShadow: shadow2, border: `1px solid ${C.border}` }}>
            <JourneyTimeline furthestOrder={furthestOrder ?? Infinity} stepsInfo={stepsInfo || defaultStepsInfo} />
          </div>
        </div>

        {/* ── SECTION 2: Key Findings ── */}
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 16 }}>Key Findings</h2>

          {modelName && hasScoreMetric && (
            <div style={{ marginBottom: 16 }}>
              <MetricsStrip metrics={metrics} modelName={modelName} taskType={taskType} />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {(reportData?.findings || []).map((f, i) => (
              <FindingCard key={i} icon={f.icon} title={f.title} text={f.text}
                accent={[C.primary, '#8b5cf6', C.warning, C.success, '#06b6d4', '#f43f5e'][i % 6]} />
            ))}
            {!reportData?.findings?.length && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '30px 0', color: C.muted, fontSize: 13 }}>
                Run the full pipeline first — findings are auto-generated from your project context.
              </div>
            )}
          </div>
        </div>

        {/* ── SECTION 3: Export Options ── */}
        <div className="no-print" style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 16 }}>Export Options</h2>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <ExportBtn icon="📄" label="Download Report as PDF" sub="Print-optimized version of this page"
              accent={C.primary} onClick={handlePrint} />
            <ExportBtn icon="📓" label="Export Jupyter Notebook" sub=".ipynb with full pipeline code + comments"
              accent="#8b5cf6" onClick={handleExportNotebook} loading={nbLoading} />
            <ExportBtn icon="🤖" label="Download Trained Model" sub=".pkl file — load in any Python environment"
              accent={C.success} onClick={handleDownloadModel} disabled={!modelPath} />
          </div>

          <div style={{ marginTop: 16, padding: '14px 18px', background: C.faint, borderRadius: 12, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              How to use the exports
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
              {[
                { icon: '📄', title: 'PDF Report', desc: 'Share with supervisors, clients, or as a capstone deliverable. All sections are print-formatted.' },
                { icon: '📓', title: 'Jupyter Notebook', desc: 'Open in Jupyter Lab or VS Code. Run cells top-to-bottom to reproduce the full pipeline from scratch.' },
                { icon: '🤖', title: 'Model File (.pkl)', desc: 'Load with pickle.load() in Python. Deploy for batch prediction in any Python environment.' },
              ].map(e => (
                <div key={e.title} style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{e.icon}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 12, color: C.text }}>{e.title}</div>
                    <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{e.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── PROJECT COMPLETE ── */}
        <div style={{ textAlign: 'center', padding: '32px 0',
          background: `linear-gradient(135deg, ${C.success}10, ${C.primary}10)`,
          borderRadius: 16, border: `1px solid ${C.border}`, marginBottom: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>🎓</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 6 }}>Project Complete</div>
          <div style={{ fontSize: 14, color: C.muted, maxWidth: 500, margin: '0 auto', lineHeight: 1.7 }}>
            You have completed the full PRISM ML pipeline — from raw data upload to trained model
            evaluation, feature analysis, and prediction simulation. Your deliverables are ready for export above.
          </div>
        </div>
      </div>
    </div>
  )
}
