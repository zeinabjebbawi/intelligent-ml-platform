"""
ML Core — pipelines.py
=======================
Pure orchestration layer. This file does NO machine learning computations.
It calls cleaning.py, models.py, and evaluation.py in the correct sequence
and returns a complete results dict that FastAPI stores in the database.

Sections:
  1. Data Preparation  (3 functions — split_features_target, split_train_test, scale_features)
  2. Step Runner       (1 function — run_cleaning_step for Guided Expert mode)
  3. Pipeline Runners  (2 functions — run_full_pipeline, run_auto_pipeline)
  4. Utilities         (2 functions — generate_pipeline_summary, compare_experiments)

Import strategy:
  Uses try/except to work both as a package (from .cleaning import ...)
  and as standalone files in the same directory (from cleaning import ...).
  This means the files work whether you run them directly during testing
  or import them through the installed ml-core package in FastAPI.
"""

import os
import numpy as np
import pandas as pd

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

# Import from the other ml-core files.
# try/except supports both package usage (FastAPI) and standalone testing.
try:
    from .cleaning import (
        load_data,
        profile_dataset,
        build_auto_clean_config,
        auto_clean,
        encode_categorical_columns,
        normalize_all_numerical,
        fill_missing_with_mean,
        fill_missing_with_median,
        fill_missing_with_constant,
        fill_missing_categorical,
        remove_outliers_iqr,
        remove_outliers_zscore,
        remove_duplicates,
        drop_columns,
    )
    from .models import (
        detect_task_type,
        recommend_models,
        get_model_by_name,
        run_tournament,
        save_model,
        train_knn,
    )
    from .evaluation import (
        evaluate_classification,
        evaluate_regression,
        evaluate_clustering,
        get_elbow_data,
    )
except ImportError:
    from cleaning import (
        load_data,
        profile_dataset,
        build_auto_clean_config,
        auto_clean,
        encode_categorical_columns,
        normalize_all_numerical,
        fill_missing_with_mean,
        fill_missing_with_median,
        fill_missing_with_constant,
        fill_missing_categorical,
        remove_outliers_iqr,
        remove_outliers_zscore,
        remove_duplicates,
        drop_columns,
    )
    from models import (
        detect_task_type,
        recommend_models,
        get_model_by_name,
        run_tournament,
        save_model,
        train_knn,
    )
    from evaluation import (
        evaluate_classification,
        evaluate_regression,
        evaluate_clustering,
        get_elbow_data,
    )


# =============================================================================
# SECTION 1 — DATA PREPARATION
# These three functions are from your course and live here because they are
# part of the pipeline sequence, not standalone cleaning operations.
# =============================================================================

def split_features_target(df, target_column):
    """
    FROM COURSE — unchanged.
    Split a DataFrame into X (all feature columns) and y (target column alone).

    This is always Step 1 of the training sequence (after cleaning and encoding).
    After this split, the target column never appears in X — the model cannot
    "cheat" by reading the answer during training (target leakage prevention).

    Args:
        df:            encoded pandas DataFrame
        target_column: name of the column the model will predict

    Returns:
        X: DataFrame of all columns except target (features)
        y: pandas Series of the target column
    """
    X = df.drop(target_column, axis=1)
    y = df[target_column]
    return X, y


def split_train_test(X, y, test_size=0.4, random_state=42, stratify=None):
    """
    FROM COURSE — minor addition: stratify parameter exposed.
    Split X and y into training and test sets.

    test_size=0.4 means 40% of rows are held back for testing, 60% for training.
    This matches the split ratio used in the course.

    Why random_state=42:
    Ensures reproducibility — running the same pipeline twice always produces
    the same train/test split, the same metrics, the same results.

    Why stratify:
    For classification, pass stratify=y to ensure both the training and test
    sets contain the same class proportions as the full dataset.
    Without stratify, the random split might put 90% of minority-class samples
    in training, leaving the test set with almost no minority-class examples.

    Args:
        X:            features DataFrame
        y:            target Series
        test_size:    fraction of data for testing (default 0.4)
        random_state: seed for reproducibility (default 42)
        stratify:     pass y for classification tasks, None for regression

    Returns:
        X_train, X_test, y_train, y_test (4 arrays)
    """
    return train_test_split(
        X, y,
        test_size=test_size,
        random_state=random_state,
        stratify=stratify
    )


