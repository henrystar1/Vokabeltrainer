import { PH, PW } from './engine'

/** Admin-Look im Parkour: eine Figur wie ein kleines Schwarzes Loch (Ereignishorizont, Akkretionsscheibe, Sternenschweif). */

export interface HoleAnim {
  x: number
  y: number
  /** Sekunden seit dem Start */
  t: number
  /** in = Loch öffnet sich, Figur fällt heraus; out = Loch öffnet sich unter der Figur, sie fällt hinein und verschwindet mit ihm */
  kind: 'in' | 'out'
  lv: number
  face: 1 | -1
}
export const HOLE_IN = 1.5
export const HOLE_OUT = 1.5

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const ease = (v: number) => v * v * (3 - 2 * v)

/** Strudel: dunkle Scheibe, leuchtender Rand, drehende Arme. r = Radius, k = wie weit geöffnet (0–1). */
export function drawHoleDisc(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number, squash = 0.42): void {
  if (r < 1) return
  c.save()
  c.translate(cx, cy)
  c.scale(1, squash)
  const halo = c.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.5)
  halo.addColorStop(0, 'rgba(124,58,237,0.55)'); halo.addColorStop(0.6, 'rgba(168,85,247,0.25)'); halo.addColorStop(1, 'rgba(124,58,237,0)')
  c.fillStyle = halo
  c.beginPath(); c.arc(0, 0, r * 1.5, 0, Math.PI * 2); c.fill()
  // Spiralarme
  for (let arm = 0; arm < 4; arm++) {
    c.strokeStyle = arm % 2 ? 'rgba(232,121,249,0.75)' : 'rgba(34,211,238,0.7)'
    c.lineWidth = Math.max(1.5, r * 0.07)
    c.beginPath()
    for (let i = 0; i <= 26; i++) {
      const k = i / 26
      const a = t * 3.2 + arm * (Math.PI / 2) + k * 4.2
      const rr = r * (1.05 - k * 0.95)
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py)
    }
    c.stroke()
  }
  const core = c.createRadialGradient(0, 0, 0, 0, 0, r * 0.62)
  core.addColorStop(0, '#000'); core.addColorStop(0.85, '#000'); core.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = core
  c.beginPath(); c.arc(0, 0, r * 0.62, 0, Math.PI * 2); c.fill()
  c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = Math.max(1, r * 0.04)
  c.beginPath(); c.arc(0, 0, r * 0.64, 0, Math.PI * 2); c.stroke()
  c.restore()
}

/** Leuchten und Sterne hinter der Figur (vor dem Körper zeichnen). */
export function drawAdminBack(c: CanvasRenderingContext2D, x: number, y: number, t: number, alpha = 1): void {
  const cx = x + PW / 2, cy = y + PH / 2
  c.save()
  c.globalAlpha = alpha
  const pulse = 1 + 0.08 * Math.sin(t * 3)
  const g = c.createRadialGradient(cx, cy, 6, cx, cy, 46 * pulse)
  g.addColorStop(0, 'rgba(0,0,0,0.0)'); g.addColorStop(0.35, 'rgba(76,29,149,0.5)'); g.addColorStop(0.7, 'rgba(168,85,247,0.22)'); g.addColorStop(1, 'rgba(168,85,247,0)')
  c.fillStyle = g
  c.beginPath(); c.arc(cx, cy, 46 * pulse, 0, Math.PI * 2); c.fill()
  // Linseneffekt: dünne, wandernde Lichtbögen
  c.strokeStyle = 'rgba(196,181,253,0.55)'; c.lineWidth = 1.2
  for (let k = 0; k < 3; k++) {
    const a = t * (1.1 + k * 0.4) + k * 2.1
    c.beginPath(); c.arc(cx, cy, 25 + k * 5, a, a + 1.1); c.stroke()
  }
  // hintere Hälfte der Akkretionsscheibe
  disc(c, cx, cy, t, true)
  c.restore()
}

function disc(c: CanvasRenderingContext2D, cx: number, cy: number, t: number, back: boolean): void {
  c.save()
  c.translate(cx, cy)
  c.rotate(-0.28)
  c.scale(1, 0.3)
  c.lineCap = 'round'
  const stops: Array<[number, string]> = [[0, '#fde68a'], [0.35, '#fb923c'], [0.65, '#e879f9'], [1, '#22d3ee']]
  for (let ring = 0; ring < 4; ring++) {
    const rr = 21 + ring * 3.2
    const gr = c.createLinearGradient(-rr, 0, rr, 0)
    for (const [o, col] of stops) gr.addColorStop(o, col)
    c.strokeStyle = gr
    c.globalAlpha = (back ? 0.55 : 0.9) - ring * 0.12
    c.lineWidth = 3.4 - ring * 0.6
    c.beginPath()
    if (back) c.arc(0, 0, rr, Math.PI, Math.PI * 2); else c.arc(0, 0, rr, 0, Math.PI)
    c.stroke()
  }
  // wandernde Lichtpunkte auf der Scheibe
  c.fillStyle = '#fff'
  for (let k = 0; k < 4; k++) {
    const a = t * 3 + k * (Math.PI / 2)
    const onFront = Math.sin(a) > 0
    if (onFront === back) continue
    c.globalAlpha = 0.95
    c.beginPath(); c.arc(Math.cos(a) * 24, Math.sin(a) * 24, 1.8, 0, Math.PI * 2); c.fill()
  }
  c.restore()
}

