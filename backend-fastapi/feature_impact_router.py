"""
PRISM — Feature Importance & SHAP Router (FastAPI)
Page name: "Feature Importance"

Computes SHAP global values + model-native feature importance (weight /
gain / coverage) for a model already trained and saved by training_router.py
(POST /training/train, which pickles {"model", "feature_names", "class_names",
"label_encoder", "model_name", "task_type", "threshold"} to
backend-fastapi/saved_models/*.pkl).

Add to main.py:
    from feature_impact_router import router as fi_router
    app.include_router(fi_router)
"""
import os, pickle, warnings
from typing import List, Dict
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from utils.shap_helpers import TREE_MODELS, unwrap_model, select_class_shap, make_kernel_predict_fn
warnings.filterwarnings("ignore")

router = APIRouter(prefix="/feature-impact", tags=["Feature Importance"])

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def read_df(path: str) -> pd.DataFrame:
    if not os.path.exists(path):
        raise HTTPException(404, f"File not found: {path}")
    return pd.read_csv(path)

def load_model(pkl_path: str) -> dict:
    if not os.path.exists(pkl_path):
        raise HTTPException(404, f"Model file not found: {pkl_path}")
    with open(pkl_path, "rb") as f:
        return pickle.load(f)

def safe_round(x, nd=5):
    """None/NaN/inf-safe rounding — same helper as every other router in
    this project (training_router.py, sampling_router.py,
    visualization_router.py). A bare NaN is valid to Python's json module
    but not valid JSON; JS's JSON.parse throws on it. SHAP values on a
    zero-variance sampled column, or a degenerate KernelExplainer background,
    can legitimately produce NaN/inf here."""
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return None
    if xf != xf or xf in (float("inf"), float("-inf")):
        return None
    return round(xf, nd)

def dot_color(norm_val: float) -> str:
    """Blue (low feature value) → white → red (high feature value) — the
    standard SHAP summary-plot coloring convention."""
    if norm_val < 0.5:
        t = norm_val * 2
        r = int(t * 230)
        g = int(t * 170 + 70)
        b = 255
    else:
        t = (norm_val - 0.5) * 2
        r = 255
        g = int((1 - t) * 170 + 50)
        b = int((1 - t) * 220)
    return f"rgb({r},{g},{b})"

def deterministic_jitter(i: int, total: int) -> float:
    """Stable vertical jitter in [-0.4, 0.4] based on index, so dots don't
    stack and the same sample always renders at the same row offset."""
    STEPS = 9
    return ((i % STEPS) / (STEPS - 1) - 0.5) * 0.8

def _booster_scores(model, feature_names: List[str], importance_type: str) -> Dict[str, float]:
    """XGBoost's Booster.get_score() keys by the ACTUAL column name when the
    model was fit on a pandas DataFrame (which training_router.py's
    build_model()/train_model() always do here) — NOT by the generic "f0",
    "f1", ... placeholders that only apply when a model was fit on a bare
    numpy array. Looking up only "f{i}" (the original assumption) silently
    matched nothing and returned all-zero importances for every real model
    in this project — confirmed live (xgboost's weight/gain both came back
    0.0 for every feature until this fixed the lookup). Try the real name
    first, fall back to the positional placeholder for safety."""
    scores = model.get_booster().get_score(importance_type=importance_type)
    return {feat: float(scores.get(feat, scores.get(f"f{i}", 0)))
            for i, feat in enumerate(feature_names)}

def get_importance_weight(model, feature_names: List[str]) -> Dict[str, float]:
    """How often each feature is used for splits across all trees."""
    try:                                  # XGBoost native
        return _booster_scores(model, feature_names, "weight")
    except Exception:
        pass
    inner = unwrap_model(model)
    try:
        trees = getattr(inner, "estimators_", None)
        counts = np.zeros(len(feature_names))
        if trees is not None:
            for t in (trees[:50] if hasattr(trees, "__len__") else [inner]):
                if hasattr(t, "tree_"):
                    for f in t.tree_.feature:
                        if f >= 0:
                            counts[f] += 1
        elif hasattr(inner, "tree_"):
            for f in inner.tree_.feature:
                if f >= 0:
                    counts[f] += 1
        total = counts.sum() or 1
        return {feat: round(float(counts[i] / total), 6) for i, feat in enumerate(feature_names)}
    except Exception:
        return {feat: 0.0 for feat in feature_names}

