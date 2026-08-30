"""
One Pydantic output schema + one prompt template per big-decision node.
Every decision node uses llm.decide(schema, SYSTEM_PROMPT, human_prompt) —
one structured-output call, reasoning over real computed numbers already
in state, never over anything from a later pipeline stage (Rule 2, No
Reaching Forward).
"""
from typing import Optional, List, Dict, Literal
from pydantic import BaseModel, Field

SYSTEM_PROMPT = """You are PRISM Auto Mode's analyst brain — an expert ML \
data analyst making one specific pipeline decision at a time for a real \
dataset. You are given real, already-computed numbers for the CURRENT \
pipeline stage only (never a later stage's results — that would let you \
silently think for the user instead of reasoning from evidence). Decide \
precisely and justify with the actual numbers you were given, not generic \
ML advice. Never invent a column name, statistic, or hyperparameter value \
that wasn't given to you. Output must match the requested schema exactly."""


# ─────────────────────────────────────────────────────────────────────────
# 1. CLEANING PLAN (duplicates / outliers / missing) — HITL checkpoint 1
# ─────────────────────────────────────────────────────────────────────────

class CleaningPlan(BaseModel):
    remove_duplicates: bool
    remove_outliers: bool
    outlier_scope: Literal["all", "selective", "skip"] = "skip"
    outlier_columns: List[str] = Field(default_factory=list, description="only used when outlier_scope == 'selective'")
    missing_column_strategies: Dict[str, Literal["mean", "mode", "knn", "interpolation", "drop_rows", "drop_column"]] = Field(
        default_factory=dict,
        description="one of these 6 EXACT strings per column — this is the complete real set "
                    "cleaning_router_v2.apply_missing_column supports, there is no 'median' option")
    row_threshold_min_present: int = Field(description="min non-null values a row must have to be kept; "
                                                         "0 or col_count means 'skip this step'")
    reasoning: str


CLEANING_PLAN_PROMPT = """Dataset diagnosis (from visualization_router.analyze):
- row_count={row_count}, col_count={col_count}
- duplicate rows: {total_dup_rows} across {total_groups} groups
- outlier column summary: {outlier_summary}
- missing values per column: {missing_per_col}
- row-completeness distribution (how many rows have N missing values): {row_completeness}

Decide the full cleaning plan: remove duplicates? remove outliers (all \
flagged rows, a selective subset of columns, or skip entirely if outliers \
look like legitimate extreme-but-real values)? a per-column imputation \
method for every column with missing values — choose EXACTLY one of these \
6 real options per column, there is no 'median' option available: \
'mean' (numeric, roughly-normal distribution), 'knn' (numeric, skewed or \
outlier-heavy — more robust than mean, and preferred whenever missingness \
is under ~5%), 'interpolation' (numeric, ordered/sequential data), 'mode' \
(categorical), 'drop_rows' (very few affected rows, safe to just drop \
them), 'drop_column' (column is mostly missing and not worth imputing). \
Also decide a row-completeness threshold (the minimum non-null values a \
row must have to survive — set it to col_count if no row should be \
dropped)."""


# ─────────────────────────────────────────────────────────────────────────
# 2. GOAL / OPTIMIZATION METRIC — HITL checkpoint 2 (after encode_scale,
#    once real computed statistics exist, not at blind intake)
# ─────────────────────────────────────────────────────────────────────────

class GoalDecision(BaseModel):
    optimization_goal: Literal[
        "maximize_recall", "maximize_precision", "maximize_f1", "maximize_weighted_f1",
        "maximize_accuracy", "minimize_mae", "maximize_r2",
    ]
    class_of_interest: Optional[str] = Field(default=None, description="the positive/minority class this goal is about, if applicable")
    goal_reasoning: str


GOAL_PROMPT = """Target column: "{target_column}" (task_type={task_type})
User's own stated intent (may be empty): "{user_intent}"
Class distribution / balance: {target_quality}

Propose the single metric this pipeline should optimize for, with a \
concrete justification using the target's actual name and distribution — \
never a generic answer. Rules of thumb (apply judgement, not a rigid \
if/else): a target name suggesting fraud/churn/failure/disease, or a \
small minority class in a safety/medical-shaped domain, points to \
maximize_recall (missing a positive case is worse than a false alarm); a \
name suggesting spam/click/recommend points to maximize_precision (a \
false positive is more costly than a miss); a balanced binary target \
defaults to maximize_f1; multiclass defaults to maximize_weighted_f1; \
regression defaults to minimize_mae unless the user's intent reads as \
more exploratory/comparative, in which case maximize_r2. This proposal \
will be shown to the user for approval before anything is trained on it —
propose a specific, defensible answer, not a hedge."""


# ─────────────────────────────────────────────────────────────────────────
# 3. ENCODING / SCALING — no HITL (Level-2 rule-based, low-risk, matches
#    how Encoding.jsx itself treats this as suggestion-not-confirmation)
# ─────────────────────────────────────────────────────────────────────────

class EncodingScalingDecision(BaseModel):
    encoding: Dict[str, Literal["label", "one_hot"]] = Field(default_factory=dict)
    scaling: Dict[str, Literal["minmax", "standard", "robust", "none"]] = Field(default_factory=dict)
    reasoning: str


