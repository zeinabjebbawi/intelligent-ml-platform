import { useState, useEffect } from 'react';
import CleaningPage from './pages/Cleaning';
import UploadPage from './pages/Upload';
import DiagnosePage from './pages/Diagnose';
import EncodingPage from './pages/Encoding';
import FeatureEngineeringPage from './pages/FeatureEngineering';
import SamplingPage from './pages/Sampling';
import DataReadinessPage from './pages/DataReadiness';
import FeatureSelectionPage from './pages/FeatureSelection';
import TrainTestPage from './pages/TrainTest';
import FeatureImportancePage from './pages/FeatureImportance';
import LearningCurvePage from './pages/LearningCurve';
import SimulatorPage from './pages/Simulator';
import ReportPage from './pages/Report';
import LandingPage from './pages/Landing';
import AutoModePanel from './components/AutoModePanel';
import { projectsAPI, datasetsAPI, versionsAPI } from './api';
import useVersionHistory, { STEP_ORDER } from './hooks/useVersionHistory';
import TopNav from './components/TopNav';
import { useTheme } from './theme';

// ─────────────────────────────────────────────────────────────────────────────
// FORWARD-ADVANCE BUTTON — the one, consistent "Continue to X" affordance
// every page gets, in the same footer space each already occupied. Styled
// like the primary CTAs already established elsewhere (Upload's own
// "Confirm & Start Diagnosis →", Sampling/FeatureSelection's Apply buttons)
// — solid C.primary, white text, bold, rounded — just sized for a footer
// link rather than a full-width page CTA. There is deliberately no "back"
// counterpart: backward navigation only ever happens through TopNav now.
// ─────────────────────────────────────────────────────────────────────────────
function AdvanceButton({ C, label, onClick, disabled, working }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        padding: '11px 26px', borderRadius: 10, border: 'none',
        background: disabled ? C.muted : C.primary, color: 'white',
        fontWeight: 800, fontSize: 13.5, cursor: disabled ? 'default' : 'pointer',
        boxShadow: disabled ? 'none' : `0 4px 16px ${C.primary}44`,
        opacity: disabled ? 0.6 : 1, transition: 'all 0.15s',
      }}>
      {working ? 'Preparing…' : label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY harness — not the real app shell.
// There is no routing / journey-map system in this project yet (that code
// lives in a separate conversation and hasn't been added here). This just
// lets you load a CSV that already exists on disk and view the real
// CleaningPage component against it. Replace this file once the actual
// App.jsx / JourneyMap.jsx routing is brought in.
//
// Real login/register now happens on Landing.jsx (see the 'landing' stage
// below) — this bit of plumbing is just what turns "a token now exists in
// localStorage" into "a real project to work in," shared by both the
// just-authenticated path (handleAuthenticated) and a returning user's
// mount-time re-hydration (the effect further down).
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PROJECT_NAME = 'My First Project';

async function ensureProject(name) {
  // Reuse the user's existing project with this name if one exists,
  // otherwise create it. Assumes a valid access_token is already in
  // localStorage — api.js's djangoAPI request interceptor attaches it
  // automatically to both calls below.
  const { data: projects } = await projectsAPI.list();
  const existing = projects.find(p => p.name === name);
  if (existing) return existing.id;

  const { data: created } = await projectsAPI.create({
    name,
    mode: 'guided_manual',
  });
  return created.id;
}

function LoadDatasetForm({ onLoad, bootstrapError }) {
  const [path, setPath] = useState('');

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f8fafc', fontFamily: 'system-ui, sans-serif',
    }}>
      <form
        onSubmit={(e) => { e.preventDefault(); if (path.trim()) onLoad(path.trim()); }}
        style={{
          background: 'white', border: '1px solid #e2e8f0', borderRadius: 16,
          padding: '32px 36px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', width: 480,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6, color: '#1e293b' }}>
          IntelliML — Cleaning Page Preview
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
          Enter the full path to a CSV file already saved on this computer.
          The FastAPI server (port 8001) must be running and must be able to
          read this path directly — it does not need to be uploaded through Django.
        </p>
        {bootstrapError && (
          <div style={{
            background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444',
            borderRadius: 10, padding: '10px 14px', marginBottom: 16,
            color: '#ef4444', fontSize: 12,
          }}>
            ⚠ Couldn't reach Django (port 8080) to set up version history: {bootstrapError}.
            The Cleaning page will still work, but the versions bar won't persist
            across refresh until Django is running.
          </div>
        )}
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="C:/Users/you/Desktop/my_dataset.csv"
          style={{
            width: '100%', padding: '10px 14px', fontSize: 13,
            border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 16,
            boxSizing: 'border-box',
          }}
        />
        <button
          type="submit"
          disabled={!path.trim()}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
            background: path.trim() ? '#6366f1' : '#c7d2fe', color: 'white',
            fontWeight: 700, fontSize: 14, cursor: path.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Load Dataset →
        </button>
      </form>
    </div>
  );
}

