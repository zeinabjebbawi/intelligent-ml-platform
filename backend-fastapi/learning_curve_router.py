"""
PRISM — Learning Curve Router (FastAPI)
Page name: "Learning Curve"

Computes sklearn learning curves (train vs. validation score at increasing
training-set sizes) for a model already trained and saved by
training_router.py (POST /training/train, which pickles {"model",
"feature_names", "class_names", "label_encoder", "model_name", "task_type",
"threshold"} to backend-fastapi/saved_models/*.pkl).

Add to main.py:
    from learning_curve_router import router as lc_router
    app.include_router(lc_router)
"""
import os, pickle, warnings
from typing import Dict, List
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
warnings.filterwarnings("ignore")

router = APIRouter(prefix="/learning-curve", tags=["Learning Curve"])

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
    this project (training_router.py, feature_impact_router.py, etc). A
    degenerate CV fold (e.g. a class entirely absent from a tiny fold) can
    legitimately make precision/recall/F1 come back NaN; a bare NaN is
    valid to Python's json module but invalid JSON, and JS's JSON.parse
    throws on it."""
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return None
    if xf != xf or xf in (float("inf"), float("-inf")):
        return None
    return round(xf, nd)

def ema_smooth(values: List[float], alpha: float = 0.35) -> List[float]:
    """Exponential Moving Average smoothing to remove noise from learning
    curves — precomputed server-side so the frontend's toggle is instant."""
    if not values:
        return []
    smoothed = [values[0]]
    for v in values[1:]:
        prev = smoothed[-1] if smoothed[-1] is not None else 0.0
        vv = v if v is not None else prev
        smoothed.append(alpha * vv + (1 - alpha) * prev)
    return [safe_round(s) for s in smoothed]

def find_plateau_index(scores: List[float], delta_threshold: float = 0.003) -> int:
    """Index of the last step where validation score improved by more than
    delta_threshold — the training size beyond which more data stopped
    meaningfully helping."""
    clean = [s if s is not None else 0.0 for s in scores]
    if len(clean) < 3:
        return len(clean) - 1
    last_significant = 0
    for i in range(1, len(clean)):
        if abs(clean[i] - clean[i - 1]) > delta_threshold:
            last_significant = i
    return last_significant

def classify_pattern(train_means: List[float], val_means: List[float]) -> dict:
    """good_fit / overfitting / underfitting / needs_more_data, from the
    final train/validation scores and whether validation had plateaued."""
    if not train_means or not val_means:
        return {"type": "unknown", "gap": 0.0, "final_train": 0.0, "final_val": 0.0,
                "plateau_idx": 0, "still_rising": False}

    final_train = train_means[-1] if train_means[-1] is not None else 0.0
    final_val   = val_means[-1] if val_means[-1] is not None else 0.0
    final_gap   = final_train - final_val
    plateau_idx = find_plateau_index(val_means)
    still_rising = plateau_idx == len(val_means) - 1

    if still_rising and final_val < 0.90:
        pattern = "needs_more_data"
    elif final_gap > 0.12 and final_val < 0.88:
        pattern = "overfitting"
    elif final_val < 0.60 and final_gap < 0.08:
        pattern = "underfitting"
    else:
        pattern = "good_fit"

    return {
        "type": pattern, "gap": safe_round(final_gap) or 0.0,
        "final_train": safe_round(final_train) or 0.0, "final_val": safe_round(final_val) or 0.0,
        "plateau_idx": plateau_idx, "still_rising": still_rising,
    }

