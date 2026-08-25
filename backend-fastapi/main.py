"""
IntelliML — FastAPI ML Engine
==============================
ML computation backend. Handles all machine learning operations:
profiling, cleaning, training, evaluation, elbow curves, and What-If predictions.

Django (port 8080) handles: auth, file storage, database, projects
FastAPI (port 8001) handles: all ML work

Run with:
    uvicorn main:app --host 0.0.0.0 --port 8001 --reload

Endpoints:
    GET  /health — server status check
    POST /ml/profile — profile a dataset (health score + statistics)
    POST /ml/recommendations — get model recommendations for a task
    POST /ml/clean/auto — auto-clean a dataset (Smart Auto mode)
    POST /ml/clean/step — clean one step at a time (Expert mode)
    POST /ml/train — train a specific algorithm (Guided mode)
    POST /ml/auto — full auto pipeline + tournament (Smart Auto mode)
    POST /ml/elbow — KNN elbow curve data
    POST /ml/what-if/predict — What-If Simulator: single prediction
    POST /ml/what-if/contributions — What-If Simulator: feature contributions
"""

import os
import sys
import pickle
from dotenv import load_dotenv

load_dotenv()  # load .env file (DEEPSEEK_API_KEY, paths, etc.)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

# ──────────────────────────────────────────────────────────────────────────────
# ADD ML-CORE TO PYTHON PATH
# ──────────────────────────────────────────────────────────────────────────────
# This tells Python where to find cleaning.py, models.py, evaluation.py, pipelines.py
# The path goes up one level from backend-fastapi/ to the project root, then
# into ml-core/. Adjust if your folder structure is different.
# ──────────────────────────────────────────────────────────────────────────────
ML_CORE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'ml-core'
)
if ML_CORE_PATH not in sys.path:
    sys.path.insert(0, ML_CORE_PATH)

# ──────────────────────────────────────────────────────────────────────────────
# IMPORT FROM ML-CORE
# ──────────────────────────────────────────────────────────────────────────────
# These imports will work once ml-core/ is in sys.path
# ──────────────────────────────────────────────────────────────────────────────
from cleaning import (
    load_data,
    profile_dataset,
    auto_clean,
    encode_categorical_columns,
)
from models import (
    detect_task_type,
    recommend_models,
    get_model_by_name,
    run_tournament,
)
from evaluation import (
    evaluate_classification,
    evaluate_regression,
    evaluate_clustering,
    get_elbow_data,
    predict_what_if,
    get_feature_contributions,
)
from pipelines import (
    run_full_pipeline,
    run_auto_pipeline,
    run_cleaning_step,
    split_features_target,
    split_train_test,
    scale_features,
)
from cleaning_router_v2 import router as cleaning_router
from encoding_router import router as encoding_router
from feature_engineering_router import router as feature_router
from sampling_router import router as sampling_router
from visualization_router import router as viz_router
from feature_selection_router import router as feature_selection_router
from diagnose_router import router as diagnose_router

# ──────────────────────────────────────────────────────────────────────────────
# FASTAPI APP SETUP
# ──────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="IntelliML ML Engine",
    description="ML processing backend for the IntelliML capstone platform",
    version="1.0.0",
    docs_url="/docs",   # — http://localhost:8001/docs (interactive API tester)
)

app.include_router(cleaning_router)
app.include_router(encoding_router)
app.include_router(feature_router)
app.include_router(sampling_router)
app.include_router(viz_router)
app.include_router(feature_selection_router)
app.include_router(diagnose_router)

# CORS: allow React (port 5173) and Django (port 8080) to call this API
#
# Both "localhost" and "127.0.0.1" variants are listed because on a
# dual-stack machine "localhost" can resolve to ::1 (IPv6) as well as
# 127.0.0.1 (IPv4). This server only binds IPv4 (127.0.0.1), so if a
# browser's fetch() happens to resolve "localhost" to ::1 first, the
# connection fails outright before CORS is even reached (surfaces in the
# browser as a bare "Failed to fetch", not an HTTP error) — see
# frontend/src/api.js and the API constants in Cleaning.jsx/Encoding.jsx,
# which now hit 127.0.0.1 directly instead of "localhost" to sidestep this
# ambiguity entirely. Both origins are still allowed here in case anything
# is loaded via the "localhost" URL instead.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # React frontend (Vite)
        "http://127.0.0.1:5173",
        "http://localhost:3000",   # React if running on port 3000
        "http://127.0.0.1:3000",
        "http://localhost:8080",   # Django backend (for internal calls)
        "http://127.0.0.1:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],           # allow GET, POST, PUT, DELETE, etc.
    allow_headers=["*"],           # allow all headers (including Authorization)
)