/** Körper: dunkel wie ein Ereignishorizont mit rotierender Galaxie darin, vordere Scheibenhälfte, Funkeln. */
export function drawAdminBody(c: CanvasRenderingContext2D, x: number, y: number, face: 1 | -1, t: number, alpha = 1, scale = 1, rot = 0): void {
  const cx = x + PW / 2, cy = y + PH / 2
  c.save()
  c.globalAlpha *= alpha
  c.translate(cx, cy)
  c.rotate(rot)
  c.scale(scale, scale)
  c.translate(-cx, -cy)
  const g = c.createRadialGradient(cx, cy, 2, cx, cy, 20)
  g.addColorStop(0, '#000'); g.addColorStop(0.55, '#0b0420'); g.addColorStop(1, '#4c1d95')
  c.fillStyle = g
  c.shadowColor = '#a855f7'; c.shadowBlur = 14
  c.beginPath(); c.roundRect(x, y, PW, PH, 7); c.fill()
  c.shadowBlur = 0
  // rotierende Galaxie im Körper
  c.save()
  c.beginPath(); c.roundRect(x, y, PW, PH, 7); c.clip()
  c.translate(cx, cy)
  c.rotate(t * 1.6)
  for (let arm = 0; arm < 3; arm++) {
    c.strokeStyle = arm === 0 ? 'rgba(232,121,249,0.8)' : arm === 1 ? 'rgba(34,211,238,0.7)' : 'rgba(253,230,138,0.7)'
    c.lineWidth = 1.5
    c.beginPath()
    for (let i = 0; i <= 14; i++) {
      const k = i / 14
      const a = arm * ((Math.PI * 2) / 3) + k * 3.4
      const rr = 2 + k * 17
      if (i === 0) c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
    }
    c.stroke()
  }
  c.restore()
  c.strokeStyle = 'rgba(216,180,254,0.9)'; c.lineWidth = 1.6
  c.beginPath(); c.roundRect(x + 0.5, y + 0.5, PW - 1, PH - 1, 7); c.stroke()
  // Augen: leuchtendes Weiß mit Cyan
  c.fillStyle = '#fff'
  c.shadowColor = '#22d3ee'; c.shadowBlur = 6
  c.fillRect(x + (face > 0 ? 11 : 3), y + 7, 7, 7)
  c.shadowBlur = 0
  c.fillStyle = '#0f172a'
  c.fillRect(x + (face > 0 ? 15 : 4), y + 9, 3, 4)
  disc(c, cx, cy, t, false)
  // Funkeln: kleine Sterne umkreisen die Figur
  for (let k = 0; k < 5; k++) {
    const a = t * 2.1 + k * 1.2566
    const rr = 27 + 3 * Math.sin(t * 4 + k)
    c.globalAlpha = 0.5 + 0.5 * Math.sin(t * 6 + k * 2)
    c.fillStyle = k % 2 ? '#e9d5ff' : '#a5f3fc'
    c.beginPath(); c.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7, 1.6, 0, Math.PI * 2); c.fill()
  }
  c.restore()
}

/** Namensschild des Admins: leuchtend, mit Stern. */
export function drawAdminName(c: CanvasRenderingContext2D, cx: number, y: number, name: string, t: number): void {
  c.save()
  c.textAlign = 'center'
  c.font = '700 12px system-ui, sans-serif'
  c.shadowColor = '#a855f7'; c.shadowBlur = 10
  const w = c.measureText(`✦ ${name} ✦`).width
  const g = c.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0)
  const o = (t * 0.4) % 1
  g.addColorStop(0, '#e9d5ff'); g.addColorStop(Math.max(0.01, Math.min(0.99, o)), '#67e8f9'); g.addColorStop(1, '#f5d0fe')
  c.fillStyle = g
  c.fillText(`✦ ${name} ✦`, cx, y)
  c.restore()
}

/** Die Animation selbst: Loch und (beim Verschwinden) die hineinfallende Figur. Zeichnet den Admin NICHT, wenn er schon echt im Bild ist (in). */
export function drawHoleAnim(c: CanvasRenderingContext2D, h: HoleAnim, t: number): void {
  const cx = h.x + PW / 2
  if (h.kind === 'in') {
    const k = h.t / HOLE_IN
    const open = k < 0.25 ? ease(k / 0.25) : k < 0.7 ? 1 : 1 - ease((k - 0.7) / 0.3)
    drawHoleDisc(c, cx, h.y + PH / 2, 38 * open, t, 0.8)
    // Sog: Lichtstreifen strömen aus dem Loch
    c.save()
    c.globalAlpha = 0.6 * open
    c.strokeStyle = '#c4b5fd'; c.lineWidth = 1.4
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + t * 2
      const r0 = 20 + 26 * ((h.t * 1.6 + i * 0.13) % 1)
      c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, h.y + PH / 2 + Math.sin(a) * r0 * 0.8); c.lineTo(cx + Math.cos(a) * (r0 + 6), h.y + PH / 2 + Math.sin(a) * (r0 + 6) * 0.8); c.stroke()
    }
    c.restore()
    return
  }
  const k = h.t / HOLE_OUT
  const hy = h.y + PH + 6
  const open = k < 0.25 ? ease(k / 0.25) : k < 0.75 ? 1 : 1 - ease((k - 0.75) / 0.25)
  drawHoleDisc(c, cx, hy, 40 * open, t, 0.4)
  // die Figur sinkt, dreht sich und wird kleiner
  const s = clamp01((k - 0.22) / 0.5)
  if (s < 1) {
    const e = ease(s)
    const fx = h.x, fy = h.y + (hy - PH / 2 - h.y) * e
    drawAdminBody(c, fx, fy, h.face, t, 1 - e * 0.4, 1 - e * 0.95, e * 7)
  }
}