def generate_suggestion(pattern: dict, n_total: int, train_ratio: float, optimal_size: int) -> dict:
    """Level-2, rule-based suggestion engine — exactly the 4 outcomes the
    platform spec calls for: oversample / undersample (both → Sampling
    page), retrain (→ Training page), or proceed."""
    actual_training_n = int(n_total * train_ratio)
    pattern_type = pattern["type"]

    # Validation still rising at the max training size AND the split is
    # already at (or near) the largest train share that still leaves a
    # usable test set — the only lever left is MORE rows, via oversampling.
    if pattern_type == "needs_more_data" and train_ratio >= 0.85:
        return {
            "action": "oversample", "target": "sampling", "severity": "warning",
            "title": "Model Needs More Training Data — Consider Oversampling",
            "message": (
                f"The validation curve is still rising at the maximum training size ({actual_training_n:,} rows, "
                f"{int(train_ratio*100)}% split). The model hasn't finished learning from what's available. "
                f"Since {int(train_ratio*100)}% is already going to training, the only way to give it more rows "
                f"without shrinking the test set further is oversampling on the Sampling page."
            ),
            "why": (
                "When validation performance keeps climbing without flattening, more training data would "
                "measurably help — this is a data-starvation problem, not a model-complexity problem."
            ),
        }

    # Still rising, but the split isn't maxed out yet (train_ratio < 85%) —
    # a real gap in the original pasted logic: falling straight through to
    # the generic "good fit, proceed" message here would tell the user the
    # model is well-fitted when the validation curve is demonstrably still
    # climbing. Confirmed live: a decision_tree run with train_ratio=0.80
    # landed exactly here and would have shown the false "ready to proceed"
    # message. There's still room to grow the training share itself before
    # resorting to oversampling, so point back to Training to raise the
    # split ratio first.
    if pattern_type == "needs_more_data":
        return {
            "action": "increase_split", "target": "training", "severity": "warning",
            "title": "Model Needs More Training Data — Consider a Larger Split Ratio",
            "message": (
                f"The validation curve is still rising at the current training size ({actual_training_n:,} rows, "
                f"{int(train_ratio*100)}% split). Since the split isn't at its maximum yet, return to the Train "
                f"and Test page and increase the training share of the split — that alone may let the model keep "
                f"learning. If you're already at the largest split you're comfortable with, oversampling on the "
                f"Sampling page is the next lever."
            ),
            "why": (
                "When validation performance keeps climbing without flattening, the model hasn't seen enough "
                "rows yet — this is a data-starvation problem, not a model-complexity problem."
            ),
        }

    # Validation plateaued well before the actual training size — the
    # excess rows are pure computational cost with no accuracy benefit, and
    # the test split (1 - train_ratio) can't be grown further without
    # shrinking evaluation reliability, so the fix is trimming the TRAIN side.
    if pattern_type in ("good_fit", "overfitting") and optimal_size < actual_training_n * 0.70:
        excess_pct = int((1 - optimal_size / actual_training_n) * 100) if actual_training_n else 0
        return {
            "action": "undersample", "target": "sampling", "severity": "info",
            "title": f"Excess Training Data Detected — Consider Undersampling ({excess_pct}% excess)",
            "message": (
                f"Validation score plateaued at about {optimal_size:,} training samples, but the current "
                f"training set has {actual_training_n:,}. The extra {actual_training_n - optimal_size:,} rows "
                f"add computation cost without improving validation performance — since the split ratio is "
                f"already fixed, trimming the training set itself (undersampling on the Sampling page) is the "
                f"only way to shed that excess without touching the test set."
            ),
            "why": (
                "When the curve flattens well before the full training size, more data isn't buying anything. "
                "This is especially costly for slow-training models like SVM or gradient-boosted trees."
            ),
        }

    if pattern_type == "overfitting":
        return {
            "action": "retrain", "target": "training", "severity": "warning",
            "title": "Overfitting Detected — Return to Training and Adjust the Model",
            "message": (
                f"Training score ({pattern['final_train']:.3f}) is well above validation "
                f"({pattern['final_val']:.3f}) — a generalization gap of {pattern['gap']:.3f}. The model "
                f"memorized training data. Return to Training to reduce complexity (e.g. shallower trees), "
                f"add regularization, or try a simpler model."
            ),
            "why": "Overfitting means the model learned noise that doesn't generalize — usually a model-complexity issue, not a data-quantity one.",
        }

    if pattern_type == "underfitting":
        return {
            "action": "retrain", "target": "training", "severity": "danger",
            "title": "Underfitting Detected — Return to Training for a More Capable Model",
            "message": (
                f"Both training ({pattern['final_train']:.3f}) and validation ({pattern['final_val']:.3f}) "
                f"scores are low with a small gap — the model is too simple for this data. Return to Training "
                f"to increase capacity (deeper trees, more estimators) or pick a more powerful algorithm."
            ),
            "why": "Underfitting means the model's capacity is too low to capture the pattern — more data won't fix that, a stronger model will.",
        }

    return {
        "action": "proceed", "target": "next", "severity": "success",
        "title": "Model is Well-Fitted — Ready to Proceed",
        "message": (
            f"Training ({pattern['final_train']:.3f}) and validation ({pattern['final_val']:.3f}) scores are "
            f"close, gap of only {pattern['gap']:.3f}. The model generalizes well — no obvious over/underfitting. "
            f"You can confidently move on."
        ),
        "why": "A small generalization gap means the model learned real patterns rather than memorizing noise, and should perform similarly on unseen data.",
    }

