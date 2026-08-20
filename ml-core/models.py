"""
ML Core — models.py
====================
All model training, intelligent selection, tournament, and persistence functions.

Sections:
  1. Classification Training  (6 functions — KNN, DT, RF, LR, SVM + knn_accuracy)
  2. Regression Training      (1 function — Linear Regression)
  3. Clustering Training      (1 function — K-Means)
  4. Intelligent Selection    (3 functions — detect_task_type, recommend_models, get_model_by_name)
  5. Tournament               (1 function — run_tournament)
  6. Persistence              (2 functions — save_model, load_model)

Coding rules (same as cleaning.py):
  - No plt.show(), no print() statements anywhere
  - All numeric outputs explicitly cast to float/int for JSON serialization
  - random_state=42 on every stochastic algorithm for reproducibility
  - Every function returns something useful — no void functions
"""

import os
import pickle
import numpy as np
import pandas as pd

from sklearn.neighbors import KNeighborsClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.svm import SVC
from sklearn.cluster import KMeans
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    mean_squared_error,
    mean_absolute_error,
    r2_score,
)


# =============================================================================
# SECTION 1 — CLASSIFICATION TRAINING
# knn_accuracy, train_knn, train_decision_tree, train_svm: from your course.
# train_random_forest, train_logistic_regression: new.
# =============================================================================

def knn_accuracy(X_train, X_test, y_train, y_test, k):
    """
    FROM COURSE — unchanged.
    Train KNN with k neighbors and return its test accuracy as a float.

    This is a helper function used inside evaluation.get_elbow_data() to test
    multiple k values and find the best one using the Elbow Method.
    It is NOT the main training function — use train_knn() for that.

    Args:
        X_train:  scaled training features (numpy array)
        X_test:   scaled test features (numpy array)
        y_train:  training labels
        y_test:   test labels
        k:        number of neighbors to use

    Returns:
        accuracy: float between 0.0 and 1.0
    """
    knn = KNeighborsClassifier(n_neighbors=k)
    knn.fit(X_train, y_train)
    return knn.score(X_test, y_test)


def train_knn(X_train, y_train, k=5):
    """
    FROM COURSE — unchanged.
    Train and return a K-Nearest Neighbors (KNN) classifier.

    How KNN works:
    To classify a new data point, find the k closest points in the training set
    (using Euclidean distance on the scaled features) and take a majority vote
    of their labels. There is no explicit "training" — the entire training set
    IS the model. This means KNN is slow to predict on large datasets.

    Why scaling matters for KNN:
    KNN uses Euclidean distance. If Age is in range 18-90 and Glucose is 40-200,
    Glucose differences dominate the distance calculation unfairly.
    scale_features() in pipelines.py ensures fair distance computation.

    Args:
        X_train:  scaled training features
        y_train:  training labels
        k:        number of neighbors (default 5)
                  Use evaluation.get_elbow_data() to find the optimal k.

    Returns:
        fitted KNeighborsClassifier
    """
    knn = KNeighborsClassifier(n_neighbors=k)
    knn.fit(X_train, y_train)
    return knn


def train_decision_tree(X_train, y_train, criterion='entropy'):
    """
    FROM COURSE — unchanged.
    Train and return a Decision Tree classifier.

    How Decision Tree works:
    Recursively splits the data by asking yes/no questions about feature values.
    At each node, it picks the split that most reduces impurity (disorder).
    criterion='entropy' measures impurity using Information Gain.
    criterion='gini' uses the Gini Impurity index. Both produce similar trees.

    Key advantage over other models:
    Every prediction can be explained step by step by following the branches.
    "BMI > 30? Yes → Glucose > 120? Yes → Predict: Diabetic"
    This makes it the most interpretable algorithm in the system.

    Also provides .feature_importances_ which evaluation.py uses to generate
    the Feature Importance bar chart and the top-feature Insight Cards.

    Args:
        X_train:   scaled training features
        y_train:   training labels
        criterion: 'entropy' (information gain) or 'gini' (default: 'entropy')

    Returns:
        fitted DecisionTreeClassifier
    """
    model = DecisionTreeClassifier(criterion=criterion, random_state=42)
    model.fit(X_train, y_train)
    return model


