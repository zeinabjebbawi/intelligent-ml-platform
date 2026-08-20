# IntelliML / PRISM — Project Handoff (2026-08-19)

This document exists so a fresh chat can continue this project without the user re-explaining anything. Read it fully before touching code. It captures the *entire* history of what's been built, why, how it was verified, and what's still missing.

Git identity in this repo: `zeinab jebbawi <101230180@mu.edu.lb>`. Repo root: `c:\Users\user\Desktop\Final_cp\intelligent-ml-platform`.

---

## 0. How This Project Actually Gets Built — read this first

The user has a **separate, parallel conversation with Claude (claude.ai chat)** where the actual feature code gets designed and generated — architecture debates, page specs, full source files. The user then pastes that conversation's content (both their own messages and Claude's responses, including full source code) into *this* session, one installment at a time, and the job here is:

1. Read and genuinely understand the pasted chat (not just skim for code blocks).
2. Transcribe/integrate any real code into this actual project.
3. **Actually test everything live** — start real servers, hit real endpoints with curl, run real datasets through it, render real React components against a live backend. Never just trust that pasted code works.
4. Fix real bugs found during testing (see §11 — there is a recurring bug class).
5. Report back in a specific format the user always expects: **what was missing, what I did, whether it's fully done, and what already existed / I didn't need to touch.**

**Critical known issue**: text pasted into this chat sometimes arrives with corrupted encoding — em dashes, arrows, checkmarks, bullets all collapse into mojibake sequences like `â`, `Â·`, `Ã`, `ð` (a UTF-8-interpreted-as-Latin-1 corruption where the *second and third bytes of multi-byte characters often become invisible control characters and are lost*, not just mis-decoded — meaning a simple encoding round-trip cannot always recover them). When this happens the fix is contextual reconstruction (infer whether `â` means an arrow "→" or an em dash "—" from surrounding words), verified by checking zero suspicious characters remain before saving.

**Important discovery from the most recent installment**: when the user references a file via `<ide_opened_file>` (i.e., it's open in their IDE, usually from `Downloads\Telegram Desktop\`), **check the actual file on disk before assuming it's corrupted** — the disk copy is sometimes perfectly clean UTF-8 even when the same content pasted into the chat body got mangled. Use `xxd` or a Python byte check on the real file path first; only do mojibake reconstruction if the disk copy is also corrupted or no disk copy exists.

**When the user asks to "add the backend from this chat"**: they mean literally transcribe what was pasted. Don't invent replacement architecture. But if live testing surfaces a genuine bug the pasted code has (see §11's recurring NaN/numpy-type bug), fix it and *say so clearly* rather than either silently deviating or blindly reintroducing a known crash.