def get_importance_gain(model, feature_names: List[str]) -> Dict[str, float]:
    """Mean improvement in accuracy (impurity) per split on each feature —
    or, for non-tree models, |coefficient| / native feature_importances_."""
    try:
        return _booster_scores(model, feature_names, "gain")
    except Exception:
        pass
    inner = unwrap_model(model)
    if hasattr(inner, "feature_importances_"):
        return {feat: round(float(inner.feature_importances_[i]), 6)
                for i, feat in enumerate(feature_names)}
    if hasattr(inner, "coef_"):
        coef = inner.coef_[0] if np.ndim(inner.coef_) > 1 else inner.coef_
        return {feat: round(abs(float(coef[i])), 6) for i, feat in enumerate(feature_names)}
    return {feat: 0.0 for feat in feature_names}

def get_importance_coverage(model, feature_names: List[str]) -> Dict[str, float]:
    """Average number of samples affected by each feature's splits."""
    try:
        return _booster_scores(model, feature_names, "cover")
    except Exception:
        pass
    # Non-XGBoost tree models (and everything else) have no native "cover"
    # concept — gain is the closest available proxy (features that reduce
    # impurity the most also tend to gate the most samples).
    return get_importance_gain(model, feature_names)

def to_ranked_list(d: Dict[str, float]) -> List[Dict]:
    total = sum(d.values()) or 1
    return sorted(
        [{"feature": k, "value": safe_round(v) or 0.0, "pct": safe_round(v / total * 100, 2) or 0.0}
         for k, v in d.items()],
        key=lambda x: x["value"], reverse=True,
    )

# ─────────────────────────────────────────────────────────────────────────────
# SHAP COMPUTATION
# ─────────────────────────────────────────────────────────────────────────────