def train_random_forest(X_train, y_train, n_estimators=100):
    """
    NEW — not in course.
    Train and return a Random Forest classifier.

    How Random Forest works:
    Builds n_estimators Decision Trees. Each tree is trained on a different
    random sample of the data (bootstrap sampling) and uses a random subset
    of features at each split. Final prediction = majority vote across all trees.
    This technique is called Bagging (Bootstrap Aggregating).

    Why Random Forest usually wins the Model Tournament:
    - A single Decision Tree memorizes training data (overfitting)
    - Random Forest combines many imperfect trees — robust, generalized model
    - Handles missing patterns, outliers, and mixed feature types naturally
    - Provides the most reliable .feature_importances_ (averaged across all trees)

    n_estimators=100 is a good default. More trees = more stable but slower.

    Args:
        X_train:       scaled training features
        y_train:       training labels
        n_estimators:  number of Decision Trees to build (default 100)

    Returns:
        fitted RandomForestClassifier
    """
    model = RandomForestClassifier(n_estimators=n_estimators, random_state=42)
    model.fit(X_train, y_train)
    return model


def train_logistic_regression(X_train, y_train):
    """
    NEW — not in course.
    Train and return a Logistic Regression classifier.

    Despite the name, Logistic Regression is a CLASSIFIER, not a regressor.
    It predicts the probability of class membership using the sigmoid function:
    P(class=1) = 1 / (1 + e^(-z))   where z = w1*x1 + w2*x2 + ... + bias

    Best for: binary classification with approximately linearly separable classes.
    Also works for multi-class via one-vs-rest internally.

    Advantages: fast to train, highly interpretable (each feature has a weight
    showing its contribution), good baseline for any classification problem.

    max_iter=1000: the default (100) often raises ConvergenceWarning on real
    datasets. Setting this higher prevents the warning without affecting results.

    Args:
        X_train: scaled training features
        y_train: training labels (binary or multi-class)

    Returns:
        fitted LogisticRegression
    """
    model = LogisticRegression(max_iter=1000, random_state=42)
    model.fit(X_train, y_train)
    return model


def train_svm(X_train, y_train, kernel='linear'):
    """
    FROM COURSE — adapted: added probability=True.

    Train and return an SVM (Support Vector Machine) classifier.

    How SVM works:
    Finds the hyperplane that maximally separates the classes with the
    widest possible margin. The support vectors are the closest data points
    to the boundary — they define the margin.

    kernel='linear': linear decision boundary (fast, good for high-dimensional data)
    kernel='rbf':    maps to higher dimensions for non-linear boundaries (slower)

    Why probability=True (the adaptation from course version):
    The course version did not set this. Without it, SVC.predict_proba() fails.
    The What-If Simulator needs predict_proba() to show confidence percentages.
    Setting probability=True uses Platt scaling internally (slightly slower training).

    Warning: SVM is slow on large datasets. For datasets > 10,000 rows,
    consider using Random Forest or Logistic Regression instead.

    Args:
        X_train: scaled training features
        y_train: training labels
        kernel:  'linear' or 'rbf' (default: 'linear')

    Returns:
        fitted SVC (Support Vector Classifier)
    """
    model = SVC(kernel=kernel, probability=True, random_state=42)
    model.fit(X_train, y_train)
    return model


# =============================================================================
# SECTION 2 — REGRESSION TRAINING
# =============================================================================

def train_linear_regression(X_train, y_train):
    """
    NEW — not in course.
    Train and return a Linear Regression model for predicting continuous values.

    How it works:
    Finds the best-fit hyperplane through the training data that minimizes
    the sum of squared errors between predictions and actual values.
    Formula: ŷ = w1*x1 + w2*x2 + ... + wn*xn + bias
    Weights (w1, w2, ...) are the "coefficients" — each shows the contribution
    of one feature to the prediction.

    Used when: the target is a continuous number.
    Examples: house price, salary, temperature, exam score, readmission risk.

    Not in your course file — the course only covered classification algorithms.

    Args:
        X_train: scaled training features (numpy array)
        y_train: continuous numerical target values

    Returns:
        fitted LinearRegression
    """
    model = LinearRegression()
    model.fit(X_train, y_train)
    return model


# =============================================================================
# SECTION 3 — CLUSTERING TRAINING
# =============================================================================

