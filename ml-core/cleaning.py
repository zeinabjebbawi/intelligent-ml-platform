"""
ML Core — cleaning.py
======================
Everything related to data loading, profiling, and preprocessing.

Functions are organized in 7 sections:
  1. Data Loading            (1 function  — from course)
  2. Profiling Helpers       (6 functions — new)
  3. Missing Value Handlers  (7 functions — course + adapted)
  4. Outlier Handling        (3 functions — from course)
  5. Structural Operations   (3 functions — course + new)
  6. Encoding & Normalization(2 functions — new)
  7. Auto-Clean Orchestration(2 functions — new)

Coding rules for this file:
  - NEVER use inplace=True — always df = df.copy() then return the new df
  - NEVER use plt.show() — return data dicts, React renders charts
  - Every function returns something useful (no print-only functions)
  - All outputs must be JSON-serializable (use int/float not numpy types)
"""

import os
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.preprocessing import StandardScaler, LabelEncoder


# =============================================================================
# SECTION 1 — DATA LOADING
# =============================================================================

def load_data(filepath):
    """
    Load a CSV file from a disk path into a pandas DataFrame.

    FROM COURSE — no changes needed.
    Called at the start of every pipeline run to load the versioned CSV file.

    Args:
        filepath: absolute path to the CSV file on disk

    Returns:
        df: pandas DataFrame
    """
    df = pd.read_csv(filepath)
    return df


# =============================================================================
# SECTION 2 — PROFILING HELPERS
# These 6 functions are called internally by profile_dataset().
# You normally do not call them directly from FastAPI.
# =============================================================================

def get_column_metadata(df):
    """
    For every column in the DataFrame: detect its type, count missing values,
    and compute basic statistics.

    NEW FUNCTION — powers the Column Passport cards on the Diagnose page.
    Each column gets a "passport" showing its type, missing %, value range.

    Args:
        df: pandas DataFrame

    Returns:
        metadata: dict in the form:
            {
              "Age": {
                "type": "numerical",
                "missing_count": 5,
                "missing_pct": 2.5,
                "unique_values": 45,
                "mean": 31.2,
                "median": 29.0,
                "std": 10.4,
                "min": 18.0,
                "max": 82.0
              },
              "Gender": {
                "type": "categorical",
                "missing_count": 0,
                "missing_pct": 0.0,
                "unique_values": 2,
                "most_common": "Male"
              }
            }
    """
    metadata = {}

    for col in df.columns:
        is_numerical = pd.api.types.is_numeric_dtype(df[col])
        missing_count = int(df[col].isna().sum())
        missing_pct = round(missing_count / len(df) * 100, 2) if len(df) > 0 else 0.0

        col_info = {
            "type": "numerical" if is_numerical else "categorical",
            "missing_count": missing_count,
            "missing_pct": missing_pct,
            "unique_values": int(df[col].nunique()),
        }

        if is_numerical:
            # For numerical columns: compute standard statistics
            # We skip NaN values when computing (skipna=True is the default)
            col_info["mean"]   = round(float(df[col].mean()),   4) if not df[col].isna().all() else None
            col_info["median"] = round(float(df[col].median()), 4) if not df[col].isna().all() else None
            col_info["std"]    = round(float(df[col].std()),    4) if not df[col].isna().all() else None
            col_info["min"]    = round(float(df[col].min()),    4) if not df[col].isna().all() else None
            col_info["max"]    = round(float(df[col].max()),    4) if not df[col].isna().all() else None
        else:
            # For categorical columns: find the most common value
            mode_val = df[col].mode()
            col_info["most_common"] = str(mode_val.iloc[0]) if not mode_val.empty else None

        metadata[col] = col_info

    return metadata