ENCODING_SCALING_PROMPT = """Categorical columns needing an encoding choice \
(target column already excluded): {categorical_cols}
Numeric columns needing a scaling choice (target column already excluded): {numeric_cols}
Per-column profile (suggested_encoding/suggested_scaler + backend's own reason,
dtype, unique_count, stats): {column_profile}

Decide encoding (label vs one_hot — 2 unique values or ordinal-sounding
names -> label; small-cardinality nominal -> one_hot; >15 uniques -> label
to avoid a column explosion) and scaling (robust for high-outlier/skewed
columns, standard for roughly-normal columns, minmax when a bounded [0,1]
range matters, none for already-binary/one-hot columns) for every listed
column. The backend's own suggested_encoding/suggested_scaler are strong
priors — deviate only when the column's actual stats justify it."""


# ─────────────────────────────────────────────────────────────────────────
# 4. FEATURE ENGINEERING (bucketize / combine) — HITL checkpoint 3
# ─────────────────────────────────────────────────────────────────────────

class BucketizeSpec(BaseModel):
    column: str
    strategy: Literal["equal_width", "equal_freq"] = "equal_freq"
    n_bins: int = 5
    reason: str


class CreateFeatureSpec(BaseModel):
    col_a: str
    col_b: str
    operation: Literal["add", "subtract", "multiply", "divide"]
    new_col_name: str
    reason: str


class FeatureEngineeringDecision(BaseModel):
    bucketize: List[BucketizeSpec] = Field(default_factory=list)
    create_features: List[CreateFeatureSpec] = Field(default_factory=list)
    reasoning: str


FEATURE_ENGINEERING_PROMPT = """Numeric column stats (name, skew, min/max/mean): {numeric_stats}
Target column: {target_column} (task_type={task_type})

Decide which columns (if any) are heavily skewed enough that bucketizing
into ordinal bins would help, and whether any two columns have an obvious
domain-meaningful combination (a ratio, sum, or product that would carry
more signal than either column alone) worth creating. Limit yourself to at
most 2 bucketizations and 2 created features. If the dataset already looks
clean and feature-rich, it is correct to return empty lists — do not
invent transformations just to have something to propose."""


# ─────────────────────────────────────────────────────────────────────────
# 5. SAMPLING — no HITL (reversible, cheap to redo, and gated by the
#    goal-confirmation checkpoint's already-approved intent)
# ─────────────────────────────────────────────────────────────────────────

class SamplingDecision(BaseModel):
    apply_sampling: bool
    method: Optional[Literal[
        "simple_random", "stratified", "undersample", "oversample", "random_oversample",
        "adasyn", "borderline_smote", "kmeans_smote",
    ]] = None
    sample_pct: float = 80.0
    reasoning: str


SAMPLING_PROMPT = """Target balance check (check_target_balance() output): {target_quality}
Task type: {task_type}. Row count: {row_count}.
Non-numeric (categorical/bucketed) feature columns still present, if any: {categorical_cols}

Decide whether resampling is needed and, if so, which method: balanced/mild
-> no sampling needed; moderate imbalance with a reasonably sized dataset
(>500 rows) -> stratified undersampling or random_oversample; moderate
imbalance with a small dataset (<=500 rows) -> oversample (SMOTE); severe
imbalance with a large dataset (>1000 rows) -> oversample (SMOTE); severe
imbalance with a small minority class -> adasyn (focuses on hard
borderline cases). Clustering tasks never need this (no target class) —
apply_sampling must be false for task_type='clustering'.

IMPORTANT constraint on method choice: adasyn, borderline_smote, and
kmeans_smote ALL require every feature column to already be numeric — if
categorical_cols is non-empty, do NOT choose any of those three; use
oversample (SMOTE) instead, which supports mixed numeric/categorical
data, or random_oversample (row duplication, works for any column type)."""


# ─────────────────────────────────────────────────────────────────────────
# 6. FEATURE SELECTION (drop vs combine) — HITL checkpoint 4
# ─────────────────────────────────────────────────────────────────────────

class CombineSpec(BaseModel):
    col_a: str
    col_b: str
    operation: Literal["add", "subtract", "multiply", "divide"]
    new_col_name: str
    reason: str


class FeatureSelectionDecision(BaseModel):
    features_to_keep: List[str]
    features_to_drop: List[str]
    combine_instead: List[CombineSpec] = Field(
        default_factory=list,
        description="pairs to combine into one feature INSTEAD of dropping either — only on pass 0")
    reasoning: str


FEATURE_SELECTION_PROMPT = """Per-feature analysis (name, type, signal_tier
[strong/moderate/weak], is_redundant, importance, pearson/mutual-info,
redundancy): {features}
Multicollinearity pairs (|r| >= 0.85): {multicol_pairs}
This is combine-check pass {pass_number} (pass 0 = combine-check is
allowed; pass >= 1 = a combine already happened this run, propose keep/drop
only, combine_instead must be empty).

Decide which features to keep vs drop: keep strong-signal features; drop
weak-and-redundant features; for a redundant pair where BOTH features carry
real signal (both strong or moderate, |r| >= 0.85), prefer proposing to
COMBINE them into one new feature (via combine_instead) over dropping
either outright — only when pass_number == 0. Never drop below 3 total
features. For clustering, judge purely on redundancy (no target column to
correlate against)."""