def train_kmeans(X, n_clusters=3):
    """
    NEW — not in course.
    Train a K-Means clustering model. No target column needed.

    How K-Means works:
    1. Randomly place k centroid points in the feature space
    2. Assign each row to the nearest centroid (Euclidean distance)
    3. Move each centroid to the mean position of its assigned rows
    4. Repeat steps 2-3 until assignments no longer change (convergence)

    The result: k groups where rows within each group are more similar
    to each other than to rows in other groups.

    Used when: the user selects "Discover hidden groups" as their goal
    (no target column is known or desired).

    Returns BOTH the model AND the cluster labels because:
    - Labels are needed for visualization (color each row by cluster)
    - Labels are needed for silhouette score in evaluation.py
    - Labels must be stored in the database as part of the experiment

    n_init='auto': prevents a DeprecationWarning in sklearn >= 1.4
    where the default n_init will change from 10 to 'auto'.

    Args:
        X:          feature array (NOT scaled individually — pass X_train_scaled)
        n_clusters: number of clusters to discover (default 3)

    Returns:
        model:          fitted KMeans
        cluster_labels: list of int — one cluster ID per row
    """
    model = KMeans(n_clusters=n_clusters, random_state=42, n_init='auto')
    model.fit(X)
    cluster_labels = model.labels_.tolist()  # .tolist() — JSON-serializable
    return model, cluster_labels


# =============================================================================
# SECTION 4 — INTELLIGENT SELECTION
# These 3 functions decide WHAT to train, not HOW.
# They are the "intelligence layer" that enables Auto Goal Detection,
# the Model Recommendation panel, and the agent's decision-making.
# =============================================================================

def detect_task_type(df, target_column):
    """
    NEW: Automatically detect whether the ML task is classification,
    regression, or clustering by inspecting the target column.

    Decision rules (heuristic — works correctly for most real datasets):

    Rule 1 — Clustering:
        If target_column is None or not in the DataFrame → clustering
        (no target = unsupervised task by definition)

    Rule 2 — Classification:
        If target column is text, boolean, or categorical → classification
        e.g. "Diabetic"/"Not Diabetic", "Yes"/"No", "Spam"/"Ham"

    Rule 3 — Classification vs Regression (for numerical targets):
        If target is numerical with ≤ 20 unique values AND those values
        represent ≤ 10% of total rows — classification
        e.g. Outcome: [0, 1] → 2 unique values → classification

        Otherwise (many unique continuous values) → regression
        e.g. HousePrice: 150000, 275000, 380000, ... → regression

    Rule 4 — Fallback:
        Everything else → clustering

    This function powers the "Auto Goal Detection" feature on the UI
    that detects and suggests the task type before the user manually selects.

    Args:
        df:            pandas DataFrame (should be the encoded version)
        target_column: name of the target column (string) or None

    Returns:
        task_type: 'classification', 'regression', or 'clustering'
    """
    if target_column is None or target_column not in df.columns:
        return 'clustering'

    target = df[target_column].dropna()
    unique_count = target.nunique()
    total_count  = len(target)

    # Text or boolean → always classification
    is_categorical = (
        pd.api.types.is_object_dtype(target) or
        pd.api.types.is_bool_dtype(target)
    )
    if is_categorical:
        return 'classification'

    # Numerical: few unique values relative to total → class labels, not continuous
    if pd.api.types.is_numeric_dtype(target):
        is_discrete_class = (
            unique_count <= 20 and
            unique_count <= (total_count * 0.10)
        )
        return 'classification' if is_discrete_class else 'regression'

    return 'clustering'


def recommend_models(task_type, profiling_result):
    """
    NEW: Return a ranked list of recommended algorithms for the detected task,
    each with a plain-language reason explaining why it is suggested.

    This is what powers the Model Recommendation panel on the UI.
    The user (expert or beginner) sees the recommendation and the reasoning — not just a list of algorithm names — before selecting which one to train.

    The recommendations are ranked by general suitability, with dataset-specific
    adjustments (e.g. KNN is not recommended for large datasets).

    Args:
        task_type:        'classification', 'regression', or 'clustering'
        profiling_result: the profiling dict from cleaning.profile_dataset()

    Returns:
        recommendations: list of dicts, sorted by rank (1 = best), each with:
            - algorithm: string name (compatible with get_model_by_name)
            - rank:      integer starting at 1
            - reason:    plain-language explanation for the user
    """
    recommendations = []
    total_rows      = profiling_result.get('total_rows', 0)

    if task_type == 'classification':

        recommendations.append({
            "algorithm": "random_forest",
            "rank": 1,
            "reason": (
                "Best general-purpose choice for classification. "
                "Handles mixed feature types, is robust to outliers, and rarely overfits. "
                "Provides reliable feature importance scores for the Insight Cards."
            )
        })

        recommendations.append({
            "algorithm": "decision_tree",
            "rank": 2,
            "reason": (
                "Fully explainable — every prediction can be traced step by step. "
                "Ideal when you need to understand exactly why the model made each decision."
            )
        })

        recommendations.append({
            "algorithm": "logistic_regression",
            "rank": 3,
            "reason": (
                "Fast, simple, and interpretable baseline. "
                "Works best when the relationship between features and target is "
                "approximately linear. Good starting point for comparison."
            )
        })

        # KNN is impractical on large datasets (slow prediction)
        if total_rows <= 5000:
            recommendations.append({
                "algorithm": "knn",
                "rank": 4,
                "reason": (
                    f"Suitable for this dataset size ({total_rows} rows). "
                    "Works well when similar data points should have similar labels. "
                    "Performance degrades on large datasets — avoid above 5,000 rows."
                )
            })

        # SVM can be slow — warn for larger datasets
        if total_rows <= 10000:
            recommendations.append({
                "algorithm": "svm",
                "rank": 5,
                "reason": (
                    "Powerful when classes have a clear separation boundary. "
                    "Can be slow to train — suitable for moderate-sized datasets only."
                )
            })

    elif task_type == 'regression':

        recommendations.append({
            "algorithm": "linear_regression",
            "rank": 1,
            "reason": (
                "Always start here for regression tasks. "
                "Fast, highly interpretable, and works well when the relationship "
                "between features and target is approximately linear."
            )
        })

    elif task_type == 'clustering':

        recommendations.append({
            "algorithm": "kmeans",
            "rank": 1,
            "reason": (
                "Standard algorithm for discovering hidden groups in unlabeled data. "
                "Works best when clusters are roughly equal in size and spherical in shape."
            )
        })

    return recommendations


