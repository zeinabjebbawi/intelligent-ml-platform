"""
ML Core — evaluation.py
========================
All model evaluation, metric computation, explainability, and What-If Simulator functions.

Sections:
  1. Classification Metrics  (1 function — evaluate_classification)
  2. Regression Metrics      (1 function — evaluate_regression)
  3. Clustering Metrics      (1 function — evaluate_clustering)
  4. Metric Helpers          (3 functions — from course: get_precision, get_recall, get_f1)
  5. Explainability          (2 functions — get_feature_importance, get_elbow_data)
  6. What-If Simulator       (2 functions — predict_what_if, get_feature_contributions)

Key rule for this entire file:
  NEVER use plt.show() or print().
  Every function returns a JSON-serializable dict.
  React renders all charts from the data returned here.
"""

import os
import pickle
import numpy as np
import pandas as pd

from sklearn.neighbors import KNeighborsClassifier  # used in get_elbow_data
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
    classification_report,
    mean_squared_error,
    mean_absolute_error,
    r2_score,
    silhouette_score,
)


# =============================================================================
# SECTION 1 — CLASSIFICATION METRICS
# =============================================================================

def evaluate_classification(model, X_test, y_test, feature_names=None):
    """
    ADAPTED from course's evaluate_model() — same metrics, completely different output.

    The course version used plt.show() to render a confusion matrix heatmap
    and print() to output metrics to the terminal. Neither works in a web API.

    This version:
    - Returns a complete metrics dict (JSON-serializable)
    - Confusion matrix returned as a list of lists (React renders the heatmap)
    - Classification report returned as a dict (React renders the per-class table)
    - Feature importance included if the model supports it

    This dict is stored in Experiment.metrics (JSONB in PostgreSQL) and
    sent to React to render the entire Results page.

    Args:
        model:         fitted sklearn classifier
        X_test:        scaled test features (numpy array)
        y_test:        test labels (numpy array or pandas Series)
        feature_names: list of feature column names (for feature importance)
                       pass None to skip feature importance

    Returns:
        dict with all classification metrics and charts data
    """
    # Convert y_test to numpy array for consistent handling
    y_test_arr = np.array(y_test)
    y_pred     = model.predict(X_test)

    # ── Core metrics (same as course, but returned not printed) ──────────────
    accuracy  = round(float(accuracy_score(y_test_arr, y_pred)), 4)
    precision = round(float(precision_score(
        y_test_arr, y_pred, average='weighted', zero_division=0
    )), 4)
    recall    = round(float(recall_score(
        y_test_arr, y_pred, average='weighted', zero_division=0
    )), 4)
    f1        = round(float(f1_score(
        y_test_arr, y_pred, average='weighted', zero_division=0
    )), 4)

    # ── Confusion matrix ─────────────────────────────────────────────────────
    # The course rendered this as a sns.heatmap.
    # Here we return it as a 2D list — React renders the colored grid.
    # Example: [[45, 3], [7, 25]] — React makes a 2x2 color grid
    cm      = confusion_matrix(y_test_arr, y_pred)
    cm_list = cm.tolist()  # convert numpy 2D array — plain Python list

    # ── Per-class classification report ──────────────────────────────────────
    # The course used print(classification_report(...)).
    # output_dict=True returns it as a Python dict instead of a formatted string.
    report      = classification_report(
        y_test_arr, y_pred, output_dict=True, zero_division=0
    )
    # Round all values and ensure JSON serialization
    clean_report = {}
    for key, value in report.items():
        if isinstance(value, dict):
            clean_report[str(key)] = {k: round(float(v), 4) for k, v in value.items()}
        else:
            clean_report[str(key)] = round(float(value), 4)

    # ── Feature importance ───────────────────────────────────────────────────
    feature_importance = []
    if feature_names is not None:
        feature_importance = get_feature_importance(model, feature_names)

    # ── Unique class labels (for confusion matrix axis labels in React) ───────
    unique_classes = sorted(list(set(y_test_arr.tolist())))

    return {
        "task_type":              "classification",
        "accuracy":               accuracy,
        "precision":              precision,
        "recall":                 recall,
        "f1_score":               f1,
        "confusion_matrix":       cm_list,
        "class_labels":           [str(c) for c in unique_classes],
        "classification_report":  clean_report,
        "feature_importance":     feature_importance,
        "predictions":            y_pred.tolist(),
        "true_labels":            y_test_arr.tolist(),
    }


# =============================================================================
# SECTION 2 — REGRESSION METRICS
# =============================================================================

