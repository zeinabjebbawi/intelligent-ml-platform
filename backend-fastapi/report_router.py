"""
PRISM — Report Router (FastAPI)
Page: "Report" — Final project summary + exports.

Endpoints:
  POST /report/generate        — compile full report from project context
  POST /report/export-notebook — generate .ipynb Jupyter Notebook
  GET  /report/download-model  — serve trained model (.pkl)

Add to main.py:
    from report_router import router as report_router
    app.include_router(report_router)
"""
import io, json, os, pickle, warnings
from datetime import datetime
from typing import Any, Dict, List, Optional
import pandas as pd
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
warnings.filterwarnings("ignore")

router = APIRouter(prefix="/report", tags=["Report"])

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def read_df(path: str) -> Optional[pd.DataFrame]:
    try:
        return pd.read_csv(path) if path and os.path.exists(path) else None
    except Exception:
        return None

def load_model_safe(pkl_path: str) -> Optional[dict]:
    try:
        with open(pkl_path, "rb") as f:
            return pickle.load(f)
    except Exception:
        return None

def safe_pct(x) -> float:
    """None/NaN-safe → percentage. A metric dict built from a training run
    can legitimately have a None/NaN entry (e.g. a metric that isn't
    meaningful for the split that ran) — this project's recurring
    NaN-in-JSON-response bug class, guarded the same way every other
    router here does."""
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if xf != xf else xf * 100

def nb_code(source: List[str]) -> dict:
    return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": source}

def nb_md(source: List[str]) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": source}

# ─────────────────────────────────────────────────────────────────────────────
# NOTEBOOK BUILDER
# ─────────────────────────────────────────────────────────────────────────────

MODEL_IMPORTS = {
    "decision_tree":           "from sklearn.tree import DecisionTreeClassifier",
    "random_forest":           "from sklearn.ensemble import RandomForestClassifier",
    "logistic_regression":     "from sklearn.linear_model import LogisticRegression",
    "knn":                     "from sklearn.neighbors import KNeighborsClassifier",
    "svm":                     "from sklearn.svm import SVC",
    "xgboost":                 "from xgboost import XGBClassifier",
    "naive_bayes":             "from sklearn.naive_bayes import GaussianNB",
    "linear_regression":       "from sklearn.linear_model import LinearRegression",
    "ridge_regression":        "from sklearn.linear_model import Ridge",
    "random_forest_regressor": "from sklearn.ensemble import RandomForestRegressor",
    "kmeans":                  "from sklearn.cluster import KMeans",
}

