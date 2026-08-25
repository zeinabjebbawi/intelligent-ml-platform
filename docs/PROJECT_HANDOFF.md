# IntelliML / PRISM — Project Handoff (updated 2026-08-21)

This document exists so a fresh chat can continue this project without the user re-explaining anything. Read it fully before touching code. It **supersedes** the previous version (2026-08-20) — that version's Cleaning-page section is still accurate and is summarized here, but everything about the Encoding & Scaling page, the version-history hook, and two real production bugs is new and covered in full detail below, since almost the entire session that produced this update was spent on that page.

Git identity in this repo: `zeinab jebbawi <101230180@mu.edu.lb>`. Repo root: `c:\Users\user\Desktop\Final_cp\intelligent-ml-platform`.

---

## 0. How This Project Actually Gets Built — read this first

The user has a **separate, parallel conversation with Claude (claude.ai chat)** where a lot of feature *design* happens — architecture debates, page specs, full source files, UI mockup descriptions (sometimes with hand-drawn sketches or screenshots). The user pastes that conversation's content into *this* Claude Code session, and/or describes refinements directly here once something exists, and/or reports bugs found by actually using the running app in a browser. The job here, every time:

1. Read and genuinely understand whatever is pasted or described — not skim for code blocks.
2. Transcribe/integrate real code into the actual project, **adapting it to this repo's actual architecture** where the pasted design assumed something that doesn't exist here. This happened concretely this session: a pasted `Encoding.jsx` spec expected `getDisplayPath`/`registerVersion`/`isStepDone` as props from a parent, but no such parent-level version-history state existed anywhere in this repo (`Cleaning.jsx` keeps that logic entirely internal to itself) — the fix was building a new shared hook (`frontend/src/hooks/useVersionHistory.js`), not blindly wiring undefined props.
3. **Actually test everything live** — start real servers, hit real endpoints with curl, run real datasets through it, render real React components against a live backend via temporary Vitest integration tests (written, run, then **deleted** — never committed). Never just trust that pasted or newly-written code works. This session repeatedly proved its worth: a "bug" that looked like a timing issue in a test turned out to be an RTL text-matching limitation (see §11.4), and a user-reported "Failed to fetch" turned out to be a real backend crash with a subtle CORS side effect (see §11.3) — neither would have been found by reading code alone.
4. Fix real bugs found during testing, including bugs in pasted code (there is a well-established recurring bug class in this project — see §13).
5. Report back in the format the user always expects: **what was missing, what was done, whether it's fully done, and what already existed / didn't need touching.**
6. **Distinguish "implement this" from "just diagnose this."** If the user says something like "I don't want you to do anything on the platform, just understand the problem and tell me exactly what is happening" — that is a hard boundary. Write temporary throwaway tests to empirically confirm hypotheses, report root causes precisely with file/line references, and do **not** touch production code, even if the fix looks obvious. Wait to be asked. (This happened in an earlier session for the Outliers-tab bugs; this session's work was implementation-mode throughout, always explicitly requested.)
7. When scope is ambiguous or a request bundles very differently-sized pieces of work, ask a clarifying scoping question rather than guessing.
8. **Investigate root causes, don't hide symptoms.** When the user explicitly asks "investigate the actual cause rather than simply hiding the error message" (this happened this session, verbatim, for the Apply-button bug), that means: read server logs, reproduce via curl, trace the exact mechanism, and fix the actual defect — not wrap it in a try/except that swallows the message, and not just report "here's a workaround."

**Known encoding issue**: text pasted into chat sometimes arrives with corrupted encoding (mojibake — `â`, `Â·`, `Ã` etc. replacing em dashes, arrows, bullets, stars, checkmarks). This happened again this session for `encoding_router.py` and `Encoding.jsx` (pasted directly as chat documents, no disk copy to fall back on). Fixed by contextual reconstruction: long runs of `â` are box-drawing section dividers (`─`), isolated `â` between words is usually an em dash (`—`), and specific byte-math patterns reliably identify specific symbols once you know the trick — e.g. `â¦` is an ellipsis (`…`), `â¼` is a down-triangle (`▼`), `âº` is a redo arrow (`↺`), `â¬` is a download arrow (`⬇`), a lone `â` with nothing following is very often a symbol whose UTF-8 continuation bytes both happened to be invisible C1 control codes when misread as Latin-1 (e.g. `★`, `✓`, `✕`, `⚖`, `✎`, `ⓘ` all reduce to bare `â`). When reconstructing, prefer symbols already established elsewhere in this exact codebase's icon vocabulary (`★` for suggestions, `✓`/`↺`/`⬇` matching `Cleaning.jsx`'s conventions) over guessing something novel.

---

## 1. What IntelliML / PRISM Is

A capstone ML platform (branded "IntelliML" in early docs, "PRISM" in the frontend UI itself — same project). Two user-facing modes:

- **Smart Auto mode**: user uploads data, the system does everything (cleaning, model selection, training, evaluation) automatically and explains what it did.
- **Guided/Manual mode**: user configures every step themselves, with rule-based/explanatory help, not automated decisions.

### Platform Philosophy (verbatim rules — govern every page)

**What it is NOT**: not primarily a training platform; not a tool that hides complexity and hands over answers; not a copy of WEKA (a full redesign of the workflow experience); does not reach ahead into future pipeline stages to generate suggestions on an earlier page.

**What it IS**: a complete ML workflow environment that preserves the full analytical process; helps users understand what they're doing and why; keeps analytical space open for the user to reason and decide; an enhancement of WEKA's logic with better clarity, guidance, and modern UI.

**Three internal user types** (not exposed in the UI — the UI only ever shows "Manual" or "Auto"): Non-technical user → Auto Mode. Learner → Manual Mode (deep visual analysis, guided decision-making). Expert → Manual Mode (rule-based suggestions without losing control, full parameter visibility).

