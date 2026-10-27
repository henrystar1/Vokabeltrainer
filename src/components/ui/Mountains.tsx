import { useEffect, useRef } from 'react'

const TAU = Math.PI * 2
const PERIOD = 2400

/** Gebirgskamm, der sich alle PERIOD Pixel wiederholt (ganzzahlige Frequenzen), damit die langsame Fahrt nahtlos läuft. */
function ridge(x: number, seed: number): number {
  const u = (x / PERIOD) * TAU
  let h = 0
  const k = [3, 5, 8, 13, 21]
  const a = [0.5, 0.28, 0.14, 0.08, 0.04]
  for (let i = 0; i < k.length; i++) h += a[i] * (1 - Math.abs(Math.sin(u * k[i] * 0.5 + seed * (i + 1.7))))
  return h // 0 … ~1
}

interface Layer { base: number; amp: number; speed: number; top: string; bottom: string; snow: number; seed: number; mist: number }

const LAYERS: Layer[] = [
  { base: 0.60, amp: 0.30, speed: 3, top: '#4f7fc4', bottom: '#2a4f94', snow: 0.72, seed: 1.3, mist: 0.18 },
  { base: 0.68, amp: 0.30, speed: 6, top: '#34609f', bottom: '#1e3d78', snow: 0.74, seed: 4.1, mist: 0.2 },
  { base: 0.77, amp: 0.27, speed: 11, top: '#234a85', bottom: '#122a59', snow: 0.8, seed: 2.2, mist: 0.16 },
  { base: 0.87, amp: 0.2, speed: 18, top: '#14316a', bottom: '#0a1b3f', snow: 0, seed: 6.4, mist: 0.14 },
  { base: 1.0, amp: 0.2, speed: 28, top: '#0a1c42', bottom: '#030b21', snow: 0, seed: 8.8, mist: 0 },
]

/** Seilbahn auf der dritten Bergreihe: Talstation am tiefsten Punkt, Bergstation auf dem höchsten Gipfel davor (liegt auf der Wiederholungslänge fest). */
const CABLE_LAYER = 2
const CABLE = (() => {
  const L = LAYERS[CABLE_LAYER]
  let peak = 900
  for (let x = 900; x < 1900; x += 4) if (ridge(x, L.seed) > ridge(peak, L.seed)) peak = x
  let valley = peak - 420
  for (let x = peak - 760; x <= peak - 380; x += 4) if (ridge(x, L.seed) < ridge(valley, L.seed)) valley = x
  return { peak, valley }
})()
const CABIN_COLORS = ['#fb7185', '#fbbf24', '#38bdf8']

