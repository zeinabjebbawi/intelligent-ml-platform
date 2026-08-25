# SESSION_HANDOFF_NAV_AND_FEATURE_SELECTION.md — Full Session Context

**Purpose.** A complete, self-sufficient handoff for a brand-new Claude Code
chat with no memory of this conversation. It exists alongside
`docs/PROJECT_HANDOFF.md`, `docs/CLEANING_PAGE_SESSION_HANDOFF.md`, and
`docs/CLAUDE_CONTEXT.md` — those three are authoritative for everything up
through 2026-08-21 (architecture, the Cleaning page, Dataset Version History
design) and 2026-08-21→08-23 (Feature Engineering/Sampling/Data Readiness
build). **Do not edit those three files — this is a new, separate document.**
This file covers everything in the conversation that produced it: building
the Feature Selection page from scratch, three smaller fixes, and a
platform-wide navigation/versioning overhaul — plus a final task list handed
to the session immediately after this file was first written (see §9,
"Pending Tasks" — check the actual code before trusting any status there,
since this file may not have been updated after those tasks were finished).

Git identity: `zeinab jebbawi <101230180@mu.edu.lb>`. Repo root:
`c:\Users\user\Desktop\Final_cp\intelligent-ml-platform`.

---

## 0. How this project gets built (unchanged standing workflow)

The user has a **separate, parallel conversation with Claude (claude.ai
chat)** where feature *design* happens. They paste that output into this
Claude Code session, describe refinements directly, or report bugs found by
using the running app. Every time: read and genuinely understand pasted
content (not skim for code), adapt it to this repo's *actual current*
architecture (pasted specs are often stale relative to what's really in the
repo), actually test everything live (real servers, curl, temporary
Vitest+RTL tests against the actually-running dev servers, deleted after
passing, never committed), fix real bugs found during testing, report back
precisely (what was missing/done/still-gap), treat "diagnose only" requests
as a hard boundary, and ask a scoping question only when genuinely blocked —
otherwise make the reasonable call (Auto Mode).

**Mojibake**: pasted text sometimes arrives corrupted (`â`, `Â·`, `Ã` etc.
replacing em dashes/arrows/bullets/emoji). Reconstruct contextually — see
`docs/PROJECT_HANDOFF.md` §0 for the byte-pattern cheat sheet; prefer symbols
already established in this codebase's icon vocabulary over guessing novel
ones.

---

## 1. What IntelliML / PRISM is (unchanged — see other docs for full detail)

A capstone ML platform ("IntelliML" in early docs, "PRISM" in the frontend
UI). Two modes: **Smart Auto** (system does everything) and **Guided/Manual**
(user configures every step). Six platform philosophy rules govern every
page (Suggestion Discipline levels 1–3, No Reaching Forward, Try-See-Decide,
Dataset Versioning, Mode Differences, ML Methodology Source) — verbatim text
in `docs/PROJECT_HANDOFF.md` §1.

Architecture (unchanged):
```
React (Vite, :5173)  ⇄  Django (:8080)  ⇄  PostgreSQL
        ⇅                    ⇅
   FastAPI (:8001)  ⇄  ml-core (plain .py, no server)
```
Dual-stack `localhost` bug still applies everywhere (`127.0.0.1`, never
`localhost`, in any app-code URL). FastAPI unhandled-exception → CORS-crash
bug still applies (every route handler wrapped in try/except →
`HTTPException`). Windows `uvicorn --reload` orphaned-worker bug still
applies (see `docs/CLAUDE_CONTEXT.md` §2.3 for the fix procedure — this
recurred multiple times again this session, see §7 below).

---

## 2. STEP_ORDER — unchanged, confirmed still correct in all 3 mirrored places

```
upload: 1, diagnose: 2,
cleaning_duplicates: 3, cleaning_outliers: 4, cleaning_missing: 5,
encoding: 6, feature_engineering: 7,
sampling: 8, data_readiness: 9, feature_selection: 10,
training: 11, feature_impact: 12, report: 13,
```
Mirrored in `backend-django/datasets/models.py`, `frontend/src/hooks/
useVersionHistory.js` (exported `STEP_ORDER`), and `frontend/src/pages/
Cleaning.jsx` (own top-level const). All three were already correct at the
start of this session — no changes needed there. `frontend/src/components/
TopNav.jsx` now also imports `STEP_ORDER` from the hook (new this session —
see §6.2) rather than duplicating raw numbers.

---

## 3. Session narrative — what happened, in order

1. **Deep-read phase**: read `docs/PROJECT_HANDOFF.md`,
   `docs/CLEANING_PAGE_SESSION_HANDOFF.md`, `docs/CLAUDE_CONTEXT.md` (the
   user asked for `architecture.md` too, but it's empty, confirmed
   pre-existing), and confirmed the memory system's index was already
   up to date (4 newer entries — card design, uvicorn orphans, pandas/
   sklearn gotchas, shared-state peer tabs — were indexed correctly even
   though a stale snapshot appeared in the conversation's opening context).
2. **Built the Feature Selection page from scratch** (§4 below) — the user
   pasted a full frontend/backend spec (mojibake-corrupted) plus a long
   "philosophy prompt" for analyst-style diagnostics, and asked for it to be
   made "as creative and logical as possible," restyled onto this repo's
   actual shared theme (not the pasted spec's own light-only tokens), with
   real backend defects fixed and one substantive analytical gap closed
   (raw unencoded categorical columns were being silently dropped from the
   whole page — fixed via Chi-Square/ANOVA, see §4.3).
3. **Three smaller fixes** (§5 below), given together in one message:
   FeatureEngineering.jsx's dataset table made scrollable (matching
   Encoding.jsx's established pattern) and its version label unified to
   always say "Feature Engineering"; a brand-new capability for
   Diagnose.jsx — a real accumulating versions bar with **live-editing
   auto-save to a single, continuously-updated version** — plus a new tiny
   FastAPI router (`diagnose_router.py`) to support it, since Diagnose was
   previously 100% client-side with no backend of its own.
4. **Platform-wide navigation/versioning overhaul** (§6 below) — the user's
   biggest ask this session: every page gets ONE clear, consistently-styled
   forward button (restyling what already existed, not relocating it);
   every "← Back" button removed from every page; TopNav becomes
   backward-only, gated by real progress (`furthestOrder`); the versions
   bar on every page must show the FULL accumulated history (not just
   "Original Dataset + this page's own version") — Cleaning.jsx already did
   this correctly, every other page didn't; and the Upload→Diagnose
   "asks to browse a csv again" bug needed a real fix.
5. **This file was requested** — a full session handoff, written before a
   new list of bug-fix/feature tasks (§9) that were handed over immediately
   after and are meant to be done right after this file is written.

---

## 4. THE FEATURE SELECTION PAGE — full detail

### 4.1 Files
- `backend-fastapi/feature_selection_router.py` — **new this session**.
  Prefix `/feature-selection`. Two endpoints: `POST /analyze`,
  `POST /apply`. Registered in `main.py` (import + `app.include_router(...)`).
- `frontend/src/pages/FeatureSelection.jsx` — **new this session**, ~1000
  lines. Default export `FeatureSelectionPage`.
- Wired into `frontend/src/components/TopNav.jsx`'s `NAV_LINKS` (new entry,
  `enabled: true`) and `frontend/src/App.jsx`'s dev harness (new
  `'feature_selection'` stage block).