def detect_class_imbalance(df, target_column):
    """
    Check whether the target column has class imbalance.

    NEW FUNCTION — powers the "Warning: class imbalance detected" Insight Card.

    Why this matters: if 90% of rows are class 0 and 10% are class 1,
    a model could get 90% accuracy by just predicting 0 for everything.
    The model looks good but is actually useless for detecting class 1.

    Args:
        df: pandas DataFrame
        target_column: the name of the target column to analyze

    Returns:
        dict with class distribution, imbalance ratio, and a boolean flag
    """
    if target_column not in df.columns:
        return {"error": f"Column '{target_column}' not found in dataset"}

    counts = df[target_column].value_counts()
    total = len(df)

    # Build per-class distribution
    class_distribution = {}
    for label, count in counts.items():
        class_distribution[str(label)] = {
            "count": int(count),
            "percentage": round(count / total * 100, 2)
        }

    # Compute imbalance metrics
    if len(counts) >= 2:
        majority_pct  = counts.iloc[0]  / total * 100
        imbalance_ratio = round(float(counts.iloc[0] / counts.iloc[-1]), 2)
        # We flag as imbalanced if any single class occupies more than 70% of rows
        # bool(...) matters here: comparing numpy types produces numpy.bool_, which
        # (unlike Python's own bool) json.dumps() cannot serialize.
        is_imbalanced = bool(majority_pct > 70)
    else:
        imbalance_ratio = 1.0
        is_imbalanced   = False

    return {
        "class_distribution": class_distribution,
        "imbalance_ratio": imbalance_ratio,
        "is_imbalanced": is_imbalanced,
        "majority_class": str(counts.index[0]),
        "majority_percentage": round(float(counts.iloc[0] / total * 100), 2),
        "num_classes": int(len(counts))
    }


def compute_correlations(df):
    """
    Compute Pearson correlation between every pair of numerical columns.

    NEW FUNCTION — powers the correlation heatmap on the Diagnose page.
    The frontend receives this as a nested dict and renders it as a color-coded grid.

    Args:
        df: pandas DataFrame

    Returns:
        correlations: nested dict {column: {other_column: correlation_value}}
        Returns empty dict if fewer than 2 numerical columns exist.
    """
    numerical_cols = df.select_dtypes(include=[np.number]).columns.tolist()

    if len(numerical_cols) < 2:
        return {}

    # .corr() computes pairwise Pearson correlation, ranging from -1 to +1
    # +1 = perfect positive correlation, -1 = perfect negative, 0 = no correlation
    corr_matrix = df[numerical_cols].corr().round(4)

    # Convert DataFrame to a plain dict of dicts for JSON serialization
    correlations = {}
    for col in corr_matrix.columns:
        correlations[col] = {}
        for other_col in corr_matrix.columns:
            val = corr_matrix.loc[col, other_col]
            # Handle NaN values (can occur when a column has zero variance)
            correlations[col][other_col] = round(float(val), 4) if not np.isnan(val) else 0.0

    return correlations


def count_outliers_per_column(df):
    """
    Count the number of outlier values in every numerical column using the IQR method.

    NEW FUNCTION (extends the course's per-column outlier detection to all columns).
    Used by profile_dataset() to feed into the health score formula and
    to generate the "X outliers detected in Column Y" Insight Cards.

    IQR method: a value is an outlier if it is below Q1 - 1.5*IQR or above Q3 + 1.5*IQR.

    Args:
        df: pandas DataFrame

    Returns:
        outlier_counts: dict {column_name: outlier_count}
    """
    outlier_counts = {}
    numerical_cols = df.select_dtypes(include=[np.number]).columns.tolist()

    for col in numerical_cols:
        col_data = df[col].dropna()  # Ignore missing values when detecting outliers
        Q1 = col_data.quantile(0.25)
        Q3 = col_data.quantile(0.75)
        IQR = Q3 - Q1
        lower_bound = Q1 - 1.5 * IQR
        upper_bound = Q3 + 1.5 * IQR
        outlier_count = int(((col_data < lower_bound) | (col_data > upper_bound)).sum())
        outlier_counts[col] = outlier_count

    return outlier_counts