function drawCableCar(ctx: CanvasRenderingContext2D, L: Layer, W: number, H: number, scale: number, off: number, t: number): void {
  const wy = (wx: number) => H * L.base - ridge(wx, L.seed) * L.amp * H
  for (let rep = -1; rep <= 2; rep++) {
    const ax = (CABLE.valley + rep * PERIOD) * scale - off
    const bx = (CABLE.peak + rep * PERIOD) * scale - off
    if (bx < -60 || ax > W + 60) continue
    const ay0 = wy(CABLE.valley) - 12
    const by0 = wy(CABLE.peak) - 12
    // Seil muss über dem Gelände bleiben: nötigenfalls beide Enden anheben
    let lift = 0
    for (let i = 1; i < 12; i++) {
      const f = i / 12
      const lineY = ay0 + (by0 - ay0) * f
      const terrain = wy(CABLE.valley + (CABLE.peak - CABLE.valley) * f)
      lift = Math.max(lift, lineY - (terrain - 14))
    }
    const ay = ay0 - lift
    const by = by0 - lift
    const pos = (f: number, side: number): [number, number] => [ax + (bx - ax) * f, ay + (by - ay) * f + side * 6 + Math.sin(f * Math.PI) * 5]
    ctx.save()
    // Stützen und Stationen
    ctx.strokeStyle = '#0a1228'
    ctx.fillStyle = '#0a1228'
    ctx.lineWidth = 2
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const [px, py] = pos(f, 0)
      const gy = wy(CABLE.valley + (CABLE.peak - CABLE.valley) * f)
      ctx.beginPath(); ctx.moveTo(px, py - 2); ctx.lineTo(px, gy + 4); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(px - 5, py + 1); ctx.lineTo(px + 5, py + 1); ctx.stroke()
    }
    for (const f of [0, 1]) {
      const [px, py] = pos(f, 0)
      ctx.fillStyle = '#16213f'
      ctx.fillRect(px - 9, py - 4, 18, 15)
      ctx.fillStyle = '#0a1228'
      ctx.beginPath(); ctx.moveTo(px - 11, py - 4); ctx.lineTo(px, py - 11); ctx.lineTo(px + 11, py - 4); ctx.closePath(); ctx.fill()
      ctx.fillStyle = `rgba(253,224,130,${0.55 + 0.25 * Math.sin(t * 2 + f)})`
      ctx.fillRect(px - 4, py, 3, 4); ctx.fillRect(px + 1, py, 3, 4)
    }
    // zwei Seile
    ctx.strokeStyle = 'rgba(8,14,32,0.9)'
    ctx.lineWidth = 1.2
    for (const side of [-1, 1]) {
      ctx.beginPath()
      for (let i = 0; i <= 24; i++) { const [px, py] = pos(i / 24, side); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py) }
      ctx.stroke()
    }
    // Gondeln: drei fahren hinauf (oberes Seil), drei hinunter (unteres Seil), an den Stationen kurz langsamer
    const ph = t * 0.035
    for (let k = 0; k < 3; k++) {
      for (const dir of [1, -1]) {
        const raw = (ph + k / 3 + (dir === 1 ? 0 : 1 / 6)) % 1
        const u = raw
        const f = dir === 1 ? u : 1 - u
        const side = dir === 1 ? -1 : 1
        const [px, py] = pos(Math.max(0.02, Math.min(0.98, f)), side)
        const col = CABIN_COLORS[(k + (dir === 1 ? 0 : 1)) % 3]
        const sw = Math.sin(t * 1.7 + k * 2 + dir) * 0.07
        ctx.save()
        ctx.translate(px, py)
        ctx.rotate(sw)
        ctx.strokeStyle = '#0a1228'; ctx.lineWidth = 1.2
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 6); ctx.stroke()
        ctx.shadowColor = col; ctx.shadowBlur = 6
        ctx.fillStyle = col
        ctx.beginPath(); ctx.roundRect(-6, 6, 12, 9, 2); ctx.fill()
        ctx.shadowBlur = 0
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.fillRect(-4, 8, 3, 3); ctx.fillRect(1, 8, 3, 3)
        ctx.fillStyle = '#0a1228'
        ctx.fillRect(-7, 5, 14, 2)
        ctx.restore()
      }
    }
    ctx.restore()
  }
}

