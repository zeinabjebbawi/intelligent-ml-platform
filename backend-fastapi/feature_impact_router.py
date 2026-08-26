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
warnings.filterwarnings("ignore")

router = APIRouter(prefix="/feature-impact", tags=["Feature Importance"])

# Same set training_router.py's build_model() leaves UNWRAPPED (raw
# estimator, not a Pipeline) — these are the only model types that expose a
# real split-based weight/gain/coverage concept at all.
TREE_MODELS = {"decision_tree", "random_forest", "random_forest_regressor", "xgboost"}

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

def unwrap_model(model):
    """training_router.py's build_model() wraps scale-sensitive models
    (knn/svm/logistic_regression/linear_regression/ridge_regression) in an
    sklearn Pipeline("scaler" -> "model") — a Pipeline does NOT forward
    attributes like .coef_/.feature_importances_ from its final step, so
    any code that needs those must unwrap first. Same helper as
    training_router.py's own unwrap_model()."""
    if hasattr(model, "named_steps"):
        return model.named_steps.get("model", model)
    return model

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

def _select_class_shap(shap_values):
    """Normalize whatever shape shap.Explainer().shap_values() handed back
    into one (n_samples, n_features) array. Older shap versions return a
    LIST of per-class arrays for classifiers; newer versions (this pattern
    surfaced in training_router.py's own numpy-type bugs — shap has the same
    "the library's exact output shape isn't guaranteed by version" problem)
    can instead return one 3D ndarray (n_samples, n_features, n_classes).
    Either way, for multiclass this deliberately picks class index 1 (the
    positive class for binary) as the one summary shown — same choice the
    original single-branch version made, just made version-safe."""
    if isinstance(shap_values, list):
        return np.asarray(shap_values[1] if len(shap_values) > 1 else shap_values[0])
    arr = np.asarray(shap_values)
    if arr.ndim == 3:
        idx = 1 if arr.shape[-1] > 1 else 0
        return arr[:, :, idx]
    return arr

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
            # A plain wrapping function, NOT the model's bound method
            # directly. shap's KernelExplainer tries to stamp metadata
            # (feature_names_in_) onto whatever callable it's given — for a
            # bound method that attempt lands on the underlying object, and
            # sklearn's Pipeline exposes feature_names_in_ as a read-only
            # property with no setter, raising
            # `AttributeError: property 'feature_names_in_' of 'Pipeline'
            # object has no setter`. Confirmed live: every Pipeline-wrapped
            # model here (knn/svm/logistic_regression/linear_regression/
            # ridge_regression — see training_router.py's build_model())
            # crashed with exactly this until routed through a wrapper
            # function instead, which has no such property to fail on.
            def _predict_fn(arr):
                return model.predict_proba(arr) if use_proba else model.predict(arr)
            explainer = shap.KernelExplainer(_predict_fn, bg)
            # KernelExplainer is far slower than TreeExplainer — cap how many
            # rows actually get explained so this endpoint stays responsive.
            eval_n = min(len(X_s), 120)
            X_s = X_s.iloc[:eval_n]
            shap_values = explainer.shap_values(X_s, nsamples=100)
    except Exception as e:
        return {"error": str(e)}

    feature_names = list(X_s.columns)
    sv = _select_class_shap(shap_values)
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

        return {
            "model_name":         mname,
            "task_type":          task_type,
            "feature_names":      feature_names,
            "supports_wgc":       supports_wgc,
            "feature_importance": {"weight": weight, "gain": gain, "coverage": coverage},
            "shap":               shap_result,
            "suggestions":        suggestions,
            "descriptions": {
                "shap": shap_conclusion, "gain": gain_conclusion,
                "weight": weight_conclusion, "coverage": coverage_conclusion,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Feature importance computation failed: {str(e)}")
