"""
Ported verbatim from frontend/src/pages/TrainTest.jsx's GRID_SEARCH_DEFAULTS
(line ~162). This is the single source of truth for which hyperparameter
VALUES a grid search may try — the agent selects from these fixed sets, it
never invents values from nothing. Keeps an LLM-driven grid search exactly
as bounded/safe as Manual Mode's own (training_router.py's /grid-search
independently caps total combinations at 60 either way).

If TrainTest.jsx's GRID_SEARCH_DEFAULTS is ever edited, port the change
here too — this is now a second copy by necessity (JS object vs Python
dict, different runtimes), not by accident, so it needs the same
"update all mirrors together" discipline as STEP_ORDER.
"""
from typing import Dict, List, Any

GRID_SEARCH_DEFAULTS: Dict[str, List[Dict[str, Any]]] = {
    "knn": [
        {"name": "metric", "values": ["euclidean", "manhattan"]},
    ],
    "decision_tree": [
        {"name": "criterion", "values": ["gini", "entropy"]},
        {"name": "max_depth", "values": [3, 5, 10]},
        {"name": "min_samples_split", "values": [2, 5]},
    ],
    "random_forest": [
        {"name": "n_estimators", "values": [50, 100, 200]},
        {"name": "max_depth", "values": [3, 5, 10]},
        {"name": "min_samples_split", "values": [2, 5]},
    ],
    "logistic_regression": [
        {"name": "max_iter", "values": [100, 500]},
        {"name": "penalty", "values": ["l2", "l1"]},
        {"name": "solver", "values": ["lbfgs", "liblinear"]},
    ],
    "svm": [
        {"name": "kernel", "values": ["linear", "rbf", "poly"]},
        {"name": "C", "values": [0.1, 1.0, 10.0]},
        {"name": "gamma", "values": ["scale", "auto"]},
    ],
    "xgboost": [
        {"name": "learning_rate", "values": [0.01, 0.1]},
        {"name": "max_depth", "values": [3, 5, 7]},
        {"name": "n_estimators", "values": [50, 100]},
        {"name": "subsample", "values": [0.8, 1.0]},
    ],
    "naive_bayes": [],
    "linear_regression": [],
    "ridge_regression": [
        {"name": "alpha", "values": [0.1, 1.0, 10.0]},
    ],
    "random_forest_regressor": [
        {"name": "n_estimators", "values": [50, 100, 200]},
        {"name": "max_depth", "values": [3, 5, 10]},
    ],
    "kmeans": [
        {"name": "max_iter", "values": [100, 300]},
    ],
}

# Model catalog, mirrors training_router.py's build_model() builders dict —
# used to validate the LLM's model_name choice is actually real before any
# tool call is attempted, and to scope which models are even offered per
# task_type (mirrors TrainTest.jsx's ModelDropdown grouping).
MODELS_BY_TASK: Dict[str, List[str]] = {
    "classification": ["knn", "decision_tree", "random_forest", "logistic_regression",
                        "svm", "xgboost", "naive_bayes"],
    "regression": ["linear_regression", "ridge_regression", "random_forest_regressor"],
    "clustering": ["kmeans"],
}


def default_param_grid(model_name: str) -> Dict[str, List[Any]]:
    """{param_name: [values]} shape training_router.py's /grid-search
    expects for param_grid, built from GRID_SEARCH_DEFAULTS."""
    return {p["name"]: p["values"] for p in GRID_SEARCH_DEFAULTS.get(model_name, [])}