def evaluate_regression(model, X_test, y_test, feature_names=None):
    """
    NEW — not in course.
    Evaluate a regression model and return all metrics as a dict.

    Metrics explained simply:

    R² (R-squared):
        How much of the variance in y the model explains.
        1.0 = perfect predictions.
        0.0 = model is no better than always predicting the mean of y.
        Negative = model is actively wrong (worse than predicting the mean).

    RMSE (Root Mean Squared Error):
        Average prediction error in the same units as the target.
        e.g. if predicting house prices, RMSE = 25000 means the model is off
        by $25,000 on average. Lower is better. Penalizes large errors heavily.

    MAE (Mean Absolute Error):
        Average absolute difference between predictions and actual values.
        Less sensitive to outliers than RMSE. Lower is better.

    Args:
        model:         fitted sklearn regressor
        X_test:        scaled test features
        y_test:        continuous numerical test targets
        feature_names: list of feature names (for feature importance)

    Returns:
        dict with regression metrics and predictions
    """
    y_test_arr = np.array(y_test)
    y_pred     = model.predict(X_test)

    r2   = round(float(r2_score(y_test_arr, y_pred)), 4)
    rmse = round(float(np.sqrt(mean_squared_error(y_test_arr, y_pred))), 4)
    mae  = round(float(mean_absolute_error(y_test_arr, y_pred)), 4)

    # Feature importance for tree-based regressors (if available)
    feature_importance = []
    if feature_names is not None:
        feature_importance = get_feature_importance(model, feature_names)

    return {
        "task_type":          "regression",
        "r2":                 r2,
        "rmse":               rmse,
        "mae":                mae,
        "feature_importance": feature_importance,
        "predictions":        y_pred.tolist(),
        "true_values":        y_test_arr.tolist(),
    }


# =============================================================================
# SECTION 3 — CLUSTERING METRICS
# =============================================================================

def evaluate_clustering(model, X, cluster_labels):
    """
    NEW — not in course.
    Evaluate a clustering result using Silhouette Score and cluster statistics.

    Silhouette Score measures how well-separated the clusters are.
    Range: -1 to +1.
        +1: clusters are dense and well-separated (best case)
         0: clusters are overlapping (unclear separation)
        -1: data points are likely assigned to the wrong cluster

    Inertia: sum of squared distances from each point to its cluster centroid.
    Lower inertia = tighter, more compact clusters. Used for the Elbow Method
    when selecting the number of clusters k.

    Args:
        model:          fitted KMeans model
        X:              the feature array used for training (numpy array)
        cluster_labels: list of cluster IDs, one per row (from train_kmeans)

    Returns:
        dict with silhouette score, cluster sizes, and inertia
    """
    labels_array      = np.array(cluster_labels)
    n_unique_clusters = len(set(cluster_labels))

    # Silhouette score requires at least 2 clusters and more samples than clusters
    silhouette = None
    if n_unique_clusters >= 2 and len(X) > n_unique_clusters:
        try:
            silhouette = round(float(silhouette_score(X, labels_array)), 4)
        except Exception:
            silhouette = None

    # Count how many rows belong to each cluster
    cluster_sizes = {}
    for label in cluster_labels:
        key = str(label)
        cluster_sizes[key] = cluster_sizes.get(key, 0) + 1

    # Inertia (within-cluster sum of squares) from the KMeans model
    inertia = None
    if hasattr(model, 'inertia_'):
        inertia = round(float(model.inertia_), 4)

    return {
        "task_type":        "clustering",
        "silhouette_score": silhouette,
        "cluster_sizes":    cluster_sizes,
        "n_clusters":       int(n_unique_clusters),
        "inertia":          inertia,
        "cluster_labels":   cluster_labels,
    }


# =============================================================================
# SECTION 4 — METRIC HELPERS (from course)
# These three are preserved exactly from the course with one minor change:
# average='weighted' is added so they work correctly for multi-class tasks.
# The course version used the binary default, which raises a warning on
# datasets with more than 2 classes (e.g. Iris with 3 species).
# =============================================================================

def get_precision(y_test, y_pred, average='weighted'):
    """
    FROM COURSE — minor adaptation: added average='weighted' parameter.
    Return weighted precision score. Works for binary and multi-class tasks.

    Precision = true positives / (true positives + false positives)
    "Of all the samples we predicted as positive, how many were actually positive?"

    average='weighted': accounts for class imbalance by weighting each class
    by its number of samples. This is the most appropriate default for
    imbalanced real-world datasets.
    """
    return precision_score(y_test, y_pred, average=average, zero_division=0)


