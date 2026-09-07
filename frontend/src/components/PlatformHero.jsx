import { useEffect, useRef } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// PlatformHero — the scroll-scrubbed "noise becomes a real analysis" hero,
// ported from the user-provided prism_platform_hero_light.html mockup. A
// 480vh spacer pins a full-viewport scene while the page scrolls through it:
// scattered noise tokens resolve into an animated replica of the real app
// (Diagnose's stats bar, version history, data preview, feature list,
// histograms, class balance) as progress advances, then hands off to
// whatever section follows (Landing.jsx renders the "work" + login sections
// right after this one).
//
// All per-frame writes are direct DOM/style mutations via refs inside one
// rAF loop (mirroring useScrollProgress.js's IntersectionObserver-gated
// technique, but skipping React state entirely) rather than React state per
// frame — the original mockup already updates ~80 elements every frame;
// routing that through React re-renders would be the slower, jankier path
// for a component whose only job is smooth scroll-tied animation.
// ─────────────────────────────────────────────────────────────────────────────
const NOISE_TOKENS = ['NaN', '0.847', '#REF!', 'null', '12,450', 'row_442', '83.2', 'N/A', 'err', '82%', 'avg=44.1', '?', 'undefined', '...', 'FALSE', '2024-03-11', '$8,204', 'col_7']

const PREVIEW_ROWS = [
  ['1', '19', 'Business', '—', '2.61', '1'],
  ['2', '20', 'Business', '4.9', '2.22', '1'],
  ['3', '24', 'Arts', '—', '3.08', '1'],
  ['4', '24', 'Business', '2.6', '2.65', '1'],
]

const FEATURES = [
  ['student_id', null], ['age', null], ['major', null],
  ['study_hours', '6.25% missing'], ['sleep_hours', '3.75% missing'],
]

const HIST_COLS = [
  { name: 'student_id', pattern: [40, 70, 90, 85, 60, 45] },
  { name: 'age', pattern: [20, 55, 95, 70, 35, 15] },
  { name: 'study_hours', pattern: [30, 60, 80, 100, 65, 40] },
  { name: 'sleep_hours', pattern: [50, 85, 95, 70, 45, 25] },
  { name: 'attendance_pct', pattern: [25, 50, 75, 90, 80, 55] },
]

const ease = (x) => x * x * (3 - 2 * x)
const stageP = (raw, a, b) => Math.min(1, Math.max(0, (raw - a) / (b - a)))

function useRandomOnce(fn) {
  const ref = useRef(null)
  if (ref.current == null) ref.current = fn()
  return ref.current
}