def compute_shap(model, X: pd.DataFrame, model_name: str, task_type: str,
                 max_samples: int = 200) -> dict:
    try:
        import shap
    except ImportError:
        return {"error": "shap library not installed. Run: pip install shap"}

    if len(X) > max_samples:
        idx = np.random.default_rng(42).choice(len(X), max_samples, replace=False)
        X_s = X.iloc[list(idx)]
    else:
        X_s = X.copy()
    X_s = X_s.fillna(0)

    try:
        if model_name in TREE_MODELS:
            # decision_tree/random_forest/random_forest_regressor/xgboost are
            # NOT wrapped in a Pipeline by training_router.py's build_model()
            # — TreeExplainer wants the raw tree model directly, and gets it.
            explainer = shap.TreeExplainer(model)
            shap_values = explainer.shap_values(X_s)
        else:
            # Everything else (knn/svm/logistic_regression/linear_regression/
            # ridge_regression/naive_bayes/kmeans) is handled by one generic,
            # model-agnostic path. Several of these come back from build_model
            # wrapped in a Pipeline("scaler" -> "model") — calling
            # predict/predict_proba directly on the Pipeline is correct
            # regardless of wrapping (it applies its own internal scaling to
            # the raw X passed in), so KernelExplainer against the model
            # as-is is simpler and more robust here than trying to unwrap the
            # inner linear estimator and replicate its scaled input space by
            # hand with LinearExplainer.
            bg_n = min(30, len(X_s))
            bg = shap.sample(X_s, bg_n, random_state=42)
            use_proba = task_type == "classification" and hasattr(model, "predict_proba")
            # make_kernel_predict_fn wraps the call in a plain function
            # rather than passing the model's bound method directly — see
            # utils/shap_helpers.py's docstring (and memory:
            # shap_pipeline_gotchas.md) for why that matters.
            explainer = shap.KernelExplainer(make_kernel_predict_fn(model, use_proba), bg)
            # KernelExplainer is far slower than TreeExplainer — cap how many
            # rows actually get explained so this endpoint stays responsive.
            eval_n = min(len(X_s), 120)
            X_s = X_s.iloc[:eval_n]
            shap_values = explainer.shap_values(X_s, nsamples=100)
    except Exception as e:
        return {"error": str(e)}

    feature_names = list(X_s.columns)
    sv = select_class_shap(shap_values)
    if sv.ndim == 1:
        sv = sv.reshape(1, -1)

    mean_abs = np.abs(sv).mean(axis=0)
    order    = np.argsort(mean_abs)[::-1]

    beeswarm = []
    for rank, fi in enumerate(order[:20]):
        feat      = feature_names[fi]
        sv_col    = sv[:, fi]
        fv_col    = X_s.iloc[:, fi].values.astype(float)
        fmin, fmax = fv_col.min(), fv_col.max()
        span       = (fmax - fmin) or 1

        beeswarm.append({
            "feature":       feat,
            "rank":          rank,
            "mean_abs_shap": safe_round(mean_abs[fi]) or 0.0,
            "samples": [
                {
                    "shap":      safe_round(sv_col[i]) or 0.0,
                    "feat_norm": safe_round((fv_col[i] - fmin) / span, 3) or 0.0,
                    "jitter":    round(deterministic_jitter(i, len(sv_col)), 3),
                    "color":     dot_color(float((fv_col[i] - fmin) / span)),
                }
                for i in range(len(sv_col))
            ],
        })

    # Low-impact features (< 5% of top feature's mean |SHAP|) — deliberately
    # conservative threshold: catches genuine noise without flagging
    # features that still meaningfully contribute.
    top_val = float(mean_abs[order[0]]) if len(order) > 0 else 1.0
    threshold = top_val * 0.05
    low_impact = [feature_names[fi] for fi in order if float(mean_abs[fi]) < threshold]

    return {
        "beeswarm":     beeswarm,
        "low_impact":   low_impact,
        "max_abs_shap": safe_round(sv.max()) if sv.size > 0 else 0,
    }

# ─────────────────────────────────────────────────────────────────────────────
# MODEL-AWARE RIGHT PANEL — non-tree models have no split-based importance,
# so instead of a disabled Weight/Coverage tab + "Gain" standing in for
# coefficient magnitude, the right panel shows one dedicated chart per model
# family. TREE_MODELS (decision_tree/random_forest/random_forest_regressor/
# xgboost) are completely untouched — they keep the weight/gain/coverage
# computation below exactly as it already was.
# ─────────────────────────────────────────────────────────────────────────────

LINEAR_MODELS  = {"logistic_regression", "linear_regression", "ridge_regression"}
CLUSTER_MODELS = {"kmeans"}

def get_model_group(model_name: str, model=None) -> str:
    """tree | linear | perm | cluster — which right-panel chart to show.
    svm is special-cased: build_model() (training_router.py) only gives SVC
    a real .coef_ when kernel='linear' (sklearn's own restriction, not this
    app's) — a linear-kernel SVM is treated like the other linear models,
    every other kernel falls back to permutation importance, same as
    KNN/Naive Bayes."""
    if model_name in TREE_MODELS:
        return "tree"
    if model_name in LINEAR_MODELS:
        return "linear"
    if model_name in CLUSTER_MODELS:
        return "cluster"
    if model_name == "svm":
        kernel = getattr(unwrap_model(model), "kernel", None) if model is not None else None
        return "linear" if kernel == "linear" else "perm"
    return "perm"  # knn, naive_bayes, and any unrecognized model name

