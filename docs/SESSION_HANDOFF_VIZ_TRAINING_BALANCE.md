# Session Handoff — Visualization Overhaul, Platform-Wide Balance Checker, Upload Restyle, Cleaning Width Fix, Train-and-Test Page

**Read this file first in the new chat, in full, before touching any code.** It is a standalone record of one long working session on IntelliML/PRISM. It does not replace the other `docs/*.md` files — it assumes you will also read `PROJECT_HANDOFF.md`, `CLEANING_PAGE_SESSION_HANDOFF.md`, `CLAUDE_CONTEXT.md`, and `SESSION_HANDOFF_NAV_AND_FEATURE_SELECTION.md` for everything that predates this session. This file covers everything built, changed, decided, and left open in the session that follows those.

Do **not** edit those other `docs/*.md` files to merge this content into them — this file is deliberately separate, per the user's explicit instruction, because they want each session's detail preserved on its own.

---

## 0. Standing workflow — how this project actually gets worked on

The user runs a **separate claude.ai chat** as a design/spec partner, then pastes the resulting specs, prompts, and sometimes full source files (backend routers, `*_ClaudeCode_Prompt.md` files) into this repo's Claude Code sessions. **This repo's job is: read the pasted material critically, adapt it to whatever the actual current codebase looks like (specs drift from reality constantly), implement, live-test against real running dev servers, and report back precisely** — not to redesign from scratch, and not to trust the pasted material blindly.

This mattered concretely, repeatedly, this session:
- A pasted `training_router.py` had zero error handling, a numpy-serialization bug, and a real hang bug — all found only by actually running it, not by reading it.
- A pasted frontend styling spec (`TrainTest_ClaudeCode_Prompt.md`) hardcoded an indigo color palette that has nothing to do with this app's real teal branding — followed the *structure* faithfully, ignored the invented palette, used the app's real `theme.jsx` tokens instead.
- A separate claude.ai chat's imbalance-detection design was mostly right (entropy + IR is the correct approach) but had a real bug (its ID-column guardrail would misfire on legitimate regression targets) that only surfaced by testing it live.

**When the user pastes something from another AI, the default assumption should be "probably structurally right, verify everything specific against the live code and live servers before trusting it."**

### The diagnostic-feature philosophy instruction (verbatim, reusable)

The user has repeated this instruction multiple times across sessions with the framing *"this should go at the top of every Claude Code chat that touches any diagnostic, column-analysis, or insight feature."* It is already correctly implemented in `backend-fastapi/visualization_router.py`'s `run_diagnostics()` — but restate it mentally before touching any future diagnostic/insight feature:

> When building any column-analysis or data-inspection feature, think like a senior ML data analyst reviewing the dataset for the first time. For each column, run this priority-ordered rule pipeline and surface only the top-priority match: (1) domain-specific zero-impossibility (glucose/insulin/bmi/age/etc columns with 0 values), (2) missingness >20% "High" / >5% "Moderate", (3) target-column class imbalance <20% minority, (4) constant/near-constant feature, (5) high cardinality categorical (>50 uniques), (6) skewness |skew|>1, (7) IQR outliers, (8) fallback "Looking Good". All numbers in messages must come from the actual column data, never hardcoded/templated. No LLM calls for this — rule-based only. One insight per column, not a list. Badge colors: red=impossible/extreme, orange=moderate, yellow=minor, green=none.

### Standing rule: forward-navigation buttons always live at the page bottom

Explicit, repeated user instruction, saved to memory (`feedback_continue_button_bottom.md`): every "Continue to X →" button belongs at the **bottom** of the page, never the top-right header. This is already the default pattern via `App.jsx`'s shared `AdvanceButton` footer convention — `DataReadiness.jsx` was the one page that broke it (own header button) and got fixed this session. **When a page renders its own internal continue button instead of relying on App.jsx's footer slot, that internal button must render at that page's own bottom — and App.jsx must not also add a second footer button, or the two will duplicate/overlap.** This exact mistake was made and caught this session (see §5 below, Feature Selection duplicate-button bug) — check whether the page you're touching already has its own complete forward-button flow before adding one in App.jsx.

### Standing rule: one shared utility, not five inline copies

After finding *two* independently-wrong, mutually-inconsistent flat-percentage imbalance checks in two different routers, the user asked for a platform-wide fix. The resulting pattern — one shared backend function + one shared frontend constant, imported everywhere the concept is needed, never reimplemented — is now the expected shape for any other cross-cutting concern that shows up in more than one place. See §4 for the full implementation.

---

## 1. Visualization page (`frontend/src/pages/DataReadiness.jsx`) — full rewrite

Renamed from "Data Readiness" / "Preprocessing Report" to **"Visualization"** (page `<h1>`, subtitle, TopNav link label, and the AdvanceButton label on the previous page that leads into it — all four spots needed the rename, not just the page title).

Full list of changes made, all live-verified via Playwright:

1. **Continue button moved to page bottom** (was top-right header) — per the standing rule above. This page still doesn't call `registerVersion` (it's read-only, never produces a new dataset version) — `onNext={(next) => advance('feature_selection')}` still comes from App.jsx exactly as before, just wired to a footer button *inside* `DataReadinessPage`'s own render now instead of the header.
2. **Summary radar (was "Data Fingerprint")**: dropped from 6 axes to 5 — removed **Signal** entirely (axis, legend entry, and its contribution to the `overall` score). Remaining axes: Completeness, Balance, Normality, Separability, Cleanliness. Section renamed "Data Fingerprint" → "Summary" (nav id `fingerprint`→`summary` too, for consistency).
3. **Correlations section removed entirely** — both the `<Section id="correlations">` JSX block and its `SECTIONS` navigator array entry. `CorrelationHeatmap` component definition was also deleted (became fully dead code, no other usage). Explicit user reasoning: *"the part of correlations shouldn't be done here at all"* — correlation-as-ranking-signal still belongs in Feature Selection, just not this page.
4. **Before vs After Preprocessing section**: Skewness bar chart removed from here (moved to Quality Confirmation instead), replaced with **Target Class Distribution** (the existing `ClassCompare` component — horizontal progress bars, before/after side by side) sitting in the same 2-column grid slot next to Missing Values.
5. **Missing-values bars**: grey → red, `barSize` widened slightly (was unset/thin).
6. **Distributions section (`MiniHistogram`)**: same grey→red, same slight widening; added an explicit **"No variation to display"** fallback card instead of a column silently vanishing from the grid when its histogram is empty (constant/all-NaN column).
7. **Separability section**: PCA class legend becomes a bordered, scrollable box (`maxHeight: 80, overflowY: 'auto'`) **only** when there are more than 6 classes (regression-shaped targets can have hundreds) — normal classification legends render exactly as before.
8. **Quality Confirmation section**: now 3 cards — Missing Values (final state), **Skewness After Preprocessing** (moved here from Before/After), Anomaly Score Distribution. `Dataset Statistics` card title no longer has the `"(df.describe())"` parenthetical.
9. **Algorithm Fit Recommendations — completely rewritten**, backend-side (`build_algo_recs()` in `visualization_router.py`). The old version accepted a `target_type` parameter that was **never referenced in its body** — root cause of "always gives the same results" and showing classification algorithms (e.g. Logistic Regression) for regression datasets. New signature: `build_algo_recs(df, task_type, row_count, col_count, is_balanced, n_skewed, ft_corr, fingerprint)`. Two fully separate algorithm lists:
   - Classification: Random Forest Classifier, Logistic Regression, K-Nearest Neighbors, Decision Tree Classifier, Support Vector Machine (SVC)
   - Regression: Random Forest Regressor, Linear Regression, K-Nearest Neighbors Regressor, Decision Tree Regressor, Support Vector Regression (SVR)

   Every algorithm's star rating and reason string is computed from real dataset signals (row/col count, balance, skew count, correlation strength, high-cardinality categoricals) — not templated text. Live-verified: a synthetic regression dataset correctly showed only regression algorithms with dataset-specific reasoning; a synthetic classification dataset showed only classification algorithms.
