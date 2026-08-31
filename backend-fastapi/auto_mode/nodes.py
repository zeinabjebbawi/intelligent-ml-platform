"""
One function per graph node. Big-decision nodes follow one fixed shape,
which matters for LangGraph's interrupt() semantics: on resume, LangGraph
RE-RUNS the node function from the top (not from the interrupt point) —
only the interrupt() call itself short-circuits and returns the stored
resume value instead of pausing again. That means everything BEFORE the
interrupt() call may execute twice (once to reach the pause, once more on
resume) — fine for read-only tool calls and the LLM decision itself
(idempotent, no side effects), but never fine for a mutating tool call
(remove_duplicates, register_version, ...). So every decision node is
structured as:

    1. gather read-only context (profile/analyze calls)
    2. LLM decision -> proposal
    3. decision = interrupt({...proposal...})   <- pauses here on first pass
    4. handle reject (raise AbortRun) / edit (merge overrides)
    5. mutating tool calls + version registration   <- only ever reached once
    6. return the state update dict

Every stage that mutates the dataset (cleaning, encoding, feature
engineering, sampling, feature selection, training) now follows a uniform
two-phase pattern end to end:
  PROPOSE  — a decide-node above, gated by a real approve/edit/reject
             checkpoint (checkpoint_type varies, review_only: False)
  REVIEW   — a tiny node_review_* below, run immediately after the mutation
             lands and its version is registered. Its ENTIRE body before
             interrupt() is a read of already-computed `state` fields (no
             tool calls) — deliberately, so re-running it from the top on
             resume is trivially side-effect-free. It only offers
             "continue" (review_only: True); rejecting still aborts the
             whole run, for a consistent safety valve, but there is
             nothing to "edit" at a pure review step.
This is what lets the user watch the REAL page behind the Auto Mode panel
actually update (App.jsx's syncToAutoModeNode fires on every current_node
change) before being asked to confirm the NEXT stage's plan, mirroring
the same "try it, see the real result, then decide" rhythm Manual Mode
already has on every page.
"""
import json
from typing import Any, Dict, List

from . import tools, django_client as dj
from .state import PRISMState, AbortRun, resolve_input_path, resolve_display_path, STEP_ORDER
from .llm import decide
from . import prompts as P
from . import model_configs as MC

try:
    from langgraph.types import interrupt
except ImportError:  # pragma: no cover - only true before requirements are installed
    def interrupt(payload):  # type: ignore
        raise RuntimeError("langgraph is not installed - see backend-fastapi/auto_mode/README.md")


LOOP_BACK_CAP = 2
TRAINING_ATTEMPT_CAP = 3

# training_router.metric_to_sklearn() only recognizes these 4 strings for
# classification (anything else falls back to "accuracy") and ignores the
# metric entirely for regression (always optimizes R2 there) - so this
# only needs to translate the classification-shaped goals.
_GOAL_TO_METRIC = {
    "maximize_recall": "recall", "maximize_precision": "precision",
    "maximize_f1": "f1", "maximize_weighted_f1": "f1", "maximize_accuracy": "accuracy",
}


def _metric_for(state: PRISMState) -> str:
    return _GOAL_TO_METRIC.get(state.get("optimization_goal", ""), "accuracy")


def _j(obj: Any, cap: int = 4000) -> str:
    try:
        s = json.dumps(obj, default=str)
    except TypeError:
        s = str(obj)
    return s if len(s) <= cap else s[:cap] + " …(truncated)"


def _checkpoint(checkpoint_type: str, proposal: Dict[str, Any], reasoning: str) -> Dict[str, Any]:
    """Pauses the graph (first pass) or returns the stored human decision
    (resume pass). Decision shape: {"action": "approve"|"edit"|"reject",
    "payload": {...}, "reason": "..."}."""
    return interrupt({"checkpoint_type": checkpoint_type, "proposal": proposal, "reasoning": reasoning,
                       "review_only": False})


def _resolve(decision: Dict[str, Any], proposal_model) -> Any:
    """Applies approve/edit/reject to a Pydantic proposal. Raises AbortRun
    on reject (caught by runner.py — every version already registered is
    kept, the run just stops advancing)."""
    action = (decision or {}).get("action", "approve")
    if action == "reject":
        raise AbortRun(decision.get("reason") or "User rejected a checkpoint proposal.")
    if action == "edit":
        payload = decision.get("payload") or {}
        return type(proposal_model)(**{**proposal_model.model_dump(), **payload})
    return proposal_model


def _review(review_type: str, summary: Dict[str, Any], message: str) -> None:
    """A pure 'here's what happened, continue when ready' pause — nothing
    to edit, only continue (approve) or stop here (reject). Deliberately
    has NO work before the interrupt() call beyond building a dict from
    already-computed state, so re-running this node from the top on
    resume (LangGraph's own semantic, see the module docstring) is
    completely free of side effects — there is nothing here that could
    double-execute."""
    decision = interrupt({"checkpoint_type": review_type, "proposal": summary, "reasoning": message,
                           "review_only": True})
    if (decision or {}).get("action") == "reject":
        raise AbortRun(decision.get("reason") or f"User stopped after reviewing {review_type}.")