def get_linear_coefficients(model, feature_names: List[str]) -> List[Dict]:
    """Signed, ranked coefficients for logistic/linear/ridge regression and
    linear-kernel SVM. build_model() wraps every one of these in
    Pipeline("scaler" -> "model"), so the coefficients read off the
    unwrapped inner estimator are ALREADY standardized — each one already
    means "effect of a 1-standard-deviation change in that feature". No
    manual coef * feature_std multiplication is needed here, and doing it
    anyway would double-standardize and understate every coefficient."""
    inner = unwrap_model(model)
    if not hasattr(inner, "coef_"):
        return [{"error": "This model has no coefficients to show."}]
    coef = inner.coef_
    # Binary classification / binary SVM boundary: (1, n_features). Multiclass
    # (or one-vs-one SVM, one row per class pair): same first-row
    # simplification get_importance_gain() above already uses for coef_.
    if np.ndim(coef) > 1:
        coef = coef[0]
    result = []
    for i, feat in enumerate(feature_names):
        v = safe_round(float(coef[i])) or 0.0
        result.append({"feature": feat, "value": v, "abs_value": abs(v),
                        "direction": "positive" if v >= 0 else "negative"})
    result.sort(key=lambda x: x["abs_value"], reverse=True)
    for i, r in enumerate(result):
        r["rank"] = i + 1
    return result

def compute_permutation_importance(model, X: pd.DataFrame, y: pd.Series,
                                   task_type: str, feature_names: List[str],
                                   max_rows: int = 300) -> List[Dict]:
    """Shuffle each feature, measure the score drop — the standard
    model-agnostic fallback for KNN, Naive Bayes, and non-linear-kernel SVM
    (none of which expose coefficients or a split-based importance concept).
    Capped to max_rows for the same reason compute_shap() caps
    KernelExplainer's input: n_repeats re-scoring passes over the model's
    full predict cost would make this endpoint slow on a large dataset.
    n_jobs is left at sklearn's sequential default (not -1) — joblib's
    process-based parallelism can leave orphaned worker processes behind on
    Windows, and the row/feature caps here already keep sequential execution
    fast enough that parallelizing isn't worth that risk."""
    from sklearn.inspection import permutation_importance
    try:
        if len(X) > max_rows:
            idx = np.random.default_rng(42).choice(len(X), max_rows, replace=False)
            X_s, y_s = X.iloc[list(idx)], y.iloc[list(idx)]
        else:
            X_s, y_s = X, y
        scoring = "r2" if task_type == "regression" else "accuracy"
        result = permutation_importance(model, X_s, y_s, n_repeats=5,
                                        scoring=scoring, random_state=42)
        out = []
        for i, feat in enumerate(feature_names):
            v = safe_round(float(result.importances_mean[i])) or 0.0
            out.append({"feature": feat, "value": v, "abs_value": abs(v),
                        "std": safe_round(float(result.importances_std[i])) or 0.0})
        out.sort(key=lambda x: x["abs_value"], reverse=True)
        for i, r in enumerate(out):
            r["rank"] = i + 1
        return out
    except Exception as e:
        return [{"error": str(e)}]

def compute_cluster_f_stat(model, X: pd.DataFrame, feature_names: List[str]) -> List[Dict]:
    """ANOVA F-statistic per feature: variance BETWEEN K-Means cluster means
    vs. variance WITHIN each cluster. K-Means has no target and no
    coefficients, so this is the closest analogue to "importance" here — a
    feature the clustering leaned on heavily will differ sharply across
    cluster centers relative to its own spread inside each cluster."""
    from scipy.stats import f_oneway
    try:
        labels = np.asarray(model.predict(X))
        clusters = sorted(set(labels.tolist()))
        if len(clusters) < 2:
            return [{"error": "K-Means found fewer than 2 clusters on this data — cluster separation can't be computed."}]
        out = []
        for feat in feature_names:
            groups = [X.loc[labels == c, feat].dropna().values for c in clusters]
            groups = [g for g in groups if len(g) > 1]
            if len(groups) < 2:
                out.append({"feature": feat, "value": 0.0, "abs_value": 0.0, "p_value": None})
                continue
            f_stat, p_val = f_oneway(*groups)
            v = safe_round(float(f_stat)) or 0.0
            out.append({"feature": feat, "value": v, "abs_value": v, "p_value": safe_round(float(p_val), 6)})
        total = sum(r["abs_value"] for r in out) or 1
        for r in out:
            r["pct"] = safe_round(r["abs_value"] / total * 100, 2) or 0.0
        out.sort(key=lambda x: x["abs_value"], reverse=True)
        for i, r in enumerate(out):
            r["rank"] = i + 1
        return out
    except Exception as e:
        return [{"error": str(e)}]

