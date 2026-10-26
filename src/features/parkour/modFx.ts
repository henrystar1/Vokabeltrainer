import { PH, PW } from './engine'
import type { HoleAnim } from './adminFx'

/** Hammer-Auftritt für Mods: ein Hammer fällt vom Himmel, ein großer Blitz schlägt in den Boden, dann steht die Person da. */
export const HAMMER_IN = 1.5
export const HAMMER_OUT = 1.2
/** Ab dieser Zeit (s) ist die Figur beim Einsteigen da */
export const HAMMER_APPEAR = 0.55

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const ease = (v: number) => v * v * (3 - 2 * v)
const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }

/** Zackiger Blitz von (x0,y0) nach (x1,y1); seed ändert die Form (flackert, wenn man ihn pro Bild wechselt). */
function bolt(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, seed: number, width: number, jag: number): void {
  const pts: Array<[number, number]> = [[x0, y0]]
  const n = 11
  for (let i = 1; i < n; i++) {
    const k = i / n
    pts.push([x0 + (x1 - x0) * k + (rnd(seed + i * 3.1) - 0.5) * jag, y0 + (y1 - y0) * k])
  }
  pts.push([x1, y1])
  const path = () => { c.beginPath(); pts.forEach(([px, py], i) => (i === 0 ? c.moveTo(px, py) : c.lineTo(px, py))) }
  c.lineJoin = 'round'; c.lineCap = 'round'
  c.strokeStyle = 'rgba(96,165,250,0.55)'; c.lineWidth = width * 3.2; path(); c.stroke()
  c.strokeStyle = 'rgba(253,224,71,0.9)'; c.lineWidth = width * 1.6; path(); c.stroke()
  c.strokeStyle = '#fff'; c.lineWidth = width * 0.7; path(); c.stroke()
  // Seitenäste
  for (let b = 2; b < pts.length - 2; b += 3) {
    const [bx, by] = pts[b]
    const dir = rnd(seed + b) < 0.5 ? -1 : 1
    c.strokeStyle = 'rgba(253,224,71,0.85)'; c.lineWidth = width * 0.6
    c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + dir * (14 + rnd(seed + b * 2) * 18), by + 12 + rnd(seed + b * 5) * 12); c.lineTo(bx + dir * (26 + rnd(seed + b * 7) * 20), by + 26 + rnd(seed + b * 9) * 14); c.stroke()
  }
}

/** Ein Hammer; (cx, cy) = Mitte des Kopfes, ang = Drehung. */
function hammer(c: CanvasRenderingContext2D, cx: number, cy: number, ang: number, scale: number, t: number, alpha = 1): void {
  c.save()
  c.globalAlpha *= alpha
  c.translate(cx, cy); c.rotate(ang); c.scale(scale, scale)
  c.shadowColor = '#60a5fa'; c.shadowBlur = 16
  // Stiel
  c.fillStyle = '#92400e'; c.fillRect(-3.5, 4, 7, 40)
  c.fillStyle = '#fbbf24'; c.fillRect(-4, 38, 8, 5)
  // Kopf
  const g = c.createLinearGradient(-20, -14, 20, 14)
  g.addColorStop(0, '#e2e8f0'); g.addColorStop(0.5, '#94a3b8'); g.addColorStop(1, '#475569')
  c.fillStyle = g
  c.beginPath(); c.roundRect(-22, -14, 44, 28, 5); c.fill()
  c.shadowBlur = 0
  c.fillStyle = '#fbbf24'; c.fillRect(-22, -14, 6, 28); c.fillRect(16, -14, 6, 28)
  c.strokeStyle = '#1e293b'; c.lineWidth = 1.5; c.beginPath(); c.roundRect(-22, -14, 44, 28, 5); c.stroke()
  // Funken auf dem Kopf
  c.strokeStyle = `rgba(253,224,71,${0.5 + 0.5 * Math.sin(t * 25)})`; c.lineWidth = 1.5
  c.beginPath(); c.moveTo(-8, -2); c.lineTo(-2, -8); c.lineTo(2, 0); c.lineTo(8, -6); c.stroke()
  c.restore()
}