def _log(state: PRISMState, decision_type: str, input_context: dict, decision_output: dict,
         reasoning: str, requires_confirmation: bool = False) -> None:
    dj.log_decision(state["project_id"], state.get("experiment_id"), decision_type,
                     input_context, decision_output, reasoning, state["jwt_token"], requires_confirmation)


def _register(state: PRISMState, step_name: str, file_path: str, row_count: int, col_count: int,
              label: str, summary: dict) -> List[dict]:
    """BLOCKING - must succeed. Cascades first (idempotent no-op if nothing
    downstream exists yet), matching Manual Mode's own registerVersion
    semantics (frontend/src/hooks/useVersionHistory.js)."""
    dj.cascade_delete(state["project_id"], step_name, state["jwt_token"])
    resp = dj.register_version(state["project_id"], step_name, file_path, state["jwt_token"],
                                version_label=label, row_count=row_count, col_count=col_count, summary=summary)
    kept = [v for v in state.get("dataset_versions", []) if STEP_ORDER.get(v["step_name"], 99) < STEP_ORDER.get(step_name, 99)]
    kept.append({"step_name": step_name, "file_path": file_path, "row_count": row_count,
                 "version_number": resp.get("version_number", 0), "django_version_id": resp.get("id", "")})
    return kept


def _completed(state: PRISMState, node_name: str) -> List[str]:
    done = list(state.get("completed_nodes", []))
    if node_name not in done:
        done.append(node_name)
    return done


def _err(state: PRISMState, msg: str) -> List[str]:
    return list(state.get("errors", [])) + [msg]


# ─────────────────────────────────────────────────────────────────────────
# INTAKE
# ─────────────────────────────────────────────────────────────────────────

def node_intake(state: PRISMState) -> dict:
    project_id, jwt = state["project_id"], state["jwt_token"]
    versions: List[dict] = []
    completed: List[str] = []
    try:
        real_versions = dj.list_versions(project_id, jwt)
        for v in real_versions:
            step = v.get("step_name")
            if not step:
                continue
            versions.append({"step_name": step, "file_path": v.get("file_path"),
                              "row_count": v.get("row_count", 0),
                              "version_number": v.get("version_number", 0),
                              "django_version_id": v.get("id", "")})
            if step not in completed:
                completed.append(step)
    except dj.DjangoCallError as e:
        # No prior versions reachable - start cold from the original upload.
        # Not fatal: register_version's own cascade-delete-first call later
        # will simply find nothing to clean up.
        return {
            "dataset_versions": [{"step_name": "upload", "file_path": state["original_file_path"],
                                   "row_count": 0, "version_number": 1, "django_version_id": ""}],
            "completed_nodes": ["intake"],
            "current_node": "diagnose",
            "errors": _err(state, f"[intake] could not load prior version history (starting cold): {e}"),
        }

    if not any(v["step_name"] == "upload" for v in versions):
        versions.insert(0, {"step_name": "upload", "file_path": state["original_file_path"],
                             "row_count": 0, "version_number": 1, "django_version_id": ""})

    experiment_id = dj.start_experiment(project_id, state["task_type"], state.get("target_column"), jwt)
    resuming_from = max(completed, key=lambda s: STEP_ORDER.get(s, 0)) if completed else "upload"

    return {
        "dataset_versions": versions,
        "completed_nodes": _completed(state, "intake") + ([c for c in completed if c not in ("upload",)]),
        "experiment_id": experiment_id,
        "current_node": "diagnose",
        "loop_back_count": 0,
        "training_attempts": 0,
        "feature_selection_pass": 0,
        "model_history": [],
        "errors": state.get("errors", []),
        "_intake_note": f"Resuming from existing progress at step: {resuming_from}" if len(completed) > 1 else "Starting cold from the original upload.",
    }


# ─────────────────────────────────────────────────────────────────────────
# DIAGNOSE + CLEANING PLAN — propose checkpoint
# ─────────────────────────────────────────────────────────────────────────

def node_diagnose(state: PRISMState) -> dict:
    file_path = resolve_display_path(state, "diagnose")
    summary = tools.diagnose_analyze(file_path, state["original_file_path"],
                                      state.get("target_column"), state.get("task_type"))
    dup = tools.profile_duplicates(file_path)
    out = tools.profile_outliers_global(file_path)
    miss = tools.profile_missing_global(file_path)

    proposal: P.CleaningPlan = decide(P.CleaningPlan, P.SYSTEM_PROMPT, P.CLEANING_PLAN_PROMPT.format(
        row_count=summary["current"]["row_count"], col_count=summary["current"]["col_count"],
        total_dup_rows=dup["total_dup_rows"], total_groups=dup["total_groups"],
        outlier_summary=_j(out.get("column_summary")),
        missing_per_col=_j(summary["current"]["missing_per_col"]),
        row_completeness=_j(miss.get("row_completeness")),
    ))

    decision = _checkpoint("propose_cleaning", proposal.model_dump(), proposal.reasoning)
    plan = _resolve(decision, proposal)
    _log(state, "cleaning_recommendation", {"health": summary.get("signal")}, plan.model_dump(),
         plan.reasoning, requires_confirmation=True)

    return {
        "diagnose_summary": summary,
        "cleaning_plan": plan.model_dump(),
        "completed_nodes": _completed(state, "diagnose"),
        "current_node": "clean_duplicates",
    }


