import { PH, PW } from './engine'
import type { HoleAnim } from './lookTypes'

/**
 * Gitarren-Auftritt: ein Scheinwerfer geht an, eine E-Gitarre stürzt herab und bleibt im Boden stecken (der Klang schlägt Wellen),
 * dann steht die Figur mit der Gitarre da. Verlassen: Gitarren-Windmühle, dann rockt die Figur im Scheinwerfer nach oben davon.
 */
export const GUITAR_IN = 2.3
export const GUITAR_APPEAR = 1.25
export const GUITAR_OUT = 2.2

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const ease = (v: number) => v * v * (3 - 2 * v)
const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
const NOTES = ['♪', '♫', '♩', '♬']

function note(c: CanvasRenderingContext2D, x: number, y: number, size: number, i: number, alpha: number, color = '#fde68a'): void {
  c.save()
  c.globalAlpha = Math.max(0, Math.min(1, alpha))
  c.font = `700 ${size}px system-ui, "Segoe UI Symbol", sans-serif`
  c.textAlign = 'center'
  c.fillStyle = color
  c.shadowColor = '#f97316'; c.shadowBlur = 6
  c.fillText(NOTES[i % NOTES.length], x, y)
  c.restore()
}

/** E-Gitarre, Hals nach oben, (cx, cy) = Mitte (Länge ca. 76, Körper ca. 28 breit). */
export function drawGuitar(c: CanvasRenderingContext2D, cx: number, cy: number, scale = 1, rot = 0, alpha = 1): void {
  c.save()
  c.globalAlpha *= alpha
  c.translate(cx, cy); c.rotate(rot); c.scale(scale, scale)
  // Hals und Kopfplatte
  c.fillStyle = '#92400e'; c.fillRect(-2.6, -36, 5.2, 40)
  c.strokeStyle = '#fcd34d'; c.lineWidth = 0.7
  for (let f = 0; f < 6; f++) { c.beginPath(); c.moveTo(-2.6, -30 + f * 6); c.lineTo(2.6, -30 + f * 6); c.stroke() }
  c.fillStyle = '#451a03'
  c.beginPath(); c.roundRect(-4.2, -47, 8.4, 12, 2); c.fill()
  c.fillStyle = '#fde68a'
  for (let k = 0; k < 3; k++) { c.fillRect(-5.6, -45 + k * 3.6, 1.8, 1.8); c.fillRect(3.8, -45 + k * 3.6, 1.8, 1.8) }
  // Korpus: zwei Rundungen mit Taille
  const g = c.createRadialGradient(0, 12, 2, 0, 12, 20)
  g.addColorStop(0, '#fde047'); g.addColorStop(0.45, '#f97316'); g.addColorStop(1, '#7c2d12')
  c.fillStyle = g
  c.shadowColor = '#fb923c'; c.shadowBlur = 8
  c.beginPath()
  c.ellipse(0, 20, 14, 12, 0, 0, Math.PI * 2)
  c.ellipse(0, 4, 10.5, 9, 0, 0, Math.PI * 2)
  c.fill()
  c.shadowBlur = 0
  c.strokeStyle = '#431407'; c.lineWidth = 1.2
  c.beginPath(); c.ellipse(0, 20, 14, 12, 0, 0, Math.PI * 2); c.stroke()
  c.beginPath(); c.ellipse(0, 4, 10.5, 9, 0, 0, Math.PI * 2); c.stroke()
  // Schlagbrett, Tonabnehmer, Steg
  c.fillStyle = 'rgba(255,255,255,0.85)'
  c.beginPath(); c.roundRect(-8, 6, 9, 17, 4); c.fill()
  c.fillStyle = '#111827'; c.fillRect(-7, 10, 11, 2.6); c.fillRect(-7, 15, 11, 2.6)
  c.fillStyle = '#d1d5db'; c.fillRect(-6, 25, 12, 2.4)
  // Saiten
  c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 0.5
  for (let s = -1; s <= 1; s++) { c.beginPath(); c.moveTo(s * 1.4, -36); c.lineTo(s * 4, 26); c.stroke() }
  c.restore()
}