# ──────────────────────────────────────────────────────────────────────────────
# PYDANTIC REQUEST MODELS
# ──────────────────────────────────────────────────────────────────────────────
# Each class defines the shape of one endpoint's request body.
# FastAPI validates every incoming request against these automatically.
# Fields with = None or = 'default' are optional; others are required.
# ──────────────────────────────────────────────────────────────────────────────

class ProfileRequest(BaseModel):
    file_path:      str                  # full path to the CSV on disk
    target_column:  Optional[str] = None # optional: known target column


class RecommendRequest(BaseModel):
    task_type:        str                # 'classification', 'regression', 'clustering'
    profiling_result: Dict[str, Any]     # the dict returned by /ml/profile


class AutoCleanRequest(BaseModel):
    file_path:        str
    target_column:    Optional[str] = None
    dataset_save_dir: Optional[str] = None  # where to save the cleaned CSV


class CleanStepRequest(BaseModel):
    file_path:  str                          # current working CSV path
    step_name:  str                          # e.g. "fill_mean", "remove_outliers_iqr"
    config:     Optional[Dict[str, Any]] = None  # e.g. {"column": "Age"}


class TrainRequest(BaseModel):
    file_path:        str
    target_column:    Optional[str] = None
    task_type:        Optional[str] = None   # None = auto-detect
    algorithm:        str = 'random_forest'  # or 'tournament' to run all
    test_size:        float = 0.4
    experiment_id:    str                    # UUID from Django's Experiment record
    model_save_dir:   str = 'media/models/'
    dataset_save_dir: Optional[str] = None


class AutoPipelineRequest(BaseModel):
    file_path:        str
    target_column:    Optional[str] = None
    experiment_id:    str
    model_save_dir:   str = 'media/models/'
    dataset_save_dir: Optional[str] = None


class ElbowRequest(BaseModel):
    file_path:      str
    target_column:  str
    k_min:          int = 1
    k_max:          int = 27


class WhatIfRequest(BaseModel):
    model_path:    str                  # full path to the saved model .pkl
    scaler_path:   Optional[str] = None # full path to the saved scaler .pkl
    input_values:  Dict[str, float]     # {"Glucose": 148, "BMI": 33.6, ...}
    feature_names: List[str]            # ordered list matching training features


# ──────────────────────────────────────────────────────────────────────────────
# ENDPOINT 1 — HEALTH CHECK
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health_check():
    """
    Simple endpoint to verify the FastAPI server is running.
    React can call this on page load to show a "ML engine connected" status.
    No authentication, no body required.
    """
    return {
        "status":  "ok",
        "service": "IntelliML ML Engine",
        "version": "1.0.0",
    }


# ──────────────────────────────────────────────────────────────────────────────
# ENDPOINT 2 — PROFILE DATASET
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/ml/profile")
def profile_dataset_endpoint(request: ProfileRequest):
    """
    Profile an uploaded CSV and return health score + full statistics.

    Called by Django immediately after a CSV file is saved to disk.
    Django passes the saved file path. FastAPI reads it, computes the
    complete profile, and returns it. Django then stores this in
    Dataset.profiling_result (JSONB column in PostgreSQL).

    React uses the returned data to render the Diagnose page:
    health score gauge, column passport cards, correlation heatmap,
    insight cards.

    Request:  {"file_path": "media/datasets/user_1/proj_x/original.csv"}
    Response: {"profiling_result": {...}, "health_score": {...}, "row_count": 768}
    """
    try:
        # Verify the file exists before trying to read it
        if not os.path.exists(request.file_path):
            raise HTTPException(
                status_code=404,
                detail=f"File not found: {request.file_path}"
            )

        df               = load_data(request.file_path)
        profiling_result = profile_dataset(df, request.target_column)

        return {
            "profiling_result": profiling_result,
            "health_score":     profiling_result.get("health_score", {}),
            "row_count":        profiling_result.get("total_rows", 0),
            "column_count":     profiling_result.get("total_columns", 0),
        }

    except HTTPException:
        raise  # re-raise HTTP exceptions exactly as-is

    except Exception as e:
        # Catch any unexpected error from our ML code and return 500
        raise HTTPException(
            status_code=500,
            detail=f"Profiling failed: {str(e)}"
        )


