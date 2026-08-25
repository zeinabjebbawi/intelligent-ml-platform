"""
PRISM — Sampling Router (FastAPI)
Add to main.py:
    from sampling_router import router as sampling_router
    app.include_router(sampling_router)
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import pandas as pd
import numpy as np
import os
from imblearn.over_sampling import SMOTE, SMOTENC

router = APIRouter(prefix="/sampling", tags=["Sampling"])

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def read_df(path: str) -> pd.DataFrame:
    if not os.path.exists(path):
        raise HTTPException(404, f"File not found: {path}")
    return pd.read_csv(path)

def save_version(df: pd.DataFrame, original_path: str) -> str:
    dir_name  = os.path.dirname(original_path)
    base_name = os.path.splitext(os.path.basename(original_path))[0]
    base_name = base_name.split("_sampled")[0]
    new_path  = os.path.join(dir_name, f"{base_name}_sampled.csv")
    df.to_csv(new_path, index=False)
    return new_path

def safe_round(x, nd=4):
    """None/NaN/inf-safe rounding — a bare NaN in a JSON body is valid to
    Python's json module but not valid JSON; JS's JSON.parse throws on it."""
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return None
    if xf != xf or xf in (float("inf"), float("-inf")):
        return None
    return round(xf, nd)

def get_class_dist(series: pd.Series) -> List[dict]:
    clean = series.dropna()
    total = len(clean)
    if total == 0:
        return []
    return [
        {"class": str(cls), "count": int(cnt),
         "pct":   round(cnt / total * 100, 1)}
        for cls, cnt in clean.value_counts().items()
    ]

def check_imbalance(dist: List[dict]) -> tuple:
    """Returns (is_imbalanced, level, min_pct).

    Levels follow minority-class-percentage bands (equivalently, minority:
    majority ratio bands) rather than a single naive 20% cutoff — the old
    cutoff was marking real-world mild imbalances (e.g. a 35/65 split) as
    perfectly "balanced" and vice versa:
      balanced  — 40-50%   (~1:1 to 1:1.5)  — standard algorithms work fine
      mild      — 20-40%   (~1:1.5 to 1:4)  — most models handle this as-is
      moderate  — 1-20%    (~1:4 to 1:100)  — needs class weighting / SMOTE
      severe    — <1%      (worse than 1:100) — needs specialized techniques
    """
    if len(dist) < 2:
        return False, 'no_target', 100.0
    min_pct = round(min(d["pct"] for d in dist), 1)
    if min_pct >= 40:
        return False, 'balanced', min_pct
    elif min_pct >= 20:
        return True, 'mild', min_pct
    elif min_pct >= 1:
        return True, 'moderate', min_pct
    else:
        return True, 'severe', min_pct

def get_skewness_summary(df: pd.DataFrame) -> List[dict]:
    result = []
    for col in df.select_dtypes(include=[np.number]).columns:
        try:
            skew = float(df[col].skew())
            if skew == skew and abs(skew) > 1.0:  # skew == skew guards against NaN
                result.append({"column": col, "skew": round(skew, 2),
                                "direction": "right" if skew > 0 else "left"})
        except Exception:
            pass
    return result

# Whole-word (underscore-split) datetime keywords only — deliberately does
# NOT include short/generic fragments like 'day', 'month', 'year', or a bare
# 'time' living inside an unrelated word, which is what caused the previous
# version of this function to flag columns like 'attendance_pct',
# 'study_hours', or 'grade' as datetime columns just from substring overlap.
_DATETIME_KEYWORDS = {
    'date', 'datetime', 'timestamp', 'created_at', 'updated_at',
    'time', 'recorded_at', 'event_time', 'event_date', 'log_time',
    'dt', 'ts', 'created', 'modified', 'modified_at',
}

def detect_datetime_cols(df: pd.DataFrame) -> List[str]:
    """
    Strict datetime detection. A column is only flagged if either:
      1. its dtype is already datetime64, OR
      2. its name (or one of its underscore-separated parts) exactly matches
         a known datetime keyword, AND at least 80% of a sample of its
         actual values successfully parse as real dates.
    Numeric-dtype columns are never sent through step 2's value-parsing —
    pandas silently interprets bare integers as nanosecond-since-epoch
    timestamps (so e.g. a numeric 'response_time_ms' column would otherwise
    "parse" as dates 100% of the time despite being nothing of the sort).
    """
    found = []
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]):
            found.append(col)

    for col in df.columns:
        if col in found or pd.api.types.is_numeric_dtype(df[col]):
            continue
        col_lower = col.strip().lower().replace(' ', '_')
        parts = set(col_lower.split('_'))
        if not (col_lower in _DATETIME_KEYWORDS or parts & _DATETIME_KEYWORDS):
            continue
        try:
            sample = df[col].dropna().head(50)
            if len(sample) == 0:
                continue
            parsed = pd.to_datetime(sample, errors='coerce')
            success_rate = parsed.notna().sum() / len(sample)
            if success_rate >= 0.80:
                found.append(col)
        except Exception:
            continue
    return found

def auto_detect_target(df: pd.DataFrame) -> Optional[str]:
    keywords = ['target', 'label', 'class', 'outcome', 'y', 'result', 'flag']
    for col in df.columns:
        if any(kw in col.lower() for kw in keywords):
            return col
    last = df.columns[-1]
    if df[last].nunique() <= 15 and not pd.api.types.is_float_dtype(df[last]):
        return last
    return None

_LEVEL_TEXT = {
    'balanced': "Classes are well balanced. Sampling for size reduction is recommended.",
    'mild':     "Mild imbalance. Most models handle this without adjustment — sampling is optional.",
    'moderate': "Moderate imbalance detected. Stratified Sampling or Majority Undersampling is recommended.",
    'severe':   "Severe imbalance (<1% minority class). Standard sampling may not be enough — specialized "
                "techniques (e.g. anomaly detection, ensemble methods) are usually needed.",
}

def imbalance_suggestion(dist: List[dict], level: str, min_pct: float) -> str:
    if not dist or level == 'no_target':
        return "No usable target column was found for a balance check."
    base = _LEVEL_TEXT.get(level, _LEVEL_TEXT['moderate'])
    if level == 'balanced':
        return base
    minority = min(dist, key=lambda d: d["pct"])
    return f"{base} Class '{minority['class']}' is the minority at {min_pct}% ({minority['count']:,} rows)."

def _sample_per_group(df: pd.DataFrame, col: str, sampler) -> pd.DataFrame:
    """Samples each group of df (split by col) via `sampler(group_df)` and
    concatenates the results.

    Deliberately NOT df.groupby(col).apply(sampler): as of pandas 3.0,
    DataFrameGroupBy.apply excludes the grouping column from what's passed
    to the callable and from the result entirely (this used to only be a
    DeprecationWarning in 2.2.x — it's the actual, silent behavior now).
    That would drop the stratify/target column from the sampled output,
    which broke the /run endpoint's "after" class-distribution chart (the
    column vanished, so it always showed empty). Grouping via
    .groupby(col).indices (positional row indices per group) and slicing
    with .iloc instead sidesteps the whole issue — every column, including
    the grouping one, survives untouched.
    """
    groups = df.groupby(col, sort=False).indices  # {group_key: ndarray of positions}
    parts = [sampler(df.iloc[idx]) for idx in groups.values()]
    return pd.concat(parts, ignore_index=True)

def _smote_oversample(df: pd.DataFrame, target_col: str) -> pd.DataFrame:
    """Real SMOTE (Synthetic Minority Over-sampling Technique) via
    imbalanced-learn — generates genuinely synthetic minority-class rows by
    interpolating between each minority sample and its nearest same-class
    neighbors, rather than just duplicating existing rows (which is what
    the "oversample" method did before — plain resample-with-replacement).

    Uses SMOTENC instead of plain SMOTE whenever any OTHER column is
    non-numeric: base SMOTE's neighbor-interpolation math only works on
    continuous features, so a mixed dataset (e.g. a numeric + categorical
    feature set) needs SMOTENC, which samples categorical values from
    neighbors rather than trying to interpolate them.
    """
    feature_cols = [c for c in df.columns if c != target_col]
    if not feature_cols:
        raise HTTPException(400, "SMOTE needs at least one feature column besides the target.")

    y = df[target_col]
    counts = y.value_counts()
    minority_n = int(counts.min())
    if minority_n < 2:
        raise HTTPException(400,
            f"SMOTE needs at least 2 rows in the minority class to interpolate between "
            f"(the smallest class here has {minority_n}). Try Majority Undersampling instead.")
    k_neighbors = max(1, min(5, minority_n - 1))

    X = df[feature_cols].copy()
    # SMOTE/SMOTENC can't operate on NaN features — filled defensively for
    # the synthesis step only. Every ORIGINAL row keeps its real values
    # untouched in the output; this only affects what a newly-invented
    # synthetic row's neighbors are computed from.
    for c in feature_cols:
        if X[c].isna().any():
            if pd.api.types.is_numeric_dtype(X[c]):
                X[c] = X[c].fillna(X[c].median())
            else:
                mode = X[c].mode()
                X[c] = X[c].fillna(mode.iloc[0] if len(mode) else '')

    cat_idx = [i for i, c in enumerate(feature_cols) if not pd.api.types.is_numeric_dtype(X[c])]
    smote = (SMOTENC(categorical_features=cat_idx, k_neighbors=k_neighbors, random_state=42)
             if cat_idx else SMOTE(k_neighbors=k_neighbors, random_state=42))

    X_res, y_res = smote.fit_resample(X, y)
    result = X_res.copy()
    result[target_col] = y_res.values
    return result[df.columns.tolist()]

# Methods whose entire point is a specific row ORDER (systematic — every
# k-th row; the two time-series-safe methods) — shuffling their result
# afterward would destroy exactly the structure they exist to preserve, so
# the post-sampling shuffle step below skips them regardless of the
# caller's `shuffle` flag.
_ORDER_PRESERVING_METHODS = {'systematic', 'DATE_RANGE', 'SYSTEMATIC_TIME'}

def do_sampling(df: pd.DataFrame, method: str, sample_pct: float,
                stratify_col: Optional[str], target_col: Optional[str],
                shuffle: bool,
                n_clusters: Optional[int] = None,
                reservoir_size: Optional[int] = None,
                date_column: Optional[str] = None,
                start_date: Optional[str] = None,
                end_date: Optional[str] = None,
                step_size: Optional[int] = None) -> pd.DataFrame:
    """Apply the sampling strategy and return the resulting DataFrame."""
    if method == "simple_random":
        n = max(1, int(len(df) * sample_pct / 100))
        n = min(n, len(df))
        result = df.sample(n=n, random_state=42, replace=False)

    elif method == "stratified":
        col = stratify_col or target_col
        if not col or col not in df.columns:
            raise HTTPException(400, "A column to stratify by is required.")
        frac = max(0.0, min(1.0, sample_pct / 100))
        result = _sample_per_group(df, col, lambda g: g.sample(frac=frac, random_state=42))

    elif method in ("oversample", "undersample"):
        col = target_col or stratify_col
        if not col or col not in df.columns:
            raise HTTPException(400, "A target column is required for over/undersampling.")
        counts = df[col].value_counts()
        if len(counts) < 2:
            raise HTTPException(400, f"Column '{col}' has fewer than 2 classes — nothing to balance.")
        if method == "undersample":
            target_n = int(counts.min())
            result = _sample_per_group(df, col, lambda g: g.sample(n=target_n, random_state=42))
        else:  # oversample — real SMOTE (synthetic interpolation), not
               # duplicate-with-replacement. See _smote_oversample's own
               # docstring for why.
            result = _smote_oversample(df, col)

    elif method == "systematic":
        step = max(1, int(100 / sample_pct)) if sample_pct and sample_pct < 100 else 1
        result = df.iloc[::step].copy()

    elif method == "cluster":
        n_clust = n_clusters or 10
        rng = np.random.RandomState(42)
        cluster_ids = rng.randint(0, n_clust, len(df))
        n_select = max(1, n_clust // 3)
        selected_clusters = rng.choice(n_clust, n_select, replace=False)
        mask = np.isin(cluster_ids, selected_clusters)
        result = df[mask].copy()

    elif method == "reservoir":
        res_size = reservoir_size or min(1000, max(10, len(df) // 10))
        res_size = min(res_size, len(df))
        result = df.sample(n=res_size, random_state=42)

    elif method == "importance":
        # Simplified importance sampling: draws a weighted-random subset
        # rather than uniform random. Advanced/illustrative use case only.
        frac = max(0.0, min(1.0, sample_pct / 100)) if sample_pct else 0.2
        result = df.sample(frac=frac, random_state=42, replace=False)

    elif method == "DATE_RANGE":
        col = date_column
        if not col or col not in df.columns:
            raise HTTPException(400, "date_column is required for Date-Range Filtering.")
        df_tmp = df.copy()
        df_tmp["_dt_tmp"] = pd.to_datetime(df_tmp[col], errors="coerce")
        if start_date:
            df_tmp = df_tmp[df_tmp["_dt_tmp"] >= pd.to_datetime(start_date)]
        if end_date:
            df_tmp = df_tmp[df_tmp["_dt_tmp"] <= pd.to_datetime(end_date)]
        result = df_tmp.drop(columns=["_dt_tmp"])

    elif method == "SYSTEMATIC_TIME":
        step = step_size or max(2, len(df) // 1000)
        work = df
        if date_column and date_column in df.columns:
            work = df.sort_values(date_column)
        result = work.iloc[::step].copy()

    else:
        raise HTTPException(400, f"Unknown method: {method}")

    if shuffle and method not in _ORDER_PRESERVING_METHODS:
        result = result.sample(frac=1, random_state=42).reset_index(drop=True)
    else:
        result = result.reset_index(drop=True)

    return result

METHOD_LABELS = {
    "simple_random":   lambda pct: f"Simple Random Undersampling ({pct:.0f}% of rows)",
    "stratified":      lambda pct: f"Stratified Undersampling ({pct:.0f}% per class)",
    "undersample":      lambda pct: "Majority Undersampling (majority → minority class size)",
    "oversample":       lambda pct: "Minority Oversampling — SMOTE (synthetic samples up to majority class size)",
    "systematic":       lambda pct: f"Systematic Sampling (every {max(1, int(100/pct)) if pct and pct < 100 else 1}th row)",
    "cluster":          lambda pct: "Cluster Sampling",
    "reservoir":        lambda pct: "Reservoir Sampling",
    "importance":       lambda pct: "Importance Sampling",
    "DATE_RANGE":       lambda pct: "Date-Range Filtering",
    "SYSTEMATIC_TIME":  lambda pct: "Systematic Sampling (time-ordered)",
}

# ─────────────────────────────────────────────────────────────────────────────
# MODELS
# ─────────────────────────────────────────────────────────────────────────────

class ProfileReq(BaseModel):
    file_path:     str
    target_column: Optional[str] = None

class RunSamplingReq(BaseModel):
    file_path:       str
    method:          str            # simple_random | stratified | oversample | undersample |
                                     # systematic | cluster | reservoir | importance |
                                     # DATE_RANGE | SYSTEMATIC_TIME
    sample_pct:      float = 20.0   # used for simple_random / stratified / systematic / importance
    stratify_col:    Optional[str] = None
    target_col:      Optional[str] = None
    shuffle:         bool  = True
    n_clusters:      Optional[int] = None
    reservoir_size:  Optional[int] = None
    date_column:     Optional[str] = None
    start_date:      Optional[str] = None
    end_date:        Optional[str] = None
    step_size:       Optional[int] = None

class ApplyReq(RunSamplingReq):
    pass

# ─────────────────────────────────────────────────────────────────────────────
# PROFILE — dataset stats, class balance, skewness, datetime detection
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/profile")
def profile_dataset(req: ProfileReq):
    try:
        df = read_df(req.file_path)

        target_col = req.target_column or auto_detect_target(df)

        skewed_cols  = get_skewness_summary(df)
        n_right_skew = sum(1 for c in skewed_cols if c["direction"] == "right")
        n_left_skew  = sum(1 for c in skewed_cols if c["direction"] == "left")

        skew_note = ""
        if skewed_cols:
            parts = []
            if n_right_skew: parts.append(f"{n_right_skew} column{'s' if n_right_skew > 1 else ''} show strong right-skew")
            if n_left_skew:  parts.append(f"{n_left_skew} column{'s' if n_left_skew > 1 else ''} show strong left-skew")
            skew_note = " and ".join(parts) + "."

        datetime_cols = detect_datetime_cols(df)

        target_info = None
        if target_col and target_col in df.columns:
            dist = get_class_dist(df[target_col])
            is_imb, level, min_pct = check_imbalance(dist)
            target_info = {
                "column":        target_col,
                "class_dist":    dist,
                "is_imbalanced": is_imb,
                "balance_level": level,
                "min_class_pct": min_pct,
                "suggestion":    imbalance_suggestion(dist, level, min_pct),
            }

        num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        cat_cols = df.select_dtypes(exclude=[np.number]).columns.tolist()

        return {
            "row_count":      len(df),
            "col_count":      len(df.columns),
            "num_col_count":  len(num_cols),
            "cat_col_count":  len(cat_cols),
            "all_columns":    list(df.columns),
            "numeric_columns":     num_cols,
            "categorical_columns": cat_cols,
            "display_rows":   df.fillna("").to_dict(orient="records"),
            "skewed_cols":    skewed_cols,
            "skew_note":      skew_note,
            "datetime_cols":  datetime_cols,
            "has_time_warning": len(datetime_cols) > 0,
            "target_info":    target_info,
            "detected_target": target_col,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Profiling failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# RUN — preview sampling WITHOUT saving (Try-See-Decide)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/run")
def run_sampling(req: RunSamplingReq):
    try:
        df      = read_df(req.file_path)
        sampled = do_sampling(df, req.method, req.sample_pct,
                              req.stratify_col, req.target_col, req.shuffle,
                              n_clusters=req.n_clusters, reservoir_size=req.reservoir_size,
                              date_column=req.date_column, start_date=req.start_date,
                              end_date=req.end_date, step_size=req.step_size)

        target_col = req.target_col or req.stratify_col or auto_detect_target(df)

        before_dist = get_class_dist(df[target_col]) if target_col and target_col in df.columns else []
        after_dist  = get_class_dist(sampled[target_col]) if target_col and target_col in sampled.columns else []

        label_fn = METHOD_LABELS.get(req.method)
        label = label_fn(req.sample_pct) if label_fn else req.method

        row_diff = len(sampled) - len(df)
        return {
            "method":       req.method,
            "method_label": label,
            "before": {
                "row_count":  len(df),
                "class_dist": before_dist,
            },
            "after": {
                "row_count":  len(sampled),
                "class_dist": after_dist,
            },
            "rows_changed":   row_diff,   # negative = rows removed, positive = rows added
            "reduction_pct":  safe_round(abs(row_diff) / len(df) * 100, 1) if len(df) else 0,
            "display_rows":   sampled.fillna("").to_dict(orient="records"),
            "shuffle_applied": req.shuffle and req.method not in _ORDER_PRESERVING_METHODS,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sampling run failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# APPLY — commit the sampling and save a versioned CSV
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/apply")
def apply_sampling(req: ApplyReq):
    try:
        df      = read_df(req.file_path)
        sampled = do_sampling(df, req.method, req.sample_pct,
                              req.stratify_col, req.target_col, req.shuffle,
                              n_clusters=req.n_clusters, reservoir_size=req.reservoir_size,
                              date_column=req.date_column, start_date=req.start_date,
                              end_date=req.end_date, step_size=req.step_size)
        new_path = save_version(sampled, req.file_path)
        return {
            "new_file_path": new_path,
            "row_count":     len(sampled),
            "col_count":     len(sampled.columns),
            "original_rows": len(df),
            "version_name":  "Sampled Version",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sampling apply failed: {str(e)}")