# ─────────────────────────────────────────────────────────────────────────
# 7. MODEL SELECTION — HITL checkpoint 5
# ─────────────────────────────────────────────────────────────────────────

class ModelSelectionDecision(BaseModel):
    model_name: str = Field(description="must be one of the models listed as valid for this task_type")
    use_grid_search: bool = True
    split_method: Literal["train_test", "cross_validation"] = "train_test"
    split_ratio: float = 0.80
    cv_folds: int = 5
    stratified: bool = True
    k_value: Optional[int] = Field(default=None, description="only for knn/kmeans; the elbow-suggested k unless you have a specific reason to override")
    reasoning: str


MODEL_SELECTION_PROMPT = """Dataset profile: row_count={row_count}, feature_count={feature_count}, \
task_type={task_type}, optimization_goal={optimization_goal}
Balance level: {balance_level}. Skewed feature count: {n_skewed}.
Valid models for this task_type: {valid_models}
Suggested split from training_router.defaults: {suggested_defaults}
{elbow_section}

Select exactly one model from the valid list and the split/CV
configuration. Rules of thumb: row_count<500 -> knn or decision_tree
(fast, interpretable); 500-5000 rows, balanced -> logistic_regression or
random_forest; 500-5000 rows, imbalanced -> random_forest; >5000 rows ->
xgboost; high-dimensional (feature_count>20) -> svm or logistic_regression;
regression with roughly-linear features -> linear_regression, correlated
features -> ridge_regression, non-linear pattern evident ->
random_forest_regressor; clustering is always kmeans. Use
cross_validation over train_test when row_count is small (<1000, matching
training_router's own suggest_k_folds threshold). Turn stratified on for
any classification task that isn't already well-balanced. If k-nearest-
neighbors or k-means was chosen, k_value should normally be the elbow
curve's own best_k unless the curve looks genuinely ambiguous."""


# ─────────────────────────────────────────────────────────────────────────
# 8. EVAL METRICS (accept / retry / loop back) — no HITL on accept/retry;
#    a loop-back proposal is HITL-gated (checkpoint 6, "post-training")
# ─────────────────────────────────────────────────────────────────────────

class EvalMetricsDecision(BaseModel):
    verdict: Literal["good_fit", "overfitting", "underfitting", "needs_more_data", "accept"]
    action: Literal["accept", "retry_train", "loop_back_sample", "loop_back_feature_select"]
    param_adjustments: Dict[str, object] = Field(default_factory=dict)
    reasoning: str


EVAL_METRICS_PROMPT = """optimization_goal={optimization_goal}
Latest attempt metrics: {latest_metrics}
Full model_history this run so far: {model_history}
training_attempts so far: {training_attempts} (hard cap 3)
loop_back_count so far: {loop_back_count} (hard cap 2, shared across the whole run)

Decide: is this result good enough against optimization_goal specifically
(not just accuracy) to accept? If not, is it fixable by retrying the SAME
model with adjusted hyperparameters (action=retry_train,
param_adjustments={{...}})? Or does the pattern suggest the DATA is the
real problem — still imbalanced after training (action=loop_back_sample)
or noisy/redundant features hurting the fit (action=loop_back_feature_select)?
If training_attempts or loop_back_count are already at their cap, you must
return action=accept regardless of fit quality — cite the cap as the
reason."""


# ─────────────────────────────────────────────────────────────────────────
# 9. EXPLAIN-STAGE LOOPBACK CHECK — HITL checkpoint 6
# ─────────────────────────────────────────────────────────────────────────

class ExplainLoopbackDecision(BaseModel):
    should_loop_back: bool
    target_stage: Optional[Literal["sample", "feature_select"]] = None
    reasoning: str


EXPLAIN_LOOPBACK_PROMPT = """Top SHAP features (feature, mean |SHAP|): {top_features}
feature_impact_router's own rule-based low-impact-feature suggestion (if any): {fi_suggestion}
learning_curve_router's own rule-based pattern + suggestion (already computed,
not your own judgement — target is 'sampling'|'training'|'next'): {lc_suggestion}
loop_back_count so far: {loop_back_count} (hard cap 2)

Both backend signals above are real, already-computed rule-based
recommendations (Level 2 — no LLM), not guesses. This checkpoint can only
loop back to one of two places — target_stage='sample' or 'feature_select'
— never back into training itself (a same-model retry already happened,
if warranted, at the eval_metrics step right after training; re-litigating
that here would be redundant). So: lc_suggestion.target == 'sampling'
warrants target_stage='sample'; fi_suggestion naming several near-zero-
impact features warrants target_stage='feature_select'.
lc_suggestion.target == 'training' or 'next' is NOT, by itself, grounds
for looping back here — training-only fixes belong to eval_metrics, not
this checkpoint. If neither condition is met, or loop_back_count is
already at cap, return should_loop_back=false."""