# ─────────────────────────────────────────────────────────────────────────
# CLEANING EXECUTION — no LLM, no HITL of their own; each just applies its
# slice of the single approved cleaning_plan. Result review happens once,
# after all three have run (node_review_cleaning below).
# ─────────────────────────────────────────────────────────────────────────

def node_clean_duplicates(state: PRISMState) -> dict:
    plan = state["cleaning_plan"]
    input_path = resolve_input_path(state, "cleaning_duplicates")
    stats = dict(state.get("cleaning_stats", {}))
    versions = state.get("dataset_versions", [])

    if plan.get("remove_duplicates"):
        res = tools.remove_duplicates(input_path)
        versions = _register(state, "cleaning_duplicates", res["new_file_path"], res["new_row_count"],
                              0, "Duplicate Removed", {"rows_removed": res["rows_removed"]})
        stats["duplicates_removed"] = res["rows_removed"]

    return {"dataset_versions": versions, "cleaning_stats": stats,
            "completed_nodes": _completed(state, "clean_duplicates"), "current_node": "clean_outliers"}


def node_clean_outliers(state: PRISMState) -> dict:
    plan = state["cleaning_plan"]
    input_path = resolve_input_path(state, "cleaning_outliers")
    stats = dict(state.get("cleaning_stats", {}))
    versions = state.get("dataset_versions", [])
    scope = plan.get("outlier_scope", "skip")

    if scope != "skip":
        indices_resp = tools.get_all_outlier_indices(input_path)
        rows = indices_resp["outlier_indices"]
        if scope == "selective" and plan.get("outlier_columns"):
            per_col = indices_resp.get("per_column_counts", {})
            rows = rows if any(c in per_col for c in plan["outlier_columns"]) else []
        if rows:
            res = tools.remove_outliers(input_path, "__all_columns__", rows)
            versions = _register(state, "cleaning_outliers", res["new_file_path"], res["new_row_count"],
                                  0, "Outliers Removed", {"rows_removed": res["rows_removed"]})
            stats["outliers_removed"] = res["rows_removed"]

    return {"dataset_versions": versions, "cleaning_stats": stats,
            "completed_nodes": _completed(state, "clean_outliers"), "current_node": "clean_missing_cols"}


def node_clean_missing_cols(state: PRISMState) -> dict:
    plan = state["cleaning_plan"]
    input_path = resolve_input_path(state, "cleaning_missing")
    strategies: Dict[str, str] = plan.get("missing_column_strategies") or {}
    versions = state.get("dataset_versions", [])
    current_path = input_path
    imputed_count = 0

    for column, method in strategies.items():
        res = tools.apply_missing_column(current_path, column, method)
        current_path = res.get("new_file_path", current_path)
        imputed_count += 1

    if strategies:
        stats = dict(state.get("cleaning_stats", {}))
        stats["missing_imputed"] = imputed_count
        versions = _register(state, "cleaning_missing", current_path, 0, 0,
                              "Missing Values Imputed", {"columns_imputed": list(strategies.keys())})
        return {"dataset_versions": versions, "cleaning_stats": stats,
                "completed_nodes": _completed(state, "clean_missing_cols"), "current_node": "clean_missing_rows"}

    return {"completed_nodes": _completed(state, "clean_missing_cols"), "current_node": "clean_missing_rows"}


def node_clean_missing_rows(state: PRISMState) -> dict:
    plan = state["cleaning_plan"]
    input_path = resolve_display_path(state, "cleaning_missing")
    min_present = plan.get("row_threshold_min_present", 0)
    versions = state.get("dataset_versions", [])

    profile = tools.profile_missing_global(input_path)
    if min_present and min_present < profile.get("total_cols", 0):
        res = tools.apply_row_threshold(input_path, min_present)
        if res["rows_removed"] > 0:
            versions = _register(state, "cleaning_missing", res["new_file_path"], res["new_row_count"], 0,
                                  "Incomplete Rows Dropped", {"rows_removed": res["rows_removed"]})

    return {"dataset_versions": versions, "completed_nodes": _completed(state, "clean_missing_rows"),
            "current_node": "review_cleaning"}


def node_review_cleaning(state: PRISMState) -> dict:
    _review("review_cleaning", state.get("cleaning_stats", {}),
            "Cleaning is done — here's what changed on the real Cleaning page behind this panel. "
            "Continue when you're ready to move on to Encoding & Scaling.")
    return {"completed_nodes": _completed(state, "review_cleaning"), "current_node": "encode_scale"}


# ─────────────────────────────────────────────────────────────────────────
# ENCODE / SCALE — propose checkpoint (Level-2 rule-based, but now
# confirmed like every other mutating stage, not auto-applied silently)
# ─────────────────────────────────────────────────────────────────────────

