"""
In-process wrappers around the SAME router functions Manual Mode's frontend
calls over HTTP. Every function below imports the real router module and
calls its route-handler function directly — these are plain Python
functions under the @router.post(...) decorators, with zero Depends()
injection anywhere in this codebase's FastAPI routers, so calling them
in-process is exactly equivalent to a real HTTP round trip minus the
network hop. This deliberately avoids two of this project's most-documented
recurring bugs (the dual-stack 127.0.0.1/localhost landmine, and orphaned-
uvicorn-worker confusion) for calls that would otherwise just be this same
process calling itself over HTTP.

Every wrapper converts a raised HTTPException into a plain RuntimeError
with the original detail message, so nodes.py never needs to import
fastapi.HTTPException just to catch it.

IMPORTANT — numpy scalar sanitization: over a real HTTP call, FastAPI's own
response serialization (jsonable_encoder) silently coerces numpy.float64/
int64/bool_ to native Python types before the frontend ever sees them —
this codebase's routers rely on that (their own "recurring bug class"
notes document the NaN/numpy-type problem for the JSON-serialization step
specifically, e.g. cleaning_router_v2.py's profile_duplicates round-
tripping through json.loads(df.to_json(...))). Calling these functions
in-process, as every wrapper below does, skips that HTTP layer entirely —
a raw numpy.float64 buried in an otherwise-fine response dict (confirmed:
visualization_router.analyze()'s response has these) then flows straight
into LangGraph's state and breaks msgpack serialization the moment the
SQLite checkpointer tries to persist it ("Type is not msgpack
serializable: numpy.float64"). _sanitize() below reproduces the same
coercion FastAPI's encoder would have done, applied uniformly to every
tool's return value.
"""
from typing import Optional, List, Dict, Any

import numpy as np
from fastapi import HTTPException

import cleaning_router_v2 as _clean
import encoding_router as _enc
import feature_engineering_router as _feat
import sampling_router as _samp
import feature_selection_router as _fsel
import training_router as _train
import feature_impact_router as _fi
import learning_curve_router as _lc
import report_router as _report
import visualization_router as _viz