def profile_dataset(df, target_column=None):
    """
    Run a comprehensive statistical profile of the entire dataset.

    THE MOST IMPORTANT FUNCTION IN THE ML CORE.
    This runs automatically right after every CSV upload.
    The result is stored in Dataset.profiling_result (JSONB column in PostgreSQL).

    It calls all 4 profiling helpers above and assembles them into one large dict.
    FastAPI sends this dict to React which renders:
      - The Dataset Health Score gauge
      - The Column Passport cards
      - The correlation heatmap
      - The class imbalance warning (if target is known)
      - The AI Observation Cards

    Args:
        df:             pandas DataFrame (the uploaded dataset)
        target_column:  name of the target column (optional at this stage)

    Returns:
        profiling_result: a large dict with all statistical findings + health score
    """
    total_rows = len(df)
    total_cols = len(df.columns)

    # Separate column types
    numerical_cols   = df.select_dtypes(include=[np.number]).columns.tolist()
    categorical_cols = df.select_dtypes(exclude=[np.number]).columns.tolist()

    # Overall missing value summary
    total_missing    = int(df.isna().sum().sum())
    total_cells      = total_rows * total_cols
    missing_pct_overall = round(total_missing / total_cells * 100, 2) if total_cells > 0 else 0.0

    # Duplicate rows
    duplicate_count = int(df.duplicated().sum())

    # Call each profiling helper
    columns_metadata = get_column_metadata(df)
    outlier_counts   = count_outliers_per_column(df)
    total_outliers   = sum(outlier_counts.values())
    correlations     = compute_correlations(df)

    # Class imbalance only if target column is provided
    imbalance_info = {}
    if target_column and target_column in df.columns:
        imbalance_info = detect_class_imbalance(df, target_column)

    # Assemble the complete profiling result
    profiling_result = {
        "total_rows":                total_rows,
        "total_columns":             total_cols,
        "numerical_columns":         numerical_cols,
        "categorical_columns":       categorical_cols,
        "total_missing_values":      total_missing,
        "missing_pct_overall":       missing_pct_overall,
        "duplicate_rows":            duplicate_count,
        "total_outliers":            total_outliers,
        "outlier_counts_per_column": outlier_counts,
        "columns_metadata":          columns_metadata,
        "correlations":              correlations,
        "class_imbalance":           imbalance_info,
        "column_names":              list(df.columns),
        "target_column":             target_column,
    }

    # Compute and attach health score
    profiling_result["health_score"] = compute_health_score(profiling_result)

    return profiling_result


def compute_health_score(profiling_result):
    """
    Compute a 0–100 data quality score from the profiling result.

    NEW FUNCTION — powers the visual Health Score gauge on the Diagnose page.
    Simple weighted formula using 4 sub-scores.
    No ML involved — just statistics and business rules.

    Weights:
        Completeness  40%  (missing values have the biggest impact)
        Duplicates    20%
        Outliers      20%
        Balance       20%  (only penalizes if classification with known target)

    Args:
        profiling_result: the dict returned by profile_dataset()

    Returns:
        health_score_dict: {
            "overall":       74.5,   (the main score shown to the user)
            "completeness":  88.0,
            "duplicates":   100.0,
            "outliers":      72.0,
            "balance":        60.0
        }
    """
    # ── Sub-score 1: Completeness ──────────────────────────────────────────
    # 0% missing → 100 points. 20% missing → 0 points (penalize 5 pts per 1%).
    missing_pct     = profiling_result.get("missing_pct_overall", 0)
    completeness    = max(0.0, 100.0 - (missing_pct * 5))

    # ── Sub-score 2: Duplicates ─────────────────────────────────────────────
    total_rows      = max(profiling_result.get("total_rows", 1), 1)
    duplicate_rows  = profiling_result.get("duplicate_rows", 0)
    duplicate_pct   = (duplicate_rows / total_rows) * 100
    duplicates      = max(0.0, 100.0 - (duplicate_pct * 5))

    # ── Sub-score 3: Outlier density ─────────────────────────────────────────
    # Compute as: total_outliers / (num_numerical_cols * num_rows)
    total_outliers   = profiling_result.get("total_outliers", 0)
    numerical_cols   = profiling_result.get("numerical_columns", [])
    if numerical_cols and total_rows:
        outlier_pct  = (total_outliers / (len(numerical_cols) * total_rows)) * 100
    else:
        outlier_pct  = 0
    outliers         = max(0.0, 100.0 - (outlier_pct * 10))

    # ── Sub-score 4: Class balance ───────────────────────────────────────────
    # Only relevant when we know the target column and it is a classification task.
    imbalance        = profiling_result.get("class_imbalance", {})
    if imbalance.get("is_imbalanced", False):
        majority_pct = imbalance.get("majority_percentage", 50)
        # 50% majority → 100 points. 100% majority → 0 points.
        balance      = max(0.0, 100.0 - ((majority_pct - 50) * 2))
    else:
        balance      = 100.0

    # ── Weighted overall score ────────────────────────────────────────────────
    overall = round(
        completeness * 0.40 +
        duplicates   * 0.20 +
        outliers     * 0.20 +
        balance      * 0.20,
        1
    )
    overall = min(100.0, max(0.0, overall))

    return {
        "overall":      overall,
        "completeness": round(completeness, 1),
        "duplicates":   round(duplicates,   1),
        "outliers":     round(outliers,     1),
        "balance":      round(balance,      1)
    }