export default function PlatformHero({ workHref = '#work' }) {
  const pinRef = useRef(null)
  const rafRef = useRef(null)

  const noiseFieldRef = useRef(null)
  const headlineARef = useRef(null)
  const scrollHintRef = useRef(null)
  const mockupRef = useRef(null)
  const statsbarRef = useRef(null)
  const versionsRef = useRef(null)
  const theadRef = useRef(null)
  const labelPreviewRef = useRef(null)
  const labelFeaturesRef = useRef(null)
  const labelStatsRef = useRef(null)
  const visHeadRef = useRef(null)
  const labelClassRef = useRef(null)
  const headlineBRef = useRef(null)

  const vHealthRef = useRef(null), barHealthRef = useRef(null)
  const vMissingRef = useRef(null), vOutliersRef = useRef(null), vDupRef = useRef(null), barImbRef = useRef(null)
  const sRowsRef = useRef(null), sColsRef = useRef(null), sNumRef = useRef(null), sCatRef = useRef(null)

  const classFill1Ref = useRef(null), classFill2Ref = useRef(null)
  const classVal1Ref = useRef(null), classVal2Ref = useRef(null)

  const scatterRefs = useRef([])
  const histBarRefs = useRef([])

  // One-time randomization (noise token placement, scatter fly-in offsets) —
  // computed once via lazy ref init so it stays stable across re-renders
  // instead of reshuffling every time this component's parent re-renders.
  const noiseSeeds = useRandomOnce(() => Array.from({ length: 24 }, (_, i) => ({
    token: NOISE_TOKENS[i % NOISE_TOKENS.length],
    left: Math.random() * 92, top: Math.random() * 88,
    delay: Math.random() * 6, fontSize: 10 + Math.random() * 5,
  })))
  // Table cells (each always one scatter span) + feature rows (one scatter
  // span for the name, plus a second one ONLY for rows with a missing-%
  // warning) — must match the exact number of nextScatterRef() calls made
  // in the JSX below, or a later index reads an undefined seed and crashes.
  const flatScatterCount = PREVIEW_ROWS.length * PREVIEW_ROWS[0].length
    + FEATURES.reduce((sum, f) => sum + (f[1] ? 2 : 1), 0)
  const scatterSeeds = useRandomOnce(() => Array.from({ length: flatScatterCount }, () => ({
    dx: (Math.random() - 0.5) * (window.innerWidth < 700 ? 140 : 260),
    dy: (Math.random() < 0.5 ? -1 : 1) * (50 + Math.random() * 130),
    rot: (Math.random() - 0.5) * 22,
    delay: Math.random(),
  })))

  useEffect(() => {
    const el = pinRef.current
    if (!el) return

    const applyFrame = (raw) => {
      if (headlineARef.current) headlineARef.current.style.opacity = 1 - stageP(raw, 0.0, 0.08)
      if (scrollHintRef.current) scrollHintRef.current.style.opacity = raw < 0.04 ? 0.8 : 0
      const noiseFade = 0.9 * (1 - ease(stageP(raw, 0.14, 0.36)))
      if (noiseFieldRef.current) {
        noiseFieldRef.current.querySelectorAll('span').forEach((s) => { s.style.opacity = noiseFade })
      }

      const shellP = ease(stageP(raw, 0.05, 0.16))
      if (mockupRef.current) {
        mockupRef.current.style.opacity = shellP
        mockupRef.current.style.transform = `translateY(${12 * (1 - shellP)}px) scale(${0.985 + 0.015 * shellP})`
      }

      if (statsbarRef.current) statsbarRef.current.style.opacity = ease(stageP(raw, 0.12, 0.22))
      if (versionsRef.current) versionsRef.current.style.opacity = ease(stageP(raw, 0.16, 0.26))
      const labelP = ease(stageP(raw, 0.18, 0.28))
      ;[labelPreviewRef, labelFeaturesRef, labelStatsRef].forEach((r) => { if (r.current) r.current.style.opacity = labelP })
      if (theadRef.current) theadRef.current.querySelectorAll('th').forEach((th) => { th.style.opacity = labelP })
      if (visHeadRef.current) visHeadRef.current.style.opacity = ease(stageP(raw, 0.5, 0.6))
      if (labelClassRef.current) labelClassRef.current.style.opacity = ease(stageP(raw, 0.62, 0.72))

      const landP = stageP(raw, 0.24, 0.58)
      scatterRefs.current.forEach((el2, i) => {
        if (!el2) return
        const seed = scatterSeeds[i]
        const p = ease(Math.min(1, Math.max(0, (landP - seed.delay * 0.35) / (1 - seed.delay * 0.35))))
        const dx = seed.dx * (1 - p), dy = seed.dy * (1 - p), rot = seed.rot * (1 - p)
        el2.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`
        el2.style.opacity = 0.1 + 0.9 * p
      })

      const statP = ease(stageP(raw, 0.28, 0.5))
      if (vHealthRef.current) vHealthRef.current.textContent = Math.round(80 * statP) + '/100'
      if (barHealthRef.current) barHealthRef.current.style.width = (80 * statP) + '%'
      if (vMissingRef.current) vMissingRef.current.textContent = (2.5 * statP).toFixed(1) + '%'
      if (vOutliersRef.current) vOutliersRef.current.textContent = Math.round(24 * statP) + ' Detected'
      if (vDupRef.current) vDupRef.current.textContent = Math.round(3 * statP) + ' Rows'
      if (barImbRef.current) barImbRef.current.style.width = (72 * statP) + '%'
      if (sRowsRef.current) sRowsRef.current.textContent = Math.round(80 * statP)
      if (sColsRef.current) sColsRef.current.textContent = Math.round(11 * statP)
      if (sNumRef.current) sNumRef.current.textContent = Math.round(9 * statP)
      if (sCatRef.current) sCatRef.current.textContent = Math.round(2 * statP)

      const histP = ease(stageP(raw, 0.44, 0.62))
      histBarRefs.current.forEach((b) => { if (b.el) b.el.style.height = (b.target * histP) + '%' })

      const classP = ease(stageP(raw, 0.64, 0.8))
      if (classFill1Ref.current) classFill1Ref.current.style.height = (100 * classP) + '%'
      if (classFill2Ref.current) classFill2Ref.current.style.height = (38 * classP) + '%'
      if (classVal1Ref.current) {
        classVal1Ref.current.style.opacity = classP
        classVal1Ref.current.textContent = Math.round(58 * classP) + ' (' + (72.5 * classP).toFixed(1) + '%)'
      }
      if (classVal2Ref.current) {
        classVal2Ref.current.style.opacity = classP
        classVal2Ref.current.textContent = Math.round(22 * classP) + ' (' + (27.5 * classP).toFixed(1) + '%)'
      }

      const endP = ease(stageP(raw, 0.84, 0.96))
      if (headlineBRef.current) {
        headlineBRef.current.style.opacity = endP
        headlineBRef.current.style.transform = `translateX(-50%) translateY(${10 * (1 - endP)}px)`
      }
    }

    const tick = () => {
      const rect = el.getBoundingClientRect()
      const scrollable = rect.height - window.innerHeight
      const raw = scrollable > 0 ? Math.min(1, Math.max(0, -rect.top / scrollable)) : 0
      applyFrame(raw)
      rafRef.current = requestAnimationFrame(tick)
    }

    applyFrame(0)
    const observer = new IntersectionObserver((entries) => {
      const isVisible = entries.some((e) => e.isIntersecting)
      if (isVisible && rafRef.current == null) rafRef.current = requestAnimationFrame(tick)
      else if (!isVisible && rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    }, { threshold: 0 })
    observer.observe(el)

    return () => {
      observer.disconnect()
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Index-based ref assignment (not .push) for both of these — safe to call
  // again on any re-render (e.g. React StrictMode's dev double-invoke)
  // without accumulating duplicate/stale entries the rAF loop would then
  // iterate twice over.
  let scatterIdx = 0
  const nextScatterRef = () => {
    const i = scatterIdx++
    return (elx) => { scatterRefs.current[i] = elx }
  }
  let histBarIdx = 0
  const nextHistBarRef = (target) => {
    const i = histBarIdx++
    return (elx) => { histBarRefs.current[i] = { el: elx, target } }
  }

  return (
    <div className="ph-root">
      <style>{`
        .ph-root {
          --ph-bg: #f8fafc; --ph-panel: #ffffff; --ph-panel-alt: #fafbfc; --ph-border: #e2e8f0;
          --ph-ink: #0f172a; --ph-muted: #64748b; --ph-teal: #14b8a6; --ph-teal-soft: #ccfbf1;
          --ph-amber: #f59e0b; --ph-red: #ef4444;
          font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; color: var(--ph-ink);
        }
        .ph-spacer { height: 480vh; position: relative; }
        .ph-pin { position: sticky; top: 0; height: 100vh; overflow: hidden; display: flex; align-items: center; justify-content: center; background: var(--ph-bg); }
        .ph-noise span { position: absolute; font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 11px; color: #b6bfcf; white-space: nowrap; animation: ph-drift 9s ease-in-out infinite; }
        @keyframes ph-drift { 0%, 100% { transform: translate(0,0); } 50% { transform: translate(6px,-8px); } }
        .ph-headline { position: absolute; z-index: 2; left: 50%; top: 11%; transform: translate(-50%,0); text-align: center; font-size: 25px; font-weight: 300; color: var(--ph-ink); width: 90%; max-width: 600px; pointer-events: none; }
        .ph-headline-end { position: absolute; z-index: 30; left: 50%; bottom: 4%; transform: translateX(-50%); text-align: center; width: 90%; max-width: 640px; pointer-events: none; }
        .ph-headline-end h2 { font-size: 20px; font-weight: 300; margin: 0 0 12px; color: var(--ph-ink); }
        .ph-headline-end .ph-cta { display: inline-flex; align-items: center; gap: 6px; pointer-events: auto; color: var(--ph-teal); text-decoration: none; font-size: 13px; font-weight: 600; }
        .ph-scroll-hint { position: absolute; bottom: 1.6%; left: 50%; transform: translateX(-50%); z-index: 2; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ph-muted); opacity: 0.8; }
        .ph-mockup { position: relative; z-index: 10; width: min(960px, 92vw); background: var(--ph-panel); border: 1px solid var(--ph-border); border-radius: 12px; overflow: hidden; box-shadow: 0 30px 70px rgba(15,23,42,0.12); opacity: 0; transform: translateY(12px) scale(0.985); font-size: 12px; }
        .ph-diamond { width: 12px; height: 12px; background: var(--ph-teal); border-radius: 3px; transform: rotate(45deg); display: inline-block; flex-shrink: 0; }
        .ph-topnav { display: flex; align-items: center; justify-content: space-between; padding: 9px 16px; border-bottom: 1px solid var(--ph-border); }
        .ph-brand { display: flex; align-items: center; gap: 8px; }
        .ph-tabs { display: flex; gap: 16px; }
        .ph-tabs span { font-size: 10.5px; color: var(--ph-muted); font-weight: 500; }
        .ph-tabs span.active { color: var(--ph-teal); font-weight: 700; }
        .ph-right { display: flex; align-items: center; gap: 10px; }
        .ph-pill-mini { font-size: 9.5px; color: var(--ph-muted); border: 1px solid var(--ph-border); border-radius: 999px; padding: 3px 8px; }
        .ph-avatar { width: 16px; height: 16px; border-radius: 50%; background: #cbd5e1; }
        .ph-statsbar { display: flex; align-items: center; gap: 26px; padding: 9px 16px; background: var(--ph-panel-alt); border-bottom: 1px solid var(--ph-border); opacity: 0; }
        .ph-stat .l { font-size: 8.5px; letter-spacing: 0.08em; color: var(--ph-muted); text-transform: uppercase; margin-bottom: 2px; }
        .ph-stat .v { font-size: 12px; font-weight: 700; }
        .ph-stat .v.red { color: var(--ph-red); }
        .ph-stat .v.amber { color: var(--ph-amber); }
        .ph-bar-mini { width: 60px; height: 4px; background: #e2e8f0; border-radius: 2px; overflow: hidden; margin-top: 3px; }
        .ph-bar-mini i { display: block; height: 100%; width: 0%; background: var(--ph-teal); }
        .ph-bar-mini.imb i { background: var(--ph-amber); }
        .ph-redo { margin-left: auto; font-size: 10px; color: var(--ph-red); border: 1px solid #fecaca; background: #fef2f2; padding: 4px 10px; border-radius: 6px; font-weight: 600; }
        .ph-versions { display: flex; gap: 6px; padding: 7px 16px; border-bottom: 1px solid var(--ph-border); opacity: 0; }
        .ph-versions span { font-size: 9px; color: var(--ph-muted); background: var(--ph-panel-alt); border: 1px solid var(--ph-border); padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
        .ph-versions span.active { background: var(--ph-teal); color: #fff; border-color: var(--ph-teal); font-weight: 600; }
        .ph-main { padding: 14px 16px; }
        .ph-grid3 { display: grid; grid-template-columns: 1.35fr 1fr 0.85fr; gap: 14px; }
        .ph-card-label { font-size: 9.5px; letter-spacing: 0.08em; color: var(--ph-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 8px; opacity: 0; }
        .ph-table { width: 100%; border-collapse: collapse; }
        .ph-table th { text-align: left; font-size: 8.5px; color: var(--ph-muted); font-weight: 600; padding: 0 6px 5px 0; opacity: 0; }
        .ph-table td { font-size: 10.5px; padding: 5px 6px 5px 0; border-top: 1px solid #f1f5f9; }
        .ph-scatter { display: inline-block; will-change: transform, opacity; opacity: 0.1; }
        .ph-feat-row { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; border-top: 1px solid #f1f5f9; }
        .ph-feat-row:first-of-type { border-top: none; }
        .ph-feat-name { display: flex; align-items: center; gap: 7px; font-size: 10.5px; }
        .ph-feat-box { width: 11px; height: 11px; border: 1.4px solid #cbd5e1; border-radius: 3px; }
        .ph-feat-warn { font-size: 9px; color: var(--ph-amber); }
        .ph-stat-row { display: flex; justify-content: space-between; padding: 5px 0; border-top: 1px solid #f1f5f9; font-size: 10.5px; }
        .ph-stat-row:first-of-type { border-top: none; }
        .ph-stat-row b { font-weight: 700; }
        .ph-vis-head { display: flex; align-items: center; justify-content: space-between; margin-top: 18px; margin-bottom: 10px; opacity: 0; }
        .ph-vis-head .ph-card-label { margin-bottom: 0; opacity: 1; }
        .ph-showall { font-size: 9.5px; color: var(--ph-teal); border: 1px solid #99f0e6; background: var(--ph-teal-soft); padding: 4px 10px; border-radius: 6px; font-weight: 600; }
        .ph-hist-grid { display: flex; gap: 10px; }
        .ph-hist-card { flex: 1; border: 1px solid var(--ph-border); border-radius: 8px; padding: 8px; }
        .ph-hist-label { font-size: 9px; color: var(--ph-ink); font-weight: 600; margin-bottom: 6px; }
        .ph-hist-bars { display: flex; align-items: flex-end; gap: 2px; height: 34px; }
        .ph-hist-bars i { flex: 1; background: var(--ph-teal); border-radius: 1px 1px 0 0; height: 0%; opacity: 0.85; }
        .ph-class { margin-top: 16px; }
        .ph-class-label { font-size: 10px; font-weight: 600; margin-bottom: 8px; opacity: 0; }
        .ph-class-bars { display: flex; align-items: flex-end; gap: 24px; height: 60px; padding-left: 4px; }
        .ph-class-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; width: 70px; }
        .ph-class-val { font-size: 9.5px; font-weight: 700; margin-bottom: 4px; opacity: 0; }
        .ph-class-fill { width: 100%; height: 0%; border-radius: 2px 2px 0 0; }
        .ph-class-fill.a { background: var(--ph-teal); }
        .ph-class-fill.b { background: var(--ph-amber); }
        @media (max-width: 760px) {
          .ph-grid3 { grid-template-columns: 1fr; }
          .ph-hist-grid { flex-wrap: wrap; }
          .ph-tabs span:nth-child(n+4) { display: none; }
        }
      `}</style>

      <div className="ph-spacer" ref={pinRef}>
        <div className="ph-pin">
          <div className="ph-noise" ref={noiseFieldRef} style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }}>
            {noiseSeeds.map((s, i) => (
              <span key={i} style={{ left: s.left + '%', top: s.top + '%', animationDelay: s.delay + 's', fontSize: s.fontSize }}>{s.token}</span>
            ))}
          </div>

          <div className="ph-headline" ref={headlineARef}>Every dataset starts as noise.</div>

          <div className="ph-mockup" ref={mockupRef}>
            <div className="ph-topnav">
              <div className="ph-brand"><span className="ph-diamond" /><span style={{ fontSize: 12, letterSpacing: '0.08em', fontWeight: 700 }}>PRISM</span></div>
              <div className="ph-tabs">
                <span>Upload</span><span className="active">Diagnose</span><span>Cleaning</span>
                <span>Feature Selection</span><span>Train and Test</span><span>Report</span>
              </div>
              <div className="ph-right"><span className="ph-pill-mini">Light</span><span className="ph-avatar" /></div>
            </div>

            <div className="ph-statsbar" ref={statsbarRef}>
              <div className="ph-stat"><div className="l">Current dataset</div><div className="v">student_performance.csv</div></div>
              <div className="ph-stat"><div className="l">Health score</div><div className="v" ref={vHealthRef}>0/100</div><div className="ph-bar-mini"><i ref={barHealthRef} /></div></div>
              <div className="ph-stat"><div className="l">Missing values</div><div className="v" ref={vMissingRef}>0%</div></div>
              <div className="ph-stat"><div className="l">Outliers</div><div className="v red" ref={vOutliersRef}>0 Detected</div></div>
              <div className="ph-stat"><div className="l">Duplicates</div><div className="v" ref={vDupRef}>0 Rows</div></div>
              <div className="ph-stat"><div className="l">Target: passed_final</div><div className="v amber">Heavily Imbalanced</div><div className="ph-bar-mini imb"><i ref={barImbRef} /></div></div>
              <div className="ph-redo">Redo</div>
            </div>

            <div className="ph-versions" ref={versionsRef}>
              <span>Original Dataset · v1</span><span>Diagnose Edits · v2</span><span>Duplicate Removed · v3</span>
              <span>Outliers Removed · v4</span><span>Missing Values Imputed · v5</span><span>Encoding &amp; Scaling · v6</span>
              <span className="active">Feature Selected · v7</span>
            </div>

            <div className="ph-main">
              <div className="ph-grid3">
                <div>
                  <div className="ph-card-label" ref={labelPreviewRef}>Data Preview</div>
                  <table className="ph-table">
                    <thead ref={theadRef}><tr><th>#</th><th>Age</th><th>Major</th><th>Study Hrs</th><th>GPA</th><th>Passed</th></tr></thead>
                    <tbody>
                      {PREVIEW_ROWS.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((val, ci) => (
                            <td key={ci}><span className="ph-scatter" ref={nextScatterRef()}>{val}</span></td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <div className="ph-card-label" ref={labelFeaturesRef}>Features</div>
                  <div>
                    {FEATURES.map((f, i) => (
                      <div key={i} className="ph-feat-row">
                        <div className="ph-feat-name"><span className="ph-feat-box" /><span className="ph-scatter" ref={nextScatterRef()}>{f[0]}</span></div>
                        {f[1] && <span className="ph-feat-warn ph-scatter" ref={nextScatterRef()}>{f[1]}</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="ph-card-label" ref={labelStatsRef}>Statistics</div>
                  <div className="ph-stat-row"><span>Total rows</span><b ref={sRowsRef}>—</b></div>
                  <div className="ph-stat-row"><span>Total columns</span><b ref={sColsRef}>—</b></div>
                  <div className="ph-stat-row"><span>Numeric columns</span><b ref={sNumRef}>—</b></div>
                  <div className="ph-stat-row"><span>Categorical columns</span><b ref={sCatRef}>—</b></div>
                </div>
              </div>

              <div className="ph-vis-head" ref={visHeadRef}><span className="ph-card-label">Visualize</span><span className="ph-showall">Show All Relationships</span></div>
              <div className="ph-hist-grid">
                {HIST_COLS.map((col, ci) => (
                  <div key={ci} className="ph-hist-card">
                    <div className="ph-hist-label">{col.name}</div>
                    <div className="ph-hist-bars">
                      {col.pattern.map((target, bi) => (
                        <i key={bi} ref={nextHistBarRef(target)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="ph-class">
                <div className="ph-class-label" ref={labelClassRef}>Class balance — passed_final</div>
                <div className="ph-class-bars">
                  <div className="ph-class-col"><div className="ph-class-val" ref={classVal1Ref}>0 (0%)</div><div className="ph-class-fill a" ref={classFill1Ref} /></div>
                  <div className="ph-class-col"><div className="ph-class-val" ref={classVal2Ref}>0 (0%)</div><div className="ph-class-fill b" ref={classFill2Ref} /></div>
                </div>
              </div>
            </div>
          </div>

          <div className="ph-headline-end" ref={headlineBRef}>
            <h2>This is how Prism brings it into focus.</h2>
            <a className="ph-cta" href={workHref}>Explore the platform →</a>
          </div>
          <div className="ph-scroll-hint" ref={scrollHintRef}>Scroll to explore</div>
        </div>
      </div>
    </div>
  )
}