def get_recall(y_test, y_pred, average='weighted'):
    """
    FROM COURSE — minor adaptation: added average='weighted' parameter.
    Return weighted recall score.

    Recall = true positives / (true positives + false negatives)
    "Of all the samples that were actually positive, how many did we find?"

    In medical contexts (e.g. diabetes detection), recall is often more
    important than precision — missing a sick patient is worse than a
    false alarm.
    """
    return recall_score(y_test, y_pred, average=average, zero_division=0)


def get_f1(y_test, y_pred, average='weighted'):
    """
    FROM COURSE — minor adaptation: added average='weighted' parameter.
    Return weighted F1 score.

    F1 = 2 × (precision × recall) / (precision + recall)
    The harmonic mean of precision and recall. Best single metric when
    you need to balance both and the classes are imbalanced.
    """
    return f1_score(y_test, y_pred, average=average, zero_division=0)


# =============================================================================
# SECTION 5 — EXPLAINABILITY
# =============================================================================

def get_feature_importance(model, feature_names):
    """
    NEW: Extract feature importance scores from tree-based models.

    Works for:    DecisionTreeClassifier, RandomForestClassifier,
                  DecisionTreeRegressor, RandomForestRegressor
                  (any model with .feature_importances_ attribute)

    Returns empty list for: KNN, SVM, Logistic Regression, Linear Regression
    (these models do not provide feature_importances_)

    For Random Forest, importances are averaged across all trees — this is
    more reliable than a single Decision Tree's importances.

    The returned list is sorted highest-to-lowest so React can render the
    bar chart immediately without resorting.

    The importances sum to 1.0 (they represent proportional contribution).

    Args:
        model:         fitted sklearn model
        feature_names: list of feature column name strings

    Returns:
        list of dicts sorted by importance, e.g.:
        [
            {"feature": "Glucose",    "importance": 0.312},
            {"feature": "BMI",        "importance": 0.198},
            {"feature": "Age",        "importance": 0.145},
            ...
        ]
        Returns empty list [] if model has no feature_importances_.
    """
    if not hasattr(model, 'feature_importances_'):
        return []

    importances = model.feature_importances_

    # Zip each feature name with its importance score and sort descending
    result = [
        {
            "feature":    str(name),
            "importance": round(float(score), 6)
        }
        for name, score in zip(feature_names, importances)
    ]

    result.sort(key=lambda x: x["importance"], reverse=True)
    return result


def get_elbow_data(X_train, X_test, y_train, y_test, k_range=range(1, 28)):
    """
    ADAPTED from course's find_best_k() — identical logic, no plt.show().

    The course version:
        for k in neighbors:
            knn.fit(X_train, y_train)
            test_accuracy[i] = knn.score(X_test, y_test)
        plt.plot(neighbors, accuracies) — renders chart to screen
        plt.show() — crashes in a web server

    This version:
        Same loop — returns {k_values, accuracies, best_k} as a dict
        React uses this data to render the Elbow Curve chart in the browser.

    The Elbow Curve shows accuracy for each k from 1 to 27.
    The "elbow" point where accuracy stops improving is the optimal k.
    This function finds that best k automatically (numpy argmax).

    Args:
        X_train, X_test:  scaled feature arrays
        y_train, y_test:  label arrays
        k_range:          range of k values to test (default: 1 to 27)

    Returns:
        dict: {
            "k_values":      [1, 2, 3, ..., 27],
            "accuracies":    [0.72, 0.75, 0.81, ..., 0.79],
            "best_k":        7,
            "best_accuracy": 0.84
        }
    """
    k_values   = list(k_range)
    accuracies = []

    # This is the exact same loop from the course
    for k in k_values:
        knn = KNeighborsClassifier(n_neighbors=k)
        knn.fit(X_train, y_train)
        acc = knn.score(X_test, y_test)
        accuracies.append(round(float(acc), 4))

    best_k   = int(k_values[int(np.argmax(accuracies))])
    best_acc = round(float(max(accuracies)), 4)

    return {
        "k_values":      k_values,
        "accuracies":    accuracies,
        "best_k":        best_k,
        "best_accuracy": best_acc,
    }


# =============================================================================
# SECTION 6 — WHAT-IF SIMULATOR
# =============================================================================

