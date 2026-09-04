import { useEffect, useRef, useState } from 'react'
import { projectsAPI } from '../api'
import { formatDjangoErrors } from '../utils/authErrors'
import logout from '../utils/logout'
import { GATE, GATE_FONT } from '../constants/darkGate'
import CrystalScene from '../components/CrystalScene'

// ─────────────────────────────────────────────────────────────────────────────
// Workspace — the hub between logging in and the actual pipeline. Lists the
// user's real past projects (fetched from Django) in a left-side drawer,
// offers a "+ New Project" action that names and creates a real project then
// hands control back to App.jsx to enter the pipeline on Upload, and shows a
// center visual.
//
// The center visual is a placeholder: the user described a specific
// animation they'll provide "exactly" to drop in here, so this reuses
// CrystalScene (already built for Landing) pinned at progress=1 — its fully-
// bloomed, idly-animating state — as a reasonable stand-in rather than an
// empty box, swapped out wholesale once the real one arrives.
//
// Past-project rows are now real: click one to open it (onProjectOpened,
// wired the same way onProjectCreated already was), or use the ⋮ menu to
// rename or delete it without opening it first.
// ─────────────────────────────────────────────────────────────────────────────
export default function Workspace({ onProjectCreated, onProjectOpened }) {
  const [projects, setProjects] = useState([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [listError, setListError] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // ── Per-row ⋮ menu, rename, delete ──────────────────────────────────
  const [openMenuId, setOpenMenuId] = useState(null)
  const [openingId, setOpeningId] = useState(null)
  const [renameTarget, setRenameTarget] = useState(null)   // project or null
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)   // project or null
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const openingRef = useRef(false) // guards against a second click firing onProjectOpened twice mid-flight

  useEffect(() => {
    projectsAPI.list()
      .then(({ data }) => setProjects(data))
      .catch((e) => setListError(formatDjangoErrors(e)))
      .finally(() => setLoadingProjects(false))
  }, [])

  const handleOpen = async (project) => {
    if (openingRef.current) return
    openingRef.current = true
    setOpeningId(project.id)
    setOpenMenuId(null)
    try {
      await onProjectOpened?.(project)
    } finally {
      // Only relevant if opening failed and Workspace is still mounted —
      // a successful open navigates App.jsx away from this page entirely.
      openingRef.current = false
      setOpeningId(null)
    }
  }

  const openRenameModal = (project) => {
    setRenameTarget(project); setRenameValue(project.name); setRenameError(''); setOpenMenuId(null)
  }
  const closeRenameModal = () => { if (!renaming) setRenameTarget(null) }
  const handleRenameSubmit = async (e) => {
    e.preventDefault()
    const name = renameValue.trim()
    if (!name) { setRenameError('Give your project a name.'); return }
    setRenaming(true); setRenameError('')
    try {
      const { data: updated } = await projectsAPI.update(renameTarget.id, { name })
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)))
      setRenameTarget(null)
    } catch (err) {
      setRenameError(formatDjangoErrors(err))
    } finally {
      setRenaming(false)
    }
  }

  const openDeleteModal = (project) => { setDeleteTarget(project); setDeleteError(''); setOpenMenuId(null) }
  const closeDeleteModal = () => { if (!deleting) setDeleteTarget(null) }
  const handleDeleteConfirm = async () => {
    setDeleting(true); setDeleteError('')
    try {
      await projectsAPI.delete(deleteTarget.id)
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err) {
      setDeleteError(formatDjangoErrors(err))
    } finally {
      setDeleting(false)
    }
  }

  const openModal = () => { setModalOpen(true); setProjectName(''); setCreateError('') }
  const closeModal = () => { if (!creating) setModalOpen(false) }

  const handleCreate = async (e) => {
    e.preventDefault()
    const name = projectName.trim()
    if (!name) { setCreateError('Give your project a name.'); return }
    setCreating(true); setCreateError('')
    try {
      const { data: project } = await projectsAPI.create({ name, mode: 'guided_manual' })
      setProjects((prev) => [project, ...prev])
      onProjectCreated?.(project)
    } catch (err) {
      setCreateError(formatDjangoErrors(err))
      setCreating(false)
    }
  }

  const formatDate = (iso) => {
    try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
    catch { return '' }
  }

  const menuItemStyle = {
    display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
    color: GATE.white, fontSize: 12.5, padding: '9px 10px', borderRadius: 6, cursor: 'pointer',
    fontFamily: 'inherit',
  }

  return (
    <div style={{ background: GATE.bg, minHeight: '100vh', fontFamily: GATE_FONT, position: 'relative', overflow: 'hidden' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div style={{
        position: 'relative', zIndex: 20, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '22px 32px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <button onClick={() => setDrawerOpen((o) => !o)} title="Project history" style={{
            background: 'none', border: `1px solid ${GATE.border}`, borderRadius: 8,
            width: 34, height: 34, color: GATE.white, fontSize: 15, cursor: 'pointer',
          }}>☰</button>
          <span style={{ fontSize: 13, letterSpacing: '0.35em', fontWeight: 600, opacity: 0.85, color: GATE.white }}>PRISM</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={openModal} style={{
            display: 'flex', alignItems: 'center', gap: 8, background: 'none',
            border: `1px solid ${GATE.border}`, borderRadius: 20, padding: '8px 18px 8px 14px',
            color: GATE.white, fontSize: 13, letterSpacing: '0.03em', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> New Project
          </button>
          <button onClick={logout} title="Log out" style={{
            background: 'none', border: 'none', color: GATE.muted, fontSize: 16, cursor: 'pointer', padding: 0,
          }}>👤</button>
        </div>
      </div>

      {/* ── Center visual (placeholder — see file header) — full-bleed,
          same as Landing.jsx's own hero, not boxed into a small tile. ──── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
        <CrystalScene progress={1} />
      </div>
      <div style={{
        position: 'absolute', left: '50%', bottom: '10%', transform: 'translateX(-50%)',
        textAlign: 'center', letterSpacing: '0.35em', fontSize: 13, textTransform: 'uppercase',
        opacity: 0.75, pointerEvents: 'none', color: GATE.white, zIndex: 2,
      }}>
        Your workspace
        <small style={{ display: 'block', marginTop: 8, letterSpacing: '0.15em', fontSize: 10, color: GATE.muted, textTransform: 'none' }}>
          Start a new project, or pick up an old one
        </small>
      </div>

      {/* ── Left drawer ─────────────────────────────────────────────────── */}
      {drawerOpen && (
        <div onClick={() => setDrawerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 29, background: 'rgba(0,0,0,0.4)' }} />
      )}
      <div style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, width: 280, zIndex: 30,
        background: GATE.panel, borderRight: `1px solid ${GATE.border}`,
        transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.3s ease', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '22px 22px 16px', borderBottom: `1px solid ${GATE.border}` }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: GATE.muted }}>Your projects</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {loadingProjects && (
            <div style={{ padding: '16px 22px', fontSize: 12.5, color: GATE.muted }}>Loading…</div>
          )}
          {!loadingProjects && listError && (
            <div style={{ margin: '12px 16px', padding: '10px 12px', background: GATE.dangerBg, border: `1px solid ${GATE.danger}55`, borderRadius: 8, color: GATE.danger, fontSize: 11.5 }}>
              ⚠ {listError}
            </div>
          )}
          {!loadingProjects && !listError && projects.length === 0 && (
            <div style={{ padding: '16px 22px', fontSize: 12.5, color: GATE.muted, lineHeight: 1.6 }}>
              No projects yet — create your first one to get started.
            </div>
          )}
          {!loadingProjects && projects.map((p) => (
            <div key={p.id} style={{ position: 'relative' }}>
              <div
                onClick={() => handleOpen(p)}
                title="Open this project"
                style={{
                  padding: '12px 44px 12px 22px',
                  cursor: openingId ? 'default' : 'pointer',
                  opacity: openingId && openingId !== p.id ? 0.4 : 1,
                  transition: 'background 0.15s, opacity 0.15s',
                }}
                onMouseEnter={(e) => { if (!openingId) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ fontSize: 13.5, color: GATE.white, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 11, color: GATE.muted, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {openingId === p.id
                    ? 'Opening…'
                    : p.latest_dataset
                      ? `${p.latest_dataset.original_filename} · ${formatDate(p.created_at)}`
                      : formatDate(p.created_at)}
                </div>
              </div>

              <button
                onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === p.id ? null : p.id) }}
                title="Project options"
                style={{
                  position: 'absolute', top: 10, right: 10, width: 26, height: 26,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: openMenuId === p.id ? 'rgba(255,255,255,0.12)' : 'none',
                  border: 'none', borderRadius: 6, color: GATE.muted, fontSize: 16,
                  cursor: 'pointer', lineHeight: 1, padding: 0,
                }}
              >⋮</button>

              {openMenuId === p.id && (
                <>
                  {/* Invisible click-catcher — closes the menu on any outside
                      click without also closing the drawer itself (this div
                      is a drawer-scoped sibling above the row, not the
                      drawer's own full-page backdrop). */}
                  <div onClick={() => setOpenMenuId(null)} style={{ position: 'fixed', inset: 0, zIndex: 34 }} />
                  <div onClick={(e) => e.stopPropagation()} style={{
                    position: 'absolute', top: 40, right: 10, zIndex: 35, width: 158,
                    background: GATE.panel, border: `1px solid ${GATE.border}`, borderRadius: 10,
                    boxShadow: '0 14px 32px rgba(0,0,0,0.5)', overflow: 'hidden', padding: 4,
                  }}>
                    <button onClick={() => handleOpen(p)} style={menuItemStyle}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}>
                      Open
                    </button>
                    <button onClick={() => openRenameModal(p)} style={menuItemStyle}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}>
                      Rename
                    </button>
                    <button onClick={() => openDeleteModal(p)} style={{ ...menuItemStyle, color: GATE.danger }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = GATE.dangerBg }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}>
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── New Project modal ───────────────────────────────────────────── */}
      {modalOpen && (
        <div onClick={closeModal} style={{
          position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={handleCreate} style={{
            width: '100%', maxWidth: 380, background: GATE.panel, border: `1px solid ${GATE.border}`,
            borderRadius: 14, padding: '28px 30px',
          }}>
            <div style={{ fontSize: 17, fontWeight: 300, color: GATE.white, marginBottom: 20 }}>Name your project</div>
            <input autoFocus type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Customer Churn Analysis"
              style={{
                width: '100%', background: 'transparent', border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.2)', color: GATE.white,
                fontSize: 16, fontFamily: 'inherit', padding: '6px 2px 12px', outline: 'none', boxSizing: 'border-box',
                marginBottom: 20,
              }}
              onFocus={(e) => { e.target.style.borderBottomColor = GATE.white }}
              onBlur={(e) => { e.target.style.borderBottomColor = 'rgba(255,255,255,0.2)' }}
            />
            {createError && (
              <div style={{ background: GATE.dangerBg, border: `1px solid ${GATE.danger}55`, borderRadius: 8, padding: '9px 12px', color: GATE.danger, fontSize: 12, marginBottom: 18 }}>
                ⚠ {createError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 14 }}>
              <button type="button" onClick={closeModal} disabled={creating} style={{
                background: 'none', border: 'none', color: GATE.muted, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', padding: '8px 4px',
              }}>Cancel</button>
              <button type="submit" disabled={creating} style={{
                background: 'none', border: 'none', color: GATE.white, fontSize: 14, letterSpacing: '0.03em',
                cursor: creating ? 'default' : 'pointer', opacity: creating ? 0.6 : 1, fontFamily: 'inherit', padding: '8px 4px',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                {creating ? 'Creating…' : 'Create'} <span>→</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Rename Project modal ────────────────────────────────────────── */}
      {renameTarget && (
        <div onClick={closeRenameModal} style={{
          position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={handleRenameSubmit} style={{
            width: '100%', maxWidth: 380, background: GATE.panel, border: `1px solid ${GATE.border}`,
            borderRadius: 14, padding: '28px 30px',
          }}>
            <div style={{ fontSize: 17, fontWeight: 300, color: GATE.white, marginBottom: 20 }}>Rename project</div>
            <input autoFocus type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
              placeholder="e.g. Customer Churn Analysis"
              style={{
                width: '100%', background: 'transparent', border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.2)', color: GATE.white,
                fontSize: 16, fontFamily: 'inherit', padding: '6px 2px 12px', outline: 'none', boxSizing: 'border-box',
                marginBottom: 20,
              }}
              onFocus={(e) => { e.target.style.borderBottomColor = GATE.white }}
              onBlur={(e) => { e.target.style.borderBottomColor = 'rgba(255,255,255,0.2)' }}
            />
            {renameError && (
              <div style={{ background: GATE.dangerBg, border: `1px solid ${GATE.danger}55`, borderRadius: 8, padding: '9px 12px', color: GATE.danger, fontSize: 12, marginBottom: 18 }}>
                ⚠ {renameError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 14 }}>
              <button type="button" onClick={closeRenameModal} disabled={renaming} style={{
                background: 'none', border: 'none', color: GATE.muted, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', padding: '8px 4px',
              }}>Cancel</button>
              <button type="submit" disabled={renaming} style={{
                background: 'none', border: 'none', color: GATE.white, fontSize: 14, letterSpacing: '0.03em',
                cursor: renaming ? 'default' : 'pointer', opacity: renaming ? 0.6 : 1, fontFamily: 'inherit', padding: '8px 4px',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                {renaming ? 'Saving…' : 'Save'} <span>→</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Delete Project confirmation ─────────────────────────────────── */}
      {deleteTarget && (
        <div onClick={closeDeleteModal} style={{
          position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '100%', maxWidth: 380, background: GATE.panel, border: `1px solid ${GATE.border}`,
            borderRadius: 14, padding: '28px 30px',
          }}>
            <div style={{ fontSize: 17, fontWeight: 300, color: GATE.white, marginBottom: 10 }}>Delete project?</div>
            <p style={{ fontSize: 13, color: GATE.muted, lineHeight: 1.6, margin: '0 0 22px' }}>
              <strong style={{ color: GATE.white, fontWeight: 500 }}>{deleteTarget.name}</strong> and every dataset,
              version, and trained model inside it will be permanently deleted. This can't be undone.
            </p>
            {deleteError && (
              <div style={{ background: GATE.dangerBg, border: `1px solid ${GATE.danger}55`, borderRadius: 8, padding: '9px 12px', color: GATE.danger, fontSize: 12, marginBottom: 18 }}>
                ⚠ {deleteError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 14 }}>
              <button type="button" onClick={closeDeleteModal} disabled={deleting} style={{
                background: 'none', border: 'none', color: GATE.muted, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', padding: '8px 4px',
              }}>Cancel</button>
              <button type="button" onClick={handleDeleteConfirm} disabled={deleting} style={{
                background: 'none', border: 'none', color: GATE.danger, fontSize: 14, letterSpacing: '0.03em',
                cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.6 : 1, fontFamily: 'inherit', padding: '8px 4px',
              }}>
                {deleting ? 'Deleting…' : 'Delete project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
