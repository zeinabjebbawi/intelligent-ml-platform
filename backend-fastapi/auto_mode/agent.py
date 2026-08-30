"""
Auto Mode's FastAPI surface. Prefix /auto-mode.

Every route wrapped in try/except -> HTTPException, matching this
codebase's standing convention (an unhandled exception reaches Starlette's
ServerErrorMiddleware, which sits outside CORSMiddleware, producing a bare
CORS-header-less response the browser reports as an undebuggable
"Failed to fetch").
"""
from typing import Optional, Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import runner

router = APIRouter(prefix="/auto-mode", tags=["Auto Mode"])


class StartReq(BaseModel):
    project_id: str
    jwt_token: str
    file_path: str
    task_type: str            # classification | regression | clustering
    target_column: Optional[str] = None
    user_intent: str = "Run the complete ML pipeline automatically"


class StartResp(BaseModel):
    run_id: str


class ResumeReq(BaseModel):
    jwt_token: str
    action: str                # approve | edit | reject
    payload: Dict[str, Any] = {}
    reason: Optional[str] = None


@router.post("/run", response_model=StartResp)
def start(req: StartReq):
    try:
        run_id = runner.start_run(req.project_id, req.jwt_token, req.file_path, req.task_type,
                                   req.target_column, req.user_intent)
        return StartResp(run_id=run_id)
    except Exception as e:
        raise HTTPException(500, f"Could not start Auto Mode run: {e}")


@router.get("/status/{run_id}")
def status(run_id: str):
    try:
        entry = runner.get_status(run_id)
        if entry is None:
            raise HTTPException(404, f"No Auto Mode run with id {run_id}")
        last_state = entry.get("last_state") or {}
        model_history = last_state.get("model_history") or []
        latest_attempt = model_history[-1] if model_history else {}
        return {
            "run_id": run_id,
            "status": entry.get("status"),
            "interrupt": entry.get("interrupt"),
            "error": entry.get("error"),
            "note": entry.get("note"),
            "current_node": last_state.get("current_node"),
            "completed_nodes": last_state.get("completed_nodes", []),
            "final_summary": last_state.get("final_summary"),
            # The rest of these mirror exactly what a MANUAL TrainTest.jsx /
            # FeatureSelectionPage run hands up to App.jsx via onUpdateData
            # (lastModelPath, lastModelName, lastMetrics, trainRatio,
            # selectedFeatures) - without them, App.jsx has nothing to wire
            # into lastModelPath/reportContext once an Auto Mode run
            # finishes, which is exactly why the Report page's download-
            # model link and every later page (Feature Importance, Learning
            # Curve, Simulator) showed nothing after a completed run: they
            # all read from that same App.jsx state, which Auto Mode was
            # never populating.
            "model_pkl_path": last_state.get("model_pkl_path"),
            "model_name": last_state.get("model_name"),
            "model_metrics": latest_attempt.get("metrics", {}),
            "train_ratio": (last_state.get("training_config") or {}).get("split_ratio", 0.80),
            "selected_features": last_state.get("selected_features", []),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Could not fetch run status: {e}")


@router.post("/resume/{run_id}")
def resume(run_id: str, req: ResumeReq):
    try:
        if req.action not in ("approve", "edit", "reject"):
            raise HTTPException(400, f"action must be approve|edit|reject, got {req.action!r}")
        ok = runner.resume_run(run_id, req.jwt_token, req.action, req.payload, req.reason)
        if not ok:
            raise HTTPException(409, f"Run {run_id} is not currently paused/resumable.")
        return {"run_id": run_id, "status": "resuming"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Could not resume run: {e}")