def scale_features(X_train, X_test):
    """
    FROM COURSE — adaptation: also returns the scaler object.

    Apply StandardScaler (Z-score normalization) to feature arrays.
    Fits on X_train ONLY, then transforms both X_train and X_test.

    Why fit on X_train only (the most important ML rule here):
    If you fit the scaler on all data (including X_test), the scaler learns
    statistics (mean, std) that include test data. This is data leakage — the model indirectly "sees" the test set during training, inflating
    accuracy scores. Always fit on training data only.

    Why we return the scaler (the adaptation from the course version):
    The What-If Simulator must use the EXACT SAME scaler used during training.
    When a user types Glucose=148 in the simulator, we need to normalize it
    the same way: (148 - training_mean) / training_std. If the scaler is
    lost, predictions will be wrong. The returned scaler is saved to disk
    by save_model() in models.py.

    Args:
        X_train: training features DataFrame or numpy array
        X_test:  test features DataFrame or numpy array

    Returns:
        X_train_scaled: normalized training array
        X_test_scaled:  normalized test array (same scale as training)
        scaler:         fitted StandardScaler object (save this!)
    """
    scaler          = StandardScaler()
    X_train_scaled  = scaler.fit_transform(X_train)   # fit + transform on train
    X_test_scaled   = scaler.transform(X_test)         # transform only on test
    return X_train_scaled, X_test_scaled, scaler


# =============================================================================
# SECTION 2 — STEP RUNNER (Guided Expert Mode)
# =============================================================================

