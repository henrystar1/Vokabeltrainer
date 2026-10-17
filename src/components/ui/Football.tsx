import { useEffect, useRef } from 'react'

const TAU = Math.PI * 2

/** Fußball mit Fünfeck-Muster, gezeichnet bei (x, y) mit Radius r und Drehung rot. */
function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.save()
  ctx.translate(x, y)
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(1, '#cbd5e1')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, TAU)
  ctx.fill()
  ctx.save()
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, TAU)
  ctx.clip()
  ctx.rotate(rot)
  ctx.fillStyle = '#0f172a'
  const pent = (cx: number, cy: number, pr: number, a0: number) => {
    ctx.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = a0 + (i / 5) * TAU
      const px = cx + Math.cos(a) * pr
      const py = cy + Math.sin(a) * pr
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
  }
  pent(0, 0, r * 0.38, -Math.PI / 2)
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * TAU + Math.PI / 5
    pent(Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02, r * 0.34, a + Math.PI / 2)
  }
  ctx.restore()
  ctx.strokeStyle = 'rgb(15 23 42 / 0.55)'
  ctx.lineWidth = Math.max(1, r * 0.08)
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, TAU)
  ctx.stroke()
  ctx.restore()
}

interface Flash { x: number; y: number; life: number }

export function FootballBackdrop() {
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
    let pitch: HTMLCanvasElement | null = null
    const flashes: Flash[] = []

    const buildPitch = () => {
      const W = cv.width
      const H = cv.height
      const hz = H * 0.4
      const off = document.createElement('canvas')
      off.width = W
      off.height = H
      const o = off.getContext('2d')!
      // Nachthimmel
      const sky = o.createLinearGradient(0, 0, 0, hz)
      sky.addColorStop(0, '#020a1c')
      sky.addColorStop(1, '#0b2a3a')
      o.fillStyle = sky
      o.fillRect(0, 0, W, hz + 2)
      // Tribüne: Zuschauerband mit bunten Punkten
      const standTop = hz - H * 0.11
      const stand = o.createLinearGradient(0, standTop, 0, hz)
      stand.addColorStop(0, '#0a1424')
      stand.addColorStop(1, '#16253a')
      o.fillStyle = stand
      o.beginPath()
      o.moveTo(0, hz)
      o.lineTo(0, standTop + H * 0.03)
      o.lineTo(W * 0.5, standTop)
      o.lineTo(W, standTop + H * 0.03)
      o.lineTo(W, hz)
      o.closePath()
      o.fill()
      let seed = 7
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      const cols = ['#ef4444', '#f8fafc', '#facc15', '#22c55e', '#38bdf8', '#f8fafc']
      for (let i = 0; i < W * 0.9; i++) {
        const x = rnd() * W
        const edge = standTop + H * 0.03 - Math.abs(x / W - 0.5) * H * 0.06 * 2 + H * 0.02
        const y = edge + rnd() * (hz - edge)
        o.fillStyle = cols[Math.floor(rnd() * cols.length)]
        o.globalAlpha = 0.35 + rnd() * 0.4
        o.fillRect(x, y, 2, 2)
      }
      o.globalAlpha = 1
      // Rasen mit Mähstreifen (Perspektive)
      for (let y = Math.floor(hz); y < H; y += 2) {
        const z = 1 / (y - hz + 6)
        const stripe = Math.floor(z * 520) % 2 === 0
        const k = (y - hz) / (H - hz)
        const l = 20 + k * 12
        o.fillStyle = stripe ? `hsl(135 62% ${l}%)` : `hsl(138 58% ${l - 4}%)`
        o.fillRect(0, y, W, 2)
      }
      // Spielfeldlinien
      o.strokeStyle = 'rgb(255 255 255 / 0.55)'
      o.lineWidth = 2
      const cx = W / 2
      const yAt = (d: number) => hz + (H - hz) * d
      // Mittellinie
      o.beginPath()
      o.moveTo(0, yAt(0.3))
      o.lineTo(W, yAt(0.3))
      o.stroke()
      // Mittelkreis
      o.beginPath()
      o.ellipse(cx, yAt(0.3), W * 0.17, (H - hz) * 0.14, 0, 0, TAU)
      o.stroke()
      o.beginPath()
      o.arc(cx, yAt(0.3), 3, 0, TAU)
      o.fillStyle = 'rgb(255 255 255 / 0.7)'
      o.fill()
      // Seitenlinien
      o.beginPath()
      o.moveTo(cx - W * 0.1, hz)
      o.lineTo(-W * 0.2, H)
      o.moveTo(cx + W * 0.1, hz)
      o.lineTo(W * 1.2, H)
      o.stroke()
      // Dunkle Ränder
      const vg = o.createRadialGradient(cx, H * 0.6, H * 0.2, cx, H * 0.6, H * 0.95)
      vg.addColorStop(0, 'rgb(0 0 0 / 0)')
      vg.addColorStop(1, 'rgb(0 0 0 / 0.55)')
      o.fillStyle = vg
      o.fillRect(0, 0, W, H)
      pitch = off
    }

    const resize = () => {
      cv.width = Math.round(window.innerWidth * scale)
      cv.height = Math.round(window.innerHeight * scale)
      buildPitch()
    }
    resize()
    window.addEventListener('resize', resize)

    const paint = () => {
      if (!pitch) return
      const W = cv.width
      const H = cv.height
      const hz = H * 0.4
      ctx.clearRect(0, 0, W, H)
      ctx.drawImage(pitch, 0, 0)

      // Flutlichtkegel (leichtes Flackern)
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (const side of [0.12, 0.88]) {
        const fl = 0.75 + 0.25 * Math.sin(t * 1.3 + side * 9)
        const lx = W * side
        const ly = hz - H * 0.17
        const g = ctx.createRadialGradient(lx, ly, 2, lx, ly, H * 0.5)
        g.addColorStop(0, `rgb(255 250 220 / ${0.55 * fl})`)
        g.addColorStop(0.15, `rgb(255 245 200 / ${0.2 * fl})`)
        g.addColorStop(1, 'rgb(255 240 200 / 0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, W, H)
        // Lichtkegel auf den Rasen
        const tx = W * (side < 0.5 ? 0.55 : 0.45)
        const cone = ctx.createLinearGradient(lx, ly, tx, H)
        cone.addColorStop(0, `rgb(255 250 220 / ${0.16 * fl})`)
        cone.addColorStop(1, 'rgb(255 250 220 / 0)')
        ctx.fillStyle = cone
        ctx.beginPath()
        ctx.moveTo(lx - 6, ly)
        ctx.lineTo(lx + 6, ly)
        ctx.lineTo(tx + W * 0.28, H)
        ctx.lineTo(tx - W * 0.28, H)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()

      // Kamerablitze auf der Tribüne
      if (!still && Math.random() < 0.35) flashes.push({ x: Math.random() * W, y: hz - H * (0.015 + Math.random() * 0.08), life: 1 })
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]
        f.life -= 0.08
        if (f.life <= 0) { flashes.splice(i, 1); continue }
        ctx.fillStyle = `rgb(255 255 255 / ${f.life})`
        ctx.beginPath()
        ctx.arc(f.x, f.y, 1 + f.life * 2.2, 0, TAU)
        ctx.fill()
      }

      // Ball: rollt und hüpft quer über den Rasen
      const T = 9
      const ph = (t % T) / T
      const bx = -W * 0.08 + ph * W * 1.16
      const groundD = 0.62 + 0.1 * Math.sin(ph * TAU * 0.5)
      const gy = hz + (H - hz) * groundD
      const sc = (gy - hz) / (H - hz)
      const r = 7 + sc * 15
      const hop = Math.abs(Math.sin(ph * TAU * 3)) * (1 - ph * 0.35) * H * 0.16 * sc
      // Schatten
      ctx.fillStyle = `rgb(0 0 0 / ${Math.max(0.08, 0.35 - hop / (H * 0.3))})`
      ctx.beginPath()
      ctx.ellipse(bx, gy + r * 0.9, r * (1.1 - hop / (H * 0.5)), r * 0.32, 0, 0, TAU)
      ctx.fill()
      // Spur
      for (let i = 1; i <= 6; i++) {
        const pp = ph - i * 0.006
        const tx = -W * 0.08 + pp * W * 1.16
        const thop = Math.abs(Math.sin(pp * TAU * 3)) * (1 - pp * 0.35) * H * 0.16 * sc
        ctx.fillStyle = `rgb(255 255 255 / ${0.12 - i * 0.017})`
        ctx.beginPath()
        ctx.arc(tx, gy - thop - r * 0.6, r * (1 - i * 0.1), 0, TAU)
        ctx.fill()
      }
      drawBall(ctx, bx, gy - hop - r * 0.6, r, t * 5)
    }

    const loop = (now: number) => {
      t += Math.min(0.05, (now - last) / 1000)
      last = now
      paint()
      raf = requestAnimationFrame(loop)
    }
    if (still) paint()
    else raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />
}
