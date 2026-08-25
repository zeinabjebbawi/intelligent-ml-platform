# CLAUDE_CONTEXT.md — Full Session Context (updated 2026-08-23)

**Purpose.** This file is a complete, self-sufficient handoff for a brand-new
Claude Code chat with no memory of this conversation. It exists alongside
`docs/PROJECT_HANDOFF.md` and `docs/CLEANING_PAGE_SESSION_HANDOFF.md` — those
two cover the project's architecture and the Cleaning page in deep,
authoritative detail up through 2026-08-21. **This file covers everything
that happened after that**: the Feature Engineering, Sampling, and Data
Readiness pages built from scratch, plus every bug found and fixed along the
way, across one long conversation spanning 2026-08-21 through 2026-08-23.

**Read order for a fresh chat**: skim this file fully first (it's written to
be self-sufficient for continuing the work), then consult
`PROJECT_HANDOFF.md` / `CLEANING_PAGE_SESSION_HANDOFF.md` only if you need
deep historical detail on the Cleaning page, the Dataset Version History
system's original design, or pre-2026-08-21 history. Do not assume those two
files reflect the *current* STEP_ORDER or file structure — this document is
the current source of truth for anything that changed since.

Git identity in this repo: `zeinab jebbawi <101230180@mu.edu.lb>`. Repo root:
`c:\Users\user\Desktop\Final_cp\intelligent-ml-platform`.

---

## 0. How this project gets built — the standing workflow (unchanged)

The user has a **separate, parallel conversation with Claude (claude.ai
chat)** where feature *design* happens — architecture debates, page specs,
full source files, UI references (screenshots, hand-drawn sketches). The
user pastes that conversation's output into *this* Claude Code session
and/or describes refinements directly, and/or reports bugs found by using
the running app in a browser. The job here, every time:

1. Read and genuinely understand whatever is pasted — not skim for code.
2. Transcribe/integrate real code into the actual project, **adapting it to
   this repo's actual current architecture** where the pasted design
   assumed something that doesn't exist or has since changed (this happened
   repeatedly this conversation — see §3).
3. **Actually test everything live** — real servers, curl/direct HTTP
   requests, and temporary Vitest+RTL integration tests against the
   **actually-running** dev servers (never mock fetch). Write the test,
   confirm it passes, then **delete it** — never committed.
4. Fix real bugs found during testing, including bugs in pasted code.
5. Report back precisely: what was missing, what was done, what's still a
   gap, what already existed.
6. Distinguish "implement this" from "just diagnose this" — a hard boundary
   when the user explicitly asks for diagnosis only.
7. Ask a clarifying scoping question when a request bundles very
   differently-sized pieces of work — otherwise, in Auto Mode, make the
   reasonable call and proceed.
8. **Investigate root causes, don't hide symptoms.**

**Mojibake**: pasted text/code sometimes arrives with corrupted encoding
(`â`, `Â·`, `Ã`, `ð` sequences replacing em dashes, arrows, bullets, emoji).
Reconstruct contextually — long `â` runs are box-drawing dividers (`─`),
isolated `â` is usually an em dash (`—`), `â¦` is ellipsis (`…`), specific
byte patterns map to specific symbols once known. Prefer symbols already
established in this codebase's icon vocabulary over guessing novel ones.

---

## 1. What IntelliML / PRISM is (unchanged from PROJECT_HANDOFF.md)

A capstone ML platform ("IntelliML" in early docs, "PRISM" in the frontend
UI — same project). Two user-facing modes: **Smart Auto** (system does
everything automatically) and **Guided/Manual** (user configures every
step). Full platform philosophy (6 global rules — Suggestion Discipline
levels 1-3, No Reaching Forward, Try-See-Decide, Dataset Versioning, Mode
Differences, ML Methodology Source) is unchanged — see PROJECT_HANDOFF.md §1
for verbatim text if needed; every page built this session follows these
rules (rule-based/Level-2 suggestions throughout, no page reaches into a
later stage's results, every real transformation gets a named dataset
version, Try-See-Decide preview-before-commit on every mutating page).

---

## 2. Architecture — four services (unchanged shape, updated details)

```
React (Vite, :5173)  ⇄  Django (:8080)  ⇄  PostgreSQL
        ⇅                    ⇅
   FastAPI (:8001)  ⇄  ml-core (plain .py, no server)
```

- **Django** (`backend-django/`) — accounts, JWT auth, projects, file
  upload, dataset version history. Only service touching PostgreSQL.
- **FastAPI** (`backend-fastapi/`) — all ML computation, never touches
  PostgreSQL. Router files (see §4 for the full current list).