def run_cleaning_step(df, step_name, config=None):
    """
    NEW: Execute one specific cleaning operation by name.

    This is what Expert/Guided mode uses instead of auto_clean().
    The React UI presents each cleaning recommendation as a card.
    When the user clicks Accept/Modify/Skip for one step, the UI sends
    that decision to FastAPI. FastAPI calls run_cleaning_step() once.

    The key difference from auto_clean():
    - auto_clean() — runs ALL 5 steps automatically (Smart Auto mode)
    - run_cleaning_step() — runs ONE step per user decision (Guided mode)

    The same atomic functions from cleaning.py are called in both cases.
    The difference is in WHO decides what to call and when.

    step_name options and required config keys:

        "fill_mean" — {"column": "Age"}
        "fill_median" — {"column": "Age"}
        "fill_mode" — {"column": "Gender"}
        "fill_constant" — {"column": "Age", "constant": 0}
        "remove_outliers_iqr" — {"column": "BMI"}
        "remove_outliers_zscore" — {"column": "BMI"}
        "remove_duplicates" — {} (no config needed)
        "drop_column" — {"column": "old_id"}
                            OR {"columns": ["col1", "col2"]}
        "encode_categorical" — {} or {"exclude": ["target_col"]}
        "normalize" — {} or {"exclude": ["target_col"]}

    Args:
        df:        current state of the DataFrame (may already have been
                   partially cleaned by previous run_cleaning_step calls)
        step_name: string identifying which operation to run
        config:    dict of parameters for the operation (or None)

    Returns:
        new_df:      the DataFrame after the operation (original unchanged)
        description: human-readable string of what was done
                     e.g. "Filled 12 missing values in 'Age' using mean (31.4)"
        extra:       encoding_map (for encode step), scaler (for normalize step),
                     count_removed (for duplicate removal), or None
    """
    if config is None:
        config = {}

    # ── Fill missing values ──────────────────────────────────────────────────
    if step_name == "fill_mean":
        col    = config["column"]
        val    = round(float(df[col].mean()), 4)
        count  = int(df[col].isna().sum())
        new_df = fill_missing_with_mean(df, col)
        return new_df, f"Filled {count} missing value(s) in '{col}' using mean ({val})", None

    if step_name == "fill_median":
        col    = config["column"]
        val    = round(float(df[col].median()), 4)
        count  = int(df[col].isna().sum())
        new_df = fill_missing_with_median(df, col)
        return new_df, f"Filled {count} missing value(s) in '{col}' using median ({val})", None

    if step_name == "fill_mode":
        col      = config["column"]
        mode_val = df[col].mode().iloc[0] if not df[col].mode().empty else "Unknown"
        count    = int(df[col].isna().sum())
        new_df   = fill_missing_categorical(df, col, strategy='mode')
        return new_df, f"Filled {count} missing value(s) in '{col}' using mode ('{mode_val}')", None

    if step_name == "fill_constant":
        col      = config["column"]
        constant = config.get("constant", 0)
        count    = int(df[col].isna().sum())
        new_df   = fill_missing_with_constant(df, col, constant)
        return new_df, f"Filled {count} missing value(s) in '{col}' with constant ({constant})", None

    # ── Outlier removal ──────────────────────────────────────────────────────
    if step_name == "remove_outliers_iqr":
        col          = config["column"]
        original_len = len(df)
        new_df       = remove_outliers_iqr(df, col)
        removed      = original_len - len(new_df)
        return new_df, f"Removed {removed} outlier(s) from '{col}' using IQR method", None

    if step_name == "remove_outliers_zscore":
        col          = config["column"]
        threshold    = config.get("threshold", 3.0)
        original_len = len(df)
        new_df       = remove_outliers_zscore(df, col, threshold)
        removed      = original_len - len(new_df)
        return new_df, f"Removed {removed} outlier(s) from '{col}' using Z-Score (threshold={threshold})", None

    # ── Structural operations ────────────────────────────────────────────────
    if step_name == "remove_duplicates":
        new_df, count = remove_duplicates(df)
        return new_df, f"Removed {count} duplicate row(s)", None

    if step_name == "drop_column":
        # Accept either "column" (single) or "columns" (list)
        cols   = config.get("columns", [config.get("column")])
        cols   = [c for c in cols if c is not None]
        new_df = drop_columns(df, cols)
        return new_df, f"Dropped column(s): {cols}", None

    # ── Encoding ─────────────────────────────────────────────────────────────
    if step_name == "encode_categorical":
        exclude = config.get("exclude", [])
        new_df, encoding_map = encode_categorical_columns(df, exclude_columns=exclude)
        n_cols = len(encoding_map)
        return new_df, f"Encoded {n_cols} categorical column(s) to integers", encoding_map

    # ── Normalization ────────────────────────────────────────────────────────
    if step_name == "normalize":
        exclude = config.get("exclude", [])
        new_df, scaler = normalize_all_numerical(df, exclude_columns=exclude)
        return new_df, "Applied StandardScaler normalization to all numerical columns", scaler

    # ── Unknown step ─────────────────────────────────────────────────────────
    raise ValueError(
        f"Unknown step_name: '{step_name}'. "
        f"See run_cleaning_step docstring for valid step names."
    )


# =============================================================================
# SECTION 3 — PIPELINE RUNNERS
# =============================================================================

