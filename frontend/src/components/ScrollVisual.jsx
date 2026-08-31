import { useEffect, useRef } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// ScrollVisual — a <canvas> that is a pure function of `progress` (0-1).
// Two modes, switched by whether `frames` is provided — this is the ENTIRE
// swap-in point for real video footage later:
//
//   Mode A (now, no assets): a procedural animation — a beam of light forms
//   into the ◈ diamond (PRISM's own wordmark glyph), which fans out colored
//   rays that resolve into a small connected constellation of nodes. Every
//   position is a deterministic function of `progress` and canvas size (a
//   fixed, hand-written array of node offsets — never Math.random() per
//   frame), so scrubbing back and forth always reproduces the same frame.
//
//   Mode B (later, real video): pass `frames` — an ordered array of image
//   URLs. To activate: extract a real video with
//     ffmpeg -i source.mp4 -vf fps=12 public/landing-frames/frame-%04d.jpg
//   then pass frames={Array.from({length:N}, (_,i) =>
//     `/landing-frames/frame-${String(i+1).padStart(4,'0')}.jpg`)}
//   from Landing.jsx. No other file needs to change.
// ─────────────────────────────────────────────────────────────────────────────

const lerp = (a, b, t) => a + (b - a) * t
const clamp01 = (v) => Math.max(0, Math.min(1, v))
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
const easeOut = (t) => 1 - Math.pow(1 - t, 3)

// Fixed ray angles (degrees) fanning out from the diamond — hand-picked, not
// generated, so the shape is identical on every render at the same progress.
const RAY_ANGLES = [-50, -32, -14, 4, 20, 36, 50]
const RAY_LENGTH_MULT = [0.72, 0.9, 1, 0.8, 0.95, 0.78, 1]

// Fixed scatter of constellation nodes (fractions of the ray-fan area),
// hand-placed to look organic without ever being recomputed per frame.
const NODE_OFFSETS = [
  [0.08, 0.10], [0.22, -0.05], [0.36, 0.16], [0.5, -0.12], [0.64, 0.06],
  [0.15, 0.32], [0.3, 0.4], [0.46, 0.3], [0.6, 0.38], [0.74, 0.22],
  [0.1, -0.28], [0.26, -0.34], [0.42, -0.22], [0.58, -0.32], [0.72, -0.1],
  [0.82, 0.05], [0.86, -0.2], [0.2, 0.06], [0.68, 0.34], [0.9, 0.24],
]

function drawBeamAndDiamond(ctx, W, H, progress, palette) {
  const cx0 = W * 0.5
  const cy = lerp(H * 0.45, H * 0.38, clamp01((progress - 0.5) / 0.5))

  // Beam: grows from the left edge toward the diamond, then recedes as the
  // rays take over as the dominant visual.
  const beamT = clamp01(progress / 0.5)
  const beamLen = lerp(0, cx0, beamT)
  const beamFade = 1 - clamp01((progress - 0.5) / 0.3) * 0.7
  ctx.strokeStyle = palette.muted
  ctx.lineWidth = 2
  ctx.globalAlpha = lerp(0.12, 0.55, beamT) * beamFade
  ctx.beginPath()
  ctx.moveTo(0, cy)
  ctx.lineTo(beamLen, cy)
  ctx.stroke()

  // Diamond (◈): outline appears early, fills in and grows through the
  // midpoint, then keeps growing slightly and rotating as progress finishes.
  const diamondT = clamp01((progress - 0.05) / 0.45)
  const size = lerp(14, 46, easeInOut(diamondT)) + lerp(0, 10, clamp01((progress - 0.5) / 0.5))
  const rotation = progress * Math.PI * 0.6

  ctx.save()
  ctx.translate(cx0, cy)
  ctx.rotate(rotation)
  ctx.beginPath()
  ctx.moveTo(0, -size)
  ctx.lineTo(size, 0)
  ctx.lineTo(0, size)
  ctx.lineTo(-size, 0)
  ctx.closePath()

  const grad = ctx.createLinearGradient(-size, -size, size, size)
  grad.addColorStop(0, palette.primary)
  grad.addColorStop(1, palette.blue)
  ctx.globalAlpha = lerp(0.25, 1, diamondT)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = palette.primary
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()

  return { cx: cx0, cy, size, rotation }
}