# =============================================================================
# SECTION 3 — MISSING VALUE HANDLERS
# count_missing and drop_missing_rows are from course unchanged.
# The fill_* functions are from course with one fix: inplace=True removed.
# Always df = df.copy() + return the new df so original is never modified.
# =============================================================================

def count_missing(df):
    """
    Return count of missing values per column.

    FROM COURSE — returns dict (instead of Series) for JSON compatibility.

    Args:
        df: pandas DataFrame

    Returns:
        dict: {column_name: count_of_missing_values}
    """
    return df.isna().sum().to_dict()


def drop_missing_rows(df, subset=None, how="any"):
    """
    Drop rows that contain NaN values.

    FROM COURSE — already returned a new df correctly, no changes needed.

    Args:
        df:     pandas DataFrame
        subset: list of column names to check (None = check all columns)
        how:    'any' (drop if any column is NaN) or 'all' (drop only if all are NaN)

    Returns:
        df with the missing rows removed
    """
    if subset:
        return df.dropna(subset=subset, how=how)
    return df.dropna(how=how)


def fill_missing_with_mean(df, column):
    """
    Fill NaN values in a numerical column with the column mean.

    ADAPTED FROM COURSE: removed inplace=True, now uses df.copy().

    Why this matters: with inplace=True, the original DataFrame is modified.
    This breaks dataset versioning — the 'original.csv' would silently change.
    With df.copy(), the original is preserved and we return a new DataFrame
    that will be saved as 'cleaned_v2.csv'.

    Args:
        df:     pandas DataFrame
        column: column name to fill

    Returns:
        new DataFrame with NaN values in that column replaced by mean
    """
    df = df.copy()                           # ← THIS IS THE KEY FIX from the course version
    mean_value = df[column].mean()
    df[column] = df[column].fillna(mean_value)
    return df


def fill_missing_with_median(df, column):
    """
    Fill NaN values in a numerical column with the column median.

    NEW FUNCTION (simple extension of fill_missing_with_mean).
    Median is preferred over mean when the column has significant outliers,
    because outliers pull the mean toward extreme values.

    For example: salaries [30k, 35k, 32k, 500k] → mean=149k (misleading), median=33.5k (realistic).

    Args:
        df:     pandas DataFrame
        column: column name to fill

    Returns:
        new DataFrame with NaN values replaced by median
    """
    df = df.copy()
    median_value = df[column].median()
    df[column] = df[column].fillna(median_value)
    return df