# ──────────────────────────────────────────────────────────────────────────────
# ENDPOINT 3 — MODEL RECOMMENDATIONS
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/ml/recommendations")
def get_recommendations_endpoint(request: RecommendRequest):
    """
    Given a task type and profiling result, return ranked model recommendations
    with plain-language reasons for each.

    Called when the user reaches the Goal/Algorithm selection step.
    React renders these as recommendation cards the user can select from.

    Request:  {"task_type": "classification", "profiling_result": {...}}
    Response: {"recommendations": [{"algorithm": "random_forest", "rank": 1, "reason": "..."}, ...]}
    """
    try:
        recommendations = recommend_models(request.task_type, request.profiling_result)
        return {"recommendations": recommendations}

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Recommendation failed: {str(e)}"
        )


# ──────────────────────────────────────────────────────────────────────────────
# ENDPOINT 4 — AUTO CLEAN (Smart Auto mode)
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/ml/clean/auto")
def auto_clean_endpoint(request: AutoCleanRequest):
    """
    Run the full automatic cleaning pipeline in one call.
    Used in Smart Auto mode — the system decides and executes everything.

    Internally calls: build_auto_clean_config() + auto_clean()
    which runs all 5 sub-steps (drop useless cols, remove duplicates,
    fill missing values, fill categoricals, remove outliers).

    If dataset_save_dir is provided, saves the cleaned CSV to disk.
    Django should then create a DatasetVersion record pointing to this file.

    Request:  {
        "file_path": "media/.../original.csv",
        "target_column": "Outcome",
        "dataset_save_dir": "media/datasets/user_1/project_x/"
    }
    Response: {
        "cleaned_file_path": "media/.../cleaned_v2.csv",
        "cleaning_summary": ["Removed 3 duplicates", "Filled 12 missing in Age..."],
        "rows_before": 768,
        "rows_after": 753,
        "rows_removed": 15
    }
    """
    try:
        if not os.path.exists(request.file_path):
            raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

        df               = load_data(request.file_path)
        profiling_result = profile_dataset(df, request.target_column)
        cleaned_df, summary = auto_clean(df, profiling_result, request.target_column)

        # Save cleaned CSV if save directory is provided
        cleaned_path = None
        if request.dataset_save_dir:
            os.makedirs(request.dataset_save_dir, exist_ok=True)
            cleaned_path = os.path.join(request.dataset_save_dir, 'cleaned_v2.csv')
            cleaned_df.to_csv(cleaned_path, index=False)

        return {
            "cleaned_file_path": cleaned_path,
            "cleaning_summary":  summary,
            "rows_before":       len(df),
            "rows_after":        len(cleaned_df),
            "rows_removed":      len(df) - len(cleaned_df),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Auto-clean failed: {str(e)}")


# ──────────────────────────────────────────────────────────────────────────────
# ENDPOINT 5 — CLEAN ONE STEP (Guided Expert mode)
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/ml/clean/step")
def clean_step_endpoint(request: CleanStepRequest):
    """
    Execute exactly ONE cleaning operation as chosen by the expert user.
    This endpoint is called once per user decision in Guided Expert mode.

    If the user has 3 recommendations and accepts 2, this endpoint is
    called twice — once for each accepted step.

    The function OVERWRITES the CSV at file_path with the modified version.
    This means file_path always points to the "current working state" of
    the dataset as the user cleans it step by step.

    Valid step_name values:
        "fill_mean" — config: {"column": "Age"}
        "fill_median" — config: {"column": "Age"}
        "fill_mode" — config: {"column": "Gender"}
        "fill_constant" — config: {"column": "Age", "constant": 0}
        "remove_outliers_iqr" — config: {"column": "BMI"}
        "remove_outliers_zscore" — config: {"column": "BMI"}
        "remove_duplicates" — config: {} (no parameters)
        "drop_column" — config: {"column": "old_id"}
        "encode_categorical" — config: {} or {"exclude": ["Outcome"]}
        "normalize" — config: {} or {"exclude": ["Outcome"]}

    Request:  {"file_path": "...", "step_name": "fill_mean", "config": {"column": "Age"}}
    Response: {"description": "Filled 12 missing values in 'Age' using mean (31.4)", "rows_after": 768, ...}
    """
    try:
        if not os.path.exists(request.file_path):
            raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

        df = load_data(request.file_path)
        new_df, description, extra = run_cleaning_step(df, request.step_name, request.config)

        # Overwrite the file with the cleaned version
        # This preserves the "current working state" as the user applies steps
        new_df.to_csv(request.file_path, index=False)

        result = {
            "description": description,
            "rows_before": len(df),
            "rows_after":  len(new_df),
            "step_name":   request.step_name,
        }

        # Include encoding map if this was the encode step
        if request.step_name == "encode_categorical" and isinstance(extra, dict):
            result["encoding_map"] = extra

        return result

    except ValueError as e:
        # run_cleaning_step raises ValueError for unknown step names
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cleaning step failed: {str(e)}")


# ──────────────────────────────────────────────────────────────────────────────
# ENDPOINT 6 — TRAIN (Guided mode: specific algorithm)
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/ml/train")
def train_endpoint(request: TrainRequest):
    """
    Run the complete ML pipeline with a specific algorithm.
    Called in Guided Expert mode when the user clicks "Run Training"
    after finishing the cleaning steps and selecting an algorithm.

    Runs the full sequence:
    profile — auto_clean — encode — split — scale — train — evaluate — save

    Pass algorithm='tournament' to run all recommended algorithms and get
    a leaderboard instead of a single model result.

    Request:  {
        "file_path": "...",
        "target_column": "Outcome",
        "algorithm": "random_forest",
        "experiment_id": "uuid-string-here",
        "model_save_dir": "media/models/"
    }
    Response: full results dict with metrics, feature_importance, model_path, etc.
    """
    try:
        if not os.path.exists(request.file_path):
            raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

        results = run_full_pipeline(
            df_path=          request.file_path,
            target_column=    request.target_column,
            task_type=        request.task_type,
            algorithm=        request.algorithm,
            test_size=        request.test_size,
            experiment_id=    request.experiment_id,
            model_save_dir=   request.model_save_dir,
            dataset_save_dir= request.dataset_save_dir,
        )

        return results

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Training failed: {str(e)}")


# ──────────────────────────────────────────────────────────────────────────────
# ENDPOINT 7 — AUTO PIPELINE (Smart Auto mode: everything automated)
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/ml/auto")
def auto_pipeline_endpoint(request: AutoPipelineRequest):
    """
    Run the complete automated pipeline with tournament.
    Called in Smart Auto mode — one endpoint call does everything.

    Auto-detects task type, runs all recommended algorithms, returns
    leaderboard + best model metrics + agent_decisions transparency log.

    Request:  {
        "file_path": "...",
        "target_column": "Outcome",
        "experiment_id": "uuid-string-here"
    }
    Response: full results + leaderboard + agent_decisions list
    """
    try:
        if not os.path.exists(request.file_path):
            raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

        results = run_auto_pipeline(
            df_path=          request.file_path,
            target_column=    request.target_column,
            experiment_id=    request.experiment_id,
            model_save_dir=   request.model_save_dir,
            dataset_save_dir= request.dataset_save_dir,
        )

        return results

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Auto pipeline failed: {str(e)}")


# ──────────────────────────────────────────────────────────────────────────────
# ENDPOINT 8 — KNN ELBOW CURVE
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/ml/elbow")
def elbow_curve_endpoint(request: ElbowRequest):
    """
    Compute the KNN Elbow Curve and return chart data.
    Called when the user selects KNN as their algorithm so they can
    choose the best k before training.

    Internally runs the full data preparation pipeline first
    (profile — clean — encode — split — scale), then tests every k value
    from k_min to k_max and records the accuracy for each.

    Request:  {"file_path": "...", "target_column": "Outcome", "k_min": 1, "k_max": 27}
    Response: {"k_values": [1,2,...,27], "accuracies": [...], "best_k": 7, "best_accuracy": 0.84}
    """
    try:
        if not os.path.exists(request.file_path):
            raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

        # Full data preparation (same steps as training, up to scaling)
        df               = load_data(request.file_path)
        profiling_result = profile_dataset(df, request.target_column)
        cleaned_df, _    = auto_clean(df, profiling_result, request.target_column)

        # Encode if categorical columns exist
        has_categoricals = not cleaned_df.select_dtypes(include=['object']).empty
        if has_categoricals:
            cleaned_df, _ = encode_categorical_columns(
                cleaned_df,
                exclude_columns=[request.target_column]
            )

        # Split and scale
        X, y = split_features_target(cleaned_df, request.target_column)
        X_train, X_test, y_train, y_test = split_train_test(X, y, stratify=y)
        X_train_scaled, X_test_scaled, _ = scale_features(X_train, X_test)

        # Compute elbow data
        elbow_data = get_elbow_data(
            X_train_scaled, X_test_scaled,
            y_train, y_test,
            k_range=range(request.k_min, request.k_max + 1)
        )

        return elbow_data

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Elbow curve failed: {str(e)}")


# ──────────────────────────────────────────────────────────────────────────────
# ENDPOINT 9 — WHAT-IF SIMULATOR: PREDICTION
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/ml/what-if/predict")
def what_if_predict_endpoint(request: WhatIfRequest):
    """
    Make a single prediction for the What-If Simulator.
    Called every time the user moves a slider on the What-If page.

    The model and scaler paths come from the experiment record in the
    database (saved there by Django after training was complete).

    Loads model + scaler from disk, normalizes the input values,
    and returns the predicted class + confidence percentage.

    Request:  {
        "model_path": "media/models/model_uuid.pkl",
        "scaler_path": "media/models/scaler_uuid.pkl",
        "input_values": {"Glucose": 148, "BMI": 33.6, "Age": 50},
        "feature_names": ["Glucose", "BMI", "Age", ...]
    }
    Response: {
        "prediction_label": "1",
        "confidence": 0.87,
        "class_probabilities": {"0": 0.13, "1": 0.87},
        "input_values": {...}
    }
    """
    try:
        if not os.path.exists(request.model_path):
            raise HTTPException(
                status_code=404,
                detail=f"Model file not found: {request.model_path}"
            )

        result = predict_what_if(
            model_path=    request.model_path,
            scaler_path=   request.scaler_path,
            input_dict=    request.input_values,
            feature_names= request.feature_names,
        )

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"What-If prediction failed: {str(e)}"
        )


# ──────────────────────────────────────────────────────────────────────────────
# ENDPOINT 10 — WHAT-IF SIMULATOR: FEATURE CONTRIBUTIONS
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/ml/what-if/contributions")
def what_if_contributions_endpoint(request: WhatIfRequest):
    """
    Compute how much each feature contributed to a specific prediction.
    Called alongside /ml/what-if/predict to power the contribution chart.

    React renders this as a bar chart or radar chart showing:
    "Glucose contributed 45% to this prediction, BMI contributed 30%..."

    Request:  same format as /ml/what-if/predict
    Response: {"contributions": {"Glucose": 0.45, "BMI": 0.30, "Age": 0.15, ...}}
    """
    try:
        if not os.path.exists(request.model_path):
            raise HTTPException(
                status_code=404,
                detail=f"Model file not found: {request.model_path}"
            )

        # Load model from disk (need the actual model object, not just predictions)
        with open(request.model_path, 'rb') as f:
            model = pickle.load(f)

        contributions = get_feature_contributions(
            model=         model,
            input_dict=    request.input_values,
            feature_names= request.feature_names,
        )

        return {"contributions": contributions}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Feature contributions failed: {str(e)}"
        )
