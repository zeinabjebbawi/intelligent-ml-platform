/**
 * PRISM — Report Page (Final Page)
 * Page name: "Report"
 *
 * Sections:
 *   1. Key Findings   — auto-generated summary cards
 *   2. Export Options — PDF, Notebook, Model download
 *
 * Design: shares the app-wide theme system (../theme.jsx) for the shared
 * TopNav/VersionsBar and every control, including the header — reads off
 * `C` like every other page in the pipeline (a prior draft gave this page
 * its own hardcoded indigo/purple gradient header instead; removed for
 * visual consistency with the rest of the app).
 */
import { useState, useEffect, useRef } from 'react'
import { useTheme } from '../theme'
import TopNav from '../components/TopNav'

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
// KEY FINDINGS CARD
// ─────────────────────────────────────────────────────────────────────────────
const FindingCard = ({ title, text, accent }) => {
  const { C } = useTheme()
  return (
    <div style={{ background: C.card, borderRadius: 12, padding: '16px 18px', boxShadow: shadow2,
      border: `1px solid ${C.border}`, borderLeft: `3px solid ${accent || C.primary}` }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 8 }}>{title}</div>
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
    { key: 'accuracy',  label: 'Accuracy',  pct: true },
    { key: 'f1',        label: 'F1-Score',  pct: true },
    { key: 'precision', label: 'Precision', pct: true },
    { key: 'recall',    label: 'Recall',    pct: true },
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
          <div style={{ fontSize: 24, fontWeight: 900, color: e.color || C.text }}>
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
const ExportBtn = ({ label, sub, accent, onClick, loading, disabled }) => {
  const { C } = useTheme()
  return (
    <button onClick={onClick} disabled={loading || disabled}
      style={{ background: C.card, border: `1.5px solid ${disabled ? C.border : (accent || C.border)}`,
        borderRadius: 14, padding: '16px 20px', cursor: (loading || disabled) ? 'default' : 'pointer',
        textAlign: 'left', transition: 'all 0.15s', flex: 1, minWidth: 180,
        boxShadow: shadow2, opacity: (loading || disabled) ? 0.55 : 1 }}
      onMouseEnter={e => { if (!loading && !disabled) e.currentTarget.style.background = `${accent || C.primary}0d` }}
      onMouseLeave={e => { e.currentTarget.style.background = C.card }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 2 }}>{loading ? 'Exporting…' : label}</div>
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

  if (loading) return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <TopNav active={active || 'report'} onNavigate={onNavigate} furthestOrder={furthestOrder} taskType={projectData?.taskType} />
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
        <TopNav active={active || 'report'} onNavigate={onNavigate} furthestOrder={furthestOrder} taskType={projectData?.taskType} />
      </div>

      <div style={{ padding: '32px 40px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color: C.muted, marginBottom: 8 }}>
              PRISM ML Platform — Final Report
            </div>
            <h1 style={{ fontSize: 32, fontWeight: 900, margin: 0, marginBottom: 6, color: C.text }}>
              {reportData?.project_title || 'Project Report'}
            </h1>
            <div style={{ fontSize: 13, color: C.muted }}>
              Generated {reportData?.generated_at ? new Date(reportData.generated_at).toLocaleString() : new Date().toLocaleString()}
            </div>
          </div>
          <button onClick={handlePrint} className="no-print"
            style={{ padding: '10px 20px', borderRadius: 10, border: `1px solid ${C.border}`,
              background: C.card, color: C.primary, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Print / PDF
          </button>
        </div>
      </div>

      <div style={{ padding: '28px 40px 0' }}>

        {error && (
          <div className="no-print" style={{ background: C.dangerSoft, border: `1px solid ${C.danger}`, borderRadius: 12,
            padding: '14px 18px', color: C.danger, marginBottom: 20, fontSize: 13 }}>{error}</div>
        )}

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
              <FindingCard key={i} title={f.title} text={f.text}
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
            <ExportBtn label="Download Report as PDF" sub="Print-optimized version of this page"
              accent={C.primary} onClick={handlePrint} />
            <ExportBtn label="Export Jupyter Notebook" sub=".ipynb with full pipeline code + comments"
              accent="#8b5cf6" onClick={handleExportNotebook} loading={nbLoading} />
            <ExportBtn label="Download Trained Model" sub=".pkl file — load in any Python environment"
              accent={C.success} onClick={handleDownloadModel} disabled={!modelPath} />
          </div>

          <div style={{ marginTop: 16, padding: '14px 18px', background: C.faint, borderRadius: 12, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              How to use the exports
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
              {[
                { title: 'PDF Report', desc: 'Share with supervisors, clients, or as a capstone deliverable. All sections are print-formatted.' },
                { title: 'Jupyter Notebook', desc: 'Open in Jupyter Lab or VS Code. Run cells top-to-bottom to reproduce the full pipeline from scratch.' },
                { title: 'Model File (.pkl)', desc: 'Load with pickle.load() in Python. Deploy for batch prediction in any Python environment.' },
              ].map(e => (
                <div key={e.title}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: C.text }}>{e.title}</div>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{e.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── PROJECT COMPLETE ── */}
        <div style={{ textAlign: 'center', padding: '32px 0',
          background: `linear-gradient(135deg, ${C.success}10, ${C.primary}10)`,
          borderRadius: 16, border: `1px solid ${C.border}`, marginBottom: 24 }}>
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
