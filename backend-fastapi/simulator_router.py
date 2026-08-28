"""
PRISM — Simulator Router (FastAPI)
Page name: "Simulator" (What-If Simulator + Batch Prediction)

Endpoints:
  POST /simulator/defaults        — feature sliders/dropdowns config
  POST /simulator/predict-single  — single entry prediction + SHAP waterfall
  POST /simulator/predict-batch   — batch CSV prediction + download
  GET  /simulator/download-batch  — stream a saved batch-prediction CSV

Add to main.py:
    from simulator_router import router as sim_router
    app.include_router(sim_router)
"""
import io, os, pickle, warnings, uuid
from typing import Any, Dict, List
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from utils.shap_helpers import TREE_MODELS, select_class_shap, select_expected_value, make_kernel_predict_fn
warnings.filterwarnings("ignore")

router = APIRouter(prefix="/simulator", tags=["Simulator"])

PREDICT_DIR = os.path.join(os.path.dirname(__file__), "predictions")
os.makedirs(PREDICT_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def read_df(path: str) -> pd.DataFrame:
    if not os.path.exists(path):
        raise HTTPException(404, f"File not found: {path}")
    return pd.read_csv(path)

def load_model(pkl: str) -> dict:
    if not os.path.exists(pkl):
        raise HTTPException(404, f"Model file not found: {pkl}")
    with open(pkl, "rb") as f:
        return pickle.load(f)

def safe_round(x, nd=5):
    """None/NaN/inf-safe rounding — same helper as every other router in
    this project. A slider dragged to an extreme value can legitimately
    produce a NaN/inf prediction or SHAP value for some models; a bare NaN
    is valid to Python's json module but not valid JSON."""
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return None
    if xf != xf or xf in (float("inf"), float("-inf")):
        return None
    return round(xf, nd)

def _is_numeric(v):
    try:
        float(v); return True
    except (ValueError, TypeError):
        return False

def prepare_row(df: pd.DataFrame, feature_values: Dict[str, Any],
                feature_names: List[str]) -> pd.DataFrame:
    """Turn a dict of user-provided values into a single-row DataFrame,
    filling any feature the user hasn't touched yet with the dataset's own
    mean (numeric) / mode (categorical)."""
    row = {}
    for feat in feature_names:
        if feat in feature_values:
            row[feat] = float(feature_values[feat]) if _is_numeric(feature_values[feat]) else feature_values[feat]
        else:
            col = df[feat] if feat in df.columns else None
            if col is not None and pd.api.types.is_numeric_dtype(col):
                row[feat] = safe_round(col.mean(), 6) or 0.0
            elif col is not None and not col.mode().empty:
                row[feat] = col.mode()[0]
            else:
                row[feat] = 0
    return pd.DataFrame([row])

def apply_cluster_scaling(mdata: dict, X: pd.DataFrame) -> pd.DataFrame:
    """K-Means is trained on STANDARDIZED features (training_router.py's
    clustering branch fits it against a StandardScaler-transformed copy of
    X, then throws that scaler away without saving it) - so predict() on a
    raw, unscaled row was comparing e.g. a real BALANCE of 30,000 against
    centroid coordinates that live in roughly [-3, 3]. That mismatch makes
    the "nearest cluster" answer almost totally insensitive to realistic
    slider movement, since the huge raw-vs-scaled unit gap swamps out any
    actual change in the input - this was the root cause of the Simulator
    page's clustering prediction looking permanently stuck. The scaler is
    now persisted in the model's own .pkl (see training_router.py) and
    reapplied here before every predict()/SHAP call; every other model
    either doesn't need scaling (tree-based) or already carries its own
    scaler inside a Pipeline (see build_model), so mdata["scaler"] is only
    ever set for a clustering model and this is a no-op for the rest."""
    scaler = mdata.get("scaler")
    if scaler is None:
        return X
    return pd.DataFrame(scaler.transform(X), columns=X.columns, index=X.index)

def compute_shap_waterfall(model, X_row: pd.DataFrame, background: pd.DataFrame,
                           model_name: str, task_type: str, X_row_display: pd.DataFrame = None) -> dict:
    """Instance-level SHAP values for exactly one row.

    `background` MUST be a real sample of OTHER rows (e.g. from the
    training dataset), never X_row itself — a first pasted draft of this
    function passed X_row as its own "background," which for
    KernelExplainer/LinearExplainer means every perturbation collapses
    back onto the same single point (nothing to contrast against), making
    the resulting SHAP values meaningless in the KernelExplainer case.

    `X_row` is whatever the MODEL actually needs (for K-Means this is
    scaled — see apply_cluster_scaling below); `X_row_display` is the raw,
    human-readable version shown in the waterfall's "33036.43 = PURCHASES"
    labels. They're the same object for every other model, since nothing
    else needs a separate scaled copy of the input."""
    if X_row_display is None:
        X_row_display = X_row
    try:
        import shap
    except ImportError:
        return {"error": "shap library not installed. Run: pip install shap"}

    try:
        if model_name in TREE_MODELS:
            # Not Pipeline-wrapped (see utils/shap_helpers.py) — TreeExplainer
            # wants the raw model directly and doesn't need an explicit
            # background (uses the tree's own path-dependent perturbation).
            explainer = shap.TreeExplainer(model)
            shap_values = explainer.shap_values(X_row)
            base_val = select_expected_value(explainer.expected_value)
        else:
            # Everything else (knn/svm/logistic_regression/linear_regression/
            # ridge_regression/naive_bayes/kmeans) — several of these come
            # back wrapped in a Pipeline, so route through the same
            # plain-function-wrapped KernelExplainer used by
            # feature_impact_router.py (see utils/shap_helpers.py's
            # docstring for why a bound method crashes here).
            use_proba = task_type == "classification" and hasattr(model, "predict_proba")
            explainer = shap.KernelExplainer(make_kernel_predict_fn(model, use_proba), background)
            # Small, fixed nsamples: this runs on every debounced slider
            # tick, so it needs to stay responsive, not maximally precise.
            shap_values = explainer.shap_values(X_row, nsamples=64)
            base_val = select_expected_value(explainer.expected_value)
    except Exception as e:
        return {"error": str(e)}

    sv = select_class_shap(shap_values)
    if sv.ndim > 1:
        sv = sv[0]

    features = [
        {"name": col, "value": safe_round(X_row_display[col].iloc[0], 4) or 0.0, "shap": safe_round(sv[i]) or 0.0}
        for i, col in enumerate(X_row.columns)
    ]
    final_val = base_val + float(np.sum([f["shap"] for f in features]))

    return {
        "base_value": safe_round(base_val) or 0.0,
        "final_value": safe_round(final_val) or 0.0,
        "features": sorted(features, key=lambda x: abs(x["shap"]), reverse=True),
    }

def format_prediction(model, X_row: pd.DataFrame, class_names: List[str],
                      task_type: str, threshold: float = 0.5) -> dict:
    """Structured prediction result — shape depends on task type."""
    if task_type == "clustering":
        label = int(model.predict(X_row)[0])
        return {"type": "cluster", "label": label, "class_names": class_names}

    if task_type == "regression":
        val = safe_round(model.predict(X_row)[0], 4)
        return {"type": "regression", "value": val}

    proba = None
    if hasattr(model, "predict_proba"):
        proba_arr = model.predict_proba(X_row)[0]
        proba = {str(c): safe_round(p, 4) or 0.0 for c, p in zip(class_names or range(len(proba_arr)), proba_arr)}
        pred_idx = int(np.argmax(proba_arr))
        confidence = safe_round(proba_arr[pred_idx], 4)
    else:
        pred_idx = int(model.predict(X_row)[0])
        confidence = None

    label = class_names[pred_idx] if class_names and pred_idx < len(class_names) else str(pred_idx)
    return {"type": "classification", "label": label, "confidence": confidence,
            "proba": proba, "class_names": class_names}

def resolve_feature_names(mdata: dict, df: pd.DataFrame, target_column: str) -> List[str]:
    feature_names = mdata.get("feature_names") or [c for c in df.columns if c != target_column]
    missing = [c for c in feature_names if c not in df.columns]
    if missing:
        raise HTTPException(
            400,
            f"This dataset is missing {len(missing)} column(s) the model was trained on "
            f"({', '.join(missing[:5])}{'…' if len(missing) > 5 else ''}). "
            "Simulator must run against the same dataset version used for Training."
        )
    return feature_names

# ─────────────────────────────────────────────────────────────────────────────
# REQUEST MODELS
# ─────────────────────────────────────────────────────────────────────────────

class DefaultsReq(BaseModel):
    file_path: str
    target_column: str = ""
    model_pkl_path: str

class PredictSingleReq(BaseModel):
    file_path: str
    target_column: str = ""
    model_pkl_path: str
    task_type: str = "classification"
    feature_values: Dict[str, Any] = {}
    threshold: float = 0.5

# ─────────────────────────────────────────────────────────────────────────────
# 1. DEFAULTS — feature slider config
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/defaults")
def get_defaults(req: DefaultsReq):
    try:
        df = read_df(req.file_path)
        mdata = load_model(req.model_pkl_path)
        if mdata.get("model") is None:
            raise HTTPException(400, "This .pkl file doesn't look like a PRISM-trained model (missing 'model' key).")
        feature_names = resolve_feature_names(mdata, df, req.target_column)
        class_names = mdata.get("class_names", [])

        features_config = []
        for feat in feature_names:
            col = df[feat].dropna()
            if col.empty:
                continue
            is_num = pd.api.types.is_numeric_dtype(col)

            if is_num:
                if col.nunique() <= 2 and set(col.unique()).issubset({0, 1, 0.0, 1.0}):
                    features_config.append({
                        "name": feat, "type": "binary", "min": 0, "max": 1, "step": 1,
                        "default": int(round(float(col.mean()))),
                    })
                else:
                    q01 = float(col.quantile(0.01))
                    q99 = float(col.quantile(0.99))
                    features_config.append({
                        "name": feat, "type": "numeric",
                        "min": safe_round(col.min(), 3), "max": safe_round(col.max(), 3),
                        "q01": safe_round(q01, 3), "q99": safe_round(q99, 3),
                        "step": safe_round((q99 - q01) / 100, 4) if q99 > q01 else 0.01,
                        "default": safe_round(col.mean(), 4) or 0.0,
                        "std": safe_round(col.std(), 4) or 0.0,
                    })
            else:
                cats = sorted(str(v) for v in col.unique())
                mode = str(col.mode()[0]) if not col.mode().empty else (cats[0] if cats else "")
                features_config.append({"name": feat, "type": "categorical", "categories": cats, "default": mode})

        return {
            "features": features_config, "feature_names": feature_names, "class_names": class_names,
            "model_name": mdata.get("model_name", "unknown"), "task_type": mdata.get("task_type", "classification"),
            "n_rows": len(df),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Could not build simulator configuration: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# 2. PREDICT SINGLE — one row → prediction + SHAP waterfall
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/predict-single")
def predict_single(req: PredictSingleReq):
    try:
        df = read_df(req.file_path)
        mdata = load_model(req.model_pkl_path)
        model = mdata.get("model")
        if model is None:
            raise HTTPException(400, "This .pkl file doesn't look like a PRISM-trained model (missing 'model' key).")

        feature_names = resolve_feature_names(mdata, df, req.target_column)
        class_names = mdata.get("class_names", [])
        task_type = mdata.get("task_type", req.task_type)

        X_row = prepare_row(df, req.feature_values, feature_names).fillna(0)
        X_row_model = apply_cluster_scaling(mdata, X_row)
        pred_res = format_prediction(model, X_row_model, class_names, task_type, req.threshold)

        model_name = mdata.get("model_name", "")
        bg = df[feature_names].fillna(0)
        background = bg.sample(min(20, len(bg)), random_state=42) if len(bg) else X_row
        background_model = apply_cluster_scaling(mdata, background)
        shap_result = compute_shap_waterfall(model, X_row_model, background_model, model_name, task_type, X_row_display=X_row)

        return {"prediction": pred_res, "shap": shap_result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Prediction failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# 3. PREDICT BATCH — uploaded CSV → CSV with a Predicted column
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/predict-batch")
async def predict_batch(
    model_pkl_path: str = Form(...),
    task_type: str = Form("classification"),
    file: UploadFile = File(...),
):
    try:
        mdata = load_model(model_pkl_path)
        model = mdata.get("model")
        if model is None:
            raise HTTPException(400, "This .pkl file doesn't look like a PRISM-trained model (missing 'model' key).")
        feature_names = mdata.get("feature_names", [])
        class_names = mdata.get("class_names", [])
        real_task_type = mdata.get("task_type", task_type)

        content = await file.read()
        try:
            df_up = pd.read_csv(io.BytesIO(content))
        except Exception:
            raise HTTPException(400, "Could not read the uploaded file as a CSV.")

        usable = [f for f in feature_names if f in df_up.columns]
        if not usable:
            raise HTTPException(
                400,
                f"None of the model's {len(feature_names)} training features were found in the uploaded file. "
                f"Expected columns like: {', '.join(feature_names[:5])}{'…' if len(feature_names) > 5 else ''}."
            )
        missing = [f for f in feature_names if f not in df_up.columns]

        X = df_up[usable].fillna(0)
        if missing:
            for f in missing:
                X[f] = 0.0
            X = X[feature_names]
        # See apply_cluster_scaling's docstring - a no-op for every model
        # except K-Means, which needs its input on the same standardized
        # scale it was actually trained/clustered on.
        X_model = apply_cluster_scaling(mdata, X)

        if real_task_type == "regression":
            preds = model.predict(X_model)
            df_up["Predicted"] = [safe_round(p, 4) or 0.0 for p in preds]
        elif real_task_type == "clustering":
            preds = model.predict(X_model)
            df_up["Predicted_Cluster"] = [int(p) for p in preds]
        else:
            preds = model.predict(X_model)
            if class_names:
                df_up["Predicted"] = [class_names[int(p)] if 0 <= int(p) < len(class_names) else str(p) for p in preds]
            else:
                df_up["Predicted"] = [str(p) for p in preds]
            if hasattr(model, "predict_proba"):
                proba = model.predict_proba(X_model)
                df_up["Confidence"] = [safe_round(max(row), 3) or 0.0 for row in proba]

        shap_result = {}
        first_pred = {}
        if len(X) > 0:
            model_name = mdata.get("model_name", "")
            background_model = X_model.sample(min(20, len(X_model)), random_state=42)
            shap_result = compute_shap_waterfall(model, X_model.iloc[[0]], background_model, model_name, real_task_type, X_row_display=X.iloc[[0]])
            first_pred = {"prediction": format_prediction(model, X_model.iloc[[0]], class_names, real_task_type)}

        result_id = str(uuid.uuid4())[:8]
        result_path = os.path.join(PREDICT_DIR, f"predictions_{result_id}.csv")
        df_up.to_csv(result_path, index=False)

        return {
            "row_count": len(df_up), "col_count": len(df_up.columns),
            "preview_rows": df_up.head(20).fillna("").to_dict(orient="records"),
            "all_columns": list(df_up.columns), "result_path": result_path,
            "shap": shap_result, "first_pred": first_pred,
            "missing_columns": missing,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Batch prediction failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# 4. DOWNLOAD batch result
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/download-batch")
def download_batch(result_path: str, filename: str = "predictions.csv"):
    if not os.path.exists(result_path):
        raise HTTPException(404, "Result file not found.")
    df = pd.read_csv(result_path)
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    buf.seek(0)
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode()), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