**Six global rules:**
1. **Suggestion Discipline** — Level 1 (explanatory text only) / Level 2 (rule-based if/else, e.g. Cleaning's normality-based Z-score/IQR suggestion, or Encoding's "★ suggested" encoder/scaler picks) / Level 3 (AI-based, only in deliberately chosen places).
2. **No Reaching Forward** — a page's suggestions must derive *only* from that page's own data/state, never a later stage's results.
3. **The "Try-See-Decide" Loop** — on pages explicitly marked with this rule, user choice → immediate before/after on the *same screen*, no navigation. Example on Encoding: the encoding/scaling dropdowns immediately update the "Modified Columns" preview table with real backend-computed before→after values, no page navigation, no separate "preview" step.
4. **Dataset Versioning** — every significant transformation creates a *named, non-overwritten* dataset version, inspectable/comparable/rollback-able. Fully implemented full-stack feature (Django `DatasetVersion` model + `versionsAPI` +, this session, a reusable frontend hook — see §8).
5. **Mode Differences** — same underlying logic runs in both modes; Manual configures every step, Auto does it automatically.
6. **ML Methodology Source** — `AllFunctions.ipynb` + `v6.0-InternProject.html` (external, not in this repo) govern preprocessing order/hierarchy, algorithm choices, eval methods.

---

## 2. Architecture — Four Independent Services

```
React (Vite, :5173)  ⇄  Django (:8080)  ⇄  PostgreSQL
        ⇅                    ⇅
   FastAPI (:8001)  ⇄  ml-core (plain .py, no server)
```

