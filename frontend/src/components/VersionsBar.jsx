import { useTheme } from '../theme'

// ─────────────────────────────────────────────────────────────────────────────
// SHARED, ACCUMULATING VERSIONS BAR
//
// Every page that uses the shared useVersionHistory hook was, until now,
// hand-rolling its OWN "Versions:" pill row showing only 2 possible pills —
// "Original Dataset" and this page's own step's version — instead of the
// FULL accumulated history. That full history was already sitting right
// there the whole time: useVersionHistory's `versions` state hydrates from
// Django's per-dataset /versions/ list (ordered by step_order), which
// contains EVERY version any page has ever registered for this dataset, not
// just the current page's own. Cleaning.jsx's own internal (self-contained,
// not using this hook) version bar already gets this right for exactly the
// same reason — its local state hydrates from that same full Django list.
// This component just does, for every OTHER page, what Cleaning.jsx already
// did for itself: render the WHOLE accumulated `versions` array as a
// left-to-right timeline of pills, most-recent filled solid, the rest
// outlined, each with its own download button. Horizontally scrollable
// (not wrapping) once there are enough pills to overflow one row — the
// accumulation reads as a timeline, not a grid.
// ─────────────────────────────────────────────────────────────────────────────

const ML_API = 'http://127.0.0.1:8001'

const downloadFile = (filePath, filename) => {
  const url = `${ML_API}/cleaning/download?file_path=${encodeURIComponent(filePath)}&filename=${encodeURIComponent(filename)}`
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
}

export default function VersionsBar({ versions }) {
  const { C } = useTheme()
  const list = (versions && versions.length)
    ? versions
    : [{ stepName: 'upload', label: 'Original Dataset', filePath: null }]

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 24px', background: C.cardAlt, borderBottom: `1px solid ${C.border}`,
      overflowX: 'auto', flexWrap: 'nowrap',
    }}>
      <span style={{ fontSize: 13, flexShrink: 0 }}>↻</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, flexShrink: 0 }}>Versions:</span>
      {list.map((v, i) => {
        const isLast = i === list.length - 1
        return (
          <div key={`${v.stepName}-${i}`}
            style={{ display: 'flex', alignItems: 'center', gap: 4, borderRadius: 20, flexShrink: 0,
              padding: '3px 6px 3px 12px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
              border: isLast ? 'none' : `1.5px solid ${C.border}`,
              background: isLast ? C.primary : 'transparent',
              color: isLast ? 'white' : C.muted }}>
            <span>{v.label}{v.versionNumber ? ` · v${v.versionNumber}` : ''}</span>
            {v.filePath && (
              <button title={`Download ${v.label}`}
                onClick={() => downloadFile(v.filePath, `${v.label.replace(/\s+/g, '_')}.csv`)}
                style={{ width: 20, height: 20, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
                  background: isLast ? 'rgba(255,255,255,0.22)' : C.light,
                  color: isLast ? 'white' : C.muted, fontSize: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                ⬇
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
