"""
PRISM — Post-Preprocessing Visualization Router (FastAPI)
Two endpoints:
  POST /visualization/analyze — main (lightweight, fast)
  POST /visualization/pca     — heavier, called separately on user action
Add to main.py:
    from visualization_router import router as viz_router
    app.include_router(viz_router)
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import pandas as pd
import numpy as np
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import IsolationForest
import os
import traceback

router = APIRouter(prefix="/visualization", tags=["Visualization"])

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def read_df(path: str) -> pd.DataFrame:
    if not os.path.exists(path):
        raise HTTPException(404, f"File not found: {path}")
    return pd.read_csv(path)

def safe_round(x, nd=4):
    """None/NaN/inf-safe rounding — a bare NaN surviving into a JSON
    response is valid to Python's json module but not valid JSON; JS's
    JSON.parse throws on the literal token NaN. Every numeric value derived
    from user data (as opposed to a plain len()/count) must go through this."""
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return None
    if xf != xf or xf in (float("inf"), float("-inf")):
        return None
    return round(xf, nd)

def compute_skewness(df: pd.DataFrame) -> List[dict]:
    # Per-column try/except: one column with pathological data (e.g. an
    # object-dtype column select_dtypes should have excluded but didn't due
    # to some upstream dtype quirk) must never take the whole report down —
    # same "never let one column's stats crash the whole profile" philosophy
    # already used in encoding_router.py's suggest_scaler.
    result = []
    for col in df.select_dtypes(include=[np.number]).columns:
        try:
            sk = safe_round(df[col].dropna().skew(), 3)
            if sk is None:
                continue
            result.append({"feature": col, "skew": sk,
                           "direction": "right" if sk > 0 else "left",
                           "severe": abs(sk) > 1.0})
        except Exception:
            continue
    return sorted(result, key=lambda x: abs(x["skew"]), reverse=True)

def compute_correlation(df: pd.DataFrame) -> dict:
    try:
        num_df = df.select_dtypes(include=[np.number])
        if num_df.shape[1] < 2:
            return {"labels": [], "matrix": []}
        corr = num_df.corr().round(3)
        matrix = [[safe_round(v, 3) or 0 for v in row] for row in corr.values.tolist()]
        return {
            "labels": list(corr.columns),
            "matrix": matrix,
        }
    except Exception:
        return {"labels": [], "matrix": []}

def feature_target_corr(df: pd.DataFrame, target: str) -> List[dict]:
    if target not in df.columns:
        return []
    try:
        num_df = df.select_dtypes(include=[np.number])
        if target not in num_df.columns:
            # Target is non-numeric (categorical) — encode it to integer
            # codes so it can still participate in a correlation calc.
            # astype("category") needs to establish a category ORDER for
            # its unique values, which can raise on genuinely mixed-type
            # object data (e.g. "TypeError: '<' not supported between
            # instances of 'str' and 'float'") — caught by the outer
            # try/except below, same fault-tolerant pattern as everywhere
            # else in this file: skip this feature entirely rather than
            # crash the whole report over one unusable target encoding.
            tmp = df.copy()
            tmp[target] = tmp[target].astype("category").cat.codes
            num_df = tmp.select_dtypes(include=[np.number])
        result = []
        for col in num_df.columns:
            if col == target:
                continue
            try:
                c = safe_round(num_df[col].corr(num_df[target]), 3)
            except Exception:
                continue
            if c is None:
                continue
            result.append({"feature": col, "corr": c,
                           "abs_corr": round(abs(c), 3),
                           "direction": "positive" if c >= 0 else "negative"})
        return sorted(result, key=lambda x: x["abs_corr"], reverse=True)
    except Exception:
        return []

def class_distribution(df: pd.DataFrame, target: str) -> List[dict]:
    if target not in df.columns:
        return []
    try:
        clean = df[target].dropna()
        if len(clean) == 0:
            return []
        # Object-dtype columns can hold genuinely mixed Python types (e.g.
        # real floats alongside real strings — this happens with certain
        # messy source CSVs). value_counts()/sort_values() can need to
        # compare values for tie-breaking, and comparing a str to a float
        # raises TypeError. Normalizing to str first (only when the dtype
        # is actually object — never touch a clean numeric column) makes
        # every remaining value uniformly comparable, regardless of what
        # was originally in the column.
        if clean.dtype == object:
            clean = clean.astype(str)
        total = len(clean)
        vc = clean.value_counts()
        return [{"class": str(k), "count": int(v), "pct": round(v/total*100, 1)}
                for k, v in vc.items()]
    except Exception:
        return []

def compute_fingerprint(df: pd.DataFrame, target: Optional[str],
                         target_dist: list, ft_corr: list) -> dict:
    """Compute 6 quality scores (0-100) for the Data Fingerprint radar."""
    total_cells = df.shape[0] * df.shape[1]
    missing_cells = int(df.isnull().sum().sum())
    completeness = round((1 - missing_cells / max(total_cells, 1)) * 100, 1)

    # Balance: 100 if perfect 50/50, lower for more skewed distributions
    balance = 50.0
    if target_dist and len(target_dist) >= 2:
        min_pct = min(d["pct"] for d in target_dist)
        max_pct = max(d["pct"] for d in target_dist)
        balance = round(min_pct / max(max_pct, 1) * 100, 1)
    elif target_dist and len(target_dist) == 1:
        balance = 0  # single class = completely imbalanced

    # Normality: % of numeric columns with |skew| < 1
    num_cols = df.select_dtypes(include=[np.number]).columns
    if len(num_cols) == 0:
        normality = 100.0
    else:
        n_normal = 0
        for col in num_cols:
            sk = safe_round(df[col].dropna().skew(), 4)
            if sk is not None and abs(sk) < 1.0:
                n_normal += 1
        normality = round(n_normal / len(num_cols) * 100, 1)

    # Signal strength: avg absolute correlation of features with target
    signal = 0.0
    if ft_corr:
        avg = np.mean([x["abs_corr"] for x in ft_corr])
        signal = round(min(avg * 250, 100), 1)  # scale 0.4 avg -> 100

    # Separability: placeholder 0 until PCA runs (updated client-side after)
    separability = 0.0

    # Cleanliness: % of rows with no outliers (IQR method)
    num_df = df.select_dtypes(include=[np.number]).dropna()
    if len(num_df) == 0 or len(num_df.columns) == 0:
        cleanliness = 100.0
    else:
        outlier_mask = pd.Series(False, index=num_df.index)
        for col in num_df.columns:
            Q1, Q3 = num_df[col].quantile(0.25), num_df[col].quantile(0.75)
            IQR = Q3 - Q1
            outlier_mask |= (num_df[col] < Q1 - 1.5*IQR) | (num_df[col] > Q3 + 1.5*IQR)
        n_clean = int((~outlier_mask).sum())
        cleanliness = round(n_clean / len(num_df) * 100, 1)

    # signal_strength is still computed and returned below (harmless to
    # keep around) but deliberately excluded from `overall` — the radar's
    # visible axes are now Completeness/Balance/Normality/Separability/
    # Cleanliness (5), and "overall" should be the average of exactly what
    # the radar shows, not a 6th hidden number nobody sees contributing to it.
    scores = [completeness, balance, normality, separability, cleanliness]
    positive = [s for s in scores if s > 0]
    overall = round(sum(positive) / max(len(positive), 1), 1)

    return {
        "completeness":    completeness,
        "balance":         balance,
        "normality":       normality,
        "signal_strength": signal,
        "separability":    separability,
        "cleanliness":     cleanliness,
        "overall":         overall,
    }

def build_signal_assessment(df, target, ft_corr, fingerprint, skewed):
    strengths, warnings = [], []

    if fingerprint["completeness"] == 100:
        strengths.append("Dataset is 100% complete — no missing values remain.")
    elif fingerprint["completeness"] >= 95:
        strengths.append(f"Dataset is {fingerprint['completeness']}% complete — minor missingness remaining.")

    if fingerprint["balance"] >= 70:
        strengths.append("Target classes are well-balanced — models will train fairly on all classes.")
    elif fingerprint["balance"] < 40:
        warnings.append(f"Target balance score is {fingerprint['balance']}/100. Class imbalance may bias model predictions.")

    if ft_corr:
        top = ft_corr[0]
        if top["abs_corr"] >= 0.3:
            strengths.append(f"{top['feature']} is strongly correlated with target (r={top['corr']:.2f}) — likely a key predictor.")
        weak = [x for x in ft_corr if x["abs_corr"] < 0.05]
        if weak:
            warnings.append(f"{', '.join(x['feature'] for x in weak[:3])} show very low target correlation (<0.05) — they may add noise.")

    multi = []
    num_df = df.select_dtypes(include=[np.number])
    if len(num_df.columns) >= 2:
        corr = num_df.corr()
        for i in range(len(corr.columns)):
            for j in range(i+1, len(corr.columns)):
                c = corr.iloc[i, j]
                if pd.notna(c) and abs(c) > 0.85:
                    multi.append(f"{corr.columns[i]} & {corr.columns[j]} (r={c:.2f})")
    if multi:
        warnings.append(f"Potential multicollinearity: {'; '.join(multi[:2])}. Consider dropping one of each pair.")

    n_severe_skew = sum(1 for s in skewed if s["severe"])
    if n_severe_skew == 0:
        strengths.append("All numeric distributions are approximately normal — linear models should perform well.")
    elif n_severe_skew <= 2:
        warnings.append(f"{n_severe_skew} feature(s) still show high skewness — may reduce linear model accuracy.")
    else:
        warnings.append(f"{n_severe_skew} features still highly skewed. Consider returning to Feature Engineering to log-transform them.")

    score = fingerprint["overall"]
    grade = "Excellent" if score >= 85 else "Good" if score >= 70 else "Fair" if score >= 55 else "Weak"
    return {"score": score, "grade": grade, "strengths": strengths, "warnings": warnings}

def build_algo_recs(df, task_type, row_count, col_count, is_balanced, n_skewed, ft_corr, fingerprint):
    """Rule-based algorithm fit table. Two completely separate algorithm
    LISTS for classification vs regression — the previous version accepted
    a `target_type` parameter and never once read it, so a regression
    target still saw "Logistic Regression" recommended (a classification-
    only algorithm) and every dataset produced the exact same 5 names with
    only minor star-count wobble. Every star rating and reason below is
    derived from THIS dataset's actual numbers (row/col count, correlation
    strength, skew count, outlier prevalence, categorical cardinality) —
    never a fixed template — so two different datasets of the same task
    type genuinely produce different results, not just cosmetic variation.
    """
    def stars(n): return min(5, max(1, round(n)))

    top_corr = ft_corr[0]["abs_corr"] if ft_corr else 0.0
    avg_corr = float(np.mean([x["abs_corr"] for x in ft_corr])) if ft_corr else 0.0
    cleanliness = fingerprint.get("cleanliness", 100) if fingerprint else 100
    high_dim = col_count > 20
    tiny_data = row_count < 200
    large_data = row_count > 10000

    cat_cols = df.select_dtypes(exclude=[np.number]).columns.tolist()
    high_card_cats = [c for c in cat_cols if df[c].nunique() > 20]

    recs = []

    if task_type == "classification":
        # Random Forest Classifier
        rf_s, rf_r = 4, ["Handles non-linear relationships and mixed data types well"]
        if not is_balanced: rf_r.append("more robust to the class imbalance here than linear models")
        if n_skewed > 2: rf_r.append(f"unaffected by the {n_skewed} still-skewed feature(s)")
        if cleanliness < 90: rf_r.append(f"tolerant of the outliers still present ({100-cleanliness:.0f}% of rows affected)")
        recs.append({"name": "Random Forest Classifier", "stars": stars(rf_s), "reason": " · ".join(rf_r)})

        # Logistic Regression
        lr_s, lr_r = 3, []
        if is_balanced and top_corr > 0.3:
            lr_s += 1; lr_r.append(f"balanced classes + a real linear signal (max |r|={top_corr:.2f})")
        elif top_corr > 0.3:
            lr_r.append(f"strongest feature shows a real linear relationship (|r|={top_corr:.2f})")
        if n_skewed > 3: lr_s -= 1; lr_r.append(f"{n_skewed} skewed features may violate linearity assumptions")
        if high_card_cats: lr_s -= 1; lr_r.append(f"{len(high_card_cats)} high-cardinality categorical column(s) need encoding first")
        if not is_balanced: lr_r.append("class imbalance can bias the decision boundary without class weighting")
        recs.append({"name": "Logistic Regression", "stars": stars(lr_s),
                     "reason": " · ".join(lr_r) or "Standard interpretable baseline for this data shape"})

        # KNN
        knn_s = 4 if (row_count < 2000 and not high_dim) else (2 if high_dim else 3)
        knn_r = [f"{row_count:,} rows / {col_count} columns {'suits' if not high_dim else 'works against'} distance-based methods"]
        if high_dim: knn_r.append("high dimensionality dilutes distance metrics (curse of dimensionality)")
        if cleanliness < 85: knn_s -= 1; knn_r.append("sensitive to the outliers still present")
        recs.append({"name": "K-Nearest Neighbors", "stars": stars(knn_s), "reason": " · ".join(knn_r)})

        # Decision Tree Classifier
        dt_s, dt_r = 3, ["Fast and directly interpretable — a good baseline to compare others against"]
        if tiny_data: dt_s -= 1; dt_r.append(f"only {row_count} rows — a single tree overfits easily this small")
        recs.append({"name": "Decision Tree Classifier", "stars": stars(dt_s), "reason": " · ".join(dt_r)})

        # SVM (SVC)
        svm_s = 3 + (1 if high_dim else 0) - (1 if large_data else 0)
        svm_r = []
        if high_dim: svm_r.append(f"{col_count} features — SVMs are strong in high-dimensional spaces")
        if large_data: svm_r.append(f"{row_count:,} rows will make training noticeably slower")
        if is_balanced: svm_r.append("balanced classes suit the standard margin-based objective")
        recs.append({"name": "Support Vector Machine (SVC)", "stars": stars(svm_s),
                     "reason": " · ".join(svm_r) or "Solid general-purpose choice for this dataset size"})

    else:  # regression
        # Random Forest Regressor
        rf_s, rf_r = 4, ["Handles non-linear relationships and mixed data types well"]
        if n_skewed > 2: rf_r.append(f"unaffected by the {n_skewed} still-skewed feature(s)")
        if cleanliness < 90: rf_r.append(f"tolerant of the outliers still present ({100-cleanliness:.0f}% of rows affected)")
        recs.append({"name": "Random Forest Regressor", "stars": stars(rf_s), "reason": " · ".join(rf_r)})

        # Linear Regression
        lin_s, lin_r = 3, []
        if top_corr > 0.4 and n_skewed <= 1:
            lin_s += 1; lin_r.append(f"strong linear signal (max |r|={top_corr:.2f}) with mostly-normal features")
        elif top_corr > 0.4:
            lin_r.append(f"strongest feature is strongly correlated with the target (|r|={top_corr:.2f})")
        if n_skewed > 3: lin_s -= 1; lin_r.append(f"{n_skewed} skewed features may violate linearity/normality assumptions")
        if high_card_cats: lin_s -= 1; lin_r.append(f"{len(high_card_cats)} high-cardinality categorical column(s) need encoding first")
        recs.append({"name": "Linear Regression", "stars": stars(lin_s),
                     "reason": " · ".join(lin_r) or "Standard interpretable baseline for this data shape"})

        # KNN Regressor
        knn_s = 4 if (row_count < 2000 and not high_dim) else (2 if high_dim else 3)
        knn_r = [f"{row_count:,} rows / {col_count} columns {'suits' if not high_dim else 'works against'} distance-based methods"]
        if high_dim: knn_r.append("high dimensionality dilutes distance metrics (curse of dimensionality)")
        if cleanliness < 85: knn_s -= 1; knn_r.append("sensitive to the outliers still present")
        recs.append({"name": "K-Nearest Neighbors Regressor", "stars": stars(knn_s), "reason": " · ".join(knn_r)})

        # Decision Tree Regressor
        dt_s, dt_r = 3, ["Fast and directly interpretable — a good baseline to compare others against"]
        if tiny_data: dt_s -= 1; dt_r.append(f"only {row_count} rows — a single tree overfits easily this small")
        recs.append({"name": "Decision Tree Regressor", "stars": stars(dt_s), "reason": " · ".join(dt_r)})

        # SVR
        svr_s = 3 + (1 if high_dim else 0) - (1 if large_data else 0)
        svr_r = []
        if high_dim: svr_r.append(f"{col_count} features — SVR is strong in high-dimensional spaces")
        if large_data: svr_r.append(f"{row_count:,} rows will make training noticeably slower")
        if avg_corr > 0: svr_r.append(f"average feature-target correlation is {avg_corr:.2f}")
        recs.append({"name": "Support Vector Regression (SVR)", "stars": stars(svr_s),
                     "reason": " · ".join(svr_r) or "Solid general-purpose choice for this dataset size"})

    return sorted(recs, key=lambda x: -x["stars"])

def compute_class_histograms(df, target, ft_corr, n_features=6):
    """Per-class histogram data for the top N most correlated features. Only
    meaningful for a discrete/classification-shaped target — a continuous
    regression target would produce one "class" per unique value, which is
    both meaningless and slow, so the caller gates this on
    is_classification_target() before calling."""
    if not ft_corr or target not in df.columns:
        return {}
    try:
        top_features = [x["feature"] for x in ft_corr[:n_features]]
        classes = df[target].dropna().unique()
        result = {}
        for feat in top_features:
            try:
                if feat not in df.columns:
                    continue
                all_vals = df[feat].dropna()
                if len(all_vals) == 0:
                    continue
                mn, mx = float(all_vals.min()), float(all_vals.max())
                if mn == mx:
                    continue
                bins_edges = np.linspace(mn, mx, 20)
                feat_result = {}
                for cls in classes:
                    subset = df[df[target] == cls][feat].dropna()
                    counts, _ = np.histogram(subset, bins=bins_edges)
                    feat_result[str(cls)] = {
                        "counts": counts.tolist(),
                        "bin_edges": [round(float(b), 3) for b in bins_edges],
                        "bin_mids":  [round(float((bins_edges[i]+bins_edges[i+1])/2), 3)
                                      for i in range(len(counts))],
                    }
                result[feat] = feat_result
            except Exception:
                continue
        return result
    except Exception:
        return {}

def compute_per_col_histograms(df_curr, df_orig=None, n_bins=25):
    """Histogram bins for every numeric column — current + original if provided.

    A column with zero variance (constant, or all-NaN) used to be silently
    OMITTED from the result dict via `continue` — the frontend's
    MiniHistogram treats a missing entry as "render nothing", so that
    column's card just vanished from the Distributions grid with no
    explanation, looking exactly like a bug ("this column definitely has
    data, why is nothing showing?"). Now every numeric column always gets
    an entry; a genuinely-empty-or-constant one gets empty counts/bin_mids
    so the frontend can render an explicit "No variation to display" card
    instead of a silent gap.
    """
    result = {}
    for col in df_curr.select_dtypes(include=[np.number]).columns:
        try:
            curr = df_curr[col].dropna()
            if len(curr) < 2 or curr.nunique() < 2:
                result[col] = {"current": {"counts": [], "bin_mids": []}}
                continue
            bins_edges = np.linspace(float(curr.min()), float(curr.max()), n_bins + 1)
            counts, _ = np.histogram(curr, bins=bins_edges)
            entry = {
                "current": {
                    "counts": counts.tolist(),
                    "bin_mids": [round(float((bins_edges[i]+bins_edges[i+1])/2), 3)
                                 for i in range(len(counts))],
                }
            }
            if df_orig is not None and col in df_orig.columns:
                orig = df_orig[col].dropna()
                if len(orig) > 0:
                    orig_counts, _ = np.histogram(orig, bins=bins_edges)
                    entry["original"] = {
                        "counts": orig_counts.tolist(),
                        "bin_mids": entry["current"]["bin_mids"],
                    }
            result[col] = entry
        except Exception:
            continue
    return result

def is_classification_target(df: pd.DataFrame, target: str, max_classes: int = 20) -> bool:
    """A target is "classification-shaped" if it's non-numeric (categorical
    labels) OR numeric with few enough unique values to plausibly be class
    labels (0/1, small integer codes, etc). A continuous regression target
    (many unique float values) is neither — class-distribution/class-balance/
    class-conditional-histogram concepts don't apply to it, and computing
    them anyway is both meaningless (hundreds of 1-row "classes") and the
    most failure-prone code path in this file for messy real-world data."""
    if target not in df.columns:
        return False
    try:
        series = df[target].dropna()
        if len(series) == 0:
            return False
        if not pd.api.types.is_numeric_dtype(series):
            return True
        return series.nunique() <= max_classes
    except Exception:
        return False

def run_diagnostics(series: pd.Series, col_name: str) -> dict:
    try:
        clean = series.dropna()
        total = len(series)
        miss = int(series.isna().sum())
        miss_pct = miss / total * 100 if total > 0 else 0
        col_key = str(col_name).lower().replace("_", "").replace(" ", "")
        ZERO_INVALID = {'glucose','insulin','bloodpressure','bmi','skinthickness','age',
                        'weight','height','pulse','temperature','oxygen','hemoglobin',
                        'cholesterol','creatinine','albumin','platelet'}
        if pd.api.types.is_numeric_dtype(series):
            zeros = int((clean == 0).sum())
            if zeros > 0 and any(kw in col_key for kw in ZERO_INVALID):
                return {"title": "Biological Impossibility", "severity": "error",
                        "message": f"{zeros} zeros in {col_name} may be invalid values."}
        if miss_pct > 20:
            return {"title": "High Missingness", "severity": "error",
                    "message": f"{miss} rows ({miss_pct:.1f}%) missing."}
        if miss_pct > 5:
            return {"title": "Moderate Missingness", "severity": "warning",
                    "message": f"{miss} values ({miss_pct:.1f}%) missing."}
        if pd.api.types.is_numeric_dtype(series) and len(clean) > 20:
            sk = safe_round(clean.skew(), 2)
            if sk is not None and abs(sk) > 1.0:
                return {"title": f"{'Right' if sk > 0 else 'Left'}-Skewed", "severity": "info",
                        "message": f"Skewness = {sk:.2f}."}
            Q1, Q3 = clean.quantile(0.25), clean.quantile(0.75)
            IQR = Q3 - Q1
            n_out = int(((clean < Q1-1.5*IQR) | (clean > Q3+1.5*IQR)).sum())
            if n_out > 0 and n_out/len(clean)*100 > 2:
                return {"title": "Potential Outliers", "severity": "warning",
                        "message": f"{n_out} values beyond IQR range."}
        return {"title": "Looking Good", "severity": "ok", "message": f"No issues in {col_name}."}
    except Exception:
        # One column's diagnostics failing must never take down the whole
        # report — surface it as a neutral badge rather than crashing.
        return {"title": "Unavailable", "severity": "ok", "message": f"Could not run diagnostics on {col_name}."}

def isolation_forest_scores(num_df: pd.DataFrame, bin_edges=None):
    """Fits an IsolationForest and returns (histogram, bin_edges). Returns
    (None, None) if there isn't enough data. NOTE: IsolationForest.
    decision_function() requires fit() to have been called first — it does
    NOT auto-fit like fit_predict() does. Calling decision_function without
    fit() raises sklearn's NotFittedError, which would 500 this whole
    endpoint for essentially every real dataset (>=2 numeric cols, >=20
    rows is the common case) — this was the actual bug in the pasted draft."""
    if len(num_df.columns) < 2 or len(num_df) < 20:
        return None, None
    X = StandardScaler().fit_transform(num_df.fillna(0))
    iso = IsolationForest(contamination='auto', random_state=42)
    iso.fit(X)
    raw_scores = iso.decision_function(X)
    rmin, rmax = raw_scores.min(), raw_scores.max()
    norm = (raw_scores - rmin) / (rmax - rmin + 1e-10)
    if bin_edges is None:
        counts, edges = np.histogram(norm, bins=20)
    else:
        counts, edges = np.histogram(norm, bins=bin_edges)
    hist = [{"mid": round(float((edges[i]+edges[i+1])/2), 3), "count": int(counts[i])}
            for i in range(len(counts))]
    return hist, edges

# ─────────────────────────────────────────────────────────────────────────────
# MODELS
# ─────────────────────────────────────────────────────────────────────────────

class AnalyzeReq(BaseModel):
    file_path:          str
    original_file_path: Optional[str] = None
    target_column:      Optional[str] = None

class PCAReq(BaseModel):
    file_path:     str
    target_column: Optional[str] = None

# ─────────────────────────────────────────────────────────────────────────────
# MAIN ANALYSIS  (fast, returns everything except PCA)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/analyze")
def analyze(req: AnalyzeReq):
    # Every route in this router is wrapped in try/except -> HTTPException.
    # An exception that escapes a FastAPI route handler unhandled reaches
    # Starlette's ServerErrorMiddleware, which sits OUTSIDE CORSMiddleware —
    # its fallback response never gets CORS headers attached, so the browser
    # reports a bare "Failed to fetch" instead of a readable error. This
    # router originally had NO try/except anywhere, and separately had a
    # guaranteed crash (see isolation_forest_scores' docstring) — together
    # those two gaps would have made every real dataset 500 with zero
    # diagnostic information reaching the frontend.
    try:
        df      = read_df(req.file_path)
        df_orig = read_df(req.original_file_path) if req.original_file_path else None
        target  = req.target_column

        skewed_curr = compute_skewness(df)
        skewed_orig = compute_skewness(df_orig) if df_orig is not None else []

        corr_curr = compute_correlation(df)
        corr_orig = compute_correlation(df_orig) if df_orig is not None else {}

        ft_corr = feature_target_corr(df, target) if target else []

        # Class distribution / class-conditional histograms only make sense
        # for a classification-shaped target (categorical, or numeric with
        # few distinct values). A continuous regression target would
        # otherwise produce one "class" per unique value — meaningless, and
        # historically the most failure-prone path in this file for messy
        # real-world numeric columns.
        target_is_classification = bool(target) and is_classification_target(df, target)
        class_curr = class_distribution(df, target) if target_is_classification else []
        class_orig = class_distribution(df_orig, target) if (df_orig is not None and target_is_classification) else []

        hist_data = compute_per_col_histograms(df, df_orig)
        class_hists = compute_class_histograms(df, target, ft_corr) if target_is_classification else {}
        diagnostics = {col: run_diagnostics(df[col], col) for col in df.columns}

        miss_curr = {col: int(df[col].isna().sum()) for col in df.columns}
        miss_orig = {col: int(df_orig[col].isna().sum())
                     for col in df_orig.columns} if df_orig is not None else {}

        is_balanced = True
        if class_curr and len(class_curr) >= 2:
            min_pct = min(d["pct"] for d in class_curr)
            is_balanced = min_pct >= 30

        fingerprint = compute_fingerprint(df, target, class_curr, ft_corr)
        signal = build_signal_assessment(df, target, ft_corr, fingerprint, skewed_curr)

        n_skewed = sum(1 for s in skewed_curr if s["severe"])
        # A regression target still gets a real task_type even when it's
        # numeric-but-not-classification-shaped; target_is_classification
        # already encodes exactly that distinction (see its own docstring).
        algo_recs = build_algo_recs(df, "classification" if target_is_classification else "regression",
                                    len(df), len(df.columns), is_balanced,
                                    n_skewed, ft_corr, fingerprint)

        describe = {}
        for col in df.select_dtypes(include=[np.number]).columns:
            try:
                d = df[col].describe()
                describe[col] = {k: safe_round(v, 4) for k, v in d.items()}
            except Exception:
                continue

        # Outlier anomaly scores (IsolationForest on current, and — using
        # the SAME bin edges — on the original, so the two histograms are
        # directly comparable on the before/after overlay chart).
        iso_scores_curr, iso_scores_orig = [], []
        num_df = df.select_dtypes(include=[np.number])
        hist_curr, edges_curr = isolation_forest_scores(num_df)
        if hist_curr is not None:
            iso_scores_curr = hist_curr
            if df_orig is not None:
                orig_num = df_orig.select_dtypes(include=[np.number])
                hist_orig, _ = isolation_forest_scores(orig_num, bin_edges=edges_curr)
                if hist_orig is not None:
                    iso_scores_orig = hist_orig

        return {
            "current": {
                "row_count":   len(df),
                "col_count":   len(df.columns),
                "numeric_cols":     df.select_dtypes(include=[np.number]).columns.tolist(),
                "categorical_cols": df.select_dtypes(exclude=[np.number]).columns.tolist(),
                "total_missing":    int(df.isnull().sum().sum()),
                "missing_per_col":  miss_curr,
                "skewness":    skewed_curr,
                "correlation": corr_curr,
                "class_dist":  class_curr,
                "diagnostics": diagnostics,
                "hist_data":   hist_data,
                "describe":    describe,
                "iso_scores":  iso_scores_curr,
            },
            "original": {
                "row_count":     len(df_orig) if df_orig is not None else None,
                "col_count":     len(df_orig.columns) if df_orig is not None else None,
                "total_missing": int(df_orig.isnull().sum().sum()) if df_orig is not None else None,
                "missing_per_col": miss_orig,
                "skewness":      skewed_orig,
                "correlation":   corr_orig,
                "class_dist":    class_orig,
                "iso_scores":    iso_scores_orig,
            } if df_orig is not None else None,
            "feature_target_corr": ft_corr,
            "class_histograms":    class_hists,
            "fingerprint":         fingerprint,
            "signal":              signal,
            "algorithm_recs":      algo_recs,
            "target_column":       target,
            "target_is_classification": target_is_classification,
        }
    except HTTPException:
        raise
    except Exception as e:
        # Print the full traceback to the server's own log — the detail
        # sent to the client is deliberately just str(e) (a stack trace in
        # an HTTP error body is a bad practice), but if this happens again
        # the exact failing line should be visible in this process's
        # terminal output rather than requiring another guessing round.
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# PCA  (called separately — heavier computation)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/pca")
def compute_pca(req: PCAReq):
    try:
        df     = read_df(req.file_path)
        target = req.target_column
        num_df = df.select_dtypes(include=[np.number]).copy()

        if target and target in num_df.columns:
            num_df = num_df.drop(columns=[target])
        if target and target in df.columns and target not in num_df.columns:
            try:
                tmp = df.copy()
                tmp[target] = tmp[target].astype("category").cat.codes
                num_df = pd.concat([num_df, tmp[[target]]], axis=1)
            except Exception:
                pass

        num_df = num_df.fillna(num_df.median(numeric_only=True))
        if num_df.shape[1] < 2 or len(num_df) < 10:
            raise HTTPException(400, "Need at least 2 numeric columns and 10 rows for PCA.")

        scaler  = StandardScaler()
        X_sc    = scaler.fit_transform(num_df)
        n_comp  = min(num_df.shape[1], len(num_df), 10)
        pca     = PCA(n_components=n_comp, random_state=42)
        X_pca   = pca.fit_transform(X_sc)

        # Scatter data (first 2 PCs, max 800 points)
        sample_n = min(len(df), 800)
        idx = np.random.default_rng(42).choice(len(df), sample_n, replace=False)
        scatter = []
        for i in idx:
            cls = str(df.iloc[i][target]) if (target and target in df.columns) else "?"
            scatter.append({"x": safe_round(X_pca[i, 0]),
                            "y": safe_round(X_pca[i, 1]) if n_comp > 1 else 0,
                            "class": cls})

        # Scree data
        cum = 0.0
        scree = []
        for i, v in enumerate(pca.explained_variance_ratio_):
            cum += v * 100
            scree.append({"pc": f"PC{i+1}", "variance_pct": round(float(v)*100, 2),
                          "cumulative": round(cum, 2)})

        # Component loadings (for 2D)
        loadings = []
        features = list(num_df.columns)
        for fi, feat in enumerate(features):
            loadings.append({"feature": feat,
                             "pc1": safe_round(pca.components_[0, fi], 3) or 0,
                             "pc2": (safe_round(pca.components_[1, fi], 3) or 0) if n_comp > 1 else 0})

        # Silhouette score (for fingerprint separability)
        silhouette = 0.0
        if target and target in df.columns:
            try:
                from sklearn.metrics import silhouette_score as sil
                labels = df.iloc[list(idx)][target].astype("category").cat.codes.values
                if len(np.unique(labels)) >= 2:
                    sil_val = float(sil(X_pca[idx, :2], labels))
                    silhouette = round(max(0, sil_val) * 100, 1)
            except Exception:
                pass

        n80 = next((i+1 for i, row in enumerate(scree) if row["cumulative"] >= 80), n_comp)

        return {
            "scatter":         scatter,
            "scree":           scree,
            "loadings":        loadings[:10],
            "silhouette":      silhouette,
            "n_components_80": n80,
            "explained_2pc":   round(scree[0]["variance_pct"] + (scree[1]["variance_pct"] if len(scree) > 1 else 0), 1),
            "n_features":      len(features),
        }
    except HTTPException:
        raise
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"PCA failed: {str(e)}")