**When something is ambiguous or the scope is unclear/enormous** (this happened once — a message described a whole Cleaning page but only pasted a *summary* of the code, not the code itself, and referenced a routing system that doesn't exist in this project): stop and ask via a clarifying question rather than guessing or authoring a huge amount of original code unprompted. The user appreciated this — they confirmed they had the real code and pasted it next message.

---

## 1. What IntelliML / PRISM Is

A capstone ML platform (branded "IntelliML" in early docs, "PRISM" in the newest backend files — same project, name may still be in flux). Two user-facing modes:

- **Smart Auto mode**: user uploads data, the system does everything (cleaning, model selection, training, evaluation) automatically and explains what it did.
- **Guided/Manual mode**: user configures every step themselves, with rule-based/explanatory help, not automated decisions.

### Platform Philosophy (verbatim rules — these govern every future page, not just Cleaning)

**What it is NOT**: not primarily a training platform; not a tool that hides complexity and hands over answers; not a copy of WEKA (a full redesign of the workflow experience); does not reach ahead into future pipeline stages to generate suggestions on an earlier page.

**What it IS**: a complete ML workflow environment that preserves the full analytical process; helps users understand what they're doing and why; keeps analytical space open for the user to reason and decide; an enhancement of WEKA's logic with better clarity, guidance, and modern UI.

**Three internal user types** (not exposed in the UI — the UI only ever shows "Manual" or "Auto"):
- **Non-technical user** → chooses Auto Mode. System does the work, explains it, delivers readable results.
- **Learner** → chooses Manual Mode. Wants deep visual analysis and guided decision-making; wants explanations/visualizations/statistics/recommendations that help them reason, not think for them.
- **Expert** → chooses Manual Mode. Already knows ML; benefits from intelligent rule-based suggestions without losing control; wants full visibility into every parameter.

**Six global rules that apply to the entire platform:**

1. **Suggestion Discipline** — not every page needs AI suggestions; some only need explanatory guidance. Where suggestions do appear:
   - *Level 1 — Explanatory text only*: describe what data/metric means, no action recommended.
   - *Level 2 — Rule-based suggestions*: simple if/else logic on data properties (e.g. "X% missing — consider imputation"). No AI needed. **This is the level the Cleaning page's normality-based IQR/Z-Score suggestion operates at.**
   - *Level 3 — AI-based suggestions*: only in deliberately chosen places, not applied everywhere by default.

2. **No Reaching Forward** — every suggestion on a page must be derivable *only* from that page's own data/state. A page may never use a later stage's results to suggest something on an earlier stage. Explicitly rejected example: using a trained model's SHAP output to suggest feature removal on a pre-training Feature Selection page.

3. **The "Try-See-Decide" Loop** — applies only to pages explicitly marked with it. On those pages: user makes a choice, immediately sees before/after on the *same screen*, can approve or try something else — without navigating away. Presentation is flexible (inline/side panel/drawer/etc.) but page navigation to see a result is non-negotiable-forbidden. **The Cleaning page's Outliers tab (threshold sliders recompute the chart instantly, no navigation) is a live example of this rule in action.**

4. **Dataset Versioning** — every significant transformation creates a *named, non-overwritten* dataset version the user can inspect/compare/roll back to. Minimum named versions: Original Dataset, Duplicate Removed, Outliers Removed, Missing Values Imputed, Encoded and Scaled, Feature Selected Version, Sampled Version. Applies platform-wide.

5. **Mode Differences** — two exposed modes, Manual and Auto. Manual: user configures every step. Auto: agent does it, user approves/observes. In Manual mode, pages 5–8 collapse into one "Smart Preprocessing" page for Auto. Same underlying ML logic runs in both — the difference is *who* configures it.

6. **ML Methodology Source** — canonical reference for all implementation decisions is `AllFunctions.ipynb` combined with `v6.0-InternProject.html` (external files the user has, not in this repo). These govern preprocessing order/hierarchy, algorithm choices/parameters, evaluation methods, visualization types, logical sequence. The platform borrows the *mindset and hierarchy*, not every specific technical choice (example given: ADASYN was in the reference but was NOT adopted here).

The Cleaning page (§9 below) is "Step 5 of 11" per its own header — meaning an 11-step journey map exists in the user's other conversation, not yet shared here.

---

## 2. Architecture — Four Independent Services

```
React (Vite, :5173)  ⇄  Django (:8080)  ⇄  PostgreSQL
        ⇅                    ⇅
   FastAPI (:8001)  ⇄  ml-core (plain .py, no server)
```

- **Django** (`backend-django/`) — accounts, auth (JWT), projects, file upload, the only service allowed to touch PostgreSQL directly.
- **FastAPI** (`backend-fastapi/`) — all ML computation. Never touches PostgreSQL. Two routers: the original 10-endpoint ML pipeline router in `main.py`, plus the newer 9-endpoint `cleaning_router.py`.
- **ml-core/** (project root, sibling to the backend folders) — plain Python modules (`cleaning.py`, `models.py`, `evaluation.py`, `pipelines.py`), no FastAPI code inside it, imported only by FastAPI. Not the same code as `cleaning_router.py` (see §8.5 — intentional, not a bug).
- **React** (`frontend/`) — Vite + React 19. Talks to Django for accounts/projects/upload, directly to FastAPI for all ML/cleaning work.

Two **separate Python venvs** exist — `backend-django/.venv` and `backend-fastapi/.venv` — with separate `requirements.txt` files. A package needed by Django code (e.g. `requests`, added so Django can call FastAPI) must be installed into Django's venv specifically, and vice versa for ML packages.

### Why Django ↔ FastAPI, not one monolith
Django is the "building manager" (accounts, storage, records); FastAPI is the "lab technician" (only computation). Keeps heavy ML deps (numpy/pandas/scikit-learn/scipy) out of Django's world entirely. Communication is plain HTTP via Python's `requests` library from Django, wrapped in `try/except` so **FastAPI being offline never breaks Django** — uploads still succeed, just without profiling.

---

## 3. ⚠️ Current Git State — NOTHING IS COMMITTED YET

Every single change described in this document (all of Steps 3–10+ of the whole session) is **still sitting as uncommitted working-tree changes**. `git log` only shows 5 pre-existing commits from before this session started (`ac651b3` initial structure through `847f4c5`). Run `git status` immediately in a new session to confirm this is still true — if the user has committed since, treat this section as historical only.

Do not assume anything is "saved" beyond the filesystem. Recommend committing to the user if a natural checkpoint arrives, but per standing instructions **never commit unless explicitly asked**.

---

## 4. Backend: Django (`backend-django/`)

### Apps and models (Step 3 of the original build sequence)
- **`accounts`** — `UserProfile` (OneToOne with Django's `User`). `experience_level` choices are **only `beginner` / `expert`** — the user explicitly had me remove `intermediate` early on (beginner → Auto mode, expert → Manual mode is the intended mapping). Auto-created via `post_save` signal on `User`.
- **`projects`** — `Project` (UUID PK, `mode`: guided_manual/smart_auto, `status`: active/completed/archived) and `WorkflowState` (OneToOne with Project — exactly one state per project; `current_step`, `step_data` JSONField, `completed_steps` JSONField list).
- **`datasets`** — `Dataset` (UUID PK, FK→Project, `profiling_result` JSONField, `health_score` FloatField, `status`: uploaded/profiling/profiled/error) and `DatasetVersion` (FK→Dataset, `version_number`, `version_type`: original/cleaned/encoded/normalized, `unique_together` on dataset+version_number).
- **`experiments`** — `Experiment` (FK→Project, FK→DatasetVersion via `SET_NULL`), `AgentDecision`, `InsightCard`, `WhatIfSimulation`, `Report` — all FK'd appropriately, all UUID PKs, metrics/context stored as JSONField.

**Design rationale** (explained at length to the user, worth remembering if asked again): UUIDs prevent ID-enumeration attacks; JSONField avoids dozens of mostly-null columns for task-type-specific metrics; `DatasetVersion` as its own table (not overwriting) is what makes rollback/reproducibility possible — this is the DB-level expression of Global Rule 4 above.

All migrations exist and were actually applied (`makemigrations` + `migrate`) against a real PostgreSQL database the user set up themselves — confirmed via a live upload test where `Dataset.profiling_result` was verified populated directly from the DB.

### `datasets/views.py` — `DatasetUploadView`
Full upload flow: verify project ownership → save file to `media/datasets/user_<id>/project_<id>/original.csv` → read with pandas for `columns_metadata` → create `Dataset` row → **call FastAPI's `/ml/profile`** wrapped in try/except (ConnectionError caught separately from generic Exception; either way upload still succeeds, `profiling_done: false` returned) → create `DatasetVersion` v1 "original" → return response including a `preview` of the first 5 rows.

**Bug fixed here (recurring pattern, see §11)**: the preview must use `json.loads(df.head(5).to_json(orient='records'))`, **not** `.to_dict(orient='records')` — the latter leaves raw `NaN` in the dict, which Python's `json` encoder rejects with `ValueError: Out of range float values are not JSON compliant`. This exact bug pattern recurred **three separate times** across the session (Django preview, ml-core's `detect_class_imbalance` via `numpy.bool_`, and `cleaning_router.py`'s `profile_duplicates`) — always fixed by casting to native Python types or round-tripping through `.to_json()`.

`datasets/urls.py` was **split into two files** to fix a real routing bug: originally both the upload route and the detail route were mounted via the same `include()` under two different URL prefixes, meaning each accidentally also existed under the other's prefix with the wrong/missing kwargs (would 500 if ever hit). Now:
- `datasets/urls.py` → only `DatasetDetailView`, mounted under `/api/datasets/`.
- `datasets/upload_urls.py` → only `DatasetUploadView`, mounted under `/api/projects/<uuid:project_id>/datasets/`.
Verified live: both intended routes still work, both previously-broken combinations now correctly 404 instead of 500.

### CORS — was broken, now fixed
`corsheaders` was in `INSTALLED_APPS` since an early step but **`CorsMiddleware` was never added to `MIDDLEWARE`**, and `CORS_ALLOWED_ORIGINS` was never set — Django was silently rejecting all cross-origin requests from React this whole time; it just never surfaced because nothing had called Django from a browser yet. Fixed in `core/settings.py`:
```python
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',   # must be this early
    ...
]
CORS_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:3000']
```
Verified live with curl using `Origin` headers — allowed origin gets `Access-Control-Allow-Origin` back, disallowed origin doesn't.

### JWT (SimpleJWT)
Registration sets Django's `username` = the user's email. Access token: 24h. Refresh token: 7 days, **rotates** on every refresh (`ROTATE_REFRESH_TOKENS: True`). Endpoints: `/api/auth/register/`, `/api/auth/login/` (body key is `username`, even though it's an email), `/api/auth/token/refresh/`, `/api/auth/profile/`.

### requirements.txt — recurring encoding issue
`backend-django/requirements.txt` (and `backend-fastapi/requirements.txt`, and the mojibake in every pasted code file) is part of the same root cause: **files were repeatedly found saved as UTF-16 instead of UTF-8** — this was fixed multiple times (each time it silently reverted; always re-check encoding with `xxd` before trusting `cat`/`Read` output looks right, especially after any tool that might rewrite the file). Current confirmed packages: `asgiref`, `Django==6.0.5`, `django-cors-headers==4.9.0`, `djangorestframework`, `djangorestframework_simplejwt`, `numpy`, `pandas`, `psycopg2-binary` (swapped from plain `psycopg2` — no C compiler available for the source build), `PyJWT`, `python-dateutil`, `python-dotenv`, `requests==2.32.3` (added for the FastAPI bridge), `six`, `sqlparse`, `tzdata`.

### `.env` / `.env.example`
`backend-django/.env` exists with real DB credentials (user created it themselves, verified working — `migrate` reports "no migrations to apply" against a live DB). `.env.example` committed instead with just key names: `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`.

---

## 5. Backend: FastAPI (`backend-fastapi/`)

### `main.py` — original 10-endpoint ML pipeline router
`GET /health`, `POST /ml/profile`, `/ml/recommendations`, `/ml/clean/auto`, `/ml/clean/step`, `/ml/train`, `/ml/auto`, `/ml/elbow`, `/ml/what-if/predict`, `/ml/what-if/contributions`. All wired to `ml-core` functions (imported via `sys.path.insert` pointing at the sibling `ml-core/` folder — the exact mechanism is documented in `docs/architecture_deep_dive.html` §2). Every endpoint tested live over real HTTP with a real messy CSV — all pass, including error paths.

### `cleaning_router.py` — NEW, added this session, 9 endpoints under `/cleaning/`
This is the backend for the Cleaning page specifically (see §9). Registered into `main.py` via:
```python
from cleaning_router import router as cleaning_router
app.include_router(cleaning_router)
```
Full endpoint table is in §9.2. **Bug fixed**: `profile_duplicates` had the exact same raw-NaN-via-`.to_dict()` bug described above — fixed the same way (`json.loads(df.to_json(...))`).

**Architectural note, not a bug**: `cleaning_router.py` has its own self-contained helpers (`check_normality`, `base_stats`, `save_version`) that are separate from and do not reuse `ml-core/cleaning.py`'s equivalents (which also has a `check_normality`). This is a real duplication — worth a future refactor to unify them — but was left as-is since it wasn't asked to be merged and both independently work correctly (verified by testing both).

### Sample data
`backend-fastapi/sample_data/sample.csv` — a generated demo CSV (250 rows, has duplicates, one outlier in an otherwise normal column, one outlier in a skewed column, missing values in two columns) created so the user has something to immediately load into the Cleaning page. **Gitignored** (`backend-fastapi/sample_data/` added to `.gitignore`) since it's random generated test data, not source.

### `.env` / `.env.example`
No real `.env` created yet (nothing currently needs `DEEPSEEK_API_KEY`). `.env.example` has just `DEEPSEEK_API_KEY=your_key_from_supervisor_here`.

---

## 6. `ml-core/` — plain Python ML logic (project root)

Four files, no `.venv` of its own — imported by FastAPI's venv. Built across several installments; all four are complete:

- **`cleaning.py`** (23 functions, 7 sections): `load_data`, profiling helpers (`get_column_metadata`, `detect_class_imbalance`, `compute_correlations`, `count_outliers_per_column`, `profile_dataset`, `compute_health_score`), missing-value handlers (course-derived, all fixed to `df.copy()` instead of `inplace=True` — critical for dataset versioning), outlier handling (`check_normality` using Shapiro-Wilk/D'Agostino, `detect_outliers_zscore`, `remove_outliers_zscore`, `remove_outliers_iqr`), structural ops, encoding/normalization, and `build_auto_clean_config` + `auto_clean` (the Auto-mode orchestrator — decides Z-score vs IQR **per column** based on that column's own normality test, not a single global choice).
- **`models.py`** (13 functions): train every algorithm (KNN, Decision Tree, Random Forest, Logistic/Linear Regression, SVM, K-Means), `detect_task_type`, `recommend_models` (with plain-language reasons, excludes KNN/SVM above dataset-size thresholds), `get_model_by_name` factory, `run_tournament` (survives a single algorithm failing without crashing the whole run), `save_model`/`load_model`.
- **`evaluation.py`** (12 functions): `evaluate_classification/regression/clustering`, `get_precision/recall/f1`, `get_feature_importance`, `get_elbow_data`, `predict_what_if`, `get_feature_contributions` (What-If Simulator support).
- **`pipelines.py`** (8 functions): pure orchestration, no math of its own — `split_features_target`, `split_train_test`, `scale_features`, `run_cleaning_step` (Guided mode, one atomic op at a time), `run_full_pipeline`, `run_auto_pipeline` (Auto mode, returns `agent_decisions` transparency log), `generate_pipeline_summary`, `compare_experiments`.

**Bug fixed**: `detect_class_imbalance` in `cleaning.py` computed `is_imbalanced` via a numpy comparison, producing `numpy.bool_` (not JSON serializable) — fixed with explicit `bool(...)` cast, plus hardened two adjacent fields with `float()`/`int()` for the same reason.

**Package setup**: flat structure confirmed correct by the user's other conversation (NOT a nested `ml_core/` package — that was a mistake in an earlier message, corrected). `setup.py` uses `py_modules=['cleaning','models','evaluation','pipelines']`, installed via `pip install -e .` from inside `ml-core/` with FastAPI's venv active. **`ml-core/__init__.py` exists but is dead code** — confirmed by testing that `import ml_core` fails (`No module named 'ml_core'`) since `ml-core` has a hyphen and can never be imported as a package under that name; everything actually goes through direct `from cleaning import ...` style imports. Harmless, just worth knowing if asked why it's unused.

All four files were validated by **actually running** `run_full_pipeline` and `run_auto_pipeline` end-to-end against a realistic messy synthetic dataset (missing values, duplicates, an outlier, categorical column, imbalanced target) — every mode (specific algorithm, `'tournament'`, `'knn'` triggering the elbow curve), every Guided-mode atomic step, and both utility functions all passed.

---

## 7. Frontend (`frontend/`) — migrated from CRA to Vite this session

The user explicitly asked to replace Create React App with Vite. Full migration completed and verified:

- Removed: `react-scripts`, `web-vitals`, `public/index.html`, `src/index.js`, `src/App.js`, `src/App.test.js`, `src/reportWebVitals.js`.
- Added: `vite`, `@vitejs/plugin-react`, **Vitest** (replacing Jest, since Vite has no built-in test runner) — `frontend/index.html` (Vite's entry point, now at project root, not `public/`), `src/main.jsx`, `vite.config.js` (declares `server.port: 5173` explicitly, and the Vitest `test` block: `environment: 'jsdom', globals: true, setupFiles: ['./src/setupTests.js']`).
- `package.json` scripts are now `dev` / `build` / `preview` / `test` (not `start`/`eject`). `"type": "module"` added.
- Fresh `npm install` went from CRA's 1319 packages down to **280** (later 320 once `recharts` was added for the Cleaning page).
- Verified live: `npm run dev` serves correctly on **port 5173** (auto-increments to 5174+ if occupied — this happened once from a leftover stray process; killing it and restarting fixed it), `npm run build` produces a working production bundle, `npm test` (Vitest) passes.

### `src/api.js`
Two `axios` instances — `djangoAPI` (baseURL `:8080`) and `mlAPI` (baseURL `:8001`). `djangoAPI` has a request interceptor that reads `access_token` from `localStorage` and attaches `Authorization: Bearer <token>` automatically; `mlAPI` deliberately has no such interceptor (FastAPI endpoints don't require login). Exports `authAPI`, `projectsAPI`, `datasetsAPI`, `mlOpsAPI` as pre-built call functions. Verified via a real Jest/Vitest smoke test (since deleted after confirming it passed) that every export resolves and baseURLs are correct.

### `src/setupTests.js`
Imports `@testing-library/jest-dom/vitest`. **Also now includes a `ResizeObserver` polyfill** — jsdom doesn't implement this Web API, but Recharts' `<ResponsiveContainer>` requires it and throws `ResizeObserver is not defined` without the stub. This was discovered while testing the Cleaning page and is now a permanent, reusable fix for any future chart-heavy page tested in this project.

### `src/App.jsx` — currently a TEMPORARY harness, not the real app
No routing system exists in this project yet. The real `App.jsx`/`JourneyMap.jsx` routing code lives in the user's other conversation and has not been pasted here. Current `App.jsx` is explicitly commented as temporary: a form where the user types a CSV file path that already exists on disk, then renders `<CleaningPage projectData={{filePath}} onNext={...} onUpdateData={...} />` directly. This exists purely so the user can view/use the real Cleaning page in a browser. **Replace this file wholesale, don't merge into it, once the real routing code is provided.**

`src/App.test.jsx` was updated to match (tests the loader form renders, not the old CRA "Learn React" link).

---

## 8. Package/dependency state — exact current versions

**`frontend/package.json`** dependencies: `axios@^1.7.9`, `react@^19.2.6`, `react-dom@^19.2.6`, `recharts@^2.15.0` (note: recharts 2.x is EOL/deprecated upstream in favor of v3 — installed 2.x deliberately since `Cleaning.jsx`'s API usage matches v2 shapes; a future v3 migration is a known possible upgrade, not urgent). devDependencies: testing-library packages, `@vitejs/plugin-react`, `jsdom`, `vite@^6.0.7`, `vitest@^2.1.8`. **`lucide-react` is NOT installed and NOT needed** — despite the originating chat's integration notes mentioning it, `Cleaning.jsx` actually uses plain Unicode/emoji characters for icons, not lucide-react components.

---

## 9. THE CLEANING PAGE — full detail (explicitly the part the user most wants remembered)

### 9.1 What it is and where it fits
"Step 5 of 11" in the (not-yet-shared) journey map. Backend: `backend-fastapi/cleaning_router.py`. Frontend: `frontend/src/pages/Cleaning.jsx` (~1450 lines), default export `CleaningPage`. Called with props `{ projectData: { filePath }, onNext, onUpdateData }` — `onNext('encoding', { cleanedFilePath: filePath })` is what it calls when the user clicks through to the next stage (an Encoding & Scaling page that does not exist yet).

Both files were pasted into the chat with corrupted encoding, but **the actual files on the user's disk (`Downloads\Telegram Desktop\cleaning_router (1).py` and `Cleaning (1).jsx`) were perfectly clean UTF-8** — copied directly from disk rather than reconstructed. This is the case referenced in §0's "check disk first" note.

### 9.2 Backend endpoints (`cleaning_router.py`, prefix `/cleaning`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/cleaning/profile-duplicates` | POST | Scan for duplicates; returns full row preview (first 2000 rows) with a `_is_dup` flag per row, plus counts |
| `/cleaning/remove-duplicates` | POST | Drops all duplicates, saves `..._dup_removed.csv` |
| `/cleaning/profile-outliers-global` | POST | Per-column normality test (Shapiro-Wilk n≤5000 / D'Agostino-Pearson n>5000) → suggests zscore/iqr per column; PCA (2 components) + IsolationForest on a 600-row sample for the scatter plot; outlier score index plot |
| `/cleaning/profile-outliers-column` | POST | Full detail for one column: stats (mean/std/median/Q1/Q3/IQR/min/max + pre-computed default bounds), suggested method + p-value, all values (all outliers kept + up to 1500 sampled normals), histogram bins |
| `/cleaning/remove-outliers` | POST | Drops a specific, user-chosen list of row indices (not "all outliers" — see §9.4), saves `..._outliers_removed.csv` |
| `/cleaning/profile-missing-global` | POST | Bar chart data per column (present/missing/%/type), missing matrix (sampled to 250 rows), row-completeness distribution |
| `/cleaning/apply-row-threshold` | POST | `df.dropna(thresh=min_present)` — drops rows with too many missing values, saves `..._rows_filtered.csv` |
| `/cleaning/apply-missing-column` | POST | Per-column imputation: `mean` \| `mode` \| `knn` (via `KNNImputer`) \| `interpolation` \| `drop_rows` \| `drop_column`. Saves `..._missing_imputed.csv` |
| `/cleaning/download` | GET | Streams the CSV at a given `file_path` back as a file download with a custom `filename` |

**Versioning helper** (`save_version`): strips any of the suffixes `_dup_removed`, `_outliers_removed`, `_missing_imputed`, `_rows_filtered` from the base filename before appending the new one, so repeated operations don't chain into absurdly long filenames — always `<original_base>_<newsuffix>.csv`.

All 9 endpoints were tested live against a real messy CSV (duplicates, a genuinely skewed column, a normal-ish column with one extreme outlier, missing values in two columns) — every method, every error path (`400` for unknown method, `404` for missing file). One bug found and fixed (`profile_duplicates` NaN crash, see §11). One documented non-bug limitation: **linear interpolation cannot fill *leading* missing values** (no prior data point to interpolate from) — the endpoint honestly reports `after_missing` unchanged in that case rather than pretending success.

### 9.3 Frontend structure (`Cleaning.jsx`)

Three floating circular tab buttons (Duplicates / Outliers / Missing Values) positioned top-right above a white content card, with a small "notch" connector div linking the active tab to the card — matches a sketch the user provided. Design tokens live in a `C` object at the top (indigo primary `#6366f1`, amber/red for outlier severity, light theme throughout).

**Duplicates tab** (`DuplicatesTab`): calls `profile-duplicates` on mount, shows stat badges (total/duplicate/clean rows), a vertically-scrollable full dataset table with duplicate rows amber-highlighted (left border + background tint), a "Remove All N Duplicates" button, then a download button after removal.

**Outliers tab** (`OutliersTab`) — the most complex tab:
- **Global view** (no column selected): two side-by-side chart cards — PCA scatter (Recharts `ScatterChart`, indigo=normal/red=outlier) and an Outlier Score Index plot (row index vs normalized IsolationForest score). A collapsible `ColumnPanel` lists every numeric column with its outlier count badge; clicking a column auto-collapses the panel and loads that column's detail.
- **Column detail view**: shows the normality test result (is_normal + p-value + test name) as a badge, then two method buttons (Z-Score / IQR) — **whichever matches the column's own normality test is marked "★ Suggested"**, but the user can freely override it (this is the Level-2 rule-based-suggestion pattern from Global Rule 1). A **threshold slider** next to the method buttons (Z: 1.5–4.0 default 3.0, or IQR multiplier: 0.5–3.0 default 1.5) — **moving it recomputes outliers entirely client-side, no API call**, satisfying the Try-See-Decide Loop rule.
- **Two chart types**, switchable via tab buttons at top-right of the chart area: **Histogram** (Recharts `BarChart` with amber solid lines for IQR bounds and pink dashed lines for Z-Score bounds shown *simultaneously* for comparison, plus a green shaded "normal zone" `ReferenceArea`) and **Strip Plot** (hand-built SVG, not Recharts — every value is an individual dot, jittered vertically via a deterministic sine-based function keyed on row index so positions are stable across re-renders; outlier dots are large and red/clickable, non-outliers are small and semi-transparent indigo; clicking a red dot toggles it to gray "kept" state).
- **Outlier table** below the chart: Row#, Value, Score, Upper/Lower badge, a Remove/Keep toggle button per row — **fully synchronized bidirectionally with the chart** (click a dot → table row toggles; click a table checkbox-equivalent → dot color changes). A live count summary ("N detected · N to remove · N kept") and a "Reset selections" button.
- **Removal**: the frontend computes the final list of row indices to remove (outliers whose dot/row is still red, i.e. not in the `keptRows` Set) and sends *exactly those indices* to `/cleaning/remove-outliers` — this is deliberately different from "remove all outliers in this column," preserving user judgment per-row.

**Missing Values tab** (`MissingTab`): calls `profile-missing-global` on mount. A **row-completeness filter** control up top: a slider for "minimum present values per row," live-updating a count of how many rows would be dropped, with an "Apply Row Filter" button calling `apply-row-threshold`. Below that, a **swipeable gallery** (touch swipe + explicit buttons) alternating between a non-null-ratio bar chart (color-coded gray/amber/red by missing severity) and a hand-built SVG "missing matrix" (missingno-style: dark cell = present, light = missing, plus a right-side completeness sparkline bar per row, sampled to 250 rows for render performance). Below the gallery, a **per-column table**: column name, type badge (numerical/categorical), missing count, missing %, a method dropdown **context-filtered by column type** (KNN/mean/interpolation only offered for numerical columns; mode/drop always available), an "Apply" button per row, and a before→after missing-count readout once applied.

**Every tab has a download button** after its action completes, hitting `/cleaning/download` with a meaningful filename (e.g. `dataset_duplicates_removed.csv`, `dataset_outliers_removed_<column>.csv`, `dataset_missing_imputed.csv`).

### 9.4 Why individual-row-index removal, not bulk removal
This is a deliberate design point carried over verbatim from the originating conversation and worth remembering: outlier removal never means "delete everything IQR/Z-Score flags" — it means "delete exactly the rows the user, after visual inspection, left marked red." The frontend always computes and sends explicit row indices; the backend's `remove-outliers` endpoint just does `df.drop(index=rows_to_remove, errors='ignore')`. This directly serves the philosophy's "preserve the user's analytical space" principle.

### 9.5 Bugs found and fixed in the Cleaning page specifically
1. **`profile_duplicates` NaN crash** (backend) — same pattern as everywhere else this session; fixed with `json.loads(df.to_json(...))`.
2. **`ResizeObserver is not defined`** (test environment) — jsdom gap, not a real-browser bug; fixed by adding a polyfill to `setupTests.js` (permanent fix, benefits future chart pages too).
3. **`border`/`borderTop` shorthand-mixing React warning** — two places in `Cleaning.jsx` (`StatBadge` component and the tab "notch connector" div) set the `border` shorthand *and* `borderTop` longhand in the same style object, which React warns can cause inconsistent styling across re-renders (the shorthand resets all border-* longhands when the CSSOM applies it). Fixed both by splitting into explicit `borderLeft`/`borderRight`/`borderBottom`/`borderTop`.

### 9.6 Known-but-not-fixed minor issue
`Cleaning.jsx` imports `{ mlAPI } from '../api'` at the top but **never actually uses it** — all real calls go through a local `callCleaning()` helper using raw `fetch()` hardcoded to `http://localhost:8001`. Harmless dead import, not worth a churn-only fix, but mention if asked why `mlAPI` appears unused.

### 9.7 How the Cleaning page was verified (not just pasted)
A real Vitest integration test (`Cleaning.integration.test.jsx`, written temporarily then deleted after passing — not committed to the repo) rendered the actual `CleaningPage` component with a real CSV path and let it make genuine `fetch()` calls to a live `uvicorn` instance running `cleaning_router.py` — no mocking. All three tabs were exercised: Duplicates (badges render with real counts), Outliers (global view loads, clicking the "age" column drills in and shows the real normality-test badge), Missing Values (badges render with real counts). This is what surfaced bugs #2 and #3 above. After the fixes, `npm run build` was also run with `Cleaning.jsx` reachable from the entry point (via the temporary `App.jsx` harness) — **703 modules transformed** successfully (up from ~31–44 when nothing imported it), confirming the whole import graph (including `recharts`) resolves and compiles cleanly in the real production build pipeline.

### 9.8 Current live-viewing setup
`frontend/src/App.jsx` (temporary harness, see §7) lets the user paste a CSV file path and view the real Cleaning page. A ready-made demo file exists at `backend-fastapi/sample_data/sample.csv` (256 rows, duplicates + outliers + missing values pre-baked in) — the user can paste its absolute path into the loader form. To run: FastAPI (`uvicorn main:app --port 8001 --reload`, no `--reload` was used during testing sessions but is fine for normal dev) and `npm run dev` in `frontend/`. **Django is not required** to view/use the Cleaning page — it talks to FastAPI directly.

At the moment this handoff was written, both `backend-fastapi` (port 8001) and the Vite dev server (port 5173) were left **running** from the previous turn — check `netstat` in a new session before assuming ports are free; they may have been closed by the user since, or may still be occupied by stale processes.

---

## 10. Documentation already written (all in `docs/`, all local HTML files, not published Artifacts)

- `docs/ml_core_explained.html` — every function in `cleaning.py`/`models.py`/`evaluation.py`/`pipelines.py`, reused/adapted/new classification, purpose, I/O.
- `docs/ml_core_pipeline_steps_reference.html` — the 10-step execution diagram from CSV upload through training hand-off, one card per step with receives/returns.
- `docs/fastapi_backend_explained.html` — what FastAPI is, Django-vs-FastAPI responsibility table, the three core concepts (routes/Pydantic/HTTPException), request lifecycle, every endpoint in `main.py`, running instructions.
- `docs/architecture_deep_dive.html` — the big one: full system diagram, Django↔FastAPI connection mechanics, frontend↔backend connection (`api.js`), database/migrations, JWT end-to-end, CORS (including documenting the fix), full CSV-upload-to-What-If-Simulator pipeline walkthrough, env vars, day-to-day running instructions, file map, beginner-pitfalls list.
- `docs/architecture.md` — pre-existing, empty, from before this session (never touched).
- **This file** (`docs/PROJECT_HANDOFF.md`) — new, written to hand off to a fresh chat.

All were authored directly in clean UTF-8 except the first three, which were reconstructed from corrupted chat-pasted source material and verified to have zero suspicious characters remaining before saving.

---

## 11. The Recurring Bug Class — read this before writing any new backend endpoint

**Every single new endpoint that returns raw pandas/numpy data must be checked for this.** Found and fixed independently **four times** this session:

1. Django's dataset-upload preview (`.to_dict()` on rows with NaN).
2. `ml-core/cleaning.py`'s `detect_class_imbalance` (`numpy.bool_` from a numpy comparison).
3. `cleaning_router.py`'s `profile_duplicates` (`.to_dict()` on rows with NaN) — the pasted code had *reintroduced* the same class of bug that had already been fixed once in Django, in a brand-new file.

**The rule going forward**: any endpoint returning raw DataFrame row data must go through `json.loads(df.to_json(orient='records'))`, never `.to_dict(orient='records')` directly, whenever the columns involved might contain NaN. Any endpoint returning individual scalar values derived from numpy/pandas computations (comparisons, aggregates) must explicitly cast with `int()`/`float()`/`bool()` — numpy's own `int64`/`float64`/`bool_` types are not universally JSON-safe (`float64` happens to subclass Python's `float` so it's usually fine; `int64` and `bool_` are not subclasses of `int`/`bool` and reliably break `json.dumps`).

---

## 12. Pending / Not Yet Done

- **The real `App.jsx` / `JourneyMap.jsx` routing system** — exists in the user's other conversation, not yet pasted here. Current `App.jsx` is a throwaway harness (§7).
- **Every other journey-map page**: Upload, Diagnose, Encoding & Scaling (the Cleaning page's "next" button already points at it by name), Goal Selection, Training, Results, What-If Simulator UI, Reports. None built yet on the frontend (the FastAPI *backend* endpoints for most of these already exist in `main.py` and are tested — it's the React pages that don't exist).
- **Unifying `cleaning_router.py`'s helpers with `ml-core/cleaning.py`'s** — real duplication, not urgent, noted in §5.
- **`lucide-react`** — mentioned in the originating chat's integration notes as needed; confirmed NOT actually needed (Cleaning.jsx doesn't use it). Don't install it unless a future page actually imports from it.
- **Recharts v3 migration** — v2.x is installed and works; upstream considers v2 unmaintained. Not urgent.
- **Nothing has been committed to git** (§3) — flag this to the user if they seem to assume otherwise.

## 13. Quick-Reference: Running Everything

```
Terminal 1 (Django):   cd backend-django   && .venv\Scripts\Activate && python manage.py runserver 8080
Terminal 2 (FastAPI):  cd backend-fastapi  && .venv\Scripts\Activate && uvicorn main:app --port 8001 --reload
Terminal 3 (React):    cd frontend         && npm run dev
```
Django admin: `http://localhost:8080/admin`. FastAPI interactive docs: `http://localhost:8001/docs`. React: `http://localhost:5173` (or next free port).