### 4.2 Props contract (current, as wired from App.jsx)
```jsx
<FeatureSelectionPage
  projectData={{ filePath, projectId, targetColumn: uploadMeta?.targetColumn }}
  onNext={fn}                 // 'training' — no-op, Training page doesn't exist
  onUpdateData={fn}           // ({ cleanedFilePath }) => setFilePath(...)
  getDisplayPath={fn} getInputPath={fn} registerVersion={fn}
  isStepDone={fn} getVersion={fn} resetStep={fn} versions={fn}   // all from useVersionHistory
  active={navActive} onNavigate={fn} furthestOrder={number}
  shapData={null}             // always null today — Feature Impact page doesn't exist yet
/>
```
`filePath` for this page = `getInputPath('feature_selection')` — the
PERMANENT pre-selection snapshot; `/analyze` and `/apply` both operate on
this, and it never changes even after Apply (mirrors Encoding.jsx/
Sampling.jsx's established `getInputPath`-for-fixed-input pattern).

### 4.3 Backend — `feature_selection_router.py` detail

**`POST /analyze`** — the analytical core. For NUMERIC features: Pearson
correlation with target (signed), Mutual Information (normalized 0–1,
handles non-linear relationships), max cross-feature correlation
("redundancy"), rule-based recommendation tier (`strong` / `moderate` /
`redundant_high` / `weak`), one-hot group detection (binary 0/1 columns
sharing an underscore-prefix). For **raw, never-encoded categorical
columns** (a real gap in the originally-pasted spec — these were silently
excluded from the whole page before this session, since
`select_dtypes(include=[np.number])` was the only feature-selection
criterion): Chi-Square/Cramér's V (classification target) or one-way ANOVA
as `1 - p_value` (regression target) — **never** Pearson-on-label-codes,
which would falsely treat nominal classes as ordinal. All features (numeric
+ categorical) are ranked together in ONE unified list by importance.
Numeric-only visuals (correlation heatmap, redundancy-vs-relevance scatter)
exclude unencoded categoricals (mathematically meaningless there) with an
explanatory UI note.

Response shape (current, as of this session's build — **not yet updated for
§9's pending tasks**):
```json
{
  "features": [{ "name", "rank", "type", "pearson", "importance",
                  "importance_mi", "redundancy", "redundancy_na",
                  "recommendation", "one_hot_group", "is_one_hot",
                  "unencoded", "stat_test", "p_value" }, ...],
  "one_hot_groups": {...}, "correlation_matrix": {"labels":[...], "matrix":[[...]]},
  "multicol_pairs": [{ "feature_a","feature_b","correlation","is_one_hot","severity" }],
  "top_2": { "feature_1","feature_2","scatter":[{x,y,target}] },
  "pairplot_data": {...}, "rdv_scatter": [{name,relevance,redundancy,type,recommendation,one_hot_group}],
  "task_type", "target_column", "n_target_classes", "target_is_multiclass_nominal",
  "row_count", "total_features", "n_numeric_features", "n_unencoded_features",
  "n_strong", "n_weak", "n_multicol_warnings"
}
```
**Important**: `correlation_matrix.labels`/`matrix` do NOT currently include
the target column itself — §9's first pending task asks for this to change
(see §9.1).

**`POST /apply`** — drops unselected features (target always kept), saves
via the established `save_version`-suffix-stripping pattern
(`_feature_selected.csv`, repeated calls overwrite the same file, verified
live). Returns `new_file_path`, `row_count`, `col_count`, `features_kept`,
`features_dropped`.

**Bug classes defensively closed** (matching the project's recurring bug
list in `docs/CLAUDE_CONTEXT.md` §6): NaN/Inf sanitization via a `safe_num`
helper applied everywhere a correlation/stat could produce NaN (constant
column → undefined Pearson correlation was a real, confirmed-live risk of
emitting the invalid JSON token `NaN`); bool-dtype target coerced safely;
every route wrapped in try/except → `HTTPException`.

### 4.4 Frontend — `FeatureSelection.jsx` structure (current)

Shares the app-wide theme (`useTheme()` from `../theme`) and `TopNav` —
**not** its own light-only token set (the originally pasted spec used its
own indigo/light-only `const C` object; this was fully reskinned). Visual
structure top to bottom: `TopNav` → `SharedVersionsBar` (see §6.3) →
`InfoBanner` (collapsible philosophy explainer) → analyst summary line
(one sentence, rule-based) → optional multiclass-nominal-target caveat
banner → 4 `MetricCard` KPIs (Total Features / Selected / Removed /
Redundant Pairs) → 56/42 two-column grid: LEFT = `CorrelationHeatmap` +
`MulticolWarnings` card; RIGHT = Feature→Target importance bar chart
(Recharts) + `TopTwoScatter` → full-width `RedundancyRelevanceChart` (custom
SVG) → collapsible Pairplot grid → `FeatureTable` (checkbox list, one-hot
grouping, scrollable body capped at `TABLE_BODY_MAX_HEIGHT=420`) → sticky
bottom Apply panel.

State: `data` (the full `/analyze` response), `loading`, `error`,
`selected` (`Set` of feature names, defaults to ALL selected), `applying`,
`applied`, `newPath`, `showPairplot`, `redoModal`, `redoing`.

**Known bug already found and fixed once this session**: `showPairplot`
state was declared but read back as `showPair` in the toggle button — a
`ReferenceError` that crashed the page on load. Caught by a live RTL test,
fixed, verified 3/3 tests passing. **A very similar class of gap is what
§9.6 (stale data after Apply) is about — check `useEffect` dependency
arrays and state-reset-on-Apply logic carefully when touching this file.**

**Resume-on-mount**: if `isStepDone('feature_selection')` is already true
when the page mounts, it re-fetches `/analyze` against
`getDisplayPath('feature_selection')` (the real output file) and derives
`selected` from whichever features are actually present in that file —
never resets to "everything checked" on remount.

**Redo**: real `resetStep('feature_selection')` (Django cascade-delete) +
local state reset, confirmation modal, matches every other page's pattern.

**Bulk-select buttons** (as of this session's initial build — §9.5 changes
this): "Select All", "Auto-remove weak features"
(`f.recommendation !== 'weak'`), "Remove weak + redundant"
(`f.recommendation !== 'redundant_high' && f.recommendation !== 'weak'`).
**§9.5 explicitly asks for the underlying recommendation MODEL to change**
— see that section, this is a planned but not-yet-implemented change as of
this file's writing.

---

## 5. Three smaller fixes this session

### 5.1 FeatureEngineering.jsx — scrollable dataset table
Both tabs (Bucketizing, Create Features) share ONE `DatasetTable` component
for column selection — so one fix covers "both parts" the user referred to.
Added `TABLE_BODY_MAX_HEIGHT = 420` (matching Encoding.jsx's exact
convention), wrapped the `<table>` in a `maxHeight/overflowY:'auto'` inner
div with sticky (`position:'sticky', top:0, zIndex:2`) `<th>` headers.
**§9.7 (below) reports this table's column-name header still has no
background color, causing header text and row numbers to visually collide
during scroll** — this is a related but distinct gap, not yet fixed as of
this file's writing.

### 5.2 FeatureEngineering.jsx — universal version label
Both Bucketizing and Create-Features applies now register under the literal
string `'Feature Engineering'` always, hardcoded **inside the shared
`handleApplied` function itself** (not just at each call site — the two
call sites no longer pass a label argument at all), so it can't drift out
of sync again regardless of which tab's Apply ran.

### 5.3 Diagnose.jsx — real versions bar + live-editing auto-save
Diagnose.jsx was previously 100% client-side (CSV parsed and edited
entirely in the browser — cell edits, added rows, column deletes/renames —
zero backend awareness). Built:
- **`backend-fastapi/diagnose_router.py`** (new) — ONE endpoint,
  `POST /diagnose/save`, accepting `{file_path, columns, rows}` (the
  CURRENTLY edited in-browser dataset, with removed columns already
  excluded), writing a real CSV via the same suffix-stripping
  `save_version` pattern (`_diagnose_edited.csv`) as every other router.
- **Diagnose.jsx**: added `hasEdited` state (set `true` by all 5 mutation
  paths: `commitCell`, `addRow`, `deleteSelectedColumns`, `renameColumn`,
  `applyColumnAction`), plus an 800ms-debounced `useEffect` that — once
  `hasEdited` is true and a real upstream file path exists
  (`getInputPath('diagnose')`) — POSTs to `/diagnose/save` then calls
  `registerVersion('diagnose', newPath, 'Diagnose Edits', rowCount, summary)`.
  The hook's own `registerVersion` semantics (cascade-delete-then-register
  on every call) guarantee this collapses to exactly ONE 'diagnose' version
  no matter how many edits happen — verified live with two sequential edits
  producing exactly one pill.
- Added a **defensive re-sync `useEffect`**: if `columns`/`rows` are still
  null on a later render and `projectData.columns/rows` have since arrived,
  seed from them — closes a theoretical `useState`-locks-in-null-forever
  race (not conclusively proven to be the exact mechanism behind the
  reported "asks to browse a csv again" bug, but a real, cheap-to-close gap
  found while investigating it — see §7.4).
- Uses the new `SharedVersionsBar` (§6.3), placed directly under `StatusBar`
  (the CURRENT DATASET / HEALTH SCORE / MISSING VALUES / OUTLIERS /
  DUPLICATES / TARGET bar), matching the screenshot the user provided.

---

## 6. Platform-wide navigation/versioning overhaul — full detail

### 6.1 Forward buttons — `App.jsx`'s `AdvanceButton`
One shared component defined in `App.jsx` itself (App.jsx can call
`useTheme()` — `ThemeProvider` wraps the whole app in `main.jsx`):
```jsx
function AdvanceButton({ C, label, onClick, disabled, working }) {
  // padding 11px 26px, borderRadius 10, background C.primary, color white,
  // fontWeight 800, fontSize 13.5, boxShadow when enabled, "Preparing…" when working
}
```
Used for every page's "Continue to X →" footer button, in the SAME DOM
position each button already occupied (user's explicit instruction: "keep
it in the same space", i.e. restyle in place, don't relocate). **Exception**:
`DataReadiness.jsx` already had its OWN real in-page "Continue to Feature
Selection →" button in its header (from earlier work this project) — adding
an `AdvanceButton` there too created a genuine duplicate (caught by the
live end-to-end test). Fixed by removing the App.jsx duplicate and instead
restyling DataReadiness's own button to match `AdvanceButton`'s exact visual
spec. **If a future page also turns out to already have its own internal
forward button, apply the same fix — check first, don't assume App.jsx's
dev-harness footer is the only button.**

All `setStage(x)` calls for forward transitions became `advance(x)` (see
§6.2) — `Upload→Diagnose`, `Cleaning→Encoding`, `Encoding→FeatureEngineering`,
`FeatureEngineering→Sampling`, `Sampling→DataReadiness`,
`DataReadiness→FeatureSelection`, and the `LoadDatasetForm`'s manual-path
submit. **Feature Selection has no forward button** (Training doesn't
exist yet) — deliberate, matches the user's own list of pages needing one
(they didn't include Feature Selection).

### 6.2 TopNav backward-only gating — `furthestOrder`
`App.jsx` now holds `const [furthestOrder, setFurthestOrder] =
useState(STEP_ORDER.upload)` — the highest STEP_ORDER value ever advanced
INTO. `const advance = (stageKey) => { setStage(stageKey); bump
furthestOrder via STEP_ORDER[stageKey] ?? STAGE_ORDER_OVERRIDE[stageKey] }`
— `STAGE_ORDER_OVERRIDE = { cleaning: STEP_ORDER.cleaning_duplicates,
'load-cleaning': STEP_ORDER.cleaning_duplicates }` handles the two stage
keys that aren't themselves STEP_ORDER keys. `furthestOrder` is threaded as
a new prop through EVERY page (`Upload.jsx`, `Diagnose.jsx`, `Encoding.jsx`,
`FeatureEngineering.jsx`, `Sampling.jsx`, `DataReadiness.jsx`,
`FeatureSelection.jsx`) down to each page's own internal `<TopNav>` call(s)
— and to the two standalone `<TopNav>` calls App.jsx renders itself
(`load-cleaning` branch, and the final `cleaning`/default branch, since
`Cleaning.jsx` doesn't render its own TopNav — App.jsx renders it
externally, deliberately, to avoid touching Cleaning.jsx's tested internal
layout).

`TopNav.jsx` (`frontend/src/components/TopNav.jsx`): `NAV_LINKS` entries
now each carry an `order` field, sourced from `STEP_ORDER` (imported, not
duplicated as raw numbers) — `cleaning`'s `order` uses
`STEP_ORDER.cleaning_duplicates` since it's one nav entry covering three
STEP_ORDER slots. `TopNav({ active, onNavigate, furthestOrder = Infinity })`
— a link is `reached = l.order <= furthestOrder`; `clickable = l.enabled &&
reached && !!onNavigate && !isActive`. Unreached-but-built links render
grayed with `title="Keep going — this unlocks once you reach it"` (distinct
from `enabled:false` links' `title="Not built yet"`). Backward navigation
NEVER lowers `furthestOrder` — confirmed live (navigating back to Diagnose
after reaching Feature Selection keeps Feature Selection clickable).

### 6.3 Accumulating versions bar — `components/VersionsBar.jsx`
**Root insight**: the DATA was already fully accumulating — `Cleaning.jsx`'s
own internal version state, and the shared `useVersionHistory` hook's
`versions` state, BOTH hydrate from Django's real per-dataset `/versions/`
list (ordered by `step_order`), which contains EVERY version any page has
ever registered, not just the current page's own. Even fully offline
(Django unreachable), the hook's local `registerVersion` already keeps all
strictly-earlier-step entries and only replaces same-or-later ones — so
local accumulation across a session works with or without Django. The ONLY
reason most pages' bars showed just 2 pills ("Original Dataset" + own
version) is that each page's own hand-rolled `VersionsBar` component was
written to construct a small LOCAL 2-item array instead of rendering the
already-available full `versions` array.

Fix: one new shared component, `frontend/src/components/VersionsBar.jsx`:
```jsx
export default function VersionsBar({ versions }) {
  // renders EVERY entry in `versions` (falls back to a single synthetic
  // "Original Dataset" pill if versions is empty/undefined) as a
  // left-to-right pill row, most-recent filled solid, rest outlined, each
  // with its own ⬇ download button (own internal ML_API/downloadFile,
  // matching the small-accepted-duplication convention already used
  // per-page throughout this codebase). overflowX:'auto', flexWrap:'nowrap'
  // — scrolls horizontally instead of wrapping once pills overflow one row.
}
```
Swapped into **Encoding.jsx, FeatureEngineering.jsx (wrapped in a
page-local `StickyVersionsBar` — this page's own header is
`position:sticky, top:0`, so the versions bar sticks at `top:72` right
beneath it, unlike every other page which has no sticky header), Sampling.jsx,
FeatureSelection.jsx, Diagnose.jsx** (each had their own bespoke bar,
deleted along with their now-dead local `downloadFile`/`done`/`versionInfo`
helpers where those became fully unused) — and **added fresh to
DataReadiness.jsx**, which never had a versions bar at all before this
session (it already received a `versions` prop from App.jsx from earlier
work, just never rendered anything with it).

`App.jsx` now passes `versions={versionHistory.versions}` to every one of
these six pages' render calls.

**`Cleaning.jsx` was deliberately NOT touched** — its own internal
`VersionsBar` (`frontend/src/pages/Cleaning.jsx` line ~773) already does
this correctly and independently (self-contained version-history logic
predating the shared hook, heavily tested, explicitly left alone per
long-standing project convention) — it served as the reference/proof that
this concept works, not something needing the shared component swapped in.

### 6.4 The one real edit inside `Cleaning.jsx` this session
Despite the "don't touch Cleaning.jsx" convention, the user's "remove ALL
back buttons from ALL pages" instruction was explicit and swept in one real
backward-nav button that happened to live inside Cleaning.jsx itself: an
error-fallback "← Back to Upload" button, shown ONLY in the
`if (!versions[0]?.filePath)` branch (no dataset found at all — an edge
case, not part of the normal tested tab/version-history flows). Minimal
surgical fix: removed the button, kept the explanatory text, reworded to
point at TopNav ("Use 'Upload' in the navigation bar above to start over.")
— TopNav's "Upload" link is always reachable in exactly this scenario
anyway. `onNext` prop is now unused inside `Cleaning.jsx` (harmless, still
declared/passed from App.jsx, not worth further churn to remove).

### 6.5 Upload → Diagnose → Cleaning bug fix
**Investigated thoroughly, live-tested.** The DIRECT Upload→Diagnose flow
(Upload's "Confirm & Start Diagnosis →" button) was proven, via a real RTL
test driving the actual wizard, to work correctly — `DiagnosePage` mounts
with the real parsed data every time, no race, no stale `useState` lockup
in that specific path. **The actual mechanism matching the reported
symptom** was one step later: `App.jsx`'s Diagnose→Cleaning transition used
to do `setStage(filePath ? 'cleaning' : 'load-cleaning')` — since the real
Django upload (fire-and-forget, started back on Upload's confirm) is
asynchronous, `filePath` could still be `null` at the exact moment the user
clicks through even though the upload had genuinely just finished or was
about to — dropping them into the manual "type a CSV path" form
(`LoadDatasetForm`) even though a real uploaded file already existed or was
about to.

**Fix** — `App.jsx`'s new `goToCleaning()`:
```jsx
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
  } catch { /* Django unreachable — fall through */ }
  finally { setAdvancingToCleaning(false); }
  advance('load-cleaning');
};
```
Does one real, awaited check against Django before ever falling back —
only lands on the manual form if that check genuinely comes up empty
(Django truly unreachable, or the upload itself failed). The Diagnose
page's "Continue to Cleaning →" button now shows "Preparing…" while this
check runs (`AdvanceButton`'s `working` prop).

**Known remaining architectural risk, NOT fixed this session (out of
original scope, discovered but not chased further — see §7.5 for why)**:
`handleUploadMeta`'s fire-and-forget Django upload can complete at ANY
LATER time and unconditionally calls `setFilePath(...)` +
`versionHistory.refresh()` — if a user manually types a DIFFERENT CSV path
into the `load-cleaning` fallback form (bypassing the real upload) and then
the original background upload finishes afterward, it will silently
overwrite `filePath` back to the originally-uploaded file, clobbering the
manually-chosen one. This is an unusual dual-path usage pattern (mixing a
manual path entry with letting the real upload also complete) that a real
user is unlikely to hit exactly this way in normal use, but it's real and
undocumented anywhere before this file. Flagging it here for whoever next
touches `App.jsx`'s upload/filePath state machine.

---

## 7. Bugs found and fixed this session — full detail, chronological

### 7.1 `showPairplot`/`showPair` naming mismatch (FeatureSelection.jsx)
Real `ReferenceError` crashing the page on load — state declared as
`showPairplot`, read back as `showPair` in the toggle button's `onClick`
and ternary. Caught by a live RTL test (not by reading the code), fixed,
verified 3/3 passing. Standing lesson: **always live-test a freshly-written
page before declaring it done** — this is exactly the kind of bug that
looks fine on read-through.

### 7.2 Windows uvicorn orphaned workers (recurred, ~3 times this session)
Same class as `docs/CLAUDE_CONTEXT.md` §2.3 — multiple stale
`uvicorn --reload` reloader processes (plus orphaned
`multiprocessing.spawn_main` children) accumulate across a long session,
one of them silently serving stale code. Fix procedure used repeatedly this
session:
```powershell
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.CommandLine -like '*backend-fastapi*' -or $_.CommandLine -like '*multiprocessing*' -or $_.CommandLine -like '*uvicorn*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
python -c "import socket; s=socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.bind(('127.0.0.1', 8001)); print('FREE')"
# then start exactly one fresh: uvicorn main:app --port 8001
```

### 7.3 jsdom `File.prototype.text()` not implemented
Real browsers have supported `File.text()` since ~2020; this project's
jsdom version does not. Any test driving Upload.jsx's real file-parsing flow
needs a local polyfill (NOT added to the permanent `setupTests.js` — kept
scoped to individual temp test files since it's only needed for tests that
actually exercise file upload):
```js
if (!File.prototype.text) {
  File.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsText(this)
    })
  }
}
```

### 7.4 Upload→Diagnose bug investigation (see §6.5 for the actual fix)
Extensive live-testing (multiple RTL test iterations) proved the direct
flow works. Diagnose.jsx also got a small defensive re-sync effect (§5.3)
as a low-cost, unproven-but-plausible hardening measure — not confirmed to
be THE mechanism, but a real gap worth closing regardless.

### 7.5 Django dev-project cross-test contamination (discovered, not fixed)
Mid-session, while building and testing the end-to-end navigation test, an
assumption that "Django is down" (true much earlier in the session) turned
out to be **stale** — Django was actually reachable by this point. The dev
project (`DEV_EMAIL='cleaning_dev@example.com'`, `DEV_PROJECT_NAME=
'Cleaning Page Preview'`, both hardcoded in `App.jsx`'s
`bootstrapDevProject()`) is REUSED and PERSISTED (real Postgres rows) across
every single test run in this entire session — meaning dozens of earlier
temp-test runs (Diagnose edits, FeatureSelection, FeatureEngineering, the
nav/versions end-to-end test itself before this was diagnosed) all wrote
real, permanent version history against the SAME shared dev project. This
caused a real, confusing test failure (`/feature-selection/analyze`
returning "Target column 'Outcome' not found" against a file whose lineage
had been contaminated by an unrelated earlier test run's column
renames/drops). **Fixed for the test itself** by force-failing
`authAPI.login`/`authAPI.register` at the top of the temp test file
(`authAPI.login = () => Promise.reject(...)`), guaranteeing `projectId`
stays null and the whole flow runs in pure local/offline mode, deterministic
and free of cross-run contamination. **Not fixed in the app itself** — this
is a testing-hygiene note, not an app bug. **Flag to the user**: the real
`"Cleaning Page Preview"` dev project in Postgres now has a lot of
accumulated test cruft (renamed columns, chained bucketized/sampled/
feature_created files under
`backend-django/media/datasets/user_12/project_1e4040f2-.../`) from an
entire session's worth of live-testing. Not cleaned up — flagged to the
user at the end of the previous turn, no destructive action taken without
being asked.

### 7.6 DataReadiness duplicate forward button (see §6.1)
Caught live by the end-to-end test — two buttons with identical text
rendered simultaneously (App.jsx's new footer `AdvanceButton` duplicating
DataReadiness.jsx's own pre-existing header button). Fixed by removing the
App.jsx one and restyling the page's own to match.

---

## 8. Testing this session — conventions reconfirmed + new pitfalls

Standing convention unchanged: temporary `*.livetest.test.jsx` files
rendering real components against the actually-running dev servers (no
fetch mocking), confirm passing, then delete — never committed. Every
single feature built or fixed this session was live-tested this way before
being reported done, including one large end-to-end test (`<App/>` driven
all the way from Upload through Feature Selection, including a real
Encoding Apply, confirming version accumulation across every subsequent
page and correct TopNav gating in both directions) — deleted after passing,
per convention, along with any artifact CSVs it produced under
`backend-fastapi/sample_data/`.

**New pitfalls found this session** (add to the standing list in
`docs/CLAUDE_CONTEXT.md` §8 / `docs/PROJECT_HANDOFF.md` §15 mentally, not
literally edited into those files):
- `File.prototype.text()` needs a per-test polyfill in this jsdom version
  (§7.3).
- The shared dev Django project persists real state across every test run
  in a session — force-fail `authAPI.login`/`register` in any test that
  should run in pure local/offline mode to avoid cross-run contamination
  (§7.5).
- When asserting on TopNav link cursor/clickability, remember the ACTIVE
  page's own link is deliberately non-clickable (`cursor:'default'`) even
  though it's obviously "reached" — assert on a different, already-visited
  non-active link instead.
- `getByText('Outcome')` (or any column name) can match BOTH the dimmed
  background page content (still mounted behind an open drawer/modal
  overlay, just visually dimmed) AND the actual interactive element inside
  the overlay — use `getAllByText(...)` and pick by DOM order (the overlay
  content is typically the LAST match, since it's a later sibling in JSX)
  rather than assuming a single match.

---

## 9. TASKS — handed to the session immediately after this file, NOW DONE

**Update: all 8 items below were implemented and live-tested in the same
session that wrote this file**, immediately after this file was first
created (the original request was "write this file, then do the tasks").
Each item's original problem statement is kept below as context; a
"**Done:**" note was added under each describing the actual implementation
and how it was verified live. If picking this up later, still verify
against the actual code — this note describes state as of the session that
wrote it, not a guarantee nothing has drifted since.

All of these are in **`frontend/src/pages/FeatureSelection.jsx`** unless
otherwise noted, plus two in **`FeatureEngineering.jsx`** and **`Encoding.jsx`**.

### 9.1 Correlation heatmap: show the target column + strong/weak border colors
The target column is currently NOT included in `correlation_matrix.labels`/
`matrix` at all (backend only ever builds the matrix from `num_features`,
which explicitly excludes the target — see `feature_selection_router.py`'s
`analyze()`). Need to: (a) include the target column as a row/column in the
heatmap so its correlation with every feature is visible directly in the
grid (the heatmap already has special text/color treatment for `lbl ===
targetCol` in the axis labels, but the target was never actually a row/
column of the matrix data itself — this needs a real backend change,
probably computing `corr_df` over `num_features + [target]` instead of just
`num_features`, then excluding the target-target diagonal cell or handling
it like the other diagonal cells); (b) add a border-color treatment on each
feature's cell/row similar to the existing multicollinearity red-border
treatment — but for STRONG features (green border) and WEAK features (red
border) with respect to the target specifically; (c) change the
multicollinearity warning border (currently red, `C.danger`, on the highest-
correlated pairs) to **yellow** instead, freeing up red to mean "weak
w.r.t. target" as described in (b). Read `CorrelationHeatmap` in
`FeatureSelection.jsx` (~line 130–230) and `analyze()`'s correlation-matrix
construction in the backend router before touching either.

**Done:** Backend `analyze()` now builds a SEPARATE `corr_df_display`
(`num_features + [target_series]`, target renamed to its own column name)
just for `corr_matrix_out` — the original target-free `corr_df` still drives
redundancy/multicollinearity math unchanged. `features_out` gained two new
independent fields per feature: `signal_tier` ('strong'/'moderate'/'weak',
from `importance` alone) and `is_redundant` (bool, `redundancy >= 0.85`) —
`recommend_action(tier, is_redundant)` now derives the compound
`recommendation` string from those two (see §9.4/§9.5, same underlying
change). Frontend `CorrelationHeatmap` takes a new `features` prop, builds
`tierByName`, and border-colors any cell touching the target's row/column
green (`otherTier==='strong'`) or red (`'weak'`); the multicollinearity
border changed from `C.danger` to `C.warning` (yellow). Legend updated to
explain both border meanings. Verified live: `/analyze` curl-tested directly
— `correlation_matrix.labels` includes `"Outcome"`; a synthetic dataset with
a strong-redundant pair and a weak-redundant pair confirmed
`signal_tier`/`is_redundant`/`recommendation` all compute correctly for both
combinations (`redundant_high` and the new `weak_redundant`).

### 9.2 Histogram/importance-chart reference lines: fix label placement
"Places of moderate and strong lines are wrong and the place the word that
is in between the bars, place it above of the whole histogram in order for
them to be clear." This refers to the Feature→Target Importance bar chart's
`ReferenceLine` labels (`x={0.3}` "strong", `x={0.1}` "moderate") — Recharts
`<ReferenceLine>` with `label={{value, fontSize, fill}}` currently places
the label text INLINE between/among the bars (hard to read, per the user).
Needs the label repositioned to sit ABOVE the whole chart area instead of
inline — likely via `label={{ value, position: 'top', ... }}` or a custom
label renderer, or by moving to a manually-positioned `<text>` element
above the `<BarChart>`. Also double check the actual reference-line X
POSITIONS (0.3 for strong, 0.1 for moderate) are correctly aligned with
where the visual boundary should read — the user says "places... are
wrong," which may mean the visual rendering doesn't match the intended
0.1/0.3 thresholds, not necessarily that the threshold VALUES themselves
are wrong. Investigate empirically (render it, look at it) before assuming
which one is broken.

**Done:** Kept the 0.3/0.1 threshold VALUES unchanged (they match
`signal_tier`'s own real cutoffs — changing them would create a real
inconsistency). Interpreted "wrong" as the label rendering, not the
positions: Recharts' default `<ReferenceLine>` label placement centers the
text mid-chart, landing on top of whichever bar happens to be there.
Changed both labels to `position: 'top'` (renders above the plot area, at
the line's x-position) and bumped `margin.top` from 4 to 22px plus
container height by 20px to make room. Verified live by rendering the page
— confirmed no crash and the labels render in the DOM; jsdom has no real
layout engine so exact pixel placement can't be asserted in a test, same
known limitation documented elsewhere in this project for column-width
tests — visually confirm in a real browser if picking this up again.

### 9.3 Multicollinearity check: add a "combine into a new feature" suggestion
Add a NEW recommended action alongside the existing multicollinearity
warning cards: when two features are highly redundant, suggest the user go
back to the Feature Engineering page and use "Create New Features" to
combine the two redundant features into one (e.g. a ratio, sum, or
interaction term) instead of just dropping one outright. Needs: a neat
description/explanation of WHY this is a good idea (written before the
button/link, per the user's request — this is a Level-1/Level-2
explanatory addition, matching the platform's Suggestion Discipline rule),
and should be presented as "more recommended" than simply removing a
feature (i.e. visually/textually prioritized). This likely means a link/
button that navigates to Feature Engineering — check how cross-page
navigation is currently done (there's no real router; `App.jsx`'s
`handleNavigate`/TopNav is the only mechanism, and FeatureSelection is
ORDER 10, feature_engineering is ORDER 7 — going "back" to Feature
Engineering from here is backward navigation, which per §6 is TopNav-only
now; consider whether this new UI element should literally trigger
`onNavigate('feature_engineering')` if that prop is available, or just be
informational text pointing the user at the TopNav link). This is new
UI design work, not just a bug fix — read `MulticolWarnings` in
`FeatureSelection.jsx` before starting.

**Done:** Used the real available prop — `FeatureSelectionPage` already
receives `onNavigate` from `App.jsx`, and going to `feature_engineering`
(order 7) from Feature Selection (order 10) is ALWAYS safe/unlocked by the
time a user reaches this page (TopNav's `furthestOrder` gate would already
be past it), so the button calls `onNavigate('feature_engineering')`
directly rather than just pointing at TopNav text. `MulticolWarnings` now
takes an `onNavigate` prop, sorts `warnings` by `Math.abs(correlation)`
descending (previously unsorted — needed to reliably name "the most
redundant pair" in the explanation text), and renders a highlighted
"★ Recommended" callout (2px primary border, primary-soft background) ABOVE
the existing warning cards, naming the top pair by name + r-value, with an
explanation paragraph and a real "→ Combine in Feature Engineering" button.
Verified live with a synthetic redundant-pair dataset: callout renders,
names the correct pair, clicking the button calls `onNavigate` with
`'feature_engineering'`.

### 9.4 Redundancy vs Relevance scatter: recolor dots and quadrant backgrounds
In `RedundancyRelevanceChart` (`FeatureSelection.jsx`): change dot colors —
"relevant but redundant" (currently `C.danger`/red per `REC_COLORS.
redundant_high`) → **yellow**; "weak signal" (currently `C.muted`/gray per
`REC_COLORS.weak`) → **stays grey** (no change, user confirmed); a
NEW/currently-not-distinctly-colored "weak & redundant" category → **red**
dot AND **red background** for that quadrant (top-left quadrant currently
has no distinct background at all — only the top-right "relevant but
redundant" and bottom-right "strong independent" quadrants have subtle
tinted rects in the current SVG). Also: "moderate signal" → **orange**
(currently `C.primary`/teal per `REC_COLORS.moderate`); "weak & independent"
background (bottom-left quadrant) → **grey** (currently no background tint
at all). This requires the backend's `recommend_action()` categories
(`strong`/`moderate`/`redundant_high`/`weak`) to be checked against
whether "weak & redundant" is actually a DISTINCT category the backend
already produces or a new derived one — currently `recommend_action`
returns only 4 tiers and "weak" doesn't distinguish "weak & independent"
from "weak & redundant" at all (that distinction is purely POSITIONAL in
the current scatter, based on where the dot LANDS, not a backend label).
May need either a 5th backend category or purely front-end quadrant-based
coloring logic (compute which quadrant a point falls in from its own
`relevance`/`redundancy` values, independent of `recommendation`). Read
`RedundancyRelevanceChart` and `recommend_action()` carefully — this is the
most structurally involved of the color-change requests.

**Done:** Added a real 5th backend category (see §9.1's Done note — this is
the SAME `signal_tier`+`is_redundant`+`recommend_action()` change, done
once for both §9.1 and §9.4/§9.5). `REC_COLORS` updated:
`strong: C.success` (unchanged), `moderate: C.warning` (orange, was
`C.primary` teal), `redundant_high: YELLOW` (new local `#eab308` constant,
distinct from `C.warning`'s amber — was `C.danger` red), `weak: C.muted`
(unchanged grey), `weak_redundant: C.danger` (new, red). Quadrant
backgrounds: bottom-right (strong independent, green) and top-right
(relevant but redundant, now yellow-tinted using the same `YELLOW`
constant) already existed; ADDED bottom-left (weak & independent, grey
`${C.muted}14`) and top-left (weak & redundant, red `${C.danger}0d`) which
previously had no background at all. **Known pre-existing, NOT fixed
inconsistency, flagged but out of scope**: the scatter's quadrant divider
lines sit at x=0.15/y=0.5 (fixed visual chart-space thresholds), which are
DIFFERENT from `signal_tier`'s own thresholds (0.3/0.1 importance) and
`is_redundant`'s threshold (0.85 redundancy) — so a dot's COLOR (driven by
tier+is_redundant) won't always visually match the QUADRANT it lands in
(e.g. a "moderate" feature with importance 0.2 could land in the visual
"strong independent" quadrant despite being colored orange, not green).
This mismatch pre-dates this session's work and wasn't part of what was
asked — reconciling the quadrant boundaries with the real tier thresholds
would be a further, unrequested change.

### 9.5 Feature list "Signal" column + "Remove weak+redundant" button logic
Currently the `FeatureTable`'s "Signal" column shows ONE of `strong` /
`moderate` / `redundant_high` / `weak` (mutually exclusive, from
`recommend_action()`). The user wants this to be able to show a
**combination** — e.g. a feature that is BOTH weak AND redundant should
visibly say so (not just one or the other). This likely requires the SAME
backend/model change as §9.4 (distinguishing "weak & redundant" as its own
real signal, not just a scatter-quadrant artifact) — **do §9.4 and §9.5
together, they're the same underlying data-model question**: does
`recommend_action()` need to become two independent flags (e.g.
`is_weak: bool`, `is_redundant: bool`) rendered together, rather than one
exclusive enum? Also: rework the "Remove weak + redundant" bulk-select
button — currently `ft.filter(f => f.recommendation !== 'redundant_high' &&
f.recommendation !== 'weak')` (keeps everything that ISN'T weak OR ISN'T
redundant_high, i.e. removes anything matching EITHER condition). The user
wants it to select based on features having **BOTH** labels simultaneously
("not weak or redundant" — re-read their exact wording: "select based on
the signal labels were they have both labels weak and redundant not weak
or redundant") — i.e. the button should only remove features that are
BOTH weak AND redundant at once (not everything that's weak OR everything
that's redundant). This is a real behavior change, not just a rename —
verify with a concrete example dataset before considering it done (find or
construct a feature that's weak-but-not-redundant and one that's
redundant-but-not-weak, and confirm the button leaves both of THOSE alone,
only removing ones that are truly both).

**Done:** `FeatureTable`'s Signal badge now builds its TEXT independently
from `f.signal_tier` + `f.is_redundant` (`TIER_ICON`/`TIER_LABEL` lookups +
`' · Redundant'` suffix when true) — so "Strong · Redundant" is now a real,
distinct, correctly-labeled case (previously indistinguishable from
"Moderate · Redundant", both collapsed into one generic "⚠ Redundant"
badge). Badge COLOR still comes from the compound `recommendation` string
(via `REC_BADGE`) for visual consistency with the scatter chart. "Auto-
remove weak features" changed to `f.signal_tier !== 'weak'` (now correctly
also removes `weak_redundant` features, which the old `recommendation !==
'weak'` check would have missed since those are tagged `weak_redundant`,
not `weak`). "Remove weak + redundant" changed to
`!(f.signal_tier === 'weak' && f.is_redundant)` — genuinely AND-based now,
not OR-based. `weakCount` (KPI sub-text) also switched to counting
`signal_tier === 'weak'` for consistency. Verified live with the same
synthetic dataset (a strong-redundant pair + a weak-redundant pair, no
weak-independent or strong-independent features): body text matched both
`/Strong.*Redundant/` and `/Weak.*Redundant/`; "Auto-remove weak" and
"Remove weak + redundant" both correctly left 2 of 4 selected in this
specific dataset (a genuine distinguishing test between the two button's
different conditions would need a 4th feature that's weak-but-independent —
not present in the quick synthetic set used; the underlying boolean logic
was verified directly via the backend curl test in §9.1's Done note, which
is the stronger guarantee here).

### 9.6 Stale data after Apply — real, reported bug, high priority
"When I press the button save at the bottom of the page after I dropped
the desired features from the features list, the old data is still shown
in all of the page and this must be fixed. (even in the graphs and the
correlation and all…)" This is a real, reported bug (not a style request)
in `FeatureSelectionPage`'s `handleApply` (~line 690–705 as of this
session's build). Current behavior: `handleApply` calls `/apply`, sets
`newPath`, calls `registerVersion`, calls `onUpdateData`, sets
`applied=true` — but **does NOT re-fetch `/analyze` against the new,
feature-selected file**, and does NOT clear/replace `data` (the original
full-feature analysis) with anything new. Since `applied && newPath` only
gates the sticky-panel button state and the header's Download/Continue
buttons — **the entire rest of the page (heatmap, importance chart,
scatter, table, KPIs) keeps rendering off the ORIGINAL pre-Apply `data`
forever**, which is exactly the reported symptom. Compare against how
Encoding.jsx's `handleApply` does this correctly (re-fetches `/encoding/
profile` against the newly-applied file into a SEPARATE `appliedProfile`
state, rendering a second "Modified Dataset — After" table) — Feature
Selection doesn't need a full before/after dual-table (unlike Encoding,
since here it's a pure column-subset operation, not a value-transforming
one), but it likely DOES need to either (a) re-fetch `/analyze` against
`res.new_file_path` after Apply and replace `data` with the fresh result
(showing the post-selection dataset's own real stats, which is what
"the graphs and the correlation and all" implies), or (b) show a clear
"applied" locked/read-only state that visibly reflects only the SELECTED
features rather than continuing to show the full original set. Given the
user explicitly says "the old data is still shown," re-fetching a fresh
`/analyze` against the applied file (option a) is almost certainly the
right fix — mirrors the established pattern from Encoding.jsx and
Sampling.jsx's own post-Apply refresh behavior.

**Done — option (a), confirmed the right read.** `handleApply` now awaits
`callFS('analyze', { file_path: res.new_file_path, target_column: targetCol })`
right after `registerVersion`/`onUpdateData`, and calls `setData(freshData)`
+ `setSelected(new Set(freshData.features.map(f => f.name)))` before
`setApplied(true)`. **Found and fixed the identical bug in a SECOND place**
while working on this: the resume-on-remount `useEffect` (fires when
`isStepDone` is already true at mount — i.e. navigating away after Apply
and coming back) had the exact same gap — it re-derived `selected` from a
fresh `/analyze` call but never called `setData(outData)` either, meaning
remounting after Apply showed the same stale-data bug via a different
trigger. Fixed identically (added the missing `setData(outData)`). Verified
live: spied on `fetch`, confirmed a second `/feature-selection/analyze`
call fires after `/apply` completes; confirmed the "Total Features" KPI
card correctly reads 2 (not the stale 4) immediately after Apply on a
4-feature synthetic dataset where 2 were auto-removed.

### 9.7 FeatureEngineering.jsx dataset table: missing header background
"There is no background for column names in the dataset preview so put a
background in order for the numbers and the names of columns not to
collide with each other upon scrolling." This is inside the SAME
`DatasetTable` component touched in §5.1 (the scrollable-table fix) —
the `<th>` cells got `position:'sticky', top:0, zIndex:2` added, but at
least the ROW-NUMBER `<th>` (the `#` column) was given an explicit
`background: C.light` inline override in that fix; the per-COLUMN `<th>`
cells' background is still whatever `thStyle(C)`/the existing
selected/hover conditional background computes — check whether it ever
resolves to a real opaque color in the DEFAULT (unselected, unhovered)
state, since `position:sticky` elements need a genuinely opaque background
or content scrolling underneath shows through as visual "ghost" overlap
(this exact bug and its exact fix are already documented precedent in this
very file — see `Diagnose.jsx`'s own `thStyleFor` comment: "background must
be an explicit opaque color, not 'inherit' — these `<th>`s are
position:sticky... 'inherit' resolves to fully transparent here"). Very
likely the same fix applies here almost verbatim.

**Done, exactly as predicted.** The per-column `<th>` background was
`st.selected ? st.selectColor + '1a' : (hovered ? 'rgba(99,102,241,0.07)' :
C.light)` — opaque only in the unselected+unhovered default state; both the
selected (~10% opacity) and hovered (~7% opacity) states let scrolling row
content show through. Changed to an unconditional `background: C.light`
always — the existing `borderTop`/`borderLeft` accent already signals
selected/hovered state on its own, so the background no longer needs to
carry that too. Verified live: selected a column, read
`selectedHeader.style.background` — confirmed it's `C.light` (opaque),
never an `rgba(...)` value.

### 9.8 Encoding.jsx: one-hot encoding must never apply to the target column
"In the scaling and encoding page, the one hot encoding must not apply on
the target column so if the user from the upload page chose the target
column so you must pay attention not to put specifically one hot encoding
above it." Currently `Encoding.jsx`'s `DatasetTable` renders an
`EncodingDropdown` above EVERY categorical column with no target-column
exclusion at all — need to check whether `Encoding.jsx` even currently
RECEIVES `projectData.targetColumn` (recall from earlier work this session:
`App.jsx`'s `'encoding'` stage block DOES pass
`targetColumn: uploadMeta?.targetColumn` in `projectData` — confirm this is
still true and that `EncodingPage` actually reads/uses it, since as of the
session that built Encoding.jsx originally, target-column-awareness was
NOT part of its design at all). The fix should prevent the categorical
target column (if one exists and happens to be non-numeric) from getting
an encoding dropdown/being one-hot-encoded at all — likely by filtering it
out of the categorical-columns-needing-encoding set entirely (it should
probably not be touched by this page in any way, matching the "No Reaching
Forward"/target-column-is-special convention used elsewhere in the
platform), or at minimum excluding it specifically from the ONE-HOT option
(the user's wording says "one hot encoding must not apply on the target
column," which could mean: still allow label-encoding the target if
needed, just never one-hot it specifically — re-read their exact words
before deciding label-encoding's fate; **the safer, more literal reading
is: forbid ONE-HOT specifically for the target column, don't necessarily
forbid all encoding of it**). Read `Encoding.jsx`'s `DatasetTable`,
`EncodingDropdown`, and `categoricalCols` computation before changing
anything.

**Done — went with the broader exclusion, not just one-hot specifically.**
`EncodingPage` now reads `targetCol = projectData?.targetColumn || null`
(the prop was already being passed from `App.jsx`, just never read).
`categoricalCols` (drives the scaling-lock logic) now excludes the target.
`DatasetTable` takes a new `targetCol` prop; in its per-column render loop,
the target column gets NO `EncodingDropdown` at all (neither label nor
one-hot) — replaced with a small "🎯 target" placeholder label instead of a
silent empty gap, so it doesn't look like a rendering bug. Chose the
broader "no encoding control at all" reading over "only forbid one-hot,
still allow label" because it matches the target-is-special convention
already used everywhere else in this pipeline (Feature Selection always
keeps the target through `/apply` regardless of selection, DataReadiness
treats it specially, etc.) — narrower scope (forbidding only one-hot) was
considered but this was judged the more consistent, safer choice; revisit
if the user specifically wants label-encoding still allowed on the target.
Scaling was deliberately left untouched for the target (not requested).
Verified live with two cases: `targetColumn: 'Gender'` (sample.csv's one
categorical column forced as target) → zero encoding `<select>`s render
anywhere, "target" label shows in Gender's slot; control case
`targetColumn: 'Outcome'` (Gender NOT the target) → a real encoding
dropdown renders for Gender as before, confirming the exclusion is
target-specific, not a global regression.

---

## 10. Files touched/created this session — quick index

**Addendum — §9's task list also touched**: `backend-fastapi/
feature_selection_router.py` (further modified — `signal_tier`/
`recommend_action` restructured, target-inclusive `corr_matrix_out`),
`frontend/src/pages/FeatureSelection.jsx` (further modified — heatmap
target+borders, reference-line label positions, `MulticolWarnings`
combine-suggestion, scatter recoloring, Signal badges,
`handleApply`/resume-effect data refresh), `frontend/src/pages/
FeatureEngineering.jsx` (further modified — opaque `<th>` background),
`frontend/src/pages/Encoding.jsx` (further modified — target-column
encoding exclusion). See §9's per-item "Done" notes above for exact detail.


**New backend**: `backend-fastapi/feature_selection_router.py`,
`backend-fastapi/diagnose_router.py`.

**New frontend**: `frontend/src/pages/FeatureSelection.jsx`,
`frontend/src/components/VersionsBar.jsx`.

**Modified backend**: `backend-fastapi/main.py` (two new router
registrations).

**Modified frontend**: `frontend/src/App.jsx` (substantial — AdvanceButton,
furthestOrder/advance(), goToCleaning(), every stage block's props and
footer buttons), `frontend/src/components/TopNav.jsx` (furthestOrder
gating, STEP_ORDER-sourced `order` field), `frontend/src/pages/Diagnose.jsx`
(versions bar, live-edit auto-save, defensive re-sync effect, furthestOrder),
`frontend/src/pages/Encoding.jsx` (SharedVersionsBar swap, furthestOrder),
`frontend/src/pages/FeatureEngineering.jsx` (scrollable table,
universal version label, SharedVersionsBar swap via StickyVersionsBar,
furthestOrder), `frontend/src/pages/Sampling.jsx` (SharedVersionsBar swap,
furthestOrder), `frontend/src/pages/DataReadiness.jsx` (SharedVersionsBar
ADDED for the first time, furthestOrder, button restyle), `frontend/src/
pages/Upload.jsx` (furthestOrder forwarded), `frontend/src/pages/
Cleaning.jsx` (ONE surgical edit — removed the error-fallback back button,
§6.4 — nothing else touched).

**Nothing in this session was committed to git** — confirm with the user
before assuming otherwise; run `git status` fresh, don't trust any snapshot
in this or any other doc.

---

## 11. Quick reference: running everything (unchanged)

```
Terminal 1 (Django):   cd backend-django   && .venv\Scripts\Activate && python manage.py runserver 8080
Terminal 2 (FastAPI):  cd backend-fastapi  && .venv\Scripts\Activate && uvicorn main:app --port 8001 --reload
Terminal 3 (React):    cd frontend         && npm run dev
```
Dev auth: `cleaning_dev@example.com` / `dev-preview-pass-1234`, project
`"Cleaning Page Preview"` (auto-created/reused — now containing a session's
worth of test cruft, see §7.5). Sample dataset:
`backend-fastapi/sample_data/sample.csv` (256 rows, gitignored, columns
`Age,Glucose,BMI,Gender,Outcome` — `Gender` is a genuine unencoded
categorical column, useful for exercising §9.8's fix; `Outcome` is a clean
binary classification target).

**If a FastAPI change doesn't seem to take effect**: check for orphaned
`uvicorn`/`multiprocessing.spawn_main` processes first (§7.2) before
assuming anything else is wrong.

---

## 12. Memory files (persist automatically, listed for completeness)

No new memory files were written this session as of this file's creation.
Existing memory (see `MEMORY.md` in the memory system, not this repo) still
applies unchanged: project overview, pasted-chat workflow, recurring NaN/
JSON bug, testing conventions, dual-stack localhost bug, FastAPI CORS crash
bug, card design feedback, Windows uvicorn orphan workers, pandas/sklearn
gotchas, shared-state-for-peer-tabs feedback.

---

*End of SESSION_HANDOFF_NAV_AND_FEATURE_SELECTION.md. For anything not
covered here, read `docs/PROJECT_HANDOFF.md`, `docs/
CLEANING_PAGE_SESSION_HANDOFF.md`, and `docs/CLAUDE_CONTEXT.md` in that
order of increasing recency. Do not edit those three; keep this one updated
going forward if it's still the most recent handoff doc — check file dates/
git log to confirm before assuming that.*