/** Leuchten und schwebende Noten hinter der Figur. */
export function drawGuitarBack(c: CanvasRenderingContext2D, x: number, y: number, t: number, alpha = 1): void {
  const cx = x + PW / 2, cy = y + PH / 2
  c.save()
  c.globalAlpha = alpha
  const g = c.createRadialGradient(cx, cy, 4, cx, cy, 40)
  g.addColorStop(0, 'rgba(251,146,60,0.4)'); g.addColorStop(1, 'rgba(251,146,60,0)')
  c.fillStyle = g; c.beginPath(); c.arc(cx, cy, 40, 0, Math.PI * 2); c.fill()
  for (let i = 0; i < 4; i++) {
    const a = t * 1.5 + i * (Math.PI / 2)
    note(c, cx + Math.cos(a) * 27, cy + Math.sin(a) * 19 - 4, 11, i, 0.55 + 0.4 * Math.sin(t * 3 + i), i % 2 ? '#fde68a' : '#fdba74')
  }
  c.restore()
}

/** Körper: Rockstar in Schwarz-Rot mit Sonnenbrille und der Gitarre quer vor dem Bauch. */
export function drawGuitarBody(c: CanvasRenderingContext2D, x: number, y: number, face: 1 | -1, t: number, alpha = 1, scale = 1, rot = 0): void {
  const cx = x + PW / 2, cy = y + PH / 2
  c.save()
  c.globalAlpha *= alpha
  c.translate(cx, cy); c.rotate(rot); c.scale(scale, scale); c.translate(-cx, -cy)
  const g = c.createLinearGradient(x, y, x + PW, y + PH)
  g.addColorStop(0, '#b91c1c'); g.addColorStop(0.5, '#1f1117'); g.addColorStop(1, '#7c2d12')
  c.fillStyle = g
  c.shadowColor = '#fb923c'; c.shadowBlur = 12
  c.beginPath(); c.roundRect(x, y, PW, PH, 7); c.fill()
  c.shadowBlur = 0
  c.strokeStyle = '#fbbf24'; c.lineWidth = 1.6
  c.beginPath(); c.roundRect(x + 0.8, y + 0.8, PW - 1.6, PH - 1.6, 7); c.stroke()
  // Sonnenbrille
  c.fillStyle = '#020617'
  c.fillRect(x + (face > 0 ? 6 : 1), y + 5, 15, 6)
  c.fillStyle = 'rgba(255,255,255,0.7)'
  c.fillRect(x + (face > 0 ? 8 : 3), y + 6, 4, 1.6)
  // Gitarre quer vor dem Bauch, wippt im Takt
  c.save()
  c.translate(cx, cy + 6)
  c.rotate((face > 0 ? -1 : 1) * (0.95 + 0.05 * Math.sin(t * 7)))
  c.scale(face, 1)
  drawGuitar(c, 0, 0, 0.5, 0, 1)
  c.restore()
  c.restore()
}

export function drawGuitarName(c: CanvasRenderingContext2D, cx: number, y: number, name: string, t: number): void {
  c.save()
  c.textAlign = 'center'
  c.font = '700 12px system-ui, "Segoe UI Symbol", sans-serif'
  c.shadowColor = '#f97316'; c.shadowBlur = 9
  const text = `♫ ${name} ♫`
  const w = c.measureText(text).width
  const g = c.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0)
  const o = (t * 0.5) % 1
  g.addColorStop(0, '#fdba74'); g.addColorStop(Math.max(0.01, Math.min(0.99, o)), '#ffffff'); g.addColorStop(1, '#fde047')
  c.fillStyle = g
  c.fillText(text, cx, y)
  c.restore()
}

