import { useEffect, useRef } from 'react'

const TAU = Math.PI * 2

type Kind = 'schnitzel' | 'pommes' | 'spaetzle' | 'brezel' | 'wurst' | 'zitrone'
const KINDS: Kind[] = ['schnitzel', 'pommes', 'spaetzle', 'brezel', 'wurst', 'zitrone', 'schnitzel', 'pommes', 'spaetzle']

function rnd(seed: number) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Alle Speisen sind selbst gezeichnet (keine Emojis), Mittelpunkt bei (0,0), Größe s ≈ Durchmesser. */
function draw(ctx: CanvasRenderingContext2D, k: Kind, s: number) {
  const r = s / 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (k === 'schnitzel') {
    // Paniertes Schnitzel: unregelmäßiger goldener Fladen mit Krümeln
    ctx.beginPath()
    const n = 18
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU
      const rr = r * (0.9 + 0.1 * Math.sin(i * 2.3) + 0.06 * Math.sin(i * 5.1))
      const x = Math.cos(a) * rr * 1.15
      const y = Math.sin(a) * rr * 0.82
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r * 1.2)
    g.addColorStop(0, '#f7c65a')
    g.addColorStop(0.6, '#dd9028')
    g.addColorStop(1, '#a8570f')
    ctx.fillStyle = g
    ctx.fill()
    ctx.strokeStyle = 'rgba(120,60,10,0.7)'
    ctx.lineWidth = Math.max(1, s * 0.03)
    ctx.stroke()
    for (let i = 0; i < 26; i++) {
      const a = rnd(i) * TAU
      const d = Math.sqrt(rnd(i + 40)) * r * 0.85
      ctx.fillStyle = rnd(i + 9) > 0.5 ? 'rgba(255,230,150,0.75)' : 'rgba(140,70,10,0.55)'
      ctx.beginPath()
      ctx.arc(Math.cos(a) * d * 1.1, Math.sin(a) * d * 0.78, Math.max(0.8, s * 0.028), 0, TAU)
      ctx.fill()
    }
  } else if (k === 'pommes') {
    // Pommes in rot-weißer Tüte
    const w = r * 1.1
    for (let i = 0; i < 8; i++) {
      const x = (i - 3.5) * (w / 4.2)
      const top = -r * (0.95 + rnd(i + 3) * 0.35)
      ctx.save()
      ctx.translate(x, r * 0.1)
      ctx.rotate((rnd(i + 7) - 0.5) * 0.35)
      ctx.fillStyle = rnd(i) > 0.5 ? '#f9d44a' : '#f3c52b'
      ctx.strokeStyle = 'rgba(160,100,10,0.6)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(-s * 0.055, top, s * 0.11, -top + r * 0.2, 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
    ctx.beginPath()
    ctx.moveTo(-w * 0.95, -r * 0.1)
    ctx.lineTo(w * 0.95, -r * 0.1)
    ctx.lineTo(w * 0.7, r * 0.95)
    ctx.lineTo(-w * 0.7, r * 0.95)
    ctx.closePath()
    ctx.fillStyle = '#e11d2e'
    ctx.fill()
    ctx.save()
    ctx.clip()
    ctx.fillStyle = '#fff'
    for (let i = -3; i < 4; i += 2) ctx.fillRect(i * w * 0.2 - w * 0.1, -r * 0.1, w * 0.2, r * 1.1)
    ctx.restore()
  } else if (k === 'spaetzle') {
    // Schüssel mit Spätzle
    ctx.fillStyle = '#f3dc8a'
    ctx.strokeStyle = '#c9a43a'
    ctx.lineWidth = Math.max(1, s * 0.025)
    for (let i = 0; i < 22; i++) {
      const a = rnd(i + 1) * Math.PI
      const d = Math.sqrt(rnd(i + 30)) * r * 0.85
      const x = Math.cos(a + Math.PI) * d
      const y = -Math.sin(a) * d * 0.45 - r * 0.1
      ctx.beginPath()
      ctx.ellipse(x, y, s * 0.085, s * 0.045, rnd(i + 5) * TAU, 0, TAU)
      ctx.fill()
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(-r * 1.05, -r * 0.05)
    ctx.quadraticCurveTo(-r * 0.9, r * 1.0, 0, r * 1.0)
    ctx.quadraticCurveTo(r * 0.9, r * 1.0, r * 1.05, -r * 0.05)
    ctx.closePath()
    const g = ctx.createLinearGradient(-r, 0, r, 0)
    g.addColorStop(0, '#f1f5f9')
    g.addColorStop(0.5, '#ffffff')
    g.addColorStop(1, '#cbd5e1')
    ctx.fillStyle = g
    ctx.fill()
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = Math.max(1.5, s * 0.04)
    ctx.beginPath()
    ctx.moveTo(-r * 0.97, r * 0.22)
    ctx.quadraticCurveTo(0, r * 0.38, r * 0.97, r * 0.22)
    ctx.stroke()
  } else if (k === 'brezel') {
    ctx.strokeStyle = '#a4571a'
    ctx.lineWidth = s * 0.15
    ctx.beginPath()
    ctx.moveTo(-r * 0.55, r * 0.75)
    ctx.bezierCurveTo(-r * 1.25, -r * 0.1, -r * 0.7, -r * 1.0, 0, -r * 0.55)
    ctx.bezierCurveTo(r * 0.7, -r * 1.0, r * 1.25, -r * 0.1, r * 0.55, r * 0.75)
    ctx.moveTo(-r * 0.55, r * 0.75)
    ctx.bezierCurveTo(-r * 0.1, r * 0.2, r * 0.1, r * 0.2, r * 0.55, r * 0.75)
    ctx.stroke()
    ctx.strokeStyle = '#d8883a'
    ctx.lineWidth = s * 0.07
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    for (let i = 0; i < 12; i++) ctx.fillRect((rnd(i) - 0.5) * r * 1.7, (rnd(i + 9) - 0.6) * r * 1.2, 2, 2)
  } else if (k === 'wurst') {
    ctx.rotate(-0.4)
    const g = ctx.createLinearGradient(0, -r * 0.3, 0, r * 0.3)
    g.addColorStop(0, '#d97a3a')
    g.addColorStop(1, '#8a3412')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.roundRect(-r * 1.1, -r * 0.3, r * 2.2, r * 0.6, r * 0.3)
    ctx.fill()
    ctx.strokeStyle = 'rgba(60,20,5,0.6)'
    ctx.lineWidth = Math.max(1, s * 0.03)
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath()
      ctx.moveTo(i * r * 0.28 - r * 0.08, -r * 0.28)
      ctx.lineTo(i * r * 0.28 + r * 0.08, r * 0.28)
      ctx.stroke()
    }
    ctx.strokeStyle = '#facc15'
    ctx.lineWidth = Math.max(1.5, s * 0.045)
    ctx.beginPath()
    for (let i = 0; i <= 8; i++) ctx.lineTo(-r * 0.8 + i * r * 0.2, (i % 2 ? 1 : -1) * r * 0.08)
    ctx.stroke()
  } else {
    // Zitronenscheibe
    ctx.fillStyle = '#facc15'
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.8, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#fef9c3'
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.7, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = '#fde047'
    ctx.lineWidth = Math.max(1.5, s * 0.04)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * r * 0.1, Math.sin(a) * r * 0.1)
      ctx.lineTo(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66)
      ctx.stroke()
    }
  }
}

