import { useState, useEffect, useCallback } from 'react'
import { versionsAPI } from '../api'

// ─────────────────────────────────────────────────────────────────────────────
// Shared dataset-version-history hook.
//
// Cleaning.jsx (frontend/src/pages/Cleaning.jsx) implements this exact same
// getDisplayPath/registerVersion/isStepDone logic INTERNALLY, self-contained,
// because it predates this hook and is heavily tested — it was deliberately
// left untouched rather than migrated to use this hook, to avoid regressing
// it. This hook exists so every OTHER journey-map page (starting with
// EncodingPage) can get the same behavior via props from a parent (App.jsx /
// eventually JourneyMap.jsx) instead of each page re-implementing its own
// copy. Both this hook and Cleaning.jsx's internal copy talk to the same
// Django DatasetVersion table via versionsAPI, and since only one journey-map
// page is ever mounted at a time in this app, there is no consistency risk
// from having two independent in-memory copies of the same server state.
//
// STEP_ORDER is mirrored a third time here (already duplicated between
// backend-django/datasets/models.py and Cleaning.jsx's own top-level
// constant, by established project convention — see docs/PROJECT_HANDOFF.md
// §8). If you ever add/reorder a step, update all three.
// ─────────────────────────────────────────────────────────────────────────────
export const STEP_ORDER = {
  upload: 1, diagnose: 2,
  cleaning_duplicates: 3, cleaning_outliers: 4, cleaning_missing: 5,
  encoding: 6, feature_engineering: 7,
  sampling: 8, data_readiness: 9, feature_selection: 10,
  training: 11, feature_impact: 12, report: 13,
}

export default function useVersionHistory(projectId, initialFilePath) {
  const [versions, setVersions] = useState(() => (
    initialFilePath
      ? [{ id: null, stepName: 'upload', label: 'Original Dataset', filePath: initialFilePath, rowCount: null }]
      : []
  ))

  // refresh is a standalone callback (not just useEffect-internal) so a
  // caller can force a re-hydration after doing something Django-side that
  // this hook wasn't itself responsible for — e.g. App.jsx uploading a file
  // directly through Django's real upload endpoint on the Upload page,
  // which creates version 1 ('upload') outside of registerVersion entirely.
  const refresh = useCallback(async () => {
    if (!projectId) return
    try {
      const { data } = await versionsAPI.list(projectId)
      if (data.length) {
        setVersions(data.map(v => ({
          id: v.id, stepName: v.step_name, label: v.version_label,
          filePath: v.file_path, rowCount: v.row_count, versionNumber: v.version_number,
        })))
      }
    } catch { /* Django unavailable — local-only tracking still works */ }
  }, [projectId])

  // Hydrate from Django on mount / whenever projectId becomes available —
  // same "optional backend never breaks the page" principle used throughout
  // this project (e.g. DatasetUploadView's FastAPI profiling call).
  useEffect(() => { refresh() }, [refresh])

  // Show THIS step's own version (the output) if one exists; otherwise fall
  // back to the nearest earlier version (the input); otherwise the initial
  // file. Mirrors Cleaning.jsx's getDisplayPath exactly — see its comment
  // for why "always show the input, never the output" was a real bug.
  const getDisplayPath = useCallback((stepName) => {
    const thisStepVersion = versions.find(v => v.stepName === stepName)
    if (thisStepVersion) return thisStepVersion.filePath

    const order = STEP_ORDER[stepName] ?? 99
    const candidates = versions
      .filter(v => (STEP_ORDER[v.stepName] ?? 99) < order)
      .sort((a, b) => (STEP_ORDER[b.stepName] ?? 99) - (STEP_ORDER[a.stepName] ?? 99))
    return candidates[0]?.filePath || initialFilePath || null
  }, [versions, initialFilePath])

  const isStepDone = useCallback((stepName) =>
    versions.some(v => v.stepName === stepName), [versions])

  // ALWAYS the nearest STRICTLY EARLIER version's path — unlike
  // getDisplayPath, this never flips to stepName's own output once one
  // exists. For a page with a permanent "before" table that must never
  // change (not on Apply, not on Redo, not on remount), use this for the
  // before table's data source and for the file every mutating call
  // operates on — never getDisplayPath, which is for callers that
  // deliberately want "whatever the current state of the data is,
  // regardless of who produced it" (e.g. resuming an already-completed
  // step's output view).
  const getInputPath = useCallback((stepName) => {
    const order = STEP_ORDER[stepName] ?? 99
    const candidates = versions
      .filter(v => (STEP_ORDER[v.stepName] ?? 99) < order)
      .sort((a, b) => (STEP_ORDER[b.stepName] ?? 99) - (STEP_ORDER[a.stepName] ?? 99))
    return candidates[0]?.filePath || initialFilePath || null
  }, [versions, initialFilePath])

  // The version this step is CURRENTLY showing, if it has one — lets a
  // caller display something concrete (e.g. "Version: 3") without needing
  // its own copy of the versions array.
  const getVersion = useCallback((stepName) =>
    versions.find(v => v.stepName === stepName) || null, [versions])

  // Keep only versions strictly before this step, then add the new one —
  // removes any existing version for THIS step (redoing never accumulates
  // duplicates) and drops anything downstream. Cascades on the Django side
  // unconditionally too, exactly mirroring Cleaning.jsx's registerVersion.
  const registerVersion = useCallback(async (stepName, filePath, label, rowCount, summary = {}) => {
    const order = STEP_ORDER[stepName] ?? 99
    setVersions(prev => [
      ...prev.filter(v => (STEP_ORDER[v.stepName] ?? 99) < order),
      { id: null, stepName, label, filePath, rowCount },
    ])
    if (!projectId) return null
    try {
      await versionsAPI.cascadeDelete(projectId, stepName)
      const { data } = await versionsAPI.register(projectId, {
        step_name: stepName, file_path: filePath, version_label: label,
        row_count: rowCount || 0, summary,
      })
      setVersions(prev => prev.map(v =>
        (v.stepName === stepName && v.filePath === filePath)
          ? { ...v, id: data.id, versionNumber: data.version_number } : v))
      return data
    } catch {
      return null // Django optional — same resilience principle as elsewhere in this project
    }
  }, [projectId])

  // Undo registering a version for this step, without registering a
  // replacement — used by a page's "Redo/start over" action to genuinely
  // return to the pre-step state (not just hide it client-side), per Global
  // Rule 4: the version that goes away should actually stop existing, not
  // just stop being displayed. Mirrors the cascade-delete Cleaning.jsx's
  // confirmBeforeAction already performs, just without a following register.
  const resetStep = useCallback(async (stepName) => {
    const order = STEP_ORDER[stepName] ?? 99
    setVersions(prev => prev.filter(v => (STEP_ORDER[v.stepName] ?? 99) < order))
    if (!projectId) return
    try { await versionsAPI.cascadeDelete(projectId, stepName) } catch { /* Django optional */ }
  }, [projectId])

  return { versions, getDisplayPath, getInputPath, registerVersion, isStepDone, getVersion, resetStep, refresh }
}