10. **Bug found live, fixed**: after clicking "Load PCA Analysis", the radar/KPI strip correctly recomputed `overall` (58/100 in the live test), but the separate "Pre-Training Signal Assessment" card kept showing the stale pre-PCA number (69/100) right next to it — a visible contradiction on the same page. Fixed in `loadPCA()`'s `setData` callback: now also recomputes `signal.score`/`signal.grade` using the exact same thresholds the backend's `build_signal_assessment()` uses (`>=85 Excellent, >=70 Good, >=55 Fair, else Weak`), so both numbers update together.

### Backend changes (`backend-fastapi/visualization_router.py`)

- `compute_fingerprint(df, target, balance_result, ft_corr)` — signature changed from taking a raw `target_dist` list to taking the full `balance_result` dict from the new shared `check_target_balance()` utility (see §4). `balance = balance_score(balance_result) if balance_result else 50.0`.
- `overall` = average of the 5 visible axis scores only (positive values only, matching the shared balance-score-bucket convention), never divides by a hidden 6th "signal_strength" number nobody sees.
- `compute_per_col_histograms()` — a column with zero variance (constant/all-NaN) used to be silently dropped via `continue`; now every numeric column always gets an entry, with empty `counts`/`bin_mids` for the degenerate case, so the frontend's "No variation to display" card has something to key off instead of a silent gap.
- `/analyze` response gained a new top-level `"target_quality"` field — the full dict from `check_target_balance()`, used by the frontend's Class Balance MetricCard (see §4).

### Frontend "explain every graph" deliverable

The user's final explicit request on this page was a plain-English explanation of every chart, for presenting the page to someone else. That explanation was delivered in chat (not saved to a file) — if the new session needs it again, it covered: the Summary radar (5 axes, what each measures, why the pentagon shape matters), Before/After class distribution + missing values, Distribution Health histograms + class-conditional overlays (feature usefulness preview), Separability/PCA scatter + scree plot + silhouette score, Quality Confirmation (skewness, anomaly score distribution, statistics table), and Pre-Training Signal Assessment + Algorithm Fit Recommendations as "the closing argument" bridging into Feature Selection/Training. Regenerate on request rather than assuming it's written down anywhere.

---

## 2. Cleaning page width bug — the REAL fix (two rounds needed)

The user reported this bug **twice**. The first fix was necessary but not sufficient, which is worth understanding so it doesn't get "fixed" a third time incorrectly.

**Round 1** (already done before this document's session, but worth restating): `App.jsx`'s wrapper around `<CleaningPage>` had `maxWidth: 1100, margin: '0 auto'` — the one page in the app not following the "no max-width, just horizontal padding" full-bleed convention every other page uses. Removed. This was verified via fresh Playwright screenshots at the user's exact reported viewport width (1280px) and found technically correct (symmetric 32px margins) — yet the user still said it looked wrong.

**Round 2, the actual root cause**: `Cleaning.jsx`'s own top-level render (`CleaningPage` function, the very outer JSX) wrapped its *entire* content — `PRISMHeader`, `VersionsBar`, and all three tab panels — in its own bordered, rounded-corner (`borderRadius: 20`), drop-shadowed "card" div:
```jsx
<div style={{ background: C.white, borderRadius: 20, border: `1.5px solid ${C.border}`, boxShadow: shadow, overflow: 'hidden' }}>
```
No other page in the pipeline (Diagnose, Encoding, Sampling, the new Visualization page) does this — they all render flush against the page background, with only their *individual* content cards getting their own rounded/shadowed treatment. Even with pixel-correct margins, this card treatment reads as a smaller floating panel inset within the page, not the page itself — which is what kept looking like a width bug no matter how the outer margin was fixed.

**Fix**: removed the card styling entirely (`background`/`borderRadius`/`border`/`boxShadow`/`overflow` all stripped from that wrapper div, kept as a plain `<div>`), and removed `PRISMHeader`'s matching `borderRadius: '20px 20px 0 0'` (rounded top corners that only made sense against the now-gone card). Verified live via Playwright screenshot: the internal `PRISMHeader`/`VersionsBar` bar now spans the same edge-to-edge width as `TopNav` above it (32px–1368px at 1400px viewport), matching every other page.

**If this is reported as still wrong a third time**: don't re-touch the outer wrapper again — check individual tab content (DuplicatesTab/OutliersTab/MissingTab) for their own stray max-width or padding issues instead, since the two known causes (App.jsx maxWidth, Cleaning.jsx's own card wrapper) are both confirmed fixed and verified.

---

## 3. "Class Moderate → Class High" — resolved, no code change

Earlier in this session (before this document), a wrong guess was made: renamed `Sampling.jsx`'s `LEVEL_CONFIG.moderate.label` (a balance-tier UI label) from `'Moderate'` to `'High'`. The user corrected this — the real target was literal category values (`Minimal`/`Moderate`/`Intensive`) inside their own uploaded dataset's `study_plan` target column, rendered generically by the `ClassBar` component, shown via a screenshot with header "TARGET COLUMN: STUDY_PLAN". The `LEVEL_CONFIG` change was reverted back to `'Moderate'`.

