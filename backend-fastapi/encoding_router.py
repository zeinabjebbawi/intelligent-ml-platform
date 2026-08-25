"""
PRISM — Encoding & Scaling Router (FastAPI)
Add to main.py:
    from encoding_router import router as encoding_router
    app.include_router(encoding_router)
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import pandas as pd
import numpy as np
from sklearn.preprocessing import LabelEncoder, MinMaxScaler, StandardScaler, RobustScaler
import os

router = APIRouter(prefix="/encoding", tags=["Encoding"])

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
    for s in ["_encoded", "_scaled", "_encoding_scaling"]:
        base_name = base_name.split(s)[0]
    new_path = os.path.join(dir_name, f"{base_name}_{suffix}.csv")
    df.to_csv(new_path, index=False)
    return new_path

def infer_type(series: pd.Series) -> str:
    # Boolean columns are deliberately treated as categorical, not numeric.
    # pandas.api.types.is_numeric_dtype(bool_series) is True, which used to
    # route bool columns into suggest_scaler()'s quantile/IQR math — numpy's
    # quantile interpolation does `b - a` on the two bracketing values, and
    # subtraction is not defined for numpy bool arrays, so that crashed with
    # "TypeError: numpy boolean subtract...". This matters in practice: a
    # dataset re-profiled after Apply can contain one-hot columns, and even
    # though apply_all() below now saves those as int (not bool), a raw
    # uploaded CSV can genuinely contain True/False columns pandas infers as
    # bool on its own — treating them as categorical (which is what they
    # semantically are — binary flags, not continuous quantities) sidesteps
    # the crash class entirely rather than special-casing just this one path.
    if pd.api.types.is_bool_dtype(series):
        return "categorical"
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    return "categorical"

def suggest_encoding(series: pd.Series) -> tuple:
    """Returns (method, reason)."""
    n_unique = series.dropna().nunique()
    if n_unique == 2:
        return "label", "Binary column — Label encoding (0/1) is efficient and sufficient."
    if n_unique > 15:
        return "label", f"{n_unique} categories is high — Label encoding avoids column explosion."
    return "one_hot", f"{n_unique} unique values — One-Hot encoding works well for nominal data."

def suggest_scaler(series: pd.Series) -> tuple:
    """Returns (method, reason)."""
    clean = series.dropna()
    if len(clean) < 8:
        return "none", "Not enough data for a suggestion."
    try:
        Q1, Q3 = clean.quantile(0.25), clean.quantile(0.75)
        IQR = Q3 - Q1
        n_out = int(((clean < Q1 - 1.5*IQR) | (clean > Q3 + 1.5*IQR)).sum())
        out_pct = n_out / len(clean) * 100
        if out_pct > 5:
            return "robust", f"{n_out} outliers ({out_pct:.1f}%) — Robust scaling reduces their influence."
    except Exception:
        # Defensive fallback for any dtype the IQR/quantile math doesn't
        # like — never let a single column's stats crash the whole profile.
        return "minmax", "Default suggestion."
    try:
        from scipy import stats
        sample = clean.sample(min(len(clean), 3000), random_state=42)
        _, p = stats.shapiro(sample) if len(sample) <= 5000 else stats.normaltest(sample)
        if p > 0.05:
            return "standard", "Approximately normal — Standard scaling (Z-score) is ideal."
        else:
            return "minmax", "Skewed without severe outliers — Min-Max scaling works well."
    except Exception:
        return "minmax", "Default suggestion."

# ─────────────────────────────────────────────────────────────────────────────
# MODELS
# ─────────────────────────────────────────────────────────────────────────────

class FileReq(BaseModel):
    file_path: str

class EncodeColReq(BaseModel):
    file_path: str
    column:    str
    method:    str   # "label" | "one_hot"

class ScaleColReq(BaseModel):
    file_path: str
    column:    str
    method:    str   # "minmax" | "standard" | "robust"

class EncodingDecision(BaseModel):
    column: str
    method: str

class ScalingDecision(BaseModel):
    column: str
    method: str

class ApplyReq(BaseModel):
    file_path:          str
    encoding_decisions: List[EncodingDecision]
    scaling_decisions:  List[ScalingDecision]

# ─────────────────────────────────────────────────────────────────────────────
# PROFILE — analyse dataset and return column metadata + suggestions
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/profile")
def profile_dataset(req: FileReq):
    # Every endpoint in this router is wrapped in try/except HTTPException,
    # matching the convention already used in main.py and cleaning_router_v2.py.
    # This isn't just tidiness: an exception that escapes the route handler
    # unhandled reaches Starlette's outermost ServerErrorMiddleware, which
    # sits OUTSIDE CORSMiddleware and returns a bare response that never gets
    # CORS headers attached. The browser then rejects that response as a CORS
    # failure and fetch() throws a bare "Failed to fetch" — indistinguishable
    # from the server being unreachable, and useless for debugging. Catching
    # the exception here and raising HTTPException instead keeps the response
    # inside the normal FastAPI pipeline (which CORSMiddleware does wrap), so
    # the frontend gets a real, readable error message instead.
    try:
        df = read_df(req.file_path)
        columns = []
        for col in df.columns:
            series = df[col]
            col_type = infer_type(series)
            info: Dict[str, Any] = {
                "name":          col,
                "dtype":         str(series.dtype),
                "inferred_type": col_type,
                "unique_count":  int(series.nunique()),
                "missing_count": int(series.isna().sum()),
                "sample_values": [str(v) for v in series.dropna().unique()[:6].tolist()],
            }
            if col_type == "categorical":
                enc_method, enc_reason = suggest_encoding(series)
                info["suggested_encoding"] = enc_method
                info["encoding_reason"]    = enc_reason
                info["categories"]         = [str(v) for v in series.dropna().unique().tolist()]
            else:
                sc_method, sc_reason = suggest_scaler(series)
                info["suggested_scaler"] = sc_method
                info["scaler_reason"]    = sc_reason
                info["stats"] = {
                    "min":  float(series.min()),
                    "max":  float(series.max()),
                    "mean": float(series.mean()),
                    "std":  float(series.std()),
                }
            columns.append(info)

        # Return first 50 rows for the original table display
        display_rows = df.head(50).fillna("").to_dict(orient="records")

        return {
            "columns":     columns,
            "row_count":   len(df),
            "col_count":   len(df.columns),
            "display_rows": display_rows,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Profiling failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# ENCODE COLUMN — preview encoding for a single column
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/encode-column")
def encode_column(req: EncodeColReq):
    try:
        df = read_df(req.file_path)
        if req.column not in df.columns:
            raise HTTPException(400, f"Column '{req.column}' not found")

        series = df[req.column].fillna("__MISSING__").astype(str)
        preview_n = min(len(df), 50)

        if req.method == "label":
            le = LabelEncoder()
            encoded_all = le.fit_transform(series)
            mapping = {str(cls): int(i) for i, cls in enumerate(le.classes_)}

            preview = [
                {"original": str(df.iloc[i][req.column]), "encoded": int(encoded_all[i])}
                for i in range(preview_n)
            ]
            return {"method": "label", "column": req.column,
                    "mapping": mapping, "preview": preview}

        elif req.method == "one_hot":
            dummies = pd.get_dummies(series, prefix=req.column)
            one_hot_cols = []
            for dummy_col in dummies.columns:
                col_preview = [
                    {"original": str(df.iloc[i][req.column]),
                     "encoded":  int(dummies.iloc[i][dummy_col])}
                    for i in range(preview_n)
                ]
                one_hot_cols.append({"name": dummy_col, "preview": col_preview})
            return {"method": "one_hot", "column": req.column, "one_hot_columns": one_hot_cols}

        raise HTTPException(400, f"Unknown encoding method: {req.method}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Encoding preview failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# SCALE COLUMN — preview scaling for a single column
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/scale-column")
def scale_column(req: ScaleColReq):
    try:
        df = read_df(req.file_path)
        if req.column not in df.columns:
            raise HTTPException(400, f"Column '{req.column}' not found")

        SCALERS = {
            "minmax":   MinMaxScaler(),
            "standard": StandardScaler(),
            "robust":   RobustScaler(),
        }
        if req.method not in SCALERS:
            raise HTTPException(400, f"Unknown scaler: {req.method}")

        # Fit on full column (not just preview rows)
        series  = df[req.column].dropna()
        scaler  = SCALERS[req.method]
        scaled  = scaler.fit_transform(series.values.reshape(-1, 1)).flatten()
        idx_map = {int(idx): round(float(scaled[i]), 4) for i, idx in enumerate(series.index)}

        preview_n = min(len(df), 50)
        preview = [
            {
                "original": float(df.iloc[i][req.column]) if pd.notna(df.iloc[i][req.column]) else None,
                "scaled":   idx_map.get(i),
            }
            for i in range(preview_n)
        ]
        return {"method": req.method, "column": req.column, "preview": preview}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scaling preview failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# APPLY — apply all decisions, save new dataset version
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/apply")
def apply_all(req: ApplyReq):
    try:
        df      = read_df(req.file_path)
        result  = df.copy()

        applied = []

        # ── Encoding pass ────────────────────────────────────────────────────
        for dec in req.encoding_decisions:
            col, method = dec.column, dec.method
            if col not in result.columns:
                continue

            series = result[col].fillna("__MISSING__").astype(str)

            if method == "label":
                le = LabelEncoder()
                result[col] = le.fit_transform(series)
                applied.append({"column": col, "new_name": col, "type": "label"})

            elif method == "one_hot":
                # .astype(int) — pandas' get_dummies defaults to bool columns.
                # Left as bool, they save to CSV as "True"/"False", which
                # pd.read_csv re-infers as bool dtype on the next read (e.g.
                # the post-Apply re-profile). is_numeric_dtype(bool) is True,
                # which used to route these into suggest_scaler()'s quantile
                # math and crash (see infer_type()'s comment). Saving as 0/1
                # int also matches what /encode-column's own preview already
                # showed the user, instead of surprising them with True/False
                # in the downloaded file.
                dummies = pd.get_dummies(series, prefix=col).astype(int)
                insert_pos = list(result.columns).index(col)

                result = result.drop(columns=[col])
                for i, dummy_col in enumerate(dummies.columns):
                    result.insert(insert_pos + i, dummy_col, dummies[dummy_col])

                for dummy_col in dummies.columns:
                    applied.append({"column": col, "new_name": dummy_col, "type": "one_hot"})

        # ── Scaling pass ─────────────────────────────────────────────────────
        SCALERS = {
            "minmax":   MinMaxScaler(),
            "standard": StandardScaler(),
            "robust":   RobustScaler(),
        }
        for dec in req.scaling_decisions:
            col, method = dec.column, dec.method
            if method not in SCALERS or col not in result.columns:
                continue

            series = result[col].dropna()
            scaler = SCALERS[method]
            scaled = scaler.fit_transform(series.values.reshape(-1, 1)).flatten()
            # Scaling always produces floats, but a column that started out
            # as all-whole-number values (e.g. Age, Pclass) reads in as
            # int64. `.loc[...]` partial assignment (needed so NaN rows are
            # left untouched, unlike a plain `result[col] = scaled`) writes
            # into that existing int64 block instead of replacing it, and
            # pandas raises "Invalid value '[...]' for dtype 'int64'" rather
            # than silently upcasting. Cast the column to float64 first so
            # the assignment always lands in a dtype that can hold it.
            result[col] = result[col].astype("float64")
            result.loc[series.index, col] = scaled
            applied.append({"column": col, "new_name": col, "type": method})

        new_path = save_version(result, req.file_path, "encoding_scaling")
        return {
            "new_file_path":          new_path,
            "row_count":              len(result),
            "col_count":              len(result.columns),
            "applied_transformations": applied,
            "version_name":           "Encoding & Scaling",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Apply failed: {str(e)}")