def get_model_by_name(algorithm_name):
    """
    NEW: Factory function — given an algorithm name string, return the
    corresponding training function as a callable.

    This is how the agent and the tournament system call training functions
    without a long if-else chain. The pipeline passes algorithm names as
    strings from the database or from the UI; this function resolves them.

    Example usage:
        train_fn = get_model_by_name("random_forest")
        model = train_fn(X_train, y_train)

        # Or for KNN which needs a k argument:
        train_fn = get_model_by_name("knn")
        model = train_fn(X_train, y_train, k=7)

    Args:
        algorithm_name: case-insensitive string

    Returns:
        training function (Python callable)

    Raises:
        ValueError if algorithm_name is not recognized
    """
    model_registry = {
        "knn":                  train_knn,
        "decision_tree":        train_decision_tree,
        "random_forest":        train_random_forest,
        "logistic_regression":  train_logistic_regression,
        "linear_regression":    train_linear_regression,
        "svm":                  train_svm,
        "kmeans":               train_kmeans,
    }

    fn = model_registry.get(algorithm_name.lower().strip())

    if fn is None:
        available = list(model_registry.keys())
        raise ValueError(
            f"Unknown algorithm: '{algorithm_name}'. "
            f"Available options: {available}"
        )

    return fn


# =============================================================================
# SECTION 5 — TOURNAMENT
# =============================================================================