export function MountainBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const scale = 0.75
    const still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let last = performance.now()
    let t = 0
    const resize = () => {
      cv.width = Math.round(window.innerWidth * scale)
      cv.height = Math.round(window.innerHeight * scale)
    }
    resize()
    window.addEventListener('resize', resize)

    const paint = () => {
      const W = cv.width
      const H = cv.height
      const sx = W * 0.68
      const sy = H * 0.5
      // Himmel (Dämmerung)
      const sky = ctx.createLinearGradient(0, 0, 0, H * 0.75)
      sky.addColorStop(0, '#04122e')
      sky.addColorStop(0.45, '#0f3b8a')
      sky.addColorStop(0.75, '#2f7fd6')
      sky.addColorStop(1, '#8fd0ff')
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, W, H)
      // Sterne
      for (let i = 0; i < 60; i++) {
        const x = ((Math.sin(i * 91.7) * 0.5 + 0.5) * W * 1.1 - t * 0.6) % W
        const y = (Math.sin(i * 47.3) * 0.5 + 0.5) * H * 0.42
        ctx.fillStyle = `rgba(255,255,255,${0.2 + 0.5 * Math.abs(Math.sin(t * 0.9 + i))})`
        ctx.fillRect(x < 0 ? x + W : x, y, 1.4, 1.4)
      }
      // Sonne mit Strahlen
      ctx.globalCompositeOperation = 'lighter'
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * 0.7)
      glow.addColorStop(0, 'rgba(214,240,255,0.7)')
      glow.addColorStop(0.15, 'rgba(96,180,255,0.38)')
      glow.addColorStop(0.5, 'rgba(56,130,246,0.14)')
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, W, H)
      const rays = 16
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * TAU + t * 0.03
        const w = 0.07 + 0.03 * Math.sin(t * 0.5 + i * 2)
        const len = Math.max(W, H) * 1.3
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, len)
        g.addColorStop(0, 'rgba(200,232,255,0.15)')
        g.addColorStop(1, 'rgba(200,232,255,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(sx + Math.cos(a - w) * len, sy + Math.sin(a - w) * len)
        ctx.lineTo(sx + Math.cos(a + w) * len, sy + Math.sin(a + w) * len)
        ctx.closePath()
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = '#f2faff'
      ctx.beginPath()
      ctx.arc(sx, sy, Math.max(14, W * 0.022), 0, TAU)
      ctx.fill()

      // Berge: weit → nah
      LAYERS.forEach((L, li) => {
        const off = t * L.speed
        const step = 6
        const pts: Array<[number, number]> = []
        for (let x = -step; x <= W + step; x += step) {
          const wx = (x + off) / scale
          pts.push([x, H * L.base - ridge(wx, L.seed) * L.amp * H])
        }
        const path = new Path2D()
        path.moveTo(-step, H + 2)
        for (const [x, y] of pts) path.lineTo(x, y)
        path.lineTo(W + step, H + 2)
        path.closePath()
        const g = ctx.createLinearGradient(0, H * (L.base - L.amp), 0, H)
        g.addColorStop(0, L.top)
        g.addColorStop(1, L.bottom)
        ctx.fillStyle = g
        ctx.fill(path)
        // Schnee mit warmem Licht von der Sonne
        if (L.snow > 0) {
          ctx.save()
          ctx.clip(path)
          const topY = H * (L.base - L.amp)
          const line = (x: number) => topY + (1 - L.snow) * L.amp * H + (Math.sin(((x + off) / scale) * 0.07 + L.seed) * 0.5 + 0.5) * 7
          ctx.beginPath()
          ctx.moveTo(-step, topY - 4)
          for (let x = -step; x <= W + step; x += 5) ctx.lineTo(x, line(x))
          ctx.lineTo(W + step, topY - 4)
          ctx.closePath()
          const sn = ctx.createLinearGradient(0, topY, 0, topY + L.amp * H * 0.4)
          sn.addColorStop(0, 'rgba(248,252,255,0.97)')
          sn.addColorStop(1, 'rgba(186,216,255,0.55)')
          ctx.fillStyle = sn
          ctx.fill()
          // Glitzern
          ctx.globalCompositeOperation = 'lighter'
          for (let i = 0; i < 9; i++) {
            const x = ((i * 137 + li * 53) % W)
            const px = pts[Math.min(pts.length - 1, Math.round(x / step))]
            const a = 0.15 + 0.7 * Math.abs(Math.sin(t * 1.3 + i * 1.9 + li))
            ctx.fillStyle = `rgba(255,255,255,${a})`
            ctx.fillRect(px[0], px[1] + 4, 1.8, 1.8)
          }
          ctx.restore()
        }
        if (li === CABLE_LAYER) drawCableCar(ctx, L, W, H, scale, off, t)
        // Nebelband vor dem nächsten Berg
        if (L.mist > 0) {
          const yy = H * (L.base + 0.02)
          const mg = ctx.createLinearGradient(0, yy - H * 0.08, 0, yy + H * 0.06)
          mg.addColorStop(0, 'rgba(214,232,255,0)')
          mg.addColorStop(0.5, `rgba(214,232,255,${L.mist * (0.7 + 0.3 * Math.sin(t * 0.25 + li))})`)
          mg.addColorStop(1, 'rgba(214,232,255,0)')
          ctx.fillStyle = mg
          ctx.fillRect(0, yy - H * 0.08, W, H * 0.14)
        }
      })
    }
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      if (document.visibilityState === 'visible') {
        t += still ? 0 : dt
        paint()
      }
      if (!still) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    if (still) paint()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />
}
