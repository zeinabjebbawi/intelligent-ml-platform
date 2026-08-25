"""
PRISM — Diagnose Router (FastAPI)

Diagnose.jsx is otherwise fully client-side (CSV parsed and edited entirely
in the browser — cell edits, added rows, column deletes/renames — no server
round-trip for any of that). This router exists for exactly ONE reason: so
those live edits can be persisted to a real, on-disk CSV and participate in
the same Django DatasetVersion system every other page uses (versions bar,
download button) instead of vanishing the moment the page is left.

Add to main.py:
    from diagnose_router import router as diagnose_router
    app.include_router(diagnose_router)
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any
import pandas as pd
import os

router = APIRouter(prefix="/diagnose", tags=["Diagnose"])

# ─────────────────────────────────────────────────────────────────────────────
# save_version follows the exact suffix-stripping-then-appending pattern used
# by every other router's save_version helper (encoding_router.py,
# feature_engineering_router.py, feature_selection_router.py) — strip any
# existing "_diagnose_edited" suffix from the ORIGINAL upload's filename
# before re-appending it, so repeated saves during one editing session always
# write to the SAME file (one version, continuously updated) rather than
# chaining a new file per edit.
# ─────────────────────────────────────────────────────────────────────────────
def save_version(df: pd.DataFrame, original_path: str) -> str:
    dir_name  = os.path.dirname(original_path)
    base_name = os.path.splitext(os.path.basename(original_path))[0]
    base_name = base_name.split("_diagnose_edited")[0]
    os.makedirs(dir_name, exist_ok=True)
    new_path = os.path.join(dir_name, f"{base_name}_diagnose_edited.csv")
    df.to_csv(new_path, index=False)
    return new_path

class SaveReq(BaseModel):
    file_path: str                  # the real upstream file (Diagnose's own
                                     # input — i.e. the upload) — used only to
                                     # derive where/what to name the saved file
    columns:   List[str]            # already excludes any column the user
                                     # removed via the Features panel's trash
                                     # icon — a genuine drop, not a soft flag
    rows:      List[Dict[str, Any]] # the full, currently-edited dataset held
                                     # client-side (cell edits + added rows
                                     # already applied)

@router.post("/save")
def save_edits(req: SaveReq):
    try:
        if not req.columns:
            raise HTTPException(400, "No columns to save — every column was removed.")
        # columns=req.columns both fixes column ORDER and drops any stray key
        # a row dict might carry that isn't in the current column list.
        df = pd.DataFrame(req.rows, columns=req.columns)
        new_path = save_version(df, req.file_path)
        return {
            "new_file_path": new_path,
            "row_count":     len(df),
            "col_count":     len(df.columns),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Saving Diagnose edits failed: {str(e)}")