def run_full_pipeline(
    df_path,
    target_column,
    task_type=None,
    algorithm='random_forest',
    test_size=0.4,
    experiment_id='default',
    model_save_dir='media/models/',
    dataset_save_dir=None,
):
    """
    NEW: Run the complete ML pipeline from CSV path to trained model and metrics.
    Called by FastAPI for Guided mode when the user clicks "Run" after
    approving cleaning steps and selecting an algorithm.

    Execution order (guaranteed by sequential Python code):
        1.  load_data(df_path)
        2.  profile_dataset(df, target_column)
        3.  auto_clean(df, profiling_result, target_column) — saves cleaned_v2.csv if dataset_save_dir provided
        4.  encode_categorical_columns(cleaned_df) — saves encoded_v3.csv if dataset_save_dir provided
        5.  detect_task_type(df, target_column)  [if task_type not given]
        6.  split_features_target(df, target_column)
        7.  split_train_test(X, y, test_size, stratify for classification)
        8.  scale_features(X_train, X_test)
        9.  get_elbow_data(...)  [ONLY for algorithm='knn', to find best k]
       10.  train model using get_model_by_name(algorithm)
       11.  evaluate model using evaluate_classification/regression/clustering
       12.  save_model(model, scaler, experiment_id, model_save_dir)

    Args:
        df_path:          full path to the CSV file on disk
        target_column:    name of the column to predict
        task_type:        'classification', 'regression', 'clustering'
                          (pass None to auto-detect)
        algorithm:        algorithm name string or 'tournament' to run all
        test_size:        fraction for test set (default 0.4 = 60/40 split)
        experiment_id:    UUID string for saving model files
        model_save_dir:   directory to save model + scaler .pkl files
        dataset_save_dir: directory to save cleaned/encoded CSV versions
                          (pass None to skip saving intermediate versions)

    Returns:
        results: comprehensive dict with all metrics, paths, summaries,
                 and feature importance — everything FastAPI stores in the DB
    """
    results = {}

    # ── Step 1: Load ─────────────────────────────────────────────────────────
    df = load_data(df_path)

    # ── Step 2: Profile ──────────────────────────────────────────────────────
    profiling_result = profile_dataset(df, target_column)
    results['profiling_result'] = profiling_result
    results['health_score']     = profiling_result.get('health_score', {})

    # ── Step 3: Clean ────────────────────────────────────────────────────────
    cleaned_df, cleaning_summary = auto_clean(df, profiling_result, target_column)
    results['cleaning_summary']  = cleaning_summary

    if dataset_save_dir:
        os.makedirs(dataset_save_dir, exist_ok=True)
        cleaned_path = os.path.join(dataset_save_dir, f'cleaned_{experiment_id}.csv')
        cleaned_df.to_csv(cleaned_path, index=False)
        results['cleaned_dataset_path'] = cleaned_path

    # ── Step 4: Encode categorical columns ──────────────────────────────────
    has_categoricals = not cleaned_df.select_dtypes(include=['object']).empty
    encoding_map     = {}

    if has_categoricals:
        exclude = [target_column] if target_column else []
        cleaned_df, encoding_map = encode_categorical_columns(
            cleaned_df, exclude_columns=exclude
        )
        results['encoding_map'] = encoding_map

        if dataset_save_dir:
            encoded_path = os.path.join(dataset_save_dir, f'encoded_{experiment_id}.csv')
            cleaned_df.to_csv(encoded_path, index=False)
            results['encoded_dataset_path'] = encoded_path

    # ── Step 5: Detect task type ─────────────────────────────────────────────
    if task_type is None:
        task_type = detect_task_type(cleaned_df, target_column)
    results['task_type'] = task_type

    # ── Step 6: Split features and target ────────────────────────────────────
    X, y = split_features_target(cleaned_df, target_column)
    feature_names = list(X.columns)
    results['feature_names'] = feature_names

    # ── Step 7: Train/test split ─────────────────────────────────────────────
    # Use stratify for classification to preserve class balance in both sets
    stratify = y if task_type == 'classification' else None

    if task_type == 'clustering':
        # Clustering uses all data — no concept of a held-out test set
        X_train, X_test, y_train, y_test = X, X, y, y
    else:
        X_train, X_test, y_train, y_test = split_train_test(
            X, y, test_size=test_size, stratify=stratify
        )

    # ── Step 8: Scale features ───────────────────────────────────────────────
    X_train_scaled, X_test_scaled, scaler = scale_features(X_train, X_test)

    # ── Step 9: KNN elbow curve (only when training KNN) ─────────────────────
    elbow_data = None
    best_k     = 5  # default k if elbow is not computed

    if algorithm == 'knn' and task_type == 'classification':
        elbow_data = get_elbow_data(X_train_scaled, X_test_scaled, y_train, y_test)
        best_k     = elbow_data['best_k']
        results['elbow_data'] = elbow_data

    # ── Step 10: Train ───────────────────────────────────────────────────────
    if algorithm == 'tournament':
        # Run all recommended algorithms and return a leaderboard
        recommendations = recommend_models(task_type, profiling_result)
        models_list     = [r['algorithm'] for r in recommendations]

        leaderboard, trained_models = run_tournament(
            models_list, X_train_scaled, X_test_scaled,
            y_train, y_test, task_type
        )
        results['leaderboard']    = leaderboard
        results['recommendations'] = recommendations

        # Use the best-performing model for the evaluation and save
        best_entry    = leaderboard[0]
        model         = trained_models.get(best_entry['algorithm'])
        best_algorithm = best_entry['algorithm']
        results['best_algorithm'] = best_algorithm

    else:
        # Train the specific algorithm the user selected
        best_algorithm = algorithm
        train_fn       = get_model_by_name(algorithm)

        if algorithm == 'knn':
            model = train_fn(X_train_scaled, y_train, k=best_k)
        elif algorithm == 'kmeans':
            n_clusters = 3  # default; could be exposed as a parameter
            model, cluster_labels = train_fn(X_train_scaled, n_clusters=n_clusters)
        else:
            model = train_fn(X_train_scaled, y_train)

    # ── Step 11: Evaluate ────────────────────────────────────────────────────
    if task_type == 'classification':
        metrics = evaluate_classification(
            model, X_test_scaled, y_test, feature_names=feature_names
        )
    elif task_type == 'regression':
        metrics = evaluate_regression(
            model, X_test_scaled, y_test, feature_names=feature_names
        )
    else:
        # Clustering: evaluate using the full dataset
        cluster_labels = model.labels_.tolist()
        metrics        = evaluate_clustering(model, X_train_scaled, cluster_labels)

    results['metrics']           = metrics
    results['feature_importance'] = metrics.get('feature_importance', [])

    # ── Step 12: Save model and scaler ───────────────────────────────────────
    save_paths = save_model(model, scaler, experiment_id, model_save_dir)
    results['model_path']  = save_paths['model_path']
    results['scaler_path'] = save_paths['scaler_path']

    # ── Final summary ────────────────────────────────────────────────────────
    results['algorithm']   = best_algorithm
    results['test_size']   = test_size
    results['n_features']  = len(feature_names)
    results['pipeline_summary'] = generate_pipeline_summary(cleaning_summary)

    return results


