// frontend/src/api.js
// ─────────────────────────────────────────────────────────────────────────────
// Two API configurations: Django for app operations, FastAPI for ML operations
// ─────────────────────────────────────────────────────────────────────────────

import axios from 'axios'

// Django API (auth, upload, projects, database)
//
// Uses the 127.0.0.1 literal rather than "localhost": on a dual-stack
// machine "localhost" can resolve to ::1 (IPv6) as well as 127.0.0.1
// (IPv4), and both Django and FastAPI here only bind IPv4. If a browser's
// fetch happens to resolve "localhost" to ::1 first, the connection fails
// before any HTTP/CORS handling even runs, surfacing as a bare "Failed to
// fetch" with no further detail. Using the literal IPv4 address sidesteps
// the ambiguity entirely.
export const djangoAPI = axios.create({
  baseURL: 'http://127.0.0.1:8080',
  headers: { 'Content-Type': 'application/json' },
})

// FastAPI ML engine (profiling, training, what-if)
export const mlAPI = axios.create({
  baseURL: 'http://127.0.0.1:8001',
  headers: { 'Content-Type': 'application/json' },
})

// ─────────────────────────────────────────────────────────────────────────────
// Attach JWT token to every Django request automatically
// The token is stored in localStorage after login
// ─────────────────────────────────────────────────────────────────────────────
djangoAPI.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ─────────────────────────────────────────────────────────────────────────────
// Auto-refresh on a 401 — the access token is a real 24h-lived JWT
// (backend-django/core/settings.py's SIMPLE_JWT), but until this existed,
// nothing in the app ever called the refresh endpoint at all: `refresh_token`
// was stored on login and then never read again anywhere. Any session left
// open across that 24h window (this project's own dev sessions routinely
// span multiple days) hit 401s on every subsequent Django call, including
// ones made server-side by Auto Mode's FastAPI backend using whatever token
// the browser last handed it (see auto_mode/runner.py's resume_run, which
// now re-reads this same refreshed token on every checkpoint decision) —
// confirmed live: exactly this, surfacing as
// `cascade_delete(encoding) failed: Client error '401 Unauthorized'`
// mid-run. One shared in-flight promise so N requests that all 401 around
// the same moment trigger exactly one refresh call, not N of them racing
// (ROTATE_REFRESH_TOKENS is on — a second refresh call made with a
// refresh_token that a concurrent first call already rotated away would
// itself fail).
let refreshPromise = null
function refreshAccessToken() {
  if (!refreshPromise) {
    const refresh = localStorage.getItem('refresh_token')
    refreshPromise = (refresh
      ? djangoAPI.post('/api/auth/token/refresh/', { refresh })
      : Promise.reject(new Error('no refresh_token stored')))
      .then(({ data }) => {
        localStorage.setItem('access_token', data.access)
        if (data.refresh) localStorage.setItem('refresh_token', data.refresh)
        return data.access
      })
      .finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

djangoAPI.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    const isAuthEndpoint = original?.url?.includes('/api/auth/')
    if (error.response?.status === 401 && !original?._retriedAfterRefresh && !isAuthEndpoint) {
      original._retriedAfterRefresh = true
      try {
        const freshToken = await refreshAccessToken()
        original.headers.Authorization = `Bearer ${freshToken}`
        return djangoAPI(original)
      } catch {
        // Refresh token itself is gone/expired — nothing left to do client-side
        // but let the original 401 surface, same as before this interceptor existed.
      }
    }
    return Promise.reject(error)
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// Pre-built function calls for each operation
// Import these in your React components instead of writing axios calls inline
// ─────────────────────────────────────────────────────────────────────────────

// ── Authentication (Django) ───────────────────────────────────────────────────
export const authAPI = {
  register: (data)        => djangoAPI.post('/api/auth/register/', data),
  login:    (data)        => djangoAPI.post('/api/auth/login/', data),
  profile:  ()            => djangoAPI.get('/api/auth/profile/'),
  updateProfile: (data)   => djangoAPI.put('/api/auth/profile/', data),
  refreshToken: (refresh) => djangoAPI.post('/api/auth/token/refresh/', { refresh }),
}

// ── Projects (Django) ─────────────────────────────────────────────────────────
export const projectsAPI = {
  list:   ()                => djangoAPI.get('/api/projects/'),
  create: (data)            => djangoAPI.post('/api/projects/', data),
  get:    (id)              => djangoAPI.get(`/api/projects/${id}/`),
  update: (id, data)        => djangoAPI.put(`/api/projects/${id}/`, data),
  delete: (id)              => djangoAPI.delete(`/api/projects/${id}/`),
}

// ── Datasets (Django — handles file upload + storage) ─────────────────────────
export const datasetsAPI = {
  upload: (projectId, formData) =>
    djangoAPI.post(`/api/projects/${projectId}/datasets/upload/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  get: (datasetId) => djangoAPI.get(`/api/datasets/${datasetId}/`),
  // target_column/task_type are unknown at upload time (see
  // DatasetUploadView) — set once the Upload wizard's Step 2/3 actually
  // determines them, so a later "open this project" can rebuild uploadMeta
  // without them, everything past Encoding would silently lose its target.
  updateMeta: (datasetId, data) => djangoAPI.patch(`/api/datasets/${datasetId}/`, data),
}

// ── Dataset Version History (Django) ───────────────────────────────────────────
// Backs the Cleaning page's versions bar and the "go back to an earlier step,
// redo it, and invalidate everything downstream" flow. See
// backend-django/datasets/version_views.py for the server-side logic.
export const versionsAPI = {
  list: (projectId) =>
    djangoAPI.get(`/api/projects/${projectId}/versions/`),
  forStep: (projectId, stepName) =>
    djangoAPI.get(`/api/projects/${projectId}/versions/for-step/${stepName}/`),
  register: (projectId, data) =>
    djangoAPI.post(`/api/projects/${projectId}/versions/register/`, data),
  cascadeDelete: (projectId, stepName) =>
    djangoAPI.delete(`/api/projects/${projectId}/versions/cascade/${stepName}/`),
  downloadUrl: (projectId, versionId) =>
    `${djangoAPI.defaults.baseURL}/api/projects/${projectId}/versions/${versionId}/download/`,
}

// ── Workflow / Step Memory (Django) ────────────────────────────────────────────
// Persists which step the user is on, which steps are complete/need-redo, and
// a per-step settings cache (thresholds, chosen methods, etc.) so navigating
// away and back — or refreshing — restores what they had selected.
export const workflowAPI = {
  get: (projectId) => djangoAPI.get(`/api/projects/${projectId}/workflow/`),
  patch: (projectId, data) => djangoAPI.patch(`/api/projects/${projectId}/workflow/`, data),
}

// ── Auto Mode (FastAPI — backend-fastapi/auto_mode/) ───────────────────────────
// Hits FastAPI directly (127.0.0.1:8001), same as every other ML computation
// call — Auto Mode's own progress/audit trail is written separately to
// Django by the graph's nodes themselves (see auto_mode/django_client.py),
// not by the frontend, since there's no browser stitching each step
// together the way Manual Mode relies on React to do.
export const automodeAPI = {
  start: (data) => mlAPI.post('/auto-mode/run', data),
  status: (runId) => mlAPI.get(`/auto-mode/status/${runId}`),
  resume: (runId, data) => mlAPI.post(`/auto-mode/resume/${runId}`, data),
}

// ── ML Operations (FastAPI — all computation) ─────────────────────────────────
export const mlOpsAPI = {
  // Profile a dataset (health score, statistics)
  profile: (filePath, targetColumn = null) =>
    mlAPI.post('/ml/profile', { file_path: filePath, target_column: targetColumn }),

  // Get model recommendations
  recommendations: (taskType, profilingResult) =>
    mlAPI.post('/ml/recommendations', { task_type: taskType, profiling_result: profilingResult }),

  // Auto-clean (Smart Auto mode)
  autoClean: (filePath, targetColumn, saveDir) =>
    mlAPI.post('/ml/clean/auto', {
      file_path: filePath,
      target_column: targetColumn,
      dataset_save_dir: saveDir,
    }),

  // Clean one step (Guided Expert mode)
  cleanStep: (filePath, stepName, config) =>
    mlAPI.post('/ml/clean/step', { file_path: filePath, step_name: stepName, config }),

  // Train a specific algorithm
  train: (data) => mlAPI.post('/ml/train', data),

  // Full auto pipeline (Smart Auto mode: tournament + everything)
  autoPipeline: (data) => mlAPI.post('/ml/auto', data),

  // KNN elbow curve
  elbowCurve: (filePath, targetColumn) =>
    mlAPI.post('/ml/elbow', { file_path: filePath, target_column: targetColumn }),

  // What-If Simulator
  whatIfPredict: (modelPath, scalerPath, inputValues, featureNames) =>
    mlAPI.post('/ml/what-if/predict', {
      model_path: modelPath,
      scaler_path: scalerPath,
      input_values: inputValues,
      feature_names: featureNames,
    }),

  whatIfContributions: (modelPath, scalerPath, inputValues, featureNames) =>
    mlAPI.post('/ml/what-if/contributions', {
      model_path: modelPath,
      scaler_path: scalerPath,
      input_values: inputValues,
      feature_names: featureNames,
    }),
}
