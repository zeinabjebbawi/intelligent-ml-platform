"""
PRISM — Cleaning Router v2 (FastAPI)
Changes from v1:
  - profile-duplicates: now returns duplicate group IDs (g1, g2…) per row
    so the frontend can show "dup · g1" badges in the FLAG column.
  - profile-missing-global: also returns complete_rows, complete_rows_pct,
    and cols_with_missing for the redesigned stat cards.
  - profile-outliers-global: also returns n_zscore_cols / n_iqr_cols.
  - All other endpoints unchanged from v1.

Add to main.py:
    from cleaning_router_v2 import router as cleaning_router
    app.include_router(cleaning_router)
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import json
import pandas as pd
import numpy as np
from scipy import stats
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.ensemble import IsolationForest
from sklearn.impute import KNNImputer
import os, hashlib

router = APIRouter(prefix="/cleaning", tags=["Cleaning"])

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def read_df(file_path: str) -> pd.DataFrame:
    if not os.path.exists(file_path):
        raise HTTPException(404, f"File not found: {file_path}")
    return pd.read_csv(file_path)

def save_version(df: pd.DataFrame, original_path: str, suffix: str) -> str:
    dir_name  = os.path.dirname(original_path)
    base_name = os.path.splitext(os.path.basename(original_path))[0]
    for s in ["_dup_removed", "_outliers_removed", "_missing_imputed", "_rows_filtered"]:
        base_name = base_name.split(s)[0]
    new_path = os.path.join(dir_name, f"{base_name}_{suffix}.csv")
    df.to_csv(new_path, index=False)
    return new_path

def check_normality(series: pd.Series):
    clean = series.dropna()
    n = len(clean)
    if n < 8:
        return True, 1.0, "insufficient_data"
    try:
        sample = clean.sample(min(5000, n), random_state=42) if n > 5000 else clean
        if n <= 5000:
            _, p = stats.shapiro(sample)
            return bool(p > 0.05), float(p), "shapiro-wilk"
        else:
            _, p = stats.normaltest(sample)
            return bool(p > 0.05), float(p), "dagostino-pearson"
    except Exception:
        return True, 1.0, "test_failed"

def base_stats(series: pd.Series) -> dict:
    clean = series.dropna()
    Q1, Q3 = float(clean.quantile(0.25)), float(clean.quantile(0.75))
    IQR = Q3 - Q1
    mean, std = float(clean.mean()), float(clean.std())
    return {
        "mean": mean, "std": std,
        "median": float(clean.median()),
        "Q1": Q1, "Q3": Q3, "IQR": IQR,
        "min": float(clean.min()), "max": float(clean.max()),
        "zscore_upper": mean + 3.0 * std,
        "zscore_lower": mean - 3.0 * std,
        "iqr_upper":    Q3 + 1.5 * IQR,
        "iqr_lower":    Q1 - 1.5 * IQR,
    }

# ─────────────────────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ─────────────────────────────────────────────────────────────────────────────

class FileReq(BaseModel):
    file_path: str

class ColumnReq(BaseModel):
    file_path: str
    column: str

class RemoveOutliersReq(BaseModel):
    file_path: str
    column: str
    rows_to_remove: List[int]

class ApplyMissingReq(BaseModel):
    file_path: str
    column: str
    method: str
    n_neighbors: Optional[int] = 5

class RowThresholdReq(BaseModel):
    file_path: str
    min_present: int

# ─────────────────────────────────────────────────────────────────────────────
# DUPLICATES — UPDATED: adds _dup_group and _is_first_in_group per row
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/profile-duplicates")
def profile_duplicates(req: FileReq):
    df = read_df(req.file_path)

    # ── Identify duplicates and assign group IDs ──────────────────────────
    dup_mask_all   = df.duplicated(keep=False)   # all rows in any dup group
    dup_mask_first = df.duplicated(keep='first') # rows that are actual duplicates (non-first)

    # Build row_hash → group_label mapping
    group_map   = {}   # hash → "g1", "g2", …
    group_count = 0
    row_hashes  = []

    for idx in range(len(df)):
        if dup_mask_all.iloc[idx]:
            # Hash the row values (stable, order-sensitive)
            row_bytes = str(df.iloc[idx].tolist()).encode()
            h = hashlib.md5(row_bytes).hexdigest()
            row_hashes.append(h)
            if h not in group_map:
                group_count += 1
                group_map[h] = f"g{group_count}"
        else:
            row_hashes.append(None)

    # Counts
    total_dup_rows  = int(dup_mask_all.sum())   # all rows touched by duplication
    real_duplicates = int(dup_mask_first.sum())  # actual extras to be removed
    total_groups    = group_count

    # Build display rows (cap at 2000 for performance)
    display_df = df.head(2000).copy()
    rows = []
    # Track which row is the first occurrence of its group
    first_seen = set()

    for i in range(len(display_df)):
        # Real datasets almost always have missing values, which pandas
        # represents as NaN. Python's json encoder rejects raw NaN, so
        # round-trip each row's dict through a per-value native-type cast
        # instead of using DataFrame.to_dict() directly on the whole block.
        row_dict = json.loads(display_df.iloc[[i]].to_json(orient='records'))[0]
        h = row_hashes[i]
        is_dup    = bool(dup_mask_all.iloc[i])
        group_id  = group_map.get(h) if h else None
        is_first  = False

        if is_dup and group_id:
            is_first = group_id not in first_seen
            first_seen.add(group_id)

        row_dict['_dup_group']         = group_id        # e.g. "g1" or None
        row_dict['_is_dup']            = is_dup
        row_dict['_is_first_in_group'] = is_first        # True = kept row

        rows.append(row_dict)

    return {
        "total_dup_rows":  total_dup_rows,   # all rows involved (for DUPLICATE ROWS card)
        "total_groups":    total_groups,      # unique groups (for DUPLICATE GROUPS card)
        "real_duplicates": real_duplicates,   # rows that will be removed
        "total_rows":      len(df),
        "columns":         list(df.columns),
        "rows":            rows,
    }


@router.post("/remove-duplicates")
def remove_duplicates(req: FileReq):
    df = read_df(req.file_path)
    before  = len(df)
    cleaned = df.drop_duplicates().reset_index(drop=True)
    new_path = save_version(cleaned, req.file_path, "dup_removed")
    return {
        "rows_removed":  before - len(cleaned),
        "new_row_count": len(cleaned),
        "new_file_path": new_path,
        "version_name":  "Duplicate Removed",
    }

# ─────────────────────────────────────────────────────────────────────────────
# OUTLIERS — GLOBAL
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/profile-outliers-global")
def profile_outliers_global(req: FileReq):
    df = read_df(req.file_path)
    num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    if not num_cols:
        return {"total_outliers": 0, "column_summary": [],
                "pca_scatter": [], "outlier_index_plot": []}

    col_summary = []
    total_outliers = 0
    for col in num_cols:
        s = df[col].dropna()
        is_normal, pval, _ = check_normality(s)
        method = 'zscore' if is_normal else 'iqr'
        bs = base_stats(s)
        if method == 'zscore':
            n_out = int((np.abs((s - bs['mean']) / max(bs['std'], 1e-10)) > 3.0).sum())
        else:
            n_out = int(((s > bs['iqr_upper']) | (s < bs['iqr_lower'])).sum())
        total_outliers += n_out
        col_summary.append({
            "column": col, "n_outliers": n_out,
            "method": method, "is_normal": is_normal, "p_value": round(pval, 4),
        })

    X_full = df[num_cols].fillna(df[num_cols].median())
    n = min(600, len(X_full))
    sample_idx = np.random.choice(len(X_full), n, replace=False)
    Xs = X_full.iloc[sample_idx]
    scaler = StandardScaler()
    Xs_scaled = scaler.fit_transform(Xs)

    iso = IsolationForest(contamination='auto', random_state=42)
    iso_labels = iso.fit_predict(Xs_scaled)
    iso_scores = iso.decision_function(Xs_scaled)

    pca = PCA(n_components=min(2, len(num_cols)))
    X_pca = pca.fit_transform(Xs_scaled)

    pca_scatter = [
        {"x": float(X_pca[i, 0]), "y": float(X_pca[i, 1]),
         "is_outlier": bool(iso_labels[i] == -1),
         "row_index": int(sample_idx[i])}
        for i in range(n)
    ]

    s_min, s_max = iso_scores.min(), iso_scores.max()
    norm_scores = 1 - (iso_scores - s_min) / (s_max - s_min + 1e-10)
    outlier_index_plot = [
        {"index": int(sample_idx[i]),
         "score": float(norm_scores[i]),
         "is_outlier": bool(iso_labels[i] == -1)}
        for i in range(n)
    ]

    return {
        "total_outliers": total_outliers,
        "n_zscore_cols": sum(1 for c in col_summary if c['method'] == 'zscore'),
        "n_iqr_cols":    sum(1 for c in col_summary if c['method'] == 'iqr'),
        "column_summary": col_summary,
        "pca_scatter": pca_scatter,
        "outlier_index_plot": outlier_index_plot,
        "pca_variance": [float(v) for v in pca.explained_variance_ratio_],
    }

# ─────────────────────────────────────────────────────────────────────────────
# OUTLIERS — PER COLUMN
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/profile-outliers-column")
def profile_outliers_column(req: ColumnReq):
    df = read_df(req.file_path)
    if req.column not in df.columns:
        raise HTTPException(400, f"Column '{req.column}' not found")

    series  = df[req.column].dropna()
    is_normal, pval, test_name = check_normality(series)
    suggested = 'zscore' if is_normal else 'iqr'
    bs = base_stats(series)

    arr = series.values
    if suggested == 'zscore':
        out_mask = np.abs((arr - bs['mean']) / max(bs['std'], 1e-10)) > 3.0
    else:
        out_mask = (arr > bs['iqr_upper']) | (arr < bs['iqr_lower'])

    all_indices = series.index.tolist()
    out_idx  = [all_indices[i] for i in range(len(arr)) if out_mask[i]]
    norm_idx = [all_indices[i] for i in range(len(arr)) if not out_mask[i]]
    if len(norm_idx) > 1500:
        rng = np.random.default_rng(42)
        norm_idx = rng.choice(norm_idx, 1500, replace=False).tolist()

    all_values = [
        {"row_index": int(i), "value": float(df.loc[i, req.column])}
        for i in (out_idx + norm_idx) if pd.notna(df.loc[i, req.column])
    ]

    counts, edges = np.histogram(arr, bins=min(40, max(10, len(arr) // 20)))
    histogram = {
        "counts":   counts.tolist(),
        "bin_edges": [float(e) for e in edges],
        "bin_mids":  [float((edges[i] + edges[i+1]) / 2) for i in range(len(counts))],
    }

    return {
        "column":           req.column,
        "is_normal":        is_normal,
        "suggested_method": suggested,
        "p_value":          round(pval, 4),
        "test_name":        test_name,
        "stats":            bs,
        "all_values":       all_values,
        "histogram":        histogram,
        "total_values":     len(series),
        "missing_count":    int(df[req.column].isna().sum()),
    }


@router.post("/remove-outliers")
def remove_outliers_endpoint(req: RemoveOutliersReq):
    df = read_df(req.file_path)
    before  = len(df)
    cleaned = df.drop(index=req.rows_to_remove, errors='ignore').reset_index(drop=True)
    new_path = save_version(cleaned, req.file_path, "outliers_removed")
    return {
        "rows_removed":  before - len(cleaned),
        "new_row_count": len(cleaned),
        "new_file_path": new_path,
        "version_name":  "Outliers Removed",
    }

# ─────────────────────────────────────────────────────────────────────────────
# MISSING VALUES
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/profile-missing-global")
def profile_missing_global(req: FileReq):
    df = read_df(req.file_path)

    bar_data = []
    for col in df.columns:
        total   = len(df)
        missing = int(df[col].isna().sum())
        present = total - missing
        col_type = 'numerical' if pd.api.types.is_numeric_dtype(df[col]) else 'categorical'
        bar_data.append({
            "column":      col,
            "present":     present,
            "missing":     missing,
            "present_pct": round(present / total, 4),
            "missing_pct": round(missing / total * 100, 2),
            "type":        col_type,
        })

    sample_n  = min(250, len(df))
    sample_df = df.sample(sample_n, random_state=42).sort_index() if len(df) > sample_n else df
    matrix_rows = (~sample_df.isnull()).values.tolist()

    row_miss = df.isnull().sum(axis=1)
    completeness = [
        {"missing_per_row": int(k), "row_count": int(v)}
        for k, v in row_miss.value_counts().sort_index().items()
    ]

    total_missing = int(df.isnull().sum().sum())
    total_cells   = df.shape[0] * df.shape[1]
    complete_rows = int((row_miss == 0).sum())

    return {
        "bar_data": bar_data,
        "matrix_data": {
            "columns":    list(df.columns),
            "rows":       matrix_rows,
            "total_rows": len(df),
            "sample_rows": sample_n,
        },
        "row_completeness":  completeness,
        "total_missing":     total_missing,
        "missing_pct":       round(total_missing / total_cells * 100, 2) if total_cells else 0,
        "complete_rows":     complete_rows,
        "complete_rows_pct": round(complete_rows / len(df) * 100, 1) if len(df) else 0,
        "cols_with_missing": sum(1 for b in bar_data if b['missing'] > 0),
        "total_rows":        len(df),
        "total_cols":        len(df.columns),
    }


@router.post("/apply-row-threshold")
def apply_row_threshold(req: RowThresholdReq):
    df = read_df(req.file_path)
    before  = len(df)
    cleaned = df.dropna(thresh=req.min_present).reset_index(drop=True)
    new_path = save_version(cleaned, req.file_path, "rows_filtered")
    return {
        "rows_removed":  before - len(cleaned),
        "new_row_count": len(cleaned),
        "new_file_path": new_path,
        "version_name":  "Incomplete Rows Dropped",
    }


@router.post("/apply-missing-column")
def apply_missing_column(req: ApplyMissingReq):
    df = read_df(req.file_path)
    if req.column not in df.columns:
        raise HTTPException(400, f"Column '{req.column}' not found")

    before   = int(df[req.column].isna().sum())
    col_type = 'numerical' if pd.api.types.is_numeric_dtype(df[req.column]) else 'categorical'

    if req.method == 'drop_column':
        df = df.drop(columns=[req.column])
    elif req.method == 'drop_rows':
        df = df.dropna(subset=[req.column]).reset_index(drop=True)
    elif req.method == 'mean':
        if col_type != 'numerical':
            raise HTTPException(400, "Mean imputation requires a numerical column")
        df[req.column] = df[req.column].fillna(df[req.column].mean())
    elif req.method == 'mode':
        df[req.column] = df[req.column].fillna(df[req.column].mode().iloc[0])
    elif req.method == 'knn':
        if col_type != 'numerical':
            raise HTTPException(400, "KNN imputation requires a numerical column")
        num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        imputer  = KNNImputer(n_neighbors=req.n_neighbors)
        df[num_cols] = imputer.fit_transform(df[num_cols])
    elif req.method == 'interpolation':
        df[req.column] = df[req.column].interpolate(method='linear')
    else:
        raise HTTPException(400, f"Unknown method: {req.method}")

    after    = int(df[req.column].isna().sum()) if req.method != 'drop_column' else 0
    new_path = save_version(df, req.file_path, "missing_imputed")
    return {
        "column":         req.column,
        "method":         req.method,
        "before_missing": before,
        "after_missing":  after,
        "new_file_path":  new_path,
        "version_name":   "Missing Values Imputed",
    }


@router.get("/download")
def download_file(file_path: str, filename: str = "dataset.csv"):
    if not os.path.exists(file_path):
        raise HTTPException(404, f"File not found: {file_path}")
    return FileResponse(path=file_path, filename=filename, media_type="text/csv")
