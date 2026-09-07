import { useEffect, useRef, useState } from 'react'
import { projectsAPI } from '../api'
import { formatDjangoErrors } from '../utils/authErrors'
import logout from '../utils/logout'
import { LIGHT_GATE as GATE } from '../constants/lightGate'

const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif"

// ─────────────────────────────────────────────────────────────────────────────
// Workspace — the hub between logging in and the actual pipeline. Lists the
// user's real past projects (fetched from Django) in a left-side drawer,
// offers a "+ New Project" action that names and creates a real project then
// hands control back to App.jsx to enter the pipeline on Upload.
//
// Reskinned onto the same light palette as the new Landing page (LIGHT_GATE)
// instead of the old dark GATE — the WebGL CrystalScene placeholder center
// visual is dropped along with it (it was always a stand-in — see the
// removed comment this file used to carry — and a dark WebGL scene has no
// equivalent that reads correctly on a white page), replaced by a plain
// light hero band with real explanatory copy instead of a decorative one.
// Root stays `overflow:hidden`/no page scroll, same as before — the project
// list scrolls inside its own drawer, not the page.
//
// Past-project rows are real: click one to open it (onProjectOpened), or
// use the ⋮ menu to rename or delete it without opening it first.
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
  const inputUnderlineStyle = {
    width: '100%', background: 'transparent', border: 'none',
    borderBottom: `1px solid ${GATE.border}`, color: GATE.white,
    fontSize: 16, fontFamily: 'inherit', padding: '6px 2px 12px', outline: 'none', boxSizing: 'border-box',
    marginBottom: 20,
  }
  const onUnderlineFocus = (e) => { e.target.style.borderBottomColor = GATE.white }
  const onUnderlineBlur = (e) => { e.target.style.borderBottomColor = GATE.border }

  return (
    <div style={{ background: GATE.bg, height: '100vh', fontFamily: FONT, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div style={{
        position: 'relative', zIndex: 20, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '18px 32px', borderBottom: `1px solid ${GATE.border}`, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <button onClick={() => setDrawerOpen((o) => !o)} title="Project history" style={{
            background: 'none', border: `1px solid ${GATE.border}`, borderRadius: 8,
            width: 34, height: 34, color: GATE.white, fontSize: 15, cursor: 'pointer',
          }}>☰</button>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 11, height: 11, background: GATE.success, borderRadius: 3, transform: 'rotate(45deg)', display: 'inline-block' }} />
            <span style={{ fontSize: 13, letterSpacing: '0.3em', fontWeight: 700, color: GATE.white }}>PRISM</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={openModal} style={{
            display: 'flex', alignItems: 'center', gap: 8, color: '#fff',
            background: GATE.success, border: 'none', borderRadius: 20, padding: '8px 18px 8px 14px',
            fontSize: 13, fontWeight: 700, letterSpacing: '0.02em', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> New Project
          </button>
          <button onClick={logout} title="Log out" style={{
            background: 'none', border: 'none', color: GATE.muted, fontSize: 16, cursor: 'pointer', padding: 0,
          }}>👤</button>
        </div>
      </div>

      {/* ── Description hero — explains where the user is and what the two
          real actions on this page are (open a past project from the
          history drawer, or start a new one), instead of the old decorative
          center visual. Not scrollable: this section simply fills whatever
          vertical space the top bar/drawer leave, same as every other
          fixed-viewport page in the app. ── */}
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 32px',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase', color: GATE.success, marginBottom: 18 }}>
          Your Workspace
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: '0 0 14px', color: GATE.white, maxWidth: 560 }}>
          Pick up a past project, or start a new one
        </h1>
        <p style={{ fontSize: 14, color: GATE.muted, maxWidth: 480, lineHeight: 1.7, margin: 0 }}>
          Open <strong style={{ color: GATE.white, fontWeight: 600 }}>☰ project history</strong> on the left to revisit
          any project you've worked on — every dataset, version, and trained model is saved exactly as you left it —
          or start a fresh one with the button above.
        </p>
      </div>

      {/* ── Left drawer ─────────────────────────────────────────────────── */}
      {drawerOpen && (
        <div onClick={() => setDrawerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 29, background: 'rgba(15,23,42,0.35)' }} />
      )}
      <div style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, width: 280, zIndex: 30,
        background: GATE.panel, borderRight: `1px solid ${GATE.border}`,
        boxShadow: drawerOpen ? '8px 0 32px rgba(15,23,42,0.10)' : 'none',
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
                onMouseEnter={(e) => { if (!openingId) e.currentTarget.style.background = 'rgba(15,23,42,0.04)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ fontSize: 13.5, color: GATE.white, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                  background: openMenuId === p.id ? 'rgba(15,23,42,0.08)' : 'none',
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
                    boxShadow: '0 14px 32px rgba(15,23,42,0.16)', overflow: 'hidden', padding: 4,
                  }}>
                    <button onClick={() => handleOpen(p)} style={menuItemStyle}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(15,23,42,0.06)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}>
                      Open
                    </button>
                    <button onClick={() => openRenameModal(p)} style={menuItemStyle}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(15,23,42,0.06)' }}
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
          position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(15,23,42,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={handleCreate} style={{
            width: '100%', maxWidth: 380, background: GATE.panel, border: `1px solid ${GATE.border}`,
            borderRadius: 14, padding: '28px 30px', boxShadow: '0 24px 60px rgba(15,23,42,0.18)',
          }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: GATE.white, marginBottom: 20 }}>Name your project</div>
            <input autoFocus type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Customer Churn Analysis"
              style={inputUnderlineStyle} onFocus={onUnderlineFocus} onBlur={onUnderlineBlur}
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
                background: 'none', border: 'none', color: GATE.success, fontSize: 14, fontWeight: 700, letterSpacing: '0.03em',
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
          position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(15,23,42,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={handleRenameSubmit} style={{
            width: '100%', maxWidth: 380, background: GATE.panel, border: `1px solid ${GATE.border}`,
            borderRadius: 14, padding: '28px 30px', boxShadow: '0 24px 60px rgba(15,23,42,0.18)',
          }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: GATE.white, marginBottom: 20 }}>Rename project</div>
            <input autoFocus type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
              placeholder="e.g. Customer Churn Analysis"
              style={inputUnderlineStyle} onFocus={onUnderlineFocus} onBlur={onUnderlineBlur}
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
                background: 'none', border: 'none', color: GATE.success, fontSize: 14, fontWeight: 700, letterSpacing: '0.03em',
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
          position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(15,23,42,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '100%', maxWidth: 380, background: GATE.panel, border: `1px solid ${GATE.border}`,
            borderRadius: 14, padding: '28px 30px', boxShadow: '0 24px 60px rgba(15,23,42,0.18)',
          }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: GATE.white, marginBottom: 10 }}>Delete project?</div>
            <p style={{ fontSize: 13, color: GATE.muted, lineHeight: 1.6, margin: '0 0 22px' }}>
              <strong style={{ color: GATE.white, fontWeight: 600 }}>{deleteTarget.name}</strong> and every dataset,
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
                background: 'none', border: 'none', color: GATE.danger, fontSize: 14, fontWeight: 700, letterSpacing: '0.03em',
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