# ─────────────────────────────────────────────────────────────────────────────
# REQUEST MODEL
# ─────────────────────────────────────────────────────────────────────────────

class ComputeReq(BaseModel):
    file_path:      str
    target_column:  str = ""
    model_pkl_path: str
    task_type:      str = "classification"

# ─────────────────────────────────────────────────────────────────────────────
# MAIN ENDPOINT
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/compute")
def compute_feature_impact(req: ComputeReq):
    try:
        df    = read_df(req.file_path)
        mdata = load_model(req.model_pkl_path)
        model = mdata.get("model")
        if model is None:
            raise HTTPException(400, "This .pkl file doesn't look like a PRISM-trained model (missing 'model' key).")

        feature_names = mdata.get("feature_names") or [
            c for c in df.columns if c != req.target_column
        ]
        missing = [c for c in feature_names if c not in df.columns]
        if missing:
            raise HTTPException(
                400,
                f"This dataset is missing {len(missing)} column(s) the model was trained on "
                f"({', '.join(missing[:5])}{'…' if len(missing) > 5 else ''}). "
                "Feature Importance must run against the same dataset version used for Training."
            )

        X = df[feature_names].fillna(0)
        mname = mdata.get("model_name", "unknown")
        task_type = mdata.get("task_type", req.task_type)

        # ── Feature Importance (3 modes) ────────────────────────────────────
        weight   = to_ranked_list(get_importance_weight(model, feature_names))
        gain     = to_ranked_list(get_importance_gain(model, feature_names))
        coverage = to_ranked_list(get_importance_coverage(model, feature_names))
        supports_wgc = mname in TREE_MODELS

        # ── Model-aware right panel (non-tree models) ───────────────────────
        model_group = get_model_group(mname, model)
        right_panel: Dict = {}
        if model_group == "linear":
            right_panel["coefficients"] = get_linear_coefficients(model, feature_names)
        elif model_group == "perm":
            y_perm = df[req.target_column] if req.target_column in df.columns else None
            if y_perm is None:
                right_panel["perm_data"] = [{"error": "A target column is required to compute permutation importance for this model."}]
            else:
                if task_type != "regression" and not pd.api.types.is_numeric_dtype(y_perm):
                    from sklearn.preprocessing import LabelEncoder
                    y_perm = pd.Series(LabelEncoder().fit_transform(y_perm.astype(str)), index=y_perm.index)
                right_panel["perm_data"] = compute_permutation_importance(model, X, y_perm, task_type, feature_names)
        elif model_group == "cluster":
            right_panel["f_stat_data"] = compute_cluster_f_stat(model, X, feature_names)

        # ── SHAP ─────────────────────────────────────────────────────────────
        shap_result = compute_shap(model, X, mname, task_type)

        # ── Suggestions from SHAP (Level 2: rule-based) ─────────────────────
        low_impact = shap_result.get("low_impact", [])
        suggestions = []
        if low_impact and not shap_result.get("error"):
            suggestions.append({
                "type":     "removal_candidate",
                "features": low_impact,
                "message":  (
                    f"{len(low_impact)} feature(s) contributed less than 5% of the top feature's "
                    f"SHAP impact: {', '.join(low_impact[:5])}{'…' if len(low_impact) > 5 else ''}. "
                    "Consider going back to Feature Selection to remove them and retrain for a "
                    "leaner, potentially better-generalizing model."
                ),
            })

        # ── Descriptions (rule-based, no LLM) ───────────────────────────────
        top_shap = shap_result["beeswarm"][0]["feature"] if shap_result.get("beeswarm") else "—"
        top_gain = gain[0]["feature"]    if gain and gain[0]["value"] > 0    else "—"
        top_wt   = weight[0]["feature"]  if weight and weight[0]["value"] > 0 else "—"
        top_cov  = coverage[0]["feature"] if coverage and coverage[0]["value"] > 0 else "—"

        shap_conclusion = (
            f"'{top_shap}' has the highest average SHAP impact on predictions. "
            f"Dots to the right of 0 pushed the model toward the positive/higher-valued outcome; "
            f"dots to the left pulled it down. Colors show each sample's own feature value — "
            f"red = high, blue = low."
        ) if top_shap != "—" else "SHAP could not be computed for this model — see the error message above."

        gain_conclusion = (
            f"Gain view: '{top_gain}' contributes the most to reducing prediction error when used "
            f"as a split criterion. This is the most reliable single measure of true feature "
            f"importance for tree-based models."
        ) if top_gain != "—" else (
            "This model type doesn't expose a native split-based importance score — rely on the "
            "SHAP chart on the left for this model instead."
        )
        weight_conclusion = (
            f"Weight view: '{top_wt}' appears most often across all tree splits. High weight does "
            f"not always mean high impact — the model may split on it frequently but with small "
            f"gains each time."
        ) if top_wt != "—" else "Weight requires a tree-based model — see the note above the chart."
        coverage_conclusion = (
            f"Coverage view: '{top_cov}' affects the most data samples per split. Broad-coverage "
            f"features act as gatekeepers — they influence large portions of the dataset with "
            f"every decision."
        ) if top_cov != "—" else "Coverage requires a tree-based model — see the note above the chart."

        if model_group == "linear":
            coefs = right_panel.get("coefficients", [])
            if coefs and "error" not in coefs[0]:
                top = coefs[0]
                right_panel_conclusion = (
                    f"'{top['feature']}' has the strongest standardized effect on the prediction "
                    f"({top['value']:+.4f}). Since every feature was scaled before fitting, a "
                    f"1-standard-deviation increase in '{top['feature']}' "
                    f"{'raises' if top['direction'] == 'positive' else 'lowers'} the model's output by "
                    f"that amount, holding the other features constant."
                )
            else:
                right_panel_conclusion = coefs[0]["error"] if coefs else "Coefficients could not be computed for this model."
        elif model_group == "perm":
            perm = right_panel.get("perm_data", [])
            if perm and "error" not in perm[0]:
                top = perm[0]
                right_panel_conclusion = (
                    f"'{top['feature']}' caused the largest score drop when its values were shuffled "
                    f"({top['value']:+.4f}). The model depends on this feature more than any other to "
                    f"make correct predictions."
                )
            else:
                right_panel_conclusion = perm[0]["error"] if perm else "Permutation importance could not be computed for this model."
        elif model_group == "cluster":
            fstat = right_panel.get("f_stat_data", [])
            if fstat and "error" not in fstat[0]:
                top = fstat[0]
                right_panel_conclusion = (
                    f"'{top['feature']}' separates the clusters most strongly (F = {top['value']:.2f}). "
                    f"Its values vary far more BETWEEN clusters than WITHIN any single cluster — the "
                    f"clearest sign a feature actually drove how K-Means grouped the data."
                )
            else:
                right_panel_conclusion = fstat[0]["error"] if fstat else "Cluster separation could not be computed for this model."
        else:
            right_panel_conclusion = None

        return {
            "model_name":         mname,
            "task_type":          task_type,
            "feature_names":      feature_names,
            "supports_wgc":       supports_wgc,
            "model_group":        model_group,
            "feature_importance": {"weight": weight, "gain": gain, "coverage": coverage},
            "right_panel":        right_panel,
            "shap":               shap_result,
            "suggestions":        suggestions,
            "descriptions": {
                "shap": shap_conclusion, "gain": gain_conclusion,
                "weight": weight_conclusion, "coverage": coverage_conclusion,
                "right_panel": right_panel_conclusion,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Feature importance computation failed: {str(e)}")