- **Django** (`backend-django/`) — accounts, JWT auth, projects, file upload, dataset version history + workflow/step-memory. Only service allowed to touch PostgreSQL directly.
- **FastAPI** (`backend-fastapi/`) — all ML computation. Never touches PostgreSQL. `main.py` (10-endpoint original ML pipeline router) + `cleaning_router_v2.py` (9-endpoint Cleaning-page backend) + `encoding_router.py` (**new this session**, 4-endpoint Encoding & Scaling backend).
- **ml-core/** (project root, sibling to backend folders) — plain Python modules, no FastAPI code inside, imported only by FastAPI. **Untouched this session and the one before it.**
- **React** (`frontend/`) — Vite + React 19. Talks to Django for accounts/projects/upload/version-history/workflow, directly to FastAPI for all ML/cleaning/encoding work.

Two separate Python venvs: `backend-django/.venv`, `backend-fastapi/.venv`.

**Critical environment fact discovered this session, applies to all future work**: on this machine, `localhost` resolves to **both** `::1` (IPv6) and `127.0.0.1` (IPv4) — confirmed via `nslookup localhost`. All backends here only bind IPv4. Any URL in this codebase that says `http://localhost:PORT` is a landmine: if a browser's `fetch()` happens to pick the IPv6 address, the connection fails outright and the browser reports a bare, uninformative `TypeError: Failed to fetch`. **Every new file that needs to reach Django or FastAPI must use the `127.0.0.1` literal, not `localhost`.** See §11.2 for the full story and the exact list of files already fixed.

---

## 3. Current Git State (verify fresh — this changes every session)

Last commit: `057ee89 "Update full-stack ML platform"` (user-authored, landed almost everything from two sessions ago). As of the end of **this** session:

```
Changes not staged for commit:
	modified:   backend-django/core/settings.py       (this session — CORS 127.0.0.1 origins added)
	modified:   backend-django/datasets/views.py       (this session — one-line localhost->127.0.0.1 fix)
	modified:   backend-fastapi/cleaning_router_v2.py  (NOT this session — pre-existing uncommitted diff from an earlier session, unchanged by this one; contains the already-fixed Outliers-tab bugs, see §11.1)
	modified:   backend-fastapi/main.py                (this session — encoding_router registered, CORS origins added)
	modified:   docs/PROJECT_HANDOFF.md                (this file, this session)
	modified:   frontend/src/App.jsx                   (this session — 'encoding' stage wired in)
	modified:   frontend/src/api.js                    (this session — localhost->127.0.0.1 fix)
	modified:   frontend/src/pages/Cleaning.jsx         (this session — ONE line: the API constant's localhost->127.0.0.1 fix. Nothing else in this file was touched — it remains the heavily-tested, self-contained version-history page described in §9.)
	modified:   frontend/src/pages/Diagnose.jsx         (NOT this session — pre-existing uncommitted diff from before this session, origin unclear/external, this session only ever READ this file to extract the TopNav component, never wrote to it)

Untracked files:
	backend-fastapi/encoding_router.py   (NEW this session)
	frontend/src/hooks/                  (NEW this session — useVersionHistory.js)
	frontend/src/pages/Encoding.jsx      (NEW this session)
```

Run `git status` / `git log --oneline -8` fresh at the start of the next session — do not trust this table, it's a snapshot.

---

## 4. Backend: Django (`backend-django/`)

**Unchanged this session** except two `127.0.0.1` literal fixes (see §11.2):
- `core/settings.py` — `CORS_ALLOWED_ORIGINS` gained `http://127.0.0.1:5173` and `http://127.0.0.1:3000` alongside the existing `localhost` variants (both kept, in case something still loads via the `localhost` origin).
- `datasets/views.py` — the Django→FastAPI server-to-server call to `/ml/profile` inside `DatasetUploadView` now targets `http://127.0.0.1:8001/ml/profile` instead of `localhost`.

Everything else (apps: `accounts`, `projects`, `datasets`, `experiments`; models; the full Dataset Version History + Step Memory system described in §8; JWT; CORS middleware ordering) is unchanged from the 2026-08-20 handoff and still accurate. Read that content below in §8 if touching version-history code.

---

## 5. Backend: FastAPI (`backend-fastapi/`)

### `main.py`
Unchanged 10-endpoint original ML pipeline router, plus this session's additions:
```python
from cleaning_router_v2 import router as cleaning_router
from encoding_router import router as encoding_router
...
app.include_router(cleaning_router)
app.include_router(encoding_router)
```
CORS `allow_origins` list expanded to include `127.0.0.1` variants for `:5173`, `:3000`, `:8080` alongside the existing `localhost` ones (see §11.2 for why).

### `cleaning_router_v2.py` — untouched this session
Confirmed via live curl testing at the start of this session that the four previously-diagnosed Outliers-tab bugs (stale threshold, Remove-All stat drift, histogram downsampling, stale badges) are **already fully fixed** in the current file, including the `POST /cleaning/get-all-outlier-indices` endpoint. See §11.1 for the verification details. No code was changed here this session — only verified.

### `encoding_router.py` — **NEW this session, then bug-fixed later in the same session**

Prefix `/encoding`. Backs the Encoding & Scaling page (§10). Four endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/encoding/profile` | POST | Analyse a dataset: per-column `inferred_type` (`numeric`/`categorical`), `suggested_encoding`/`suggested_scaler` + plain-language reason, stats for numeric columns, `display_rows` (first 50 rows, NaN→`""`) |
| `/encoding/encode-column` | POST | Preview one column's encoding (`label` or `one_hot`) without saving — returns a `mapping` (label) or `one_hot_columns` (one-hot, each with its own preview) |
| `/encoding/scale-column` | POST | Preview one column's scaling (`minmax`/`standard`/`robust`) without saving — fits on the full column, returns before→after pairs for the first 50 rows |
| `/encoding/apply` | POST | Applies a full batch of `encoding_decisions` + `scaling_decisions` at once, saves a new versioned CSV (`save_version`, same suffix-stripping helper pattern as `cleaning_router_v2.py`), returns `new_file_path` + `applied_transformations` list |

**Helper functions** (module-level, not shared with `ml-core/cleaning.py` — same acceptable duplication pattern already present between `cleaning_router_v2.py` and `ml-core`):
- `read_df(path)` — 404 if missing, else `pd.read_csv`.
- `save_version(df, original_path, suffix)` — strips known suffixes (`_encoded`, `_scaled`, `_encoding_scaling`) before appending the new one, so repeated applies don't chain into long filenames.
- `infer_type(series)` — **bool dtype → `"categorical"`** (fixed this session, see §11.3 — this is not cosmetic, it prevents a real crash), numeric dtype → `"numeric"`, else `"categorical"`.
- `suggest_encoding(series)` — Level-2 rule-based: 2 unique values → label ("Binary column..."), >15 unique → label ("...avoids column explosion"), else → one-hot.
- `suggest_scaler(series)` — Level-2 rule-based: <8 non-null values → `"none"`. Otherwise (fixed this session, wrapped in try/except as defense-in-depth): IQR-based outlier % >5% → `"robust"`; else Shapiro-Wilk (n≤5000) / D'Agostino (n>5000) normality test → `"standard"` if normal, else `"minmax"`. Falls back to `"minmax"`/"Default suggestion." on any exception.

**Every endpoint is now wrapped in `try/except HTTPException: raise / except Exception as e: raise HTTPException(500, ...)`** (added this session — see §11.3 for exactly why this matters, it's not just tidiness). This matches the pattern already used in `main.py` and `cleaning_router_v2.py`; `encoding_router.py` was the one file missing it when first transcribed from the pasted spec.

**`apply_all`'s one-hot handling** (fixed this session): `pd.get_dummies(series, prefix=col).astype(int)` — the `.astype(int)` is new. Without it, one-hot dummy columns save to CSV as `True`/`False` (pandas' `get_dummies` default dtype), which `pd.read_csv` re-infers as `bool` on the next read — this is the literal root cause of the crash described in §11.3. Casting to `int` here also fixes an earlier-noted, separate cosmetic inconsistency: the `/encode-column` preview endpoint already showed `1`/`0` (it explicitly does `int(dummies.iloc[i][dummy_col])`), but the *saved* file used to show `True`/`False` — now both agree.

---

## 6. `ml-core/` — untouched this session and the one before it

4 files (`cleaning.py`, `models.py`, `evaluation.py`, `pipelines.py`). See earlier handoff content (this doc's git history, or just read the files) if needed — nothing here has been touched across the last two sessions of work.

---

## 7. Frontend (`frontend/`)

### `src/api.js`
`djangoAPI`/`mlAPI` axios `baseURL`s now use `127.0.0.1` instead of `localhost` (§11.2). `versionsAPI`/`workflowAPI` (from the previous session) unchanged.

### `src/App.jsx` — dev harness, extended this session
Still a temporary harness (no real `JourneyMap.jsx` routing exists). Stage chain is now: `'upload'` (renders `UploadPage`) → `'diagnose'` (renders `DiagnosePage` + a dev-only "Skip to Cleaning page test →" link) → `'encoding'` (**new**) → `'load-cleaning'` (the old CSV-path loader form, fallback) → default (renders `CleaningPage`).

New this session:
```jsx
import EncodingPage from './pages/Encoding'
import useVersionHistory from './hooks/useVersionHistory'
...
const versionHistory = useVersionHistory(projectId, filePath)
...
if (stage === 'encoding') {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      <EncodingPage
        projectData={{ filePath, projectId }}
        onNext={(next) => { /* no-op — 'feature_selection' doesn't exist yet, deliberately not faked */ }}
        onUpdateData={(update) => { if (update.cleanedFilePath) setFilePath(update.cleanedFilePath); }}
        getDisplayPath={versionHistory.getDisplayPath}
        registerVersion={versionHistory.registerVersion}
        isStepDone={versionHistory.isStepDone}
        getVersion={versionHistory.getVersion}
        resetStep={versionHistory.resetStep}
      />
      <div>... "(dev harness) ← Back to Cleaning page test" link ...</div>
    </div>
  );
}
```
And below the `CleaningPage` render (the default/fallback branch), a matching "(dev harness) Continue to Encoding page test →" button that does `setStage('encoding')`. **This button lives in `App.jsx`, deliberately NOT inside `Cleaning.jsx`** — `Cleaning.jsx` has an explicit, user-requested "no Proceed button, each tab's own action button IS the forward motion" design rule (documented in §9), so adding a navigation button there would violate that. The `'encoding'` stage check is placed in the if/else chain *before* the `load-cleaning || !filePath` fallback check, so it can never be shadowed.

`App.test.jsx` remains known-stale/failing (asserts the old loader-form placeholder renders by default; `App.jsx` now starts at the Upload stage) — pre-existing, not touched, not this session's concern.

### `src/hooks/useVersionHistory.js` — **NEW this session**

The reason this exists: `Cleaning.jsx` implements `getDisplayPath`/`registerVersion`/`isStepDone`/`confirmBeforeAction` internally, self-contained (it predates this hook and is heavily tested — deliberately left untouched). But the pasted `Encoding.jsx` spec expects these as *props from a parent*. Rather than duplicate Cleaning.jsx's logic a second time inline in Encoding.jsx, this hook extracts the reusable parts so any *future* journey-map page can get the same behavior via props from `App.jsx` (or eventually a real `JourneyMap.jsx`).

Full API surface:
```js
export const STEP_ORDER = { upload:1, diagnose:2, cleaning_duplicates:3, cleaning_outliers:4,
  cleaning_missing:5, encoding:6, sampling:7, feature_selection:8, training:9, feature_impact:10, report:11 }
  // mirrored a THIRD time now (Django's datasets/models.py, Cleaning.jsx's own top-level
  // const, and here) — if you ever add/reorder a step, update all three.

