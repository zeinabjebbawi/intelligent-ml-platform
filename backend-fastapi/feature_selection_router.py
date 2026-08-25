"""
PRISM — Feature Selection Router (FastAPI)
IMPORTANT: No SHAP here. Feature selection is statistical only (Rule 2 —
No Reaching Forward: SHAP requires a trained model, which doesn't exist yet
at this stage of the pipeline).
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import pandas as pd
import numpy as np
from scipy import stats as scipy_stats
from sklearn.feature_selection import mutual_info_classif, mutual_info_regression
import os

router = APIRouter(prefix="/feature-selection", tags=["Feature Selection"])

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
    base_name = base_name.split("_feature_selected")[0]
    new_path  = os.path.join(dir_name, f"{base_name}_feature_selected.csv")
    df.to_csv(new_path, index=False)
    return new_path

def safe_num(x, default=0.0):
    """None/NaN/inf-safe float conversion. A bare NaN surviving into a JSON
    response is valid to Python's json module (allow_nan=True) but is NOT
    valid JSON — JS's JSON.parse throws on the literal token `NaN`. Every
    statistic computed from real data (correlations of a constant column,
    etc.) must go through this before landing in a response body."""
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return default
    if xf != xf or xf in (float("inf"), float("-inf")):
        return default
    return round(xf, 4)

def detect_task_type(series: pd.Series) -> str:
    """Classification or Regression based on target dtype + unique count."""
    if pd.api.types.is_bool_dtype(series):
        return "classification"
    if not pd.api.types.is_numeric_dtype(series):
        return "classification"
    if series.nunique() <= 10:
        return "classification"
    return "regression"

def detect_one_hot_groups(df: pd.DataFrame) -> Dict[str, List[str]]:
    """
    Detect one-hot encoded column groups: binary (0/1) columns that share a
    common underscore-prefix (the naming convention encoding_router.py's
    pd.get_dummies(prefix=col) produces).
    """
    binary_cols: List[str] = []
    for col in df.columns:
        vals = df[col].dropna()
        if len(vals) == 0:
            continue  # an all-null column is not a real binary/one-hot column
        if set(vals.unique()).issubset({0, 1, 0.0, 1.0, True, False}) and df[col].nunique() <= 2:
            binary_cols.append(col)
    groups: Dict[str, List[str]] = {}
    for col in binary_cols:
        if '_' in col:
            prefix = col.rsplit('_', 1)[0]
            groups.setdefault(prefix, []).append(col)
    return {k: sorted(v) for k, v in groups.items() if len(v) >= 2}

def feature_type_label(series: pd.Series, is_one_hot: bool) -> str:
    if is_one_hot:
        return "binary"
    if pd.api.types.is_numeric_dtype(series):
        if series.nunique() <= 2:
            return "binary"
        if series.nunique() <= 10:
            return "ordinal"
        return "numeric"
    return "categorical"

def compute_redundancy(corr_matrix: pd.DataFrame, feature: str, others: List[str]) -> float:
    """Max absolute correlation of 'feature' with any other numeric feature."""
    if feature not in corr_matrix.columns or not others:
        return 0.0
    valid = [c for c in others if c != feature and c in corr_matrix.columns]
    if not valid:
        return 0.0
    vals = [abs(safe_num(corr_matrix.loc[feature, c], 0.0)) for c in valid]
    return round(max(vals), 3) if vals else 0.0

REDUNDANCY_THRESHOLD = 0.85  # same threshold multicollinearity warnings use

def signal_tier(importance: float) -> str:
    """The feature's signal strength w.r.t. the target, on its own —
    independent of redundancy. Three tiers, always one of these three."""
    if importance >= 0.3:
        return "strong"
    if importance >= 0.1:
        return "moderate"
    return "weak"

def recommend_action(tier: str, is_redundant: bool) -> str:
    """Compound recommendation combining signal tier + redundancy — used for
    color-coding (heatmap borders, scatter dots/quadrant backgrounds, table
    badges). A feature can be BOTH weak AND redundant at once (previously
    lost entirely — the old single-dimension version never checked
    redundancy at all for the weak/moderate tiers), which is exactly why
    `signal_tier` and `is_redundant` are ALSO kept as independent fields on
    every feature — never collapse back down to reading only this string
    when "does this feature have both flags" actually matters (e.g. the
    Remove Weak + Redundant bulk action)."""
    if is_redundant:
        return "weak_redundant" if tier == "weak" else "redundant_high"
    return tier  # 'strong' | 'moderate' | 'weak'

def compute_categorical_importance(df: pd.DataFrame, col: str, target_series: pd.Series, task_type: str):
    """
    Association strength for a column that is still raw/unencoded (object or
    category dtype — never a one-hot output, those are always numeric 0/1).
    Per the platform's own guidance: Chi-Square (Cramer's V) against a
    classification target, one-way ANOVA (as 1 - p_value, a 0..1 effect-size
    proxy) against a continuous regression target — never Pearson correlation
    directly on a nominal column. Returns (importance 0..1, p_value|None, test_name).
    """
    test_name = "chi_square" if task_type == "classification" else "anova"
    try:
        tmp = pd.DataFrame({col: df[col], "_t_": target_series}).dropna()
        if len(tmp) < 5 or tmp[col].nunique() < 2:
            return 0.0, None, test_name

        if task_type == "classification":
            contingency = pd.crosstab(tmp[col], tmp["_t_"])
            if contingency.shape[0] < 2 or contingency.shape[1] < 2:
                return 0.0, None, test_name
            chi2, p, _, _ = scipy_stats.chi2_contingency(contingency)
            n = contingency.values.sum()
            k = min(contingency.shape) - 1
            cramers_v = (chi2 / (n * k)) ** 0.5 if n > 0 and k > 0 else 0.0
            return max(0.0, min(1.0, safe_num(cramers_v, 0.0))), safe_num(p, None), test_name
        else:
            groups = [g["_t_"].values for _, g in tmp.groupby(col) if len(g) > 0]
            if len(groups) < 2:
                return 0.0, None, test_name
            _, p = scipy_stats.f_oneway(*groups)
            importance = safe_num(1 - p, 0.0)
            return max(0.0, min(1.0, importance)), safe_num(p, None), test_name
    except Exception:
        return 0.0, None, test_name

# ─────────────────────────────────────────────────────────────────────────────
# MODELS
# ─────────────────────────────────────────────────────────────────────────────

class AnalyzeReq(BaseModel):
    file_path:     str
    target_column: str

class ApplyReq(BaseModel):
    file_path:        str
    target_column:    str
    features_to_keep: List[str]

# ─────────────────────────────────────────────────────────────────────────────
# ANALYZE — full statistical feature analysis (no model, no SHAP)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/analyze")
def analyze(req: AnalyzeReq):
    # Every route handler in this router is wrapped in try/except ->
    # HTTPException. An exception that escapes unhandled reaches Starlette's
    # ServerErrorMiddleware, which sits OUTSIDE CORSMiddleware — its fallback
    # response never gets CORS headers, so the browser reports a bare
    # "Failed to fetch" instead of a readable error (see encoding_router.py
    # for the full mechanism writeup; this is a standing project convention).
    try:
        df     = read_df(req.file_path)
        target = req.target_column

        if target not in df.columns:
            raise HTTPException(400, f"Target column '{target}' not found.")

        task_type = detect_task_type(df[target])

        # One-hot groups (always numeric 0/1 columns, so never overlaps with
        # the "leftover raw categorical" set built below)
        oh_groups = detect_one_hot_groups(df)
        col_to_group = {col: grp for grp, cols in oh_groups.items() for col in cols}

        all_features = [c for c in df.columns if c != target]
        num_features = df[all_features].select_dtypes(include=[np.number]).columns.tolist()
        # Columns that are neither numeric nor one-hot — i.e. a categorical
        # column that reached this page without ever being encoded (the user
        # skipped or hasn't yet run the Encoding & Scaling step for it).
        # Silently excluding these entirely (the original design's behavior)
        # would make a real column vanish from the page with no explanation.
        cat_leftover = [c for c in all_features if c not in num_features]

        # ── Target series (numeric-safe) ────────────────────────────────────
        target_series = df[target].copy()
        if pd.api.types.is_bool_dtype(target_series):
            target_series = target_series.astype(int)
        elif not pd.api.types.is_numeric_dtype(target_series):
            target_series = target_series.astype('category').cat.codes
        n_target_classes = int(df[target].nunique())

        # ── Pearson correlation with target (numeric features) ─────────────
        pearson_scores: Dict[str, float] = {}
        for col in num_features:
            try:
                pearson_scores[col] = safe_num(df[col].corr(target_series), 0.0)
            except Exception:
                pearson_scores[col] = 0.0

        # ── Mutual Information (all numeric features, handles non-linear) ──
        mi_scores: Dict[str, float] = {}
        try:
            X_mi = df[num_features].fillna(df[num_features].median())
            y_mi = target_series.reindex(X_mi.index)
            fn   = mutual_info_classif if task_type == "classification" else mutual_info_regression
            raw  = fn(X_mi, y_mi, random_state=42)
            mi_max = max(raw) if len(raw) and max(raw) > 0 else 1
            for i, col in enumerate(num_features):
                mi_scores[col] = safe_num(raw[i] / mi_max, 0.0)
        except Exception:
            for col in num_features:
                mi_scores[col] = abs(pearson_scores.get(col, 0))

        # ── Feature-feature correlation matrix (numeric features only) ─────
        # `corr_df` (features only, no target) drives redundancy/
        # multicollinearity math below — unchanged. `corr_matrix_out` is the
        # DISPLAY matrix for the heatmap, which also includes the target
        # column itself as a row/column, so its correlation with every
        # feature is visible directly in the grid, not just in the axis
        # label styling.
        corr_df = df[num_features].fillna(0).corr().round(3)
        heatmap_df = pd.concat([df[num_features], target_series.rename(target)], axis=1).fillna(0)
        corr_df_display = heatmap_df.corr().round(3)
        corr_matrix_out = {
            "labels": list(corr_df_display.columns),
            "matrix": [[safe_num(v, 0.0) for v in row] for row in corr_df_display.values.tolist()],
        }

        # ── Multicollinearity pairs (|r| >= 0.85, numeric features only) ───
        multicol_pairs = []
        seen = set()
        for i, a in enumerate(corr_df.columns):
            for j, b in enumerate(corr_df.columns):
                if i >= j:
                    continue
                r = safe_num(corr_df.iloc[i, j], 0.0)
                key = tuple(sorted([a, b]))
                if key in seen:
                    continue
                seen.add(key)
                if abs(r) >= 0.85:
                    is_one_hot_pair = (col_to_group.get(a) == col_to_group.get(b)
                                       and col_to_group.get(a) is not None)
                    multicol_pairs.append({
                        "feature_a":   a,
                        "feature_b":   b,
                        "correlation": r,
                        "is_one_hot":  is_one_hot_pair,
                        "severity":    "expected" if is_one_hot_pair else "warning",
                    })

        # ── Per-numeric-feature summary ─────────────────────────────────────
        features_out = []
        for col in num_features:
            importance  = abs(pearson_scores.get(col, 0))
            other_feats = [c for c in num_features if c != col]
            redundancy  = compute_redundancy(corr_df, col, other_feats)
            grp         = col_to_group.get(col)
            is_oh       = grp is not None
            ftype       = feature_type_label(df[col], is_oh)
            tier        = signal_tier(importance)
            is_red      = redundancy >= REDUNDANCY_THRESHOLD
            rec         = recommend_action(tier, is_red)

            features_out.append({
                "name":           col,
                "rank":           0,  # assigned below, after the unified sort
                "type":           ftype,
                "pearson":        round(pearson_scores.get(col, 0), 4),
                "importance":     round(importance, 4),
                "importance_mi":  round(mi_scores.get(col, 0), 4),
                "redundancy":     round(redundancy, 4),
                "redundancy_na":  False,
                "signal_tier":    tier,
                "is_redundant":   is_red,
                "recommendation": rec,
                "one_hot_group":  grp,
                "is_one_hot":     is_oh,
                "unencoded":      False,
                "stat_test":      "pearson",
                "p_value":        None,
            })

        # ── Leftover raw categorical columns — Chi-Square/ANOVA, never
        # Pearson-on-label-codes (which falsely treats nominal classes as
        # ordinal). Redundancy against other features isn't measured for
        # these (that's a Pearson-matrix concept) — flagged via redundancy_na
        # rather than silently implying "zero redundancy". ─────────────────
        for col in cat_leftover:
            importance, p_value, test_name = compute_categorical_importance(df, col, target_series, task_type)
            tier = signal_tier(importance)
            features_out.append({
                "name":           col,
                "rank":           0,
                "type":           "categorical",
                "pearson":        None,
                "importance":     round(importance, 4),
                "importance_mi":  None,
                "redundancy":     0.0,
                "redundancy_na":  True,
                "signal_tier":    tier,
                "is_redundant":   False,  # not measured cross-type — see redundancy_na
                "recommendation": recommend_action(tier, False),
                "one_hot_group":  None,
                "is_one_hot":     False,
                "unencoded":      True,
                "stat_test":      test_name,
                "p_value":        p_value,
            })

        # Unified ranking across BOTH numeric (Pearson/MI) and leftover
        # categorical (Chi-Square/ANOVA) features — one rank column, whatever
        # statistical test produced each score.
        features_out.sort(key=lambda f: f["importance"], reverse=True)
        for i, f in enumerate(features_out):
            f["rank"] = i + 1

        # Numeric-only subset for the visuals that are mathematically numeric
        # (scatter/pairplot coordinates, the redundancy-vs-relevance plot) —
        # an unencoded categorical column has no numeric value to plot.
        numeric_ranked = [f for f in features_out if not f["unencoded"]]

        # ── Top 2 features scatter (colored by target) ──────────────────────
        top2 = [f["name"] for f in numeric_ranked
                if not f["is_one_hot"] or f["signal_tier"] != "weak"][:2]
        scatter_top2 = []
        if len(top2) >= 2:
            tmp = df[[top2[0], top2[1], target]].dropna()
            for _, row in tmp.head(500).iterrows():
                scatter_top2.append({
                    "x": safe_num(row[top2[0]], 0.0),
                    "y": safe_num(row[top2[1]], 0.0),
                    "target": str(row[target]),
                })

        # ── Pairplot data for top 5 non-one-hot numeric features ────────────
        top5 = [f["name"] for f in numeric_ranked if not f["is_one_hot"]][:5]
        pairplot_data = {}
        if len(top5) >= 2:
            tmp = df[top5 + [target]].dropna().head(300)
            for i in range(len(top5)):
                for j in range(i + 1, len(top5)):
                    fa, fb = top5[i], top5[j]
                    key = f"{fa}||{fb}"
                    pairplot_data[key] = [
                        {"x": safe_num(r[fa], 0.0), "y": safe_num(r[fb], 0.0), "target": str(r[target])}
                        for _, r in tmp.iterrows()
                    ]

        # ── Redundancy vs Relevance (numeric features only — see note above) ─
        rdv_scatter = [
            {
                "name":            f["name"],
                "relevance":       f["importance"],
                "redundancy":      f["redundancy"],
                "type":            f["type"],
                "signal_tier":     f["signal_tier"],
                "is_redundant":    f["is_redundant"],
                "recommendation":  f["recommendation"],
                "one_hot_group":   f["one_hot_group"],
            }
            for f in numeric_ranked
        ]

        # ── Summary stats — counted by signal_tier alone (independent of
        # redundancy), so "N weak features detected" means every weak-signal
        # feature, whether or not it's also redundant. ─────────────────────
        n_strong    = sum(1 for f in features_out if f["signal_tier"] == "strong")
        n_weak      = sum(1 for f in features_out if f["signal_tier"] == "weak")
        n_redundant = len([p for p in multicol_pairs if p["severity"] == "warning"])

        return {
            "features":            features_out,
            "one_hot_groups":      oh_groups,
            "correlation_matrix":  corr_matrix_out,
            "multicol_pairs":      multicol_pairs,
            "top_2": {
                "feature_1": top2[0] if len(top2) > 0 else None,
                "feature_2": top2[1] if len(top2) > 1 else None,
                "scatter":   scatter_top2,
            },
            "pairplot_data":       pairplot_data,
            "rdv_scatter":         rdv_scatter,
            "task_type":           task_type,
            "target_column":       target,
            "n_target_classes":    n_target_classes,
            "target_is_multiclass_nominal": (task_type == "classification" and n_target_classes > 2
                                              and not pd.api.types.is_numeric_dtype(df[target])),
            "row_count":           len(df),
            "total_features":      len(features_out),
            "n_numeric_features":  len(num_features),
            "n_unencoded_features": len(cat_leftover),
            "n_strong":            n_strong,
            "n_weak":              n_weak,
            "n_multicol_warnings": n_redundant,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Feature analysis failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# APPLY — drop unselected features and save versioned CSV
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/apply")
def apply_selection(req: ApplyReq):
    try:
        df = read_df(req.file_path)

        cols_to_keep = [c for c in req.features_to_keep if c in df.columns]
        if req.target_column in df.columns and req.target_column not in cols_to_keep:
            cols_to_keep.append(req.target_column)

        if not cols_to_keep:
            raise HTTPException(400, "No valid features selected.")

        result   = df[cols_to_keep]
        new_path = save_version(result, req.file_path)

        return {
            "new_file_path":    new_path,
            "row_count":        len(result),
            "col_count":        len(result.columns),
            "features_kept":    cols_to_keep,
            "features_dropped": [c for c in df.columns if c not in cols_to_keep],
            "version_name":     "Feature Selected Version",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Apply feature selection failed: {str(e)}")