def fill_missing_with_constant(df, column, constant):
    """
    Fill NaN values in a column with a specific constant value.

    ADAPTED FROM COURSE: removed inplace=True, uses copy.
    Used when the user or agent decides that missing means a specific value
    (e.g., 0 for a count column, 'None' for a text column, -1 for an unknown ID).

    Args:
        df:       pandas DataFrame
        column:   column name to fill
        constant: the value to replace NaN with

    Returns:
        new DataFrame with NaN replaced by constant
    """
    df = df.copy()
    df[column] = df[column].fillna(constant)
    return df


def fill_missing_with_interpolation(df, column):
    """
    Fill NaN values by linear interpolation between neighboring values.

    ADAPTED FROM COURSE: removed inplace=True, uses copy.
    Useful for ordered/sequential data where the missing value should be
    somewhere between the values before and after it.

    Example: [10, NaN, 30] → [10, 20, 30] (interpolates the midpoint).

    Args:
        df:     pandas DataFrame
        column: column name to fill

    Returns:
        new DataFrame with NaN values interpolated
    """
    df = df.copy()
    df[column] = df[column].interpolate()
    return df


def fill_missing_categorical(df, column, strategy="mode", fill_value="Unknown"):
    """
    Fill NaN values in a categorical (text/object) column.

    ADAPTED FROM COURSE: removed inplace=True, uses copy.

    strategy='mode':     replace NaN with the most frequently occurring value
    strategy='constant': replace NaN with the fill_value string

    Smart Auto mode uses 'mode' by default for all categorical columns.

    Args:
        df:         pandas DataFrame
        column:     column name to fill
        strategy:   'mode' or 'constant'
        fill_value: value used when strategy='constant'

    Returns:
        new DataFrame with NaN filled
    """
    df = df.copy()
    if strategy == "mode":
        mode_val = df[column].mode()
        if not mode_val.empty:
            df[column] = df[column].fillna(mode_val.iloc[0])
        else:
            df[column] = df[column].fillna(fill_value)
    else:
        df[column] = df[column].fillna(fill_value)
    return df


# =============================================================================
# SECTION 4 — OUTLIER HANDLING
# Directly from course — no changes. They already return filtered DataFrames.
# =============================================================================

def check_normality(df, column, significance_level=0.05):
    """
    Test whether a numerical column follows a normal distribution.
    Uses D'Agostino's K-squared test (scipy.stats.normaltest).

    FROM COURSE LOGIC — your course taught: check normality first,
    then decide between Z-score (for normal data) and IQR (for skewed data).
    This function makes that decision explicit and testable.

    Returns True if the column is approximately normally distributed,
    False if it is skewed or non-normal.

    Args:
        df:                 pandas DataFrame
        column:             column name to test
        significance_level: p-value threshold (default 0.05)
                            p > 0.05 → likely normal
                            p ≤ 0.05 → likely non-normal / skewed

    Returns:
        bool: True = normal distribution, False = non-normal
    """
    col_data = df[column].dropna()

    # The test needs at least 8 values to work reliably
    if len(col_data) < 8:
        return False

    stat, p_value = stats.normaltest(col_data)
    return bool(p_value > significance_level)


def detect_outliers_zscore(df, column, threshold=3.0):
    """
    Detect outlier rows using the Z-Score method.

    FROM COURSE — unchanged.
    Returns only the rows that are considered outliers.
    A row is an outlier if |z-score| > threshold (default 3.0).

    Used in profiling to show the user which rows are suspicious.
    Not used for removal — use remove_outliers_zscore() for that.

    Args:
        df:        pandas DataFrame
        column:    column name to analyze
        threshold: z-score threshold (default 3.0 = 3 standard deviations from mean)

    Returns:
        DataFrame containing only the outlier rows
    """
    col_data = df[column].dropna()
    z_scores = stats.zscore(col_data)
    abs_z    = np.abs(z_scores)
    # Return the rows from the original df that correspond to outliers
    outlier_mask = pd.Series(abs_z > threshold, index=col_data.index)
    return df.loc[outlier_mask[outlier_mask].index]