This session, asked directly via `AskUserQuestion` whether this was correctly understood — **confirmed**: it is the user's own dataset's literal data value, not a platform-generated label. **No code fix is applicable** — renaming a literal data value platform-wide would mislabel any other dataset whose real category happens to also be named "Moderate". If they want their own CSV's category renamed, that's a data-authoring change on their end, not a code change here. This is now documented in memory (`feedback_literal_data_vs_ui_labels.md`) as a pattern to recognize early next time a similar "change X to Y" request points at a generic-sounding word on a chart.

---

## 4. Platform-wide target-quality / imbalance checker (biggest architectural change this session)

### Why

Two independent, both-wrong implementations existed: `sampling_router.py`'s `check_imbalance()` used flat minority-class-percentage bands (40/20/1%); `visualization_router.py`'s `compute_fingerprint()` used a different min/max-percentage ratio. **Both broke on multiclass targets** — a perfectly balanced 10-class dataset (10% per class, correct) would be flagged "severely imbalanced" by either, since neither formula accounts for how many classes exist. The user brought a second claude.ai conversation's proposed fix (Shannon Entropy + Imbalance Ratio) and asked for a critical review, not blind acceptance.

### What the pasted design got right vs wrong

**Right** (kept): Normalized Shannon Entropy `E = -Σ(pᵢ·ln pᵢ) / ln(K)` scales correctly to any class count K (1.0 = as even as K classes can be, 0.0 = one class has everything) — this is the actual fix for the multiclass bug. Imbalance Ratio (largest/smallest class count) as a secondary signal. Regression needs a completely different check (skewness/kurtosis of the target distribution, not "class balance," which is meaningless for continuous data). Three guardrails matter: ID-column detection, sample starvation (<30 in minority class), continuous-data trap.

**Wrong** (fixed): the pasted ID-column guardrail (`n_unique == total → always invalid`) would **misfire on legitimate continuous regression targets** — a real house-price column routinely has ~100% unique values too, and that's normal, not a mistake. Found this live by testing a synthetic exponential-distribution regression column that got incorrectly flagged "looks like an ID column." Also: the pasted regression thresholds had no clean graduated levels, and one message string used an awkward `.replace()` hack instead of a clean f-string.

### The implementation

**`backend-fastapi/utils/balance_checker.py`** (new file, new `utils/` package with empty `__init__.py`) — the single function `check_target_balance(series: pd.Series, task_type: Optional[str] = None) -> dict`:

- Guardrail order (this exact order matters, see the ID-column fix below): (1) empty target → invalid, (2) `n_unique == 1` (constant target, `total > 1`) → invalid "Only One Value" — this guardrail was **added**, not in the pasted design, closing a real gap (a constant target used to fall through into the classification math and get called "severely imbalanced" with a misleading message, when the real problem is "there's nothing to learn at all").
- Task-type auto-detection (when not passed explicitly): numeric AND (>20 unique values OR >20% of rows unique) → regression, else classification. Matches the same threshold `visualization_router.py`'s own `is_classification_target()` already uses elsewhere.
- **ID-column guardrail, corrected**: fires when `n_unique == total` AND (`is_classification` OR the column's own name looks like an identifier — checked via keyword set `{id, uuid, guid, key, index, identifier, rowid}` matched against underscore-split name parts). A numeric, high-cardinality, non-ID-named column is trusted as a real regression target and proceeds to the skewness path instead of being misflagged.
- Classification path: entropy `E` + Imbalance Ratio, 4-tier levels — `balanced` (E≥0.85 & IR≤1.5), `mild` (E≥0.70 & IR≤3.0), `moderate` (E≥0.40 & IR≤10.0), `severe` (below that). Returns `class_dist`, `evenness`, `imbalance_ratio`, `minority_class`/`count`, `majority_class`/`count`, and a separate (appended, not overriding) `starvation_warning` string when the minority class has <30 rows.
- Regression path: same 4-tier `level` vocabulary but keyed on `|skewness|` — `balanced` (<0.5), `mild` (<1.0), `moderate` (<2.0), `severe` (≥2.0). Returns `skewness`, `kurtosis`, empty `class_dist`.
- `balance_score(balance_result)` helper: classification gets a precise continuous `evenness*100`; everything else (regression, invalid) falls back to a bucket map `{"balanced":100,"mild":75,"moderate":45,"severe":10,"invalid":0}` — used wherever a single 0–100 number is needed (the Visualization page's radar "Balance" axis).

**`frontend/src/constants/balanceLevels.js`** (new file) — `getBalanceLevelConfig(C)` returns the shared `{balanced, mild, moderate, severe, invalid, no_target} → {label, color}` map. **Every page showing a balance/imbalance/skew verdict must import this, never redefine its own copy** — this is now the memory-saved platform rule (`feedback_balance_checker_platform_rule.md`).

**`backend-fastapi/sampling_router.py`** — deleted `check_imbalance()`, `imbalance_suggestion()`, `_LEVEL_TEXT` entirely. `/profile` now calls `check_target_balance(df[target_col])` once and builds `target_info` from its result: `{column, class_dist, is_imbalanced, balance_level, title, suggestion, is_classification, min_class_pct, evenness, imbalance_ratio, skewness, kurtosis, starvation_warning}`. Note `get_class_dist()` (raw value-counting, used for before/after sampling comparison displays) was **kept** — it's a different, still-needed concern from the balance *verdict*.

**`backend-fastapi/visualization_router.py`** — `/analyze`'s call site now computes `target_quality = check_target_balance(df[target], task_type=...)` once (passing the already-known `target_is_classification` explicitly rather than letting the checker re-guess), uses it for both `compute_fingerprint`'s balance score and a replacement for the old `is_balanced` heuristic (`target_quality["level"] in ("balanced","mild")`), and returns the full dict as `target_quality` in the response.

**`frontend/src/pages/Sampling.jsx`** — imports `getBalanceLevelConfig`, deleted its own local `LEVEL_CONFIG` copy. The "Target Balance" KPI card now branches three ways: classification (unchanged class-bar display), **regression** (relabels to "Target Distribution", shows skew value instead of minority %, no class bars — replaced with a plain-text skew/kurtosis line in the Current Dataset tab where `ClassBar` would have rendered nothing useful), and **invalid** (ID column / constant target — shows the clear message from `targetInfo.suggestion`, no bars). A separate danger-colored banner appears when `starvation_warning` is present, in addition to (not replacing) the main balance banner.

**`frontend/src/pages/DataReadiness.jsx`** — Class Balance MetricCard rewired to read `data.target_quality?.level` through the same shared `getBalanceLevelConfig`, instead of its own ad-hoc 3-tier bucketing of the raw `balance` score. Also relabels to "Target Skew" for regression targets, with a fixed message about class distribution not applying (see bug below).

**Bug found and fixed during this**: the "Target Class Distribution" Before/After card's empty-state fallback said *"No target column set"* even when a regression target genuinely was set (it just has no discrete classes to compare) — misleading. Fixed to check `targetQuality?.is_classification === false` first and show *"This target is continuous (regression) — there are no discrete classes to compare. See Target Skew in the KPI strip above instead."*

### Live verification performed (all via direct curl against controlled synthetic CSVs, plus full browser passes)
- Imbalanced 3-class (74/17.5/8.5%) → `moderate`, evenness 0.67, IR 8.7 — correct.
- Perfectly balanced 10-class (10% each) → `balanced`, evenness 1.0, IR 1.0 — **this is the actual multiclass fix working**.
- Genuine regression target (exponential distribution, name not ID-like) → routes to regression path, skew 1.8 → `moderate` — correctly NOT flagged as an ID column.
- Column literally named `id_col` (sequential integers) → correctly flagged `invalid`/ID column regardless of being numeric.
- Full browser passes on both Sampling and Visualization pages for both a classification and a regression target — banners, KPI cards, and messages all rendered correctly with proper em-dash characters (see the encoding false-alarm note below) and zero console errors.

### A debugging detour worth knowing about (false alarm, don't repeat the investigation)
While testing, terminal output of API response strings containing em-dashes (`—`) appeared corrupted (mojibake) when printed via `python -c "print(...)"` piped through this environment's Git Bash/Windows console. Chased this as a possible real UTF-8 encoding bug for a while — it is **not** a real bug. The actual HTTP response bytes (verified by saving to a file and inspecting raw hex, and by decoding with explicit `utf-8`) are correctly encoded (`e2 80 94`, proper em-dash). The corruption only ever happened in this session's *own* diagnostic `print()` calls hitting a non-UTF8 Windows console codepage. **If terminal output looks garbled when testing string content, verify via raw bytes/file inspection before assuming the API itself is broken.**

---

## 5. Upload page drawer restyle (`frontend/src/pages/Upload.jsx`)

The user's separate claude.ai chat produced a very detailed 10-step restyling spec for the "Dataset Setup" drawer (the slide-in panel after clicking "Use This Dataset →"). That spec hardcoded a full new color palette (`primary: '#6366f1'` — indigo) and shadow constants from scratch, as if styling a blank page.

**That palette was not used.** The drawer already pulls from the app's real shared `theme.jsx` (`useTheme()`, teal `C.primary`), same as every other page — using the other AI's invented indigo would have clashed with the app's actual branding and broken dark mode (the other AI never saw the real code, so it couldn't have known this). Applied genuine polish using the *existing* tokens instead:

- Added a `<style>` block injecting `.prism-choice-card:hover` (border→primary, slight lift) and `.prism-target-row:hover` (background→faint) — pure CSS, no new state, doesn't touch any selection logic.
- `ChoiceCard` (the "Yes, I have a target column" / "No, discover patterns" cards): added `boxShadow: shadow2` (was flat/borderless before, matching Encoding.jsx's card treatment now).
- Target-column selector list container: added `boxShadow: shadow2`; each row got the hover className.
- "Detected task" result panel: was a flat `background: C.light` box — upgraded to `background: C.primarySoft, border: 1px solid C.primary33`, matching the soft-tinted-panel convention used throughout Encoding.jsx/DataReadiness.jsx. **The label text itself was deliberately left untouched** (still says "Detected task:" with the colon, sentence case) — an early attempt to also uppercase/restyle that specific label text was reverted mid-session because the user's instruction was strictly "style only, never change a thing in the content," and removing a colon character crossed that line even though it was CSS-driven.
- Step 3 summary table: added `boxShadow: shadow2`.

All verified live via Playwright screenshots at all 3 drawer steps — zero console errors, zero content/text/logic changes.

---

## 6. Train and Test page — the largest single build this session

### Source material

Two pasted artifacts from the user's separate claude.ai chat: `training_router.py` (full backend, ~450 lines as pasted) and `TrainTest_ClaudeCode_Prompt.md` (a very long, detailed frontend spec — model catalog, exact left/right two-panel layout, 5 info-icon locations with full explanation text, grid search parameter defaults per model, elbow curve interactivity requirements, per-model visualization requirements). Plus a hand-drawn paint mockup image (exact left-column-settings / right-column-output layout, explicitly said to follow *exactly*) and several Weka screenshots (explicitly: reference only for specific ideas like the timestamp-on-the-left convention and the right-click context-menu concept — **not** for overall structure).

The user was explicit and emphatic: *"i don't like what claude ai (I mean what you) is generating as frontend design"* — meaning stick to the paint mockup's structure precisely, reuse the established teal PRISM visual language (the same one already validated for Encoding.jsx/FeatureEngineering.jsx/DataReadiness.jsx), and apply creative liberty only for the *visual execution* of individual charts/graphs, never the page structure.

### Backend — `backend-fastapi/training_router.py` (rewritten, not pasted verbatim)

The pasted version had **zero** try/except anywhere (this project's own established, repeatedly-necessary convention — Starlette's `ServerErrorMiddleware` sits outside `CORSMiddleware`, so any unhandled exception in a FastAPI route produces a bare, undebuggable "Failed to fetch" in the browser with no CORS headers). Rewrote wrapping every endpoint in try/except → HTTPException, added the project's standard `safe_round()` NaN/Inf-safe rounding helper, and fixed several real bugs found only by running it (see below).

**6 endpoints, all registered** (`from training_router import router as training_router; app.include_router(training_router)` added to `backend-fastapi/main.py`):

- `POST /training/defaults` — `{file_path, target_column?}` → suggested split ratio (exact table the user gave: 90/10 for 100k+ rows down through <100→cross-validation recommended), suggested k-folds (5 for ≥1000 rows, 10 below), row/feature counts. `target_column` is **optional** (clustering has none).
- `POST /training/elbow-knn` — `{file_path, target_column, metric, max_k=39}` → odd k from 1–39, cross-validated score per k using whichever of accuracy/f1/precision/recall the user picked, `best_k` by argmax. **Features are StandardScaler-scaled before this runs** (see the SVM hang bug below — KNN needs the same treatment for the same reason, added even though it doesn't hang, just gives wrong-feeling results without it).
- `POST /training/elbow-kmeans` — `{file_path, max_k=15}` → K-Means inertia for k=2..15, best k via max-second-derivative ("elbow") of the inertia curve.
- `POST /training/grid-search` — `{file_path, target_column?, task_type, model_name, param_grid, metric, cv_folds, stratified}` → wraps `sklearn.GridSearchCV`, `StratifiedKFold`/`KFold` per `stratified`, capped at 60 total combinations (guards against a runaway grid hanging the request). Returns `best_params`, `best_score`, `elapsed_sec`, top-10 `all_results`.
- `POST /training/train` — the main endpoint. Handles `task_type` ∈ {classification, regression, clustering} × `split_method` ∈ {train_test, cross_validation}. Applies the user's decision threshold to binary classification probabilities (both split methods now — the pasted version only applied it in train_test mode, silently ignoring it during cross-validation; fixed via `cross_val_predict(..., method="predict_proba")`). Saves every trained model as a `.pkl` in `backend-fastapi/saved_models/` (created if missing), returns full metrics + model-specific visualization payload.
- `GET /training/model/download` — streams a saved `.pkl` back as a file download.

**Model catalog** (`build_model(model_name, params)`):
- Classification: `knn`, `decision_tree`, `random_forest`, `logistic_regression`, `svm`, `xgboost`, `naive_bayes`
- Regression: `linear_regression`, `ridge_regression`, `random_forest_regressor`
- Clustering: `kmeans`

`xgboost` was **not installed** in the venv — installed it for real (`pip install xgboost`, version 3.4.1, added to `requirements.txt`) rather than silently falling back to `GradientBoostingClassifier`, matching this session's established precedent of using the real named algorithm (see the earlier-session SMOTE fix) rather than a substitute when the user explicitly named it.

### Five real bugs found and fixed (all via live testing, not code review alone)

1. **`numpy.bool_` JSON serialization crash.** `tree_to_dict()`'s `"truncated": tree_.children_left[node] != _tree.TREE_LEAF` — a numpy comparison producing `numpy.bool_`, not native `bool`. FastAPI's `jsonable_encoder` choked on it with `TypeError("'numpy.bool' object is not iterable")` — but only in the response-serialization step *after* the route handler returns successfully, meaning it escaped the try/except entirely and needed a fresh reproduction to find. Fixed with an explicit `bool(...)` cast. This is the same recurring "numpy type in an API response" bug class already documented in memory (`recurring_nan_json_bug.md`) — check every new numeric comparison/aggregation before it reaches a `return` in any FastAPI handler.

2. **A genuine SVM hang — the big one.** `SVC(kernel='linear', probability=True).fit()` hung indefinitely (confirmed via a raw, router-independent sklearn script with a hard `timeout` wrapper — not specific to this codebase) on a dataset with wildly different feature magnitudes (income spanning ~16 to 2.4 million, age spanning 18–66). Root-caused by direct experimentation: `probability=False` fit in 0.01s; the hang was tied to unscaled features feeding a scale-sensitive optimizer, not to threading/OpenMP settings (tried `OMP_NUM_THREADS=1` — no effect). **Fix**: `build_model()` now wraps `knn`, `svm`, `logistic_regression`, `linear_regression`, `ridge_regression` in an `sklearn.Pipeline([("scaler", StandardScaler()), ("model", estimator)])`. This is deliberate defense-in-depth — the dataset *should* already be scaled by the time it reaches Training (that's what the Encoding & Scaling page is for), but the training pipeline must not silently assume an earlier stage was done correctly. Knock-on fixes this required:
   - `unwrap_model(model)` helper — pulls the real estimator out of `model.named_steps["model"]` for any code that needs `.coef_`/`.feature_importances_`/`.theta_` (used in `_model_specific_viz`).
   - Grid search: `GridSearchCV` needs Pipeline param-grid keys prefixed `model__x` (e.g. `{'model__C': [...]}` not `{'C': [...]}`) — `grid_search()` now auto-prefixes on the way in and strips the prefix back off `best_params`/`all_results` on the way out, so the API's param names always match exactly what the frontend sent, with zero internal Pipeline detail leaking into the response.
   - `elbow-knn` also got the same `StandardScaler().fit_transform(X)` treatment before its own bare `KNeighborsClassifier` cross-validation loop (it doesn't go through `build_model` at all, so this needed a separate, matching fix).
   - Deliberate side effect noted, not fixed further: coefficients for the wrapped models (`logistic_regression`, `linear_regression`, `ridge_regression`) are read in **scaled-feature space**, not raw units. Judged this an improvement, not a regression — a coefficient table comparing income (raw units in the hundreds of thousands) against age (raw units in the tens) is only meaningfully comparable in standardized units anyway.

3. **Missing/mismatched target column → confusing crash.** If `target_column` doesn't exist in the dataframe being read (this surfaced constantly during testing — see the shared-dev-account note below — but is also a real defensive gap on its own), `y` silently became `None` and the code crashed several calls deeper with `'NoneType' object is not subscriptable` — useless for debugging. Fixed with an explicit, fail-fast guard at the top of `/train`, `/elbow-knn`, and `/grid-search`: if the task isn't clustering and `target_column` isn't actually a column in the dataframe, raise a 400 immediately with a message listing the dataset's real columns (`f"Target column '{req.target_column}' was not found in this dataset (available columns: {...}). Re-check the Upload step's target selection."`). Verified this renders cleanly in the actual UI (red banner under the Train button, no crash, no console error).

4. **Decision tree sample counts were wrong** — the root node of a 400-row, 90/10-split tree displayed "1 samples" instead of "360 samples." Root cause, found by direct sklearn inspection: in this project's sklearn version (1.8.0), `tree_.value[node][0]` holds **normalized per-class proportions** (they sum to 1.0), not raw counts — `tree_.value[node][0].sum()` was therefore always ≈1, cast to `int()` → 1. The correct source for a node's sample count is `tree_.n_node_samples[node]`. Fixed `tree_to_dict()` to read from there; `confidence` (`values[dominant]/values.sum()`) was accidentally still correct throughout since it's a ratio either way. Verified via direct API call after the fix: root=360, left child=93, right child=267 (93+267=360, correct).

5. **A real frontend layout bug, self-introduced and caught live.** Initially added a `<AdvanceButton>` "Continue to Train and Test →" in `App.jsx`'s `feature_selection` stage block, following the same pattern used for most other pages. This was wrong and actively broke navigation: `FeatureSelectionPage` **already has its own complete, real, two-stage fixed-position (`position:'fixed', bottom:0`) footer** — first click "✓ Confirm Selection & Save Version" (registers the version), then the same button transforms into "Continue to Training →" which calls `onNext('training', {})` directly. The added App.jsx button sat physically underneath FeatureSelectionPage's own fixed footer in the DOM/stacking order and was completely unclickable (Playwright reported "element intercepts pointer events"). **Removed** the duplicate; `onNext` was already correctly wired to `advance('training')` from the start, so FeatureSelectionPage's own existing button now does the whole job. This is the second time this exact class of mistake happened this session (see DataReadiness.jsx's header-vs-footer button, §1) — **always check whether the page being wired into App.jsx already renders its own complete forward-button flow before adding a new one.**

### Frontend — `frontend/src/pages/TrainTest.jsx` (new file, ~1050 lines)

Structure follows the paint mockup exactly: fixed-position two-panel layout, `display:'flex'`, left panel `width:'34%', minWidth:340, maxWidth:460, position:'sticky', top:0, height:'100vh', overflowY:'auto'`, right panel `flex:1, height:'100vh', overflowY:'auto'` — each scrolls completely independently, `borderRight` divider between them. Settings state lives in this one component and persists for as long as the component stays mounted (App.jsx never unmounts the active page just from TopNav navigation within the same stage, so this matches the "settings persist when going forth and back" requirement as specified — a hard page reload would still reset it, which was implicitly accepted as normal browser behavior, not something asked to survive).

**Left panel, top to bottom, exactly per spec:**
- Model button + Metric button side by side (metric hidden entirely for clustering — a deliberate scoping decision, see below). Model button opens a grouped, scrollable dropdown (`ModelDropdown`) — groups are grey uppercase labels ("Tree-Based", "Linear", "Distance-Based", "Boundary-Based", "Probabilistic" for classification; "Linear", "Ensemble" for regression; "Centroid-Based" for clustering), models are the individual clickable rows, filtered entirely by `projectData.taskType`.
- Decision Tree specifically shows an inline CART(gini)/ID3(entropy) toggle right under the model button when selected.
- K placeholder — appears **only** when KNN or K-Means is selected, positioned exactly where specified ("between Choose Model and the metric button" conceptually — implemented as its own row directly below both, since putting it literally *between* two side-by-side buttons isn't a coherent layout; this is a judgment call, flagged here in case the user wants it repositioned).
- Evaluation Method: Train/Test Split (radio, slider 50–95%, live train/test percentage readout, dataset-size-based suggestion text) vs K-Fold Cross-Validation (radio, editable k number input, Stratified/Not-Stratified dropdown — **the dropdown the user explicitly reminded not to forget**).
- Grid Search CV: toggle switch (custom-styled, matches the Sampling.jsx shuffle-toggle visual convention) + "Edit Attributes Manually" button (always visible regardless of toggle state, per spec). When toggled on: parameter cards pre-filled per model from the user's exact default list (e.g. KNN → distance metric; Decision Tree → criterion/max_depth/min_samples_split; SVM → kernel/C/gamma; etc.), a `+` button to add more, "🔍 Search" (calls `/grid-search`, writes `best:` value in green beside each card), "Apply" (disabled/greyed until a search has actually run, then copies `best_params` into the model's active settings) — the three buttons sit next to each other exactly as specified.
- Decision Threshold slider (classification only) — range input synced with a numeric percentage input, both directions.
- The Train button — label switches "▶ Train and Test" / "▶ Train and Validate" / "▶ Train Clusters" depending on split method and task type.
- Model History — a session-scoped list (`useState`, not persisted server-side beyond the saved `.pkl` files themselves), most recent entry highlighted with a left accent border, each row has a `⋮` menu (`ModelActionsMenu`) offering: View output, Download model (.pkl), Visualize tree (decision-tree models only), Delete from history. Weka's timestamp-on-the-left convention was explicitly copied in, per the user's specific callout of that one detail.

**Right panel:**
- Empty state (no model picked) → centered placeholder.
- KNN/K-Means selected, not yet trained → `ElbowChart` (shared component for both): Recharts `LineChart` with a `Brush` for zoom/pan, precise `Tooltip` on hover, a pulsing green ring around the best-k point (`<animate>` SVG elements), a `ReferenceLine` at best-k, and **click-anywhere-on-the-curve** support (`onClick` on the chart, snaps to the nearest actual k value in the data, updates both the chart highlight and the left panel's K input in the same action).
- Other model selected, not yet trained → icon + model description placeholder.
- After training → `TrainingResults`: metric KPI cards (4-up, using the same left-border-accent `MetricCard` style already established on the Visualization page — explicit prior feedback against plain bordered boxes), optional CV-fold score strip, then **in this fixed order, per spec** ("graphs must be at the bottom"): confusion matrix (custom SVG heatmap, diagonal cells green-tinted/off-diagonal red-tinted by intensity, "Predicted"/"Actual" axis labels) → per-class breakdown table → **the model-specific visualization always last** (decision tree custom recursive zoomable SVG / feature importance horizontal bar chart / sigmoid curve + coefficients table / regression actual-vs-predicted scatter with a red dashed y=x reference line / the custom Naive-Bayes "Bayesian network" diagram / clustering: dataset preview with the new `cluster` column highlighted, cluster scatter map with star-shaped centroids, cluster-size bar chart, entropy KPI card).
- "Edit Output ⚙" button, top-right of the results area (not top-right of the whole *page* — that would violate the bottom-button rule; this is a same-panel per-spec toggle, not page navigation) opens `EditOutputPopup` (confusion matrix / per-class stats / model summary / learning-curve checkboxes, matching what's actually implementable — deliberately excluded Weka options that don't apply here like "output source code" or "supplied test set").

**5 info icons**, exactly where specified: beside the Metric button (all 4 metric definitions + the medical/marketing/general rule of thumb), beside the Model button (one paragraph per algorithm, all 11), beside the Evaluation Method label (Train/Test vs CV vs Stratified, with the "PRISM auto-suggests from your dataset size" note), beside "Grid Search CV" (what it does, that it's optional-but-beneficial, the step-by-step process), beside "Decision Threshold" (the lower/higher trade-off with the cancer-screening/fraud-detection examples). Implemented as a small click-to-open (not hover) popover, `InfoIcon` component, dismissable by clicking anywhere else on the page.

**Creative-liberty decisions made** (the user explicitly invited these — "you can add things from your own that are creative and as analyst"), flagged here in case any need revisiting:
- Metric selector button is hidden entirely for clustering (no ground truth to score against) and its 4 classification-vocabulary options don't apply to regression either conceptually — but the button itself is currently only hidden for `taskType === 'clustering'`, still shown for regression (grid search's `metric_to_sklearn` ignores whatever's selected for regression anyway and always optimizes R², so the regression-mode metric selector is currently vestigial/inert rather than removed — worth tightening if it reads as confusing).
- Naive Bayes gets a custom small "Bayesian network" SVG (one Class node, edges to feature nodes, edge thickness = how much that feature's per-class mean varies relative to its overall spread, computed from `GaussianNB.theta_`) — this is a genuinely NB-specific signal, not a generic importance chart relabeled.
- KNN's "Voronoi diagram" idea (mentioned in the pasted spec's model-category descriptions as a possibility, not a firm requirement) was **not implemented** — KNN's primary interactive visualization is the elbow curve; post-training it gets the same confusion-matrix/metrics treatment as other classifiers, no extra scatter/boundary plot. If the user specifically wants this, it's an open addition, not a bug.
- Confusion matrix, decision tree, and the Naive Bayes network are all custom SVG (matching the established "custom SVG for signature visuals" pattern from the Visualization page's radar/heatmap) rather than a charting library, since none of Recharts' built-ins fit these shapes.

### App.jsx wiring

- `import TrainTestPage from './pages/TrainTest'` added.
- `uploadMeta?.taskType` is now threaded into `projectData` for the Feature Selection and Training stages (`projectData={{ filePath, projectId, targetColumn, taskType: uploadMeta?.taskType }}`) — this field did **not** exist on any page's `projectData` before this session; every other page's `projectData` still omits it (scoped the fix to only where it's actually needed rather than touching all 8 stage blocks).
- `feature_selection` stage block: `onNext` changed from a no-op to `(next) => advance('training')`; the duplicate footer button that was briefly added and then removed is noted above (bug #5).
- New `if (stage === 'training')` block: renders `TrainTestPage` with `projectData`, `getDisplayPath: versionHistory.getDisplayPath` (Training's own `filePath` is `getDisplayPath('training')`, which — since Training never calls `registerVersion` itself, it doesn't transform the dataset — falls back through the existing chain to whatever Feature Selection's own registered version is), `versions`, `active`, `onNavigate`, `furthestOrder`. `onNext`/`onUpdateData` are both no-ops — there's no Report/Feature-Impact page yet to advance into, matching the established "don't fake a transition to a page that doesn't exist" convention used everywhere else in this file.
- `STEP_ORDER.training = 11` already existed in all three mirrors (`backend-django/datasets/models.py`, `useVersionHistory.js`, and — not applicable here since Cleaning doesn't reach Training — `Cleaning.jsx`'s own copy) from a previous session; nothing needed updating there.
- `TopNav.jsx`'s `NAV_LINKS`: `training` entry flipped from `enabled: false` to `enabled: true`, label changed from `'Training'` to `'Train and Test'` to match the page's actual title.

### Testing notes and honest caveats

Backend: every one of the 11 models was trained successfully via direct `curl`/`urllib` calls against controlled synthetic CSVs (a 400-row 3-class imbalanced classification set, a 500-row set with a genuine regression target and a separate ID-like column) — classification, regression, and clustering task types; both split methods; grid search (classification and regression scoring); both elbow endpoints; model download. All verified clean after the 5 bugs above were fixed.

Frontend: multiple full live Playwright passes end-to-end (Upload → ... → Training), zero console errors throughout, including one **fully successful** run showing a trained Decision Tree's confusion matrix, per-class table, metric cards, and (partially, before the fix) tree visualization all rendering correctly.

**Real complication worth knowing about**: this app's dev-mode auth (`App.jsx`'s `bootstrapDevProject()`) always logs into the same fixed account (`cleaning_dev@example.com`) and reuses the same Django project by name lookup, regardless of which browser/session connects. The user was actively using the app in their own browser tab *while* this session's automated Playwright tests were running, and both ended up sharing the same Django project's version history — several test runs picked up the user's own live, larger, differently-shaped real dataset instead of the test session's own upload, causing a few confusing false leads (e.g. a target-column-not-found error that was actually correct behavior, not a Training bug) before this was understood. **This is a pre-existing architectural characteristic, not something addressed or changed this session** — if a future session needs guaranteed test isolation, that would require either a distinct dev account/project per test run or waiting for a moment when the real user isn't actively in the app.

**What was not individually, visually confirmed live** (code-reviewed and backend-contract-verified, but not each separately screenshotted after the shared-session friction made further passes increasingly impractical): the feature-importance bar chart (Random Forest/XGBoost/SVM), the sigmoid curve + coefficients table (Logistic Regression), the regression actual-vs-predicted scatter, the full clustering visualization (scatter+centroids+size histogram+entropy+preview table), the Naive Bayes network diagram, the Edit Output popup, the Edit Attributes Manually popup, and the model-history download/delete actions. All of these consume response shapes that *were* verified correct via direct API calls, and the rendering code was written to match those exact field names/structures — but a final visual sanity pass by the user (or a future session, at a time when the shared dev account isn't in concurrent use) would be worthwhile before calling this fully done.

---

## 7. Complete file inventory for this session

### New files
- `backend-fastapi/utils/__init__.py` — empty, makes `utils` a package.
- `backend-fastapi/utils/balance_checker.py` — `check_target_balance()`, `balance_score()`, `LEVEL_SCORE`.
- `backend-fastapi/training_router.py` — 6 endpoints, see §6.
- `frontend/src/constants/balanceLevels.js` — `getBalanceLevelConfig(C)`.
- `frontend/src/pages/TrainTest.jsx` — the whole Train and Test page, see §6.
- `docs/SESSION_HANDOFF_VIZ_TRAINING_BALANCE.md` — this file.

### Modified files
- `frontend/src/pages/DataReadiness.jsx` — full rewrite, see §1.
- `backend-fastapi/visualization_router.py` — `compute_fingerprint`, `build_algo_recs`, `compute_per_col_histograms`, balance-checker integration, `target_quality` in response. See §1, §4.
- `frontend/src/pages/Cleaning.jsx` — outer card-wrapper styling removed, `PRISMHeader` rounded-corner removed. See §2.
- `frontend/src/pages/Sampling.jsx` — shared `LEVEL_CONFIG` import, regression/invalid-target KPI card branching, `LEVEL_CONFIG.moderate.label` reverted to `'Moderate'`. See §3, §4.
- `backend-fastapi/sampling_router.py` — `check_imbalance`/`imbalance_suggestion`/`_LEVEL_TEXT` deleted, balance-checker integration. See §4.
- `frontend/src/pages/Upload.jsx` — drawer hover states + shadows + info-panel styling, no content/logic changes. See §5.
- `frontend/src/components/TopNav.jsx` — `data_readiness` label → "Visualization"; `training` flipped to `enabled:true`, label → "Train and Test".
- `frontend/src/App.jsx` — `AdvanceButton` label "Continue to Visualization →"; `taskType` added to Feature Selection/Training `projectData`; Feature Selection `onNext` wired to `advance('training')` (duplicate footer button added then removed); new `training` stage block; `TrainTestPage` import.
- `backend-fastapi/main.py` — `training_router` imported and registered.
- `backend-fastapi/requirements.txt` — `xgboost==3.4.1` added.

### Memory files (already saved via the persistent memory system — will load automatically in any new session, no action needed)
- `feedback_continue_button_bottom.md` — the bottom-button standing rule.
- `feedback_literal_data_vs_ui_labels.md` — the Class Moderate lesson.
- `feedback_balance_checker_platform_rule.md` — the shared-utility standing rule.
- `dual_stack_localhost_bug.md` — updated with the inverse Vite-is-IPv6-only note (see §8).

---

## 8. Technical conventions confirmed/reinforced this session (don't rediscover these)

- **Backend URLs**: always `127.0.0.1`, never `localhost` — this machine resolves `localhost` to both `::1` and `127.0.0.1`, and Django/FastAPI bind IPv4-only.
- **Reaching the Vite dev server itself is the inverse**: Vite binds **IPv6-only** on this machine (`curl http://127.0.0.1:5173/` → connection refused; `curl http://localhost:5173/` → 200 OK). When scripting Playwright/curl against the frontend dev server, use `localhost:5173`, not `127.0.0.1:5173`. This only applies to reaching Vite itself — application code's own fetch calls to Django/FastAPI still must use `127.0.0.1`.
- **Windows `uvicorn --reload` (StatReload) is unreliable this session** — repeatedly failed to pick up file edits, serving stale code silently. The reliable fix, used every time: `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'uvicorn|multiprocessing.*spawn_main' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`, wait ~2s, start exactly one fresh `uvicorn main:app --host 127.0.0.1 --port 8001 --reload`, wait for "Application startup complete" in the log, *then* re-test. Don't trust a hot-reload for anything you're about to report as fixed — restart clean and re-verify.
- **Every FastAPI route needs try/except → HTTPException** — Starlette's `ServerErrorMiddleware` sits outside `CORSMiddleware`, so an unhandled exception produces a response with no CORS headers, which the browser reports as a bare, undiagnosable "Failed to fetch." This was true for `cleaning_router_v2.py` (fixed earlier session) and `training_router.py` (fixed this session) — check any new/pasted router for this before trusting it.
- **numpy scalar types silently crash `jsonable_encoder`** — not just `NaN`/`Infinity` (the `safe_round()` pattern already handles those), but also `numpy.bool_` from any direct numpy comparison (`==`, `!=`) left uncast. Explicitly `bool()`/`int()`/`float()` cast anything that came from a numpy array/comparison before it reaches a `return` in a FastAPI handler.
- **Playwright test scripts**: written into the scratchpad directory (`C:\Users\user\AppData\Local\Temp\claude\...\scratchpad\pw\`), reusing the `playwright` npm package + cached Chromium already installed there from earlier sessions. Standard pattern: `chromium.launch()`, `page.on('console', ...)`/`page.on('pageerror', ...)` to catch errors, click through the pipeline stage by stage using `getByText(..., {exact:false})`, screenshot at key points, read screenshots back via the `Read` tool. These are throwaway, session-scoped, never committed.
- **Theme system discipline**: `frontend/src/theme.jsx` is the single source of truth for colors (`useTheme()` → `{C, dark, toggleTheme}`), shared across every page. **Never accept a pasted spec's own hardcoded color palette** — translate its structural/layout intent onto the existing `C` tokens instead. This came up twice this session (Upload drawer, and implicitly for TrainTest.jsx) and is very likely to come up again with any future pasted frontend spec.
- **`getDisplayPath` vs `getInputPath`** (from `useVersionHistory.js`, pre-existing but relevant to how Training resolves its input file): `getDisplayPath(stepName)` flips to that step's own registered output once one exists, else falls back to the nearest strictly-earlier version. `getInputPath(stepName)` never flips — always the nearest strictly-earlier version, used for "before" stats that must stay anchored regardless of whether the current step has run. Training uses `getDisplayPath('training')` since it never registers its own version (it doesn't transform the dataset) and always wants "whatever the latest real upstream step produced."
- **STEP_ORDER is mirrored in 3 places** (`backend-django/datasets/models.py`, `frontend/src/hooks/useVersionHistory.js`, `frontend/src/pages/Cleaning.jsx`'s own internal copy) — `training: 11` already existed in all three before this session, nothing needed updating there, but if a future step is ever added/reordered, all three need the same edit.

---

## 9. Open items for the next session

1. **Encoding & Scaling page horizontal-scroll lockstep bug** — a background verification task was dispatched earlier in this session (before the context compaction that produced this document's parent conversation) to check whether the encoding-dropdown row and scaling-dropdown row stay visually attached to their table columns when the dataset table is scrolled horizontally. **No result from that task was ever seen/acted on in the remainder of the session** — status is genuinely unknown. Needs a fresh check: load a dataset with enough columns to require horizontal scroll on the Encoding page, scroll the table, and see whether the encoding/scaling control rows scroll in lockstep or drift out of alignment.
2. **Train and Test page — final visual sanity pass recommended** (not required, but worth doing when convenient): feature importance charts, sigmoid curve, regression scatter, full clustering visualization, Naive Bayes network diagram, Edit Output popup, Edit Attributes Manually popup, and the model-history ⋮ menu's download/delete actions were verified at the backend-contract level and code-reviewed against those contracts, but not each individually screenshotted live due to the shared-dev-account testing friction described in §6. If the user tries these on their own data and something looks off, that's the first place to check.
3. **No Report / Feature Impact page exists yet** — `STEP_ORDER` reserves `feature_impact: 12, report: 13` but neither is built. Training's `onNext` is currently a no-op with no forward button, matching the established "don't fake a transition to a page that doesn't exist" convention. Building either of these would need the same treatment as Training: read this document plus the other `docs/*.md` files, check what `training_router.py`'s `/train` response already returns (feature importances, model metadata, saved `.pkl` paths) as the likely data source, and apply the same "paint-mockup-if-given, real theme tokens always, try/except everywhere, live-test before reporting done" discipline.
4. **Regression-mode metric selector is currently vestigial** on the Train and Test page (see §6 creative-liberty note) — shown but functionally inert for regression task types since grid search always optimizes R² regardless of what's selected there. Worth either hiding it for regression too or wiring it to something meaningful, if the user notices and asks.
5. Test artifacts accumulated in `backend-fastapi/saved_models/` (many `.pkl` files from this session's testing) and the scratchpad's Playwright driver scripts — both harmless and left in place per this project's established conventions (models persist by design; scratchpad is session-scoped and never committed) — no action needed unless the user asks for cleanup.
