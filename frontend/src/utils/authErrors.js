// ─────────────────────────────────────────────────────────────────────────────
// formatDjangoErrors — flattens whatever shape an axios error from the Django
// auth endpoints comes back as into one display string for AuthSection.
//
// Three shapes to handle:
//   1. No response at all (network down / Django not running) — a plain
//      message, matching the existing bootstrapError banner phrasing already
//      used in App.jsx's LoadDatasetForm.
//   2. DRF's normal validation-error shape: a plain object of
//      {field: [messages]} (e.g. register's `validate_email`) — flattened to
//      "field: message" pairs.
//   3. SimpleJWT's login-failure shape: {detail: "..."} — shown as-is.
//
// Anything else (a raw 500/HTML traceback body, a non-object payload) falls
// back to a fixed generic message rather than dumping unstructured text.
// ─────────────────────────────────────────────────────────────────────────────
export function formatDjangoErrors(error) {
  if (!error?.response) {
    return "Can't reach the server — is the backend running?"
  }

  const data = error.response.data

  if (data?.detail) {
    return data.detail
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const parts = Object.entries(data)
      .filter(([, messages]) => Array.isArray(messages))
      .map(([field, messages]) => `${field}: ${messages.join(' ')}`)
    if (parts.length) return parts.join(' ')
  }

  return 'Something went wrong — this email may already be registered, or the server hit an error. Try logging in instead, or use a different email.'
}