def node_encode_scale(state: PRISMState) -> dict:
    input_path = resolve_display_path(state, "encoding")
    profile = tools.encoding_profile(input_path)
    target = state.get("target_column")

    cat_cols = [c for c in profile["columns"] if c["inferred_type"] == "categorical" and c["name"] != target]
    num_cols = [c for c in profile["columns"] if c["inferred_type"] == "numeric" and c["name"] != target]

    proposal: P.EncodingScalingDecision = decide(P.EncodingScalingDecision, P.SYSTEM_PROMPT,
        P.ENCODING_SCALING_PROMPT.format(
            categorical_cols=[c["name"] for c in cat_cols], numeric_cols=[c["name"] for c in num_cols],
            column_profile=_j(cat_cols + num_cols)))

    decision = _checkpoint("propose_encoding", proposal.model_dump(), proposal.reasoning)
    plan = _resolve(decision, proposal)
    _log(state, "cleaning_recommendation", {"cat_cols": len(cat_cols), "num_cols": len(num_cols)},
         plan.model_dump(), plan.reasoning, requires_confirmation=True)

    versions = state.get("dataset_versions", [])
    if plan.encoding or plan.scaling:
        res = tools.encoding_apply(input_path, plan.encoding, plan.scaling)
        versions = _register(state, "encoding", res["new_file_path"], 0, 0,
                              "Encoding & Scaling", {"encoding": plan.encoding, "scaling": plan.scaling})

    return {"dataset_versions": versions, "encoding_decisions": plan.encoding,
            "scaling_decisions": plan.scaling, "completed_nodes": _completed(state, "encode_scale"),
            "current_node": "review_encoding"}


def node_review_encoding(state: PRISMState) -> dict:
    _review("review_encoding",
            {"encoding": state.get("encoding_decisions", {}), "scaling": state.get("scaling_decisions", {})},
            "Encoding & Scaling is applied — here's what changed on the real page behind this panel. "
            "Continue when you're ready to confirm the optimization goal.")
    return {"completed_nodes": _completed(state, "review_encoding"), "current_node": "set_goal"}


# ─────────────────────────────────────────────────────────────────────────
# GOAL — propose checkpoint (no dataset mutation of its own, so no review
# step - nothing new appears on a page for this one)
# ─────────────────────────────────────────────────────────────────────────

def node_set_goal(state: PRISMState) -> dict:
    target_quality = (state.get("diagnose_summary") or {}).get("target_quality")
    proposal: P.GoalDecision = decide(P.GoalDecision, P.SYSTEM_PROMPT, P.GOAL_PROMPT.format(
        target_column=state.get("target_column"), task_type=state.get("task_type"),
        user_intent=state.get("user_intent", ""), target_quality=_j(target_quality)))

    decision = _checkpoint("propose_goal", proposal.model_dump(), proposal.goal_reasoning)
    goal = _resolve(decision, proposal)
    _log(state, "goal_detection", {"target_quality": target_quality}, goal.model_dump(),
         goal.goal_reasoning, requires_confirmation=True)

    return {"optimization_goal": goal.optimization_goal, "class_of_interest": goal.class_of_interest,
            "goal_reasoning": goal.goal_reasoning, "completed_nodes": _completed(state, "set_goal"),
            "current_node": "feature_engineer"}


# ─────────────────────────────────────────────────────────────────────────
# FEATURE ENGINEERING — propose checkpoint (skipped on the combine-consume
# pass — that plan was already approved at feature_select's own checkpoint)
# ─────────────────────────────────────────────────────────────────────────

def node_feature_engineer(state: PRISMState) -> dict:
    combine = state.get("feature_combination_instructions") or []
    input_path = resolve_display_path(state, "feature_engineering")
    versions = state.get("dataset_versions", [])

    if combine:
        current_path = input_path
        applied = []
        for spec in combine:
            res = tools.create_feature_apply(current_path, spec["col_a"], spec["col_b"], spec["operation"],
                                              new_col_name=spec.get("new_col_name"), keep_originals=False)
            current_path = res["new_file_path"]
            applied.append(res["new_col_name"])
        versions = _register(state, "feature_engineering", current_path, 0, 0,
                              "Feature Engineering", {"combined": applied})
        return {"dataset_versions": versions, "engineered_features": state.get("engineered_features", []) + applied,
                "feature_combination_instructions": [], "completed_nodes": _completed(state, "feature_engineer"),
                "current_node": "review_feature_engineering"}

    profile = tools.feature_profile(input_path)
    numeric_stats = [{"name": c["name"], **c.get("stats", {})} for c in profile["columns"] if c["inferred_type"] == "numeric"]
    proposal: P.FeatureEngineeringDecision = decide(P.FeatureEngineeringDecision, P.SYSTEM_PROMPT,
        P.FEATURE_ENGINEERING_PROMPT.format(numeric_stats=_j(numeric_stats),
                                             target_column=state.get("target_column"), task_type=state.get("task_type")))

    decision = _checkpoint("propose_feature_engineering", proposal.model_dump(), proposal.reasoning)
    plan = _resolve(decision, proposal)
    _log(state, "cleaning_recommendation", {"numeric_cols": len(numeric_stats)}, plan.model_dump(),
         plan.reasoning, requires_confirmation=True)

    current_path = input_path
    bucketized, created = [], []
    for b in plan.bucketize:
        res = tools.bucketize_apply(current_path, b.column, b.strategy, b.n_bins)
        current_path = res["new_file_path"]
        bucketized.append(res["new_col_name"])
    for f in plan.create_features:
        res = tools.create_feature_apply(current_path, f.col_a, f.col_b, f.operation, new_col_name=f.new_col_name)
        current_path = res["new_file_path"]
        created.append(res["new_col_name"])

    if bucketized or created:
        versions = _register(state, "feature_engineering", current_path, 0, 0,
                              "Feature Engineering", {"bucketized": bucketized, "created": created})

    return {"dataset_versions": versions, "bucketized_cols": bucketized,
            "engineered_features": state.get("engineered_features", []) + created,
            "completed_nodes": _completed(state, "feature_engineer"), "current_node": "review_feature_engineering"}