PATTERN_DESCRIPTIONS = {
    "good_fit": {
        "general": (
            "A learning curve plots model performance (Y-axis) against how many training samples were used "
            "(X-axis). Two lines: the Training Curve (how well the model fits its own training data) and the "
            "Validation Curve (how well it generalizes to unseen data). The shaded Generalization Gap between "
            "them is the health signal — ideally small."
        ),
        "insight": (
            "Training and validation curves converge closely and both reach strong scores — the ideal shape. "
            "The model learned genuine patterns without overfitting, and the small gap says it should perform "
            "similarly on real unseen data. No significant changes needed here."
        ),
    },
    "overfitting": {
        "general": (
            "A learning curve plots model performance against training set size. Training (fit to its own "
            "data) vs. Validation (generalization) tells the complete story — a large, persistent gap between "
            "them is the problem signal."
        ),
        "insight": (
            "The wide gap shows high variance (overfitting) — the model learned the training data too "
            "precisely, including its noise. Performance drops on unseen data. Fixes: reduce complexity, add "
            "regularization, or gather more data to force broader patterns."
        ),
    },
    "underfitting": {
        "general": (
            "The learning curve shows how the model's ability to learn scales with data size. When both curves "
            "are low and close together, the model hasn't captured enough complexity from the data at all."
        ),
        "insight": (
            "Both curves are flat and low — classic high bias (underfitting). The small gap means the model is "
            "consistently poor at both memorizing and generalizing. More training data will NOT help — the "
            "architecture itself needs to change."
        ),
    },
    "needs_more_data": {
        "general": (
            "The learning curve shows performance improving as more training data is added. A validation curve "
            "still rising at the rightmost point means the model is data-hungry — it can still learn."
        ),
        "insight": (
            "Validation hasn't plateaued — it keeps improving as training size increases. This is a data "
            "availability problem, not a model-complexity one. The architecture is appropriate; it needs more "
            "examples to learn from."
        ),
    },
    "unknown": {
        "general": "Learning curve analysis could not classify the pattern with confidence.",
        "insight": "Review the curves manually for signs of overfitting or underfitting.",
    },
}

CLASSIFICATION_METRIC_DESCRIPTIONS = {
    "accuracy":  "Accuracy measures the fraction of correct predictions overall. Range 0–1 (higher is better).",
    "f1":        "F1-Score is the harmonic mean of Precision and Recall — the best single metric for imbalanced datasets. Range 0–1.",
    "precision": "Precision answers \"of everything predicted positive, how much really was?\" Range 0–1.",
    "recall":    "Recall answers \"of everything actually positive, how much did the model catch?\" Range 0–1.",
}
REGRESSION_METRIC_DESCRIPTIONS = {
    "r2":  "R² (coefficient of determination) measures how much of the target's variance the model explains. 1.0 is a perfect fit, 0 means no better than predicting the mean.",
    "mae": "Mean Absolute Error — the average size of the model's prediction error, in the target's own units (lower is better).",
}