export default function useVersionHistory(projectId, initialFilePath) {
  // returns: { versions, getDisplayPath, registerVersion, isStepDone, getVersion, resetStep }
}
```
- **`versions`** — array of `{ id, stepName, label, filePath, rowCount, versionNumber }`, hydrated from Django's `versionsAPI.list(projectId)` on mount (optional — works local-only if Django is unreachable, same resilience principle used throughout this project). Seeded initially with a synthetic `{stepName:'upload', ...}` entry from `initialFilePath` so there's always something to fall back to before hydration completes.
- **`getDisplayPath(stepName)`** — if this step already has its own version, return *that* version's file path (the output); else fall back to the nearest earlier version (by `STEP_ORDER`); else `initialFilePath`. Mirrors `Cleaning.jsx`'s bug-fixed `getDisplayPath` exactly (the original bug there: always returning the *input*, never the step's own *output* — see §9's bug history if touching this logic again).
- **`isStepDone(stepName)`** — `versions.some(v => v.stepName === stepName)`.
- **`registerVersion(stepName, filePath, label, rowCount, summary={})`** — keeps only versions strictly earlier than this step (local state), then appends the new one (no accumulation on redo/re-run). Remotely: unconditionally calls Django's `cascadeDelete` first (idempotent no-op if nothing downstream), then `register`, then patches the local entry's `id`/`versionNumber` from the real response.
- **`getVersion(stepName)`** — **new this session**, returns the full version object (including `versionNumber`) for display purposes, e.g. Encoding's "Version created — Version 4" banner and the Versions-bar pill.
- **`resetStep(stepName)`** — **new this session**, added specifically for Encoding's Redo requirement ("return the dataset to exactly the state it was before"). Filters local `versions` to drop this step (and anything at/after it), and — critically — calls Django's real `cascadeDelete` too, so the version genuinely stops existing server-side, not just client-side. This is what makes `getDisplayPath('encoding')` naturally fall back to the pre-encoding file again after Redo, which in turn makes `EncodingPage`'s own `useEffect([filePath])` re-fetch the correct data with zero special-case logic.

### `src/pages/Cleaning.jsx` — **one line changed this session, nothing else**
`const API = 'http://127.0.0.1:8001'` (was `'http://localhost:8001'`). Everything else in this file — the entire Cleaning page, its 3 tabs, its internal version-history logic, its Outliers-tab bug fixes — is exactly as described in §9 below and was NOT touched this session.

### `src/pages/Diagnose.jsx` — read-only this session
This session read the file in full (1524 lines) specifically to extract the `TopNav` component and the `DARK`/`LIGHT` theme token pattern for reuse in `Encoding.jsx`. **Nothing in `Diagnose.jsx` was written to.** (The file does show as modified in `git status`, but that diff pre-dates this session — see §3.) Its own structure, for reference if a future session needs it: `TopNav` (nav bar), `StatusBar` (health/missing/outliers/duplicates/target stat strip), a 40%/60% two-column layout (`DataPreviewCard`+`DiagnoseCard` left, `FeaturesCard`+`StatisticsCard`+`VisualizeSection` right), `PairplotOverlay` (full-screen seaborn-style pairplot), `ExpandableSection` (its own expand/collapse pattern, similar in spirit to but a separate implementation from `Cleaning.jsx`'s `ExpandableChart` and this session's new `Encoding.jsx`'s `ExpandableTable`). Defaults to **light** theme (`useState(false)`) despite a comment claiming dark-first — a pre-existing discrepancy, not touched.

### `src/pages/Encoding.jsx` — **NEW this session, then substantially rewritten twice more in the same session**

This is the file almost the entire session's work went into. ~1000 lines. Read this whole section before touching it again.

---

## 8. Dataset Version History + Step Memory — unchanged core, now used by two pages

The system itself (Django `DatasetVersion`/`WorkflowState` models, `version_views.py`/`version_urls.py` endpoints, `STEP_ORDER`) is unchanged from the 2026-08-20 handoff. What's new this session is that a **second page** (`Encoding.jsx`) now participates in it, via the new `useVersionHistory` hook (§7) rather than via `Cleaning.jsx`'s internal-only implementation. Both talk to the same Django `DatasetVersion` table through the same `versionsAPI`; since only one journey-map page is ever mounted at a time in this app, there's no consistency risk from having two independent in-memory copies of the same server state.

---

## 9. THE CLEANING PAGE — unchanged this session, summary only

Full detail lives in this doc's git history (2026-08-20 version) if needed — nothing here changed. Quick summary for context: `frontend/src/pages/Cleaning.jsx`, self-contained (light-theme-only, no dark mode, hardcoded `C` design tokens), 3 tabs (Duplicates/Outliers/Missing Values) backed by `cleaning_router_v2.py`, manages its own version-history state internally (not via the new hook), has NO forward-navigation button by explicit user design (each tab's primary action button IS the forward motion), and had 4 Outliers-tab bugs (stale threshold, Remove-All stat drift, histogram downsampling, stale badges) diagnosed then fixed in an earlier session — **confirmed still fixed and working** via live curl verification at the start of this session (§11.1).

---

## 10. THE ENCODING & SCALING PAGE — complete detail (the core of this session's work)

### 10.1 File and entry point
`frontend/src/pages/Encoding.jsx`, default export `EncodingPage`, named export `computeColWidth` (exported specifically so it's unit-testable without a DOM — see §10.7). Called with:
```jsx
<EncodingPage
  projectData={{ filePath, projectId }}
  onNext={(next) => {...}}          // called with ('feature_selection', {}) on the (now-removed) continue button — see below, this call site no longer exists
  onUpdateData={(update) => {...}}  // called with { cleanedFilePath } after Apply
  getDisplayPath={fn} registerVersion={fn} isStepDone={fn} getVersion={fn} resetStep={fn}
  // all five from useVersionHistory — see §7