def node_review_feature_engineering(state: PRISMState) -> dict:
    _review("review_feature_engineering",
            {"bucketized": state.get("bucketized_cols", []), "created": state.get("engineered_features", [])},
            "Feature engineering is applied — here's what changed on the real page behind this panel. "
            "Continue when you're ready to move on to Sampling.")
    return {"completed_nodes": _completed(state, "review_feature_engineering"), "current_node": "sample"}


# ─────────────────────────────────────────────────────────────────────────
# SAMPLING (eval_balance folded in — both read check_target_balance via
# sampling_router.profile_dataset) — propose checkpoint
# ─────────────────────────────────────────────────────────────────────────

def node_sample(state: PRISMState) -> dict:
    if state.get("task_type") == "clustering":
        return {"sampling_applied": False, "completed_nodes": _completed(state, "sample"),
                "current_node": "review_sampling"}

    input_path = resolve_display_path(state, "sampling")
    profile = tools.sampling_profile(input_path, state.get("target_column"), state.get("task_type"))
    target_quality = profile.get("target_info")
    categorical_cols = profile.get("categorical_columns", [])

    proposal: P.SamplingDecision = decide(P.SamplingDecision, P.SYSTEM_PROMPT, P.SAMPLING_PROMPT.format(
        target_quality=_j(target_quality), task_type=state.get("task_type"), row_count=profile["row_count"],
        categorical_cols=categorical_cols))
    # Defense-in-depth beyond the prompt's own instruction: these 3 methods
    # hard-require pure-numeric features (sampling_router.py's
    # _numeric_feature_matrix raises otherwise) - confirmed live, this
    # exact combination (a freshly-bucketized categorical column still
    # present at the sampling step) crashed a real run before this guard
    # existed. oversample (SMOTE) handles mixed data natively, so it's
    # always a safe fallback regardless of what the model chose.
    if categorical_cols and proposal.method in ("adasyn", "borderline_smote", "kmeans_smote"):
        proposal.method = "oversample"

    decision = _checkpoint("propose_sampling", proposal.model_dump(), proposal.reasoning)
    plan = _resolve(decision, proposal)
    # Re-apply the same guard after resolve too, in case an edit tried to
    # set an invalid method while categorical columns are still present.
    if categorical_cols and plan.method in ("adasyn", "borderline_smote", "kmeans_smote"):
        plan.method = "oversample"
    _log(state, "cleaning_recommendation", {"target_quality": target_quality, "categorical_cols": categorical_cols},
         plan.model_dump(), plan.reasoning, requires_confirmation=True)

    versions = state.get("dataset_versions", [])
    if plan.apply_sampling and plan.method:
        res = tools.sampling_apply(input_path, plan.method, sample_pct=plan.sample_pct,
                                    target_col=state.get("target_column"), task_type=state.get("task_type"))
        versions = _register(state, "sampling", res["new_file_path"], res["row_count"], res["col_count"],
                              "Sampled Version", {"method": plan.method})

    return {"dataset_versions": versions, "sampling_applied": plan.apply_sampling,
            "sampling_method": plan.method, "completed_nodes": _completed(state, "sample"),
            "current_node": "review_sampling"}


def node_review_sampling(state: PRISMState) -> dict:
    _review("review_sampling",
            {"applied": state.get("sampling_applied", False), "method": state.get("sampling_method")},
            "Sampling is done — here's what changed on the real page behind this panel. "
            "Continue when you're ready to move on to Feature Selection.")
    return {"completed_nodes": _completed(state, "review_sampling"), "current_node": "feature_select"}


# ─────────────────────────────────────────────────────────────────────────
# FEATURE SELECTION — propose checkpoint; combine-loop pass counter
# ─────────────────────────────────────────────────────────────────────────