def run_tournament(models_list, X_train, X_test, y_train, y_test, task_type):
    """
    NEW: Train all algorithms in models_list and return a ranked leaderboard.

    This is the Model Tournament feature — all selected algorithms are trained
    and evaluated in one call. The leaderboard is what React renders as the
    live competition visual on the Results page.

    Tournament scoring:
    - Classification: ranked by accuracy (0–1, higher is better)
    - Regression:     ranked by R² (-∞ to 1, higher is better; 1 = perfect fit)
    - Clustering:     no ranking (single algorithm, score not comparable)

    If one algorithm fails (e.g. SVM throws a convergence error), the tournament
    continues with the remaining algorithms. The failed entry is included in the
    leaderboard with status="failed" and rank at the bottom.

    Args:
        models_list:  list of algorithm name strings
                      e.g. ["random_forest", "decision_tree", "logistic_regression"]
                      Typically built from recommend_models() results.
        X_train:      scaled training features (from pipelines.scale_features)
        X_test:       scaled test features
        y_train:      training labels/targets
        y_test:       test labels/targets
        task_type:    'classification' or 'regression' or 'clustering'

    Returns:
        leaderboard:    list of dicts sorted by primary_score (best = rank 1).
                        Each dict has: algorithm, rank, primary_score, metrics, status
        trained_models: dict {algorithm_name: fitted_model} for ALL trained models.
                        The best model (rank 1) is saved by pipelines.py.
    """
    leaderboard    = []
    trained_models = {}

    for algorithm_name in models_list:
        try:
            train_fn = get_model_by_name(algorithm_name)

            if task_type == 'classification':

                # KNN uses k=5 as default for the tournament comparison
                # (Fine-tuned k via Elbow Method happens in a separate step)
                if algorithm_name == 'knn':
                    model = train_fn(X_train, y_train, k=5)
                else:
                    model = train_fn(X_train, y_train)

                y_pred        = model.predict(X_test)
                accuracy      = round(float(accuracy_score(y_test, y_pred)), 4)
                f1            = round(float(f1_score(
                    y_test, y_pred, average='weighted', zero_division=0
                )), 4)
                primary_score = accuracy
                metrics       = {
                    "accuracy": accuracy,
                    "f1_score": f1
                }

            elif task_type == 'regression':

                model  = train_fn(X_train, y_train)
                y_pred = model.predict(X_test)
                r2     = round(float(r2_score(y_test, y_pred)), 4)
                rmse   = round(float(np.sqrt(mean_squared_error(y_test, y_pred))), 4)
                mae    = round(float(mean_absolute_error(y_test, y_pred)), 4)
                primary_score = r2
                metrics       = {
                    "r2":   r2,
                    "rmse": rmse,
                    "mae":  mae
                }

            else:
                # Clustering — single algorithm, tournament does not apply
                model, labels = train_fn(X_train)
                primary_score = 0.0
                metrics       = {"n_clusters": int(len(set(labels)))}

            trained_models[algorithm_name] = model

            leaderboard.append({
                "algorithm":     algorithm_name,
                "primary_score": primary_score,
                "metrics":       metrics,
                "status":        "completed"
            })

        except Exception as e:
            # Do not stop the tournament — log the failure and continue
            leaderboard.append({
                "algorithm":     algorithm_name,
                "primary_score": -1.0,
                "metrics":       {},
                "status":        f"failed: {str(e)}"
            })

    # Sort best-to-worst
    leaderboard.sort(key=lambda x: x["primary_score"], reverse=True)

    # Assign rank numbers (1 = best performer)
    for i, entry in enumerate(leaderboard):
        entry["rank"] = i + 1

    return leaderboard, trained_models


# =============================================================================
# SECTION 6 — PERSISTENCE
# =============================================================================

def save_model(model, scaler, experiment_id, base_path):
    """
    NEW: Save a trained model and its scaler to disk using pickle.

    Both files MUST be saved together. The scaler is as important as the model
    because the What-If Simulator needs both:
    1. The model: to make predictions on new user-provided values
    2. The scaler: to normalize those new values using the EXACT SAME mean
       and std that were used during training (from scale_features on X_train)

    If only the model is saved and the scaler is discarded, the What-If Simulator
    will receive unscaled input values that the model has never seen in that form.
    Predictions will be wrong.

    Files are named using the experiment UUID to avoid collisions between
    different experiments or different users.

    Args:
        model:         fitted sklearn model object
        scaler:        fitted StandardScaler from pipelines.scale_features()
                       (pass None if no scaling was applied)
        experiment_id: UUID string from the Experiment database record
        base_path:     directory to save into (e.g. 'media/models/')

    Returns:
        dict: { "model_path": str, "scaler_path": str or None }
    """
    os.makedirs(base_path, exist_ok=True)

    model_path  = os.path.join(base_path, f'model_{experiment_id}.pkl')
    scaler_path = os.path.join(base_path, f'scaler_{experiment_id}.pkl')

    with open(model_path, 'wb') as f:
        pickle.dump(model, f)

    if scaler is not None:
        with open(scaler_path, 'wb') as f:
            pickle.dump(scaler, f)
    else:
        scaler_path = None

    return {
        "model_path":  model_path,
        "scaler_path": scaler_path
    }


def load_model(model_path, scaler_path=None):
    """
    NEW: Load a previously saved model and scaler from disk.

    Called by the What-If Simulator FastAPI endpoint:
    1. React user adjusts feature sliders — sends values to FastAPI
    2. FastAPI calls load_model(model_path, scaler_path)
    3. FastAPI calls evaluation.predict_what_if(model, scaler, input_dict)
    4. FastAPI returns { prediction, confidence, feature_contributions } to React

    Also called when loading a saved experiment to show its results again
    without retraining.

    Args:
        model_path:  full path to the saved model .pkl file
        scaler_path: full path to the saved scaler .pkl file
                     (pass None if no scaler was saved)

    Returns:
        model:  fitted sklearn model
        scaler: fitted StandardScaler (or None if scaler_path not provided)
    """
    with open(model_path, 'rb') as f:
        model = pickle.load(f)

    scaler = None
    if scaler_path and os.path.exists(scaler_path):
        with open(scaler_path, 'rb') as f:
            scaler = pickle.load(f)

    return model, scaler