/>
```

### 10.2 Backend — see §5's `encoding_router.py` section for the full endpoint table and the bug history.

### 10.3 Visual structure, top to bottom
1. **`TopNav`** — reused verbatim from `Diagnose.jsx` (same `links` array `['Workspace','Upload','Diagnose','Cleaning','Training','Report']`, same active-underline styling logic, same theme-toggle button). **"Cleaning" is hardcoded as the active link** (`const active = l === 'Cleaning'`), not "Encoding" — there is no distinct "Encoding" entry in this simplified nav, and Cleaning is the closest/most recent stage. If a future session adds a real "Encoding" nav item, update this.
2. **`VersionsBar`** — sticky pill row below the nav: `↻ Versions:` label, an always-present "Original Dataset" pill, and — **only when `done` is true** (i.e. `isStepDone('encoding')`, which only becomes true after a real Apply) — an active/highlighted "Encoding & Scaling · vN" pill, where N comes from `getVersion('encoding')?.versionNumber`. Before Apply, this second pill genuinely does not render (not just visually hidden) — verified live.
3. **Info banner** — dismissible, "ℹ Start with encoding. Scaling unlocks once every categorical column is encoded."
4. **Main content, 75/25 flex split**:
   - **LEFT (`flex: '1 1 75%'`)**:
     - Section header: `▤ Original Cleaned Dataset` (pre-Apply) or `▤ Complete New Dataset` (post-Apply), row/column counts, a `↺ Redo changes` button (always visible), a `⬇ Download` button (only once `done && newPath`).
     - The dataset table itself, wrapped in `ExpandableTable` (§10.6) — pre-Apply this is `DatasetTable` (interactive, with encoding/scaling controls), post-Apply it's `AppliedDataTable` (read-only, the merged result).
     - Pre-Apply only: the "Modified Columns" preview section (`⚡` icon, "only transformed columns appear here" subtitle, a "new version on Apply" badge), wrapped in its own `ExpandableTable`, containing `PreviewTable`. Below it, a summary bar (`✓ N encoded · ✓ N scaled` or "No modifications yet", plus a `🔒 encode all categorical columns to unlock scaling` warning when relevant) and the `Apply changes & create version ⟶` button.
     - Post-Apply only: a success banner (`✓ Version created — Version N`, "This dataset is now the working version. Use ↺ Redo changes above if you want to start over.").
   - **RIGHT (`flex: '0 0 25%'`)**: `GuidanceSection` — algorithm picker → rule-based scaler suggestion (`ALGORITHM_MAP`), plus static explanations of Min-Max/Standard/Robust scaling (`SCALER_INFO`). Unchanged content from the original pasted spec, just restyled to fit the narrower column and dark/light theme.
5. **Redo confirmation modal** — scrim+blur, "This clears every encoding/scaling choice... including removing the Encoding & Scaling version if one was already applied." Cancel / "Yes, redo".

### 10.4 Column-control alignment (requirement from the first UI-rewrite round)
`DatasetTable` renders three pieces sharing **the exact same per-column width** (`colWidth`, computed responsively — see §10.7): an encoding-controls row (a `<select>` directly above each *categorical* column, empty placeholder div for others), the `<table>` itself, and a scaling-controls row (a `<select>` directly below each *numeric* column). All three are inside one `overflowX:'auto'` wrapper so they scroll together. **The table has `tableLayout:'fixed'`** — this is the actual mechanism that keeps the controls aligned; without it, a long cell value can silently widen a column past its declared width and desync the table from the control rows above/below it (this was a real, fixed bug from the first rewrite round, not a hypothetical).

### 10.5 Scaling lock
`categoricalCols = profile.columns.filter(c => c.inferred_type === 'categorical')`; `encodingComplete = categoricalCols.length === 0 || categoricalCols.every(c => !!encChoices[c.name])`. Every `ScalingDropdown` receives `locked={!encodingComplete}` — when locked, it's genuinely `disabled`, shows `🔒 locked` as its placeholder option instead of `— scale`, dimmed styling, `title="Finish encoding every categorical column first"`. Purely local UI state (`encChoices`), no backend involvement. Verified live: locked before encoding the only categorical column in `sample.csv` (`Gender`), unlocked immediately after.

### 10.6 One-hot visual grouping + `ExpandableTable`
**One-hot grouping** (in `PreviewTable`, the pre-Apply "Modified Columns" view only — post-Apply, one-hot columns are just normal columns in the merged result, no grouping needed): a 2-row `<thead>`. Row 1 has one `<th colSpan={n}>` per transformed *original* column, reading e.g. `Gender (one-hot)` (or `(label)`, `(standard)`, etc. for non-one-hot transforms), with a bold `2px` border (`${C.primary}99`) on its right edge to visually separate groups. Row 2 has the actual sub-column names (prefix stripped, e.g. `Female`/`Male`/`__MISSING__` not `Gender_Female`/...). The group's sub-columns are narrowed so the *group's total width* stays close to one normal column's computed width: `subW = Math.max(MIN_SUBCOL_W, Math.floor(colWidth / subCols.length))`, `MIN_SUBCOL_W = 40`.

**`ExpandableTable`** (new shared component, mirrors `Cleaning.jsx`'s `ExpandableChart` / `Diagnose.jsx`'s `ExpandableSection` pattern exactly — a `⤢` button top-right of the inline content; clicking it renders the **same `children` a second time** inside a fullscreen scrim+blur modal (`width:'92vw', maxWidth:1500, maxHeight:'88vh'`) with a `✕ Close` button (also closes on click-outside via the scrim's own `onClick`, stopped from bubbling by the inner card). Rendering `children` twice — not portaling — is deliberate and matches the established codebase pattern: each mount gets independent state/hooks, which is exactly what lets the modal's copy of `DatasetTable`/`PreviewTable` compute a *wider* `colWidth` automatically (since it measures its own, much wider, modal container) with zero coordination code needed. **Accessibility note**: the expand button's *accessible name* is its emoji text content (`⤢`), not its `title` attribute (title only becomes the accessible name when there's no other text) — it also has an explicit `aria-label="Expand table"` (added this session after a test caught the gap) so screen readers announce something meaningful instead of a bare glyph.

Both the main dataset table and the "Modified Columns" preview table are wrapped in `ExpandableTable`. Verified live: expand opens the modal with duplicated content, Close collapses it back.

### 10.7 Responsive column width (third bug-fix round)
Replaced a single fixed `COL_W = 92` constant with:
```js
function useContainerWidth(fallback = 900) {
  const ref = useRef(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

export function computeColWidth(availWidth, numCols) {
  if (numCols <= 0) return MAX_COL_W
  const fit = Math.floor((availWidth - ROW_N_W - 4) / numCols)
  return Math.max(MIN_COL_W, Math.min(MAX_COL_W, fit))  // MIN_COL_W=76, MAX_COL_W=240
}
```
`DatasetTable`, `AppliedDataTable`, and `PreviewTable` (grouped by original-column count, not sub-column count) each call `useContainerWidth()` themselves and compute their own `colWidth`/`totalWidth = ROW_N_W + numCols*colWidth`, applied as an explicit pixel `width` on the `<table>` (not a `%`) so the table's rendered width always exactly matches the sum of its declared column widths — few columns in a wide container get wide columns (up to `MAX_COL_W`) filling the available space; many columns clamp to `MIN_COL_W` and the table overflows its container, triggering the existing `overflow-x:auto` wrapper's horizontal scroll. Border/styling untouched (`borderCellStyle` helper unchanged).

**Known testing limitation, told to the user explicitly**: jsdom (Vitest's DOM environment) has no real layout engine — `clientWidth` is always `0` there, so the *visual* "does a 5-column dataset really get wider columns" behavior cannot be meaningfully asserted via the test suite. What *was* verified live: `computeColWidth` as a pure function (exported specifically for this) — `computeColWidth(900, 5)` returns something well above the old fixed 92px and below `MAX_COL_W`; `computeColWidth(900, 40)` clamps to exactly `MIN_COL_W=76`. The actual pixel-perfect visual result needs a real browser.

### 10.8 Apply → complete dataset → version → Redo lifecycle
```js
const handleApply = async () => {
  const res = await callEncoding('apply', { file_path: filePath, encoding_decisions, scaling_decisions })
  setNewPath(res.new_file_path)
  const merged = await callEncoding('profile', { file_path: res.new_file_path })  // <-- re-profile the APPLIED file
  setAppliedProfile(merged)
  if (registerVersion) await registerVersion('encoding', res.new_file_path, 'Encoding & Scaling', res.row_count)
  if (onUpdateData) onUpdateData({ cleanedFilePath: res.new_file_path })
  setApplied(true)
}
```
The "Complete New Dataset" table is **not assembled client-side** from the pending preview + original columns — it's a fresh `/encoding/profile` call against the file that Apply just wrote, so it's guaranteed to match exactly what's on disk (this was a deliberate design choice, not an oversight — assembling it client-side would risk drifting from reality, e.g. if a scaler produces slightly different values than the live preview did due to fit-on-full-column vs fit-on-preview-subset differences). **A real dataset version is created only once, at this point** — never on individual encode/scale preview clicks (those only call `/encode-column`/`/scale-column`, which don't touch versioning at all).

```js
const handleRedo = async () => {
  if (resetStep) await resetStep('encoding')   // real Django cascade-delete, not a client-side fake
  setEncChoices({}); setEncResults({}); setScaleChoices({}); setScaleResults({})
  setApplied(false); setNewPath(null); setAppliedProfile(null)
}
```
Because `resetStep` really deletes the Django `DatasetVersion` row, `getDisplayPath('encoding')` naturally falls back to the pre-encoding version again on the hook's next render, which changes the `filePath` this component computes via `useMemo`, which re-triggers the `useEffect([filePath])` that fetches `/encoding/profile` — so the page genuinely shows the pre-encoding dataset again with **zero special-case "restore" logic**. This was a deliberate design win worth preserving if this page is touched again: don't add manual state restoration for Redo, lean on the version system's own fallback chain.

### 10.9 Theme
Own copy of `DARK`/`LIGHT` tokens, **identical values** to `Diagnose.jsx`'s (teal/cyan `#2dd4bf` primary in dark, `#0d9488` in light) — reused, not reinvented, per explicit request to feel like part of the same app. **Defaults to dark** (`useState(true)`) — this is a deliberate one-off choice matching the user's dark-themed reference screenshot, and *differs* from `Diagnose.jsx`'s own default (light, `useState(false)`). Toggle button (`🌙 Dark` / `☀ Light`) reused from `TopNav`.

### 10.10 Removed
The "Continue to Feature Selection →" button and its `onNext('feature_selection', {})` call site no longer exist anywhere in this file — removed per explicit request (Feature Selection isn't built and won't be reachable from here).

### 10.11 Known gaps, not fixed, low priority right now
- `EncodingPage`'s own Redo modal clears local state and calls `resetStep`, but doesn't cascade-invalidate *downstream* steps (Sampling/Feature Selection) the way `Cleaning.jsx`'s `confirmBeforeAction` does for steps after Cleaning. Low-impact today since neither of those pages exists yet; worth revisiting once they do.
- `GuidanceSection`'s algorithm→scaler suggestion is illustrative only — it doesn't read the project's actual selected algorithm from anywhere (there's nowhere to select one yet).

### 10.12 How to view it live
Same three servers as always (see §15). Reach it via `http://localhost:5173` → Upload → Diagnose → "(dev harness) Skip to Cleaning page test →" → paste a real on-disk CSV path (e.g. `backend-fastapi/sample_data/sample.csv`'s absolute path) → Cleaning page loads → "(dev harness) Continue to Encoding page test →" at the bottom. `sample.csv` (256 rows, gitignored) has one categorical column (`Gender`, with some missing values) and four numeric columns (`Age`, `Glucose`, `BMI`, `Outcome`) — good for testing the encoding-lock behavior (only one column to encode) but not for testing many-categorical-column scenarios or the "small dataset gets wide columns" responsive behavior at a large column count. For testing small-dataset responsiveness, a throwaway 10-row/5-column CSV was used during this session (not saved anywhere persistent).

---

## 11. Bugs found and fixed this session — full detail

### 11.1 Outliers-tab bugs — verified already fixed, no new work needed
At the very start of this session, the user shared a claude.ai-authored analysis of 4 Cleaning-page Outliers-tab bugs (stale threshold carryover between columns, "Remove All" using sampled/stale data, histogram downsampling distortion, stale column badges after removal) along with a prescriptive implementation prompt. Investigation found **all 4 already fixed** in the current `cleaning_router_v2.py`/`Cleaning.jsx` (from an earlier session not covered by this doc's history). Verified live via curl against `sample.csv`: `profile-outliers-global` and the new `get-all-outlier-indices` endpoint's `per_column_counts` matched exactly; the union of outlier indices (15) was correctly *less than* the naive sum (16), proving real deduplication of a row flagged by two different columns; a full remove-all round trip correctly dropped exactly 15 rows; re-profiling the result showed new outliers emerging in `Glucose` — explained to the user as expected, sound statistical behavior (IQR bounds recompute against whatever data currently exists after removing extremes), not a bug resurfacing. No code was changed for this item — purely verification and reporting.

### 11.2 Dual-stack `localhost` → "Failed to fetch" (first occurrence)
User reported the Encoding page showed only `⚠ Failed to fetch` and nothing else. Diagnosis: this machine's `localhost` resolves to both `::1` and `127.0.0.1`; FastAPI/Django bind IPv4 only; confirmed directly via `curl -6 http://[::1]:8001/health` (connection refused) vs `curl -4 http://127.0.0.1:8001/health` (200 OK). **Dead end explored and abandoned**: `uvicorn --host ::` looked like the fix but is actually IPv6-*only* on this Windows/Python stack, not true dual-stack (confirmed live: switching to it broke IPv4 access entirely). **Real fix**: replaced every `http://localhost:PORT` in this codebase's frontend-facing/server-to-server URLs with the `127.0.0.1` literal — `frontend/src/api.js` (both baseURLs), `frontend/src/pages/Cleaning.jsx` (the `API` const), `frontend/src/pages/Encoding.jsx` (the `ML_API` const, written this way from the start once this bug was known), `backend-django/datasets/views.py` (the FastAPI profiling call). Added `127.0.0.1` origins alongside (not replacing) the existing `localhost` ones in both backends' CORS allow-lists. Saved as a standing rule in memory (`dual_stack_localhost_bug.md`, also mirrored in the "how to apply going forward" language embedded in this doc's §2 and §0's mojibake-adjacent tips): **any new file that adds a `localhost:PORT` URL to reach Django/FastAPI must use `127.0.0.1` instead, or add both.**

### 11.3 FastAPI unhandled-exception → CORS-header-less 500 → "Failed to fetch" (second, different occurrence)
User reported: clicking "Apply Scaling" opened what looked like a new blank page showing only `⚠ Failed to fetch`. This looked identical to §11.2 but was a **different root cause** (the §11.2 fix was already fully applied by this point) — the user explicitly asked to investigate properly rather than hide the error, which mattered, because the actual mechanism is genuinely two layered bugs:

1. **The real crash**: `handleApply` re-profiles the just-applied file to build the "Complete New Dataset" view (§10.8). That file's one-hot columns are `bool` dtype (pandas `get_dummies` default) → saved to CSV as literal `True`/`False` → `pd.read_csv` re-infers them as `bool` on the next read → `pd.api.types.is_numeric_dtype(bool_series)` is `True` → `infer_type()` (pre-fix) classified them as `"numeric"` → `suggest_scaler()` called `series.quantile()` on them → numpy's quantile interpolation does `b - a` on the two bracketing values, and subtraction isn't defined for numpy bool arrays → `TypeError: numpy boolean subtract, the - operator, is not supported...`. Found this by reading the actual FastAPI server's own log file, not by guessing.
2. **Why it became "Failed to fetch" instead of a normal error**: that exception was unhandled, so it propagated to Starlette's outermost `ServerErrorMiddleware` — which sits **outside** `CORSMiddleware` in the wrapping order. Its fallback response (`Internal Server Error`, plain text) never gets CORS headers attached, confirmed by direct comparison of response headers between a working call and the crash (working: `access-control-allow-origin` etc. present; crashing: absent, zero CORS headers). The browser then rejects that response as a CORS failure — not a clean HTTP error — and `fetch()` throws the generic `TypeError: Failed to fetch`, which is indistinguishable from the server being genuinely unreachable. This is a real, reproducible Starlette architectural behavior, not a misconfiguration; reordering `add_middleware` calls doesn't fix it. The only real fix is to never let an exception escape the route handler unhandled in the first place.

**Fix, both layers**: `infer_type()` now treats `bool` dtype as `"categorical"` (defensive — covers a genuine boolean column in a raw upload too, not just the one-hot chain). `apply_all()` now casts one-hot dummies to `.astype(int)` before saving (fixes the root cause at the source, plus a separate cosmetic True/False-vs-0/1 inconsistency noted earlier). `suggest_scaler()`'s quantile/IQR block wrapped in try/except as defense-in-depth. **Every endpoint in `encoding_router.py` wrapped in try/except → `HTTPException(500, ...)`**, matching the convention already used everywhere else in this codebase (`main.py`, `cleaning_router_v2.py`) — `encoding_router.py` was the one file missing it. Verified live: reproduced the exact original crash scenario (one-hot encode Gender + standard-scale BMI + Apply, then re-profile the result) — now returns 200 with proper CORS headers instead of 500 with none; the saved CSV now has `0`/`1` not `True`/`False`; separately tested a raw dataset with a genuine boolean column (`is_smoker: [True, False, ...]`) to confirm the defensive `infer_type` fix works generally, not just for the one-hot-output path. Also hit and resolved a process-management mess during this investigation — multiple orphaned/duplicate `uvicorn` instances lingering from earlier restarts across the session, one of them silently serving stale pre-fix code despite `netstat` showing only one clear listener; resolved with a full clean kill-and-restart sweep. **If this class of symptom recurs** (any action that "navigates away" to a blank page with just "Failed to fetch"), check the FastAPI server's own log/traceback first — the frontend is rendering faithfully; the real story is server-side. Saved to memory as `fastapi_cors_crash_bug.md`.

### 11.4 Two new RTL/Vitest testing pitfalls found while verifying the UI rewrite
Both now in memory (`testing_conventions.md`), both worth knowing before writing the next temporary test in this project:
- **RTL's default text matcher only reads an element's *direct* text-node children, not text inside nested elements** — unlike native `.textContent`, which recurses. A pattern like `<th>{label} <span>({annotation})</span></th>` (common in this codebase for a dimmed inline annotation) means no single queryable node's own text is ever `"label (annotation)"` combined — `getByText`/`queryAllByText` can never find it, no matter how long a `waitFor` runs. This looked *exactly* like a timing/slowness bug across several debugging rounds (bumping timeouts from 10s→15s→20s did nothing) before the real cause was found by comparing `document.body.innerHTML.includes(...)` (a raw string search, unaffected) against the RTL query result. Fix in the test, never the component: query native DOM directly — `Array.from(document.querySelectorAll('th')).some(el => re.test(el.textContent))`.
- **Mocks representing the same underlying real system must stay consistent with each other.** `registerVersion` and `getVersion` both come from one real `useVersionHistory` hook instance in production — one writes, the other reads the same state. A test with a static `getVersion={() => null}` alongside a `registerVersion` mock that "succeeds" makes correct component code (which reads `getVersion()` right after calling `registerVersion()`, exactly as the real hook supports) look broken. Fix: a small stateful stub — a shared `let currentVersion` that both mock functions read/write — mirroring the real hook, not a change to the component.

---

## 12. Documentation already written (`docs/`, local HTML files, not published Artifacts)
`ml_core_explained.html`, `ml_core_pipeline_steps_reference.html`, `fastapi_backend_explained.html`, `architecture_deep_dive.html` — all pre-existing, not touched this session or the one before it, still accurate for the parts that haven't changed (ml-core, `main.py`'s original endpoints, JWT/CORS mechanics though not the `127.0.0.1` specifics from this session). `architecture.md` — pre-existing, empty. **This file** — rewritten this session.

---

## 13. Recurring bug classes — read before writing any new backend endpoint or new cross-service URL

1. **NaN/numpy-type JSON serialization** (oldest, most-recurring class, 4+ occurrences across prior sessions): any endpoint returning raw pandas/numpy data must go through `json.loads(df.to_json(orient='records'))`, never `.to_dict(orient='records')` directly, whenever NaN might be present; scalar values from numpy comparisons/aggregates need explicit `int()`/`float()`/`bool()` casts. `encoding_router.py`'s `/profile` endpoint uses a *different*, also-safe pattern worth knowing about: `.fillna("").to_dict(orient="records")` — clearing NaN *before* calling `.to_dict()` sidesteps the crash too (verified this actually works cleanly, empirically, not just in theory).
2. **Dual-stack `localhost`** (this session, §11.2): any new `http://localhost:PORT` URL added to reach Django/FastAPI is a live landmine on this machine. Use `127.0.0.1`.
3. **FastAPI unhandled exceptions → CORS-header-less crash → "Failed to fetch"** (this session, §11.3): any new FastAPI router file must wrap every route handler body in try/except → `HTTPException`, no exceptions, or a real bug becomes an undebuggable dead end for whoever's using the frontend.

---

## 14. Pending / Not Yet Done

- **`JourneyMap.jsx` / real multi-page routing** — still doesn't exist. `App.jsx`'s Upload→Diagnose→Encoding→(loader)→Cleaning chain is still dev-harness-style. `WorkflowState.needs_redo_steps`'s ↺ visual indicator still has a data model and API but no page to render itself on.
- **Confirm the `Diagnose.jsx` uncommitted diff** (§3) — pre-existing, not authored by this session, still unreconciled.
- **Unify `cleaning_router_v2.py`'s/`encoding_router.py`'s helper duplication with `ml-core/cleaning.py`'s equivalents** (`check_normality`, `infer_type`-ish logic, etc.) — real duplication, accepted pattern in this codebase, not urgent.
- **`EncodingPage`'s Redo doesn't cascade-invalidate downstream steps** (§10.11) — low priority until Sampling/Feature Selection pages exist.
- **Every other journey-map page**: Sampling, Feature Selection, Training, Results, What-If Simulator UI, Reports. FastAPI backend endpoints for most of the ML-pipeline ones already exist in `main.py` (tested in an earlier session) — it's the React pages that don't exist.
- **Recharts v3 migration** — v2.x installed and works, upstream considers v2 unmaintained. Not urgent. (Note: `Encoding.jsx` doesn't use Recharts at all — its charts, if any are added later, would be a fresh decision.)
- **Nothing has been committed to git this session** — flag to the user if they seem to assume otherwise; see §3 for the exact current diff.

## 15. Quick-Reference: Running Everything

```
Terminal 1 (Django):   cd backend-django   && .venv\Scripts\Activate && python manage.py runserver 8080
Terminal 2 (FastAPI):  cd backend-fastapi  && .venv\Scripts\Activate && uvicorn main:app --port 8001 --reload
Terminal 3 (React):    cd frontend         && npm run dev
```
Django admin: `http://localhost:8080/admin`. FastAPI interactive docs: `http://localhost:8001/docs`. React: `http://localhost:5173`.

**Do NOT add `--host ::` to the FastAPI command** — it looks like a dual-stack fix but is IPv6-only on this machine's Windows/Python stack (§11.2). Plain `--port 8001` (IPv4-only, `127.0.0.1`) is correct and is what every frontend URL in this codebase now targets explicitly.

**If you restart FastAPI mid-session, check for orphaned processes first** — this session repeatedly hit confusion from duplicate/leftover `uvicorn` instances after restarts (one silently serving stale code while `netstat` seemed to show a clean single listener). Before assuming a code change isn't taking effect, run `Get-CimInstance Win32_Process -Filter "Name = 'python.exe'"` and check for more than one `uvicorn main:app` command line; kill all of them and start exactly one fresh instance if in doubt.

Dev auth for local testing (created by `App.jsx`'s `bootstrapDevProject()`): `cleaning_dev@example.com` / `dev-preview-pass-1234`, project name `"Cleaning Page Preview"` — auto-created/reused on every load.

**Testing convention — follow it**: write a temporary `*.test.jsx` file (Vitest + Testing Library) that renders real components against the **actually-running** FastAPI/Django dev servers (no mocking of fetch itself — only mock the version-history props when a component expects them), confirm it passes, then **delete the test file** — never committed. See §11.4 for the two newest pitfalls, and the standing list from earlier sessions: `el.closest('div')` self-matches when called on a `<div>` that already matches (use `.parentElement`); `getByText`/`queryAllByText` matches ancestors whose *concatenated* text contains the substring, not just the intended leaf (use `getByRole` with `{name}` for interactive elements, or a `{selector: 'span'}` restriction, or `getAllByText`+length-check for status text); RTL's text matcher does NOT reach into nested elements the way `.textContent` does (§11.4 — the opposite-direction version of the same general "text matching is not what you'd naively expect" theme); default `findByText`/`waitFor` timeouts (1000ms/1000ms) are shorter than some real endpoint calls in this codebase — pass explicit longer timeouts; state that updates optimistically can render before an async re-fetch from the same action resolves — wrap follow-up assertions in `waitFor`; background Vitest runs in this environment can take 15-60+ seconds for multi-network-call test files — use `run_in_background: true` on the Bash tool rather than a short foreground timeout.
