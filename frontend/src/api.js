// frontend/src/api.js
// ─────────────────────────────────────────────────────────────────────────────
// Two API configurations: Django for app operations, FastAPI for ML operations
// ─────────────────────────────────────────────────────────────────────────────

import axios from 'axios'

// Django API (auth, upload, projects, database)
export const djangoAPI = axios.create({
  baseURL: 'http://localhost:8080',
  headers: { 'Content-Type': 'application/json' },
})

// FastAPI ML engine (profiling, training, what-if)
export const mlAPI = axios.create({
  baseURL: 'http://localhost:8001',
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