/** Scheinwerferkegel von oben (top) bis zum Boden (feet). */
function spot(c: CanvasRenderingContext2D, cx: number, top: number, feet: number, alpha: number): void {
  if (alpha <= 0.01) return
  c.save()
  const g = c.createLinearGradient(0, top, 0, feet)
  g.addColorStop(0, `rgba(254,243,199,${0.5 * alpha})`); g.addColorStop(1, `rgba(251,191,36,${0.12 * alpha})`)
  c.fillStyle = g
  c.beginPath(); c.moveTo(cx - 7, top); c.lineTo(cx + 7, top); c.lineTo(cx + 42, feet + 2); c.lineTo(cx - 42, feet + 2); c.closePath(); c.fill()
  c.fillStyle = `rgba(253,224,71,${0.3 * alpha})`
  c.beginPath(); c.ellipse(cx, feet, 42, 8, 0, 0, Math.PI * 2); c.fill()
  c.restore()
}

/** Klangwellen: Bögen, die vom Punkt (cx, cy) nach außen laufen. */
function waves(c: CanvasRenderingContext2D, cx: number, cy: number, s: number, count = 3): void {
  c.save()
  for (let i = 0; i < count; i++) {
    const k = clamp01(s * 1.1 - i * 0.18)
    if (k <= 0 || k >= 1) continue
    c.globalAlpha = 0.8 * (1 - k)
    c.strokeStyle = i % 2 ? '#fde047' : '#fb923c'; c.lineWidth = 3.2 * (1 - k) + 0.8
    c.beginPath(); c.ellipse(cx, cy, 14 + 80 * ease(k), 6 + 30 * ease(k), 0, 0, Math.PI * 2); c.stroke()
  }
  c.restore()
}

function sparks(c: CanvasRenderingContext2D, cx: number, cy: number, q: number, n: number, speed: number): void {
  c.save()
  for (let i = 0; i < n; i++) {
    const a = rnd(i * 4.1) * Math.PI * 2
    const sp = speed * (0.4 + rnd(i * 2.9))
    c.globalAlpha = Math.max(0, 1 - q * 1.15)
    c.fillStyle = i % 3 === 0 ? '#fde047' : i % 3 === 1 ? '#fb923c' : '#fff'
    c.fillRect(cx + Math.cos(a) * sp * q, cy + Math.sin(a) * sp * q * 0.8 + 120 * q * q, 2.4, 2.4)
  }
  c.restore()
}

function flash(c: CanvasRenderingContext2D, cx: number, top: number, k: number, strength: number): void {
  if (k <= 0 || k >= 1) return
  c.save(); c.globalAlpha = strength * (1 - k)
  c.fillStyle = '#fffbeb'; c.fillRect(cx - 700, top - 236, 1400, 800)
  c.restore()
}

