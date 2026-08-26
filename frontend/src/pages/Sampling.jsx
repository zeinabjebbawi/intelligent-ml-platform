/**
 * PRISM — Sampling Page
 * Philosophy: Try-See-Decide. Sampling is not just about fixing imbalance.
 *
 * Layout:
 *   [TopNav] [Header] [VersionsBar] [ℹ Description]
 *   [KPI Cards row] [Guidance banner] [Time-series warning]
 *   [Left: Control Panel (8 methods + 2 time-safe, scrollable) |
 *    Right: Preview + Results (timeline visuals when time-series detected)]
 *
 * Design: shares the app-wide theme system (../theme.jsx) and TopNav
 * (../components/TopNav.jsx) rather than its own tokens — same convention
 * Encoding.jsx and FeatureEngineering.jsx already follow.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTheme } from '../theme'
import TopNav from '../components/TopNav'
import SharedVersionsBar from '../components/VersionsBar'
import { getBalanceLevelConfig } from '../constants/balanceLevels'

const shadow  = '0 4px 24px rgba(0,0,0,0.08)'
const shadow2 = '0 1px 4px rgba(0,0,0,0.06)'
const TABLE_BODY_MAX_HEIGHT = 420   // matches Encoding.jsx / FeatureSelection.jsx convention

// ─────────────────────────────────────────────────────────────────────────────
// API HELPER — 127.0.0.1, not "localhost" (dual-stack landmine on this
// machine — see docs/PROJECT_HANDOFF.md §11.2)
// ─────────────────────────────────────────────────────────────────────────────
const ML_API = 'http://127.0.0.1:8001'

const callSampling = async (endpoint, body) => {
  const res = await fetch(`${ML_API}/sampling/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Error ${res.status}`)
  }
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────────
// DESCRIPTION CONTENT — full rewrite per explicit user request: covers all 8
// implemented strategies (not just the original 4) and drops the reference
// table that used to sit inside the widget (removed entirely, see
// DescriptionWidget below).
// ─────────────────────────────────────────────────────────────────────────────
const DESCRIPTION = `Sampling controls how many and which rows your model trains on. It is not only about fixing class imbalance — it serves multiple independent purposes.

Why you might sample even on a perfectly balanced dataset:
• Computational Efficiency: A 5M-row dataset trains slowly. A stratified 20% sample often reaches 95% of the accuracy in a fraction of the time. Iterate fast, then scale.
• Resolves Class Imbalance: Real-world data is skewed. Fraud represents 0.1% of transactions; disease cases represent 5% of patient records. Models trained on raw data learn to predict "normal" almost exclusively. Sampling adjusts the ratio so rare events are represented fairly.
• Representative Subsets: Stratified sampling guarantees every subgroup appears in correct proportion — essential when demographic fairness matters.
• Ensures Fair Validation Splits: Careful, non-leaking sampling when splitting data into train/validation/test keeps performance metrics trustworthy — a model accidentally trained and tested on overlapping rows will report accuracy that doesn't hold up in production.
• Accelerates Experimentation: Test architectures, hyperparameters, and features on a smaller slice. Confirm what works, then apply to the full dataset.
• Approximates Complex Environments: In fields like reinforcement learning and robotics, computing every possible outcome is infeasible — sampling offers a practical, low-variance stand-in for the true distribution.

Sampling strategies:
1. Simple Random: use when your dataset is large and classes are balanced. (no pattern exists)
2. Stratified: use when you need to preserve exact class ratios during size reduction. (pattern exists)
3. Undersampling: use when the majority class dominates and you want to balance quickly without creating synthetic data.
4. Minority Oversampling (SMOTE): use when the minority class is small and undersampling would leave too few rows to train on — generates synthetic minority samples instead of just duplicating existing ones.
5. Systematic Sampling: selects every k-th row from an ordered dataset. Fast and deterministic.
6. Cluster Sampling: divides data into groups (clusters) and randomly selects whole clusters.
7. Reservoir Sampling: samples a fixed number of items from an infinite stream in one pass — no need to know the total size.
8. Importance Sampling: evaluates a target distribution using samples drawn from a different, accessible distribution.

⚠ Time-series caveat: If your data has temporal ordering (dates, timestamps), random shuffling destroys the sequence. Use a chronological split instead. This page will warn you if a datetime column is detected.

⚠ Stratified sampling caveat: stratifying by one column only protects against ordering patterns IN that column. If you stratify by Gender but the raw file has a hidden geographic sort, stratifying by Gender alone won't fix that — you'd need to stratify by the geographic column too. And remember: this caveat doesn't apply to genuinely time-ordered data at all — that case needs a chronological split, not stratification.`

// ─────────────────────────────────────────────────────────────────────────────
// KPI CARD
// ─────────────────────────────────────────────────────────────────────────────
const KPICard = ({ label, value, sub, accent, children }) => {
  const { C } = useTheme()
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: '18px 22px', flex: 1, minWidth: 0,
      boxShadow: shadow2, borderTop: `3px solid ${accent || C.primary}`,
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: C.muted,
        textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 900, color: C.text, marginBottom: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.muted }}>{sub}</div>}
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASS DISTRIBUTION BAR (used inside KPI card and in charts)
// ─────────────────────────────────────────────────────────────────────────────
const ClassBar = ({ dist, title, rowCount, accent }) => {
  const { C } = useTheme()
  if (!dist || dist.length === 0) return null
  const COLORS = [C.primary, C.success, C.warning, C.danger, '#8b5cf6', '#06b6d4']
  return (
    <div>
      {title && <div style={{ fontSize: 11, fontWeight: 700, color: C.muted,
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{title}</div>}
      {rowCount !== undefined && (
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>
          {rowCount.toLocaleString()} rows
        </div>
      )}
      {dist.map((cls, i) => (
        <div key={cls.class} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between',
            fontSize: 12, marginBottom: 3 }}>
            <span style={{ fontWeight: 600, color: C.text }}>
              Class <em style={{ fontStyle: 'normal', color: COLORS[i % COLORS.length] }}>
                {cls.class}
              </em>
            </span>
            <span style={{ color: C.muted }}>{cls.pct}% · {cls.count.toLocaleString()} rows</span>
          </div>
          <div style={{ height: 8, background: C.faint, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              width: `${cls.pct}%`, height: '100%',
              background: accent || COLORS[i % COLORS.length],
              borderRadius: 4, transition: 'width 0.6s ease',
            }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BEFORE / AFTER CHART PANEL
// ─────────────────────────────────────────────────────────────────────────────
// Class distribution lists in the "Sampled Results" tab can run to hundreds
// of entries for a regression target or a high-cardinality categorical
// (e.g. "class" per unique value) — past 6 classes the list would otherwise
// push the dataset preview table far below the fold. Scoped to THIS panel
// only (the "Current Dataset" tab's class-dist display is left unbounded,
// per explicit instruction).
const CLASS_SCROLL_THRESHOLD = 6
const CLASS_SCROLL_MAX_HEIGHT = 220

const BeforeAfterPanel = ({ before, after }) => {
  const { C } = useTheme()
  const scrollable = (before.class_dist?.length || 0) > CLASS_SCROLL_THRESHOLD
  const scrollStyle = scrollable
    ? { maxHeight: CLASS_SCROLL_MAX_HEIGHT, overflowY: 'auto', paddingRight: 4 }
    : {}
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
      <div style={{ background: C.faint, borderRadius: 12, padding: '16px 18px' }}>
        <div style={scrollStyle}>
          <ClassBar dist={before.class_dist} title="Before" rowCount={before.row_count} accent="#94a3b8" />
        </div>
      </div>
      <div style={{ background: C.primarySoft, border: `1px solid ${C.primary}33`,
        borderRadius: 12, padding: '16px 18px' }}>
        <div style={scrollStyle}>
          <ClassBar dist={after.class_dist} title="After" rowCount={after.row_count} accent={C.primary} />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMELINE VISUALIZATION — replaces class-distribution displays in the
// center panel once a timestamp column is detected (class distribution
// isn't a meaningful concept for the time-series-safe methods; a timeline
// bar communicates "row count in, timeline span out" instead). `after`
// null means "not run yet" (shows only the current/before state).
// ─────────────────────────────────────────────────────────────────────────────
const TimelineViz = ({ C, datetimeCol, before, after, method, startDate, endDate }) => (
  <div>
    <div style={{ fontSize: 11, fontWeight: 800, color: C.muted,
      textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
      {datetimeCol ? `Timeline · ${datetimeCol}` : 'Timeline'}
    </div>
    <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>
      {after != null ? 'Original Timeline' : 'Current Dataset Timeline'}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: C.muted }}>Start</span>
      <div style={{ flex: 1, height: 10, background: '#94a3b8', borderRadius: 5, opacity: 0.6 }} />
      <span style={{ fontSize: 11, color: C.muted }}>End</span>
      <span style={{ fontSize: 12, color: C.text, fontWeight: 700, marginLeft: 8, whiteSpace: 'nowrap' }}>
        {before.toLocaleString()} rows
      </span>
    </div>
    {after != null && (
      <>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.success, margin: '16px 0 8px' }}>
          ✓ After {method === 'DATE_RANGE' ? 'Date-Range Filter' : 'Systematic Sampling'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>
            {method === 'DATE_RANGE' && startDate ? startDate : 'Start'}
          </span>
          <div style={{
            flex: method === 'DATE_RANGE' ? Math.max(0.08, before ? after / before : 1) : 1,
            height: method === 'SYSTEMATIC_TIME' ? 4 : 10,
            background: C.success, borderRadius: 5, opacity: 0.85,
          }} />
          <span style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>
            {method === 'DATE_RANGE' && endDate ? endDate : 'End'}
          </span>
          <span style={{ fontSize: 12, color: C.success, fontWeight: 800, marginLeft: 8, whiteSpace: 'nowrap' }}>
            {after.toLocaleString()} rows — {method === 'SYSTEMATIC_TIME' ? 'timeline intact, thinned' : 'timeline trimmed'}!
          </span>
        </div>
      </>
    )}
  </div>
)

// ─────────────────────────────────────────────────────────────────────────────
// DATA TABLE
// ─────────────────────────────────────────────────────────────────────────────
const DataTable = ({ rows, columns }) => {
  const { C } = useTheme()
  if (!rows || rows.length === 0)
    return <div style={{ color: C.muted, fontSize: 13, padding: 20 }}>No data to display.</div>
  const cols = columns || Object.keys(rows[0]).slice(0, 8)
  const th = { padding: '9px 14px', textAlign: 'left', fontSize: 11,
    fontWeight: 700, color: C.muted, whiteSpace: 'nowrap', background: C.faint }
  const td = { padding: '8px 14px', color: C.text, whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }
  return (
    <div style={{ overflowX: 'auto', borderRadius: 10,
      border: `1px solid ${C.border}`, maxHeight: TABLE_BODY_MAX_HEIGHT, overflowY: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: 12 }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
          <tr>
            <th style={th}>#</th>
            {cols.map(col => <th key={col} style={th}>{col}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={td}>{ri + 1}</td>
              {cols.map(col => <td key={col} style={td}>{String(row[col] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DESCRIPTION WIDGET (ℹ pulsing button) — collapsed by default, full
// unclipped content when expanded, plus the technique reference table as a
// data-grounded callout (same "be creative like the scaling page" pattern
// already established for Encoding.jsx / FeatureEngineering.jsx).
// ─────────────────────────────────────────────────────────────────────────────
const DescriptionWidget = () => {
  const { C } = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: open ? C.warningSoft : C.faint,
        border: `1px solid ${open ? C.warning + '4d' : C.border}`,
        borderRadius: 10, padding: '10px 16px',
        transition: 'all 0.2s', cursor: 'pointer',
      }} onClick={() => setOpen(o => !o)}>
        <button style={{
          width: 28, height: 28, borderRadius: '50%',
          border: `2px solid ${C.warning}`,
          background: open ? C.warning : C.card,
          color: open ? 'white' : C.warning,
          fontWeight: 900, fontSize: 13, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 0 10px ${C.warning}44`,
          animation: open ? 'none' : 'pulse-warn 2s infinite',
          flexShrink: 0,
        }}>ℹ</button>
        <span style={{ fontSize: 13, color: open ? C.warning : C.muted, fontWeight: 600 }}>
          {open ? 'Why does sampling matter in ML?' : 'Click to understand sampling before choosing a strategy'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: C.muted }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{
          background: C.warningSoft, border: `1px solid ${C.warning}40`,
          borderRadius: '0 0 10px 10px', padding: '16px 20px',
          fontSize: 13, color: C.text, lineHeight: 1.7,
          whiteSpace: 'pre-line', borderTop: 'none',
        }}>
          {DESCRIPTION}
        </div>
      )}
      <style>{`@keyframes pulse-warn { 0%,100%{box-shadow:0 0 0 0 ${C.warning}66} 50%{box-shadow:0 0 0 6px ${C.warning}00} }`}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// REDO CONFIRMATION MODAL — same pattern as every other page in this app.
// ─────────────────────────────────────────────────────────────────────────────
const RedoModal = ({ onCancel, onConfirm, working }) => {
  const { C } = useTheme()
  return (
    <div style={{ position: 'fixed', inset: 0, background: C.scrim, backdropFilter: 'blur(4px)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.overlayCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: 30,
        maxWidth: 420, width: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8, color: C.text }}>Redo Sampling?</div>
        <p style={{ fontSize: 13, color: C.muted, marginBottom: 20, lineHeight: 1.6 }}>
          This clears your current sampling configuration and removes the Sampled Version if one was
          already applied — you'll start again from the original (pre-sampling) dataset.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '9px 20px', borderRadius: 10, border: `1px solid ${C.border}`,
            background: C.faint, color: C.text, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={onConfirm} disabled={working} style={{ padding: '9px 20px', borderRadius: 10, border: 'none',
            background: C.danger, color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {working ? 'Working…' : 'Yes, redo'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SAMPLING PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function SamplingPage({
  projectData, onNext, onUpdateData,
  getDisplayPath, getInputPath, registerVersion, isStepDone, getVersion, resetStep, versions,
  active, onNavigate, furthestOrder,
}) {
  const { C } = useTheme()

  const [profile, setProfile]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error,   setError]     = useState('')

  // Controls
  const [method,      setMethod]      = useState('simple_random')
  const [stratifyCol, setStratifyCol] = useState('')
  const [targetCol,   setTargetCol]   = useState('')
  const [samplePct,   setSamplePct]   = useState(20)
  const [shuffle,     setShuffle]     = useState(true)
  const [clusterN,    setClusterN]    = useState(10)
  const [reservoirN,  setReservoirN]  = useState(1000)

  // Time-series controls (only meaningful once profile.has_time_warning)
  const [dateColumn, setDateColumn] = useState('')
  const [startDate,  setStartDate]  = useState('')
  const [endDate,    setEndDate]    = useState('')
  const [stepSize,   setStepSize]   = useState(10)

  // Results
  const [phase,     setPhase]     = useState('config')   // 'config' | 'running' | 'preview' | 'applied'
  const [results,   setResults]   = useState(null)
  const [applying,  setApplying]  = useState(false)
  const [versionPath, setVP]      = useState(null)

  // Preview tab
  const [previewTab, setPreviewTab] = useState('raw')   // 'raw' | 'sampled'
  const [redoModal, setRedoModal] = useState(false)
  const [redoing, setRedoing] = useState(false)

  // filePath is the PERMANENT pre-sampling snapshot — the Raw Data tab's
  // source, the KPI/target-balance analysis source, AND the file every
  // /run and /apply call operates on. It MUST come from getInputPath, never
  // getDisplayPath — getDisplayPath deliberately flips to 'sampling'’s own
  // output once a version for this step exists (needed below, for resume),
  // which is exactly backwards for a value that's supposed to be a constant
  // "before" snapshot. Mirrors the exact fix Encoding.jsx needed for the
  // same reason — see that file's `filePath` comment for the full mechanism.
  const filePath = useMemo(() =>
    (getInputPath ? getInputPath('sampling') : null) || projectData?.filePath,
  [getInputPath, projectData])

  const done = isStepDone ? isStepDone('sampling') : phase === 'applied'
  const versionInfo = getVersion ? getVersion('sampling') : null

  // ── Load profile (the fixed pre-sampling snapshot) ────────────────────────
  useEffect(() => {
    if (!filePath) return
    setLoading(true)
    callSampling('profile', {
      file_path:     filePath,
      target_column: projectData?.targetColumn || null,
    })
    .then(d => {
      setProfile(d)
      if (d.detected_target) setTargetCol(d.detected_target)
      if (d.detected_target) setStratifyCol(d.detected_target)
    })
    .catch(e => setError(e.message))
    .finally(() => setLoading(false))
  }, [filePath])

  // ── Time-series detected: force shuffle off (shuffling would corrupt the
  // sequence) and seed a default anchor column for the date-range/systematic
  // time-safe methods, so their controls aren't empty the first time they're
  // shown. ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile?.has_time_warning) return
    setShuffle(false)
    if (!dateColumn && profile.datetime_cols?.length) setDateColumn(profile.datetime_cols[0])
  }, [profile?.has_time_warning])

  // ── Resume: if this step ALREADY has a registered version when the page
  // mounts (navigated away after Apply, came back), show the completed
  // before/after view immediately instead of resetting to pending controls
  // — fetch the applied file's own profile via getDisplayPath (which
  // correctly resolves to 'sampling'’s own output here). Mirrors
  // Encoding.jsx's resume effect. ─────────────────────────────────────────
  useEffect(() => {
    if (!done || phase !== 'config' || !profile) return
    const existingOutputPath = getDisplayPath ? getDisplayPath('sampling') : null
    if (!existingOutputPath || existingOutputPath === filePath) return
    callSampling('profile', { file_path: existingOutputPath, target_column: profile.detected_target || null })
      .then(resumedProfile => {
        const beforeDist = profile.target_info?.class_dist || []
        const afterDist  = resumedProfile.target_info?.class_dist || []
        const rowDiff = resumedProfile.row_count - profile.row_count
        setResults({
          method: 'resumed',
          method_label: 'Previously applied sampling',
          before: { row_count: profile.row_count, class_dist: beforeDist },
          after:  { row_count: resumedProfile.row_count, class_dist: afterDist },
          rows_changed:  rowDiff,
          reduction_pct: profile.row_count ? Math.round(Math.abs(rowDiff) / profile.row_count * 1000) / 10 : 0,
          display_rows:  resumedProfile.display_rows,
          shuffle_applied: true,
        })
        setVP(existingOutputPath)
        setPhase('applied')
        setPreviewTab('sampled')
      })
      .catch(() => { /* if this fails, the page just stays in the pending config state */ })
  }, [done, phase, profile, getDisplayPath, filePath])

  // Shared request body builder for /run and /apply — includes the
  // cluster/reservoir/date-range/step-size fields the new methods need;
  // harmless no-ops for whichever method isn't currently selected.
  const buildSamplingBody = () => ({
    file_path:      filePath,
    method,
    sample_pct:     samplePct,
    stratify_col:   stratifyCol || null,
    target_col:     targetCol || null,
    shuffle,
    n_clusters:     clusterN,
    reservoir_size: reservoirN,
    date_column:    dateColumn || null,
    start_date:     startDate || null,
    end_date:       endDate || null,
    step_size:      stepSize,
  })

  // ── Run sampling (preview, no save) ────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (!filePath) return
    setPhase('running')
    try {
      const res = await callSampling('run', buildSamplingBody())
      setResults(res)
      setPhase('preview')
      setPreviewTab('sampled')
    } catch (e) {
      setError(e.message)
      setPhase('config')
    }
  }, [filePath, method, samplePct, stratifyCol, targetCol, shuffle, clusterN, reservoirN, dateColumn, startDate, endDate, stepSize])

  // ── Apply (save version) ────────────────────────────────────────────────
  const handleApply = useCallback(async () => {
    if (!filePath) return
    setApplying(true)
    try {
      const res = await callSampling('apply', buildSamplingBody())
      setVP(res.new_file_path)
      if (registerVersion)
        await registerVersion('sampling', res.new_file_path, 'Sampled Version', res.row_count)
      if (onUpdateData) onUpdateData({ cleanedFilePath: res.new_file_path })
      setPhase('applied')
    } catch (e) { setError(e.message) }
    finally { setApplying(false) }
  }, [filePath, method, samplePct, stratifyCol, targetCol, shuffle, clusterN, reservoirN, dateColumn, startDate, endDate, stepSize, registerVersion, onUpdateData])

  const resetToConfig = () => { setPhase('config'); setResults(null); setPreviewTab('raw') }

  // ── Redo — genuinely returns to the pre-sampling state: clears local
  // state, then actually removes the 'sampling' DatasetVersion (via
  // resetStep, real Django cascade-delete). filePath itself never needs to
  // change (it already comes from getInputPath, which never looked at
  // 'sampling' in the first place) — only the resumed/applied view resets.
  const handleRedo = async () => {
    setRedoing(true)
    try {
      if (resetStep) await resetStep('sampling')
      setResults(null); setVP(null); setPhase('config'); setPreviewTab('raw')
      setRedoModal(false)
    } finally { setRedoing(false) }
  }

  // ── Method metadata — display labels renamed per explicit request; the
  // backend `method` key strings (map keys below) are unchanged so nothing
  // about the API contract shifts. Four advanced strategies (previously
  // listed only in the now-removed "coming soon" section) are promoted to
  // real, functional cards here. ──────────────────────────────────────────
  const METHOD_INFO = {
    simple_random: {
      label: 'Simple Random Undersampling', icon: '🎲',
      desc: 'Every row has equal probability of selection. Fast, unbiased baseline.',
      guidance: 'Best when classes are balanced and you want a quick size reduction.',
      showSlider: true, showStratify: false, showTargetCol: false,
    },
    stratified: {
      label: 'Stratified Undersampling', icon: '⚖',
      desc: 'Samples the same percentage from each class — preserves distribution.',
      guidance: 'Best when classes are imbalanced and you want to keep their exact ratio.',
      showSlider: true, showStratify: true, showTargetCol: false,
    },
    undersample: {
      label: 'Majority Undersampling', icon: '⬇',
      desc: 'Reduces the majority class to match the minority class size.',
      guidance: 'Best when majority class is very large. May lose useful information.',
      showSlider: false, showStratify: false, showTargetCol: true,
    },
    oversample: {
      label: 'Minority Oversampling (SMOTE)', icon: '⬆',
      desc: 'Generates synthetic minority-class rows (via nearest-neighbor interpolation) to match the majority.',
      guidance: 'Best when minority class is very small. Watch for overfitting.',
      showSlider: false, showStratify: false, showTargetCol: true,
    },
    systematic: {
      label: 'Systematic Sampling', icon: '⏭',
      desc: 'Selects every k-th row from the dataset. Fast and deterministic. Order-preserving.',
      guidance: 'Best for large ordered datasets where you want uniform coverage without randomness.',
      showSlider: true, showStratify: false, showTargetCol: false,
    },
    cluster: {
      label: 'Cluster Sampling', icon: '⛓',
      desc: 'Divides data into groups (clusters) and randomly selects whole clusters.',
      guidance: 'Best when data has natural groupings and you want to preserve cluster-level patterns.',
      showSlider: false, showStratify: false, showTargetCol: false, showClusterN: true,
    },
    reservoir: {
      label: 'Reservoir Sampling', icon: '🪣',
      desc: 'Samples a fixed number of items from a stream in one pass — no dataset size needed.',
      guidance: 'Best for streaming data or when total dataset size is unknown at start.',
      showSlider: false, showStratify: false, showTargetCol: false, showReservoirN: true,
    },
    importance: {
      label: 'Importance Sampling', icon: '🎯',
      desc: 'Evaluates a target distribution using samples from a different accessible distribution.',
      guidance: 'Used in reinforcement learning and probabilistic modeling. Advanced use case.',
      showSlider: false, showStratify: false, showTargetCol: false,
    },
  }

  // Time-safe methods — only ever offered (as clickable, non-grayed cards)
  // once profile.has_time_warning is true; every method above becomes
  // click-disabled in that state. See the method-card grid render below.
  const TIME_SAFE_METHODS = {
    DATE_RANGE: {
      label: 'Date-Range Filtering', icon: '📅',
      desc: 'Keep only rows within a date range. Shrinks the dataset while keeping the remaining timeline perfectly intact.',
      guidance: 'Best for removing stale historical data while preserving recent trends.',
      showDateRange: true,
    },
    SYSTEMATIC_TIME: {
      label: 'Systematic Sampling', icon: '⏭',
      desc: 'Sort by time and keep every k-th row. Reduces data size while preserving the full timeline span.',
      guidance: 'Best for high-frequency data (e.g. minute-level) that you want to thin to hourly.',
      showStepSize: true,
    },
  }

  const currentMethod = METHOD_INFO[method] || TIME_SAFE_METHODS[method] || METHOD_INFO.simple_random
  const timeSeriesMode = !!profile?.has_time_warning

  const targetInfo = profile?.target_info
  const LEVEL_CONFIG = getBalanceLevelConfig(C)
  const levelInfo = LEVEL_CONFIG[targetInfo?.balance_level || 'no_target']
  const imbalanceColor = levelInfo.color
  // Regression targets go through a completely different check on the
  // backend (skewness/kurtosis, not class entropy) — see
  // backend-fastapi/utils/balance_checker.py. is_classification is only
  // present once a target is actually set; undefined defaults to true so
  // existing classification datasets render exactly as before.
  const isRegressionTarget = targetInfo?.is_classification === false && targetInfo?.balance_level !== 'invalid'
  const isInvalidTarget = targetInfo?.balance_level === 'invalid'

  if (loading) return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <TopNav active={active || 'sampling'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
      <div style={{ textAlign: 'center', padding: '80px 0', color: C.muted }}>
        <div style={{ fontSize: 28, marginBottom: 12,
          animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚙</div>
        <p>Analysing dataset…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  )

  if (error) return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <TopNav active={active || 'sampling'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
      <div style={{ background: C.dangerSoft, border: `1px solid ${C.danger}`,
        borderRadius: 12, padding: 20, color: C.danger, margin: 20 }}>⚠ {error}</div>
    </div>
  )

  if (!profile) return null

  const allCols = profile.all_columns || []

  return (
    <div style={{ background: C.bg, minHeight: '100vh', paddingBottom: 60 }}>
      <TopNav active={active || 'sampling'} onNavigate={onNavigate} furthestOrder={furthestOrder} />

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: '20px 32px', display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: C.text, marginBottom: 4 }}>
            Dataset Sampling
          </h1>
          <p style={{ fontSize: 13, color: C.muted }}>
            Reduce dataset size, fix class imbalance, or create a representative subset — then preview the result before committing.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <button onClick={() => setRedoModal(true)}
            style={{ padding: '9px 18px', borderRadius: 9, border: `1px solid ${C.danger}`,
              background: C.dangerSoft, color: C.danger, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            ↺ Redo Sampling
          </button>
        </div>
      </div>

      {/* ── Versions bar ────────────────────────────────────────────────── */}
      <SharedVersionsBar versions={versions} />

      <div style={{ padding: '20px 32px 0' }}>

        {/* ── Description ℹ ─────────────────────────────────────────────── */}
        <DescriptionWidget />

        {/* ── KPI Cards ───────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
          <KPICard label="Total Rows"
            value={phase === 'applied' && results
              ? results.after.row_count.toLocaleString()
              : profile.row_count.toLocaleString()}
            sub={phase === 'applied' && results
              ? `was ${results.before.row_count.toLocaleString()} before sampling`
              : `${profile.num_col_count} numeric + ${profile.cat_col_count} categorical columns`}
            accent={C.primary}>
            {phase === 'applied' && results && results.rows_changed !== 0 && (
              <div style={{
                marginTop: 6, fontSize: 11, fontWeight: 700,
                color: results.rows_changed < 0 ? C.danger : C.success,
              }}>
                {results.rows_changed < 0 ? '↓' : '↑'} {Math.abs(results.rows_changed).toLocaleString()} rows {results.rows_changed < 0 ? 'removed' : 'added'}
              </div>
            )}
          </KPICard>

          <KPICard label="Total Columns" value={profile.col_count}
            sub={profile.skew_note || 'No highly skewed columns detected'} accent={C.warning}>
            {profile.skewed_cols?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {profile.skewed_cols.slice(0, 3).map(s => (
                  <span key={s.column} style={{
                    display: 'inline-block', fontSize: 10, fontWeight: 600,
                    background: C.warningSoft, color: C.warning,
                    borderRadius: 6, padding: '2px 7px', margin: '2px 3px 0 0',
                  }}>
                    {s.column} ({s.direction === 'right' ? '↗' : '↙'} {s.skew})
                  </span>
                ))}
              </div>
            )}
          </KPICard>

          {/* Regression targets get a completely different check (target
              distribution skewness, not class balance — there are no
              "classes" to balance in continuous data) via the same shared
              backend/utils/balance_checker.py used for classification, so
              this card relabels itself accordingly rather than showing a
              nonsensical "Balanced/Imbalanced" verdict on a house-price
              column. */}
          <KPICard label={isRegressionTarget ? 'Target Distribution' : 'Target Balance'}
            value={targetInfo ? levelInfo.label : 'No target'}
            sub={
              !targetInfo ? 'Set target in the Upload step'
              : isInvalidTarget ? `Column: ${targetInfo.column}`
              : isRegressionTarget ? `Column: ${targetInfo.column} · skew ${targetInfo.skewness?.toFixed(2)}`
              : `Column: ${targetInfo.column} · minority ${targetInfo.min_class_pct}%`
            }
            accent={imbalanceColor}>
            {targetInfo && !isRegressionTarget && !isInvalidTarget && (
              <div style={{ marginTop: 10 }}>
                {targetInfo.class_dist.slice(0, 4).map((cls, i) => (
                  <div key={cls.class} style={{ display: 'flex', alignItems: 'center',
                    gap: 6, marginBottom: 4 }}>
                    <div style={{ flex: 1, height: 6, background: C.faint, borderRadius: 3 }}>
                      <div style={{ width: `${cls.pct}%`, height: '100%',
                        background: cls.pct === Math.max(...targetInfo.class_dist.map(d=>d.pct))
                          ? C.primary : C.success,
                        borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 10, color: C.muted, whiteSpace: 'nowrap' }}>
                      {cls.class}: {cls.pct}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </KPICard>
        </div>

        {/* ── Target-quality guidance banner — color/icon follow the shared
            level vocabulary (balanced/mild/moderate/severe/invalid) from
            check_target_balance(), covering classification, regression, and
            the ID-column / constant-target edge cases with the same banner. */}
        {targetInfo && (
          <div style={{
            background: `${levelInfo.color}1a`,
            border: `1px solid ${levelInfo.color}4d`,
            borderRadius: 10, padding: '12px 18px', marginBottom: 20,
            fontSize: 13, color: C.text, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 16 }}>
              {isInvalidTarget ? '✕' : targetInfo.balance_level === 'balanced' ? '✓' : '⚠'}
            </span>
            {targetInfo.suggestion}
          </div>
        )}

        {/* Sample-starvation warning — a separate, more urgent risk than the
            balance ratio itself (too few absolute rows to learn from, even
            if the ratio looks only moderately imbalanced), so it's appended
            as its own banner rather than folded into the message above. */}
        {targetInfo?.starvation_warning && (
          <div style={{
            background: C.dangerSoft, border: `1px solid ${C.danger}4d`,
            borderRadius: 10, padding: '12px 18px', marginBottom: 20,
            fontSize: 13, color: C.danger, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 16 }}>⚠</span>
            {targetInfo.starvation_warning}
          </div>
        )}

        {/* ── Time-series warning ─────────────────────────────────────────── */}
        {profile.has_time_warning && (
          <div style={{
            background: C.dangerSoft, border: `1px solid ${C.danger}4d`,
            borderRadius: 10, padding: '12px 18px', marginBottom: 20,
            fontSize: 13, color: C.danger,
          }}>
            ⚠ <strong>Temporal data detected</strong> — columns {profile.datetime_cols.join(', ')} suggest a time-ordered dataset.
            Random shuffling may destroy the temporal sequence your model needs.
            Consider a chronological split rather than random sampling.
          </div>
        )}

        {/* ── Main content: Left (controls) + Right (preview / results) ──── */}
        {/* minWidth: 0 on the grid itself, and on the right-hand column
            below, override the CSS Grid default of `min-width: auto` on
            grid items — without it, a wide child (the dataset table, which
            can be many columns wide) would refuse to shrink below its own
            intrinsic content width, and instead of scrolling INSIDE its own
            overflow-x wrapper, it forced this whole grid track — and with
            it the page itself — wider than the viewport. That's exactly
            what made the "Current Dataset" section spill past the page's
            established width and drag the rest of the page along with it. */}
        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20, minWidth: 0 }}>

          {/* ── LEFT: Control Panel ─────────────────────────────────────── */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 14, padding: 24, boxShadow: shadow2,
            alignSelf: 'start', position: 'sticky', top: 20 }}>

            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
              textTransform: 'uppercase', color: C.primary, marginBottom: 16 }}>
              ⚙ Configure Sampling
            </div>

            {/* Method selector — scrollable (8 base strategies, +2 time-safe
                ones when a timestamp is detected); during time-series mode
                every base card is grayed out and click-disabled, and the
                two time-safe cards render first with a distinct accent
                border. */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 10 }}>
                Sampling Method
              </div>
              <div style={{ maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {timeSeriesMode && Object.entries(TIME_SAFE_METHODS).map(([key, info]) => {
                    const active = method === key
                    return (
                      <button key={key}
                        onClick={() => { setMethod(key); setResults(null); setPhase('config') }}
                        style={{
                          padding: '10px 8px', borderRadius: 10, cursor: 'pointer',
                          border: `1.5px solid ${active ? C.success : C.success + '80'}`,
                          background: active ? C.successSoft : C.card,
                          textAlign: 'left', transition: 'all 0.15s',
                        }}>
                        <div style={{ fontSize: 14, marginBottom: 2 }}>{info.icon}</div>
                        <div style={{ fontSize: 12, fontWeight: 700,
                          color: active ? C.success : C.text }}>{info.label}</div>
                        <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.4 }}>
                          {info.desc}
                        </div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: C.success, marginTop: 4 }}>
                          ✓ Time-safe
                        </div>
                      </button>
                    )
                  })}
                  {Object.entries(METHOD_INFO).map(([key, info]) => {
                    const active = method === key
                    return (
                      <button key={key}
                        disabled={timeSeriesMode}
                        onClick={() => { setMethod(key); setResults(null); setPhase('config') }}
                        style={{
                          padding: '10px 8px', borderRadius: 10,
                          cursor: timeSeriesMode ? 'not-allowed' : 'pointer',
                          border: `1.5px solid ${active && !timeSeriesMode ? C.primary : C.border}`,
                          background: active && !timeSeriesMode ? C.primarySoft : C.card,
                          textAlign: 'left', transition: 'all 0.15s',
                          opacity: timeSeriesMode ? 0.35 : 1,
                          pointerEvents: timeSeriesMode ? 'none' : 'auto',
                        }}>
                        <div style={{ fontSize: 14, marginBottom: 2 }}>{info.icon}</div>
                        <div style={{ fontSize: 12, fontWeight: 700,
                          color: active && !timeSeriesMode ? C.primary : C.text }}>{info.label}</div>
                        <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.4 }}>
                          {info.desc}
                        </div>
                        {timeSeriesMode && (
                          <div style={{ fontSize: 9, fontWeight: 700, color: C.danger, marginTop: 4 }}>
                            ⚠ Not safe for time-series
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div style={{ marginTop: 10, padding: '8px 12px',
                background: C.primarySoft, borderRadius: 8,
                fontSize: 12, color: C.primary }}>
                💡 {currentMethod.guidance}
              </div>
            </div>

            {/* Cluster / Reservoir size controls */}
            {currentMethod.showClusterN && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                  Number of clusters
                </div>
                <input type="number" min={2} max={100} value={clusterN}
                  onChange={e => setClusterN(+e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8,
                    border: `1px solid ${C.border}`, fontSize: 13, background: C.card, color: C.text }} />
              </div>
            )}
            {currentMethod.showReservoirN && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                  Reservoir size (rows)
                </div>
                <input type="number" min={10} value={reservoirN}
                  onChange={e => setReservoirN(+e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8,
                    border: `1px solid ${C.border}`, fontSize: 13, background: C.card, color: C.text }} />
              </div>
            )}

            {/* Date-Range controls (time-safe) */}
            {currentMethod.showDateRange && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                  Anchor column (date/timestamp)
                </div>
                <select value={dateColumn} onChange={e => setDateColumn(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, marginBottom: 10,
                    border: `1px solid ${C.border}`, fontSize: 13, background: C.card,
                    color: C.text, outline: 'none', cursor: 'pointer' }}>
                  {(profile.datetime_cols || []).map(col => <option key={col} value={col}>{col}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Start date</div>
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 8,
                        border: `1px solid ${C.border}`, fontSize: 12, background: C.card, color: C.text }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>End date</div>
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 8,
                        border: `1px solid ${C.border}`, fontSize: 12, background: C.card, color: C.text }} />
                  </div>
                </div>
              </div>
            )}

            {/* Step-size control (time-safe systematic sampling) */}
            {currentMethod.showStepSize && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                  Keep every N-th row
                </div>
                <input type="number" min={2} max={100} value={stepSize}
                  onChange={e => setStepSize(+e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8,
                    border: `1px solid ${C.border}`, fontSize: 13, background: C.card, color: C.text }} />
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                  ≈ {Math.ceil(profile.row_count / (stepSize || 1)).toLocaleString()} rows remaining
                </div>
              </div>
            )}

            {/* Stratify column */}
            {currentMethod.showStratify && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                  Stratify by column
                </div>
                <select value={stratifyCol}
                  onChange={e => setStratifyCol(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8,
                    border: `1px solid ${C.border}`, fontSize: 13, background: C.card,
                    color: C.text, outline: 'none', cursor: 'pointer' }}>
                  <option value="">— select column —</option>
                  {allCols.map(col => <option key={col} value={col}>{col}</option>)}
                </select>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
                  Tip: Stratify by your target column to preserve class ratios. This only protects
                  against ordering patterns in the column you pick — see the ℹ description above for
                  the time-series exception.
                </div>
              </div>
            )}

            {/* Target column (for over/undersample) */}
            {currentMethod.showTargetCol && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                  Target column (classes to balance)
                </div>
                <select value={targetCol}
                  onChange={e => setTargetCol(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8,
                    border: `1px solid ${C.border}`, fontSize: 13, background: C.card,
                    color: C.text, outline: 'none', cursor: 'pointer' }}>
                  <option value="">— select target —</option>
                  {(profile.categorical_columns || []).map(col =>
                    <option key={col} value={col}>{col}</option>)}
                  {(profile.numeric_columns || []).map(col =>
                    <option key={col} value={col}>{col}</option>)}
                </select>
              </div>
            )}

            {/* Sample size slider */}
            {currentMethod.showSlider && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                  <span>Sample size</span>
                  <span style={{ color: C.primary, fontWeight: 800 }}>
                    {samplePct}% ≈ {Math.round(profile.row_count * samplePct / 100).toLocaleString()} rows
                  </span>
                </div>
                <input type="range" min={1} max={100} value={samplePct}
                  onChange={e => setSamplePct(+e.target.value)}
                  style={{ width: '100%', accentColor: C.primary }} />
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  fontSize: 10, color: C.muted, marginTop: 2 }}>
                  <span>1%</span><span>50%</span><span>100%</span>
                </div>
              </div>
            )}

            {/* Shuffle toggle — disabled and grayed out once a timestamp is
                detected: shuffling a time-ordered dataset destroys the
                sequence, so this control is force-off and non-interactive
                for the whole time-series mode (see the effect above that
                calls setShuffle(false) the moment has_time_warning flips
                true). */}
            <div style={{ marginBottom: 22, padding: '12px 14px',
              background: shuffle ? C.successSoft : C.faint,
              border: `1px solid ${shuffle ? C.success + '4d' : C.border}`,
              borderRadius: 10, cursor: timeSeriesMode ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              opacity: timeSeriesMode ? 0.4 : 1,
              pointerEvents: timeSeriesMode ? 'none' : 'auto',
            }} onClick={() => !timeSeriesMode && setShuffle(s => !s)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 40, height: 22, borderRadius: 11, flexShrink: 0, position: 'relative',
                  background: shuffle ? C.success : C.muted, transition: 'background 0.2s',
                }}>
                  <div style={{
                    position: 'absolute', top: 3, left: shuffle ? 20 : 3,
                    width: 16, height: 16, borderRadius: '50%',
                    background: 'white', transition: 'left 0.2s',
                  }} />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                    Shuffle data before sampling
                    {shuffle && <span style={{ color: C.success, fontWeight: 700,
                      fontSize: 10, marginLeft: 6 }}>✓ Recommended</span>}
                    {timeSeriesMode && <span style={{ color: C.danger, fontWeight: 700,
                      fontSize: 10, marginLeft: 6 }}>Disabled — time-series detected</span>}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                    Prevents bias from hidden row ordering in your raw file.
                  </div>
                </div>
              </div>
            </div>

            {/* RUN button */}
            {phase !== 'applied' && (
              <button onClick={handleRun}
                disabled={phase === 'running'}
                style={{
                  width: '100%', padding: '14px', borderRadius: 11, border: 'none',
                  background: phase === 'running' ? C.muted : C.primary,
                  color: 'white', fontWeight: 800, fontSize: 15, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: phase === 'running' ? 'none' : `0 6px 20px ${C.primary}44`,
                  transition: 'all 0.2s',
                }}>
                {phase === 'running' ? '⏳ Running…' : '▶  Run Sampling Pipeline'}
              </button>
            )}

            {/* Decision buttons (after preview) */}
            {phase === 'preview' && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={handleApply} disabled={applying}
                  style={{
                    width: '100%', padding: '12px', borderRadius: 10, border: 'none',
                    background: C.success, color: 'white', fontWeight: 800, fontSize: 14,
                    cursor: 'pointer', boxShadow: `0 6px 20px ${C.success}44`,
                  }}>
                  {applying ? '⏳ Saving…' : '✓ Apply & Save Version'}
                </button>
                <button onClick={resetToConfig}
                  style={{
                    width: '100%', padding: '10px', borderRadius: 10, fontWeight: 600,
                    fontSize: 13, cursor: 'pointer', background: C.faint,
                    border: `1px solid ${C.border}`, color: C.muted,
                  }}>
                  ↩ Try Different Settings
                </button>
              </div>
            )}

            {/* Applied state */}
            {phase === 'applied' && (
              <div style={{ marginTop: 14, padding: '14px', background: C.successSoft,
                border: `1px solid ${C.success}4d`, borderRadius: 10,
                textAlign: 'center' }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>✓</div>
                <div style={{ fontWeight: 800, color: C.success, fontSize: 14 }}>Version Saved</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                  {results?.after?.row_count?.toLocaleString()} rows in Sampled Version
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT: Preview + Results ────────────────────────────────── */}
          <div style={{ minWidth: 0 }}>
            {timeSeriesMode && (
              <div style={{
                background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.3)',
                borderRadius: 10, padding: '12px 16px', marginBottom: 16,
                fontSize: 13, color: C.text,
              }}>
                💡 <strong>Time-Series Detected:</strong> we found a timestamp column. If you plan to predict
                future trends based on past events, using Random or Stratified sampling will corrupt your
                timeline. We recommend <strong>Date-Range Filtering</strong> or <strong>Systematic
                Sampling</strong> to safely shrink your data.
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              {[
                { id: 'raw', label: '▤ Current Dataset' },
                { id: 'sampled', label: '⚡ Sampled Results' },
              ].map(tab => {
                const active = previewTab === tab.id
                const disabled = tab.id === 'sampled' && phase === 'config'
                return (
                  <button key={tab.id}
                    onClick={() => !disabled && setPreviewTab(tab.id)}
                    style={{
                      padding: '9px 18px', borderRadius: '8px 8px 0 0',
                      border: `1px solid ${C.border}`, borderBottom: active ? 'none' : undefined,
                      background: active ? C.card : C.faint,
                      color: disabled ? C.muted : active ? C.text : C.muted,
                      fontWeight: active ? 700 : 500, fontSize: 13,
                      cursor: disabled ? 'default' : 'pointer',
                      opacity: disabled ? 0.5 : 1,
                    }}>
                    {tab.label}
                    {tab.id === 'sampled' && phase === 'config' && (
                      <span style={{ fontSize: 10, marginLeft: 5, color: C.muted }}>
                        (run first)
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div style={{ background: C.card, border: `1px solid ${C.border}`,
              borderRadius: '0 14px 14px 14px', padding: 20, boxShadow: shadow2 }}>

              {previewTab === 'raw' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                      Current dataset · all {profile.row_count.toLocaleString()} rows shown
                    </div>
                    <div style={{ fontSize: 12, color: C.muted }}>
                      {allCols.length} columns
                    </div>
                  </div>

                  {timeSeriesMode ? (
                    <div style={{ marginBottom: 16, padding: '14px 16px',
                      background: C.faint, borderRadius: 10 }}>
                      <TimelineViz C={C} datetimeCol={profile.datetime_cols?.[0]}
                        before={profile.row_count} after={null} />
                    </div>
                  ) : targetInfo && (
                    <div style={{ marginBottom: 16, padding: '14px 16px',
                      background: C.faint, borderRadius: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: C.muted,
                        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                        Target column: {targetInfo.column}
                      </div>
                      {/* Same fixed-height/scroll treatment as the Sampled
                          Results tab's before/after class comparison — a
                          regression target or high-cardinality categorical
                          can produce hundreds of "classes" here too, and
                          without a cap this pushed the whole page down
                          before the dataset table even came into view. */}
                      {targetInfo.is_classification === false ? (
                        <div style={{ fontSize: 12, color: C.muted }}>
                          Continuous target — skewness {targetInfo.skewness?.toFixed(2)}
                          {targetInfo.kurtosis != null && ` · kurtosis ${targetInfo.kurtosis.toFixed(2)}`}
                          . Class balance doesn't apply to regression targets — see the
                          banner above for distribution guidance.
                        </div>
                      ) : (
                        <div style={(targetInfo.class_dist?.length || 0) > CLASS_SCROLL_THRESHOLD
                          ? { maxHeight: CLASS_SCROLL_MAX_HEIGHT, overflowY: 'auto', paddingRight: 4 }
                          : {}}>
                          <ClassBar dist={targetInfo.class_dist} />
                        </div>
                      )}
                    </div>
                  )}

                  <DataTable rows={profile.display_rows} columns={allCols} />
                </div>
              )}

              {previewTab === 'sampled' && results && (
                <div>
                  <div style={{ padding: '12px 16px', marginBottom: 16,
                    background: C.primarySoft, borderRadius: 10,
                    border: `1px solid ${C.primary}33` }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: C.primary, marginBottom: 4 }}>
                      {results.method_label}
                    </div>
                    <div style={{ fontSize: 13, color: C.text }}>
                      {results.rows_changed < 0
                        ? `Reduced by ${Math.abs(results.rows_changed).toLocaleString()} rows (${results.reduction_pct}% reduction)`
                        : results.rows_changed > 0
                        ? `Added ${results.rows_changed.toLocaleString()} rows (${results.reduction_pct}% increase)`
                        : `No change in row count`}
                      &nbsp;·&nbsp;
                      {results.before.row_count.toLocaleString()} → <strong>{results.after.row_count.toLocaleString()}</strong> rows
                      {results.shuffle_applied && <span style={{ color: C.success, marginLeft: 8 }}>✓ Shuffled</span>}
                    </div>
                  </div>

                  {timeSeriesMode ? (
                    <div style={{ marginBottom: 16, padding: '14px 16px',
                      background: C.faint, borderRadius: 10 }}>
                      <TimelineViz C={C} datetimeCol={dateColumn || profile.datetime_cols?.[0]}
                        before={results.before.row_count} after={results.after.row_count}
                        method={method} startDate={startDate} endDate={endDate} stepSize={stepSize} />
                    </div>
                  ) : (results.before.class_dist?.length > 0) && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.muted,
                        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                        Class Distribution Comparison
                      </div>
                      <BeforeAfterPanel before={results.before} after={results.after} />
                    </div>
                  )}

                  <div style={{ fontSize: 12, fontWeight: 700, color: C.muted,
                    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                    Sampled data preview · all {results.after.row_count.toLocaleString()} rows shown
                  </div>
                  <DataTable rows={results.display_rows} columns={allCols} />
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

      {redoModal && (
        <RedoModal onCancel={() => setRedoModal(false)} onConfirm={handleRedo} working={redoing} />
      )}
    </div>
  )
}