def node_feature_select(state: PRISMState) -> dict:
    input_path = resolve_input_path(state, "feature_selection")
    analysis = tools.feature_selection_analyze(input_path, state.get("target_column"), state.get("task_type"))
    pass_number = state.get("feature_selection_pass", 0)

    proposal: P.FeatureSelectionDecision = decide(P.FeatureSelectionDecision, P.SYSTEM_PROMPT,
        P.FEATURE_SELECTION_PROMPT.format(features=_j(analysis["features"]),
                                           multicol_pairs=_j(analysis.get("multicol_pairs")),
                                           pass_number=pass_number))
    if pass_number >= 1:
        proposal.combine_instead = []

    decision = _checkpoint("propose_feature_selection", proposal.model_dump(), proposal.reasoning)
    plan = _resolve(decision, proposal)
    _log(state, "cleaning_recommendation", {"pass": pass_number, "n_features": len(analysis["features"])},
         plan.model_dump(), plan.reasoning, requires_confirmation=True)

    if plan.combine_instead:
        return {"feature_combination_instructions": [c.model_dump() for c in plan.combine_instead],
                "feature_selection_pass": pass_number + 1,
                "completed_nodes": _completed(state, "feature_select"), "current_node": "feature_engineer"}

    versions = state.get("dataset_versions", [])
    if plan.features_to_drop:
        res = tools.feature_selection_apply(input_path, state.get("target_column"), plan.features_to_keep)
        versions = _register(state, "feature_selection", res["new_file_path"], res["row_count"], res["col_count"],
                              "Feature Selected Version", {"dropped": res["features_dropped"]})

    return {"dataset_versions": versions, "selected_features": plan.features_to_keep,
            "dropped_features": plan.features_to_drop, "feature_selection_pass": pass_number + 1,
            "completed_nodes": _completed(state, "feature_select"), "current_node": "review_feature_selection"}


def node_review_feature_selection(state: PRISMState) -> dict:
    _review("review_feature_selection",
            {"kept": state.get("selected_features", []), "dropped": state.get("dropped_features", [])},
            "Feature selection is applied — here's what changed on the real page behind this panel. "
            "Continue when you're ready to confirm the model.")
    return {"completed_nodes": _completed(state, "review_feature_selection"), "current_node": "select_model"}


# ─────────────────────────────────────────────────────────────────────────
# MODEL SELECTION — propose checkpoint
# ─────────────────────────────────────────────────────────────────────────

def node_select_model(state: PRISMState) -> dict:
    input_path = resolve_display_path(state, "training")
    target = state.get("target_column")
    task_type = state.get("task_type")
    valid_models = MC.MODELS_BY_TASK.get(task_type, [])
    defaults = tools.training_defaults(input_path, target)

    elbow_section = ""
    elbow_ctx: Dict[str, Any] = {}
    if task_type == "clustering":
        elbow = tools.elbow_kmeans(input_path)
        elbow_ctx = elbow
        elbow_section = f"K-Means elbow curve (inertia per k): {_j(elbow)}"
    elif task_type == "classification" and "knn" in valid_models:
        elbow = tools.elbow_knn(input_path, target)
        elbow_ctx = elbow
        elbow_section = f"KNN elbow curve (score per k, IF you choose knn): {_j(elbow)}"

    proposal: P.ModelSelectionDecision = decide(P.ModelSelectionDecision, P.SYSTEM_PROMPT,
        P.MODEL_SELECTION_PROMPT.format(
            row_count=defaults["row_count"], feature_count=defaults.get("feature_count"),
            task_type=task_type, optimization_goal=state.get("optimization_goal"),
            balance_level=_j((state.get("diagnose_summary") or {}).get("target_quality")),
            n_skewed=_j((state.get("diagnose_summary") or {}).get("current", {}).get("skewness")),
            valid_models=valid_models, suggested_defaults=_j(defaults), elbow_section=elbow_section))

    if proposal.model_name not in valid_models:
        proposal.model_name = valid_models[0]

    decision = _checkpoint("propose_model_selection", proposal.model_dump(), proposal.reasoning)
    plan = _resolve(decision, proposal)
    _log(state, "model_selection", {"defaults": defaults, "elbow": elbow_ctx}, plan.model_dump(),
         plan.reasoning, requires_confirmation=True)

    return {
        "model_name": plan.model_name,
        "training_config": {
            "use_grid_search": plan.use_grid_search, "split_method": plan.split_method,
            "split_ratio": plan.split_ratio, "cv_folds": plan.cv_folds, "stratified": plan.stratified,
            "k_value": plan.k_value,
        },
        "completed_nodes": _completed(state, "select_model"), "current_node": "train",
    }


# ─────────────────────────────────────────────────────────────────────────
# TRAIN
# ─────────────────────────────────────────────────────────────────────────