/** Leuchten hinter der Figur: kleine blaue Blitzbögen. */
export function drawModBack(c: CanvasRenderingContext2D, x: number, y: number, t: number, alpha = 1): void {
  const cx = x + PW / 2, cy = y + PH / 2
  c.save()
  c.globalAlpha = alpha
  const pulse = 1 + 0.1 * Math.sin(t * 6)
  const g = c.createRadialGradient(cx, cy, 4, cx, cy, 40 * pulse)
  g.addColorStop(0, 'rgba(147,197,253,0.45)'); g.addColorStop(0.6, 'rgba(59,130,246,0.2)'); g.addColorStop(1, 'rgba(59,130,246,0)')
  c.fillStyle = g
  c.beginPath(); c.arc(cx, cy, 40 * pulse, 0, Math.PI * 2); c.fill()
  // flackernde Bögen
  const f = Math.floor(t * 14)
  c.strokeStyle = 'rgba(253,224,71,0.85)'; c.lineWidth = 1.4
  for (let k = 0; k < 3; k++) {
    if (rnd(f * 3 + k) < 0.35) continue
    const a = rnd(f + k * 17) * Math.PI * 2
    c.beginPath(); c.moveTo(cx + Math.cos(a) * 18, cy + Math.sin(a) * 20)
    c.lineTo(cx + Math.cos(a + 0.25) * 27, cy + Math.sin(a + 0.25) * 29)
    c.lineTo(cx + Math.cos(a - 0.1) * 31, cy + Math.sin(a - 0.1) * 34)
    c.lineTo(cx + Math.cos(a + 0.2) * 40, cy + Math.sin(a + 0.2) * 43); c.stroke()
  }
  c.restore()
}

/** Körper: dunkler Stahl mit goldenem Rand, Blitz-Zeichen und einem kleinen Hammer an der Seite. */
export function drawModBody(c: CanvasRenderingContext2D, x: number, y: number, face: 1 | -1, t: number, alpha = 1, scale = 1, rot = 0): void {
  const cx = x + PW / 2, cy = y + PH / 2
  c.save()
  c.globalAlpha *= alpha
  c.translate(cx, cy); c.rotate(rot); c.scale(scale, scale); c.translate(-cx, -cy)
  const g = c.createLinearGradient(x, y, x + PW, y + PH)
  g.addColorStop(0, '#334155'); g.addColorStop(0.5, '#0f172a'); g.addColorStop(1, '#1e3a8a')
  c.fillStyle = g
  c.shadowColor = '#60a5fa'; c.shadowBlur = 14
  c.beginPath(); c.roundRect(x, y, PW, PH, 7); c.fill()
  c.shadowBlur = 0
  c.strokeStyle = '#fbbf24'; c.lineWidth = 2
  c.beginPath(); c.roundRect(x + 1, y + 1, PW - 2, PH - 2, 7); c.stroke()
  // Blitz-Zeichen
  c.fillStyle = `rgba(253,224,71,${0.8 + 0.2 * Math.sin(t * 8)})`
  const bx = cx + (face > 0 ? -4 : 4), by = y + 17
  c.beginPath(); c.moveTo(bx + 3, by - 9); c.lineTo(bx - 5, by + 2); c.lineTo(bx - 0.5, by + 2); c.lineTo(bx - 3, by + 11); c.lineTo(bx + 6, by - 1); c.lineTo(bx + 1, by - 1); c.closePath(); c.fill()
  // Augen
  c.fillStyle = '#fff'
  c.shadowColor = '#fde047'; c.shadowBlur = 6
  c.fillRect(x + (face > 0 ? 11 : 3), y + 5, 7, 6)
  c.shadowBlur = 0
  c.fillStyle = '#0f172a'
  c.fillRect(x + (face > 0 ? 15 : 4), y + 6, 3, 4)
  // kleiner Hammer an der Seite
  hammer(c, cx + (face > 0 ? -PW / 2 - 7 : PW / 2 + 7), cy + 3 + Math.sin(t * 4) * 1.5, face > 0 ? -0.5 : 0.5, 0.42, t)
  c.restore()
}

/** Namensschild: goldene Schrift mit Blitzen. */
export function drawModName(c: CanvasRenderingContext2D, cx: number, y: number, name: string, t: number): void {
  c.save()
  c.textAlign = 'center'
  c.font = '700 12px system-ui, sans-serif'
  c.shadowColor = '#3b82f6'; c.shadowBlur = 9
  const text = `⚡ ${name} ⚡`
  const w = c.measureText(text).width
  const g = c.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0)
  const o = (t * 0.5) % 1
  g.addColorStop(0, '#fde68a'); g.addColorStop(Math.max(0.01, Math.min(0.99, o)), '#ffffff'); g.addColorStop(1, '#fbbf24')
  c.fillStyle = g
  c.fillText(text, cx, y)
  c.restore()
}

