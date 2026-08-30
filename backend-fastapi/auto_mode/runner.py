"""
Background-thread execution + in-memory run registry + restart recovery.

Verified directly against the installed langgraph version (see
conversation): a paused graph.invoke() returns a dict containing
"__interrupt__": [Interrupt(value=..., id=...)]; the SAME information, for
a thread this process didn't just invoke itself (e.g. after a restart), is
recoverable from the checkpointer via
checkpointer.get_tuple({"configurable": {"thread_id": tid}}).pending_writes,
which contains a ('<task_id>', '__interrupt__', [Interrupt(...)]) entry
while paused.

Uses a plain threading.Thread (not asyncio.to_thread) deliberately: the
FastAPI endpoint needs to return run_id immediately and let the graph keep
running long after the request/response cycle ends — asyncio.to_thread
would require the endpoint coroutine to await the thread's completion,
which is exactly the blocking behavior we're avoiding.
"""
import sys
import threading
import uuid
from typing import Any, Dict, Optional

from langgraph.types import Command

from .graph import prism_graph, get_checkpointer, get_connection
from .state import PRISMState, AbortRun
from . import django_client as dj

# run_id -> {status, interrupt, error, config, project_id, jwt_token, last_state}
# status in: running | paused_hitl | paused_restart | completed | aborted | failed
_registry: Dict[str, Dict[str, Any]] = {}
_registry_lock = threading.Lock()


def _config(run_id: str) -> dict:
    return {"configurable": {"thread_id": run_id}}


def _set(run_id: str, **fields) -> None:
    with _registry_lock:
        _registry.setdefault(run_id, {})
        _registry[run_id].update(fields)


def get_status(run_id: str) -> Optional[Dict[str, Any]]:
    with _registry_lock:
        entry = _registry.get(run_id)
        return dict(entry) if entry else None


def _finalize_from_result(run_id: str, result: dict, project_id: str, jwt_token: str) -> None:
    if "__interrupt__" in result:
        payload = result["__interrupt__"][0].value
        _set(run_id, status="paused_hitl", interrupt=payload, last_state=result, error=None)
        return
    _set(run_id, status="completed", interrupt=None, last_state=result, error=None)


def _execute(run_id: str, initial_state: PRISMState) -> None:
    project_id, jwt_token = initial_state["project_id"], initial_state["jwt_token"]
    _set(run_id, status="running", project_id=project_id, jwt_token=jwt_token, interrupt=None, error=None)
    try:
        result = prism_graph.invoke(initial_state, config=_config(run_id))
        _finalize_from_result(run_id, result, project_id, jwt_token)
    except AbortRun as e:
        dj.update_experiment(project_id, initial_state.get("experiment_id"), jwt_token,
                              status="aborted")
        _set(run_id, status="aborted", interrupt=None, error=str(e))
    except Exception as e:  # noqa: BLE001 - a failed run must surface, never vanish silently
        print(f"[auto_mode.runner] run {run_id} failed: {e}", file=sys.stderr)
        dj.update_experiment(project_id, initial_state.get("experiment_id"), jwt_token, status="failed")
        _set(run_id, status="failed", interrupt=None, error=str(e))


def start_run(project_id: str, jwt_token: str, original_file_path: str, task_type: str,
              target_column: Optional[str], user_intent: str) -> str:
    run_id = str(uuid.uuid4())
    initial_state: PRISMState = {
        "run_id": run_id, "project_id": project_id, "jwt_token": jwt_token,
        "experiment_id": None, "user_intent": user_intent or "Run the complete ML pipeline automatically",
        "original_file_path": original_file_path, "task_type": task_type, "target_column": target_column,
        "dataset_versions": [], "optimization_goal": "", "class_of_interest": None, "goal_reasoning": "",
        "diagnose_summary": {}, "cleaning_stats": {}, "encoding_decisions": {}, "scaling_decisions": {},
        "engineered_features": [], "bucketized_cols": [], "sampling_applied": False, "sampling_method": None,
        "selected_features": [], "dropped_features": [], "feature_combination_instructions": [],
        "feature_selection_pass": 0, "model_history": [], "best_attempt_idx": 0, "model_pkl_path": None,
        "model_name": None, "training_attempts": 0, "training_config": {}, "_retry_param_adjustments": {},
        "shap_result": None,
        "learning_curve_result": None, "pattern_type": None, "final_summary": None,
        "current_node": "intake", "completed_nodes": [], "loop_back_count": 0, "errors": [],
        "aborted": False, "abort_reason": None, "pending_checkpoint": None, "cleaning_plan": {},
    }
    _set(run_id, status="running", project_id=project_id, jwt_token=jwt_token)
    threading.Thread(target=_execute, args=(run_id, initial_state), daemon=True).start()
    return run_id


def resume_run(run_id: str, jwt_token: str, action: str, payload: Optional[dict] = None,
               reason: Optional[str] = None) -> bool:
    """Returns False if run_id isn't known/resumable (e.g. already
    completed/aborted, or genuinely unknown)."""
    entry = get_status(run_id)
    if not entry or entry.get("status") not in ("paused_hitl", "paused_restart"):
        return False
    project_id = entry["project_id"]
    resume_value = {"action": action, "payload": payload or {}, "reason": reason or ""}
    _set(run_id, status="running", jwt_token=jwt_token)

    def _resume_thread():
        try:
            result = prism_graph.invoke(Command(resume=resume_value), config=_config(run_id))
            _finalize_from_result(run_id, result, project_id, jwt_token)
        except AbortRun as e:
            dj.update_experiment(project_id, None, jwt_token, status="aborted")
            _set(run_id, status="aborted", interrupt=None, error=str(e))
        except Exception as e:  # noqa: BLE001
            print(f"[auto_mode.runner] resume of {run_id} failed: {e}", file=sys.stderr)
            _set(run_id, status="failed", interrupt=None, error=str(e))

    threading.Thread(target=_resume_thread, daemon=True).start()
    return True


def recover_incomplete_runs() -> None:
    """Called once at FastAPI startup. Scans the SQLite checkpoint file for
    threads left mid-run by a previous process (crash or restart) and
    re-registers them as status='paused_restart' — NEVER auto-resumed. The
    status-polling endpoint surfaces this distinctly so the frontend can
    ask the user to explicitly confirm before an LLM-driven pipeline
    continues on its own."""
    conn = get_connection()
    checkpointer = get_checkpointer()
    try:
        thread_ids = [row[0] for row in conn.execute("SELECT DISTINCT thread_id FROM checkpoints").fetchall()]
    except Exception:
        return  # table doesn't exist yet - nothing to recover

    for tid in thread_ids:
        if tid in _registry:
            continue
        try:
            tup = checkpointer.get_tuple({"configurable": {"thread_id": tid}})
        except Exception:
            continue
        if tup is None:
            continue
        channel_values = tup.checkpoint.get("channel_values", {}) or {}
        if channel_values.get("current_node") == "end":
            continue  # already finished cleanly, nothing to recover
        is_interrupted = any(w[1] == "__interrupt__" for w in (tup.pending_writes or []))
        interrupt_payload = None
        if is_interrupted:
            for w in tup.pending_writes:
                if w[1] == "__interrupt__" and w[2]:
                    interrupt_payload = w[2][0].value
                    break
        with _registry_lock:
            _registry[tid] = {
                "status": "paused_restart",
                "interrupt": interrupt_payload,
                "project_id": channel_values.get("project_id"),
                "jwt_token": channel_values.get("jwt_token"),
                "last_state": channel_values,
                "error": None,
                "note": f"Recovered after a server restart, was mid-run at: {channel_values.get('current_node')}",
            }
