"""
Shared SHAP-dispatch helpers.

Extracted after the exact same bug pattern was found and fixed live in
feature_impact_router.py, then needed again unchanged in
simulator_router.py — per this project's standing rule (see memory:
feedback_balance_checker_platform_rule.md), a concept proven bug-prone in
more than one place gets ONE shared implementation, not independent
reimplementations that can silently drift back out of sync.

The core problem this solves: training_router.py's build_model() wraps
several scale-sensitive model types (knn/svm/logistic_regression/
linear_regression/ridge_regression) in an sklearn Pipeline("scaler" ->
"model"). Two SHAP-specific issues fall out of that:
  1. shap.TreeExplainer only works on the RAW tree model — safe to call
     directly only for the model names that build_model() never wraps
     (see TREE_MODELS below).
  2. shap.KernelExplainer given a Pipeline's BOUND METHOD (e.g.
     `pipeline.predict_proba`) crashes with
     `AttributeError: property 'feature_names_in_' of 'Pipeline' object
     has no setter` — shap tries to stamp metadata onto whatever object
     the callable belongs to, and a Pipeline exposes that attribute as a
     read-only property. Confirmed live for every wrapped model type. The
     fix is passing a plain wrapping function instead (make_kernel_predict_fn).
"""
import numpy as np

# Same set training_router.py's build_model() leaves UNWRAPPED (raw
# estimator, not a Pipeline) — the only model types with a real
# TreeExplainer-compatible object AND a genuine split-based importance
# concept (weight/gain/coverage) at all.
TREE_MODELS = {"decision_tree", "random_forest", "random_forest_regressor", "xgboost"}


def is_tree_model(model_name: str) -> bool:
    return model_name in TREE_MODELS


def unwrap_model(model):
    """Pull the real estimator out of a Pipeline("scaler" -> "model") — a
    Pipeline does NOT forward attributes like .coef_/.feature_importances_
    from its final step, so any code that needs those must unwrap first."""
    if hasattr(model, "named_steps"):
        return model.named_steps.get("model", model)
    return model


def make_kernel_predict_fn(model, use_proba: bool):
    """A plain wrapping function, NOT the model's bound method directly —
    see the module docstring for why. Calling predict/predict_proba on the
    (possibly Pipeline-wrapped) model directly is correct regardless of
    wrapping — it applies its own internal scaling to the raw input."""
    def _fn(arr):
        return model.predict_proba(arr) if use_proba else model.predict(arr)
    return _fn


def select_class_shap(shap_values):
    """Normalize whatever shape shap's shap_values() handed back into one
    consistent array. Older shap versions return a LIST of per-class
    arrays for classifiers; newer versions can instead return one 3D
    ndarray (n_samples, n_features, n_classes) — this isn't guaranteed
    across versions. Either way, for multiclass this deliberately picks
    class index 1 (the positive class for binary) as the one shown."""
    if isinstance(shap_values, list):
        return np.asarray(shap_values[1] if len(shap_values) > 1 else shap_values[0])
    arr = np.asarray(shap_values)
    if arr.ndim == 3:
        idx = 1 if arr.shape[-1] > 1 else 0
        return arr[:, :, idx]
    return arr


def select_expected_value(expected_value):
    """Same version-safety normalization for explainer.expected_value —
    can come back as a bare scalar or a list/array (one entry per class)
    depending on the explainer type and shap version."""
    if isinstance(expected_value, (list, tuple, np.ndarray)):
        arr = np.asarray(expected_value)
        idx = 1 if arr.shape[0] > 1 else 0
        return float(arr[idx])
    return float(expected_value)