def predict_what_if(model_path, scaler_path, input_dict, feature_names):
    """
    NEW: Make a single prediction for the What-If Simulator.

    This function is called every time the user moves a slider in the
    What-If Simulator UI. It must be fast (< 500ms) because it runs
    on every interaction.

    Execution steps:
    1. Load model from disk using pickle
    2. Load scaler from disk (same scaler that was fit on X_train during training)
    3. Build input array from the slider values in the correct feature order
    4. Normalize the input values using the loaded scaler
       (CRITICAL: must use the same scaler, otherwise predictions are wrong)
    5. Call model.predict() — get predicted class label
    6. Call model.predict_proba() — get confidence percentage
    7. Return prediction + confidence

    Args:
        model_path:    full path to the saved model .pkl file
        scaler_path:   full path to the saved scaler .pkl file
                       (pass None if no scaling was used during training)
        input_dict:    {feature_name: value} from the UI sliders
                       e.g. {"Glucose": 148, "BMI": 33.6, "Age": 50}
        feature_names: ordered list of feature names matching training order

    Returns:
        dict: {
            "prediction_label":    "1",         (the predicted class)
            "confidence":          0.87,        (probability of predicted class)
            "class_probabilities": {"0": 0.13, "1": 0.87},
            "input_values":        {...}         (the slider values echoed back)
        }
    """
    # Load model from disk
    with open(model_path, 'rb') as f:
        model = pickle.load(f)

    # Load scaler from disk
    scaler = None
    if scaler_path and os.path.exists(scaler_path):
        with open(scaler_path, 'rb') as f:
            scaler = pickle.load(f)

    # Build input array in the EXACT feature order used during training
    # Missing features default to 0 (should not happen in a well-designed UI)
    input_array = np.array([[float(input_dict.get(feat, 0)) for feat in feature_names]])

    # Apply the same scaling used during training
    if scaler is not None:
        input_array_scaled = scaler.transform(input_array)
    else:
        input_array_scaled = input_array

    # Get predicted class
    prediction = model.predict(input_array_scaled)[0]

    # Get class probabilities (confidence) if available
    confidence          = None
    class_probabilities = {}

    if hasattr(model, 'predict_proba'):
        proba   = model.predict_proba(input_array_scaled)[0]
        classes = model.classes_
        class_probabilities = {
            str(cls): round(float(p), 4)
            for cls, p in zip(classes, proba)
        }
        confidence = round(float(max(proba)), 4)

    return {
        "prediction_label":    str(prediction),
        "confidence":          confidence,
        "class_probabilities": class_probabilities,
        "input_values":        input_dict,
    }


def get_feature_contributions(model, input_dict, feature_names):
    """
    NEW: Compute how much each feature contributed to one specific prediction.

    Used by the What-If Simulator to render the contribution chart:
    "Glucose contributed 45% to this prediction, BMI contributed 30%..."

    Method (simple approximation, not SHAP):
        contribution = feature_importance × normalized_absolute_feature_value

    This is a readable approximation that combines:
    - The model's global understanding of each feature's importance
    - The relative magnitude of this specific prediction's feature values

    A more advanced implementation would use SHAP values, but this approach
    is understandable, fast, and sufficient for the capstone's educational goal.

    Falls back to equal contributions for models without feature_importances_
    (KNN, SVM, Logistic Regression).

    Args:
        model:         fitted sklearn model (loaded in memory, not path)
        input_dict:    {feature_name: value} from the UI sliders
        feature_names: ordered list of feature names

    Returns:
        dict: {feature_name: contribution_percentage}
        e.g. {"Glucose": 0.45, "BMI": 0.30, "Age": 0.15, "Insulin": 0.10}
        Values sum to approximately 1.0 (they are proportional contributions).
    """
    input_values = np.array([float(input_dict.get(feat, 0)) for feat in feature_names])

    if hasattr(model, 'feature_importances_'):
        importances = model.feature_importances_

        # Normalize input values to [0, 1] so they act as relative magnitudes
        abs_values = np.abs(input_values)
        total      = abs_values.sum()
        if total > 0:
            norm_values = abs_values / total
        else:
            norm_values = np.ones(len(input_values)) / len(input_values)

        # Combined contribution = importance × relative magnitude
        raw_contributions = importances * norm_values

        # Normalize to sum to 1 for percentage display
        total_contribution = raw_contributions.sum()
        if total_contribution > 0:
            contributions = raw_contributions / total_contribution
        else:
            contributions = np.ones(len(feature_names)) / len(feature_names)

    else:
        # Models without feature_importances_: equal contribution to all features
        contributions = np.ones(len(feature_names)) / len(feature_names)

    result = {
        str(feat): round(float(contrib), 6)
        for feat, contrib in zip(feature_names, contributions)
    }

    return result