def _sanitize(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return _sanitize(obj.tolist())
    return obj


def _call(fn, req):
    try:
        return _sanitize(fn(req))
    except HTTPException as e:
        raise RuntimeError(f"{fn.__module__}.{fn.__name__}: {e.detail}") from e


# ─────────────────────────────────────────────────────────────────────────
# DIAGNOSE — visualization_router.analyze() is the richest single-call
# health/signal/balance profile in the backend; there is no dedicated
# "/diagnose" endpoint (Diagnose.jsx computes its own health score
# client-side in the browser — not usable server-side by an agent).
# ─────────────────────────────────────────────────────────────────────────

def diagnose_analyze(file_path: str, original_file_path: Optional[str],
                      target_column: Optional[str], task_type: Optional[str]) -> dict:
    return _call(_viz.analyze, _viz.AnalyzeReq(
        file_path=file_path, original_file_path=original_file_path,
        target_column=target_column, task_type=task_type))


# ─────────────────────────────────────────────────────────────────────────
# CLEANING
# ─────────────────────────────────────────────────────────────────────────

def profile_duplicates(file_path: str) -> dict:
    return _call(_clean.profile_duplicates, _clean.FileReq(file_path=file_path))


def remove_duplicates(file_path: str) -> dict:
    return _call(_clean.remove_duplicates, _clean.FileReq(file_path=file_path))


def profile_outliers_global(file_path: str) -> dict:
    return _call(_clean.profile_outliers_global, _clean.FileReq(file_path=file_path))


def get_all_outlier_indices(file_path: str) -> dict:
    return _call(_clean.get_all_outlier_indices, _clean.FileReq(file_path=file_path))


def remove_outliers(file_path: str, column: str, rows_to_remove: List[int]) -> dict:
    return _call(_clean.remove_outliers_endpoint,
                 _clean.RemoveOutliersReq(file_path=file_path, column=column, rows_to_remove=rows_to_remove))


def profile_missing_global(file_path: str) -> dict:
    return _call(_clean.profile_missing_global, _clean.FileReq(file_path=file_path))


def apply_row_threshold(file_path: str, min_present: int) -> dict:
    return _call(_clean.apply_row_threshold, _clean.RowThresholdReq(file_path=file_path, min_present=min_present))


def apply_missing_column(file_path: str, column: str, method: str, n_neighbors: int = 5) -> dict:
    return _call(_clean.apply_missing_column,
                 _clean.ApplyMissingReq(file_path=file_path, column=column, method=method, n_neighbors=n_neighbors))


# ─────────────────────────────────────────────────────────────────────────
# ENCODING / SCALING
# ─────────────────────────────────────────────────────────────────────────

def encoding_profile(file_path: str) -> dict:
    return _call(_enc.profile_dataset, _enc.FileReq(file_path=file_path))


def encoding_apply(file_path: str, encoding_decisions: Dict[str, str], scaling_decisions: Dict[str, str]) -> dict:
    return _call(_enc.apply_all, _enc.ApplyReq(
        file_path=file_path,
        encoding_decisions=[_enc.EncodingDecision(column=c, method=m) for c, m in encoding_decisions.items()],
        scaling_decisions=[_enc.ScalingDecision(column=c, method=m) for c, m in scaling_decisions.items()],
    ))


# ─────────────────────────────────────────────────────────────────────────
# FEATURE ENGINEERING
# ─────────────────────────────────────────────────────────────────────────

def feature_profile(file_path: str) -> dict:
    return _call(_feat.profile_dataset, _feat.FileReq(file_path=file_path))


def bucketize_apply(file_path: str, column: str, strategy: str, n_bins: int = 5,
                     custom_edges: Optional[str] = None) -> dict:
    return _call(_feat.bucketize_apply, _feat.BucketizeReq(
        file_path=file_path, column=column, strategy=strategy, n_bins=n_bins, custom_edges=custom_edges))


def create_feature_apply(file_path: str, col_a: str, col_b: str, operation: str,
                          custom_expr: Optional[str] = None, new_col_name: Optional[str] = None,
                          keep_originals: bool = True) -> dict:
    return _call(_feat.create_feature_apply, _feat.CreateFeatureApplyReq(
        file_path=file_path, col_a=col_a, col_b=col_b, operation=operation,
        custom_expr=custom_expr, new_col_name=new_col_name, keep_originals=keep_originals))


# ─────────────────────────────────────────────────────────────────────────
# SAMPLING
# ─────────────────────────────────────────────────────────────────────────

def sampling_profile(file_path: str, target_column: Optional[str], task_type: Optional[str] = None) -> dict:
    return _call(_samp.profile_dataset, _samp.ProfileReq(
        file_path=file_path, target_column=target_column, task_type=task_type))


def sampling_apply(file_path: str, method: str, sample_pct: float = 20.0,
                    stratify_col: Optional[str] = None, target_col: Optional[str] = None,
                    task_type: Optional[str] = None, shuffle: bool = True,
                    n_clusters: Optional[int] = None) -> dict:
    return _call(_samp.apply_sampling, _samp.ApplyReq(
        file_path=file_path, method=method, sample_pct=sample_pct, stratify_col=stratify_col,
        target_col=target_col, task_type=task_type, shuffle=shuffle, n_clusters=n_clusters))


# ─────────────────────────────────────────────────────────────────────────
# FEATURE SELECTION
# ─────────────────────────────────────────────────────────────────────────

def feature_selection_analyze(file_path: str, target_column: Optional[str],
                               task_type: Optional[str] = None) -> dict:
    return _call(_fsel.analyze, _fsel.AnalyzeReq(
        file_path=file_path, target_column=target_column, task_type=task_type))


def feature_selection_apply(file_path: str, target_column: Optional[str], features_to_keep: List[str]) -> dict:
    return _call(_fsel.apply_selection, _fsel.ApplyReq(
        file_path=file_path, target_column=target_column, features_to_keep=features_to_keep))


# ─────────────────────────────────────────────────────────────────────────
# TRAINING
# ─────────────────────────────────────────────────────────────────────────

def training_defaults(file_path: str, target_column: Optional[str] = None) -> dict:
    return _call(_train.get_defaults, _train.DefaultsReq(file_path=file_path, target_column=target_column))


def elbow_knn(file_path: str, target_column: str, metric: str = "accuracy", max_k: int = 39) -> dict:
    return _call(_train.elbow_knn, _train.ElbowKNNReq(
        file_path=file_path, target_column=target_column, metric=metric, max_k=max_k))


def elbow_kmeans(file_path: str, max_k: int = 15) -> dict:
    return _call(_train.elbow_kmeans, _train.ElbowKMeansReq(file_path=file_path, max_k=max_k))


def grid_search(file_path: str, target_column: Optional[str], task_type: str, model_name: str,
                 param_grid: Dict[str, list], metric: str = "accuracy", cv_folds: int = 5,
                 stratified: bool = True) -> dict:
    return _call(_train.grid_search, _train.GridSearchReq(
        file_path=file_path, target_column=target_column, task_type=task_type, model_name=model_name,
        param_grid=param_grid, metric=metric, cv_folds=cv_folds, stratified=stratified))


def train_model(file_path: str, target_column: Optional[str], task_type: str, model_name: str,
                 model_params: dict, split_method: str = "train_test", split_ratio: float = 0.80,
                 cv_folds: int = 5, stratified: bool = True, metric: str = "accuracy",
                 threshold: float = 0.5) -> dict:
    return _call(_train.train_model, _train.TrainReq(
        file_path=file_path, target_column=target_column, task_type=task_type, model_name=model_name,
        model_params=model_params, split_method=split_method, split_ratio=split_ratio,
        cv_folds=cv_folds, stratified=stratified, metric=metric, threshold=threshold))


# ─────────────────────────────────────────────────────────────────────────
# EXPLAIN — feature impact / learning curve
# ─────────────────────────────────────────────────────────────────────────

def feature_impact_compute(file_path: str, target_column: str, model_pkl_path: str, task_type: str) -> dict:
    return _call(_fi.compute_feature_impact, _fi.ComputeReq(
        file_path=file_path, target_column=target_column, model_pkl_path=model_pkl_path, task_type=task_type))


def learning_curve_compute(file_path: str, target_column: str, model_pkl_path: str, task_type: str,
                            train_ratio: float = 0.80, cv_folds: int = 3, n_sizes: int = 8) -> dict:
    return _call(_lc.compute_learning_curve, _lc.ComputeReq(
        file_path=file_path, target_column=target_column, model_pkl_path=model_pkl_path, task_type=task_type,
        train_ratio=train_ratio, cv_folds=cv_folds, n_sizes=n_sizes))


# ─────────────────────────────────────────────────────────────────────────
# REPORT
# ─────────────────────────────────────────────────────────────────────────

def generate_report(**kwargs) -> dict:
    return _call(_report.generate_report, _report.GenerateReq(**kwargs))