interface Item { kind: Kind; x: number; y: number; size: number; speed: number; drift: number; rot: number; spin: number; alpha: number; phase: number }

export function FoodBackdrop() {
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
    let items: Item[] = []
    let cloth: HTMLCanvasElement | null = null

    const build = () => {
      const W = cv.width
      const H = cv.height
      // Karierte Tischdecke (rot-weiß, stark abgedunkelt)
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const o = c.getContext('2d')!
      o.fillStyle = '#1b0c07'
      o.fillRect(0, 0, W, H)
      const cell = Math.max(28, Math.round(W / 22))
      for (let y = 0; y * cell < H; y++) {
        for (let x = 0; x * cell < W; x++) {
          const a = (x % 2 === 0 ? 1 : 0) + (y % 2 === 0 ? 1 : 0)
          if (a === 0) continue
          o.fillStyle = a === 2 ? 'rgba(190,24,40,0.30)' : 'rgba(190,24,40,0.15)'
          o.fillRect(x * cell, y * cell, cell, cell)
        }
      }
      const v = o.createRadialGradient(W / 2, H * 0.45, H * 0.15, W / 2, H * 0.5, H * 0.95)
      v.addColorStop(0, 'rgba(255,200,120,0.10)')
      v.addColorStop(1, 'rgba(0,0,0,0.65)')
      o.fillStyle = v
      o.fillRect(0, 0, W, H)
      cloth = c
      const n = Math.round(Math.min(26, Math.max(12, W / 55)))
      items = Array.from({ length: n }, (_, i) => {
        const far = rnd(i + 70)
        return {
          kind: KINDS[i % KINDS.length],
          x: rnd(i + 1) * W,
          y: rnd(i + 20) * (H + 160) - 80,
          size: 30 + far * 54,
          speed: 8 + far * 26,
          drift: 6 + rnd(i + 5) * 14,
          rot: rnd(i + 9) * TAU,
          spin: (rnd(i + 11) - 0.5) * 0.5,
          alpha: 0.35 + far * 0.5,
          phase: rnd(i + 13) * TAU,
        }
      })
    }
    const resize = () => {
      cv.width = Math.round(window.innerWidth * scale)
      cv.height = Math.round(window.innerHeight * scale)
      build()
    }
    resize()
    window.addEventListener('resize', resize)

    const paint = () => {
      if (!cloth) return
      const W = cv.width
      const H = cv.height
      ctx.clearRect(0, 0, W, H)
      ctx.drawImage(cloth, 0, 0)
      for (const it of items) {
        const y = ((it.y + t * it.speed + 100) % (H + 200)) - 100
        const x = it.x + Math.sin(t * 0.4 + it.phase) * it.drift
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(it.rot + t * it.spin)
        ctx.globalAlpha = it.alpha
        ctx.shadowColor = 'rgba(0,0,0,0.5)'
        ctx.shadowBlur = 8
        ctx.shadowOffsetY = 4
        draw(ctx, it.kind, it.size)
        ctx.restore()
      }
      ctx.globalAlpha = 1
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