def remove_outliers_zscore(df, column, threshold=3.0):
    """
    Remove outlier rows from a column using the Z-Score method.

    FROM COURSE — unchanged. Already returns a filtered (new) DataFrame.
    Best for normally distributed numerical data.

    Args:
        df:        pandas DataFrame
        column:    column to check for outliers
        threshold: z-score threshold above which a value is considered an outlier

    Returns:
        DataFrame with outlier rows removed
    """
    z_scores = stats.zscore(df[column])
    abs_z    = np.abs(z_scores)
    return df[abs_z <= threshold]


def remove_outliers_iqr(df, column):
    """
    Remove outlier rows using the IQR (Interquartile Range) method.

    FROM COURSE — unchanged. Already returns a filtered (new) DataFrame.
    More robust than Z-Score because it does not assume normal distribution.
    This is the default method used by auto_clean().

    Keeps rows where value is between [Q1 - 1.5×IQR, Q3 + 1.5×IQR].

    Args:
        df:     pandas DataFrame
        column: column to check for outliers

    Returns:
        DataFrame with outlier rows removed
    """
    Q1  = df[column].quantile(0.25)
    Q3  = df[column].quantile(0.75)
    IQR = Q3 - Q1
    lower_bound = Q1 - 1.5 * IQR
    upper_bound = Q3 + 1.5 * IQR
    return df[(df[column] >= lower_bound) & (df[column] <= upper_bound)]


# =============================================================================
# SECTION 5 — STRUCTURAL OPERATIONS
# =============================================================================

def drop_columns(df, columns):
    """
    Drop one or more columns from the DataFrame.

    FROM COURSE — unchanged.
    Used when: (a) the user manually removes a column,
               (b) auto_clean() removes columns with >90% missing values.

    Args:
        df:      pandas DataFrame
        columns: string or list of strings (column names to remove)

    Returns:
        DataFrame without the specified columns
    """
    return df.drop(columns=columns)


def remove_duplicates(df):
    """
    Remove all duplicate rows from the DataFrame.

    NEW FUNCTION — your course had no duplicate removal.
    Returns both the cleaned DataFrame and a count of rows removed,
    so the caller can log: "Removed 3 duplicate rows" in the activity summary.

    Args:
        df: pandas DataFrame

    Returns:
        tuple: (cleaned_df, count_removed)
    """
    original_length = len(df)
    df_clean        = df.drop_duplicates()
    count_removed   = original_length - len(df_clean)
    return df_clean, count_removed


# =============================================================================
# SECTION 6 — ENCODING AND NORMALIZATION
# Your course only had scale_features(X_train, X_test) after splitting.
# These functions apply encoding/normalization to the FULL DataFrame BEFORE splitting,
# as part of the dataset versioning pipeline.
# =============================================================================

def encode_categorical_columns(df, exclude_columns=None):
    """
    Apply Label Encoding to all categorical (text/object) columns.

    NEW FUNCTION — your course had no encoding step.
    Converts text categories to numbers because ML algorithms require numerical input.

    Example: Gender ['Male','Female'] → [1, 0]
    The encoding_map stores this mapping so the user can see what happened:
        encoding_map = {'Gender': {'Female': 0, 'Male': 1}}

    The encoding_map is stored in DatasetVersion.transformations_applied (JSONB)
    so the system can show "Gender: Male→1, Female→0" in the transparency log.

    Args:
        df:               pandas DataFrame
        exclude_columns:  list of column names NOT to encode (e.g. the target column)

    Returns:
        tuple: (encoded_df, encoding_map)
    """
    if exclude_columns is None:
        exclude_columns = []

    df           = df.copy()
    encoding_map = {}
    le           = LabelEncoder()

    categorical_cols = df.select_dtypes(include=["object", "category"]).columns

    for col in categorical_cols:
        if col in exclude_columns:
            continue
        # Fill any remaining NaN before encoding so LabelEncoder does not crash
        df[col]          = df[col].fillna("Unknown").astype(str)
        df[col]          = le.fit_transform(df[col])
        # Store original → encoded mapping for the transparency log
        encoding_map[col] = {str(cls): int(i) for i, cls in enumerate(le.classes_)}

    return df, encoding_map


