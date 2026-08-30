"""
PRISM Auto Mode — shared LangGraph state.

Every node reads/writes this one TypedDict. Two things are deliberately
NOT stored here even though they'd be convenient:

  - Per-decision LLM reasoning text -> lives in Django's AgentDecision rows
    (via django_client.log_decision), not duplicated into state, so the
    state a node hands to the next node stays small and numeric.
  - A single flat "file_path" threaded forward -> each node resolves its
    OWN input file from `dataset_versions` (see resolve_input_path /
    resolve_display_path below), mirroring frontend/src/hooks/
    useVersionHistory.js's getInputPath/getDisplayPath split. This is
    what makes a loop-back (e.g. eval_metrics -> sample) correct: re-
    entering `sample` naturally resolves feature_engineering's real
    output, never a stale path left over from whatever ran last.
"""
from typing import TypedDict, Optional, List, Dict, Any

# Mirrors backend-django/datasets/models.py's STEP_ORDER exactly. Keep the
# three other copies (Django, frontend/src/hooks/useVersionHistory.js,
# frontend/src/pages/Cleaning.jsx) in sync if this ever changes.
STEP_ORDER: Dict[str, int] = {
    "upload": 1,
    "diagnose": 2,
    "cleaning_duplicates": 3,
    "cleaning_outliers": 4,
    "cleaning_missing": 5,
    "encoding": 6,
    "feature_engineering": 7,
    "sampling": 8,
    "data_readiness": 9,
    "feature_selection": 10,
    "training": 11,
    "feature_impact": 12,
    "learning_curve": 13,
    "simulator": 14,
    "report": 15,
}


class DatasetVersionEntry(TypedDict):
    step_name: str
    file_path: str
    row_count: int
    version_number: int
    django_version_id: str


class ModelAttempt(TypedDict):
    attempt: int
    model_name: str
    params: Dict[str, Any]
    metrics: Dict[str, Any]
    pkl_path: str
    verdict: str  # good_fit | overfitting | underfitting | needs_more_data


class PendingCheckpoint(TypedDict, total=False):
    checkpoint_type: str      # e.g. "cleaning_plan", "goal_confirmation", ...
    proposal: Dict[str, Any]  # what the agent proposes to do
    reasoning: str


class PRISMState(TypedDict, total=False):
    # ── identity / auth ─────────────────────────────────────────────────
    run_id: str
    project_id: str
    jwt_token: str
    experiment_id: Optional[str]
    user_intent: str

    # ── dataset ──────────────────────────────────────────────────────────
    original_file_path: str
    task_type: str                       # classification | regression | clustering
    target_column: Optional[str]
    dataset_versions: List[DatasetVersionEntry]

    # ── goal (decision #12) ──────────────────────────────────────────────
    optimization_goal: str
    class_of_interest: Optional[str]
    goal_reasoning: str

    # ── per-stage outputs ────────────────────────────────────────────────
    diagnose_summary: Dict[str, Any]
    cleaning_stats: Dict[str, Any]
    encoding_decisions: Dict[str, str]
    scaling_decisions: Dict[str, str]
    engineered_features: List[Dict[str, Any]]
    bucketized_cols: List[str]
    sampling_applied: bool
    sampling_method: Optional[str]
    selected_features: List[str]
    dropped_features: List[str]

    # ── feature_select <-> feature_engineer combine loop ────────────────
    feature_combination_instructions: List[Dict[str, Any]]
    feature_selection_pass: int

    # ── training ─────────────────────────────────────────────────────────
    model_history: List[ModelAttempt]
    best_attempt_idx: int
    model_pkl_path: Optional[str]
    model_name: Optional[str]
    training_attempts: int
    # {use_grid_search, split_method, split_ratio, cv_folds, stratified, k_value}
    # decided once in node_select_model, read by node_train/node_retry_train
    training_config: Dict[str, Any]
    # set by node_eval_metrics when action=="retry_train" (e.g. {"max_depth": 3}
    # for overfitting, or {"n_clusters": k+1} adjusting a clustering k that
    # looked fine by inertia but produced lopsided cluster entropy); consumed
    # once by node_retry_train, merged over the previous attempt's own params
    _retry_param_adjustments: Dict[str, Any]

    # ── post-training ────────────────────────────────────────────────────
    shap_result: Optional[Dict[str, Any]]
    learning_curve_result: Optional[Dict[str, Any]]
    pattern_type: Optional[str]
    final_summary: Optional[Dict[str, Any]]

    # ── control flow ─────────────────────────────────────────────────────
    current_node: str
    completed_nodes: List[str]
    loop_back_count: int
    errors: List[str]
    aborted: bool
    abort_reason: Optional[str]

    # ── HITL ─────────────────────────────────────────────────────────────
    pending_checkpoint: Optional[PendingCheckpoint]

    # ── the single combined cleaning decision made once in node_diagnose,
    #    consumed (no further LLM call) by the four cleaning execution nodes
    cleaning_plan: Dict[str, Any]


class AbortRun(Exception):
    """Raised when the user rejects a HITL checkpoint. Caught by runner.py,
    which finalizes the Django Experiment as status='aborted' — every
    version already registered up to this point is kept (it's real, valid
    work), the graph simply stops advancing further."""
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def resolve_input_path(state: PRISMState, step_name: str) -> str:
    """Nearest strictly-earlier version's file (the getInputPath pattern) —
    NEVER flips to step_name's own output. Use for anything that must
    always operate on / display "before this step ran", including what a
    mutating node actually transforms."""
    order = STEP_ORDER.get(step_name, 99)
    candidates = [v for v in state.get("dataset_versions", []) if STEP_ORDER.get(v["step_name"], 99) < order]
    if not candidates:
        return state["original_file_path"]
    return max(candidates, key=lambda v: STEP_ORDER.get(v["step_name"], 99))["file_path"]


def resolve_display_path(state: PRISMState, step_name: str) -> str:
    """step_name's own output if it already has one, else falls back to
    resolve_input_path. Use for "current state regardless of producer"."""
    own = [v for v in state.get("dataset_versions", []) if v["step_name"] == step_name]
    if own:
        return max(own, key=lambda v: v["version_number"])["file_path"]
    return resolve_input_path(state, step_name)


def latest_completed_step(state: PRISMState) -> Optional[str]:
    versions = state.get("dataset_versions", [])
    if not versions:
        return None
    return max(versions, key=lambda v: STEP_ORDER.get(v["step_name"], 0))["step_name"]