function App() {
  const { C } = useTheme();
  // 'landing' | 'upload' | 'diagnose' | 'load-cleaning' | 'cleaning' | ...
  // A returning user who already has a token skips straight past Landing —
  // Landing/AuthSection is a first-visit gate, not a page you can navigate
  // back to once signed in (see the mount effect below for the matching
  // re-hydration of `projectId` on that path).
  const [stage, setStage] = useState(() => (localStorage.getItem('access_token') ? 'upload' : 'landing'));
  const [filePath, setFilePath] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [bootstrapError, setBootstrapError] = useState('');
  const [uploadMeta, setUploadMeta] = useState(null);
  // Set by TrainTestPage's onUpdateData after a successful /training/train
  // call — the .pkl path of the most recently trained model, threaded into
  // FeatureImportancePage below so it can run SHAP/importance against it
  // without the two pages needing any other shared state.
  const [lastModelPath, setLastModelPath] = useState(null);
  // Everything else the Report page's Key Findings/exports need, accumulated
  // as pages hand it up via their own onUpdateData — lastModelName/
  // lastModelParams/lastMetrics/trainRatio (from TrainTest.jsx, alongside
  // lastModelPath above) and selectedFeatures (from FeatureSelection.jsx).
  // One merged object rather than a separate useState per field, since
  // Report only ever needs to read these, never react to one individually.
  const [reportContext, setReportContext] = useState({});
  const mergeReportContext = (update) => setReportContext(prev => ({ ...prev, ...update }));

  // Auto Mode — a LangGraph-driven agent (backend-fastapi/auto_mode/) that
  // runs the SAME pipeline this file's manual stages walk through by hand,
  // registering the SAME kind of Django dataset versions along the way.
  // Rendered as a persistent overlay (see the bottom of this file, outside
  // renderStage()) so the REAL underlying page can change live underneath
  // it as the run progresses — the user watches Cleaning/Encoding/etc.
  // actually update with real data at each step, not a disconnected modal
  // sitting frozen over the Upload page for the whole run.
  const [showAutoMode, setShowAutoMode] = useState(false);
  const [preparingAutoMode, setPreparingAutoMode] = useState(false);
  // Collapsed to a small reopenable tab, WITHOUT unmounting AutoModePanel —
  // the panel owns the run's runId/polling in its own component state, so
  // unmounting it on "close" (the old behavior) killed the connection to an
  // active run entirely: reopening Auto Mode started an unrelated SECOND
  // run rather than reconnecting to the one still going on the backend.
  // showAutoMode now means "a run is being tracked at all" (stays true for
  // the whole run); autoModeMinimized is purely which of the two visual
  // forms it takes, toggled freely without affecting the run underneath.
  const [autoModeMinimized, setAutoModeMinimized] = useState(false);

  // Maps an auto_mode graph node name to the real STEP_ORDER key it
  // corresponds to (for furthestOrder AND for resolving the actual file
  // path) and to the manual stage key that shows the equivalent page (for
  // navigation) — mirrors STEP_ORDER's own step-name vocabulary, not a new
  // one. "end" (node_end's own current_node value once the graph truly
  // finishes) deliberately maps to 'report', same as the real "report"
  // node - completion and the report node land in the same place.
  // The review_* entries are the crux of "the agent works in the background
  // without showing results": each mutating stage's backend node
  // (clean_duplicates..clean_missing_rows, encode_scale, sample, ...) runs
  // to completion and pauses at its OWN review_* node's interrupt() call —
  // see auto_mode/nodes.py's module docstring. While paused there, the
  // checkpointed current_node IS that review_* node's name (set by the
  // mutating node's own return, one node earlier), not the mutating node's
  // name itself — LangGraph never exposes an intermediate poll-visible
  // state for clean_duplicates/clean_outliers/etc. since they all run
  // synchronously in one graph.invoke() with no pause in between. Without
  // an entry here for e.g. "review_cleaning", syncToAutoModeNode found
  // nothing to map it to and returned immediately — the real page never
  // updated to show the just-finished result, leaving the user staring at
  // whatever page was current before (confirmed live: stuck on Diagnose
  // through the entire Cleaning phase, exactly the reported symptom).
  const AUTOMODE_NODE_INFO = {
    intake: { stepKey: 'upload', stage: 'upload' },
    diagnose: { stepKey: 'diagnose', stage: 'diagnose' },
    clean_duplicates: { stepKey: 'cleaning_duplicates', stage: 'cleaning' },
    clean_outliers: { stepKey: 'cleaning_outliers', stage: 'cleaning' },
    clean_missing_cols: { stepKey: 'cleaning_missing', stage: 'cleaning' },
    clean_missing_rows: { stepKey: 'cleaning_missing', stage: 'cleaning' },
    review_cleaning: { stepKey: 'cleaning_missing', stage: 'cleaning' },
    encode_scale: { stepKey: 'encoding', stage: 'encoding' },
    review_encoding: { stepKey: 'encoding', stage: 'encoding' },
    set_goal: { stepKey: 'encoding', stage: 'encoding' },
    feature_engineer: { stepKey: 'feature_engineering', stage: 'feature_engineering' },
    review_feature_engineering: { stepKey: 'feature_engineering', stage: 'feature_engineering' },
    sample: { stepKey: 'sampling', stage: 'sampling' },
    review_sampling: { stepKey: 'sampling', stage: 'sampling' },
    feature_select: { stepKey: 'feature_selection', stage: 'feature_selection' },
    review_feature_selection: { stepKey: 'feature_selection', stage: 'feature_selection' },
    select_model: { stepKey: 'training', stage: 'training' },
    train: { stepKey: 'training', stage: 'training' },
    retry_train: { stepKey: 'training', stage: 'training' },
    eval_metrics: { stepKey: 'training', stage: 'training' },
    review_training: { stepKey: 'training', stage: 'training' },
    explain: { stepKey: 'feature_impact', stage: 'feature_impact' },
    review_explain: { stepKey: 'feature_impact', stage: 'feature_impact' },
    report: { stepKey: 'report', stage: 'report' },
    end: { stepKey: 'report', stage: 'report' },
  };

  // getDisplayPath(stepKey)'s own resolution rule (see useVersionHistory.js):
  // that step's own latest registered version if it has one, else the
  // nearest strictly-earlier version. Reimplemented here against a versions
  // array fetched fresh JUST NOW, rather than calling versionHistory's own
  // getDisplayPath right after versionHistory.refresh() — React state
  // updates don't apply until the next render, so the hook's OWN versions
  // array would still be the stale pre-refresh one at this point in the
  // same function call (the exact same reason goToCleaning below fetches
  // versionsAPI.list directly instead of trusting the hook immediately
  // after refresh()).
  const resolveDisplayPathFrom = (freshVersions, stepKey) => {
    const order = STEP_ORDER[stepKey];
    const own = freshVersions.filter(v => v.step_name === stepKey);
    if (own.length) return own.reduce((a, b) => (a.version_number > b.version_number ? a : b)).file_path;
    const earlier = freshVersions.filter(v => STEP_ORDER[v.step_name] < order);
    if (!earlier.length) return null;
    return earlier.reduce((a, b) => (STEP_ORDER[a.step_name] > STEP_ORDER[b.step_name] ? a : b)).file_path;
  };

  // TrainTest.jsx persists modelHistory/activeResult to localStorage under
  // "prism_training_<filePath>__<key>" (see its own usePersisted), scoped by
  // whatever getDisplayPath('training') resolves to for THAT dataset — the
  // exact same resolution `resolveDisplayPathFrom` above does. Auto Mode
  // trains real models through the SAME training_router.train_model() call
  // (auto_mode/tools.py calls it in-process), but never wrote into this
  // same storage, so a model trained by Auto Mode was real and downloadable
  // (App.jsx's lastModelPath/reportContext knew about it) yet invisible the
  // moment the user landed back on Training manually — nothing had ever
  // populated modelHistory for that page to read. Written here, once, at
  // the exact moment the real training file path is known (right after
  // syncToAutoModeNode resolves it for the 'training' stepKey), so
  // TrainTest.jsx picks it up under the identical key it will independently
  // compute for itself on mount. `/auto-mode/status`'s model_metrics IS
  // essentially the raw training_router response (nodes.py's _make_attempt
  // keeps every field except the 3 heavy viz blobs) - already the exact
  // shape TrainTest.jsx's modelHistory entries/activeResult expect, no
  // reshaping needed. Deduped by model_id so re-polling the same status
  // never creates duplicate history rows.
  const TRAINING_LS_PREFIX = 'prism_training_';
  const injectAutoModeTrainingResult = (trainingFilePath, statusData) => {
    const result = statusData?.model_metrics;
    if (!trainingFilePath || !result?.model_id) return;
    const historyKey = `${TRAINING_LS_PREFIX}${trainingFilePath}__history`;
    const activeKey = `${TRAINING_LS_PREFIX}${trainingFilePath}__active_result`;
    try {
      const raw = localStorage.getItem(historyKey);
      const history = raw ? JSON.parse(raw) : [];
      if (!history.some((m) => m.model_id === result.model_id)) {
        localStorage.setItem(historyKey, JSON.stringify([result, ...history]));
      }
      localStorage.setItem(activeKey, JSON.stringify(result));
    } catch { /* localStorage unavailable — the model is still real and downloadable via lastModelPath */ }
  };

  // Shared by every live-progress tick AND the final completion: resolve
  // and set the real current filePath (Cleaning.jsx, unlike every other
  // page, reads this raw prop directly rather than deriving its own via
  // getDisplayPath, so without this it would keep showing whatever dataset
  // was current when Auto Mode started, not what it's actually produced),
  // refresh the shared hook too (so every OTHER page's own getDisplayPath
  // calls see fresh data on their next render), unlock TopNav that far
  // (never via advance() — its own STAGE_ORDER_OVERRIDE computation would
  // under-report progress for a stage key like 'cleaning' that covers 3
  // STEP_ORDER slots), then actually switch to the matching page.
  const syncToAutoModeNode = async (nodeName, statusData) => {
    const info = AUTOMODE_NODE_INFO[nodeName];
    if (!info || !projectId) return;
    try {
      const { data: freshVersions } = await versionsAPI.list(projectId);
      const resolvedPath = resolveDisplayPathFrom(freshVersions, info.stepKey);
      if (resolvedPath) {
        setFilePath(resolvedPath);
        if (info.stepKey === 'training') injectAutoModeTrainingResult(resolvedPath, statusData);
      }
    } catch { /* Django unreachable this tick - stage still switches below */ }
    await versionHistory.refresh();
    const order = STEP_ORDER[info.stepKey];
    if (order != null) setFurthestOrder(prev => Math.max(prev, order));
    setStage(info.stage);
  };

  // Called on every poll tick where current_node has genuinely changed
  // (see AutoModePanel.jsx) — this is what makes the page behind the panel
  // visibly update in real time instead of staying frozen on Upload for
  // the whole run.
  const handleAutoModeProgress = (statusData) => {
    syncToAutoModeNode(statusData.current_node, statusData);
  };

  // Runs once, when the graph actually finishes (status: completed —
  // AutoModePanel only calls this once, see its own status effect) or the
  // panel is otherwise closing after a terminal state. Mirrors exactly
  // what a MANUAL TrainTest.jsx run hands up via onUpdateData (see the
  // 'training'/'feature_selection' stage blocks below) — without this,
  // Report/Feature Importance/Learning Curve/Simulator have nothing to
  // read, since they all key off this same App-level state regardless of
  // whether Manual or Auto Mode produced the model.
  const handleAutoModeComplete = async (finalStatus) => {
    await syncToAutoModeNode(finalStatus.current_node, finalStatus);
    if (finalStatus.model_pkl_path) setLastModelPath(finalStatus.model_pkl_path);
    mergeReportContext({
      lastModelName: finalStatus.model_name,
      lastMetrics: finalStatus.model_metrics,
      trainRatio: finalStatus.train_ratio,
      selectedFeatures: finalStatus.selected_features,
    });
    setShowAutoMode(false);
    setAutoModeMinimized(false);
  };

  // The Auto Mode trigger now lives in Upload.jsx's Step 3, right beside
  // "Confirm & Start Diagnosis" — both fire the SAME onUpdateData(payload)
  // first (which kicks off the real, fire-and-forget Django upload), but
  // this path needs a REAL server-side file_path before it can start a run
  // (FastAPI has to read the CSV from disk), so it polls Django directly
  // for the upload to actually land instead of trusting filePath's React
  // state, which the fire-and-forget upload hasn't necessarily updated by
  // the time this same click handler runs (mirrors goToCleaning's own
  // "await a real check before proceeding" pattern below).
  const runAutoMode = async () => {
    setPreparingAutoMode(true);
    try {
      if (!filePath && projectId) {
        for (let i = 0; i < 16; i++) {
          try {
            const { data: freshVersions } = await versionsAPI.list(projectId);
            const uploadVersion = freshVersions.find(v => v.step_name === 'upload');
            if (uploadVersion) {
              setFilePath(uploadVersion.file_path);
              await versionHistory.refresh();
              break;
            }
          } catch { /* Django not reachable yet / project not ready - keep polling */ }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } finally {
      setPreparingAutoMode(false);
    }
    setShowAutoMode(true);
  };

  // The highest STEP_ORDER value the user has ever advanced INTO via a
  // page's own "Continue" button (see advance() below) — never lowered by
  // navigating backward through TopNav. TopNav uses this to gray out /
  // disable links to stages not yet reached, while still allowing free
  // backward navigation to anything at or below it. Starts at 'upload'
  // itself, since that's where every session begins.
  const [furthestOrder, setFurthestOrder] = useState(STEP_ORDER.upload);

  // A first-time visitor has no token yet — nothing to bootstrap until
  // Landing/AuthSection stores one and calls handleAuthenticated (below)
  // itself. A returning user with a still-valid token (stage already
  // initialized to 'upload' above) gets their project re-established here.
  useEffect(() => {
    if (!localStorage.getItem('access_token')) return;
    ensureProject(DEFAULT_PROJECT_NAME)
      .then(setProjectId)
      .catch(e => setBootstrapError(e.message || 'unknown error'));
  }, []);

  // Shared version-history hook (getDisplayPath/registerVersion/isStepDone)
  // for every journey-map page EXCEPT Cleaning, which still manages this
  // internally (untouched here — see frontend/src/hooks/useVersionHistory.js
  // for why). EncodingPage receives these as props per its own design.
  const versionHistory = useVersionHistory(projectId, filePath);

  // Cleaning.jsx creates real DatasetVersion rows on Django directly through
  // its own internal, self-contained version-history logic — it never calls
  // into this shared `versionHistory` hook. Since this hook's `versions`
  // array only updates when ITS OWN registerVersion/resetStep run (or when
  // refresh() is explicitly called), a version created while the user was on
  // Cleaning was previously invisible to every later page (Encoding onward)
  // until something happened to trigger a refresh — which nothing reliably
  // did. That's the exact bug behind "a version created in Cleaning doesn't
  // show up on Scaling & Encoding": this hook's local copy of the version
  // list was simply stale. Re-hydrating from Django on every stage change
  // closes that gap for every direction of navigation (forward past
  // Cleaning, or back to an earlier page after later ones already created
  // versions) — Django's /versions/ list is always the single source of
  // truth, so a cheap re-fetch on every navigation keeps every page's view
  // of "the" version history — not "a" version history — in sync.
  useEffect(() => {
    versionHistory.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // Stage keys that aren't themselves STEP_ORDER keys (Cleaning is ONE nav
  // entry covering three STEP_ORDER slots — see TopNav.jsx) need an explicit
  // mapping so advance() still knows how far that counts as having reached.
  const STAGE_ORDER_OVERRIDE = { cleaning: STEP_ORDER.cleaning_duplicates, 'load-cleaning': STEP_ORDER.cleaning_duplicates };

  // The ONLY way to move forward — called exclusively from each page's own
  // "Continue" button (never from TopNav, which is backward-only now).
  // Bumps furthestOrder so TopNav unlocks the stage just entered.
  const advance = (stageKey) => {
    setStage(stageKey);
    const order = STEP_ORDER[stageKey] ?? STAGE_ORDER_OVERRIDE[stageKey];
    if (order != null) setFurthestOrder(prev => Math.max(prev, order));
  };

  // Called by Landing/AuthSection once real login/register tokens are
  // stored in localStorage. Establishes (or reuses) this user's project,
  // then enters the app on Upload — the same page a returning,
  // already-authenticated user lands on directly via the mount effect above.
  const handleAuthenticated = async () => {
    try {
      setProjectId(await ensureProject(DEFAULT_PROJECT_NAME));
    } catch (e) {
      setBootstrapError(e.message || 'unknown error');
    }
    advance('upload');
  };

  // Shared TopNav (frontend/src/components/TopNav.jsx) calls this with a
  // stage key when the user clicks a page link — backward navigation only;
  // TopNav itself refuses to call this for a stage not yet reached (see its
  // own furthestOrder gating), so this never needs to re-check progress.
  // 'cleaning' is the one stage that can't be entered without a filePath —
  // route to the loader form instead of a blank/broken CleaningPage in that
  // rare case (Django never reachable at all this session).
  const handleNavigate = (key) => {
    if (key === 'cleaning' && !filePath) { setStage('load-cleaning'); return; }
    setStage(key);
  };
  const navActive = stage === 'load-cleaning' ? 'cleaning' : stage;

  // ── Diagnose -> Cleaning ─────────────────────────────────────────────────
  // The real Django upload (started fire-and-forget back on Upload's
  // confirm — see handleUploadMeta) may still be in flight when the user
  // clicks through from Diagnose. Blindly falling back to the manual
  // "type a CSV path" form the instant `filePath` was still null used to
  // produce exactly the symptom reported ("asking to browse a csv again")
  // even though the file WAS already uploaded moments earlier — this does
  // one real, awaited check against Django first, and only falls back if
  // that check genuinely comes up empty (Django truly unreachable, or the
  // upload itself failed).
  const [advancingToCleaning, setAdvancingToCleaning] = useState(false);
  const goToCleaning = async () => {
    if (filePath) { advance('cleaning'); return; }
    if (!projectId) { advance('load-cleaning'); return; }
    setAdvancingToCleaning(true);
    try {
      const { data: freshVersions } = await versionsAPI.list(projectId);
      const uploadVersion = freshVersions.find(v => v.step_name === 'upload');
      if (uploadVersion) {
        setFilePath(uploadVersion.file_path);
        await versionHistory.refresh();
        advance('cleaning');
        return;
      }
    } catch { /* Django unreachable — fall through to the manual loader */ }
    finally { setAdvancingToCleaning(false); }
    advance('load-cleaning');
  };

  // Upload.jsx hands back the real File/Blob it parsed (as `rawFile`) so the
  // ONE dataset the user picked on the Upload page becomes the actual root
  // of the version chain every later page reads from — not a separate
  // dataset per page. Persists through Django's real upload endpoint (which
  // auto-creates version 1, step_name='upload'), then hydrates filePath +
  // the shared hook from that. Fire-and-forget: Upload already navigates to
  // Diagnose (which only needs the client-side columns/rows, not a server
  // path) the moment this starts, and if Django/FastAPI aren't running the
  // rest of the app still works via the manual LoadDatasetForm fallback.
  const handleUploadMeta = ({ rawFile, ...meta }) => {
    setUploadMeta(meta); // DiagnosePage only needs the parsed fields, not the raw File
    // A genuinely NEW dataset (rawFile present, i.e. the user actually
    // picked/uploaded a file here, not some other unrelated onUpdateData
    // call) must restart the whole journey - every page after Upload was
    // staying unlocked (furthestOrder only ever increases via advance())
    // and Training kept showing the PREVIOUS dataset's model history, even
    // though none of that downstream state has anything to do with the
    // new file yet. Reset unconditionally on rawFile alone (not gated on
    // projectId/Django succeeding below) since none of this is Django state.
    if (rawFile) {
      setFurthestOrder(STEP_ORDER.upload);
      setLastModelPath(null);
      setReportContext({});
      // Explicit wipe of TrainTest.jsx's own persisted state
      // (prism_training_*), NOT relying on its filePath-based key scoping
      // alone - Django's upload endpoint always writes to the SAME path
      // (media/datasets/user_<id>/project_<id>/original.csv, overwritten
      // in place - see backend-django/datasets/views.py's
      // DatasetUploadView), so a re-upload does not reliably change
      // filePath at all, meaning that scoping alone silently failed to
      // isolate a new dataset from an old one's training history.
      // Confirmed live: uploading a second dataset still showed the first
      // dataset's trained models on reaching Training. This blunt removal
      // is correct regardless of whether filePath happens to differ.
      try {
        Object.keys(localStorage)
          .filter(k => k.startsWith('prism_training_'))
          .forEach(k => localStorage.removeItem(k));
      } catch {}
    }
    if (rawFile && projectId) {
      (async () => {
        try {
          const formData = new FormData();
          formData.append('file', rawFile, rawFile.name);
          await datasetsAPI.upload(projectId, formData);
          const { data: freshVersions } = await versionsAPI.list(projectId);
          const uploadVersion = freshVersions.find(v => v.step_name === 'upload');
          if (uploadVersion) setFilePath(uploadVersion.file_path);
          await versionHistory.refresh();
        } catch {
          // Django unreachable, or upload rejected — leave filePath null so
          // the load-cleaning fallback form still works.
        }
      })();
    }
  };

  // Everything below is the actual page for the current stage — pulled into
  // its own function (closing over all the state/hooks above, same as the
  // rest of this component) purely so the Auto Mode panel can be rendered
  // ONCE, at this component's true top level (see the real `return` at the
  // bottom of this file), as a persistent overlay that survives `stage`
  // changing underneath it. Before this, the panel was nested inside only
  // the 'upload' branch, so `syncToAutoModeNode`'s live setStage() calls had
  // no visible effect — the panel just sat frozen over the Upload page for
  // the whole run instead of the real page underneath actually changing.
  //
  // Upload.jsx and Diagnose.jsx are both self-contained (client-side CSV
  // parsing, no server-visible file path), so this harness just chains them:
  // Upload's "Confirm & Start Diagnosis" -> Diagnose. Diagnose.jsx has no
  // "continue" action of its own (not part of its spec), so this harness adds
  // a small dev-only link below it to keep testing the existing Cleaning page.
  function renderStage() {
  if (stage === 'landing') {
    return <LandingPage onAuthenticated={handleAuthenticated} />;
  }

  if (stage === 'upload') {
    return (
      <UploadPage
        projectData={{ projectId }}
        onUpdateData={handleUploadMeta}
        onNext={() => advance('diagnose')}
        active={navActive}
        onNavigate={handleNavigate}
        furthestOrder={furthestOrder}
        onRunAutoMode={runAutoMode}
        preparingAutoMode={preparingAutoMode}
      />
    );
  }

  if (stage === 'diagnose') {
    return (
      <div>
        <DiagnosePage
          projectData={{ projectId, ...uploadMeta }}
          onUpdateData={(update) => { if (update.cleanedFilePath) setFilePath(update.cleanedFilePath); }}
          getInputPath={versionHistory.getInputPath}
          getDisplayPath={versionHistory.getDisplayPath}
          registerVersion={versionHistory.registerVersion}
          isStepDone={versionHistory.isStepDone}
          getVersion={versionHistory.getVersion}
          resetStep={versionHistory.resetStep}
          versions={versionHistory.versions}
          active={navActive}
          onNavigate={handleNavigate}
          furthestOrder={furthestOrder}
        />
        <div style={{ textAlign: 'center', padding: '16px 0', background: '#0a0e15' }}>
          <AdvanceButton C={C} label="Continue to Cleaning →" onClick={goToCleaning} working={advancingToCleaning} />
        </div>
      </div>
    );
  }

  if (stage === 'encoding') {
    return (
      <div>
        <EncodingPage
          projectData={{ filePath, projectId, targetColumn: uploadMeta?.targetColumn, taskType: uploadMeta?.taskType }}
          onNext={(next) => {
            // 'feature_selection' is the only destination EncodingPage ever
            // requests, and that page doesn't exist yet (see docs/PROJECT_
            // HANDOFF.md §12) — so there's deliberately nowhere to go. Left
            // as a no-op rather than faking a transition to a page that
            // isn't real.
          }}
          onUpdateData={(update) => { if (update.cleanedFilePath) setFilePath(update.cleanedFilePath); }}
          getDisplayPath={versionHistory.getDisplayPath}
          getInputPath={versionHistory.getInputPath}
          registerVersion={versionHistory.registerVersion}
          isStepDone={versionHistory.isStepDone}
          getVersion={versionHistory.getVersion}
          resetStep={versionHistory.resetStep}
          versions={versionHistory.versions}
          active={navActive}
          onNavigate={handleNavigate}
          furthestOrder={furthestOrder}
        />
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <AdvanceButton C={C} label="Continue to Feature Engineering →" onClick={() => advance('feature_engineering')} />
        </div>
      </div>
    );
  }

  if (stage === 'feature_engineering') {
    return (
      <div>
        <FeatureEngineeringPage
          projectData={{ filePath, projectId, targetColumn: uploadMeta?.targetColumn, taskType: uploadMeta?.taskType }}
          onNext={(next) => {
            // Sampling / Training don't exist yet — deliberately a no-op
            // rather than faking a transition to a page that isn't real
            // (same reasoning as EncodingPage's onNext above).
          }}
          onUpdateData={(update) => { if (update.cleanedFilePath) setFilePath(update.cleanedFilePath); }}
          getDisplayPath={versionHistory.getDisplayPath}
          getInputPath={versionHistory.getInputPath}
          registerVersion={versionHistory.registerVersion}
          isStepDone={versionHistory.isStepDone}
          getVersion={versionHistory.getVersion}
          resetStep={versionHistory.resetStep}
          versions={versionHistory.versions}
          active={navActive}
          onNavigate={handleNavigate}
          furthestOrder={furthestOrder}
        />
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <AdvanceButton C={C} label="Continue to Sampling →" onClick={() => advance('sampling')} />
        </div>
      </div>
    );
  }

  if (stage === 'sampling') {
    return (
      <div>
        <SamplingPage
          projectData={{ filePath, projectId, targetColumn: uploadMeta?.targetColumn, taskType: uploadMeta?.taskType }}
          onNext={(next) => {
            // Feature Selection / Training don't exist yet — deliberately a
            // no-op rather than faking a transition to a page that isn't
            // real (same reasoning as the other pages' onNext above).
          }}
          onUpdateData={(update) => { if (update.cleanedFilePath) setFilePath(update.cleanedFilePath); }}
          getDisplayPath={versionHistory.getDisplayPath}
          getInputPath={versionHistory.getInputPath}
          registerVersion={versionHistory.registerVersion}
          isStepDone={versionHistory.isStepDone}
          getVersion={versionHistory.getVersion}
          resetStep={versionHistory.resetStep}
          versions={versionHistory.versions}
          active={navActive}
          onNavigate={handleNavigate}
          furthestOrder={furthestOrder}
        />
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <AdvanceButton C={C} label="Continue to Visualization →" onClick={() => advance('data_readiness')} />
        </div>
      </div>
    );
  }

  if (stage === 'data_readiness') {
    return (
      <div>
        <DataReadinessPage
          projectData={{ filePath, projectId, targetColumn: uploadMeta?.targetColumn, taskType: uploadMeta?.taskType }}
          onNext={(next) => advance('feature_selection')}
          onUpdateData={(update) => { if (update.cleanedFilePath) setFilePath(update.cleanedFilePath); }}
          getDisplayPath={versionHistory.getDisplayPath}
          isStepDone={versionHistory.isStepDone}
          versions={versionHistory.versions}
          active={navActive}
          onNavigate={handleNavigate}
          furthestOrder={furthestOrder}
        />
        {/* DataReadinessPage already renders its own real "Continue to
            Feature Selection →" button at the bottom of its own page
            (wired to onNext, passed above as advance('feature_selection'))
            — no separate footer button here, that would just duplicate it. */}
      </div>
    );
  }

  if (stage === 'feature_selection') {
    return (
      <div>
        <FeatureSelectionPage
          projectData={{ filePath, projectId, targetColumn: uploadMeta?.targetColumn, taskType: uploadMeta?.taskType }}
          onNext={(next) => advance('training')}
          onUpdateData={(update) => {
            if (update.cleanedFilePath) setFilePath(update.cleanedFilePath);
            if (update.selectedFeatures) mergeReportContext({ selectedFeatures: update.selectedFeatures });
          }}
          getDisplayPath={versionHistory.getDisplayPath}
          getInputPath={versionHistory.getInputPath}
          registerVersion={versionHistory.registerVersion}
          isStepDone={versionHistory.isStepDone}
          getVersion={versionHistory.getVersion}
          resetStep={versionHistory.resetStep}
          versions={versionHistory.versions}
          active={navActive}
          onNavigate={handleNavigate}
          furthestOrder={furthestOrder}
          shapData={null}
        />
        {/* No footer button here — FeatureSelectionPage already renders its
            own real, fixed-position "Continue to Training →" button (after
            "Confirm Selection & Save Version" is clicked first), wired to
            onNext above. Adding a second one here would just duplicate it
            and, worse, sit visually underneath FeatureSelectionPage's own
            position:fixed footer, intercepting clicks — confirmed live via
            Playwright before this was reverted. */}
      </div>
    );
  }

  if (stage === 'training') {
    return (
      <TrainTestPage
        projectData={{ filePath, projectId, targetColumn: uploadMeta?.targetColumn, taskType: uploadMeta?.taskType }}
        onNext={() => advance('feature_impact')}
        onUpdateData={(update) => {
          if (update.lastModelPath) setLastModelPath(update.lastModelPath);
          const { lastModelName, lastModelParams, lastMetrics, trainRatio } = update;
          mergeReportContext({ lastModelName, lastModelParams, lastMetrics, trainRatio });
        }}
        getDisplayPath={versionHistory.getDisplayPath}
        versions={versionHistory.versions}
        active={navActive}
        onNavigate={handleNavigate}
        furthestOrder={furthestOrder}
      />
    );
  }

  if (stage === 'feature_impact') {
    return (
      <FeatureImportancePage
        projectData={{ filePath, projectId, targetColumn: uploadMeta?.targetColumn, taskType: uploadMeta?.taskType }}
        modelPklPath={lastModelPath}
        onNext={() => advance(uploadMeta?.taskType === 'clustering' ? 'simulator' : 'learning_curve')}
        onGoTo={handleNavigate}
        getDisplayPath={versionHistory.getDisplayPath}
        versions={versionHistory.versions}
        active={navActive}
        onNavigate={handleNavigate}
        furthestOrder={furthestOrder}
      />
    );
  }

  if (stage === 'learning_curve') {
    return (
      <LearningCurvePage
        projectData={{ filePath, projectId, targetColumn: uploadMeta?.targetColumn, taskType: uploadMeta?.taskType }}
        modelPklPath={lastModelPath}
        onNext={() => advance('simulator')}
        onGoTo={handleNavigate}
        getDisplayPath={versionHistory.getDisplayPath}
        versions={versionHistory.versions}
        active={navActive}
        onNavigate={handleNavigate}
        furthestOrder={furthestOrder}
      />
    );
  }

  if (stage === 'simulator') {
    return (
      <SimulatorPage
        projectData={{ filePath, projectId, targetColumn: uploadMeta?.targetColumn, taskType: uploadMeta?.taskType }}
        modelPklPath={lastModelPath}
        onNext={() => advance('report')}
        onGoTo={handleNavigate}
        getDisplayPath={versionHistory.getDisplayPath}
        versions={versionHistory.versions}
        active={navActive}
        onNavigate={handleNavigate}
        furthestOrder={furthestOrder}
      />
    );
  }

  if (stage === 'report') {
    return (
      <ReportPage
        projectData={{
          filePath, projectId, targetColumn: uploadMeta?.targetColumn, taskType: uploadMeta?.taskType,
          lastModelPath, ...reportContext,
        }}
        modelPklPath={lastModelPath}
        getDisplayPath={versionHistory.getDisplayPath}
        versions={versionHistory.versions}
        active={navActive}
        onNavigate={handleNavigate}
        furthestOrder={furthestOrder}
      />
    );
  }

  if (stage === 'load-cleaning' || !filePath) {
    return (
      <div>
        <TopNav active="cleaning" onNavigate={handleNavigate} furthestOrder={furthestOrder} />
        {uploadMeta && (
          <div style={{
            maxWidth: 480, margin: '16px auto 0', fontSize: 12, color: '#64748b',
            textAlign: 'center', fontFamily: 'system-ui, sans-serif',
          }}>
            Upload step confirmed: {uploadMeta.datasetFilename} · {uploadMeta.taskType} ·{' '}
            {uploadMeta.targetColumn ? `target "${uploadMeta.targetColumn}"` : 'no target'}.
            Diagnose.jsx isn't built yet — enter a real on-disk CSV path below to continue into Cleaning.
          </div>
        )}
        <LoadDatasetForm onLoad={(p) => { setFilePath(p); advance('cleaning'); }} bootstrapError={bootstrapError} />
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      {/* CleaningPage renders as a self-contained rounded "card" (its own
          design, predating the shared TopNav) rather than a full-bleed page
          like the other four — so unlike them, TopNav is rendered out here
          in App.jsx instead of inside Cleaning.jsx, to avoid touching that
          file's tested internal layout at all.
          This wrapper previously capped width at maxWidth:1100 and centered
          it (margin:'0 auto') — the one page in the app that didn't follow
          every other page's "no max-width, just horizontal padding" full-
          bleed convention, which is exactly what produced the large equal
          gutters on both sides. Matches Sampling/Encoding/etc.'s own content
          padding now instead. */}
      <TopNav active={navActive} onNavigate={handleNavigate} furthestOrder={furthestOrder} taskType={uploadMeta?.taskType} />
      <div style={{ padding: '32px 32px 0' }}>
        <CleaningPage
          projectData={{ filePath, projectId, targetColumn: uploadMeta?.targetColumn, taskType: uploadMeta?.taskType }}
          onNext={() => { setFilePath(null); setStage('load-cleaning'); }}
          onUpdateData={(update) => {
            if (update.cleanedFilePath) setFilePath(update.cleanedFilePath);
          }}
        />
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <AdvanceButton C={C} label="Continue to Encoding →" onClick={() => advance('encoding')} />
        </div>
      </div>
    </div>
  );
  } // end renderStage()

  // The Auto Mode panel is rendered HERE, once, at the true top level —
  // never inside renderStage() — specifically so it survives `stage`
  // changing underneath it. Every live progress tick (handleAutoModeProgress)
  // calls setStage() internally, which re-renders THIS component and
  // re-invokes renderStage() with the new stage, swapping in the real
  // Cleaning/Encoding/etc. page underneath while this panel stays mounted
  // and open on top of it.
  return (
    <>
      {renderStage()}
      {showAutoMode && (
        <AutoModePanel
          projectId={projectId}
          filePath={filePath}
          taskType={uploadMeta?.taskType}
          targetColumn={uploadMeta?.targetColumn}
          userIntent={uploadMeta?.userIntent}
          minimized={autoModeMinimized}
          onMinimize={() => setAutoModeMinimized(true)}
          onExpand={() => setAutoModeMinimized(false)}
          onClose={() => { setShowAutoMode(false); setAutoModeMinimized(false); }}
          onProgress={handleAutoModeProgress}
          onComplete={handleAutoModeComplete}
        />
      )}
    </>
  );
}

export default App;