export function drawGuitarAnim(c: CanvasRenderingContext2D, h: HoleAnim, t: number): void {
  const cx = h.x + PW / 2
  const feet = h.y + PH
  const top = Math.max(h.top ?? 36, h.y - 220)
  if (h.kind === 'in') {
    const tt = h.t
    // Scheinwerfer
    const lamp = tt < 0.3 ? ease(tt / 0.3) : tt < GUITAR_APPEAR + 0.4 ? 1 : Math.max(0, 1 - (tt - GUITAR_APPEAR - 0.4) / (GUITAR_IN - GUITAR_APPEAR - 0.4))
    spot(c, cx, top, feet, lamp)
    // Die Gitarre fällt, dreht sich und bleibt im Boden stecken
    const LAND = 0.95
    if (tt >= 0.2 && tt < GUITAR_APPEAR) {
      const k = clamp01((tt - 0.2) / (LAND - 0.2))
      const gy = top + (feet - 38 - top) * k * k
      const wob = tt > LAND ? Math.sin((tt - LAND) * 46) * 0.14 * Math.max(0, 1 - (tt - LAND) / 0.3) : 0
      const rot = tt < LAND ? (1 - k) * Math.PI * 5 + 0.08 : 0.08 + wob
      drawGuitar(c, cx, tt < LAND ? gy : feet - 38, 1, rot)
      // Funkenspur beim Fallen
      if (tt < LAND) sparks(c, cx, gy + 20, (rnd(Math.floor(tt * 30)) * 0.15), 5, 30)
    }
    // Einschlag
    if (tt >= LAND) {
      const s = clamp01((tt - LAND) / 1.0)
      waves(c, cx, feet - 4, s, 3)
      sparks(c, cx, feet - 6, clamp01((tt - LAND) / 0.7), 22, 130)
      for (let i = 0; i < 6; i++) {
        const k = clamp01((tt - LAND - i * 0.05) / 1.0)
        note(c, cx + (rnd(i * 3.3) - 0.5) * 90 + Math.sin(k * 6 + i) * 8, feet - 20 - 90 * ease(k), 13 + (i % 3) * 3, i, 1 - k, i % 2 ? '#fde68a' : '#fdba74')
      }
    }
    flash(c, cx, top, (tt - GUITAR_APPEAR) / 0.25, 0.7)
    return
  }
  // out: Windmühle, dann nach oben davon
  const tt = h.t
  const SOLO = 0.9
  const lamp = tt < 0.25 ? ease(tt / 0.25) : tt < 1.7 ? 1 : Math.max(0, 1 - (tt - 1.7) / 0.3)
  spot(c, cx, top, feet, lamp)
  if (tt < SOLO) {
    // Windmühle: die Gitarre kreist um die Figur
    waves(c, cx, feet - 4, (tt % 0.45) / 0.45, 2)
    drawGuitarBody(c, h.x + (rnd(Math.floor(tt * 40)) - 0.5) * 1.4, h.y, h.face, t)
    const a = tt * 17
    c.save(); c.translate(cx, h.y + PH / 2)
    drawGuitar(c, Math.cos(a) * 30, Math.sin(a) * 22, 0.75, a + Math.PI / 2)
    c.restore()
    for (let i = 0; i < 4; i++) note(c, cx + Math.cos(tt * 8 + i * 1.6) * 34, h.y - 4 - ((tt * 70 + i * 20) % 60), 12, i, 0.9, '#fde68a')
  } else if (tt < 1.7) {
    // Rockt im Scheinwerfer nach oben, dreht sich und wird kleiner
    const k = clamp01((tt - SOLO) / 0.8)
    const e = k * k * (1.5 - 0.5 * k)
    const py = h.y + (top + 6 - h.y) * Math.min(1, e)
    c.save()
    c.translate(cx, py + PH / 2); c.rotate(k * 12); c.scale(1 - 0.6 * k, 1 - 0.6 * k)
    drawGuitarBody(c, -PW / 2, -PH / 2, h.face, t, 1 - 0.5 * k)
    c.restore()
    for (let i = 0; i < 7; i++) {
      const kk = clamp01(k - i * 0.07)
      if (kk <= 0) continue
      note(c, cx + Math.sin(i * 2.1 + k * 7) * 18, h.y + (top - h.y) * (kk * kk * (1.5 - 0.5 * kk)) + PH, 11, i, 0.8 * (1 - kk), '#fdba74')
    }
  } else {
    // Abgang: Blitz und Funken oben
    const q = clamp01((tt - 1.7) / (GUITAR_OUT - 1.7))
    flash(c, cx, top, q / 0.45, 0.85)
    waves(c, cx, top + 10, q, 3)
    sparks(c, cx, top + 10, q, 30, 150)
    for (let i = 0; i < 8; i++) note(c, cx + (rnd(i * 2.3) - 0.5) * 120 * q, top + 10 + (rnd(i * 4.4) - 0.3) * 60 * q + 30 * q * q, 12, i, 1 - q, i % 2 ? '#fde68a' : '#fdba74')
  }
}