/** Die Animation: in = Hammer fällt, Blitz schlägt ein, die Figur erscheint (sie selbst wird erst danach gezeichnet); out = Hammer trifft die Figur, Blitz, sie verschwindet. */
export function drawHammerAnim(c: CanvasRenderingContext2D, h: HoleAnim, t: number): void {
  const cx = h.x + PW / 2
  const feet = h.y + PH
  const flash = (k: number, strength: number) => {
    if (k <= 0 || k >= 1) return
    c.save(); c.globalAlpha = strength * (1 - k)
    c.fillStyle = '#e0f2fe'; c.fillRect(cx - 700, -200, 1400, 800)
    c.restore()
  }
  const seed = Math.floor(h.t * 30) * 13.7
  if (h.kind === 'in') {
    const fall = clamp01(h.t / HAMMER_APPEAR)
    if (h.t < HAMMER_APPEAR) {
      // Ziel am Boden, Hammer stürzt von oben
      c.save(); c.globalAlpha = 0.5 + 0.5 * fall
      c.strokeStyle = '#fde047'; c.lineWidth = 2
      c.beginPath(); c.ellipse(cx, feet, 10 + 26 * (1 - fall), 3 + 7 * (1 - fall), 0, 0, Math.PI * 2); c.stroke()
      c.restore()
      const hy = -90 + (feet - 22 + 90) * fall * fall
      hammer(c, cx, hy, (1 - fall) * 1.1, 1.1, t)
    } else {
      const k = (h.t - HAMMER_APPEAR) / (HAMMER_IN - HAMMER_APPEAR)
      flash(k / 0.35, 0.75)
      // Blitz (flackert über einige Bilder)
      if (k < 0.5) bolt(c, cx + (rnd(seed) - 0.5) * 30, -20, cx, feet, seed, 6 * (1 - k), 46)
      // Druckwelle
      c.save(); c.globalAlpha = 0.8 * (1 - k)
      c.strokeStyle = '#bae6fd'; c.lineWidth = 3 * (1 - k) + 1
      c.beginPath(); c.ellipse(cx, feet, 14 + 90 * ease(k), 4 + 20 * ease(k), 0, 0, Math.PI * 2); c.stroke()
      c.restore()
      // Funken
      c.save(); c.fillStyle = '#fde047'
      for (let i = 0; i < 14; i++) {
        const a = rnd(i * 5.3) * Math.PI
        const r = 12 + 60 * ease(k) * (0.4 + rnd(i * 2.9))
        c.globalAlpha = Math.max(0, 1 - k * 1.2)
        c.beginPath(); c.arc(cx + Math.cos(a) * r * (i % 2 ? 1 : -1), feet - Math.sin(a) * r * 0.9, 2, 0, Math.PI * 2); c.fill()
      }
      c.restore()
      // Hammer bleibt kurz stecken und verblasst
      hammer(c, cx + 26, feet - 16, 0.35, 0.9, t, Math.max(0, 1 - k * 1.4))
    }
    return
  }
  // out
  const k = h.t / HAMMER_OUT
  const hit = 0.38
  if (k < hit) {
    drawModBack(c, h.x, h.y, t)
    drawModBody(c, h.x, h.y, h.face, t)
    const f = clamp01(k / hit)
    const hy = -90 + (h.y - 18 + 90) * f * f
    hammer(c, cx, hy, 0.3 * (1 - f), 1.1, t)
  } else {
    const q = (k - hit) / (1 - hit)
    flash(q / 0.35, 0.8)
    if (q < 0.5) bolt(c, cx + (rnd(seed) - 0.5) * 30, -20, cx, feet, seed, 6 * (1 - q), 46)
    c.save(); c.globalAlpha = 0.85 * (1 - q)
    c.strokeStyle = '#bae6fd'; c.lineWidth = 3 * (1 - q) + 1
    c.beginPath(); c.ellipse(cx, feet, 12 + 80 * ease(q), 4 + 18 * ease(q), 0, 0, Math.PI * 2); c.stroke()
    c.fillStyle = '#fde047'
    for (let i = 0; i < 16; i++) {
      const a = rnd(i * 4.1) * Math.PI * 2
      const r = 8 + 55 * ease(q) * (0.3 + rnd(i * 2.3))
      c.globalAlpha = Math.max(0, 1 - q * 1.2)
      c.beginPath(); c.arc(cx + Math.cos(a) * r, h.y + PH / 2 + Math.sin(a) * r, 2, 0, Math.PI * 2); c.fill()
    }
    c.restore()
    hammer(c, cx, h.y - 18 - 40 * ease(q), 0.3, 1.1, t, Math.max(0, 1 - q * 1.6))
  }
}