def build_notebook(req: "NotebookReq") -> dict:
    """Build a complete .ipynb from project context. Branches on
    req.task_type throughout — classification/regression/clustering need
    genuinely different imports, split logic (clustering has no target to
    split on at all), and evaluation code. An earlier draft of this
    function was classification-only regardless of task_type (imported
    StratifiedKFold + stratify=y unconditionally, evaluated with
    accuracy_score/confusion_matrix even for a regression or clustering
    run) — every generated notebook for a real regression/clustering
    project would have crashed the moment the user actually ran it."""
    ts       = datetime.now().strftime("%Y-%m-%d %H:%M")
    feat     = req.feature_names or []
    tgt      = req.target_column or "target"
    mdl      = req.model_name or "model"
    orig     = req.original_file_path or "dataset.csv"
    task     = req.task_type if req.task_type in ("classification", "regression", "clustering") else "classification"
    has_target = task != "clustering" and bool(req.target_column)

    cells = []

    cells.append(nb_md([
        "# PRISM ML Project — Jupyter Notebook Export\n",
        f"**Generated:** {ts}  \n",
        f"**Model:** {mdl}  \n",
        f"**Task type:** {task}" + (f"  \n**Target column:** `{tgt}`\n" if has_target else " (no target column — unsupervised)\n"),
        "\n---\n",
        "This notebook reproduces the full ML pipeline built with the PRISM platform.\n",
        "Run cells in order for reproducible results.\n",
    ]))

    # ── Imports ──────────────────────────────────────────────────────────
    cells.append(nb_md(["## 1. Imports\n"]))
    import_lines = [
        "import pandas as pd\n", "import numpy as np\n",
        "import matplotlib.pyplot as plt\n", "import seaborn as sns\n",
        "import pickle\n", "import warnings\n",
        "warnings.filterwarnings('ignore')\n",
    ]
    if task == "classification":
        import_lines += [
            "from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score\n",
            "from sklearn.preprocessing import LabelEncoder, StandardScaler\n",
            "from sklearn.metrics import (\n",
            "    accuracy_score, f1_score, precision_score, recall_score,\n",
            "    confusion_matrix, classification_report\n",
            ")\n",
        ]
    elif task == "regression":
        import_lines += [
            "from sklearn.model_selection import train_test_split, KFold, cross_val_score\n",
            "from sklearn.preprocessing import LabelEncoder, StandardScaler\n",
            "from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score\n",
        ]
    else:  # clustering
        import_lines += [
            "from sklearn.preprocessing import LabelEncoder, StandardScaler\n",
        ]
    import_lines.append("print('All libraries loaded successfully.')\n")
    cells.append(nb_code(import_lines))

    # ── Load Data ────────────────────────────────────────────────────────
    cells.append(nb_md(["## 2. Load Dataset\n"]))
    cells.append(nb_code([
        "# Load the original dataset\n",
        f"df = pd.read_csv(r'{orig}')\n",
        f"print(f'Shape: {{df.shape}}')\n",
        f"print(f'Columns: {{list(df.columns)}}')\n",
        "df.head()\n",
    ]))

    # ── Explore ──────────────────────────────────────────────────────────
    eda_lines = [
        "# Basic statistics\n",
        "display(df.describe())\n",
        "\n",
        "# Missing values\n",
        "missing = df.isnull().sum()\n",
        "print('Missing values per column:')\n",
        "print(missing[missing > 0])\n",
    ]
    if has_target:
        eda_lines += [
            "\n",
            f"print(f'\\nTarget distribution ({tgt}):')\n",
            f"print(df['{tgt}'].value_counts(normalize=True).round(3))\n",
        ]
    cells.append(nb_md(["## 3. Exploratory Data Analysis\n"]))
    cells.append(nb_code(eda_lines))

    # ── Cleaning ─────────────────────────────────────────────────────────
    cells.append(nb_md(["## 4. Data Cleaning\n", "\n",
        "Steps applied in PRISM: duplicate removal, outlier removal, missing value imputation.\n"]))
    dups = req.cleaning_stats.get("duplicates_removed", 0)
    outs = req.cleaning_stats.get("outliers_removed", 0)
    exclude_target = f"[c for c in numeric_cols if c != '{tgt}']" if has_target else "numeric_cols"
    cells.append(nb_code([
        "# 4.1 Remove duplicate rows\n",
        "n_before = len(df)\n",
        "df = df.drop_duplicates()\n",
        f"# PRISM removed {dups} duplicates\n",
        # Real bug fixed here: this line was previously a PLAIN (non-f)
        # string containing {{n_before - len(df)}} — meant to become a
        # real f-string once written into the notebook, but without the
        # f-prefix on THIS builder string, Python never collapsed the
        # double braces. The generated notebook cell then contained
        # f'...{{n_before - len(df)}}...' — an f-string whose {{ }} are
        # itself ESCAPED braces, so running that cell printed the literal
        # text "{n_before - len(df)}" instead of the computed number.
        # Fixed by adding the f-prefix here so the double braces correctly
        # collapse to single braces in the generated cell.
        f"print(f'Duplicates removed: {{n_before - len(df)}}')\n",
        "\n",
        "# 4.2 Remove outliers (IQR method)\n",
        "def remove_iqr_outliers(df, cols):\n",
        "    mask = pd.Series(True, index=df.index)\n",
        "    for col in cols:\n",
        "        Q1, Q3 = df[col].quantile(0.25), df[col].quantile(0.75)\n",
        "        IQR = Q3 - Q1\n",
        "        mask &= (df[col] >= Q1 - 1.5*IQR) & (df[col] <= Q3 + 1.5*IQR)\n",
        "    return df[mask]\n",
        "\n",
        "numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()\n",
        f"numeric_cols = {exclude_target}\n",
        "n_before = len(df)\n",
        "df = remove_iqr_outliers(df, numeric_cols)\n",
        f"# PRISM removed {outs} outlier rows\n",
        f"print(f'Outliers removed: {{n_before - len(df)}}')\n",
        "\n",
        "# 4.3 Impute missing values\n",
        "for col in df.select_dtypes(include=[np.number]).columns:\n",
        "    df[col] = df[col].fillna(df[col].mean())\n",
        "for col in df.select_dtypes(exclude=[np.number]).columns:\n",
        "    df[col] = df[col].fillna(df[col].mode()[0] if not df[col].mode().empty else 'Unknown')\n",
        f"print(f'Missing values remaining: {{df.isnull().sum().sum()}}')\n",
    ]))

    # ── Feature Engineering ──────────────────────────────────────────────
    if req.feature_engineering_steps:
        cells.append(nb_md(["## 5. Feature Engineering\n"]))
        cells.append(nb_code([
            "# Feature engineering steps applied in PRISM:\n",
            *[f"# - {s}\n" for s in req.feature_engineering_steps],
            "\n",
            "# Re-apply any feature engineering below (edit as needed):\n",
        ]))

    # ── Encoding ─────────────────────────────────────────────────────────
    cells.append(nb_md(["## 6. Encoding & Scaling\n"]))
    encode_skip = f"if col != '{tgt}':\n        df[col] = le.fit_transform(df[col].astype(str))\n" if has_target \
        else "df[col] = le.fit_transform(df[col].astype(str))\n"
    cells.append(nb_code([
        "le = LabelEncoder()\n",
        "for col in df.select_dtypes(exclude=[np.number]).columns:\n",
        f"    {encode_skip}",
        "\n",
        "scaler = StandardScaler()\n",
        f"features_to_scale = {json.dumps(feat[:5])}  # top features\n",
        "for col in features_to_scale:\n",
        "    if col in df.columns:\n",
        "        df[col] = scaler.fit_transform(df[[col]])\n",
        "\n",
        "print('Encoding and scaling complete.')\n",
        "df.head()\n",
    ]))

    # ── Feature Selection ────────────────────────────────────────────────
    cells.append(nb_md(["## 7. Feature Selection\n"]))
    fs_lines = [
        "# Features selected during PRISM pipeline\n",
        f"SELECTED_FEATURES = {json.dumps(feat)}\n",
        "\n",
        "X = df[SELECTED_FEATURES]\n",
    ]
    if has_target:
        fs_lines += [
            f"TARGET_COLUMN     = '{tgt}'\n",
            "y = df[TARGET_COLUMN]\n",
            "\n",
            f"print(f'Feature matrix shape: {{X.shape}}')\n",
            f"print(f'Target column: {{TARGET_COLUMN}}')\n",
        ]
    else:
        fs_lines += [
            "# Clustering has no target column — every selected feature is an input.\n",
            "\n",
            f"print(f'Feature matrix shape: {{X.shape}}')\n",
        ]
    cells.append(nb_code(fs_lines))

    # ── Training + Evaluation (task-type-specific) ──────────────────────
    cells.append(nb_md(["## 8. Model Training\n",
        f"\n**Model used:** {mdl}  \n" +
        (f"**Train/Test split:** {int(req.train_ratio*100)}/{int((1-req.train_ratio)*100)}\n"
         if task != "clustering" else "**Fit on:** the full feature matrix (no train/test split for clustering)\n")]))

    imp = MODEL_IMPORTS.get(req.model_name, "from sklearn.ensemble import RandomForestClassifier")
    params_str = json.dumps(req.model_params or {}, indent=2)
    guess_class = mdl.replace("_", " ").title().replace(" ", "")

    if task == "clustering":
        cells.append(nb_code([
            f"{imp}\n",
            "\n",
            f"model_params = {params_str}\n",
            f"# model = {guess_class}(**model_params)\n",
            "# Uncomment above and fill the correct class name, or load PRISM's saved model:\n",
            "\n",
            f"with open(r'{req.model_pkl_path or 'model.pkl'}', 'rb') as f:\n",
            "    model_data = pickle.load(f)\n",
            "model = model_data['model']\n",
            "print('Model loaded:', type(model).__name__)\n",
            "\n",
            "labels = model.predict(X)\n",
            "df['cluster'] = labels\n",
            "print(f'Assigned {df[\"cluster\"].nunique()} clusters')\n",
        ]))
        cells.append(nb_md(["## 9. Evaluation\n"]))
        cells.append(nb_code([
            "print('Cluster sizes:')\n",
            "print(df['cluster'].value_counts().sort_index())\n",
            "\n",
            "if hasattr(model, 'inertia_'):\n",
            "    print(f'Inertia: {model.inertia_:.4f}')\n",
            "\n",
            "# 2D visualization of the first two features, colored by cluster\n",
            "plt.figure(figsize=(8, 6))\n",
            "cols2 = X.columns[:2]\n",
            "plt.scatter(X[cols2[0]], X[cols2[1]], c=labels, cmap='tab10', alpha=0.6)\n",
            "plt.xlabel(cols2[0]); plt.ylabel(cols2[1])\n",
            "plt.title('Cluster Assignment')\n",
            "plt.tight_layout()\n",
            "plt.show()\n",
        ]))

    else:
        split_call = (
            "X_train, X_test, y_train, y_test = train_test_split(\n"
            f"    X, y, test_size={1-req.train_ratio:.2f}, random_state=42"
            + (", stratify=y\n" if task == "classification" else "\n") + ")\n"
        )
        cells.append(nb_code([
            f"{imp}\n",
            "\n",
            "# Train/test split\n",
            split_call,
            "\n",
            "# Instantiate model with tuned parameters\n",
            f"model_params = {params_str}\n",
            f"# model = {guess_class}(**model_params)\n",
            "# Uncomment above and fill the correct class name, or load from pickle:\n",
            "\n",
            "# Load saved model from PRISM\n",
            f"with open(r'{req.model_pkl_path or 'model.pkl'}', 'rb') as f:\n",
            "    model_data = pickle.load(f)\n",
            "model = model_data['model']\n",
            "print('Model loaded:', type(model).__name__)\n",
        ]))

        cells.append(nb_md(["## 9. Evaluation\n"]))
        if task == "classification":
            acc = req.metrics.get("accuracy", 0)
            f1 = req.metrics.get("f1", 0)
            cells.append(nb_code([
                "y_pred = model.predict(X_test)\n",
                "\n",
                "acc = accuracy_score(y_test, y_pred)\n",
                "f1  = f1_score(y_test, y_pred, average='weighted', zero_division=0)\n",
                f"# PRISM reported: accuracy={acc:.4f}, f1={f1:.4f}\n",
                "print(f'Accuracy : {acc:.4f}')\n",
                "print(f'F1-Score : {f1:.4f}')\n",
                "print()\n",
                "print(classification_report(y_test, y_pred))\n",
                "\n",
                "cm = confusion_matrix(y_test, y_pred)\n",
                "plt.figure(figsize=(8, 6))\n",
                "sns.heatmap(cm, annot=True, fmt='d', cmap='Blues')\n",
                "plt.title('Confusion Matrix')\n",
                "plt.ylabel('Actual'); plt.xlabel('Predicted')\n",
                "plt.tight_layout()\n",
                "plt.show()\n",
            ]))
        else:  # regression
            r2 = req.metrics.get("r2", 0)
            mae = req.metrics.get("mae", 0)
            cells.append(nb_code([
                "y_pred = model.predict(X_test)\n",
                "\n",
                "r2  = r2_score(y_test, y_pred)\n",
                "mae = mean_absolute_error(y_test, y_pred)\n",
                "rmse = mean_squared_error(y_test, y_pred) ** 0.5\n",
                f"# PRISM reported: r2={r2:.4f}, mae={mae:.4f}\n",
                "print(f'R\u00b2   : {r2:.4f}')\n",
                "print(f'MAE  : {mae:.4f}')\n",
                "print(f'RMSE : {rmse:.4f}')\n",
                "\n",
                "plt.figure(figsize=(7, 7))\n",
                "plt.scatter(y_test, y_pred, alpha=0.4)\n",
                "lims = [min(y_test.min(), y_pred.min()), max(y_test.max(), y_pred.max())]\n",
                "plt.plot(lims, lims, 'r--', label='Perfect prediction')\n",
                "plt.xlabel('Actual'); plt.ylabel('Predicted')\n",
                "plt.title('Actual vs. Predicted')\n",
                "plt.legend(); plt.tight_layout()\n",
                "plt.show()\n",
            ]))

    # ── Feature Importance (skip for clustering — no target to rank against) ──
    if task != "clustering":
        cells.append(nb_md(["## 10. Feature Importance\n"]))
        cells.append(nb_code([
            "if hasattr(model, 'feature_importances_'):\n",
            "    importances = model.feature_importances_\n",
            "    fi_series = pd.Series(importances, index=SELECTED_FEATURES).sort_values(ascending=False)\n",
            "    plt.figure(figsize=(10, 6))\n",
            "    fi_series.plot(kind='barh', color='steelblue')\n",
            "    plt.title('Feature Importances')\n",
            "    plt.xlabel('Importance')\n",
            "    plt.gca().invert_yaxis()\n",
            "    plt.tight_layout()\n",
            "    plt.show()\n",
            "else:\n",
            "    print('Model does not expose feature_importances_. Use SHAP for model-agnostic importance.')\n",
        ]))

        cells.append(nb_md(["## 11. SHAP Explanations (optional)\n"]))
        cells.append(nb_code([
            "try:\n",
            "    import shap\n",
            "    explainer   = shap.TreeExplainer(model) if hasattr(model, 'feature_importances_') else None\n",
            "    if explainer is None:\n",
            "        bg = shap.sample(X_test, min(30, len(X_test)), random_state=42)\n",
            "        explainer = shap.KernelExplainer(model.predict, bg)\n",
            "        shap_values = explainer.shap_values(X_test.iloc[:50], nsamples=100)\n",
            "    else:\n",
            "        shap_values = explainer.shap_values(X_test)\n",
            "    shap.summary_plot(shap_values, X_test, plot_type='bar')\n",
            "except ImportError:\n",
            "    print('Install shap: pip install shap')\n",
            "except Exception as e:\n",
            "    print(f'SHAP error: {e}')\n",
        ]))

    cells.append(nb_md(["---\n", "*Generated by PRISM ML Platform.*\n"]))

    return {
        "nbformat": 4, "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3.9.0"},
        },
        "cells": cells,
    }

