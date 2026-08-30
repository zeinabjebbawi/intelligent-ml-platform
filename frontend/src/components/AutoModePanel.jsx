// AutoModePanel — the Auto Mode modal/overlay.
//
// Visual pattern copied directly from Encoding.jsx's redo-confirmation
// modal (scrim + blur, C.overlayCard inner card, zIndex 1000,
// outside-click-to-close via the scrim's own onClick + inner
// stopPropagation) — see that file's redoModal block for the reference
// this was built against.
//
// Polls automodeAPI.status(runId) every 3s. When the run pauses on a
// human-in-the-loop checkpoint (status: 'paused_hitl' | 'paused_restart'),
// renders the proposal + approve/edit/reject controls. On completion,
// calls onComplete(status) and lets the PARENT (App.jsx) do the real
// versionHistory.refresh() / setFurthestOrder() / advance() sequence —
// this component only knows about the run itself, not the app's own
// navigation state.
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

  return (
    <div style={{
      background: C.faint, border: `1px solid ${C.primary}55`, borderRadius: 12, padding: 16, marginTop: 8,
    }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.primary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {(interrupt?.checkpoint_type || 'checkpoint').replace(/_/g, ' ')}
      </div>
      <div style={{ fontSize: 13, color: C.text, marginBottom: 10, lineHeight: 1.5 }}>{interrupt?.reasoning}</div>
      {!editing && (
        <pre style={{
          fontSize: 11, color: C.muted, background: C.overlayCard, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: 10, overflowX: 'auto', margin: '0 0 12px',
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

export default function AutoModePanel({ projectId, filePath, taskType, targetColumn, userIntent, onClose, onComplete }) {
  const { C } = useTheme()
  const [runId, setRunId] = useState(null)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [startError, setStartError] = useState(null)
  const pollRef = useRef(null)

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

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: C.scrim, backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '92vw', maxWidth: 640, maxHeight: '86vh', overflowY: 'auto',
        background: C.overlayCard, border: `1px solid ${C.border}`, borderRadius: 16,
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)', padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>🤖 Auto Mode</div>
          <button onClick={onClose} style={{
            background: C.faint, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 14px',
            color: C.muted, cursor: 'pointer', fontSize: 12, fontWeight: 700,
          }}>✕ Close</button>
        </div>

        {startError && (
          <div style={{ color: C.danger, fontSize: 13, marginTop: 12 }}>⚠ Could not start: {startError}</div>
        )}

        {!status && !startError && (
          <div style={{ color: C.muted, fontSize: 13, marginTop: 16 }}>Starting the pipeline…</div>
        )}

        {status && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, margin: '10px 0 14px' }}>
              {STATUS_LABEL[status.status] || status.status}
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

            {terminal && (
              <div style={{ marginTop: 16, textAlign: 'right' }}>
                <button onClick={onClose} style={btnStyle(C, true)}>Close</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