def run_auto_pipeline(
    df_path,
    target_column=None,
    experiment_id='default',
    model_save_dir='media/models/',
    dataset_save_dir=None,
):
    """
    NEW: Agent-friendly version of run_full_pipeline.
    Automatically detects task type and runs the Model Tournament.
    Called by FastAPI when the user is in Smart Auto mode.

    The difference from run_full_pipeline:
    - task_type is always auto-detected (never passed in)
    - algorithm is always 'tournament' (all recommended models compete)
    - Also returns agent_decisions list documenting what was auto-decided
      (for the transparency panel shown to the user)

    Args:
        df_path:          path to the CSV file
        target_column:    target column name (can be None for clustering)
        experiment_id:    UUID for file naming
        model_save_dir:   where to save model files
        dataset_save_dir: where to save intermediate CSV versions

    Returns:
        results: same structure as run_full_pipeline, plus:
            - agent_decisions: list of strings describing auto-decisions made
            - recommendations: model recommendations with reasons
    """
    agent_decisions = []

    # Load and profile
    df               = load_data(df_path)
    profiling_result = profile_dataset(df, target_column)
    health_score     = profiling_result.get('health_score', {}).get('overall', 0)

    agent_decisions.append(
        f"Dataset analyzed: {profiling_result['total_rows']} rows, "
        f"{profiling_result['total_columns']} columns. "
        f"Health score: {health_score}/100."
    )

    # Auto-detect task type
    task_type = detect_task_type(df, target_column)
    agent_decisions.append(f"Task type detected: {task_type}.")

    # Get recommendations
    recommendations = recommend_models(task_type, profiling_result)
    top_model       = recommendations[0]['algorithm'] if recommendations else 'random_forest'
    agent_decisions.append(
        f"Top recommended model: {top_model}. "
        f"Reason: {recommendations[0]['reason'] if recommendations else ''}"
    )

    # Run the full pipeline with tournament
    results = run_full_pipeline(
        df_path=df_path,
        target_column=target_column,
        task_type=task_type,
        algorithm='tournament',
        experiment_id=experiment_id,
        model_save_dir=model_save_dir,
        dataset_save_dir=dataset_save_dir,
    )

    # Add auto-pilot decisions to results
    cleaning_steps = results.get('cleaning_summary', [])
    for step in cleaning_steps:
        agent_decisions.append(f"Auto-cleaned: {step}")

    best_algo = results.get('best_algorithm', 'unknown')
    agent_decisions.append(
        f"Best model after tournament: {best_algo} "
        f"(primary score: {results.get('leaderboard', [{}])[0].get('primary_score', 0)})."
    )

    results['agent_decisions']  = agent_decisions
    results['recommendations']  = recommendations

    return results