def normalize_all_numerical(df, exclude_columns=None):
    """
    Apply StandardScaler (Z-score normalization) to all numerical columns.

    NEW FUNCTION — extends the course's scale_features() from working on
    X_train/X_test arrays to working on the full DataFrame with column names.

    Why we return the scaler: the same scaler MUST be used by the What-If Simulator.
    When the user types a new glucose value in the simulator, we need to scale it
    exactly the same way the training data was scaled, otherwise predictions will
    be wrong. The scaler is saved alongside the trained model.

    StandardScaler: for each value x → (x - mean) / std
    Result: every numerical column has mean=0 and std=1.

    Args:
        df:               pandas DataFrame
        exclude_columns:  list of columns NOT to normalize (e.g. encoded categoricals, target)

    Returns:
        tuple: (normalized_df, scaler)
        scaler is None if no numerical columns are found.
    """
    if exclude_columns is None:
        exclude_columns = []

    df             = df.copy()
    numerical_cols = [
        col for col in df.select_dtypes(include=[np.number]).columns
        if col not in exclude_columns
    ]

    if not numerical_cols:
        return df, None

    scaler                = StandardScaler()
    df[numerical_cols]    = scaler.fit_transform(df[numerical_cols])

    return df, scaler


# =============================================================================
# SECTION 7 — AUTO-CLEAN ORCHESTRATION
# These two functions together implement the Smart Auto mode cleaning logic.
# =============================================================================

def build_auto_clean_config(profiling_result, df=None):
    """
    Read the profiling result and decide which cleaning steps to apply.
    Returns a config dict that auto_clean() follows.

    NEW FUNCTION — the decision-making brain of Smart Auto mode cleaning.
    The agent does not decide what to clean — this function decides,
    based purely on the statistical profile of the data.

    Decision rules:
        - If any duplicates exist → remove them
        - If outlier density > 2% → decide Z-score vs IQR per numerical column
          using check_normality() (course logic: normal → Z-score, skewed → IQR)
        - If any column has >90% missing → drop it (useless column)
        - Always fill remaining missing values (mean for numerical, mode for categorical)

    If df is provided, runs check_normality() per numerical column to decide
    whether Z-score or IQR is more appropriate for that column.
    If df is not provided (e.g. called from a test), defaults to IQR for all.

    Args:
        profiling_result: the dict returned by profile_dataset()
        df:               optional pandas DataFrame, needed for the normality test

    Returns:
        config: dict describing which cleaning steps to apply
            {
                "fill_numerical_strategy": "mean",
                "fill_categorical_strategy": "mode",
                "remove_duplicates": True,
                "outlier_methods_per_column": {"Age": "zscore", "BMI": "iqr"},
                "columns_to_drop": ["col1", "col2"]
            }
    """
    config = {
        "fill_numerical_strategy":   "mean",
        "fill_categorical_strategy": "mode",
        "remove_duplicates":         False,
        "outlier_methods_per_column": {},   # ← per-column decision
        "columns_to_drop":           []
    }

    total_rows = max(profiling_result.get("total_rows", 1), 1)

    # Decision 1: remove duplicates?
    if profiling_result.get("duplicate_rows", 0) > 0:
        config["remove_duplicates"] = True

    # Decision 2: outlier method per column (Z-score if normal, IQR if not)
    outlier_counts   = profiling_result.get("outlier_counts_per_column", {})
    numerical_cols   = profiling_result.get("numerical_columns", [])
    total_outliers   = sum(outlier_counts.values())

    if numerical_cols and total_rows > 0:
        outlier_pct = (total_outliers / (len(numerical_cols) * total_rows)) * 100
        if outlier_pct > 2:
            for col in numerical_cols:
                if df is not None:
                    # Course logic: check normality → choose method
                    is_normal = check_normality(df, col)
                    config["outlier_methods_per_column"][col] = "zscore" if is_normal else "iqr"
                else:
                    config["outlier_methods_per_column"][col] = "iqr"

    # Decision 3: drop useless columns (>90% missing)
    columns_metadata = profiling_result.get("columns_metadata", {})
    for col, meta in columns_metadata.items():
        if meta.get("missing_pct", 0) > 90:
            config["columns_to_drop"].append(col)

    return config


