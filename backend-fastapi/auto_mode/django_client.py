"""
Synchronous httpx client for Auto Mode's FastAPI-graph -> Django calls.

MUST stay synchronous (httpx.Client, never httpx.AsyncClient): graph nodes
run inside asyncio.to_thread (see runner.py), i.e. as plain sync functions.
An AsyncClient call left un-awaited inside a sync function silently returns
a coroutine object and does nothing — exactly the kind of gap that would
look like "version registered" while nothing reached Django.

Uses the 127.0.0.1 literal, not "localhost" — this machine's dual-stack
DNS resolution (::1 AND 127.0.0.1) plus both backends binding IPv4-only is
a standing, documented landmine for any new cross-service URL in this repo.

Blocking-vs-non-blocking contract (binding, see the approved plan):
  - register_version() / cascade_delete() are BLOCKING and must-succeed.
    A node cannot proceed on an unregistered version, since every
    downstream node resolves its input file from `dataset_versions`
    (auto_mode/state.py's resolve_input_path/resolve_display_path). On
    failure these raise DjangoCallError — callers let it propagate so the
    node fails loudly into state["errors"] rather than continuing on a
    phantom file path.
  - log_decision() / update_experiment() are BEST-EFFORT and NON-BLOCKING.
    Wrapped internally in try/except; failures are swallowed and logged to
    stderr, never raised. A gap in the audit trail is acceptable; a
    pipeline crash over a logging call is not.
"""
import sys
from typing import Optional, Dict, Any, List

import httpx

DJANGO_URL = "http://127.0.0.1:8080"
TIMEOUT = 30.0


class DjangoCallError(RuntimeError):
    pass


def _headers(jwt_token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"}


# ─────────────────────────────────────────────────────────────────────────
# BLOCKING — dataset version registry (backend-django/datasets/version_views.py)
# ─────────────────────────────────────────────────────────────────────────

def list_versions(project_id: str, jwt_token: str) -> List[Dict[str, Any]]:
    try:
        with httpx.Client(timeout=TIMEOUT) as c:
            r = c.get(f"{DJANGO_URL}/api/projects/{project_id}/versions/", headers=_headers(jwt_token))
            r.raise_for_status()
            return r.json()
    except httpx.HTTPError as e:
        raise DjangoCallError(f"list_versions failed: {e}") from e


def register_version(project_id: str, step_name: str, file_path: str, jwt_token: str,
                      version_label: Optional[str] = None, row_count: Optional[int] = None,
                      col_count: Optional[int] = None, summary: Optional[dict] = None) -> Dict[str, Any]:
    body = {
        "step_name": step_name, "file_path": file_path,
        "version_label": version_label or step_name,
        "row_count": row_count or 0, "col_count": col_count or 0,
        "summary": summary or {},
    }
    try:
        with httpx.Client(timeout=TIMEOUT) as c:
            r = c.post(f"{DJANGO_URL}/api/projects/{project_id}/versions/register/",
                       json=body, headers=_headers(jwt_token))
            r.raise_for_status()
            return r.json()
    except httpx.HTTPError as e:
        raise DjangoCallError(f"register_version({step_name}) failed: {e}") from e


def cascade_delete(project_id: str, step_name: str, jwt_token: str) -> Dict[str, Any]:
    try:
        with httpx.Client(timeout=TIMEOUT) as c:
            r = c.delete(f"{DJANGO_URL}/api/projects/{project_id}/versions/cascade/{step_name}/",
                         headers=_headers(jwt_token))
            r.raise_for_status()
            return r.json()
    except httpx.HTTPError as e:
        raise DjangoCallError(f"cascade_delete({step_name}) failed: {e}") from e


# ─────────────────────────────────────────────────────────────────────────
# NON-BLOCKING — Auto Mode audit trail (backend-django/experiments/)
# ─────────────────────────────────────────────────────────────────────────

def start_experiment(project_id: str, task_type: str, target_column: Optional[str],
                      jwt_token: str) -> Optional[str]:
    """Returns the new Experiment's id, or None if Django is unreachable —
    the run still proceeds (best-effort audit trail), just without a
    server-side record of it until Django comes back."""
    try:
        with httpx.Client(timeout=TIMEOUT) as c:
            r = c.post(f"{DJANGO_URL}/api/projects/{project_id}/automode/run/",
                       json={"task_type": task_type, "target_column": target_column or ""},
                       headers=_headers(jwt_token))
            r.raise_for_status()
            return r.json().get("id")
    except httpx.HTTPError as e:
        print(f"[auto_mode.django_client] start_experiment failed (non-fatal): {e}", file=sys.stderr)
        return None


def update_experiment(project_id: str, experiment_id: Optional[str], jwt_token: str, **fields) -> None:
    if not experiment_id:
        return
    try:
        with httpx.Client(timeout=TIMEOUT) as c:
            r = c.patch(f"{DJANGO_URL}/api/projects/{project_id}/automode/run/{experiment_id}/",
                        json=fields, headers=_headers(jwt_token))
            r.raise_for_status()
    except httpx.HTTPError as e:
        print(f"[auto_mode.django_client] update_experiment failed (non-fatal): {e}", file=sys.stderr)


def log_decision(project_id: str, experiment_id: Optional[str], decision_type: str,
                  input_context: dict, decision_output: dict, reasoning: str, jwt_token: str,
                  requires_confirmation: bool = False) -> Optional[Dict[str, Any]]:
    if not experiment_id:
        return None
    try:
        with httpx.Client(timeout=TIMEOUT) as c:
            r = c.post(f"{DJANGO_URL}/api/projects/{project_id}/automode/run/{experiment_id}/decisions/",
                       json={
                           "decision_type": decision_type, "input_context": input_context,
                           "decision_output": decision_output, "reasoning": reasoning,
                           "requires_confirmation": requires_confirmation,
                       },
                       headers=_headers(jwt_token))
            r.raise_for_status()
            return r.json()
    except httpx.HTTPError as e:
        print(f"[auto_mode.django_client] log_decision({decision_type}) failed (non-fatal): {e}", file=sys.stderr)
        return None


def resolve_decision(project_id: str, experiment_id: str, decision_id: str, jwt_token: str,
                      confirmed: bool, user_override: Optional[dict] = None) -> None:
    if not experiment_id:
        return
    try:
        with httpx.Client(timeout=TIMEOUT) as c:
            r = c.patch(
                f"{DJANGO_URL}/api/projects/{project_id}/automode/run/{experiment_id}/decisions/{decision_id}/",
                json={"confirmed": confirmed, "user_override": user_override or {}},
                headers=_headers(jwt_token))
            r.raise_for_status()
    except httpx.HTTPError as e:
        print(f"[auto_mode.django_client] resolve_decision failed (non-fatal): {e}", file=sys.stderr)
