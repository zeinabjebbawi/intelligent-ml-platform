"""
PLATFORM RULE — TARGET QUALITY / IMBALANCE DETECTION
══════════════════════════════════════════════════════════════════════════
Every router that needs to assess "is this target balanced / usable" MUST
import and call check_target_balance() from this file. Never write inline
balance-threshold logic anywhere else in the backend — that's exactly how
this platform ended up with two different, both-wrong, flat-percentage
implementations (sampling_router.py's old check_imbalance() used minority
percentage cutoffs; visualization_router.py's compute_fingerprint() used a
different min/max ratio) that silently disagreed with each other and both
broke on multiclass targets (a perfectly balanced 10-class target has 10%
per class, which any flat "under 20% = severe" rule misreads as imbalanced).

Why entropy instead of raw percentages: Normalized Shannon Entropy scales
correctly with the number of classes K — 1.0 always means "as even as this
many classes can possibly be," 0.0 always means "one class has everything,"
regardless of whether K is 2 or 20. Flat percentage thresholds have no way
to express that "10% per class" is perfect for K=10 but severe for K=2.

Why regression gets a completely different check: "class balance" is not a
meaningful concept for a continuous target (house prices, temperatures) —
there are no classes to balance. Silently running the classification math
on a regression target makes every row its own "class" of size 1, which
LOOKS like perfect balance (every class equally sized: 1) while being
completely meaningless. Regression targets get skewness/kurtosis instead —
answering "is the target's distribution lopsided enough to hurt training,"
which is the actual analogous concern for continuous data.

Returned `level` is always one of: 'balanced' | 'mild' | 'moderate' |
'severe' | 'invalid' — this exact vocabulary is what every frontend page
(Sampling.jsx, DataReadiness.jsx) keys its color/label off of via the
shared frontend/src/constants/balanceLevels.js map, so the same dataset
gets the same verdict and the same color everywhere in the app.
"""
import numpy as np
import pandas as pd
from typing import Dict, Any, Optional


