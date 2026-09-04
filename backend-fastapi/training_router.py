"""
PRISM - Train and Test Router (FastAPI)
Handles model training, evaluation, grid search, and model persistence.

Add to main.py:
    from training_router import router as training_router
    app.include_router(training_router)
"""
import os, time, uuid, pickle, warnings
from datetime import datetime
from typing import Any, Dict, List, Optional
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
warnings.filterwarnings("ignore")

router = APIRouter(prefix="/training", tags=["Training"])

MODELS_DIR = os.path.join(os.path.dirname(__file__), "saved_models")
os.makedirs(MODELS_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def read_df(path: str) -> pd.DataFrame:
    if not os.path.exists(path):
        raise HTTPException(404, f"File not found: {path}")
    return pd.read_csv(path)

def safe_round(x, nd=4):
    """None/NaN/inf-safe rounding - a bare NaN in a JSON body is valid to
    Python's json module but not valid JSON; JS's JSON.parse throws on it.
    Same helper as every other router in this project (sampling_router.py,
    visualization_router.py) - metrics here (R2 on a degenerate split,
    std of a single-fold CV, etc.) can legitimately produce NaN/inf."""
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return None
    if xf != xf or xf in (float("inf"), float("-inf")):
        return None
    return round(xf, nd)

def suggest_split_ratio(n: int) -> dict:
    """Split ratio scales with dataset size regardless of which evaluation
    method ends up recommended below - a user who overrides the K-Fold
    recommendation and picks Train/Test Split manually on a small dataset
    should still see a sensible suggested ratio, not a blank one."""
    if n >= 100000: r = (0.90, 0.10)
    elif n >= 50000: r = (0.80, 0.20)
    elif n >= 10000: r = (0.70, 0.30)
    elif n >= 5000:  r = (0.75, 0.25)
    elif n >= 1000:  r = (0.80, 0.20)
    elif n >= 500:   r = (0.85, 0.15)
    else:            r = (0.90, 0.10)
    # A single train/test split on a small dataset gives a noisy, unstable
    # performance estimate (the test set itself is too small to trust) -
    # K-Fold CV re-uses every row as both train and test data across folds
    # and averages the result, which is materially more reliable below
    # roughly a thousand rows. Reuses the same 1000-row boundary
    # suggest_k_folds() already draws on (more folds below it too), rather
    # than a second, unrelated threshold.
    recommend_cv = n < 1000
    result = {"train": r[0], "test": r[1], "recommend_cv": recommend_cv}
    if recommend_cv:
        result["note"] = "Dataset is small enough that cross-validation gives a more reliable estimate than a single split."
    return result

def suggest_k_folds(n: int) -> int:
    return 5 if n >= 1000 else 10

def metric_to_sklearn(metric: str, task_type: str = "classification") -> str:
    """Grid-search scoring string. The 4 user-facing metrics (accuracy/f1/
    precision/recall) are classification-only concepts - for a regression
    model there is no equivalent "which one matters more" choice the way
    there is for classification (recall vs precision trade-off), so
    regression grid search always optimizes R2 regardless of what the
    request carries in `metric` (the frontend doesn't show a metric
    selector for regression tasks at all - see TrainTest.jsx)."""
    if task_type == "regression":
        return "r2"
    return {"accuracy": "accuracy", "f1": "f1_weighted",
            "precision": "precision_weighted", "recall": "recall_weighted"}.get(metric, "accuracy")

def build_model(model_name: str, params: dict):
    from sklearn.tree import DecisionTreeClassifier
    from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
    from sklearn.neighbors import KNeighborsClassifier
    from sklearn.linear_model import LogisticRegression, LinearRegression, Ridge
    from sklearn.svm import SVC
    from sklearn.naive_bayes import GaussianNB
    from sklearn.cluster import KMeans
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import Pipeline

    builders = {
        "knn":                     lambda: KNeighborsClassifier(**params),
        "decision_tree":           lambda: DecisionTreeClassifier(**{**{"random_state": 42}, **params}),
        "random_forest":           lambda: RandomForestClassifier(**{**{"random_state": 42}, **params}),
        "logistic_regression":     lambda: LogisticRegression(**{**{"max_iter": 1000, "random_state": 42}, **params}),
        "svm":                     lambda: SVC(**{**{"probability": True, "random_state": 42}, **params}),
        "xgboost":                 lambda: _build_xgb(params),
        "naive_bayes":             lambda: GaussianNB(),
        "linear_regression":       lambda: LinearRegression(),
        "ridge_regression":        lambda: Ridge(**{**{"random_state": 42}, **params}),
        "random_forest_regressor": lambda: RandomForestRegressor(**{**{"random_state": 42}, **params}),
        "kmeans":                  lambda: KMeans(**{**{"random_state": 42, "n_init": 10}, **params}),
    }
    fn = builders.get(model_name)
    if fn is None:
        raise HTTPException(400, f"Unknown model: {model_name}")
    estimator = fn()

    # Distance-/margin-based models are scale-sensitive enough that raw,
    # unscaled features (e.g. income in the hundreds of thousands next to
    # age in the tens) don't just hurt accuracy - an unscaled linear-kernel
    # SVM was measured to hang indefinitely on this exact shape of data
    # (confirmed directly against raw sklearn, independent of this router).
    # The dataset SHOULD already be scaled by the time it reaches Training
    # (that's what the Encoding & Scaling page is for), but this pipeline
    # wrap makes the model itself correct regardless - never silently rely
    # on an earlier pipeline stage having been done correctly. Wrapping in
    # a Pipeline (not a manual fit-transform) also means GridSearchCV and
    # cross_val_predict each refit the scaler PER FOLD automatically, so
    # there's no test-fold leakage into the scaler's mean/variance.
    if model_name in ("knn", "svm", "logistic_regression", "linear_regression", "ridge_regression"):
        return Pipeline([("scaler", StandardScaler()), ("model", estimator)])
    return estimator

def unwrap_model(model):
    """The final estimator inside a Pipeline (see build_model), or the
    model itself if it isn't wrapped - viz code needs .coef_/.theta_/etc
    off the real estimator, not the Pipeline wrapper."""
    if hasattr(model, "named_steps"):
        return model.named_steps["model"]
    return model

def _build_xgb(params):
    from xgboost import XGBClassifier
    return XGBClassifier(**{**{"random_state": 42, "eval_metric": "logloss"}, **params})

def prepare_features(df: pd.DataFrame, target_col: Optional[str]):
    """target_col is None for clustering - every numeric column is a feature,
    there is no separate label to drop."""
    if target_col and target_col in df.columns:
        X = df.drop(columns=[target_col]).select_dtypes(include=[np.number]).fillna(0)
        y = df[target_col]
    else:
        X = df.select_dtypes(include=[np.number]).fillna(0)
        y = None
    if X.shape[1] == 0:
        raise HTTPException(400, "No numeric feature columns available for training.")
    return X, y

def encode_classification_target(y: pd.Series, task_type: str):
    """Single source of truth for turning a raw target column into the
    integer class labels sklearn expects - used by BOTH /train and
    /grid-search so the two endpoints can never disagree about how a
    dataset's target should be read. Previously each endpoint carried its
    own near-identical copy of this logic; a genuine divergence there is
    exactly the kind of bug that lets grid search silently see a different
    (and possibly ill-typed) target than the training run that ran
    moments earlier against the very same file. Also runs an explicit
    sklearn type_of_target check up front - if the target still doesn't
    look like discrete classes after encoding (e.g. a continuous numeric
    column that was mistakenly treated as a classification target), this
    raises ONE clear, readable error here instead of letting a raw
    "Unknown label type: continuous" exception surface later from deep
    inside GridSearchCV's internal refit step, which is unprotected by
    error_score and produces a multi-paragraph raw traceback the user has
    no way to act on."""
    from sklearn.preprocessing import LabelEncoder
    le = None
    class_names: List[str] = []
    if task_type == "classification" and y is not None:
        if not pd.api.types.is_numeric_dtype(y):
            le = LabelEncoder()
            y = pd.Series(le.fit_transform(y.astype(str)), index=y.index)
            class_names = [str(c) for c in le.classes_]
        else:
            class_names = [str(c) for c in sorted(y.unique())]
        from sklearn.utils.multiclass import type_of_target
        if type_of_target(y) not in ("binary", "multiclass"):
            raise HTTPException(
                400,
                f"The target column doesn't look like discrete classes for classification "
                f"({len(class_names)} distinct value(s) found, and they don't form clean "
                f"categories). If this is meant to be a continuous value, switch the task "
                f"type to regression instead."
            )
    return y, le, class_names

def find_elbow(values: List[float]) -> int:
    """Elbow via maximum curvature (2nd derivative) of a monotonically
    decreasing curve (K-Means inertia)."""
    if len(values) < 3:
        return 0
    diffs = np.diff(values)
    diffs2 = np.diff(diffs)
    return int(np.argmin(diffs2)) + 1  # +1 for the double differencing offset

def normalize_to_100(values: List[float]) -> List[float]:
    """Scale to a 0-100 relative range so two differently-scaled curves
    (inertia's raw sum-of-squares vs entropy's bits) can share one Y axis."""
    arr = np.array(values, dtype=float)
    mn, mx = float(arr.min()), float(arr.max())
    if mx == mn:
        return [50.0] * len(values)
    return ((arr - mn) / (mx - mn) * 100).round(2).tolist()

def tree_to_dict(clf, feature_names: List[str], class_names: List[str], max_depth=5, node=0, depth=0):
    """Recursively convert an sklearn Decision Tree into a JSON-serializable
    dict for the frontend's custom SVG tree renderer. Capped at max_depth for
    display only - the trained model itself is unaffected."""
    from sklearn.tree import _tree
    tree_ = clf.tree_
    # tree_.value[node][0] holds normalized per-class PROPORTIONS in this
    # sklearn version (they sum to 1.0), not raw counts - confirmed live
    # (a 400-row root node's value array summed to exactly 1.0, not 400).
    # The actual per-node sample count lives in tree_.n_node_samples, which
    # is what "samples" below must read from. values[dominant]/values.sum()
    # for "confidence" still works out correctly either way since it's a
    # ratio, not an absolute count.
    n_samples = int(tree_.n_node_samples[node])
    if depth >= max_depth or tree_.children_left[node] == _tree.TREE_LEAF:
        values = tree_.value[node][0]
        vtotal = float(values.sum())
        dominant = int(np.argmax(values))
        return {
            "type": "leaf",
            "class": class_names[dominant] if dominant < len(class_names) else str(dominant),
            "samples": n_samples,
            "confidence": round(float(values[dominant] / vtotal), 3) if vtotal > 0 else 0,
            "truncated": bool(tree_.children_left[node] != _tree.TREE_LEAF),
        }
    feature_idx = int(tree_.feature[node])
    return {
        "type": "split",
        "feature": feature_names[feature_idx] if feature_idx < len(feature_names) else f"f{feature_idx}",
        "threshold": round(float(tree_.threshold[node]), 4),
        "samples": n_samples,
        "left":  tree_to_dict(clf, feature_names, class_names, max_depth, tree_.children_left[node],  depth + 1),
        "right": tree_to_dict(clf, feature_names, class_names, max_depth, tree_.children_right[node], depth + 1),
    }

def compute_cluster_scatter(X: pd.DataFrame, X_scaled: pd.DataFrame, labels,
                            centroids_scaled, centroids_raw, feature_names: List[str]):
    """Three ways to look at a K-Means clustering that lives in more than 2
    dimensions at once, all computed here so the frontend needs one request:

    1. "Best features" (the default) — of every feature, the 2 whose cluster
       centers are most spread apart. Centroid separation is measured on
       centroids_scaled (the standardized space K-Means actually clustered
       in), NOT centroids_raw — comparing raw-unit variance would just pick
       whichever feature happens to have the largest natural numbers (e.g.
       income in the tens of thousands vs. age in the tens), regardless of
       which one the clustering actually separated on. Points/centroids
       plotted are still raw values, for a readable axis.
    2. "PCA" — project everything onto the top 2 principal components at
       once (uses every feature simultaneously, not just 2) — a different,
       complementary answer to "which 2D view shows the clusters best."
    3. "All pairs" — the full raw feature matrix for the sampled points, so
       the frontend can build a scatter for ANY pair on demand without a
       second round trip. A single shared {feature_names, rows} table
       instead of a per-point named dict — avoids repeating every feature
       name as a JSON key for all 800 points.

    Row sampling (cap 800, same convention as visualization_router.py's PCA
    scatter) is shared across all three so the same points appear in each.
    """
    n = len(X)
    if n > 800:
        idx = np.random.default_rng(42).choice(n, 800, replace=False)
    else:
        idx = np.arange(n)
    Xr        = X.iloc[idx].reset_index(drop=True)
    Xr_scaled = X_scaled.iloc[idx].reset_index(drop=True)
    labels_r  = np.asarray(labels)[idx]
    n_feat    = len(feature_names)

    # ── 1. Best features (top-2 by standardized centroid separation) ──────
    if n_feat >= 2:
        spread = {feat: float(np.var(centroids_scaled[:, fi])) for fi, feat in enumerate(feature_names)}
        ranked = sorted(spread, key=lambda f: spread[f], reverse=True)
        feat_x, feat_y = ranked[0], ranked[1]
        weakest = ranked[-1]
        selection_reason = (
            f"'{feat_x}' and '{feat_y}' were picked automatically out of {n_feat} features — their "
            f"cluster centers are the most spread apart on the standardized scale K-Means itself "
            f"clusters on (spread {spread[feat_x]:.3f} and {spread[feat_y]:.3f}, vs {spread[weakest]:.3f} "
            f"for the least-separating feature '{weakest}'). These give the clearest 2D picture of how "
            f"the clustering actually split the data."
        )
    else:
        feat_x = feat_y = feature_names[0]
        selection_reason = "Only one feature available — plotted against itself."
    xi, yi = feature_names.index(feat_x), feature_names.index(feat_y)

    scatter = [
        {"x": safe_round(row[feat_x]), "y": safe_round(row[feat_y]), "cluster": int(labels_r[i])}
        for i, row in Xr.iterrows()
    ]
    center_list = [
        {"x": safe_round(c[xi]), "y": safe_round(c[yi]), "cluster": ci}
        for ci, c in enumerate(centroids_raw)
    ]

    # ── 2. PCA projection (needs >=2 features; degrades to None otherwise
    #      or if PCA fails, e.g. a zero-variance feature set) ─────────────
    pca_block = None
    if n_feat >= 2:
        try:
            from sklearn.decomposition import PCA
            pca = PCA(n_components=2, random_state=42)
            coords          = pca.fit_transform(Xr_scaled)
            centroid_coords = pca.transform(centroids_scaled)
            var_ratio = pca.explained_variance_ratio_
            pca_block = {
                "scatter": [
                    {"x": safe_round(coords[i, 0]), "y": safe_round(coords[i, 1]), "cluster": int(labels_r[i])}
                    for i in range(len(coords))
                ],
                "centroids": [
                    {"x": safe_round(centroid_coords[ci, 0]), "y": safe_round(centroid_coords[ci, 1]), "cluster": ci}
                    for ci in range(len(centroid_coords))
                ],
                "x_label": f"PC1 ({var_ratio[0] * 100:.1f}% variance)",
                "y_label": f"PC2 ({var_ratio[1] * 100:.1f}% variance)",
            }
        except Exception:
            pca_block = None

    # ── 3. All-pairs raw data, for the frontend's "explore every pair"
    #      toggle. Rendering is the frontend's call (it caps how many of
    #      the n_pairs combinations it actually draws) - this always
    #      includes the data since it's cheap either way (a few hundred KB
    #      at most: <=800 rows x feature count).
    all_pairs = {
        "feature_names": feature_names,
        "rows": [[safe_round(v) for v in row] for row in Xr[feature_names].values.tolist()],
        "cluster": [int(c) for c in labels_r],
    }
    n_pairs = n_feat * (n_feat - 1) // 2

    return {
        "scatter": scatter, "centroids": center_list, "x_label": feat_x, "y_label": feat_y,
        "selection_reason": selection_reason,
        "pca": pca_block,
        "all_pairs": all_pairs, "n_pairs": n_pairs,
    }

# ─────────────────────────────────────────────────────────────────────────────
# REQUEST MODELS
# ─────────────────────────────────────────────────────────────────────────────

class DefaultsReq(BaseModel):
    file_path:     str
    target_column: Optional[str] = None

class ElbowKNNReq(BaseModel):
    file_path:     str
    target_column: str
    metric:        str = "accuracy"  # accuracy | f1 | precision | recall
    max_k:         int = 39

class ElbowKMeansReq(BaseModel):
    file_path: str
    max_k:     int = 15

class GridSearchReq(BaseModel):
    file_path:     str
    target_column: Optional[str] = None
    task_type:     str
    model_name:    str
    param_grid:    Dict[str, List[Any]]
    metric:        str = "accuracy"
    cv_folds:      int = 5
    stratified:    bool = True

class TrainReq(BaseModel):
    file_path:     str
    target_column: Optional[str] = None
    task_type:     str   # classification | regression | clustering
    model_name:    str
    model_params:  Dict[str, Any] = {}
    split_method:  str = "train_test"    # train_test | cross_validation
    split_ratio:   float = 0.80          # train ratio (for train_test)
    cv_folds:      int = 5
    stratified:    bool = True
    metric:        str = "accuracy"
    threshold:     float = 0.5           # binary classification decision threshold
    output_options: Dict[str, bool] = {
        "confusion_matrix": True,
        "per_class_stats": True,
        "model_summary": True,
        "learning_curve": False,
    }

# ─────────────────────────────────────────────────────────────────────────────
# 1. DEFAULTS - suggested split ratio / k-folds from dataset size
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/defaults")
def get_defaults(req: DefaultsReq):
    try:
        df = read_df(req.file_path)
        n  = len(df)
        split_info = suggest_split_ratio(n)
        k_folds    = suggest_k_folds(n)
        task_type = None
        num_cols = df.select_dtypes(include=[np.number]).columns
        if req.target_column and req.target_column in df.columns:
            s = df[req.target_column]
            task_type = "regression" if (pd.api.types.is_numeric_dtype(s) and s.nunique() > 15) else "classification"
        # Only subtract the target from the numeric-column count when it's
        # actually numeric (regression) - a categorical target (typical
        # classification case) is already excluded from num_cols, so
        # subtracting again would undercount the real feature count by one.
        target_is_numeric_col = bool(req.target_column) and req.target_column in num_cols
        return {
            "row_count":     n,
            "task_type":     task_type,
            "split_ratio":   split_info,
            "k_folds":       k_folds,
            "recommend_cv":  split_info.get("recommend_cv", False),
            "feature_count": len(num_cols) - (1 if target_is_numeric_col else 0),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Could not compute defaults: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# 2. ELBOW CURVE - KNN (metric vs k)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/elbow-knn")
def elbow_knn(req: ElbowKNNReq):
    try:
        from sklearn.neighbors import KNeighborsClassifier
        from sklearn.model_selection import cross_val_score
        from sklearn.preprocessing import LabelEncoder, StandardScaler

        df = read_df(req.file_path)
        if not (req.target_column and req.target_column in df.columns):
            raise HTTPException(400, f"Target column '{req.target_column}' was not found in this dataset "
                                      f"(available columns: {', '.join(df.columns)}).")
        X, y = prepare_features(df, req.target_column)
        if not pd.api.types.is_numeric_dtype(y):
            y = LabelEncoder().fit_transform(y.astype(str))

        # KNN is distance-based - without scaling, a feature like income
        # (spanning hundreds of thousands) silently dominates the distance
        # calculation over one like age (spanning tens), so every k would
        # effectively just be "nearest neighbor by income". Same
        # StandardScaler treatment build_model() gives KNN for real
        # training, applied here too so the elbow curve reflects the same
        # scaled distance metric the actual trained model will use.
        X_sc = StandardScaler().fit_transform(X)

        k_vals  = list(range(1, req.max_k + 1, 2))  # odd: 1,3,5,...,39
        scores  = []
        scoring = metric_to_sklearn(req.metric, "classification")
        cv = max(2, min(5, len(X) // 2))

        for k in k_vals:
            if k >= len(X):
                scores.append(scores[-1] if scores else 0.0)
                continue
            try:
                sc = cross_val_score(KNeighborsClassifier(n_neighbors=k), X_sc, y, cv=cv, scoring=scoring, n_jobs=-1)
                scores.append(safe_round(sc.mean()) or 0.0)
            except Exception:
                scores.append(0.0)

        best_idx = int(np.argmax(scores))
        return {
            "k_values": k_vals, "scores": scores,
            "best_k": k_vals[best_idx], "best_score": scores[best_idx], "metric": req.metric,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Elbow (KNN) computation failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# 3. ELBOW CURVE - K-Means (inertia vs k)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/elbow-kmeans")
def elbow_kmeans(req: ElbowKMeansReq):
    try:
        from sklearn.cluster import KMeans
        from sklearn.preprocessing import StandardScaler

        df    = read_df(req.file_path)
        X_num = df.select_dtypes(include=[np.number]).fillna(0)
        if X_num.shape[1] == 0:
            raise HTTPException(400, "No numeric columns available for clustering.")

        X_sc      = StandardScaler().fit_transform(X_num)
        max_k     = min(req.max_k, len(X_num) - 1)
        k_vals    = list(range(2, max(3, max_k + 1)))
        inertias  = []
        entropies = []
        for k in k_vals:
            km = KMeans(n_clusters=k, random_state=42, n_init=10, max_iter=100)
            km.fit(X_sc)
            inertias.append(safe_round(km.inertia_) or 0.0)
            # Shannon entropy (bits) of the cluster-size distribution - how
            # evenly this k spreads points across its clusters. Distinct
            # from /train's per-run entropy (natural log, one k only): this
            # is a full k-by-k curve for the elbow chart, log2 so the
            # frontend can label it in bits.
            _, counts = np.unique(km.labels_, return_counts=True)
            probs = counts / counts.sum()
            entropy = float(-np.sum(probs * np.log2(probs + 1e-10)))
            entropies.append(safe_round(entropy, 4) or 0.0)

        elbow_idx = find_elbow(inertias)
        return {
            "k_values": k_vals, "inertias": inertias, "entropies": entropies,
            "best_k": k_vals[elbow_idx],
            "inertia_normalized": normalize_to_100(inertias),
            "entropy_normalized": normalize_to_100(entropies),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Elbow (K-Means) computation failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# 4. GRID SEARCH CV
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/grid-search")
def grid_search(req: GridSearchReq):
    try:
        from sklearn.model_selection import GridSearchCV, StratifiedKFold, KFold

        df = read_df(req.file_path)
        if req.task_type == "clustering":
            raise HTTPException(400, "Grid search is not available for clustering (no target column to score against).")
        if not (req.target_column and req.target_column in df.columns):
            raise HTTPException(400, f"Target column '{req.target_column}' was not found in this dataset "
                                      f"(available columns: {', '.join(df.columns)}).")
        X, y = prepare_features(df, req.target_column)
        y, _, _ = encode_classification_target(y, req.task_type)

        model = build_model(req.model_name, {})
        # Cap grid size - each parameter is limited to 2-3 values by the
        # frontend, but guard here too since this endpoint could in theory
        # be called with a larger grid; an unbounded grid on a slow model
        # (SVM, XGBoost) could hang the request for minutes.
        total_combos = 1
        for vals in req.param_grid.values():
            total_combos *= max(1, len(vals))
        if total_combos > 60:
            raise HTTPException(400, f"Grid too large ({total_combos} combinations) - reduce the number of values per parameter.")

        # Scale-sensitive models (see build_model) come back wrapped in a
        # Pipeline("scaler" -> "model") - GridSearchCV needs each param key
        # prefixed "model__x" to route it to the actual estimator step
        # rather than erroring "invalid parameter x for Pipeline". Stripped
        # back off below so the response's param names match exactly what
        # the frontend sent, with no internal pipeline detail leaking out.
        is_pipeline = hasattr(model, "named_steps")
        param_grid = ({f"model__{k}": v for k, v in req.param_grid.items()}
                      if is_pipeline else req.param_grid)

        cv_folds = max(2, min(req.cv_folds, len(X)))
        cv = (StratifiedKFold(n_splits=cv_folds, shuffle=True, random_state=42)
              if (req.task_type == "classification" and req.stratified)
              else KFold(n_splits=cv_folds, shuffle=True, random_state=42))

        # n_jobs=1 (not -1): joblib's process-based parallelism on Windows
        # re-imports this module in each worker process rather than
        # inheriting the parent's state, which has produced flaky/opaque
        # failures here before. The grid is already capped at 60
        # combinations above, so sequential fits stay fast enough without
        # that extra layer of platform-specific instability.
        gs = GridSearchCV(model, param_grid, cv=cv,
                          scoring=metric_to_sklearn(req.metric, req.task_type), n_jobs=1, error_score=0)
        t0 = time.time()
        gs.fit(X, y)
        elapsed = round(time.time() - t0, 2)

        def unprefix(params: dict) -> dict:
            return {k.replace("model__", "", 1): v for k, v in params.items()} if is_pipeline else dict(params)

        n_results = len(gs.cv_results_["params"])
        top_results = []
        for i in range(min(10, n_results)):
            top_results.append({
                "params":     unprefix(gs.cv_results_["params"][i]),
                "mean_score": safe_round(gs.cv_results_["mean_test_score"][i]),
                "std_score":  safe_round(gs.cv_results_["std_test_score"][i]),
            })
        top_results.sort(key=lambda r: (r["mean_score"] is None, -(r["mean_score"] or 0)))

        return {
            "best_params": unprefix(gs.best_params_),
            "best_score":  safe_round(gs.best_score_),
            "elapsed_sec": elapsed,
            "metric":      req.metric,
            "all_results": top_results,
        }
    except HTTPException:
        raise
    except Exception as e:
        # Some sklearn failures (a bad fit deep inside cross-validation)
        # come with a multi-paragraph message that includes a full raw
        # traceback per failed fold - genuinely useful in a Python
        # console, not useful (or readable) as a web error. Cropped to one
        # line so the user gets a short, actionable message instead of a
        # wall of text; the full detail still reaches the server log.
        msg = str(e).strip().splitlines()[0][:300]
        raise HTTPException(500, f"Grid search failed: {msg}")

# ─────────────────────────────────────────────────────────────────────────────
# 5. TRAIN - main training endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/train")
def train_model(req: TrainReq):
    try:
        from sklearn.model_selection import (train_test_split, StratifiedKFold, KFold, cross_val_predict)
        from sklearn.preprocessing import StandardScaler

        df = read_df(req.file_path)
        if req.task_type != "clustering" and not (req.target_column and req.target_column in df.columns):
            raise HTTPException(400, f"Target column '{req.target_column}' was not found in this dataset "
                                      f"(available columns: {', '.join(df.columns)}). Re-check the Upload step's target selection.")
        X, y = prepare_features(df, req.target_column)
        feature_names = list(X.columns)
        t_start = time.time()

        y, le, class_names = encode_classification_target(y, req.task_type)

        model = build_model(req.model_name, req.model_params)

        result: Dict[str, Any] = {
            "model_name":    req.model_name,
            "task_type":     req.task_type,
            "metric":        req.metric,
            "split_method":  req.split_method,
            "feature_names": feature_names,
            "class_names":   class_names,
        }

        cluster_scaler = None
        if req.task_type == "clustering":
            sc = StandardScaler()
            X_sc = pd.DataFrame(sc.fit_transform(X), columns=X.columns, index=X.index)
            model.fit(X_sc)
            cluster_scaler = sc
            labels = model.labels_
            centroids = sc.inverse_transform(model.cluster_centers_)
            result["n_clusters"]  = int(model.n_clusters)
            result["inertia"]     = safe_round(model.inertia_)
            result["cluster_viz"] = compute_cluster_scatter(
                X, X_sc, labels, model.cluster_centers_, centroids, feature_names)
            unique, counts = np.unique(labels, return_counts=True)
            result["cluster_dist"] = [{"cluster": int(k), "count": int(v)} for k, v in zip(unique, counts)]
            proportions = counts / counts.sum()
            entropy = float(-np.sum(proportions * np.log(proportions + 1e-10)))
            result["entropy"] = safe_round(entropy)
            df_out = df.copy()
            df_out["cluster"] = labels
            result["preview_rows"] = df_out.head(50).fillna("").to_dict(orient="records")
            result["preview_cols"] = list(df_out.columns)

        elif req.split_method == "train_test":
            stratify_y = y if (req.task_type == "classification" and req.stratified) else None
            X_tr, X_te, y_tr, y_te = train_test_split(
                X, y, test_size=1 - req.split_ratio, random_state=42, stratify=stratify_y)
            model.fit(X_tr, y_tr)

            if req.task_type == "classification":
                y_pred = _apply_threshold(model, X_te, class_names, req.threshold)
                result.update(_classification_results(y_te, y_pred, class_names, req.output_options))
                # Held-out probabilities + true labels for the binary case,
                # so the frontend can re-apply a new threshold to THIS
                # already-trained result instantly (no refit) when the
                # slider moves - see the matching useMemo in TrainTest.jsx.
                if hasattr(model, "predict_proba") and len(class_names) == 2:
                    result["threshold_proba"] = [safe_round(p, 6) for p in model.predict_proba(X_te)[:, 1]]
                    result["threshold_y_true"] = [int(v) for v in np.asarray(y_te)]
            else:
                y_pred = model.predict(X_te)
                result.update(_regression_results(y_te, y_pred))

        else:  # cross_validation
            cv_folds = max(2, min(req.cv_folds, len(X)))
            cv_splitter = (StratifiedKFold(n_splits=cv_folds, shuffle=True, random_state=42)
                           if (req.task_type == "classification" and req.stratified)
                           else KFold(n_splits=cv_folds, shuffle=True, random_state=42))

            if req.task_type == "classification":
                if hasattr(model, "predict_proba") and len(class_names) == 2:
                    proba = cross_val_predict(model, X, y, cv=cv_splitter, method="predict_proba")
                    y_pred = (proba[:, 1] >= req.threshold).astype(int)
                    # Same as the train/test-split branch above - lets the
                    # frontend re-threshold this CV result live too.
                    result["threshold_proba"] = [safe_round(p, 6) for p in proba[:, 1]]
                    result["threshold_y_true"] = [int(v) for v in np.asarray(y)]
                else:
                    y_pred = cross_val_predict(model, X, y, cv=cv_splitter, method="predict")
                result.update(_classification_results(y, y_pred, class_names, req.output_options))
                per_fold = _cv_fold_scores(model, X, y, cv_splitter, req.metric, "classification")
                result["cv_scores"] = per_fold
                result["cv_mean"]   = safe_round(np.mean(per_fold)) if per_fold else None
                result["cv_std"]    = safe_round(np.std(per_fold)) if per_fold else None
                model.fit(X, y)  # refit on full data for saving/downstream use
            else:
                y_pred = cross_val_predict(model, X, y, cv=cv_splitter)
                result.update(_regression_results(y, y_pred))
                per_fold = _cv_fold_scores(model, X, y, cv_splitter, req.metric, "regression")
                result["cv_scores"] = per_fold
                result["cv_mean"]   = safe_round(np.mean(per_fold)) if per_fold else None
                result["cv_std"]    = safe_round(np.std(per_fold)) if per_fold else None
                model.fit(X, y)

        result["training_time"] = round(time.time() - t_start, 3)

        if req.task_type != "clustering":
            result["model_viz"] = _model_specific_viz(model, req.model_name, X, y, feature_names, class_names)

        model_id   = str(uuid.uuid4())[:8]
        timestamp  = datetime.now().strftime("%H:%M:%S")
        model_file = os.path.join(MODELS_DIR, f"{req.model_name}_{model_id}.pkl")
        with open(model_file, "wb") as f:
            pickle.dump({"model": model, "feature_names": feature_names,
                         "class_names": class_names, "label_encoder": le,
                         "model_name": req.model_name, "task_type": req.task_type,
                         "threshold": req.threshold, "scaler": cluster_scaler}, f)

        result["model_id"]     = model_id
        result["model_file"]   = model_file
        result["timestamp"]    = timestamp
        result["display_name"] = f"{timestamp} - {req.model_name}"
        return result
    except HTTPException:
        raise
    except Exception as e:
        # Same reasoning as /grid-search's handler - never forward a raw
        # multi-line sklearn traceback as the user-facing error text.
        msg = str(e).strip().splitlines()[0][:300]
        raise HTTPException(500, f"Training failed: {msg}")


def _apply_threshold(model, X_te, class_names, threshold):
    """Binary classification only - multiclass has no single decision
    threshold to tune, so it always falls back to argmax."""
    if hasattr(model, "predict_proba") and len(class_names) == 2:
        proba = model.predict_proba(X_te)
        return (proba[:, 1] >= threshold).astype(int)
    return model.predict(X_te)


def _cv_fold_scores(model, X, y, cv_splitter, metric, task_type):
    from sklearn.model_selection import cross_validate
    try:
        scores = cross_validate(model, X, y, cv=cv_splitter,
                                scoring=metric_to_sklearn(metric, task_type))
        return [safe_round(s) for s in scores["test_score"]]
    except Exception:
        return []


def _classification_results(y_true, y_pred, class_names, output_options):
    from sklearn.metrics import (confusion_matrix, accuracy_score, f1_score,
                                  precision_score, recall_score, classification_report)
    y_t = np.array(y_true)
    y_p = np.array(y_pred)
    res = {
        "accuracy":  safe_round(accuracy_score(y_t, y_p)),
        "f1":        safe_round(f1_score(y_t, y_p, average="weighted", zero_division=0)),
        "precision": safe_round(precision_score(y_t, y_p, average="weighted", zero_division=0)),
        "recall":    safe_round(recall_score(y_t, y_p, average="weighted", zero_division=0)),
    }
    if output_options.get("confusion_matrix", True):
        labels = list(range(len(class_names))) if class_names else None
        res["confusion_matrix"] = confusion_matrix(y_t, y_p, labels=labels).tolist()
    if output_options.get("per_class_stats", True):
        report = classification_report(y_t, y_p, output_dict=True, zero_division=0)
        per_class = []
        for i, cls in enumerate(class_names):
            key = str(i) if str(i) in report else cls
            if key in report:
                r = report[key]
                per_class.append({
                    "class": cls, "precision": safe_round(r["precision"]),
                    "recall": safe_round(r["recall"]), "f1": safe_round(r["f1-score"]),
                    "support": int(r["support"]),
                })
        res["per_class"] = per_class
    return res


def _regression_results(y_true, y_pred):
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
    y_t = np.array(y_true, dtype=float)
    y_p = np.array(y_pred, dtype=float)
    n = len(y_t)
    # Random sample for the scatter, not just the first N rows - in
    # cross-validation mode y/y_pred are still in the ORIGINAL row order
    # (cross_val_predict preserves it), so slicing the first 300 could bias
    # the plotted sample toward whatever the CSV happened to be sorted by.
    if n > 300:
        idx = np.random.default_rng(42).choice(n, 300, replace=False)
    else:
        idx = np.arange(n)
    return {
        "mae":  safe_round(mean_absolute_error(y_t, y_p)),
        "mse":  safe_round(mean_squared_error(y_t, y_p)),
        "rmse": safe_round(np.sqrt(mean_squared_error(y_t, y_p))),
        "r2":   safe_round(r2_score(y_t, y_p)),
        "regression_scatter": [{"actual": safe_round(y_t[i]), "predicted": safe_round(y_p[i])} for i in idx],
    }


def _model_specific_viz(model, model_name: str, X, y, feature_names, class_names):
    viz = {}
    # knn/svm/logistic_regression/linear_regression/ridge_regression come
    # back from build_model wrapped in Pipeline("scaler" -> "model") - the
    # coefficients/attributes below belong to the actual estimator, not the
    # Pipeline wrapper. (Bonus, not incidental: coefficients read off the
    # SCALED estimator are directly comparable across features of very
    # different raw units - e.g. income in the hundreds of thousands next
    # to age in the tens - which a raw-unit coefficient table would not be.)
    inner = unwrap_model(model)
    try:
        if model_name == "decision_tree":
            viz["tree"] = tree_to_dict(inner, feature_names, class_names, max_depth=5)

        elif model_name in ("random_forest", "random_forest_regressor", "xgboost"):
            importances = inner.feature_importances_
            viz["feature_importance"] = [
                {"feature": f, "importance": safe_round(v)}
                for f, v in sorted(zip(feature_names, importances), key=lambda x: x[1], reverse=True)
            ]

        elif model_name == "logistic_regression":
            coef = inner.coef_[0]
            viz["coefficients"] = [{"feature": f, "coef": safe_round(c)} for f, c in zip(feature_names, coef)]
            xs = np.linspace(-6, 6, 80)
            viz["sigmoid_curve"] = [{"x": round(float(x), 2), "y": safe_round(1 / (1 + np.exp(-x)))} for x in xs]

        elif model_name == "linear_regression":
            viz["coefficients"] = [{"feature": f, "coef": safe_round(c)} for f, c in zip(feature_names, inner.coef_)]
            viz["intercept"] = safe_round(inner.intercept_)

        elif model_name == "ridge_regression":
            viz["coefficients"] = [{"feature": f, "coef": safe_round(c)} for f, c in zip(feature_names, inner.coef_)]
            viz["intercept"] = safe_round(inner.intercept_)

        elif model_name == "svm" and hasattr(inner, "coef_"):
            viz["feature_importance"] = [
                {"feature": f, "importance": safe_round(abs(c))}
                for f, c in sorted(zip(feature_names, inner.coef_[0]), key=lambda x: abs(x[1]), reverse=True)
            ]

        elif model_name == "naive_bayes":
            # GaussianNB-specific: theta_ holds each class's per-feature
            # mean. A feature whose mean varies a lot ACROSS classes
            # (relative to its overall spread) is exactly what makes Naive
            # Bayes's "assume independence, multiply per-feature
            # likelihoods" approach work - so that spread-across-classes,
            # not a generic importance score, is the NB-native signal here.
            # Rendered as a small Bayesian network: one Class node with an
            # edge to every feature node, edge weight = that spread.
            theta = np.asarray(model.theta_)      # (n_classes, n_features)
            overall_std = X.to_numpy().std(axis=0) + 1e-9
            spread = theta.std(axis=0) / overall_std
            viz["bayes_network"] = {
                "classes": class_names,
                "features": [
                    {"feature": f, "influence": safe_round(s)}
                    for f, s in sorted(zip(feature_names, spread), key=lambda x: x[1], reverse=True)
                ],
            }
    except Exception:
        pass
    return viz

# ─────────────────────────────────────────────────────────────────────────────
# 6. DOWNLOAD MODEL (.pkl file)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/model/download")
def download_model(model_file: str, model_name: str = "model"):
    if not os.path.exists(model_file):
        raise HTTPException(404, "Model file not found.")
    filename = f"{model_name}_{os.path.basename(model_file)}"
    return FileResponse(path=model_file, filename=filename, media_type="application/octet-stream")