def _run_training(state: PRISMState, extra_params: dict):
    """Returns (result, params_actually_used) — /train's own response has
    no 'model_params' field (verified against training_router.py directly),
    so the params used have to be tracked here, not read back from the
    response, or model_history's 'params' would silently always be empty."""
    input_path = resolve_display_path(state, "training")
    target = state.get("target_column")
    task_type = state["task_type"]
    model_name = state["model_name"]
    cfg = state.get("training_config", {})

    params: Dict[str, Any] = dict(extra_params)
    if cfg.get("k_value") and not extra_params:
        params["n_neighbors" if model_name == "knn" else "n_clusters"] = cfg["k_value"]

    metric = _metric_for(state)
    if cfg.get("use_grid_search") and model_name != "kmeans" and not extra_params:
        grid = MC.default_param_grid(model_name)
        if grid:
            try:
                gs = tools.grid_search(input_path, target, task_type, model_name, grid,
                                        metric=metric, cv_folds=cfg.get("cv_folds", 5),
                                        stratified=cfg.get("stratified", True))
                params.update(gs.get("best_params", {}))
            except RuntimeError:
                pass  # grid search is an optimization, not a requirement - fall back to defaults

    result = tools.train_model(input_path, target, task_type, model_name, params,
                                split_method=cfg.get("split_method", "train_test"),
                                split_ratio=cfg.get("split_ratio", 0.80), cv_folds=cfg.get("cv_folds", 5),
                                stratified=cfg.get("stratified", True), metric=metric)
    return result, params


def _make_attempt(attempt_no: int, state: PRISMState, result: dict, params: dict) -> dict:
    return {"attempt": attempt_no, "model_name": state["model_name"], "params": params,
            "metrics": {k: v for k, v in result.items() if k not in ("model_viz", "cluster_viz", "preview_rows")},
            "pkl_path": result["model_file"], "verdict": ""}


def node_train(state: PRISMState) -> dict:
    result, params = _run_training(state, {})
    attempt = _make_attempt(1, state, result, params)
    return {"model_pkl_path": result["model_file"], "model_history": [attempt],
            "training_attempts": 1, "completed_nodes": _completed(state, "train"), "current_node": "eval_metrics"}


def node_retry_train(state: PRISMState) -> dict:
    # param_adjustments from eval_metrics' EvalMetricsDecision, merged over
    # the previous attempt's own params (not the grid-search/elbow defaults
    # again - a retry means "adjust what was just tried", not "start over").
    history = list(state.get("model_history", []))
    prev_params = dict(history[-1]["params"]) if history else {}
    prev_params.update(state.get("_retry_param_adjustments") or {})
    result, params = _run_training(state, prev_params)
    attempt = _make_attempt(len(history) + 1, state, result, params)
    history.append(attempt)
    return {"model_pkl_path": result["model_file"], "model_history": history,
            "training_attempts": state.get("training_attempts", 1) + 1,
            "completed_nodes": _completed(state, "retry_train"), "current_node": "eval_metrics"}


# ─────────────────────────────────────────────────────────────────────────
# EVAL METRICS — no checkpoint of its own for accept/retry (retries are
# bounded and autonomous within TRAINING_ATTEMPT_CAP); loop-back proposals
# ARE HITL-gated, since re-running earlier stages is expensive.
# ─────────────────────────────────────────────────────────────────────────

def node_eval_metrics(state: PRISMState) -> dict:
    history = state.get("model_history", [])
    latest = history[-1] if history else {}
    proposal: P.EvalMetricsDecision = decide(P.EvalMetricsDecision, P.SYSTEM_PROMPT, P.EVAL_METRICS_PROMPT.format(
        optimization_goal=state.get("optimization_goal"), latest_metrics=_j(latest.get("metrics")),
        model_history=_j(history), training_attempts=state.get("training_attempts", 0),
        loop_back_count=state.get("loop_back_count", 0)))

    if state.get("training_attempts", 0) >= TRAINING_ATTEMPT_CAP:
        proposal.action = "accept"
    if state.get("loop_back_count", 0) >= LOOP_BACK_CAP and proposal.action.startswith("loop_back"):
        proposal.action = "accept"

    if proposal.action in ("retry_train", "accept"):
        _log(state, "model_selection", {"latest_metrics": latest.get("metrics")}, proposal.model_dump(), proposal.reasoning)
        if history:
            history[-1] = {**history[-1], "verdict": proposal.verdict}
        # "accept" -> review the final trained result before moving on to
        # Feature Importance/Learning Curve; "retry_train" loops straight
        # back into another attempt with no review in between (only the
        # FINAL settled result gets reviewed, not every intermediate retry).
        next_node = "retry_train" if proposal.action == "retry_train" else "review_training"
        return {"model_history": history, "_retry_param_adjustments": proposal.param_adjustments,
                "completed_nodes": _completed(state, "eval_metrics"), "current_node": next_node}

    # a loop-back is expensive (re-runs several stages) - confirm first
    decision = _checkpoint("loop_back_proposal", proposal.model_dump(), proposal.reasoning)
    plan = _resolve(decision, proposal)
    _log(state, "model_selection", {"latest_metrics": latest.get("metrics")}, plan.model_dump(),
         plan.reasoning, requires_confirmation=True)

    next_node = "sample" if plan.action == "loop_back_sample" else "feature_select"
    return {"loop_back_count": state.get("loop_back_count", 0) + 1,
            "completed_nodes": _completed(state, "eval_metrics"), "current_node": next_node}


def node_review_training(state: PRISMState) -> dict:
    history = state.get("model_history", [])
    latest = history[-1] if history else {}
    _review("review_training",
            {"model_name": state.get("model_name"), "metrics": latest.get("metrics", {}),
             "attempts": len(history)},
            "Training is done — here's the trained model's real result on the page behind this panel. "
            "Continue when you're ready to see Feature Importance and the Learning Curve.")
    return {"completed_nodes": _completed(state, "review_training"), "current_node": "explain"}


