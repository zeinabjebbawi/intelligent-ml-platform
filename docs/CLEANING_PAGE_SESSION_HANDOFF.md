# Cleaning Page & Dataset Version History — Full Session Handoff

**Purpose of this document.** This is a companion to `docs/PROJECT_HANDOFF.md`, not a replacement. `PROJECT_HANDOFF.md` is maintained across multiple sessions (including sessions other than this one) and, as of its 2026-08-21 rewrite, deliberately **compresses** its Cleaning-page section down to a short summary ("unchanged this session, summary only... full detail lives in this doc's git history") because that other session's own work (the Encoding & Scaling page) was its focus. That compression is *expected and correct behavior for that document* — but it means the fine-grained detail of how the Cleaning page and the Dataset Version History system were actually built is not fully preserved there any more. **This document exists specifically to preserve that detail**, because the user asked for it explicitly.

**Read both documents.** `PROJECT_HANDOFF.md` is still the authoritative source for current overall project state (git status, what other pages exist, the dual-stack `127.0.0.1` bug, the FastAPI CORS-crash bug, the Encoding page). This document is the deep reference for one specific, large piece of work: the Dataset Version History + Step Memory system, and the Cleaning page that was built on top of it, entirely produced across this one long conversation.

**One important cross-check already done**: another session, after this conversation's work was already in place, independently re-verified via live curl testing that all the Outliers-tab bug fixes described in §5 below were "already fixed" and working — see `PROJECT_HANDOFF.md` §11.1. That's external confirmation this conversation's work is real, current, and correct as of the end of this conversation. That other session also changed exactly **one line** in `Cleaning.jsx` (the `API` constant, `http://localhost:8001` → `http://127.0.0.1:8001`, for the dual-stack `localhost` bug documented in `PROJECT_HANDOFF.md` §11.2) — nothing else in the file was touched by anyone but this conversation.

---

## 1. Chronological narrative — what happened, in order

This conversation started with the user asking for a full, line-by-line understanding of the entire repository (every Django file, every FastAPI file, all of `ml-core/`, the frontend as it existed then) before any work began. That initial deep-read is what all the subsequent decisions in this conversation were built on.

Then, across several installments, the user drove the following arc:

1. **A large combined request**: photos showing the desired look of the Duplicates/Outliers/Missing Values tabs, two pasted documents (a `cleaning_router_v2.py` backend spec, and a long `CleaningPage_ClaudeCode_Prompt.md` describing a full visual redesign of the Cleaning page), *plus* a separate, large feature request — in the user's own words, paraphrased — for a way to navigate backward through the workflow steps and always see the correct dataset version, redo an earlier step with downstream work properly invalidated, and not have repeated actions pile up duplicate versions. This last part came with the user's own back-and-forth with a separate claude.ai conversation about the design, and a full Claude Code implementation prompt for a **Django-backed** version history system (as opposed to a frontend-only one).
2. Because this bundled a small UI-redesign task with a much larger full-stack architecture decision, this conversation used the scoping-question tool to ask the user directly: implement the redesigned Cleaning.jsx plus a full Django backend for version history, or a frontend-only/local-state version, or just the Duplicates tab first. **The user explicitly chose "Full stack: Cleaning.jsx + Django Version History/Step Memory."** This is why the version history system lives in real Postgres-backed Django models, not just React state — that was a deliberate, explicit choice, not an assumption.
3. Built the entire feature (§2 below) and the entire redesigned Cleaning page (§3–§5 below) in one large pass, verified live end-to-end.
4. **Refinement round — a real, user-discovered bug**: after using the finished page, the user reported that performing a step's action didn't show its own results — the tab kept showing the *previous* step's data. The user had also discussed this with their other claude.ai conversation and pasted that conversation's diagnosis and a Claude Code prompt. This conversation implemented the real fix (§6 below: `getFilePath` → `getDisplayPath`, the register-version overwrite/cascade rule, `isStepDone`, a real `RedoWarningModal`). In the *same* message, the user also asked for Missing-tab layout changes (side-by-side graphs, vertical bar chart, non-rotated matrix labels, a specific heading text change) — also implemented in this round.
5. **A second refinement round**: three more specific UI requests (Duplicates preview must never disappear + a duplicates-only toggle; the Outliers-per-column chart must collapse instead of disappearing when a column is selected; the Missing tab's two charts must be a genuine 50/50 split) — implemented (§7 below). **In the same message**, the user explicitly asked for something different in kind: a list of Outliers-tab bugs (incomplete "Remove All", non-live threshold updates, an "odd" changing histogram, a count mismatch between the column list and the remove button) with the explicit instruction *"I don't want you to do anything on the platform or code, just... tell me exactly what is happening."* This was honored as a hard boundary — root causes were found and confirmed via temporary throwaway diagnostic tests, reported in detail, and **zero production code was touched** for that part (§8 below documents exactly what was found).
6. **Immediately after**, the user pasted a second, independent analysis (again from their other claude.ai conversation) that reached the same root-cause conclusions and this time asked for the fixes to be implemented, with its own Claude Code prompt. That prompt's proposed code diffs assumed an outdated shape of `Cleaning.jsx` (variables/function signatures like `setVP`, a 2-argument `onVersionCreated`, and a "Remove All" implementation that read from the PCA scatter sample — none of which matched the actual current code, because the actual code had already evolved past that point earlier in this same conversation). This conversation implemented the *real intent* of all four fixes adapted to the actual current code, not the literal pasted diffs (§9 below).
7. This document is the result of the user's final request in this conversation: preserve everything above in a new, standalone file (not editing `PROJECT_HANDOFF.md`), to hand to a fresh chat alongside that file.

---

## 2. The Dataset Version History + Step Memory system (Django + React)

### Why it exists
Before this feature, the Cleaning page tracked dataset versions as a simple locally-appended array with no real backend persistence, and had no concept of "redo an earlier step and invalidate what came after." The user wanted: navigating back to any step always shows the correct upstream dataset; redoing a step warns about and cleans up invalidated downstream work; repeating an action never silently piles up duplicate versions; and user settings (thresholds, chosen methods) survive a page refresh. The user explicitly chose the full Django-backed implementation over a lighter frontend-only alternative.

### Canonical step ordering
Defined identically in two places — **keep them in sync if you ever add a step**:
- `backend-django/datasets/models.py`, module-level `STEP_ORDER` dict (also aliased as `DatasetVersion.STEP_ORDER`).
- `frontend/src/pages/Cleaning.jsx`, a top-level `STEP_ORDER` const.

*(A third copy, `frontend/src/hooks/useVersionHistory.js`, was added later by a different session for the Encoding page — see `PROJECT_HANDOFF.md` §7 if touching that. `Cleaning.jsx` does **not** use that hook; its version-history logic is entirely self-contained, by original design, and was left that way deliberately when the hook was extracted later, because `Cleaning.jsx`'s implementation was already heavily tested.)*

```python
upload=1, diagnose=2,
cleaning_duplicates=3, cleaning_outliers=4, cleaning_missing=5,
encoding=6, sampling=7, feature_selection=8,
training=9, feature_impact=10, report=11,
```

### Django model changes (`backend-django/datasets/models.py`, `backend-django/projects/models.py`)

**`DatasetVersion`** gained:
- `step_name` (CharField) — e.g. `"cleaning_outliers"`.
- `step_order` (IntegerField, `editable=False`) — **auto-derived inside `save()`** via `STEP_ORDER.get(step_name, 99)`. Never set this field directly; it's computed every save.
- `version_label` (human-readable, e.g. `"Outliers Removed"`, `"Duplicate Removed"`, `"Incomplete Rows Dropped"`, `"Missing Values Imputed"`).
- `file_path` — **renamed from the old `storage_path`** field name.
- `file_size`, `row_count`, `col_count`.
- `summary` (JSONField) — a step-specific result blob, e.g. `{"rows_removed": 87}` or `{"per_column_counts": {...}}`.
- The old `version_type` field (and its fixed choices) was **removed entirely**, superseded by `step_name`.
- `Meta.ordering = ['step_order', 'created_at']`.

**`WorkflowState`** gained:
- `needs_redo_steps` (JSONField list) — steps invalidated by a cascade delete.
- `step_settings` (JSONField dict) — **replaces** the old `step_data` field. Caches per-step user choices (thresholds, chosen imputation methods), keyed by step group name, e.g. `{"cleaning": {"z_threshold": 2.8, "missing_methods": {...}, "row_threshold": 14}}`.
- `current_step` changed from a fixed-choices enum to a plain free-text `CharField(max_length=50)`, because it now needs to hold fine-grained step names like `"cleaning_duplicates"`, not just the old small enum.

Migrations were generated and **actually applied** to the live dev Postgres database (`platform_ml`) during this conversation — `datasets/migrations/0002_alter_datasetversion_options_and_more.py`, `projects/migrations/0002_remove_workflowstate_step_data_and_more.py`. There was no production data to preserve at the time (`Dataset.objects.count()` was 0), so this was a clean drop+recreate of the affected columns, not a data-preserving rename.

### New Django endpoints
`backend-django/datasets/version_views.py` + `version_urls.py`, mounted in `core/urls.py` at `/api/projects/<uuid:project_id>/versions/...` (alongside, not overlapping, the pre-existing `upload_urls.py` mount):

| Endpoint | Method | Behavior |
|---|---|---|
| `/versions/` | GET | Full version history for the project's active dataset (the most-recently-uploaded `Dataset` row for that project). |
| `/versions/for-step/<step_name>/` | GET | Returns the version a given step should use as **input**: the most recent version with `step_order` strictly `<` this step's order. Falls back to the project's original uploaded file if none exists. |
| `/versions/register/` | POST | Registers a new version. **Self-heals**: if the project has no `Dataset` row yet at all, it lazily creates one by reading the file being registered — this matters because the dev harness's "paste a CSV path" flow bypasses Django's real upload endpoint entirely, so a brand-new dev project genuinely has zero `Dataset` rows until the very first version registration. |
| `/versions/cascade/<step_name>/` | DELETE | Deletes every version with `step_order >= step_name`'s order; removes those step names from `WorkflowState.completed_steps` and adds them to `needs_redo_steps`. |
| `/versions/<version_id>/download/` | GET | Streams that version's file, authenticated. **Not actually used by the Cleaning page UI** — the versions bar's download buttons go through FastAPI's simpler, unauthenticated `/cleaning/download` endpoint instead, since every version already has a concrete on-disk path FastAPI can stream directly without needing a Django round trip. This Django endpoint still works for any other API consumer, it's just unused by this particular UI. |

Plus `WorkflowStateView` (GET/PATCH) in `backend-django/projects/views.py`, mounted at `/api/projects/<uuid:project_id>/workflow/`. The PATCH handler **deep-merges `step_settings` one level deep, at the per-key level** — e.g. patching `{"cleaning": {"z_threshold": 2.8}}` merges just that key into the existing `cleaning` sub-object, it never overwrites the whole `step_settings` dict wholesale. This was verified live and matters: without it, saving Outliers-tab settings would silently wipe out already-saved Missing-tab settings, since both live under the same `"cleaning"` key.

All of the above was verified **live**, not just written and assumed correct: curl-based tests confirmed correct version chaining across steps, cascade-delete correctly trimming `completed_steps` and populating `needs_redo_steps`, the settings deep-merge actually merging rather than overwriting, cross-user access correctly returning 404 (not 403 — consistent with the `get_object_or_404(..., user=request.user)` pattern used everywhere else in this Django codebase, so as not to reveal that a resource exists), and the self-heal `Dataset` auto-creation working on a project with zero prior uploads.

### Frontend integration
Lives entirely inside `frontend/src/pages/Cleaning.jsx`'s `CleaningPage` component (bottom of the file) — see §4 below for the exact functions and their full bug-fix history.

---

## 3. THE CLEANING PAGE — overview

`frontend/src/pages/Cleaning.jsx`, default export `CleaningPage`. Called as:
```jsx
<CleaningPage
  projectData={{ filePath, projectId, cleanedFilePath? }}
  onNext={fn}
  onUpdateData={fn}
/>
```

**There is no "Proceed"/"Back" navigation anywhere in this file, by explicit, repeated user request.** Each tab's own primary action button (Remove Duplicates, Remove Outliers, Apply/Drop-rows-below-threshold) *is* the forward motion. When another session later needed a way to navigate from Cleaning to a new Encoding page, they deliberately put that "Continue to Encoding" button in `App.jsx`'s dev harness, **not** inside `Cleaning.jsx`, specifically to respect this rule — worth knowing if this file is touched again and something wants to add a "next" button. Don't.

The page brands itself "PRISM · STAGE 3" via its own sticky header (§4.1) — it no longer shows an old "Step 5 of 11" label from a prior design iteration.

### 3.1 Backend — `backend-fastapi/cleaning_router_v2.py`, prefix `/cleaning`

This file replaced an older `cleaning_router.py` (v1), which was **deleted** this conversation. `main.py`'s import line was updated to `from cleaning_router_v2 import router as cleaning_router`.

**Bug caught and fixed during transcription from the pasted spec**: the spec's `profile_duplicates` handler used `.to_dict()` directly on DataFrame rows, which crashes on NaN — this exact bug class has recurred multiple times across this whole project's history (see `PROJECT_HANDOFF.md` §13.1). Fixed before it ever shipped, by round-tripping through `json.loads(display_df.iloc[[i]].to_json(orient='records'))[0]` instead, and adding the `import json` the pasted spec's import list had omitted.

Full endpoint table, current as of the end of this conversation:

| Endpoint | Method | Behavior |
|---|---|---|
| `/cleaning/profile-duplicates` | POST | Full row preview (first 2000 rows) with `_is_dup`, `_dup_group` (`"g1"`, `"g2"`, …), `_is_first_in_group` per row; top-level `total_dup_rows`/`total_groups`/`real_duplicates`. |
| `/cleaning/remove-duplicates` | POST | Drops all duplicates, saves `..._dup_removed.csv`. |
| `/cleaning/profile-outliers-global` | POST | Per-column normality test (Shapiro-Wilk n≤5000 / D'Agostino-Pearson n>5000) → suggests zscore/iqr per column, at a **fixed 3.0σ / 1.5×IQR threshold**, always — this endpoint has no threshold parameter at all. Also PCA (2 components) + IsolationForest on a 600-row sample (for the scatter/index-score plots only — not used for outlier removal any more, see §9), and `n_zscore_cols`/`n_iqr_cols`. |
| `/cleaning/profile-outliers-column` | POST | Full detail for one column: stats + default bounds, suggested method + p-value, all true-outlier rows plus up to 1500 randomly-sampled (fixed `seed=42`) non-outlier rows (`all_values`), and a server-computed **full-dataset** `histogram` field (`np.histogram` over the complete column — this is now actually used by the frontend, see §9 item 3). |
| `/cleaning/get-all-outlier-indices` | POST | **Added this conversation** (§9 item 4/"Fix 2"). Computes every numeric column's outlier row indices in **one pass against the original, untouched file** — same suggested-method-at-fixed-default logic as `profile-outliers-global` — and returns the **union** of all outlier indices plus a `per_column_counts` breakdown. Backs the "Remove All Outliers" button. |
| `/cleaning/remove-outliers` | POST | Drops a caller-provided list of row indices. **The `column` field in the request body is accepted but never actually used to filter anything in the handler** — confirmed by reading the code directly — so passing a placeholder value like `"__all_columns__"` when removing a cross-column union is safe. |
| `/cleaning/profile-missing-global` | POST | Bar-chart data per column, a missing-value matrix (sampled to 250 rows), row-completeness distribution, `complete_rows`/`complete_rows_pct`/`cols_with_missing`. |
| `/cleaning/apply-row-threshold` | POST | `df.dropna(thresh=min_present)`. |
| `/cleaning/apply-missing-column` | POST | Per-column imputation: mean / mode / knn / interpolation / drop_rows / drop_column. |
| `/cleaning/download` | GET | Streams a CSV by file path, unauthenticated — this is what the entire Cleaning page UI uses for every download, including the versions-bar pills. |

`save_version()` (shared helper) strips known suffixes (`_dup_removed`, `_outliers_removed`, `_missing_imputed`, `_rows_filtered`) before appending the new one, so chained operations never produce absurdly long filenames.

---

## 4. Every shared UI building block, and why it's shaped the way it is

All defined near the top of `Cleaning.jsx`, roughly in this order:

- **`C`** — design tokens object. Indigo `#6366f1` primary, amber/red/green severity colors, `C.slate = '#334155'` used deliberately for a couple of "active" controls (the IQR/Z-Score toggle in `MethodSelector`, the row-threshold "Drop rows below threshold" button) — this dark color choice was matched to a specific photo the user provided and approved, not an arbitrary pick.
- **`StripPlot`** — hand-rolled SVG strip plot for a column's individual outlier points, click-to-toggle-keep. Carried over unchanged.
- **`MissingMatrix`** — hand-rolled SVG missing-value matrix (missingno-style). Carried over mostly unchanged, **except its sizing was fixed this conversation** — see §7 item 3.
- **`computeOutliers(allValues, method, zThresh, iqrMult, stats)`** — pure client-side function that recomputes which values count as outliers given the current threshold. Unchanged throughout. This is the mechanism that makes the per-column detail view's threshold slider feel instant (Try-See-Decide rule — no API call on slider drag).
- **`MissingBarChart`** — new this conversation. Standard **vertical** column bar chart (not horizontal), one bar per column, green/amber/red by missing severity.
- **`OutlierColumnBarChart`** — new this conversation. Horizontal per-column outlier-count bars, click to drill into a column. Accepts a `compact` prop (narrower label column, hides the Z/IQR method badge) for use inside the narrow collapsible rail added in §7 item 2.
- **`CompletenessBar`** — new this conversation. Small green/amber/red progress bar, replaces the old plain "Status" text column in the Missing tab's per-column imputation table.
- **`ExpandableChart`** — new this conversation. Wraps a chart/table with a small "⤢" button that opens a full-screen modal copy of the exact same content. The same `children` are rendered twice in the DOM when expanded (once inline, once in the modal) — this is intentional, matches the pattern from the originally-pasted design spec, and means each copy gets fully independent React state, which is why nothing special had to be done to make the modal copy work correctly.
- **`CollapsibleRail`** — new this conversation, extracted mid-way through (originally this logic was hardcoded inline inside what used to be called `ColumnPanel`). Generic: expanded state renders a labeled card of a given `width`; collapsed state renders a `28px`-wide vertical pill with the `label` prop rotated onto it via `writingMode: 'vertical-rl'`. Takes `isOpen`/`setIsOpen` from its caller, so multiple independent rails can exist side by side, each with its own open/closed state — this is exactly what §7 item 2 needed.
- **`ColumnListItems`** — new this conversation. Just the `<div>` list of column names + count badges, no wrapper chrome around it — designed to be placed inside a `CollapsibleRail`.
- **`ColumnPanel`** — refactored this conversation into a thin wrapper: `<div flex row><CollapsibleRail label="Columns">...<ColumnListItems/>...</CollapsibleRail><div flex:1>{children}</div></div>`. **`MissingTab` still uses this wrapper as-is.** **`OutliersTab` no longer uses it at all** — see §7 item 2 for exactly what it uses instead and why.
- **`MethodSelector`** — new this conversation. Shows the column name and its Shapiro-Wilk/D'Agostino normality result on the left; IQR/Z-Score toggle buttons (dark, per the approved photo reference) plus the threshold slider and an explanatory caption on the right, all in one card.
- **`InfoWidget`** — new this conversation. Collapsed by default: a pulsing amber "i" circle plus "Click to see analysis notes." Expands inline to show the tab's explanatory text. The exact wording shown per tab was specified by the user, quoted from a reference photo for Duplicates and Outliers, written to match the established tone for Missing.
- **`StatCard`** — new this conversation. Big-number stat tile (label/value/subtitle/color), used in a CSS grid at the top of every tab.
- **`SectionHeader`** — new this conversation. Just a title and description, deliberately **no button** — an earlier draft of the design spec had a "Download CSV" button here, and the user explicitly rejected that placement; downloads only ever happen from the VersionsBar pills now.
- **`PRISMHeader`** — new this conversation. Sticky top bar: `△ PRISM` wordmark plus a `STAGE 3` badge plus a "Cleaning · Data quality correction" subtitle on the left, the three tab pill-buttons (Duplicates / Outliers / Missing Values) on the right.
- **`VersionsBar`** — new this conversation. Sticky bar directly under the header, listing every registered version as a pill in step order (e.g. `Original Dataset` → `Duplicate Removed` → `Outliers Removed` → `Incomplete Rows Dropped` → `Missing Values Imputed`), each with a small inline `⬇` download button. The most recent pill renders solid indigo; earlier ones render as outlined/neutral pills.
- **`RedoWarningModal`** — new this conversation, added in the bug-fix round (§6). Only ever rendered when redoing a step would genuinely delete downstream work that already exists. Lists the affected version labels by name, with "Cancel" and "Yes, redo and delete downstream" buttons.

---

## 5. Each tab, in full behavioral detail

### 5.1 `DuplicatesTab`
- On mount / whenever its `filePath` prop changes, fetches `profile-duplicates` and renders 4 `StatCard`s (Duplicate rows, Duplicate groups, Rows before, Rows after — the last recomputes correctly once the file itself changes, see §6).
- `InfoWidget` text, exact user-specified template: `` `Level 2 (rule-based): ${data.total_dup_rows} exact duplicate row(s) found across ${data.total_groups} group(s). Duplicated rows are highlighted below so you can verify them before removing. The first occurrence of each group is kept.` ``.
- **The dataset preview table is always rendered** (§7 item 1) — never swapped out for just a success message. A toggle button next to the "Dataset preview" title switches between showing every row and showing only rows where `_is_dup` is true, and critically **preserves each row's original position number** in the full dataset when filtered (achieved by attaching the index *before* filtering: `data.rows.map((row,ri)=>({row,ri})).filter(...)`, never re-numbering the filtered subset from 1).
- Duplicate rows in the table get an amber-tinted background and a `dup · g1`/`dup · g2`/... badge (from the backend's `_dup_group` field) in a `FLAG` column.
- Primary action button: `Remove N Duplicates`. Once done (`isStepDone('cleaning_duplicates')` is true — see §6), this swaps to a "✓ Duplicate removal complete" notice plus a `↺ Redo this step` secondary button — this is the one tab where `done` fully gates the primary button, because duplicate removal is a single, non-configurable, one-shot action (no threshold to adjust, nothing iterative about it).

### 5.2 `OutliersTab` — the most complex tab

**Layout** (finalized in §7 item 2): a horizontal flex row containing, left to right: a `CollapsibleRail` labeled "Columns" (the column list, using `ColumnListItems`); a second, independent `CollapsibleRail` labeled "Outliers per Column" (wrapping `OutlierColumnBarChart` in its `compact` mode); then a `flex:1` main content area. Selecting a column (`loadColumn`) collapses the second rail (`setChartRailOpen(false)`) — it does **not** unmount, clicking the collapsed vertical pill re-expands it. On a successful per-column removal (`removeSelected`), the rail is set back open (`setChartRailOpen(true)`) as the view returns to the overview.

**Global (no column selected) content**: the two PCA/IsolationForest charts (Dimensionality Reduction scatter, Outlier Score by Row Index) in a 1fr/1fr grid, plus a `Remove All Outliers` button when `globalData.total_outliers > 0`.

**Per-column detail content** (once a column is selected): `MethodSelector` (normality result + IQR/Z-Score toggle + threshold slider), a Histogram/Strip-Plot view toggle, the chosen chart, a table of every currently-flagged outlier row with individual Keep/Remove toggles (`keptRows` state — this is what lets the user override which specific rows actually get removed, not just "remove everything the algorithm flagged"), and a `Remove N Row(s)` button reflecting exactly the rows still marked for removal (i.e. flagged outliers minus anything the user chose to keep).

**Progress banner**: because this tab's real workflow is inherently iterative (explore column A, remove some outliers, explore column B, ...), `isStepDone('cleaning_outliers')` does **not** gate the whole tab the way it does for Duplicates — instead an always-visible, non-blocking `"✓ Progress saved for this step · ↺ Start over"` banner shows alongside the normal exploration UI once any version exists for this step. This was a deliberate, explicit divergence from an earlier pasted single-button spec, flagged to the user at the time.

**Threshold state and its bug** — `zThresh`/`iqrMult` are single shared `useState` values across every column viewed in this tab, not per-column. This was the source of the entire bug family fixed in §9 — see that section for the full story. As of the end of this conversation, `loadColumn` correctly resets both to `3.0`/`1.5` every time a new column is opened.

**Step-settings caching**: `zThresh`/`iqrMult` are debounce-saved (500ms) to `WorkflowState.step_settings.cleaning.{z_threshold, iqr_mult}` via the parent's `saveCleaningSettings`, and restored from `initialSettings` on first mount — this is the Step Memory half of §2's feature, applied specifically to this tab. Per-column method overrides are **deliberately not persisted** (session-local only) — a scope trim, noted at the time as easy to extend later if wanted.

### 5.3 `MissingTab`
- Still uses the generic `ColumnPanel` wrapper (unlike `OutliersTab`).
- 4 `StatCard`s: Missing cells, Columns affected, Complete rows, Total rows.
- The "drop incomplete rows" panel — heading text, exact user-specified wording after a copy-change request: **"✂ Drop rows that don't satisfy the minimum number of features first"** (grammar-corrected from the user's own "doesn't" to "don't" for plural agreement with "rows"). A slider sets the minimum non-null values a row must have; live-recomputed "rows to drop / rows to keep" counts; an `Apply` button calling `apply-row-threshold`.
- **The bar chart and the missing-value matrix are permanently rendered side by side** (§7 item 3) — the old swipeable toggle gallery (`galleryIdx` state, touch-swipe handlers) was removed entirely. `MissingBarChart` is a standard vertical column chart; `MissingMatrix`'s column labels are horizontal, not rotated (see §7 item 3 for the exact SVG mechanism that makes both charts actually fill their half of the grid equally).
- Per-column imputation table: column name, type, missing count/%, a method dropdown (options context-filtered by column type — mean/knn/interpolation only for numeric columns), an Apply button, and a `CompletenessBar` replacing what used to be a plain "Status" text column.
- Same progress-banner pattern as `OutliersTab` (always-visible, non-gating) once any version exists for this step, for the same "this is iterative work" reasoning. Persists `{missing_methods, row_threshold}` to step settings the same way Outliers persists its thresholds.

---

## 6. The version-display bug and its fix — read carefully before touching version logic again

This was the single most subtle bug in the whole conversation, and it's worth understanding precisely, not just knowing "it was fixed."

**The bug, exactly**: the original `getFilePath(stepName)` function always returned "the most recent version with `step_order` strictly less than this step's own order" — i.e. the *input* a step should operate on. That's correct for deciding what data to feed a step, but the same function was also (incorrectly) used to decide what to *display*. So the moment a step finished and registered its own version, the tab kept showing the pre-step data forever, because the function never checked whether *this step itself* already had a version of its own.

**The fix**: renamed to `getDisplayPath(stepName)`, with genuinely different logic — if a version for `stepName` already exists in the `versions` array, return **that version's own file path** (the output the user just created). Only fall back to the nearest strictly-earlier version (the input) if this step hasn't produced anything yet. This one change made the whole page reactive with no manual "refresh" logic anywhere: once `registerVersion` adds the entry, the next render's `getDisplayPath` call returns the new file, the changed `filePath` prop flows down into the relevant tab, and that tab's own `useEffect([filePath])` naturally refetches against the new (now-correct) data.

**A second, related bug**: `registerVersion` used to simply append (`[...prev, newEntry]`) — unconditionally. Repeating a step's action (a different threshold, an explicit redo, or even two sequential actions within the same step, like imputing a second missing-value column right after the first) could leave multiple entries for the same `stepName` in the array.

**The fix**: `registerVersion` now always computes `[...prev.filter(v => STEP_ORDER[v.stepName] < order), newEntry]` before appending — i.e. it keeps only strictly-earlier versions (dropping both any existing same-step entry *and* anything downstream), then adds the fresh one. It also unconditionally calls the Django cascade-delete endpoint before registering (harmless no-op if there's nothing to clean up), so the server-side registry can never accumulate duplicates either, regardless of whether a confirmation dialog happened first.

**The redo/confirmation flow**: `isStepDone(stepName)` became purely derived (`versions.some(v => v.stepName === stepName)`) — no separate local "done" state anywhere any more. `confirmBeforeAction(stepName)` (kept its name, entirely redesigned) computes `toInvalidate = versions.filter(v => STEP_ORDER[v.stepName] > order)` — **note: strictly greater, not `>=`**. This distinction is what makes a same-step re-run (e.g. imputing a second missing-value column) never trigger a warning — only a genuinely *later* step existing should warn. If `toInvalidate` is empty, the function proceeds silently and resolves `true` immediately (removing any same-order sibling if present, with no dialog). If it's non-empty, it opens `RedoWarningModal` via a promise-based pattern — `confirmBeforeAction` returns a `Promise<boolean>` that the modal's own Cancel/Confirm buttons resolve. Every destructive tab action (`remove`, `removeSelected`, `removeAllOutliers`, `applyRowThreshold`, `applyColumn`) calls `await confirmBeforeAction(stepName)` first and bails out if it resolves `false`. `window.confirm` was used in an earlier iteration within this same conversation and was later replaced by this real modal.

All of this was verified live with a temporary Vitest suite (written, run, then deleted, per this project's standing convention — never committed): the display-path fix (a stat card genuinely shows `0` duplicates after removal, not a stale pre-removal count); no-accumulation (a direct Django query confirms only one version ever exists per step after repeated actions); the redo-warning-modal-only-when-genuinely-destructive behavior (redoing Duplicates after Outliers is already done correctly warns and names "Outliers Removed"; redoing with nothing downstream reverts silently, no modal).

---

## 7. Three explicit UI refinements (second round, requested together with the diagnose-only ask in §8)

1. **Duplicates preview never disappears, plus a duplicates-only toggle.** Previously, once `total_dup_rows === 0`, the entire table was replaced by a plain success `<Notice>`. Now the `<Notice>` renders *in addition to*, not *instead of*, the table — the `ExpandableChart`-wrapped table always renders. See §5.1 for the row-numbering detail (original position preserved when filtered).
2. **Outliers-per-column chart collapses instead of disappearing.** See §5.2/§4 (`CollapsibleRail` extraction) for the full mechanism.
3. **Missing tab's bar chart + matrix are a genuine 50/50 split.** The CSS grid (`gridTemplateColumns: '1fr 1fr'`) was already equal-width — the actual problem was that `MissingMatrix`'s `<svg>` had a **fixed pixel width** (`svgW = columns.length * cellW + 70`, with `cellW` computed off a hardcoded "680px total budget" left over from before the side-by-side layout existed), so it rendered narrower than its half of the grid while the bar chart's `ResponsiveContainer width="100%"` correctly filled its own half — making the two look visually uneven even though the grid itself was mathematically equal. **Fix**: changed the matrix's `<svg>` to `viewBox={\`0 0 ${svgW} ${svgH}\`} width="100%"`, with the `height` attribute **omitted** so the browser derives it from the viewBox's own aspect ratio (uniform scaling, no text/glyph distortion — this was a deliberate choice over `preserveAspectRatio="none"`, which would have stretched text horizontally). Also removed the old swipeable bar-chart/matrix toggle gallery entirely — both charts now render permanently, side by side.
4. **Copy change**: the row-threshold panel heading now reads exactly "✂ Drop rows that don't satisfy the minimum number of features first" (see §5.3).

---

## 8. The diagnose-only round — root causes found, nothing touched (superseded by §9's fixes, kept here for the full record)

The user's exact words were: *"I don't want you to do anything on the platform or code, just I want you to understand the problem that is happening and tell me and explain for me what is happening (apply testing on this issue and discover the bugs and tell me exactly what is happening)."* This was honored precisely — temporary throwaway Vitest+curl diagnostics were written specifically to empirically confirm hypotheses (not just theorize from reading code), and then deleted; zero production code was changed in this round. The four root causes found here are the same four fixed in §9 immediately afterward, once the user separately asked for fixes:

1. **Stale threshold carried across columns.** `zThresh`/`iqrMult` are shared state across every column; `loadColumn` reset `method` but never the thresholds. Empirically confirmed: a threshold left over from one column produced a count of **28** on a column whose true default-threshold count was **1**.
2. **Global stats structurally can't react to the slider** — `profile-outliers-global` has no threshold parameter at all, it's hardcoded to the fixed 3.0σ/1.5×IQR default.
3. **Histogram built from a partial/sampled subset** — `profile-outliers-column` already returned a correct full-dataset `histogram` field that the frontend was ignoring, rebinning instead from `colData.all_values`, itself capped to at most 1500 randomly-sampled non-outlier rows.
4. **"Remove All Outliers" was a single un-converged pass** — it removed each column's outliers sequentially, chaining the working file forward; dropping rows for column B shifts every other column's statistics (including already-processed ones), so column A could end the pass with newly-emerged outliers under its shifted post-removal stats, with no re-check.

---

## 9. The fix round — all four bugs from §8 actually fixed

Immediately after the diagnose-only round, the user pasted a second, independently-produced analysis (from their other claude.ai conversation) that reached the same four conclusions and this time came with an explicit request to implement fixes, plus its own Claude Code prompt. That prompt's literal proposed diffs assumed an outdated shape of the file (variable names like `setVP` and a `versionPath` local state that no longer existed by this point in the conversation, a 2-argument `onVersionCreated` where the real function was `registerVersion(stepName, filePath, label, rowCount, summary)`, and a "Remove All" implementation that supposedly read row indices from the 600-row PCA scatter sample — which was never actually true of this codebase's real `removeAllOutliers`, that function already read from each column's own full `profile-outliers-column` result, not the scatter sample). **The real intent of each fix was implemented against the actual current code**, not the literal pasted snippets:

1. **Fix 1 — reset thresholds on column switch.** `loadColumn` now also calls `setZThresh(3.0); setIqrMult(1.5)` immediately after resetting `method`, before fetching the new column's detail. Small, safe, directly closes the root cause.
2. **Fix 2 (numbered differently in the pasted prompt, but the same underlying bug as §8 item 4) — "Remove All" no longer loses convergence.** Added a **new backend endpoint**, `POST /cleaning/get-all-outlier-indices` (placed in `cleaning_router_v2.py` right after `profile-outliers-global`): computes every numeric column's outlier row indices in **one pass against the original, untouched file**, using the same per-column suggested-method-at-fixed-default logic as the existing global-profile endpoint, and returns the union of every column's outlier indices plus a `per_column_counts` breakdown (verified live: the union count was correctly *less than* the naive per-column sum, proving real deduplication of rows that are outliers in more than one column simultaneously). `removeAllOutliers()` in `OutliersTab` was rewritten to call this endpoint once, then make a single `remove-outliers` call with the full returned index list (`column: '__all_columns__'` passed as a harmless placeholder — confirmed directly in the endpoint's code that the `column` field is never actually used to filter anything). This eliminates the sequential per-column loop entirely, so there is no longer any intermediate state where one column's removal can shift another already-processed column's statistics mid-pass.
3. **Fix 3 — histogram now uses the backend's real full-data histogram.** `histBins` is now built directly from `colData.histogram.{bin_mids, bin_edges, counts}` instead of calling the old `computeHistBins(colData.all_values)` — that function was deleted from the file entirely, since nothing else used it. `histBins`'s `useMemo` dependency array was changed to `[colData]` only, deliberately dropping `zThresh`/`iqrMult`/`method` — the underlying data distribution shouldn't visually change just because the user moves a detection threshold; only the reference lines and which bars are colored "outlier zone" should move. Verified live by spying on `fetch` calls and confirming that dragging the threshold slider triggers **zero** additional network requests — proof the histogram data is provably threshold-independent, not just eyeballed as looking stable.
4. **Fix 4 — column-list badges update immediately after a removal, not just eventually.** The earlier `getDisplayPath` fix (§6) already meant badges *would* eventually refresh correctly after any removal (the file-path change triggers a genuine refetch of `profile-outliers-global`) — but there's a real network round-trip delay before that happens. Added an **optimistic** client-side update in both `removeSelected` and `removeAllOutliers` (`setGlobal(prev => ({...}))`) so the UI feels instant. Important detail: in `removeSelected`, this **subtracts** the actual number of rows removed from the existing count rather than hard-setting the column's badge to `0` — this matters because the outlier table's per-row Keep toggle lets the user intentionally spare some flagged rows from removal, so "remove the flagged outliers for this column" doesn't always mean "this column now has zero outliers by the default threshold."

All four fixes were verified live via a temporary Vitest suite (written, run, then deleted): a column whose true count is 1 correctly shows 1 even after fiddling with another column's slider first; Remove All correctly drives every column's badge and both aggregate stat cards to exactly `0`; dragging the slider triggers zero network calls; and a single-column removal updates that column's badge without waiting on any further page action.

`docs/PROJECT_HANDOFF.md` §9.2's endpoint table and §11.1 both independently confirm (from a *different* session's later verification pass) that all four fixes are present and working in the actual current `cleaning_router_v2.py`/`Cleaning.jsx` files.

---

## 10. Files this conversation created or modified

**Backend — Django** (`backend-django/`):
- `datasets/models.py` — `DatasetVersion` changes, `STEP_ORDER` dict (§2).
- `datasets/serializers.py`, `datasets/admin.py` — updated to match the model field changes.
- `datasets/views.py` — `DatasetUploadView`'s version-creation call updated for the new fields.
- `datasets/version_views.py` — **new file** (§2).
- `datasets/version_urls.py` — **new file** (§2).
- `datasets/migrations/0002_alter_datasetversion_options_and_more.py` — **new migration**, applied.
- `projects/models.py` — `WorkflowState` changes (§2).
- `projects/serializers.py` — updated.
- `projects/views.py` — added `WorkflowStateView`.
- `projects/urls.py` — mounted the workflow route.
- `projects/migrations/0002_remove_workflowstate_step_data_and_more.py` — **new migration**, applied.
- `core/urls.py` — mounted the new version-history routes.

**Backend — FastAPI** (`backend-fastapi/`):
- `cleaning_router_v2.py` — **new file this conversation** (replacing the deleted `cleaning_router.py`), then extended twice more within this same conversation (the NaN bug fix during transcription, then the new `get-all-outlier-indices` endpoint in §9).
- `main.py` — one import line changed to point at `cleaning_router_v2`.

**Frontend** (`frontend/`):
- `src/api.js` — added `versionsAPI` and `workflowAPI`.
- `src/App.jsx` — added `bootstrapDevProject()` (dev-only auth/project bootstrap so the Cleaning page has a real `projectId` to persist against). *(Another session later extended this file further with Upload/Diagnose/Encoding stages — not this conversation's work, see `PROJECT_HANDOFF.md`.)*
- `src/pages/Cleaning.jsx` — **the vast majority of this conversation's total output**. Fully rewritten from an earlier, simpler version into everything described in §3–§9 above, across three separate rounds within this one conversation.

**Never committed to git by this conversation** — per standing project convention, no `git commit` was ever run here unless explicitly asked, and it wasn't. (A commit did land at some point during the overall project's history, authored directly by the user outside of any Claude session — see `PROJECT_HANDOFF.md` §3 for the current exact git state, which changes independently of this document and should always be re-checked fresh.)

**Temporary test files created, verified, then deleted (never committed, per project convention)**: several rounds of `Cleaning.*.test.jsx` files — one per major implementation round — each rendering the real `CleaningPage` component against the actually-running FastAPI/Django dev servers with no mocking, confirming the specific behavior just implemented, then deleted immediately after passing.

---

## 11. Testing pitfalls hit repeatedly this conversation — worth knowing before writing the next temporary test

- `el.closest('div')` called on an element that is *itself* a `<div>` returns that same element — it does not walk up a level. Use `.parentElement` explicitly when you actually want the parent.
- `getByText('exact string')` fails silently whenever the target text has an icon/emoji prefix in the same text node, or a sibling interactive element (like a button) inside the same containing element — React Testing Library matches against the full concatenated text of the smallest containing element, not just the substring you're picturing. Prefer a regex/partial matcher (`getByText(/partial phrase/)`) in these cases.
- The default `findByText`/`waitFor` timeout (1000ms) is shorter than some real endpoint calls in this codebase — `profile-outliers-global`'s PCA/IsolationForest computation in particular. Pass an explicit longer timeout (`{}, {timeout: 10000}`) rather than assuming a failure means the feature is broken.
- State that updates optimistically (e.g. the "done" banner, which is driven by parent state that updates before the tab's own async re-fetch resolves) can render before a *related* async operation triggered by the same user action finishes. Wrap any assertion that depends on that later operation in `waitFor`, don't assert synchronously right after the optimistic-driven UI first appears.
- When verifying "moving a slider doesn't cause X to change," don't guess at a UI library's internal DOM class names (this conversation initially guessed `.recharts-bar-rectangle` for a Recharts bar chart and got zero matches) — instead verify the underlying causal mechanism directly, e.g. spying on `fetch` to prove no network call fired, which is both more robust and more directly meaningful than counting DOM nodes.

---

## 12. Pending / not yet done, specific to this area

- The four Outliers-tab bugs are fixed (§9) — nothing outstanding there as of the end of this conversation.
- Per-column outlier method overrides are still not persisted to step settings (only the shared threshold values and the missing-value methods/row-threshold are) — noted as an acceptable, deliberate scope trim, not a bug.
- `OutliersTab`/`MissingTab`'s "progress saved / start over" banner pattern (as opposed to Duplicates' full done/redo button swap) is a deliberate, explained divergence from an early pasted spec — worth remembering if a future request tries to make all three tabs behave identically, since there's a real reason they don't.
- No dedicated multi-page journey-map/routing exists — `Cleaning.jsx` is reached via a temporary dev harness in `App.jsx` (see `PROJECT_HANDOFF.md` for that file's current, evolving shape — it has changed since this conversation last touched it).
- `cleaning_router_v2.py` still duplicates a few small helpers (`check_normality`, `base_stats`, `save_version`) that conceptually overlap with `ml-core/cleaning.py`'s equivalents — an accepted, pre-existing pattern in this codebase, not urgent.
