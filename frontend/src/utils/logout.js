// ─────────────────────────────────────────────────────────────────────────────
// logout — clears the real auth tokens plus any per-dataset training history
// stashed in localStorage (same keys App.jsx's own handleUploadMeta wipes on
// a fresh upload, for the same reason: the next person to use this browser
// shouldn't inherit a stranger's session), then reloads.
//
// A plain reload is what actually gets back to Landing: App.jsx's initial
// `stage` is a lazy `localStorage.getItem('access_token') ? 'workspace' :
// 'landing'` check made once at mount, not something a live call could flip
// from outside without either this reload or threading a matching callback
// through every page that might want a "log out" affordance.
// ─────────────────────────────────────────────────────────────────────────────
export default function logout() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('prism_training_'))
      .forEach((k) => localStorage.removeItem(k))
  } catch { /* localStorage unavailable — tokens are already cleared above */ }
  window.location.reload()
}