# ─────────────────────────────────────────────────────────────────────────
# EXPLAIN — feature impact + learning curve, then a second loop-back check
# ─────────────────────────────────────────────────────────────────────────

def node_explain(state: PRISMState) -> dict:
    input_path = resolve_display_path(state, "training")
    target = state.get("target_column") or ""
    task_type = state["task_type"]
    pkl = state["model_pkl_path"]

    shap_result = None
    lc_result = None
    pattern_type = None
    try:
        shap_result = tools.feature_impact_compute(input_path, target, pkl, task_type)
    except RuntimeError:
        pass
    if task_type != "clustering":
        try:
            lc_result = tools.learning_curve_compute(input_path, target, pkl, task_type)
            pattern_type = (lc_result.get("pattern") or {}).get("type")
        except RuntimeError:
            pass

    if state.get("loop_back_count", 0) >= LOOP_BACK_CAP:
        return {"shap_result": shap_result, "learning_curve_result": lc_result, "pattern_type": pattern_type,
                "completed_nodes": _completed(state, "explain"), "current_node": "review_explain"}

    # SHAP's own beeswarm ranking is the one feature-importance signal
    # computed for EVERY model (weight/gain/coverage only exist for tree
    # models) - the right choice for a model-agnostic "top features" read.
    top_features = [{"feature": b["feature"], "mean_abs_shap": b["mean_abs_shap"]}
                     for b in (shap_result or {}).get("shap", {}).get("beeswarm", [])[:5]]
    fi_suggestion = (shap_result or {}).get("suggestions", [])
    lc_suggestion = (lc_result or {}).get("suggestion", {})
    proposal: P.ExplainLoopbackDecision = decide(P.ExplainLoopbackDecision, P.SYSTEM_PROMPT,
        P.EXPLAIN_LOOPBACK_PROMPT.format(top_features=_j(top_features), fi_suggestion=_j(fi_suggestion),
                                          lc_suggestion=_j(lc_suggestion),
                                          loop_back_count=state.get("loop_back_count", 0)))

    if not proposal.should_loop_back:
        _log(state, "insight_generation", {"pattern_type": pattern_type}, proposal.model_dump(), proposal.reasoning)
        return {"shap_result": shap_result, "learning_curve_result": lc_result, "pattern_type": pattern_type,
                "completed_nodes": _completed(state, "explain"), "current_node": "review_explain"}

    decision = _checkpoint("loop_back_proposal", proposal.model_dump(), proposal.reasoning)
    plan = _resolve(decision, proposal)
    _log(state, "insight_generation", {"pattern_type": pattern_type}, plan.model_dump(), plan.reasoning,
         requires_confirmation=True)

    next_node = plan.target_stage if plan.should_loop_back and plan.target_stage else "review_explain"
    return {"shap_result": shap_result, "learning_curve_result": lc_result, "pattern_type": pattern_type,
            "loop_back_count": state.get("loop_back_count", 0) + (1 if plan.should_loop_back else 0),
            "completed_nodes": _completed(state, "explain"), "current_node": next_node}


def node_review_explain(state: PRISMState) -> dict:
    _review("review_explain",
            {"pattern_type": state.get("pattern_type")},
            "Feature Importance and the Learning Curve are computed — here's what they show on the real "
            "pages behind this panel. Continue when you're ready for the final report.")
    return {"completed_nodes": _completed(state, "review_explain"), "current_node": "report"}


# ─────────────────────────────────────────────────────────────────────────
# REPORT + END — no LLM, no HITL (nothing left to confirm — the run just
# ends here and the real Report page is what the user lands on)
# ─────────────────────────────────────────────────────────────────────────

def node_report(state: PRISMState) -> dict:
    history = state.get("model_history", [])
    latest = history[-1] if history else {}
    report = tools.generate_report(
        original_file_path=state["original_file_path"],
        current_file_path=resolve_display_path(state, "training"),
        target_column=state.get("target_column"), task_type=state["task_type"],
        model_pkl_path=state.get("model_pkl_path"), model_name=state.get("model_name"),
        model_params=latest.get("params", {}), feature_names=state.get("selected_features", []),
        metrics=latest.get("metrics", {}), cleaning_stats=state.get("cleaning_stats", {}),
        feature_engineering_steps=state.get("engineered_features", []),
        shap_top_features=[b.get("feature") for b in (state.get("shap_result") or {}).get("shap", {}).get("beeswarm", [])[:5]],
        pattern_type=state.get("pattern_type"),
        balance_level=((state.get("diagnose_summary") or {}).get("target_quality") or {}).get("level"),
    )
    dj.update_experiment(state["project_id"], state.get("experiment_id"), state["jwt_token"],
                          status="completed", metrics=latest.get("metrics", {}))
    return {"final_summary": report, "completed_nodes": _completed(state, "report"), "current_node": "end"}


def node_end(state: PRISMState) -> dict:
    return {"completed_nodes": _completed(state, "end"), "current_node": "end"}