# ─────────────────────────────────────────────────────────────────────────────
# REQUEST
# ─────────────────────────────────────────────────────────────────────────────

class ComputeReq(BaseModel):
    file_path:      str
    target_column:  str = ""
    model_pkl_path: str
    task_type:      str = "classification"
    train_ratio:    float = 0.80
    cv_folds:       int = 3
    n_sizes:        int = 8   # number of training-size steps (fewer = faster)
    stratified:     bool = True

# ─────────────────────────────────────────────────────────────────────────────
# COMPUTE ENDPOINT
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/compute")
def compute_learning_curve(req: ComputeReq):
    try:
        from sklearn.model_selection import learning_curve, StratifiedKFold, KFold
        from sklearn.preprocessing import LabelEncoder

        mdata = load_model(req.model_pkl_path)
        model = mdata.get("model")
        if model is None:
            raise HTTPException(400, "This .pkl file doesn't look like a PRISM-trained model (missing 'model' key).")

        task_type = mdata.get("task_type", req.task_type)
        if task_type == "clustering":
            raise HTTPException(
                400,
                "Learning curves need a target column to score predictions against, so they don't apply to "
                "clustering models — there's no ground truth to compare training vs. validation performance on."
            )
        if not req.target_column:
            raise HTTPException(400, "A target column is required to compute a learning curve.")

        df = read_df(req.file_path)
        if req.target_column not in df.columns:
            raise HTTPException(
                400,
                f"Target column '{req.target_column}' was not found in this dataset "
                f"(available columns: {', '.join(df.columns)})."
            )

        feature_names = mdata.get("feature_names") or [c for c in df.columns if c != req.target_column]
        missing = [c for c in feature_names if c not in df.columns]
        if missing:
            raise HTTPException(
                400,
                f"This dataset is missing {len(missing)} column(s) the model was trained on "
                f"({', '.join(missing[:5])}{'…' if len(missing) > 5 else ''}). "
                "Learning Curve must run against the same dataset version used for Training."
            )

        X = df[feature_names].fillna(0)
        y = df[req.target_column]
        if not pd.api.types.is_numeric_dtype(y):
            y = pd.Series(LabelEncoder().fit_transform(y.astype(str)), index=y.index)

        n_total = len(X)
        min_needed = 3 * req.cv_folds
        if n_total < min_needed:
            raise HTTPException(
                400,
                f"This dataset only has {n_total} rows — at least {min_needed} are needed for a "
                f"{req.cv_folds}-fold learning curve. Reduce cv_folds or use a larger dataset."
            )

        cv_splitter = (
            StratifiedKFold(n_splits=req.cv_folds, shuffle=True, random_state=42)
            if (task_type == "classification" and req.stratified)
            else KFold(n_splits=req.cv_folds, shuffle=True, random_state=42)
        )

        # Smallest fraction that still gives every fold at least ~3 samples
        # per class/fold, capped below 1.0 so linspace never runs backwards
        # on a small dataset (a real crash risk in the original formula —
        # 3*cv_folds/n_total can legitimately exceed 1.0 on a tiny dataset).
        # Floor lowered 0.15->0.03: the true safety constraint is entirely
        # `min_needed/n_total` (enough samples per fold) - 0.15 was an
        # extra, unnecessarily generous cosmetic minimum on top of that,
        # which is exactly why the curve always started a third of the way
        # into the chart regardless of dataset size. 0.03 still protects
        # tiny datasets (min_needed/n_total wins there anyway) while
        # starting close to the y-axis on any normally-sized one.
        start_frac = min(0.9, max(0.03, min_needed / n_total))
        train_sizes_rel = np.linspace(start_frac, 1.0, req.n_sizes)
        # Percentage of the per-fold training portion each step represents -
        # by construction (np.linspace ending at 1.0) this ALWAYS spans up
        # to exactly 100%, unlike the absolute sample counts below (which
        # depend on dataset size and cv_folds, and can never universally
        # reach a fixed "100"). This is what the frontend's x-axis plots.
        training_pct = [round(float(v) * 100, 1) for v in train_sizes_rel]

        if task_type == "classification":
            metrics = ["accuracy", "f1_weighted", "precision_weighted", "recall_weighted"]
        else:
            metrics = ["r2", "neg_mean_absolute_error"]

        metric_key_map = {
            "accuracy": "accuracy", "f1_weighted": "f1",
            "precision_weighted": "precision", "recall_weighted": "recall",
            "r2": "r2", "neg_mean_absolute_error": "mae",
        }

        curves: Dict = {}
        for scoring in metrics:
            key = metric_key_map.get(scoring, scoring)
            try:
                sizes_abs, train_sc, val_sc = learning_curve(
                    model, X, y, train_sizes=train_sizes_rel, cv=cv_splitter,
                    scoring=scoring, n_jobs=2, error_score=0,
                )
                # neg_mean_absolute_error comes back negative by sklearn
                # convention (scorers are "higher is better") — flip sign so
                # the frontend can treat MAE like every other metric here
                # (lower magnitude = better, plotted as a positive number).
                sign = -1 if scoring == "neg_mean_absolute_error" else 1
                train_mean = [safe_round(v * sign) for v in train_sc.mean(axis=1)]
                train_std  = [safe_round(v) for v in train_sc.std(axis=1)]
                val_mean   = [safe_round(v * sign) for v in val_sc.mean(axis=1)]
                val_std    = [safe_round(v) for v in val_sc.std(axis=1)]
                curves[key] = {
                    "training_sizes": [int(s) for s in sizes_abs],
                    "training_pct": training_pct,
                    "train_mean": train_mean, "train_std": train_std,
                    "val_mean": val_mean, "val_std": val_std,
                    "train_smooth": ema_smooth(train_mean), "val_smooth": ema_smooth(val_mean),
                }
            except Exception as e:
                curves[key] = {"error": str(e)}

        primary_candidates = ["accuracy", "r2"]
        primary_key = next((k for k in primary_candidates if k in curves and "error" not in curves[k]), None)
        if primary_key is None:
            primary_key = next((k for k in curves if "error" not in curves[k]), list(curves.keys())[0])
        primary = curves[primary_key]

        if "error" in primary:
            # Every metric failed — surface the real sklearn error rather
            # than crashing on the pattern-classification math below.
            raise HTTPException(500, f"Learning curve computation failed for every metric: {primary['error']}")

        pattern = classify_pattern(primary.get("train_mean", []), primary.get("val_mean", []))
        plateau_idx = pattern.get("plateau_idx", len(primary.get("training_sizes", [0])) - 1)
        sizes_list = primary.get("training_sizes", [n_total])
        optimal_size = sizes_list[min(plateau_idx, len(sizes_list) - 1)]
        pct_list = primary.get("training_pct", [])
        optimal_pct = pct_list[min(plateau_idx, len(pct_list) - 1)] if pct_list else None

        suggestion = generate_suggestion(pattern, n_total, req.train_ratio, optimal_size)
        pattern_descs = PATTERN_DESCRIPTIONS.get(pattern["type"], PATTERN_DESCRIPTIONS["unknown"])
        metric_descs = CLASSIFICATION_METRIC_DESCRIPTIONS if task_type == "classification" else REGRESSION_METRIC_DESCRIPTIONS

        return {
            "curves": curves,
            "pattern": pattern,
            "optimal_size": int(optimal_size),
            "optimal_pct": optimal_pct,
            "n_total": n_total,
            "actual_train_n": int(n_total * req.train_ratio),
            "train_ratio": req.train_ratio,
            "suggestion": suggestion,
            "descriptions": {
                "general": pattern_descs["general"], "insight": pattern_descs["insight"],
                "metrics": metric_descs,
            },
            "model_name": mdata.get("model_name", "unknown"),
            "task_type": task_type,
            "primary_metric": primary_key,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Learning curve computation failed: {str(e)}")
