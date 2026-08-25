"""
PRISM — Feature Engineering Router (FastAPI)
Endpoints for the Bucketizing and Create New Features page.
Add to main.py:
    from feature_engineering_router import router as feature_router
    app.include_router(feature_router)
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import pandas as pd
import numpy as np
import re, os

router = APIRouter(prefix="/feature", tags=["Feature Engineering"])

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def read_df(path: str) -> pd.DataFrame:
    if not os.path.exists(path):
        raise HTTPException(404, f"File not found: {path}")
    return pd.read_csv(path)

def save_version(df: pd.DataFrame, original_path: str, suffix: str) -> str:
    dir_name  = os.path.dirname(original_path)
    base_name = os.path.splitext(os.path.basename(original_path))[0]
    for s in ["_bucketized", "_feature_created"]:
        base_name = base_name.split(s)[0]
    new_path = os.path.join(dir_name, f"{base_name}_{suffix}.csv")
    df.to_csv(new_path, index=False)
    return new_path

def infer_type(series: pd.Series) -> str:
    # Boolean columns are categorical, not numeric — same reasoning as
    # encoding_router.py's infer_type: is_numeric_dtype(bool_series) is True,
    # which would otherwise route a bool column into numeric-only stats/skew
    # math and risk the same "numpy boolean subtract" crash class.
    if pd.api.types.is_bool_dtype(series):
        return "categorical"
    return "numeric" if pd.api.types.is_numeric_dtype(series) else "categorical"

def safe_round(x, nd=4):
    """None-safe, NaN/inf-safe float rounding. A bare NaN surviving into a
    JSON response is valid to Python's json module (allow_nan=True) but is
    NOT valid JSON — JS's JSON.parse throws on the literal token `NaN`. Every
    numeric value computed from user data (as opposed to a plain len()/count)
    must go through this before being placed in a response body."""
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return None
    if xf != xf or xf in (float("inf"), float("-inf")):
        return None
    return round(xf, nd)

def run_diagnostics(series: pd.Series, col_name: str, target_col: str = None) -> dict:
    """
    Senior ML analyst rule-based diagnostics.
    Runs all rules in priority order; returns the FIRST match.
    """
    clean  = series.dropna()
    total  = len(series)
    n_miss = int(series.isna().sum())
    miss_pct = n_miss / total * 100 if total > 0 else 0
    col_key  = col_name.lower().replace('_', '').replace(' ', '')

    ZERO_INVALID = {'glucose', 'insulin', 'bloodpressure', 'bmi', 'skinthickness', 'age',
                     'weight', 'height', 'pulse', 'temperature', 'oxygen', 'hemoglobin',
                     'cholesterol', 'creatinine', 'albumin', 'platelet'}

    # Rule 1 — Domain-specific zero impossibility
    if pd.api.types.is_numeric_dtype(series):
        zeros = int((clean == 0).sum())
        if zeros > 0 and any(kw in col_key for kw in ZERO_INVALID):
            return {'title': 'Biological Impossibility',
                    'message': f'{zeros} values of 0 in {col_name} are not physiologically possible and likely represent missing data recorded as zero.',
                    'severity': 'error', 'actions': ['Replace with NaN', 'Impute (Mean)']}

    # Rule 2 — Missingness
    if miss_pct > 20:
        return {'title': 'High Missingness',
                'message': f'{n_miss} rows ({miss_pct:.1f}%) are missing in {col_name}. Columns with >20% missing can distort model learning.',
                'severity': 'error', 'actions': ['Impute (KNN)', 'Drop Column']}
    if miss_pct > 5:
        return {'title': 'Moderate Missingness',
                'message': f'{n_miss} values ({miss_pct:.1f}%) are missing in {col_name}.',
                'severity': 'warning', 'actions': ['Impute (Mean)', 'Impute (Mode)']}

    # Rule 3 — Class imbalance (target only)
    if col_name == target_col and not pd.api.types.is_numeric_dtype(series) and len(clean) > 0:
        vc = clean.value_counts(normalize=True)
        if vc.min() < 0.20:
            minority = str(vc.index[-1])
            min_pct  = float(vc.min() * 100)
            return {'title': 'Class Imbalance',
                    'message': f'The rarest class ({minority}) makes up only {min_pct:.1f}% of rows. This can cause the model to ignore it.',
                    'severity': 'warning', 'actions': []}

    # Rule 4 — Constant / near-constant
    if clean.nunique() == 1:
        return {'title': 'Constant Feature',
                'message': f'All {total} rows have the same value ({clean.iloc[0]}). This column adds no information and should be removed.',
                'severity': 'error', 'actions': ['Remove Column']}
    if pd.api.types.is_numeric_dtype(series) and clean.nunique() <= 3:
        return {'title': 'Near-Constant Feature',
                'message': f'{col_name} has only {clean.nunique()} unique numeric values. It contributes very little variance.',
                'severity': 'warning', 'actions': []}

    # Rule 5 — High cardinality
    if not pd.api.types.is_numeric_dtype(series) and clean.nunique() > 50:
        return {'title': 'High Cardinality',
                'message': f'{clean.nunique()} unique values detected. High-cardinality categorical columns require encoding strategies like target encoding or hashing before training.',
                'severity': 'warning', 'actions': []}

    # Rule 6 — Skewness
    if pd.api.types.is_numeric_dtype(series) and len(clean) > 20:
        skew = float(clean.skew())
        if skew == skew and abs(skew) > 1.0:  # skew == skew guards against NaN
            direction = 'Right' if skew > 0 else 'Left'
            return {'title': f'{direction}-Skewed Distribution',
                    'message': f'Skewness = {skew:.2f}. Highly skewed features may reduce accuracy for linear algorithms. Consider log or sqrt transform.',
                    'severity': 'info', 'actions': ['Log Transform', 'Sqrt Transform']}

    # Rule 7 — Outliers
    if pd.api.types.is_numeric_dtype(series) and len(clean) > 20:
        Q1, Q3 = clean.quantile(0.25), clean.quantile(0.75)
        IQR = Q3 - Q1
        n_out = int(((clean < Q1 - 1.5 * IQR) | (clean > Q3 + 1.5 * IQR)).sum())
        if n_out > 0 and n_out / len(clean) * 100 > 2:
            pct = round(n_out / len(clean) * 100, 1)
            return {'title': 'Potential Outliers',
                    'message': f'{n_out} values ({pct}%) fall beyond the expected IQR range. These may skew model training.',
                    'severity': 'warning', 'actions': ['Inspect Outliers']}

    # Rule 8 — All clear
    return {'title': 'Looking Good', 'severity': 'ok',
            'message': f'No significant data quality issues detected in {col_name}.', 'actions': []}

# ─────────────────────────────────────────────────────────────────────────────
# CUSTOM EXPRESSION SAFETY — used by both the "create new feature" preview and
# apply endpoints. Column names are replaced with placeholders via WORD-
# BOUNDARY regex (not a naive str.replace): a naive replace would corrupt an
# expression when one selected column's name is a substring of the other's
# (e.g. col_a="Age", col_b="AgeGroup" — str.replace would mangle "AgeGroup"
# while substituting "Age"). After placeholder substitution, the string is
# checked against a strict whitelist (digits, X/Y placeholders, whitespace,
# + - * / ( ) . ,) before ever reaching pandas' eval() — this is the "do not
# let them type raw code, safely evaluate math strings" approach the design
# doc asked for.
# ─────────────────────────────────────────────────────────────────────────────

def _validate_custom_expr(custom_expr: str, col_a: str, col_b: str) -> None:
    placeholder = re.sub(r'\b' + re.escape(col_b) + r'\b', 'Y',
                  re.sub(r'\b' + re.escape(col_a) + r'\b', 'X', custom_expr))
    if not placeholder.strip() or re.search(r'[^0-9XY\s\+\-\*\/\(\)\.\,]', placeholder):
        raise HTTPException(400, "Invalid custom expression — only numbers, + - * / ( ) and the two selected column names are allowed")

def _compute_combined(df, col_a, col_b, operation, custom_expr):
    if operation == 'add':
        return df[col_a] + df[col_b]
    elif operation == 'subtract':
        return df[col_a] - df[col_b]
    elif operation == 'multiply':
        return df[col_a] * df[col_b]
    elif operation == 'divide':
        return df[col_a] / df[col_b].replace(0, np.nan)
    elif operation == 'custom':
        if not custom_expr:
            raise HTTPException(400, "custom_expr is required")
        _validate_custom_expr(custom_expr, col_a, col_b)
        tmp = df[[col_a, col_b]].copy()
        tmp.columns = ['col_a', 'col_b']
        expr = re.sub(r'\b' + re.escape(col_b) + r'\b', 'col_b',
               re.sub(r'\b' + re.escape(col_a) + r'\b', 'col_a', custom_expr))
        return tmp.eval(expr)
    raise HTTPException(400, f"Unknown operation: {operation}")

# ─────────────────────────────────────────────────────────────────────────────
# MODELS
# ─────────────────────────────────────────────────────────────────────────────

class FileReq(BaseModel):
    file_path: str

class DiagnosticsReq(BaseModel):
    file_path: str
    column: str
    target_column: Optional[str] = None

class BucketizeReq(BaseModel):
    file_path:    str
    column:       str
    strategy:     str              # 'equal_width' | 'equal_freq' | 'custom'
    n_bins:       Optional[int]    = 5
    custom_edges: Optional[str]    = None  # comma-separated floats

class CreateFeatureReq(BaseModel):
    file_path:    str
    col_a:        str
    col_b:        str
    operation:    str              # 'add'|'subtract'|'multiply'|'divide'|'custom'
    custom_expr:  Optional[str]   = None
    new_col_name: Optional[str]   = None

class CreateFeatureApplyReq(BaseModel):
    file_path:     str
    col_a:         str
    col_b:         str
    operation:     str
    custom_expr:   Optional[str]  = None
    new_col_name:  Optional[str]  = None
    keep_originals: bool          = True

# ─────────────────────────────────────────────────────────────────────────────
# PROFILE
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/profile")
def profile_dataset(req: FileReq):
    # Every endpoint in this router is wrapped in try/except -> HTTPException.
    # An exception that escapes a FastAPI route handler unhandled reaches
    # Starlette's ServerErrorMiddleware, which sits OUTSIDE CORSMiddleware —
    # its fallback response never gets CORS headers attached, so the browser
    # reports a bare "Failed to fetch" instead of a readable error. See
    # encoding_router.py's profile_dataset for the full mechanism writeup.
    try:
        df = read_df(req.file_path)
        columns = []
        for col in df.columns:
            s     = df[col]
            ctype = infer_type(s)
            info  = {"name": col, "dtype": str(s.dtype), "inferred_type": ctype,
                     "unique_count": int(s.nunique()), "missing_count": int(s.isna().sum())}
            if ctype == "numeric":
                info["stats"] = {"min": safe_round(s.min()), "max": safe_round(s.max()),
                                  "mean": safe_round(s.mean()), "std": safe_round(s.std()),
                                  "skew": safe_round(s.skew(), 3)}
            columns.append(info)
        return {
            "columns":      columns,
            "row_count":    len(df),
            "col_count":    len(df.columns),
            "display_rows": df.head(50).fillna("").to_dict(orient="records"),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Profiling failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# DIAGNOSTICS (analyst rules — called on column click)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/diagnostics")
def get_diagnostics(req: DiagnosticsReq):
    try:
        df = read_df(req.file_path)
        if req.column not in df.columns:
            raise HTTPException(400, f"Column '{req.column}' not found")
        return run_diagnostics(df[req.column], req.column, req.target_column)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Diagnostics failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# BUCKETIZING PREVIEW  (no save — used for instant histogram update)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/bucketize-preview")
def bucketize_preview(req: BucketizeReq):
    try:
        df = read_df(req.file_path)
        if req.column not in df.columns:
            raise HTTPException(400, f"Column '{req.column}' not found")

        series = df[req.column].dropna()

        if req.strategy == 'equal_width':
            bucketed, bins = pd.cut(series, bins=req.n_bins, retbins=True, duplicates='drop')
        elif req.strategy == 'equal_freq':
            bucketed, bins = pd.qcut(series, q=req.n_bins, retbins=True, duplicates='drop')
        elif req.strategy == 'custom':
            if not req.custom_edges:
                raise HTTPException(400, "custom_edges required for custom strategy")
            try:
                edges = sorted([float(x.strip()) for x in req.custom_edges.split(',') if x.strip()])
            except ValueError:
                raise HTTPException(400, "custom_edges must be comma-separated numbers")
            if not edges:
                raise HTTPException(400, "custom_edges must contain at least one cutoff value")
            mn, mx = float(series.min()), float(series.max())
            full_edges = [mn - 1e-6] + edges + [mx + 1e-6]
            bucketed, bins = pd.cut(series, bins=full_edges, retbins=True, duplicates='drop')
        else:
            raise HTTPException(400, f"Unknown strategy: {req.strategy}")

        # Histogram data
        counts = bucketed.value_counts().sort_index()
        histogram = [
            {"bucket": str(b), "count": int(c),
             "range_low": safe_round(b.left), "range_high": safe_round(b.right)}
            for b, c in counts.items()
        ]

        # Preview (first 50 rows, original -> bucket)
        preview_series = df[req.column].head(50)
        full_bucketed  = pd.cut(preview_series, bins=bins, duplicates='drop')
        preview = []
        for i in range(len(preview_series)):
            val = preview_series.iloc[i]
            cat = full_bucketed.iloc[i] if i < len(full_bucketed) else None
            preview.append({
                "original": safe_round(val) if pd.notna(val) else None,
                "bucket":   str(cat) if pd.notna(cat) else None,
            })

        return {
            "new_col_name": f"{req.column}_bucket",
            "histogram":    histogram,
            "preview":      preview,
            "n_buckets":    len(histogram),
            "strategy":     req.strategy,
            "bins":         [safe_round(b) for b in bins],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Bucketize preview failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# BUCKETIZE APPLY  (saves versioned CSV)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/bucketize-apply")
def bucketize_apply(req: BucketizeReq):
    try:
        df = read_df(req.file_path)
        if req.column not in df.columns:
            raise HTTPException(400, f"Column '{req.column}' not found")
        series = df[req.column]

        if req.strategy == 'equal_width':
            df[f"{req.column}_bucket"] = pd.cut(series, bins=req.n_bins, duplicates='drop').astype(str)
        elif req.strategy == 'equal_freq':
            df[f"{req.column}_bucket"] = pd.qcut(series, q=req.n_bins, duplicates='drop').astype(str)
        elif req.strategy == 'custom':
            if not req.custom_edges:
                raise HTTPException(400, "custom_edges required for custom strategy")
            try:
                edges = sorted([float(x.strip()) for x in req.custom_edges.split(',') if x.strip()])
            except ValueError:
                raise HTTPException(400, "custom_edges must be comma-separated numbers")
            mn, mx = float(series.min()), float(series.max())
            full_edges = [mn - 1e-6] + edges + [mx + 1e-6]
            df[f"{req.column}_bucket"] = pd.cut(series, bins=full_edges, duplicates='drop').astype(str)
        else:
            raise HTTPException(400, f"Unknown strategy: {req.strategy}")

        new_path = save_version(df, req.file_path, "bucketized")
        return {
            "new_file_path": new_path,
            "new_col_name":  f"{req.column}_bucket",
            "row_count":     len(df),
            "col_count":     len(df.columns),
            "version_name":  "Feature Bucketizing",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Bucketize apply failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# CREATE FEATURE PREVIEW  (no save)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/create-preview")
def create_feature_preview(req: CreateFeatureReq):
    try:
        df = read_df(req.file_path)
        for c in (req.col_a, req.col_b):
            if c not in df.columns:
                raise HTTPException(400, f"Column '{c}' not found")
        new_col  = _compute_combined(df, req.col_a, req.col_b, req.operation, req.custom_expr)
        new_name = req.new_col_name or f"{req.col_a}_{req.operation}_{req.col_b}"

        preview = []
        for i in range(min(50, len(df))):
            a = df.iloc[i][req.col_a]
            b = df.iloc[i][req.col_b]
            preview.append({
                "col_a":  safe_round(a) if pd.notna(a) else None,
                "col_b":  safe_round(b) if pd.notna(b) else None,
                "result": safe_round(new_col.iloc[i]) if pd.notna(new_col.iloc[i]) else None,
            })

        return {
            "new_col_name": new_name,
            "preview":      preview,
            "operation":    req.operation,
            "stats": {
                "min":        safe_round(new_col.min()),
                "max":        safe_round(new_col.max()),
                "mean":       safe_round(new_col.mean()),
                "null_count": int(new_col.isna().sum()),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Create-feature preview failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# CREATE FEATURE APPLY  (saves versioned CSV)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/create-apply")
def create_feature_apply(req: CreateFeatureApplyReq):
    try:
        df = read_df(req.file_path)
        for c in (req.col_a, req.col_b):
            if c not in df.columns:
                raise HTTPException(400, f"Column '{c}' not found")
        new_col  = _compute_combined(df, req.col_a, req.col_b, req.operation, req.custom_expr)
        new_name = req.new_col_name or f"{req.col_a}_{req.operation}_{req.col_b}"
        df[new_name] = new_col

        if not req.keep_originals:
            df = df.drop(columns=[req.col_a, req.col_b], errors='ignore')

        new_path = save_version(df, req.file_path, "feature_created")
        return {
            "new_file_path": new_path,
            "new_col_name":  new_name,
            "row_count":     len(df),
            "col_count":     len(df.columns),
            "version_name":  "Feature Engineering",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Create-feature apply failed: {str(e)}")