# =============================================================================
# SECTION 4 — UTILITIES
# =============================================================================

def generate_pipeline_summary(steps_applied):
    """
    NEW: Convert the list of cleaning step descriptions into a structured
    summary dict that the transparency panel shows to the user.

    This is the "What did the system do and why?" panel in Smart Auto mode.
    It turns a list like:
        ["Removed 3 duplicate rows", "Filled 12 missing in Age using mean"]
    into a structured summary the UI can render clearly.

    Args:
        steps_applied: list of description strings (from auto_clean summary)

    Returns:
        dict: {
            "steps_count": 3,
            "steps": [...],
            "summary_text": "3 cleaning operations were applied..."
        }
    """
    steps_count = len(steps_applied)

    if steps_count == 0:
        summary_text = "No cleaning operations were needed. Dataset was already clean."
    elif steps_count == 1:
        summary_text = f"1 cleaning operation was applied to prepare the dataset."
    else:
        summary_text = f"{steps_count} cleaning operations were applied to prepare the dataset."

    return {
        "steps_count":  steps_count,
        "steps":        steps_applied,
        "summary_text": summary_text,
    }


def compare_experiments(experiment_list):
    """
    NEW: Compare multiple experiment results side by side.
    Used when the user has run several experiments and wants to see
    how different algorithms or preprocessing choices affected performance.

    Args:
        experiment_list: list of result dicts (each from run_full_pipeline)

    Returns:
        comparison dict:
        {
          "algorithms":   ["random_forest", "decision_tree", ...],
          "metric_name":  "accuracy",              (primary metric label)
          "scores":       [0.91, 0.87, 0.84, ...], (primary metric per experiment)
          "full_metrics": [{...}, {...}, ...],      (all metrics per experiment)
          "best_algorithm": "random_forest",
          "best_score":     0.91
        }
    """
    if not experiment_list:
        return {}

    # Determine primary metric name from task_type
    first_metrics = experiment_list[0].get('metrics', {})
    task_type     = first_metrics.get('task_type', 'classification')

    if task_type == 'classification':
        metric_name = 'accuracy'
    elif task_type == 'regression':
        metric_name = 'r2'
    else:
        metric_name = 'silhouette_score'

    algorithms  = []
    scores      = []
    full_metrics = []

    for exp in experiment_list:
        algo    = exp.get('algorithm', 'unknown')
        metrics = exp.get('metrics', {})
        score   = metrics.get(metric_name, 0.0)

        algorithms.append(str(algo))
        scores.append(round(float(score), 4))
        full_metrics.append(metrics)

    # Find best
    best_idx       = int(np.argmax(scores)) if scores else 0
    best_algorithm = algorithms[best_idx] if algorithms else 'none'
    best_score     = scores[best_idx] if scores else 0.0

    return {
        "algorithms":    algorithms,
        "metric_name":   metric_name,
        "scores":        scores,
        "full_metrics":  full_metrics,
        "best_algorithm": best_algorithm,
        "best_score":    best_score,
    }