- **ml-core/** — plain Python modules, untouched this entire conversation.
- **React** (`frontend/`) — Vite + React 19. Talks to Django for
  accounts/projects/upload/version-history, directly to FastAPI for
  ML/cleaning/encoding/feature-engineering/sampling/visualization work.

Two separate Python venvs: `backend-django/.venv`, `backend-fastapi/.venv`.

### 2.1 Dual-stack `localhost` — CRITICAL, still applies, plus a NEW nuance

On this machine `localhost` resolves to both `::1` and `127.0.0.1`; Django
and FastAPI only bind IPv4. **Every app-code URL that reaches Django/FastAPI
must use the `127.0.0.1` literal, never `localhost`.** This is unchanged and
was re-verified/re-applied to every new router and page built this session.

**New nuance discovered this session**: Vite's own dev server binds
**IPv6-only** on this machine by default (`server.host` defaults to
`localhost`, which Node resolves to `::1` first here). This means:
- The React app itself is reachable at `http://localhost:5173` in a real
  browser (works fine — browsers resolve `localhost` the same way).
- **For my own agent-side curl/PowerShell checks of the Vite server**, I
  must use `http://localhost:5173`, NOT `http://127.0.0.1:5173` — the
  latter times out because nothing is bound there. This is purely a
  testing-tool quirk on my end, not an app bug, and nothing about the
  app's own code needed to change for it (the "always use 127.0.0.1" rule
  still applies to every fetch() call *inside* the app's own JS — this is
  only about how *I*, the agent, reach the dev server from outside).

### 2.2 FastAPI unhandled-exception → CORS-crash → "Failed to fetch"

Still the standing rule: any unhandled exception in a FastAPI route reaches
Starlette's `ServerErrorMiddleware`, which sits **outside** `CORSMiddleware`
— its fallback response never gets CORS headers, so the browser reports a
bare, undebuggable `TypeError: Failed to fetch`. **Every route handler in
every router file must be wrapped in try/except → `HTTPException`, no
exceptions.** All four router files built/touched this session follow this
(see §4).

### 2.3 Windows `uvicorn --reload` orphaned-worker gotcha (recurred twice this session)

`uvicorn main:app --reload`'s Windows StatReload spawns the real server as a
**separate child process** via Python's `multiprocessing`
(`python.exe -c "from multiprocessing.spawn import spawn_main; ..."`).
Killing the reloader PID does **NOT** reliably kill this child — it can
survive as an orphan, still bound to port 8001, still serving stale code,
while `netstat` shows misleading "ghost" LISTENING entries for PIDs that
have already exited. This caused long, confusing debugging loops twice this
session (a route registered correctly in `main.py`, confirmed via direct
`python -c "import main"`, still 404'd or served old behavior no matter how
many times `uvicorn --reload` was restarted).

**Fix procedure when a FastAPI change doesn't seem to take effect:**
```powershell
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.CommandLine -like "*backend-fastapi*" -or $_.CommandLine -like "*multiprocessing*" }
# kill ALL of them, not just the latest reloader PID
```
Then verify the port is truly free with a raw socket bind test (more
authoritative than netstat):
```bash
python -c "import socket; s=socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.bind(('127.0.0.1', 8001)); print('FREE')"
```
Then restart `uvicorn --reload` once and confirm via `/openapi.json`.

---

## 3. The shared frontend infrastructure — NEW since PROJECT_HANDOFF.md's last update

Partway through this conversation, a **parallel/other session** (not this
one) built a shared theme + navigation system and rewired `App.jsx` for real
upload handling. This was discovered via "changed on disk" notifications
mid-conversation and was **not reverted** — it was adopted as the new
standard, and every page built in this conversation (Sampling.jsx,
DataReadiness.jsx) and every page touched (FeatureEngineering.jsx,
Encoding.jsx) was migrated onto it.

### 3.1 `frontend/src/theme.jsx` — shared dark/light theme

```js
export const DARK = { bg, card, cardAlt, border, text, muted, faint,
  primary: '#2dd4bf' (teal), primarySoft, success, successSoft, warning,
  warningSoft, danger, dangerSoft, scrim, overlayCard,
  white, light, green, greenSoft, blue, blueSoft, chip, chipText,
  amber, pink, slate }
export const LIGHT = { ...same keys, primary: '#0d9488' (teal-ish) ... }
export function ThemeProvider({ children })   // React context provider
export function useTheme()                    // returns { dark, C, toggleTheme }
```
Every page component should call `const { C } = useTheme()` (or
`{ dark, C }` if it needs the boolean) rather than defining its own color
token object. `C.primary` is **teal**, not indigo, in this shared system —
several pages built earlier in the project (Cleaning.jsx) still use their
own indigo `#6366f1` tokens and were deliberately left alone (Cleaning.jsx
predates the shared theme and is heavily tested — not migrated).

**Design tokens NOT in the shared theme** that some pages' pasted specs
assumed (`mutedLight`, `borderLight`, `page`, `indigo400`, `cardR`): when
porting a page onto the shared theme, substitute `C.muted`, `C.faint`,
`C.bg`, `C.primary` respectively, and keep purely-local non-color constants
(`shadow`, `shadow2`, `cardR`) as page-local `const`s — don't touch the
shared theme file for one page's needs.

### 3.2 `frontend/src/components/TopNav.jsx` — shared nav bar

```js
export const NAV_LINKS = [
  { key: 'workspace', label: 'Workspace', enabled: false },
  { key: 'upload', enabled: true }, { key: 'diagnose', enabled: true },
  { key: 'cleaning', enabled: true }, { key: 'encoding', label: 'Scaling & Encoding', enabled: true },
  { key: 'feature_engineering', label: 'Feature Engineering', enabled: true },
  { key: 'sampling', label: 'Sampling', enabled: true },
  { key: 'data_readiness', label: 'Data Readiness', enabled: true },
  { key: 'training', enabled: false }, { key: 'report', enabled: false },
]
export default function TopNav({ active, onNavigate }) { ... }
```
Renders the PRISM wordmark, the link row (disabled links show `title="Not
built yet"`), and the theme toggle button. Every journey-map page except
`Cleaning.jsx` (explicit exception — App.jsx renders TopNav *around*
Cleaning.jsx externally, to avoid touching that file's tested internals)
renders `<TopNav active={active || '<own key>'} onNavigate={onNavigate} />`
itself, at the top of its own render, receiving `active`/`onNavigate` as
props from `App.jsx`.

### 3.3 `frontend/src/hooks/useVersionHistory.js` — the shared version-history hook

Current full API surface (grew this session — `getInputPath` and `refresh`
are new):
```js
export const STEP_ORDER = { ... see §3.4 ... }
export default function useVersionHistory(projectId, initialFilePath) {
  return { versions, getDisplayPath, getInputPath, registerVersion,
           isStepDone, getVersion, resetStep, refresh }
}
```
- **`versions`** — the raw array, now exposed directly (needed by
  DataReadiness.jsx to look up the true original upload file).
- **`getDisplayPath(stepName)`** — if `stepName` already has its own
  registered version, return *that version's own output file*; else fall
  back to the nearest strictly-earlier version; else `initialFilePath`.
  **Flips to a step's own output once it exists.** Use for: version-info
  lookups, resume-after-navigate effects, and any page where "current
  state regardless of who produced it" is exactly what's wanted (e.g. this
  is the correct choice for `data_readiness`, and for
  `feature_engineering`'s single shared file — see §3.4/§5.2).
- **`getInputPath(stepName)`** *(new this session)* — ALWAYS the nearest
  strictly-earlier version's path, **never** flips to `stepName`'s own
  output. Added specifically to fix a real bug in Encoding.jsx (see §7.1):
  a page with a *permanent* "before" table that must never change (not on
  Apply, not on Redo, not on remount) must source that table's data — and
  the file every mutating call operates on — from `getInputPath`, never
  `getDisplayPath`. Getting this distinction wrong was the exact bug fixed
  in Encoding.jsx: using `getDisplayPath` for the "before" table made it
  silently start showing the *already-transformed* data the moment Apply
  succeeded.
- **`registerVersion(stepName, filePath, label, rowCount, summary={})`** —
  keeps only versions strictly-earlier-in-STEP_ORDER than `stepName`, then
  appends the new entry (no accumulation on redo/re-run; downstream
  versions get dropped too — cascade-invalidate semantics). Cascade-deletes
  server-side via Django unconditionally first, then registers.
- **`resetStep(stepName)`** — drops `stepName`'s version (and cascades
  server-side) without registering a replacement; used by every page's
  Redo action.
- **`refresh()`** *(new this session)* — force re-hydrate `versions` from
  Django; used by `App.jsx` after a real file upload creates version 1
  server-side outside of `registerVersion`.

**CRITICAL — the STEP_ORDER cascade model is for a FIXED SEQUENCE only.**
If two sub-features are actually optional peers a user can freely
interleave (not a genuine fixed sequence), giving them separate STEP_ORDER
slots causes asymmetric cascade-invalidation bugs — this happened for real
in FeatureEngineering.jsx this session (see §5.2 and §7.2 for the full
story and the fix: merge peers into ONE shared step name and ONE shared
`filePath`/`profile` at the page level, don't give each its own slot).

### 3.4 STEP_ORDER — current, final state (as of end of this conversation)

Mirrored in **three places** — update all three together if this ever
changes again:
- `backend-django/datasets/models.py` (module-level `STEP_ORDER` dict, also
  `DatasetVersion.STEP_ORDER`)
- `frontend/src/hooks/useVersionHistory.js` (exported `STEP_ORDER` const)
- `frontend/src/pages/Cleaning.jsx` (own top-level `STEP_ORDER` const —
  Cleaning.jsx doesn't use the shared hook but still needs correct
  ordering info for its own internal cascade-invalidate logic to
  correctly recognize *later* steps like feature_engineering/sampling)

```
upload: 1, diagnose: 2,
cleaning_duplicates: 3, cleaning_outliers: 4, cleaning_missing: 5,
encoding: 6,
feature_engineering: 7,   // ← ONE shared step for Bucketizing + Create Features (see §5.2/§7.2)
sampling: 8,
data_readiness: 9,        // ← read-only report page, never registers its own version, but needs a slot so getDisplayPath('data_readiness') correctly resolves "whatever the latest real step's output is"
feature_selection: 10,    // not built yet
training: 11,              // not built yet
feature_impact: 12,        // not built yet
report: 13,                 // not built yet
```

**History of this number**: it started this conversation at
`feature_bucketizing: 7, feature_creation: 8` (two separate slots — this
was the design that caused the bug fixed in §7.2), got merged into one
`feature_engineering: 7` slot, and `sampling`/`data_readiness`/etc. shifted
down by one accordingly. If you see any lingering reference to
`feature_bucketizing` or `feature_creation` as separate step names
anywhere, that's stale — the current, correct step name is
`feature_engineering` (singular, shared).

---

## 4. Backend: FastAPI router files — current complete list

All registered in `backend-fastapi/main.py` via `app.include_router(...)`.
CORS `allow_origins` already includes both `localhost` and `127.0.0.1`
variants for :5173/:3000/:8080 — no per-router CORS changes needed.

| File | Prefix | Status | Endpoints |
|---|---|---|---|
| `cleaning_router_v2.py` | `/cleaning` | Pre-existing, untouched this conversation | 9 endpoints (duplicates/outliers/missing + `/download` used by every other page for CSV downloads) |
| `encoding_router.py` | `/encoding` | Pre-existing, untouched this conversation | `/profile`, `/encode-column`, `/scale-column`, `/apply` |
| `feature_engineering_router.py` | `/feature` | **Built this conversation** | `/profile`, `/diagnostics`, `/bucketize-preview`, `/bucketize-apply`, `/create-preview`, `/create-apply` |
| `sampling_router.py` | `/sampling` | **Built this conversation** | `/profile`, `/run`, `/apply` |
| `visualization_router.py` | `/visualization` | **Built this conversation** | `/analyze` (fast, eager), `/pca` (heavier, on-demand) |

### 4.1 `feature_engineering_router.py` — detail

- `read_df`, `save_version` (strips `_bucketized`/`_feature_created` suffixes
  before appending), `safe_round` (NaN/inf-safe), `infer_type` (bool dtype →
  categorical).
- `run_diagnostics(series, col_name)` — the 8-rule analyst diagnostic
  pipeline from the user's "philosophy prompt" (zero-impossibility →
  missingness → class-imbalance → constant/near-constant → high-cardinality
  → skewness → outliers → looking-good), returns the FIRST matching rule.
  Used for the small badge on each MiniHistogram-style diagnostic card.
- `_validate_custom_expr` / `_compute_combined` — the Create-Features custom
  expression safety layer: column names substituted via **word-boundary
  regex** (not naive `str.replace`, which would corrupt an expression when
  one column name is a substring of another, e.g. "Age" inside
  "AgeGroup"), then checked against a strict whitelist before ever reaching
  `pandas.eval()`. Verified live: a literal `__import__("os")...` injection
  attempt correctly gets rejected with 400, not executed.
- Every route wrapped in try/except → `HTTPException`.

### 4.2 `sampling_router.py` — detail, **including a real bug fixed**

- `do_sampling(df, method, sample_pct, stratify_col, target_col, shuffle)` —
  simple_random / stratified / undersample / oversample.
- **Real bug found and fixed**: the original pasted code used
  `df.groupby(col, group_keys=False).apply(lambda x: x.sample(...))` for
  stratified/under/oversample. As of **pandas 3.0** (installed here),
  `DataFrameGroupBy.apply()` **silently drops the grouping column** from
  the result (this was only a `DeprecationWarning` in pandas 2.2.x — it's
  now the actual default behavior, no error raised). This meant the
  "after" class-distribution chart came back empty every time, since the
  target/stratify column vanished from the sampled output.
  **Fix**: `_sample_per_group(df, col, sampler)` — groups by
  `df.groupby(col, sort=False).indices` (positional row indices per group)
  and slices with `.iloc[idx]` instead of `.apply()`, sidestepping the
  issue entirely regardless of pandas version. Verified live with 5
  repeated calls returning correct, consistent results.
- Also fixed: zero-division guards (`get_class_dist` on an empty/all-null
  target), `check_imbalance` edge cases.

### 4.3 `visualization_router.py` — detail, **including two real bugs fixed + defensive hardening pass**

- `/analyze` — correlation matrix, feature-target correlation, skewness
  (current + optional original/before), class distribution, class-
  conditional histograms, per-column histograms, per-column diagnostics,
  missing-value comparison, IsolationForest anomaly scores, the 6-axis
  Data Fingerprint scores, rule-based signal assessment, rule-based
  algorithm recommendations, `df.describe()` stats.
- `/pca` — on-demand PCA (scatter up to 800 points, scree data, component
  loadings, silhouette score for the Fingerprint's Separability axis).
- **Real bug #1 (found immediately, before any user report)**:
  `IsolationForest.decision_function()` was called **without `.fit()`
  first** — `.decision_function()` requires a prior `.fit()` call (unlike
  `fit_predict()`), so this was a guaranteed `NotFittedError` on
  essentially every real dataset (≥2 numeric cols, ≥20 rows is the common
  case, not an edge case). **Fixed**: `isolation_forest_scores()` helper
  now does `iso.fit(X); iso.decision_function(X)` explicitly.
- **Real bug #2 (user-reported)**: user tested with a regression dataset
  and hit `⚠ Analysis failed: '<' not supported between instances of 'str'
  and 'float'`. Extensive targeted reproduction attempts (mixed-type CSV
  columns, `.astype('category')` on genuinely mixed data, `value_counts()`
  on mixed data) did **not** reproduce the exact crash on this pandas
  version — but the fix applied is comprehensive and directly tested
  against genuinely mixed-type data (constructed in-memory, bypassing
  CSV's own type normalization) with zero crashes afterward:
  - `class_distribution()` now coerces object-dtype columns to `str`
    *after* dropna (never touches a clean numeric column) before
    `value_counts()`, plus a full try/except fallback to `[]`.
  - `feature_target_corr()`, `compute_skewness()`, `compute_correlation()`,
    `run_diagnostics()`, `compute_per_col_histograms()`,
    `compute_class_histograms()` — every one now has per-column (or
    whole-function) try/except, matching the established "never let one
    column's stats crash the whole profile" philosophy already used
    elsewhere in this codebase (e.g. `encoding_router.py`'s
    `suggest_scaler`).
  - **New**: `is_classification_target(df, target, max_classes=20)` — a
    target is "classification-shaped" if non-numeric OR numeric with ≤20
    unique values; a continuous regression target is neither.
    `class_distribution`/`compute_class_histograms` are now **only called
    when the target is classification-shaped** — fixes a real semantic bug
    (a continuous regression target used to produce one meaningless
    "class" per unique value, e.g. 300 classes for 300 rows) as well as
    removing the most failure-prone code path for a non-classification
    target. The response now includes `target_is_classification: bool`.
  - Added `import traceback; print(traceback.format_exc())` in both
    endpoints' exception handlers — server-side only (never sent to the
    client) — so if this class of bug recurs, the exact failing line is
    immediately visible in the FastAPI terminal log instead of requiring
    another guessing round.

---

## 5. Frontend pages — current complete list

| File | Route/stage key | Status |
|---|---|---|
| `pages/Upload.jsx` | `upload` | Pre-existing, touched by the other/parallel session (real Django upload wiring) — not touched by this conversation directly |
| `pages/Diagnose.jsx` | `diagnose` | Pre-existing, read-only this conversation |
| `pages/Cleaning.jsx` | `cleaning` | Pre-existing, only STEP_ORDER const updated this conversation (3 renumbering passes) |
| `pages/Encoding.jsx` | `encoding` | Pre-existing; **scrollable-table fix applied this conversation** (§7.3) |
| `pages/FeatureEngineering.jsx` | `feature_engineering` | Built earlier this conversation, **then significantly reworked** (§5.2, §7.2) |
| `pages/Sampling.jsx` | `sampling` | **Built this conversation** (§5.3) |
| `pages/DataReadiness.jsx` | `data_readiness` | **Built this conversation** (§5.4) |

`App.jsx` is still a **temporary dev harness**, not a real router — stage
chain via `useState('upload' | 'diagnose' | 'encoding' | 'feature_engineering'
| 'sampling' | 'data_readiness' | 'load-cleaning' | default→cleaning)`, each
stage rendering the matching page directly with hand-wired dev-harness
"Continue to X test →" / "← Back to X test" links at the bottom. A real
`JourneyMap.jsx` / routing system still does not exist.

### 5.1 Dev auth / testing setup (unchanged)

`bootstrapDevProject()` in App.jsx silently logs in / registers a fixed dev
account (`cleaning_dev@example.com` / `dev-preview-pass-1234`, project name
`"Cleaning Page Preview"`) on load, giving every page a real `projectId` to
persist version history against.

### 5.2 `FeatureEngineering.jsx` — full current detail

**Two tabs, ONE shared underlying file/version** (`feature_engineering`,
STEP_ORDER=7) — see §7.2 for the full bug story. Current architecture:

```jsx
export default function FeatureEngineeringPage({ projectData, onNext, onUpdateData,
  getDisplayPath, registerVersion, isStepDone, getVersion, resetStep,
  active, onNavigate }) {
  // ONE shared filePath/profile/loading/error for BOTH tabs:
  const filePath = getDisplayPath('feature_engineering') || projectData?.filePath
  const [profile, setProfile] = useState(null)   // fetched once via useEffect([filePath])
  const done = isStepDone('feature_engineering')
  const version = getVersion('feature_engineering')
  // handleApplied(newFilePath, rowCount, label) — called by EITHER tab's
  // Apply, registers into the SAME 'feature_engineering' step with a label
  // reflecting whichever action ran ("Feature Bucketizing" or "Feature
  // Engineering"), then re-fetches the ONE shared profile.
  // handleRedo — ONE combined redo (resetStep('feature_engineering')),
  // clears local state from BOTH tabs (no such thing as "redo just
  // bucketizing" once they share a file).
}
```

- **Bucketizing tab**: strategy picker is 3 **compact selectable cards**
  (Equal Intervals / Equal Distribution / Custom Ranges — NOT a dropdown,
  per explicit user request), each with a bold uppercase MIN/MAX/MEAN stat
  strip for the selected column (redesigned from tiny muted text per
  explicit user feedback — see §7.1's note on card design generally).
  Stacking histograms + a compiling "Modified Column" preview table
  (original→bucket, grouped by which original column, growing as more
  columns get bucketized in the session).
- **Create Features tab**: "New Feature Preview" panel (left, compact,
  260px) sits **directly beside** the "Combining: X and Y" controls panel
  (right, flex-grow) in ONE flex row with `flexWrap` for responsiveness —
  this was a real layout bug fix (previously the preview box sat alone
  above an empty spacer div, leaving a large blank gap; the Combining
  panel was a separate full-width block underneath). 5 operation chips
  (+/−/×/÷/ƒ custom), custom-expression safety note, new-column-name
  input, keep/remove-originals checkbox, stacking "created features" cards.
- **Shared dataset table**: hover highlights the whole column; click
  semantics differ by active tab (`getColState` prop passed from parent) —
  Bucketizing: single-select, banned-after-done (`doneBucketCols` local
  state, session-only tracking); Create Features: dual-select colA (green)
  / colB (blue), no re-selection ban (deliberate — combining the same
  column into multiple different features is legitimate).
- **Diagnostic card**: shared `diagnostic`/`diagLoading` state, fires on
  any numeric column click in either tab, calls `/feature/diagnostics`.
- **VersionsBar**: ONE pill "Feature Engineering" (or whichever label ran
  most recently) + version number, only rendered once `done` is true.
- **Redo**: ONE button "↺ Redo Feature Engineering" (only shown once
  `done`), ONE modal, reverts the entire shared step.
- Long-form description content (Bucketizing / Create Features
  explanations, kept deliberately long per explicit "don't make it too
  short" instruction) plus an "Analyst Note — does it depend on the
  algorithm?" callout in each — the "be creative like the Encoding
  guidance box" ask.

**Known gap, not yet addressed**: `doneBucketCols`/`bucketResults`/
`createdFeatures` are pure local React state (not reconstructed from the
server on remount) — if the user navigates away and back, the "already
bucketized" ban and the stacking display lists reset to empty even though
the underlying file still has the bucketed/created columns (the dataset
table itself would still correctly show them, since that comes from the
real `profile` fetch — only the *session-local bookkeeping* resets). This
mirrors a similar, already-accepted gap in Encoding.jsx before its own
resume-effect was added — worth revisiting if the user reports it.

### 5.3 `Sampling.jsx` + `sampling_router.py` — full current detail

Built from a pasted spec (mojibake-fixed, migrated onto the shared theme).
Layout: KPI strip (rich `MetricCard`-style, not plain boxes) → guidance
banner → time-series warning (if datetime-like column names detected) →
2-column layout (380px control panel | flexible preview/results) →
Advanced Strategies collapsed card (6 techniques: Systematic, Cluster,
Reservoir, Importance, Convenience⚠, Judgmental⚠ — v1 only implements
Simple Random / Stratified / Undersample / Oversample).

**Critical file-path design** (mirrors Encoding.jsx's fix): `filePath` for
this page comes from **`getInputPath('sampling')`**, never
`getDisplayPath` — it's the PERMANENT pre-sampling snapshot: the "Current
Dataset" raw tab, the KPI/target-balance analysis, AND the file every
`/run`/`/apply` call operates on. `getDisplayPath('sampling')` is used only
for version info and a **resume-on-mount effect** (if the step is already
done when the page mounts, immediately show the completed before/after
view instead of resetting to pending controls — same pattern as Encoding).

Real Redo support was **added** here (the originally pasted spec had none
at all) since it's now a hard, consistent platform convention.

Description content expanded with two "why sample" reasons that were in
the reference material but missing from the first draft (fair validation
splits, RL/complex-environment approximation) plus a stratified-sampling
caveat note (only protects against ordering patterns in the stratify
column itself; time-series is the real exception, needs a chronological
split instead).

### 5.4 `DataReadiness.jsx` + `visualization_router.py` — full current detail

The "Preprocessing Report" page, reached after Sampling. **Deliberately
excludes Feature Importance** — that belongs in the not-yet-built Feature
Selection page (deciding what to keep) and, after training, a Feature
Impact/SHAP page. This page only *describes* the data; feature-target
correlation (which IS included) is descriptive statistics, not
prescriptive selection — that distinction was explicit user guidance.

7 sections, sticky section-navigator with `IntersectionObserver`-based
active-section tracking (needed a **new jsdom stub** in `setupTests.js` —
see §7.4):
1. **Data Fingerprint** — signature custom-SVG radar chart, 6 axes
   (Completeness, Balance, Normality, Signal Strength, Separability,
   Cleanliness), each 0-100, computed server-side in
   `compute_fingerprint()`. Separability starts at 0 with "PCA pending"
   until the user loads PCA (§5's E section), then updates client-side.
2. **Before vs After** — skewness comparison, missing-values comparison,
   class distribution before/after (only meaningful for a classification
   target — see §4.3's `is_classification_target` fix).
3. **Distribution Health** — mini-histogram grid (one per numeric column,
   color-coded diagnostic severity border) + class-conditional overlay
   density charts for the top-6 correlated features.
4. **Feature Intelligence** — full correlation heatmap (custom SVG, target
   column highlighted) + feature→target correlation bar chart.
5. **Separability Check** — PCA, gated behind a "Load PCA Analysis" button
   (heavier computation, not run eagerly) — 2D scatter, scree plot,
   silhouette score.
6. **Quality Confirmation** — missing-values final-state chart, anomaly
   score distribution (IsolationForest, before/after overlay), full
   `df.describe()` stats table.
7. **Pre-Training Signal** — rule-based signal score/grade + strengths/
   warnings (real numbers from the actual data, never canned text) +
   algorithm recommendation table (5-star ratings, real reasons).

**Card design**: uses the same rich `MetricCard` pattern (left-border
accent, decorative circular blob, icon pill, trend badge) that the user
explicitly approved after criticizing Sampling.jsx's plainer KPI-card style
— see §7.1 and the standing memory `feedback_card_design.md`.

**File-path design**: `filePath = getDisplayPath('data_readiness')` — this
page never registers its own version (nothing to Apply, it's read-only),
so this always resolves to whatever the latest real step's output is.
`originalFilePath` for before/after comparisons is derived from the
`versions` array directly (`versions.find(v => v.stepName === 'upload')`),
passed in as a `versions` prop from `App.jsx` — **not** a nonexistent
`getVersions` function the originally-pasted integration notes assumed.

**Known gap**: t-SNE/UMAP and Random-Forest-importance sections from the
original design conversation were explicitly cut (Feature Importance by
user instruction; t-SNE/UMAP were "high-cost, add last" in the original
priority ranking and were never requested for v1).

---

## 6. Recurring bug classes — check every new endpoint/page against these

1. **NaN/numpy-type JSON serialization** — any endpoint returning raw
   pandas/numpy data must sanitize NaN/inf before returning (`safe_round`
   helper pattern, or `.fillna("").to_dict(...)`). 4+ occurrences across
   this project's history.
2. **Dual-stack `localhost`** — any new URL reaching Django/FastAPI from
   app code must use `127.0.0.1`. (Vite's own dev-server binding is a
   separate, agent-testing-only nuance — see §2.1.)
3. **FastAPI unhandled exceptions → CORS-crash → "Failed to fetch"** —
   every route handler in every router needs try/except → HTTPException.
4. **Windows `uvicorn --reload` orphaned workers** — see §2.3.
5. **pandas 3.0's `groupby().apply()` drops the grouping column** — use
   `.groupby(col).indices` + `.iloc[idx]` instead when the result needs to
   retain the grouping column.
6. **`IsolationForest.decision_function()` needs `.fit()` first** — it does
   not auto-fit; check any new sklearn estimator usage where
   `decision_function`/`predict`/`score_samples` is called separately from
   `fit()`.
7. **`getDisplayPath` vs `getInputPath` confusion** — a page with a
   permanent "before" table/mutation-target must use `getInputPath`;
   `getDisplayPath` is for "current state regardless of producer" (resume
   effects, version info, or pages like `feature_engineering`/
   `data_readiness` that don't have a separate before/after concept).
8. **Peer-tabs need ONE shared step, not separate STEP_ORDER slots** — see
   §3.4/§7.2. Only give two sub-features separate STEP_ORDER slots if
   there's a genuine fixed real-world sequence (redoing an earlier one
   should invalidate later ones); if they're freely interleavable peers,
   share one step name and one page-level `filePath`/`profile`.

---

## 7. Bugs found and fixed this conversation — chronological, full detail

### 7.1 Feature Engineering UI fixes (user-reported, both fixed)

- **Layout bug**: "New Feature Preview" box sat alone in a flex row beside
  an empty `flex:1` spacer div (dead leftover code), leaving a large blank
  gap where the "Combining" controls panel should have been — that panel
  was actually a separate full-width block rendered *underneath* instead.
  **Fixed**: merged into one flex row (`New Feature Preview` fixed 260px |
  `Combining` panel `flex:'1 1 380px'`), `flexWrap` for responsiveness,
  tightened the preview box's internal padding (it had unnecessary empty
  space when nothing was selected yet).
- **Stats visibility**: Bucketizing's column min/max/mean was one small
  muted line (`min 18 · max 200 · mean 46.487`). **Fixed**: three
  separated stat chips, bold uppercase label + bold 18px value in the
  primary accent color, generous gap, under an uppercase/letter-spaced
  column name.
- **Strategy dropdown → cards**: replaced the `<select>` with 3 compact
  selectable cards (name + one-line description each), matching the
  visual-selection pattern already used elsewhere (Sampling's method
  cards, Create-Features' operation chips). Selected card gets a filled
  border + soft background.
- **Card design preference learned**: the user explicitly said "I'm
  hating their way of design" pointing at Sampling.jsx's plain
  bordered-box KPI cards, in the same message as the layout instructions
  above. This was saved to memory (`feedback_card_design.md`) — the
  preferred style is DataReadiness.jsx's `MetricCard` (left-border accent,
  decorative blob, icon pill, trend badge), which was later built and
  explicitly not criticized.

### 7.2 Feature Engineering shared-state bug (user-reported, significant fix)

**Exact reported symptom**: user created a new feature → it appeared in
the Create-Features table and the version pill showed "Feature
Engineering" → switching to Bucketizing tab, the new feature column was
**missing** from that tab's table → bucketizing a column made it appear in
Bucketizing's table and the "Feature Bucketizing" version registered, but
the "Feature Engineering" (creation) version was **removed** → switching
back to Create Features, the created feature column had **vanished**, but
the bucketized column persisted in both places → creating another feature
now made everything coexist correctly going forward.

**Root cause**: the original design gave Bucketizing and Create-Features
**separate STEP_ORDER slots** (`feature_bucketizing`=7,
`feature_creation`=8) with each tab tracking its **own** `filePath`/
`profile` via `getDisplayPath(itsOwnStepName)`. Since `getDisplayPath`'s
fallback only looks at *strictly earlier* steps, Bucketizing (lower order)
could never see Creation's (higher order) output, and — critically —
`registerVersion`'s cascade-invalidate logic (correct for a genuine fixed
sequence, wrong here) meant re-registering Bucketizing always dropped any
existing Creation version (since Creation's order was "downstream"), while
the reverse never happened. This is a textbook case of applying
fixed-sequence cascade semantics to two features that are actually
free-order peers — see the standing memory
`feedback_shared_state_peer_tabs.md` for the generalized lesson.

**Fix**: merged into **one shared `feature_engineering` step** (STEP_ORDER
renumbered, §3.4) with **one shared `filePath`/`profile`/`loading`/`error`
state at the page level** — both tabs read the same table and both tabs'
Apply actions write to the same version (whichever ran most recently wins,
with a dynamic label). VersionsBar simplified to one pill. Redo
consolidated to one combined action (there's no such thing as "redo just
bucketizing" once a created feature might depend on a bucketed column, or
vice versa). `doneBucketCols`/`bucketResults`/`createdFeatures` remain
tab-local display-only state (unaffected by the shared-file change — these
are legitimately separate "what did I do in this tab" concerns).

**Verified live**: full temp RTL test reproducing the exact reported
sequence — create feature → switch to Bucketizing → column present →
bucketize → switch back to Create Features → **both** columns present, one
version pill throughout. Passed, then deleted per convention.

### 7.3 Encoding/Scaling page — scrollable dataset tables (user-reported)

User: "the dataset preview tables both must be scrollable... only 12 rows
appear and then the rest is scrollable" (to avoid a long scroll to reach
the Apply button, or the second table in the before/after comparison).

**Fixed**: `Encoding.jsx` gained a new shared constant
`TABLE_BODY_MAX_HEIGHT = 420` (≈12-13 rows depending on the page's
responsive row-padding). Both `DatasetTable` (pre-Apply, interactive) and
`AppliedDataTable` (used for BOTH the "Original — Before" and "Modified —
After" post-Apply tables — literally "the dataset preview tables, both")
now wrap their `<table>` in `<div style={{maxHeight: TABLE_BODY_MAX_HEIGHT,
overflowY:'auto'}}>`, with every `<th>` given `position:'sticky', top:0,
zIndex:2` so column headers stay visible while scrolling rows. The existing
outer `overflowX:'auto'` wrapper (horizontal scroll, unrelated) was left
untouched — this is a nested "horizontal scroll outer, vertical scroll
inner" pattern.

**Note on the encoding/scaling page's actual current structure**: this
page evolved (by the other/parallel session) since it was first built —
it now shows genuinely **two** tables post-Apply simultaneously ("Original
Dataset — Before" and "Modified Dataset — After", stacked with a "↓
changes" label between them), not the single merged-result table the
original design doc described. `AppliedDataTable` is deliberately generic
and reused for both.

**Verified live**: temp RTL test confirmed the scroll wrapper + sticky
headers are present in the DOM on all three table instances (pre-Apply
DatasetTable, post-Apply Before, post-Apply After) and that the real
`/encoding/encode-column` → `/encoding/apply` flow still works end-to-end
after the JSX restructuring. Passed, then deleted.

### 7.4 Visualization crash on regression data (user-reported) — see §4.3 for full backend detail

Also required one **new permanent test-infrastructure fix**: jsdom (Vitest's
DOM environment) doesn't implement `IntersectionObserver` (DataReadiness's
sticky section-nav uses it). Added a no-op stub to
`frontend/src/setupTests.js`, matching the pattern of the pre-existing
`ResizeObserver` stub there. This is a **permanent** fix (not a temp test
file) — any future page using `IntersectionObserver` benefits from it too.

---

## 8. Testing conventions (unchanged, reconfirmed extensively this session)

Write a temporary `*.livetest.test.jsx` file that renders the real page
component against the **actually-running** FastAPI/Django dev servers (no
fetch mocking — only the version-history hook is real too, instantiated
with `projectId: null` for local-only isolation when Django persistence
isn't needed for the test). Confirm it passes, then **delete it** — and
delete any temp CSV artifacts created alongside it in
`backend-fastapi/sample_data/`. Never commit test files.

**Pitfalls hit again this session** (all previously documented, all
recurred at least once):
- RTL's `getByText` throws on **multiple matches** just as readily as zero
  matches — e.g. "Glucose" legitimately appearing in a heatmap label, a
  histogram header, AND a signal-strength sentence all at once. Use
  `getAllByText(...).length` checks instead of `getByText` whenever the
  same substring could legitimately appear in more than one place at once.
- The "double-fetch flash" timing pattern: after an action that changes
  `filePath` (via a version registering), there's a real, deliberate
  double-fetch (an immediate inline profile call in the handler, PLUS the
  natural `useEffect([filePath])` re-firing once the hook's prop reference
  updates) — this can transiently show a Loader between two renders. Any
  test assertion immediately following such an action should be wrapped in
  `waitFor` (even a raw `fireEvent.click` inside a `waitFor` callback is a
  valid, safe pattern), not asserted synchronously.
- jsdom needs manual stubs for browser Observer APIs it doesn't implement —
  `ResizeObserver` (pre-existing stub) and now `IntersectionObserver`
  (added this session) both live in `frontend/src/setupTests.js`.
- Emoji-prefixed button text (`'▶  Run Sampling Pipeline'`) can fail exact
  `getByText` matches in ways that are hard to diagnose from the assertion
  alone — prefer a partial regex match (`/Run Sampling Pipeline/`) for any
  button/text combining an icon glyph with a label.

---

## 9. Pending / not yet done

- **Feature Selection page** — **UPDATE (2026-08-23): now exists**, but was
  NOT built in this conversation and has NOT been reviewed, tested, or
  verified by this session. `backend-fastapi/feature_selection_router.py`
  (~420 lines, routes `/feature-selection/analyze` and
  `/feature-selection/apply`) and `frontend/src/pages/FeatureSelection.jsx`
  (~1034 lines) appeared on disk — untracked, unrelated to any request in
  this conversation — while this session was writing this very file,
  along with matching wiring in `main.py` (+24 lines) and `App.jsx` (+259
  lines). This matches the same pattern already described in §3 for the
  shared theme/TopNav system: **a separate, parallel session has been
  editing this same repo concurrently.** Treat this page as real but
  unverified — before relying on it, read the actual files, confirm it's
  finished (not mid-edit), and live-test it the same way every other page
  in this doc was tested. Do not assume its STEP_ORDER slot
  (`feature_selection: 10`, per §3.4) or its design decisions match what
  this doc describes elsewhere as the plan (e.g. whether it includes the
  Random-Forest-importance section deferred from DataReadiness.jsx) —
  verify against the actual code instead of this note.
- **Training page** — doesn't exist. FastAPI backend endpoints for most of
  the ML-pipeline (`main.py`'s original `/ml/*` routes) already exist and
  were tested in an earlier (pre-this-conversation) session — it's the
  React page that's missing.
- **Feature Impact / SHAP page** — doesn't exist (post-training).
- **Report page** — doesn't exist.
- **`JourneyMap.jsx` / real routing** — still doesn't exist; `App.jsx` is
  still a dev-harness with hardcoded stage strings and manual "continue to
  X test" links.
- **FeatureEngineering.jsx's session-local bookkeeping gap** — see §5.2's
  "Known gap" paragraph (doneBucketCols/bucketResults/createdFeatures don't
  reconstruct from the server on remount).
- **Nothing from this conversation has been committed to git** — confirm
  with the user before assuming otherwise; run `git status` fresh, don't
  trust any snapshot in this or any other doc.

---

## 10. Quick-reference: running everything

```
Terminal 1 (Django):   cd backend-django   && .venv\Scripts\Activate && python manage.py runserver 8080
Terminal 2 (FastAPI):  cd backend-fastapi  && .venv\Scripts\Activate && uvicorn main:app --port 8001 --reload
Terminal 3 (React):    cd frontend         && npm run dev
```
Django admin: `http://localhost:8080/admin`. FastAPI docs:
`http://localhost:8001/docs`. React: `http://localhost:5173` (see §2.1 for
why `localhost`, not `127.0.0.1`, when *you* — the agent — need to reach
the Vite dev server directly).

**Do NOT add `--host ::` to the FastAPI command** — IPv6-only on this
Windows/Python stack, breaks IPv4 access entirely.

**If a FastAPI code change doesn't seem to take effect, see §2.3 before
assuming anything else is wrong** — check for orphaned
`multiprocessing.spawn_main` children, not just the uvicorn reloader PID.

Dev auth: `cleaning_dev@example.com` / `dev-preview-pass-1234`, project
`"Cleaning Page Preview"` (auto-created/reused on every load via
`bootstrapDevProject()` in App.jsx).

Sample dataset: `backend-fastapi/sample_data/sample.csv` (256 rows,
gitignored, one categorical column `Gender`, four numeric columns `Age`,
`Glucose`, `BMI`, `Outcome` — `Outcome` is a good binary classification
target; for regression testing, generate a synthetic dataset with a
continuous numeric target, e.g. via a throwaway pandas script — several
were created and deleted this session, none persisted).

---

## 11. Memory files saved this conversation (persist across future sessions automatically)

These don't need to be re-read manually — they load automatically in future
sessions via the memory system — but are listed here for completeness:
- `feedback_card_design.md` — dislike of plain KPI-box cards, prefer the
  rich `MetricCard` style.
- `windows_uvicorn_orphan_workers.md` — the orphaned-worker process
  pattern and fix procedure (§2.3 above is the same content).
- `pandas_sklearn_gotchas.md` — the groupby/IsolationForest bugs (§4.2,
  §4.3 above are the same content).
- `feedback_shared_state_peer_tabs.md` — the peer-tabs-need-shared-state
  lesson (§7.2 above is the same content).

---

*End of CLAUDE_CONTEXT.md. For anything not covered here — the Cleaning
page's internals, the original Dataset Version History design rationale,
pre-2026-08-21 project history — read `docs/PROJECT_HANDOFF.md` and
`docs/CLEANING_PAGE_SESSION_HANDOFF.md`. Do not edit those two files; this
document is the one to keep updated going forward for anything after this
point, unless told otherwise.*
