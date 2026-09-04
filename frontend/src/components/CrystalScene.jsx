import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
// CrystalScene — the Landing page's scroll-driven WebGL visual: a refractive
// crystal catches an incoming beam of data and splits it into a spectrum of
// colored rays, each resolving into a small chart glyph, before the whole
// scene floods to white as the pinned hero section releases into the
// Login/Register gate below.
//
// Ported from a standalone prototype (prism_prototype_v2.html) into a real
// React component:
//   - the scene/renderer/lights/geometry are built ONCE in a mount effect,
//     not rebuilt on every scroll tick — `progress` is read from a ref
//     (progressRef) that a separate, cheap effect keeps up to date, so
//     scrolling never re-runs the expensive setup.
//   - the prototype's own eased "progress += (target-progress)*0.08" catch-up
//     smoothing is preserved verbatim inside the animate() loop — that's
//     what gives the scene its fluid feel rather than rigid 1:1 tracking.
//   - WebGLRenderer construction is wrapped in try/catch: a browser/device
//     without WebGL (or jsdom in tests, which has no real canvas backend at
//     all) degrades to an empty wrapper instead of crashing the page.
//   - every listener/resource created in the mount effect is torn down in
//     its cleanup — the prototype never needed this (a one-shot static
//     page), but this component can mount/unmount with the rest of React.
// ─────────────────────────────────────────────────────────────────────────────
export default function CrystalScene({ progress }) {
  const wrapRef = useRef(null)
  const progressRef = useRef(0)

  useEffect(() => { progressRef.current = progress }, [progress])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      return // No WebGL available — Landing still works, just without the 3D scene.
    }

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.1, 100)
    camera.position.set(0, 0.5, 6.2)

    renderer.setSize(wrap.clientWidth, wrap.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    renderer.outputColorSpace = THREE.SRGBColorSpace
    wrap.appendChild(renderer.domElement)

    const key = new THREE.PointLight(0xffffff, 60, 25, 2)
    key.position.set(-4.5, 3.2, 4.5)
    scene.add(key)
    const rim = new THREE.PointLight(0x6c8cff, 25, 25, 2)
    rim.position.set(4, -2, -3)
    scene.add(rim)
    const fill = new THREE.PointLight(0xffffff, 8, 20, 2)
    fill.position.set(0, -3, 3)
    scene.add(fill)
    scene.add(new THREE.AmbientLight(0x1a2236, 1.4))

    // ── crystal ──────────────────────────────────────────────────────────
    const geo = new THREE.IcosahedronGeometry(1.35, 0)
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.04,
      transmission: 1, thickness: 1.8, ior: 2.2, reflectivity: 0.9,
      clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.5,
    })
    const crystal = new THREE.Mesh(geo, mat)
    scene.add(crystal)

    const edgesGeo = new THREE.EdgesGeometry(geo)
    const edgeLines = new THREE.LineSegments(edgesGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 }))
    crystal.add(edgeLines)

    // ── incoming beam ────────────────────────────────────────────────────
    const beamGeo = new THREE.CylinderGeometry(0.018, 0.018, 6.5, 8, 1, true)
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })
    const beam = new THREE.Mesh(beamGeo, beamMat)
    beam.position.set(-3.4, 1.9, 0)
    beam.rotation.z = Math.PI / 2.55
    scene.add(beam)

    const half = new THREE.Vector3(0, 3.25, 0)
    const beamA = half.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), beam.rotation.z).add(beam.position)
    const beamB = half.clone().negate().applyAxisAngle(new THREE.Vector3(0, 0, 1), beam.rotation.z).add(beam.position)

    const DATA_DOTS = 16
    const dataGeo = new THREE.BufferGeometry()
    const dataPos = new Float32Array(DATA_DOTS * 3)
    dataGeo.setAttribute('position', new THREE.BufferAttribute(dataPos, 3))
    const dataMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })
    const dataDots = new THREE.Points(dataGeo, dataMat)
    scene.add(dataDots)

    // ── spectrum rays + analytic glyphs ──────────────────────────────────
    function makeGlyphTexture(kind, hex) {
      const c = document.createElement('canvas')
      c.width = 160; c.height = 110
      const ctx = c.getContext('2d')
      const col = '#' + hex.toString(16).padStart(6, '0')
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.fillStyle = col
      ctx.lineWidth = 3

      if (kind === 'spark') {
        ctx.beginPath()
        const pts = [[10, 85], [35, 60], [60, 70], [85, 35], [110, 45], [135, 15], [150, 20]]
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
        ctx.stroke()
        ctx.beginPath(); ctx.arc(150, 20, 5, 0, Math.PI * 2); ctx.fill()
      } else if (kind === 'bars') {
        const heights = [30, 55, 40, 75, 60]
        heights.forEach((h, i) => {
          const x = 15 + i * 28
          ctx.globalAlpha = 0.85
          ctx.strokeRect(x, 95 - h, 18, h)
          ctx.globalAlpha = 0.25; ctx.fillRect(x, 95 - h, 18, h); ctx.globalAlpha = 1
        })
      } else if (kind === 'scatter') {
        ctx.globalAlpha = 0.9
        const dots = [[20, 80], [40, 60], [55, 70], [70, 45], [90, 50], [105, 30], [120, 35], [140, 15]]
        dots.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill() })
        ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(15, 82); ctx.lineTo(145, 12); ctx.stroke()
      } else if (kind === 'area') {
        ctx.beginPath()
        const pts = [[10, 70], [40, 50], [70, 60], [100, 25], [150, 35]]
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
        ctx.stroke()
        ctx.lineTo(150, 100); ctx.lineTo(10, 100); ctx.closePath()
        ctx.globalAlpha = 0.2; ctx.fill()
      } else if (kind === 'gauge') {
        ctx.beginPath(); ctx.arc(80, 70, 45, Math.PI * 0.75, Math.PI * 2.25); ctx.globalAlpha = 0.4; ctx.stroke()
        ctx.beginPath(); ctx.arc(80, 70, 45, Math.PI * 0.75, Math.PI * 1.65); ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.stroke()
        ctx.beginPath(); ctx.arc(80, 70, 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill()
      } else if (kind === 'percent') {
        ctx.font = '600 34px Helvetica, Arial, sans-serif'
        ctx.fillStyle = 'rgba(255,255,255,0.92)'
        ctx.fillText('86%', 22, 65)
        ctx.strokeStyle = col; ctx.lineWidth = 4
        ctx.beginPath(); ctx.moveTo(105, 55); ctx.lineTo(130, 30); ctx.lineTo(150, 40)
        ctx.moveTo(130, 30); ctx.lineTo(133, 45); ctx.moveTo(130, 30); ctx.lineTo(115, 33)
        ctx.stroke()
      } else if (kind === 'grid') {
        for (let r = 0; r < 3; r++) {
          for (let cI = 0; cI < 3; cI++) {
            ctx.globalAlpha = 0.25 + Math.random() * 0.6
            ctx.fillRect(15 + cI * 45, 10 + r * 32, 38, 26)
          }
        }
      }
      return new THREE.CanvasTexture(c)
    }

    const spectrum = [
      { color: 0xff5c5c, kind: 'spark' },
      { color: 0xffa64d, kind: 'bars' },
      { color: 0xffe64d, kind: 'scatter' },
      { color: 0x7dff7d, kind: 'area' },
      { color: 0x4dd2ff, kind: 'gauge' },
      { color: 0x7c6cff, kind: 'percent' },
      { color: 0xd66dff, kind: 'grid' },
    ]

    const rays = []
    const disposables = [geo, mat, edgesGeo, beamGeo, beamMat, dataGeo, dataMat]
    spectrum.forEach((s, i) => {
      const rgeo = new THREE.PlaneGeometry(4.5, 0.03)
      const rmat = new THREE.MeshBasicMaterial({
        color: s.color, transparent: true, opacity: 0,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
      })
      const ray = new THREE.Mesh(rgeo, rmat)
      const angle = (i - (spectrum.length - 1) / 2) * 0.05
      ray.position.set(2.5, Math.sin(angle) * 1.4, 0)
      ray.rotation.z = angle
      ray.scale.x = 0.02
      scene.add(ray)

      const glowTex = makeGlyphTexture(s.kind, s.color)
      const spriteMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false })
      const sprite = new THREE.Sprite(spriteMat)
      const tipX = 2.5 + Math.cos(angle) * 4.6
      const tipY = Math.sin(angle) * 1.4 + Math.sin(angle) * 4.6
      sprite.position.set(tipX + 0.5, tipY, 0.3)
      sprite.scale.set(1.1, 0.76, 1)
      scene.add(sprite)

      rays.push({ mesh: ray, sprite, phase: i })
      disposables.push(rgeo, rmat, glowTex, spriteMat)
    })

    // ── ambient particles ────────────────────────────────────────────────
    const starCount = 260
    const starGeo = new THREE.BufferGeometry()
    const positions = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 22
      positions[i * 3 + 1] = (Math.random() - 0.5) * 13
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10 - 2
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.022, transparent: true, opacity: 0.55 })
    const stars = new THREE.Points(starGeo, starMat)
    scene.add(stars)
    disposables.push(starGeo, starMat)

    // ── mouse parallax ───────────────────────────────────────────────────
    let mouseX = 0, mouseY = 0
    const onMouseMove = (e) => {
      mouseX = e.clientX / window.innerWidth - 0.5
      mouseY = e.clientY / window.innerHeight - 0.5
    }
    window.addEventListener('mousemove', onMouseMove)

    const onResize = () => {
      camera.aspect = wrap.clientWidth / wrap.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(wrap.clientWidth, wrap.clientHeight)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(wrap)

    const RAY_START = 0.18, RAY_END = 0.82
    const RAY_WINDOW = (RAY_END - RAY_START) / spectrum.length

    let t = 0
    let smoothed = 0
    let rafId
    function animate() {
      rafId = requestAnimationFrame(animate)
      t += 0.006
      // Same "ease toward the real scroll position" damping as the source
      // prototype — this is what gives the scene its fluid catch-up feel.
      smoothed += (progressRef.current - smoothed) * 0.08

      crystal.rotation.y += 0.004
      crystal.rotation.x = Math.sin(t * 0.5) * 0.15

      const beamP = Math.min(1, smoothed / 0.15)
      beam.material.opacity = 0.18 + beamP * 0.35

      for (let i = 0; i < DATA_DOTS; i++) {
        const phase = (t * 0.6 + i / DATA_DOTS) % 1
        const p = beamA.clone().lerp(beamB, phase)
        dataPos[i * 3] = p.x; dataPos[i * 3 + 1] = p.y; dataPos[i * 3 + 2] = p.z
      }
      dataGeo.attributes.position.needsUpdate = true
      dataMat.opacity = 0.3 + beamP * 0.5

      rays.forEach((r, i) => {
        const localP = Math.min(1, Math.max(0, (smoothed - (RAY_START + i * RAY_WINDOW)) / RAY_WINDOW))
        r.mesh.scale.x = 0.02 + localP * 0.98
        r.mesh.material.opacity = localP * (0.4 + Math.sin(t * 2 + r.phase) * 0.14)
        r.sprite.material.opacity = Math.max(0, (localP - 0.5) / 0.5) * 0.9
        r.sprite.scale.set(1.1 + localP * 0.15, 0.76 + localP * 0.1, 1)
      })

      camera.position.x += (mouseX * 1.4 - camera.position.x) * 0.03
      camera.position.y += (0.5 - mouseY * 1.0 - camera.position.y) * 0.03
      camera.lookAt(0, 0, 0)

      stars.rotation.y += 0.0002

      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('mousemove', onMouseMove)
      ro.disconnect()
      disposables.forEach((d) => d.dispose())
      renderer.dispose()
      if (renderer.domElement.parentNode === wrap) wrap.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }} />
}