def auto_clean(df, profiling_result, target_column=None):
    """
    One-call complete automatic cleaning pipeline.

    NEW FUNCTION — called by pipelines.run_auto_pipeline() in Smart Auto mode.

    Applies all cleaning operations decided by build_auto_clean_config() in sequence.
    Returns both the cleaned DataFrame AND a human-readable summary list.
    The summary list becomes the transparent activity log shown to the user.

    Example summary output:
        [
            "Dropped 1 column with >90% missing values: ['old_id']",
            "Removed 3 duplicate rows",
            "Filled 12 missing values in 'Age' using mean (31.4)",
            "Filled 5 missing values in 'Gender' using mode ('Male')",
            "Removed 4 outliers from 'BMI' using IQR method"
        ]

    Args:
        df:               pandas DataFrame to clean
        profiling_result: the dict returned by profile_dataset()
        target_column:    name of the target column (to avoid removing its outliers)

    Returns:
        tuple: (cleaned_df, summary_list)
    """
    summary = []
    config  = build_auto_clean_config(profiling_result, df)

    # ── Step 1: Drop useless columns ──────────────────────────────────────
    if config["columns_to_drop"]:
        df = drop_columns(df, config["columns_to_drop"])
        summary.append(
            f"Dropped {len(config['columns_to_drop'])} column(s) with >90% missing values: "
            f"{config['columns_to_drop']}"
        )

    # ── Step 2: Remove duplicate rows ──────────────────────────────────────
    if config["remove_duplicates"]:
        df, removed = remove_duplicates(df)
        if removed > 0:
            summary.append(f"Removed {removed} duplicate row(s)")

    # ── Step 3: Fill missing values in numerical columns ─────────────────────
    numerical_cols = df.select_dtypes(include=[np.number]).columns
    strategy       = config["fill_numerical_strategy"]
    for col in numerical_cols:
        missing = int(df[col].isna().sum())
        if missing > 0:
            if strategy == "mean":
                fill_val = round(float(df[col].mean()), 4)
                df       = fill_missing_with_mean(df, col)
            else:
                fill_val = round(float(df[col].median()), 4)
                df       = fill_missing_with_median(df, col)
            summary.append(
                f"Filled {missing} missing value(s) in '{col}' using {strategy} ({fill_val})"
            )

    # ── Step 4: Fill missing values in categorical columns ─────────────────────
    categorical_cols = df.select_dtypes(include=["object", "category"]).columns
    for col in categorical_cols:
        missing = int(df[col].isna().sum())
        if missing > 0:
            mode_val = df[col].mode().iloc[0] if not df[col].mode().empty else "Unknown"
            df       = fill_missing_categorical(df, col, strategy="mode")
            summary.append(
                f"Filled {missing} missing value(s) in '{col}' using mode ('{mode_val}')"
            )

    # ── Step 5: Remove outliers using per-column method ──────────────────────
    outlier_methods = config.get("outlier_methods_per_column", {})
    if outlier_methods:
        # Refresh the numerical column list after previous steps
        numerical_cols = df.select_dtypes(include=[np.number]).columns
        for col in numerical_cols:
            # NEVER remove outliers from the target column
            if target_column and col == target_column:
                continue
            method = outlier_methods.get(col)
            if method is None:
                continue
            original_len = len(df)
            if method == "zscore":
                df = remove_outliers_zscore(df, col)
            else:
                df = remove_outliers_iqr(df, col)
            removed = original_len - len(df)
            if removed > 0:
                summary.append(
                    f"Removed {removed} outlier(s) from '{col}' using {method.upper()} method"
                )

    return df, summary