function drawRays(ctx, W, H, progress, palette, origin) {
  const rayT = clamp01((progress - 0.35) / 0.65)
  if (rayT <= 0) return []
  const colors = [palette.primary, palette.blue, palette.success, palette.warning, palette.pink]
  const maxLen = W * 0.32
  const tips = []

  // Ray angles are relative to the diamond's own current rotation, not the
  // canvas's fixed axes — otherwise the fan would visibly drift out of
  // alignment with the diamond's vertices as `rotation` grows with progress.
  RAY_ANGLES.forEach((deg, i) => {
    const rad = (deg * Math.PI) / 180 + origin.rotation
    const len = lerp(0, maxLen * RAY_LENGTH_MULT[i], easeOut(rayT))
    const startX = origin.cx + Math.cos(rad) * origin.size
    const startY = origin.cy + Math.sin(rad) * origin.size
    const tipX = origin.cx + Math.cos(rad) * (origin.size + len)
    const tipY = origin.cy + Math.sin(rad) * (origin.size + len)
    const color = colors[i % colors.length]

    ctx.globalAlpha = lerp(0, 0.85, rayT)
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(startX, startY)
    ctx.lineTo(tipX, tipY)
    ctx.stroke()

    // Small particle dots along the ray, plus one at the tip.
    ;[0.45, 0.75, 1].forEach((frac) => {
      const px = lerp(startX, tipX, frac)
      const py = lerp(startY, tipY, frac)
      ctx.globalAlpha = lerp(0, 0.9, rayT) * (frac === 1 ? 1 : 0.6)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(px, py, frac === 1 ? 3 : 2, 0, Math.PI * 2)
      ctx.fill()
    })

    tips.push({ x: tipX, y: tipY, color })
  })

  return tips
}

function drawConstellation(ctx, W, H, progress, palette, tips) {
  const nodeT = clamp01((progress - 0.6) / 0.4)
  if (nodeT <= 0 || !tips.length) return

  const spreadW = W * 0.3
  const spreadH = H * 0.45
  const anchorX = W * 0.62
  const anchorY = H * 0.4

  const nodes = NODE_OFFSETS.map(([fx, fy], i) => ({
    x: anchorX + fx * spreadW,
    y: anchorY + fy * spreadH,
    color: tips[i % tips.length].color,
  }))

  // Connect each node to the next one (fixed pairing, not distance-searched
  // per frame) — cheap and, with hand-placed offsets, still reads as an
  // organic small network.
  ctx.lineWidth = 1
  for (let i = 0; i < nodes.length - 1; i++) {
    ctx.globalAlpha = nodeT * 0.22
    ctx.strokeStyle = palette.border
    ctx.beginPath()
    ctx.moveTo(nodes[i].x, nodes[i].y)
    ctx.lineTo(nodes[i + 1].x, nodes[i + 1].y)
    ctx.stroke()
  }

  nodes.forEach((n) => {
    ctx.globalAlpha = nodeT * 0.9
    ctx.fillStyle = n.color
    ctx.beginPath()
    ctx.arc(n.x, n.y, 2.6, 0, Math.PI * 2)
    ctx.fill()
  })
}

function drawProcedural(ctx, W, H, progress, palette) {
  ctx.clearRect(0, 0, W, H)
  const origin = drawBeamAndDiamond(ctx, W, H, progress, palette)
  const tips = drawRays(ctx, W, H, progress, palette, origin)
  drawConstellation(ctx, W, H, progress, palette, tips)
  ctx.globalAlpha = 1
}

// "Cover" draw — fills the canvas with the image regardless of aspect ratio,
// cropping rather than distorting.
function drawImageCover(ctx, img, W, H) {
  ctx.clearRect(0, 0, W, H)
  const scale = Math.max(W / img.width, H / img.height)
  const w = img.width * scale
  const h = img.height * scale
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
}

export default function ScrollVisual({ progress, frames, C }) {
  const canvasRef = useRef(null)
  const imagesRef = useRef([])
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })

  // Preload frame images whenever the `frames` prop is provided/changes —
  // Mode B only. Mode A (no frames) never touches this.
  useEffect(() => {
    if (!frames || !frames.length) { imagesRef.current = []; return }
    imagesRef.current = frames.map((src) => {
      const img = new Image()
      img.src = src
      return img
    })
  }, [frames])

  // Resize the backing store to match the container's real CSS size ×
  // devicePixelRatio, so drawing stays crisp on high-DPI screens.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      sizeRef.current = { w: width, h: height, dpr }
      redraw()
    })
    ro.observe(canvas.parentElement || canvas)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const redraw = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    // jsdom (used in tests) has no real canvas backend and returns null
    // here — skip drawing entirely rather than throwing.
    if (!ctx) return
    const { w, h, dpr } = sizeRef.current
    if (!w || !h) return
    ctx.save()
    ctx.scale(dpr, dpr)

    if (frames && frames.length) {
      const idx = Math.max(0, Math.min(frames.length - 1, Math.round(progress * (frames.length - 1))))
      const img = imagesRef.current[idx]
      if (img && img.complete && img.naturalWidth > 0) {
        drawImageCover(ctx, img, w, h)
      }
    } else {
      drawProcedural(ctx, w, h, progress, C)
    }
    ctx.restore()
  }

  useEffect(() => {
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, frames])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    />
  )
}
