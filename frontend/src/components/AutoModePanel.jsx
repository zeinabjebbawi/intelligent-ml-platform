// AutoModePanel — a right-docked side panel (NOT a centered blurred modal),
// deliberately: the whole point is that the REAL page behind it (Cleaning,
// Encoding, Feature Selection, ...) visibly updates with real data as Auto
// Mode progresses — App.jsx's syncToAutoModeNode() calls setStage() on
// every genuine progress tick, which swaps in the real page underneath
// this panel. A full-screen blurred scrim would defeat that entirely, so
// this uses a fixed-width docked panel (same physical pattern as Upload's
// own Dataset Setup drawer) plus an invisible, non-dimming click-catcher
// behind it so the underlying page can't be accidentally double-acted-on
// while Auto Mode is actively mutating it, without hiding it visually.
//
// Polls automodeAPI.status(runId) every 3s. Calls onProgress(status) every
// time current_node genuinely changes (not every poll tick) — that's what
// drives the live page-following in App.jsx. When the run pauses on a
// human-in-the-loop checkpoint (status: 'paused_hitl' | 'paused_restart'),
// renders the proposal + approve/edit/reject controls right here, next to
// whatever real page is currently showing behind it. On completion, calls
// onComplete(status) and lets the PARENT (App.jsx) do the real
// versionHistory.refresh()/setFurthestOrder()/setStage() sequence — this
// component only knows about the run itself, not the app's own navigation
// state.
//
// `minimized` (App.jsx-owned) toggles between this full panel and a small
// reopenable tab (see the early return below) WITHOUT unmounting — runId/
// status/polling all live in this same component instance either way, so
// minimizing (or the parent re-rendering across a stage change) never
// drops the connection to an in-progress run the way actually unmounting
// on close used to. Only a genuinely terminal run (completed/aborted/
// failed) offers a real "✕ Close" that unmounts it.
import { useEffect, useRef, useState } from 'react'
import { automodeAPI } from '../api'
import { useTheme } from '../theme'

const POLL_MS = 3000

const STATUS_LABEL = {
  running: 'Running…',
  paused_hitl: 'Waiting for your confirmation',
  paused_restart: 'Interrupted by a server restart',
  completed: 'Complete',
  aborted: 'Stopped',
  failed: 'Failed',
}

function Timeline({ C, completedNodes, currentNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
      {completedNodes.map((n) => (
        <span key={n} style={{
          fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
          background: C.successSoft || `${C.success}22`, color: C.success, border: `1px solid ${C.success}55`,
        }}>✓ {n}</span>
      ))}
      {currentNode && !completedNodes.includes(currentNode) && (
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
          background: C.primarySoft || `${C.primary}22`, color: C.primary, border: `1px solid ${C.primary}55`,
        }}>▶ {currentNode}</span>
      )}
    </div>
  )
}