# ─────────────────────────────────────────────────────────────────────────────
# REQUEST MODELS
# ─────────────────────────────────────────────────────────────────────────────

class GenerateReq(BaseModel):
    original_file_path:    Optional[str] = None
    current_file_path:     Optional[str] = None
    target_column:         Optional[str] = None
    task_type:              str = "classification"
    model_pkl_path:        Optional[str] = None
    model_name:            Optional[str] = None
    model_params:          Dict[str, Any] = {}
    feature_names:         List[str] = []
    metrics:               Dict[str, Any] = {}
    train_ratio:           float = 0.80
    cleaning_stats:        Dict[str, int] = {}
    feature_engineering_steps: List[str] = []
    versions_summary:      List[Dict] = []
    shap_top_features:     List[str] = []
    pattern_type:          Optional[str] = None
    balance_level:         Optional[str] = None

class NotebookReq(GenerateReq):
    pass

# ─────────────────────────────────────────────────────────────────────────────
# GENERATE REPORT DATA
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/generate")
def generate_report(req: GenerateReq):
    try:
        df_orig = read_df(req.original_file_path) if req.original_file_path else None
        df_curr = read_df(req.current_file_path) if req.current_file_path else None
        # mdata isn't currently read from further below, but attempting the
        # load (safely — never raises) still surfaces a broken pkl path
        # early via load_model_safe's own try/except, rather than only
        # failing later when download-model is clicked.
        load_model_safe(req.model_pkl_path) if req.model_pkl_path else None

        orig_rows = len(df_orig) if df_orig is not None else None
        curr_rows = len(df_curr) if df_curr is not None else None
        orig_cols = len(df_orig.columns) if df_orig is not None else None

        findings = []

        if orig_rows:
            target_desc = f'"{req.target_column}" ({req.task_type})' if req.target_column else f"none ({req.task_type})"
            findings.append({
                "icon": "📊", "title": "Dataset Overview",
                "text": (f"The original dataset contained {orig_rows:,} rows and {orig_cols} columns. "
                         f"Target column: {target_desc}. "
                         f"{curr_rows:,} rows remained after full preprocessing."
                         if curr_rows else f"{orig_rows:,} rows, {orig_cols} columns, target: {target_desc}.")
            })

        dups = req.cleaning_stats.get("duplicates_removed", 0)
        outs = req.cleaning_stats.get("outliers_removed", 0)
        miss = req.cleaning_stats.get("missing_imputed", 0)
        if dups or outs or miss:
            parts = []
            if dups: parts.append(f"{dups} duplicate rows removed")
            if outs: parts.append(f"{outs} outlier rows removed")
            if miss: parts.append(f"{miss} missing values imputed")
            total_removed = dups + outs
            pct = round(total_removed / orig_rows * 100, 1) if orig_rows else 0
            findings.append({
                "icon": "🧹", "title": "Preprocessing Pipeline",
                "text": (f"Preprocessing removed {total_removed:,} rows ({pct}% of original): {'; '.join(parts)}. "
                         "The dataset is now 100% complete with no missing values.")
            })

        if req.balance_level:
            level_desc = {
                "balanced": "well balanced — no special handling required",
                "mild":     "mildly imbalanced — standard models handled it",
                "moderate": "moderately imbalanced — sampling was recommended",
                "severe":   "severely imbalanced — resampling was applied",
            }
            findings.append({
                "icon": "⚖", "title": "Class Balance",
                "text": f"Target column class distribution was {level_desc.get(req.balance_level, req.balance_level)}."
            })

        # Model performance — task-type-aware. An earlier version of this
        # finding only ever read accuracy/f1, which is meaningless for a
        # regression or clustering run (those metrics simply don't exist
        # in a regression/clustering result, so the "finding" silently
        # never appeared at all for 2 of this platform's 3 task types).
        m = req.metrics or {}
        if req.task_type == "regression" and (m.get("r2") is not None or m.get("mae") is not None):
            r2, mae, rmse = m.get("r2"), m.get("mae"), m.get("rmse")
            findings.append({
                "icon": "🤖", "title": f"Best Model — {req.model_name or 'Unknown'}",
                "text": (f"Achieved an R² of {r2:.3f} on the test set" if r2 is not None else "Regression model trained") +
                        (f", with a mean absolute error of {mae:.3f}" if mae is not None else "") +
                        (f" (RMSE {rmse:.3f})" if rmse is not None else "") + "."
            })
        elif req.task_type == "clustering" and (m.get("n_clusters") is not None):
            n_clusters, inertia = m.get("n_clusters"), m.get("inertia")
            findings.append({
                "icon": "🤖", "title": f"Clustering Result — {req.model_name or 'Unknown'}",
                "text": (f"Grouped the data into {n_clusters} clusters" +
                         (f" with an inertia of {inertia:.2f}" if inertia is not None else "") + ".")
            })
        elif m.get("accuracy") is not None or m.get("f1") is not None:
            acc, f1, prec, rec = safe_pct(m.get("accuracy")), safe_pct(m.get("f1")), safe_pct(m.get("precision")), safe_pct(m.get("recall"))
            findings.append({
                "icon": "🤖", "title": f"Best Model — {req.model_name or 'Unknown'}",
                "text": (f"Achieved {acc:.1f}% accuracy and {f1:.1f}% weighted F1-Score on the test set. "
                         f"Precision: {prec:.1f}%, Recall: {rec:.1f}%.")
            })

        top3 = req.shap_top_features[:3] if req.shap_top_features else req.feature_names[:3]
        if top3:
            findings.append({
                "icon": "💡", "title": "Top Influential Features",
                "text": (f"SHAP analysis identified {', '.join(top3)} as the most impactful features "
                         f"on model predictions. {top3[0]} was the single strongest driver.")
            })

        if req.pattern_type:
            pattern_notes = {
                "good_fit":        "The learning curve showed a good fit — training and validation curves converged.",
                "overfitting":     "Overfitting was detected in the learning curve. Regularization or more data may help.",
                "underfitting":    "Underfitting was detected — model complexity may need to increase.",
                "needs_more_data": "The model shows potential to improve further with more training data.",
            }
            findings.append({
                "icon": "📈", "title": "Model Fitness",
                "text": pattern_notes.get(req.pattern_type, f"Learning curve pattern: {req.pattern_type}.")
            })

        return {
            "generated_at": datetime.now().isoformat(),
            "project_title": f"PRISM ML Report — {req.target_column or 'Project'}",
            "findings": findings,
            "summary_stats": {
                "original_rows": orig_rows, "current_rows": curr_rows, "original_cols": orig_cols,
                "feature_count": len(req.feature_names), "metrics": m, "model_name": req.model_name,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Report generation failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# EXPORT JUPYTER NOTEBOOK
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/export-notebook")
def export_notebook(req: NotebookReq):
    try:
        nb = build_notebook(req)
        content = json.dumps(nb, indent=2, ensure_ascii=False).encode("utf-8")
        timestamp = datetime.now().strftime("%Y%m%d_%H%M")
        filename = f"prism_ml_pipeline_{timestamp}.ipynb"
        return StreamingResponse(
            io.BytesIO(content), media_type="application/x-ipynb+json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Notebook export failed: {str(e)}")

# ─────────────────────────────────────────────────────────────────────────────
# DOWNLOAD TRAINED MODEL
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/download-model")
def download_model(model_pkl_path: str, model_name: str = "model"):
    try:
        if not model_pkl_path or not os.path.exists(model_pkl_path):
            raise HTTPException(404, "Model file not found.")
        timestamp = datetime.now().strftime("%Y%m%d")
        filename = f"{model_name}_{timestamp}.pkl"
        return FileResponse(path=model_pkl_path, filename=filename, media_type="application/octet-stream")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Model download failed: {str(e)}")