def check_target_balance(series: pd.Series, task_type: Optional[str] = None) -> Dict[str, Any]:
    """Universal target-variable quality checker — binary, multiclass, and
    regression all go through this one function.

    Classification → Normalized Shannon Entropy + Imbalance Ratio (IR).
    Regression      → |skewness| + kurtosis of the target's distribution.

    `task_type`, if known by the caller ('classification' | 'regression'),
    is trusted as-is. If omitted, a numeric target with high cardinality
    (>20 unique values, or >20% of rows unique) is treated as regression —
    the same threshold visualization_router.py's own is_classification_target()
    already uses elsewhere in this codebase, kept consistent here.

    Guardrails, checked before any balance math runs:
      1. Empty target (all-null) → invalid
      2. ID column: every row is a unique value → invalid
      3. Constant target: only one unique value → invalid
      4. (classification only) minority class < 30 samples → appended
         `starvation_warning`, does not override the computed level — the
         imbalance RATIO and the ABSOLUTE sample count are different risks
         and both deserve to be surfaced.
    """
    clean = series.dropna()
    total = len(clean)
    n_unique = int(clean.nunique())

    if total == 0:
        return {
            "status": "invalid", "level": "invalid",
            "title": "No Target Data",
            "message": "The target column is empty after removing missing values.",
            "is_classification": False, "task_type": "unknown",
            "class_dist": [],
        }

    if n_unique == 1:
        return {
            "status": "invalid", "level": "invalid",
            "title": "Invalid Target — Only One Value",
            "message": (
                "Every row has the exact same target value. There is nothing for a "
                "model to learn — pick a target column that actually varies."
            ),
            "is_classification": False, "task_type": "invalid",
            "n_unique": n_unique, "total_rows": total, "class_dist": [],
        }

    is_numeric = pd.api.types.is_numeric_dtype(clean)
    if task_type is None:
        cardinality_ratio = n_unique / total
        task_type = "regression" if (is_numeric and (n_unique > 20 or cardinality_ratio > 0.20)) else "classification"
    is_classification = task_type != "regression"

    # ID-column guardrail. A genuinely continuous regression target (house
    # prices, sensor readings) LEGITIMATELY has close to 100% unique values —
    # that's normal, not a mistake, so this must not fire just because a
    # numeric column is high-cardinality. It fires when either:
    #   (a) the target is classification-shaped and every row is unique
    #       (there's no way to classify something with zero repeated labels), or
    #   (b) the column's own name looks like an identifier (id/uuid/key/index/
    #       ...) AND every value is unique, regardless of numeric-ness — this
    #       catches the "accidentally selected the row-ID column" mistake even
    #       when the ID happens to be numeric and would otherwise read as a
    #       plausible regression target.
    _ID_KEYWORDS = {'id', 'uuid', 'guid', 'key', 'index', 'identifier', 'rowid'}
    col_name = str(series.name or '').strip().lower().replace('-', '_')
    name_parts = set(col_name.split('_'))
    looks_like_id_name = col_name in _ID_KEYWORDS or bool(name_parts & _ID_KEYWORDS)
    if n_unique == total and total > 1 and (is_classification or looks_like_id_name):
        return {
            "status": "invalid", "level": "invalid",
            "title": "Invalid Target — Looks Like an ID Column",
            "message": (
                f"Every one of the {total} rows has a different value "
                f"({n_unique} unique values total). This looks like an identifier "
                "column, not something a model can learn to predict. Choose a "
                "different target column."
            ),
            "is_classification": False, "task_type": "invalid",
            "n_unique": n_unique, "total_rows": total, "class_dist": [],
        }

    # ═══════════════════════════ REGRESSION PATH ═══════════════════════════
    if not is_classification:
        try:
            skewness = float(clean.skew())
            kurtosis = float(clean.kurtosis())
        except Exception:
            skewness, kurtosis = 0.0, 0.0
        if skewness != skewness:  # NaN guard (e.g. zero-variance after dropna edge cases)
            skewness = 0.0
        if kurtosis != kurtosis:
            kurtosis = 0.0

        abs_skew = abs(skewness)
        if abs_skew < 0.5:
            level, title = "balanced", "Well-Distributed Target"
            message = (
                f"The target is approximately symmetric (skewness = {skewness:.2f}). "
                "Most regression models will train reliably as-is."
            )
        elif abs_skew < 1.0:
            level, title = "mild", "Mild Target Skew"
            message = (
                f"Skewness = {skewness:.2f} — slightly asymmetric. Most models handle this "
                "natively; a Yeo-Johnson transform is optional, not required."
            )
        elif abs_skew < 2.0:
            level, title = "moderate", "Moderate Target Skew"
            message = (
                f"Skewness = {skewness:.2f} — noticeably skewed. The model will likely "
                "underperform on the rare extreme values. A Log or Yeo-Johnson "
                "transform of the target is recommended before training."
            )
        else:
            level, title = "severe", "Highly Skewed Target"
            message = (
                f"Skewness = {skewness:.2f} — extreme skew. Expect the model to "
                "systematically mispredict rare high or low values. A Yeo-Johnson "
                "(or Log, if all values are positive) transform is strongly recommended."
            )

        return {
            "status": level, "level": level,
            "title": title, "message": message,
            "is_classification": False, "task_type": "regression",
            "skewness": round(skewness, 3), "kurtosis": round(kurtosis, 3),
            "n_unique": n_unique, "total_rows": total, "class_dist": [],
        }

    # ═══════════════════════════ CLASSIFICATION PATH ═══════════════════════════
    K = n_unique
    value_counts = clean.value_counts()
    counts = value_counts.values.astype(float)
    proportions = counts / total

    entropy = float(-np.sum(proportions * np.log(proportions + 1e-12)))
    max_entropy = float(np.log(K)) if K > 1 else 1.0
    evenness = round(entropy / max_entropy, 4)

    IR = round(float(counts.max() / counts.min()), 2)
    minority_class = str(value_counts.index[-1])
    min_count = int(counts.min())
    majority_class = str(value_counts.index[0])
    max_count = int(counts.max())

    if evenness >= 0.85 and IR <= 1.5:
        level, title = "balanced", "Well Balanced"
        message = (
            f"Your {K} classes are well distributed (Evenness = {evenness:.2f}, "
            f"IR = {IR:.1f}). Standard ML algorithms will perform reliably."
        )
    elif evenness >= 0.70 and IR <= 3.0:
        level, title = "mild", "Mild Imbalance"
        message = (
            f"Slightly uneven class distribution (Evenness = {evenness:.2f}, "
            f"IR = {IR:.1f}). Most models handle this natively — keep an eye on "
            "per-class precision/recall during evaluation."
        )
    elif evenness >= 0.40 and IR <= 10.0:
        level, title = "moderate", "Moderate Imbalance"
        message = (
            f"Noticeable imbalance (Evenness = {evenness:.2f}, IR = {IR:.1f}). "
            f"'{minority_class}' risks being underrepresented — consider class "
            "weights or stratified sampling, and evaluate with Macro F1 rather "
            "than plain accuracy."
        )
    else:
        level, title = "severe", "Severe Imbalance"
        message = (
            f"Extreme imbalance (Evenness = {evenness:.2f}, IR = {IR:.1f}). "
            f"'{minority_class}' has only {min_count} sample(s) vs {max_count} in "
            f"'{majority_class}'. Plain accuracy will be misleading here — "
            "resampling (e.g. SMOTE) or a specialized technique is recommended."
        )

    starvation_warning = None
    if min_count < 30:
        starvation_warning = (
            f"Critical: the minority class '{minority_class}' has only {min_count} "
            "sample(s) — mathematically too few for robust training regardless of "
            "the balance ratio. More data for this class matters more than resampling."
        )

    class_dist = [
        {"class": str(cls), "count": int(cnt), "pct": round(cnt / total * 100, 1)}
        for cls, cnt in zip(value_counts.index, counts)
    ]

    return {
        "status": level, "level": level,
        "title": title, "message": message,
        "is_classification": True, "task_type": "classification",
        "evenness": evenness, "imbalance_ratio": IR, "n_classes": K,
        "class_dist": class_dist,
        "minority_class": minority_class, "minority_count": min_count,
        "majority_class": majority_class, "majority_count": max_count,
        "starvation_warning": starvation_warning,
        "total_rows": total,
    }


# Score used wherever a single 0-100 number is needed (e.g. the
# Visualization page's Summary radar) instead of the full breakdown above.
# Classification gets a precise continuous score (evenness*100); regression
# and the invalid/edge cases fall back to this bucket-per-level map so every
# task type still produces *some* comparable 0-100 number for the radar.
LEVEL_SCORE = {"balanced": 100, "mild": 75, "moderate": 45, "severe": 10, "invalid": 0}


def balance_score(balance_result: Dict[str, Any]) -> float:
    if balance_result.get("is_classification") and "evenness" in balance_result:
        return round(balance_result["evenness"] * 100, 1)
    return float(LEVEL_SCORE.get(balance_result.get("level"), 50))