function CheckpointCard({ C, interrupt, onDecide, busy }) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(() => JSON.stringify(interrupt?.proposal || {}, null, 2))
  const [reason, setReason] = useState('')
  const reviewOnly = !!interrupt?.review_only

  // Review-only checkpoints (checkpoint_type starting "review_") land here
  // AFTER the agent already did the work — the real page behind this panel
  // has already updated with the actual result. There's nothing to
  // approve/edit here, just "I've seen it, move on" — a plain Continue
  // button, matching the same rhythm Manual Mode's own Try-See-Decide
  // pages already have (act, see the real result, then decide to move on).
  if (reviewOnly) {
    return (
      <div style={{
        background: C.faint, border: `1px solid ${C.success}55`, borderRadius: 12, padding: 16, marginTop: 8,
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.success, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          ✓ {(interrupt?.checkpoint_type || 'result').replace(/^review_/, '').replace(/_/g, ' ')} — result
        </div>
        <div style={{ fontSize: 13, color: C.text, marginBottom: 10, lineHeight: 1.5 }}>{interrupt?.reasoning}</div>
        <pre style={{
          fontSize: 11, color: C.muted, background: C.overlayCard, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: 10, overflowX: 'auto', margin: '0 0 12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>{JSON.stringify(interrupt?.proposal || {}, null, 2)}</pre>
        <button disabled={busy} onClick={() => onDecide('approve', {}, '')} style={{ ...btnStyle(C, true), width: '100%' }}>
          Continue →
        </button>
      </div>
    )
  }

  return (
    <div style={{
      background: C.faint, border: `1px solid ${C.primary}55`, borderRadius: 12, padding: 16, marginTop: 8,
    }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.primary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {(interrupt?.checkpoint_type || 'checkpoint').replace(/^propose_/, '').replace(/_/g, ' ')}
      </div>
      <div style={{ fontSize: 13, color: C.text, marginBottom: 10, lineHeight: 1.5 }}>{interrupt?.reasoning}</div>
      {!editing && (
        <pre style={{
          fontSize: 11, color: C.muted, background: C.overlayCard, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: 10, overflowX: 'auto', margin: '0 0 12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>{JSON.stringify(interrupt?.proposal || {}, null, 2)}</pre>
      )}
      {editing && (
        <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={8}
          style={{
            width: '100%', fontFamily: 'monospace', fontSize: 11.5, boxSizing: 'border-box',
            background: C.overlayCard, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8,
            padding: 10, marginBottom: 12,
          }} />
      )}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional note (shown in the audit trail)"
        style={{
          width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '8px 10px', marginBottom: 12,
          background: C.overlayCard, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8,
        }} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button disabled={busy} onClick={() => onDecide('approve', {}, reason)} style={btnStyle(C, true)}>
          ✓ Approve
        </button>
        {!editing ? (
          <button disabled={busy} onClick={() => setEditing(true)} style={btnStyle(C, false)}>✎ Edit</button>
        ) : (
          <button disabled={busy} onClick={() => {
            try {
              const payload = JSON.parse(editText)
              onDecide('edit', payload, reason)
            } catch {
              alert('That is not valid JSON — fix it or click Approve to use the original proposal.')
            }
          }} style={btnStyle(C, true)}>✓ Use edited version</button>
        )}
        <button disabled={busy} onClick={() => onDecide('reject', {}, reason || 'Rejected from the Auto Mode panel.')}
          style={{ ...btnStyle(C, false), color: C.danger, borderColor: `${C.danger}66` }}>
          ✕ Reject &amp; stop here
        </button>
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 10 }}>
        Rejecting stops the whole run here — everything already done stays saved, and you can continue manually
        from wherever it left off.
      </div>
    </div>
  )
}

function btnStyle(C, primary) {
  return {
    padding: '8px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
    border: primary ? 'none' : `1px solid ${C.border}`,
    background: primary ? C.primary : 'transparent',
    color: primary ? '#fff' : C.text,
  }
}

export default function AutoModePanel({ projectId, filePath, taskType, targetColumn, userIntent,
  minimized, onMinimize, onExpand, onClose, onProgress, onComplete }) {
  const { C } = useTheme()
  const [runId, setRunId] = useState(null)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [startError, setStartError] = useState(null)
  const pollRef = useRef(null)
  const lastNodeRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const jwtToken = localStorage.getItem('access_token') || ''
    automodeAPI.start({
      project_id: projectId, jwt_token: jwtToken, file_path: filePath, task_type: taskType,
      target_column: targetColumn || null, user_intent: userIntent || 'Run the complete ML pipeline automatically',
    }).then(({ data }) => { if (!cancelled) setRunId(data.run_id) })
      .catch((e) => { if (!cancelled) setStartError(e?.response?.data?.detail || e.message) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!runId) return undefined
    const poll = async () => {
      try {
        const { data } = await automodeAPI.status(runId)
        setStatus(data)
        // Fire onProgress only on a REAL current_node change, not every
        // poll tick — this is what drives the live page behind this panel
        // (App.jsx's syncToAutoModeNode does a Django refresh + setStage
        // per call, which would be wasteful and jittery to run every 3s
        // regardless of whether anything actually moved).
        if (data.current_node && data.current_node !== lastNodeRef.current) {
          lastNodeRef.current = data.current_node
          onProgress?.(data)
        }
        // Stop polling once the run reaches ANY terminal state (not just
        // 'completed') — resuming a paused_hitl run restarts polling on
        // its own next status write, but a run that's done/aborted/failed
        // has nothing left to change, so continuing to hit the endpoint
        // every 3s until the user manually closes the panel is pure waste.
        if (['completed', 'aborted', 'failed'].includes(data.status)) {
          clearInterval(pollRef.current)
        }
        if (data.status === 'completed') {
          onComplete?.(data)
        }
      } catch { /* transient — retried on the next tick */ }
    }
    poll()
    pollRef.current = setInterval(poll, POLL_MS)
    return () => clearInterval(pollRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const decide = async (action, payload, reason) => {
    setBusy(true)
    try {
      const jwtToken = localStorage.getItem('access_token') || ''
      await automodeAPI.resume(runId, { jwt_token: jwtToken, action, payload, reason })
    } finally {
      setBusy(false)
    }
  }

  const terminal = status && ['completed', 'aborted', 'failed'].includes(status.status)
  const awaitingYou = (status?.status === 'paused_hitl' || status?.status === 'paused_restart') && status?.interrupt

  // Minimized: a small reopenable tab, NOT an unmount — runId/status/polling
  // above all live in this same component instance regardless of `minimized`,
  // so the connection to the run is never lost the way closing used to lose
  // it. No click-catcher here either: collapsed, the real page underneath
  // must be freely usable, not still blocked by an invisible full-screen div.
  if (minimized) {
    return (
      <button onClick={onExpand} style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 18px', borderRadius: 999, cursor: 'pointer',
        border: `1px solid ${awaitingYou ? C.primary : C.border}`,
        background: C.card, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        color: C.text, fontSize: 13, fontWeight: 700,
      }}>
        <span>Auto Mode</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: awaitingYou ? C.primary : C.muted }}>
          {awaitingYou ? '● Needs your input' : (STATUS_LABEL[status?.status] || 'Starting…')}
        </span>
      </button>
    )
  }

  return (
    <>
      {/* Invisible click-catcher, NOT a dimming/blurring scrim — the real
          page behind it must stay fully, clearly visible (that's the whole
          point of this redesign), just non-interactive while Auto Mode is
          actively mutating it via its own backend calls. */}
      {/* Blocks clicks from reaching the live page underneath WITHOUT
          closing the panel — clicking outside must not dismiss an active
          run; only the explicit minimize/close button (or a terminal
          state's own Close button) should. */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'transparent' }} />

      <div onClick={(e) => e.stopPropagation()} style={{
        position: 'fixed', top: 0, right: 0, width: 440, maxWidth: '92vw', height: '100vh',
        background: C.card, borderLeft: `1px solid ${C.border}`, boxShadow: '-8px 0 32px rgba(0,0,0,0.18)',
        zIndex: 1000, display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '18px 22px', borderBottom: `1px solid ${C.border}`, flexShrink: 0,
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>Auto Mode</div>
          {/* Not terminal: collapses to the reopenable tab above — the run
              keeps going untouched, exactly like closing a sidebar rather
              than ending a session. Terminal: nothing left to preserve, so
              this genuinely dismisses the panel instead. */}
          {terminal ? (
            <button onClick={onClose} style={{
              background: C.faint, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 14px',
              color: C.muted, cursor: 'pointer', fontSize: 12, fontWeight: 700,
            }}>✕ Close</button>
          ) : (
            <button onClick={onMinimize} title="Keep the run going — collapse this panel to a small tab you can reopen anytime"
              style={{
                background: C.faint, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 14px',
                color: C.muted, cursor: 'pointer', fontSize: 12, fontWeight: 700,
              }}>⌄ Minimize</button>
          )}
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1 }}>
          {startError && (
            <div style={{ color: C.danger, fontSize: 13 }}>⚠ Could not start: {startError}</div>
          )}

          {!status && !startError && (
            <div style={{ color: C.muted, fontSize: 13 }}>Starting the pipeline…</div>
          )}

          {status && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 14 }}>
                {STATUS_LABEL[status.status] || status.status}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.4 }}>
                The page behind this panel is live — it updates as each step really runs.
              </div>
              <Timeline C={C} completedNodes={status.completed_nodes || []} currentNode={status.current_node} />

              {(status.status === 'paused_hitl' || status.status === 'paused_restart') && status.interrupt && (
                <CheckpointCard C={C} interrupt={status.interrupt} busy={busy} onDecide={decide} />
              )}

              {status.status === 'failed' && (
                <div style={{ color: C.danger, fontSize: 13, marginTop: 8 }}>⚠ {status.error}</div>
              )}
              {status.status === 'aborted' && (
                <div style={{ color: C.warning, fontSize: 13, marginTop: 8 }}>
                  Stopped: {status.error}. Everything completed before this point was saved as real dataset versions —
                  continue manually from the last completed step.
                </div>
              )}
              {status.status === 'completed' && (
                <div style={{ color: C.success, fontSize: 13, marginTop: 8 }}>
                  ✓ Finished. Closing and taking you to where it left off…
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
