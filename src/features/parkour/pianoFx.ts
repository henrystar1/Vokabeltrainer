import { PH, PW } from './engine'
import type { HoleAnim } from './lookTypes'

/** Klavier-Auftritt: ein Klavier fällt von oben und zerbricht am Boden, die Figur steht in den Trümmern. Verlassen: die Figur verwandelt sich in ein Klavier und fliegt davon. */
export const PIANO_IN = 2.0
export const PIANO_APPEAR = 0.85
export const PIANO_OUT = 2.5

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const ease = (v: number) => v * v * (3 - 2 * v)
const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
const NOTES = ['♪', '♫', '♩', '♬']

function note(c: CanvasRenderingContext2D, x: number, y: number, size: number, i: number, alpha: number, color = '#f5d0fe'): void {
  c.save()
  c.globalAlpha = Math.max(0, Math.min(1, alpha))
  c.font = `700 ${size}px system-ui, "Segoe UI Symbol", sans-serif`
  c.textAlign = 'center'
  c.fillStyle = color
  c.shadowColor = '#c026d3'; c.shadowBlur = 6
  c.fillText(NOTES[i % NOTES.length], x, y)
  c.restore()
}

/** Ein Klavier von der Seite, (cx, cy) = Mitte, Breite ca. 64, Höhe ca. 48. */
export function drawPiano(c: CanvasRenderingContext2D, cx: number, cy: number, scale = 1, rot = 0, alpha = 1): void {
  c.save()
  c.globalAlpha *= alpha
  c.translate(cx, cy); c.rotate(rot); c.scale(scale, scale)
  // Beine und Pedal
  c.fillStyle = '#1e1b2e'
  c.fillRect(-26, 12, 5, 12); c.fillRect(21, 12, 5, 12)
  c.fillStyle = '#fbbf24'; c.fillRect(-4, 18, 8, 3)
  // Korpus
  const g = c.createLinearGradient(-32, -24, 32, 12)
  g.addColorStop(0, '#312e81'); g.addColorStop(0.45, '#0b0a14'); g.addColorStop(1, '#1e1b4b')
  c.fillStyle = g
  c.shadowColor = '#a855f7'; c.shadowBlur = 8
  c.beginPath(); c.roundRect(-32, -24, 64, 36, 4); c.fill()
  c.shadowBlur = 0
  // Glanz
  c.fillStyle = 'rgba(255,255,255,0.14)'
  c.beginPath(); c.moveTo(-30, -22); c.lineTo(-8, -22); c.lineTo(-22, 8); c.lineTo(-30, 8); c.closePath(); c.fill()
  // Notenständer
  c.fillStyle = '#e5e7eb'; c.fillRect(-14, -17, 28, 11)
  c.strokeStyle = '#6b7280'; c.lineWidth = 0.7
  for (let l = 0; l < 4; l++) { c.beginPath(); c.moveTo(-12, -15 + l * 2.4); c.lineTo(12, -15 + l * 2.4); c.stroke() }
  // Tastatur
  c.fillStyle = '#fafafa'; c.fillRect(-33, 4, 66, 9)
  c.strokeStyle = '#9ca3af'; c.lineWidth = 0.6
  for (let k = -30; k < 33; k += 5.5) { c.beginPath(); c.moveTo(k, 4); c.lineTo(k, 13); c.stroke() }
  c.fillStyle = '#111827'
  for (let k = -30; k < 28; k += 5.5) { if (Math.round((k + 30) / 5.5) % 7 === 2 || Math.round((k + 30) / 5.5) % 7 === 6) continue; c.fillRect(k + 3.4, 4, 3.4, 5.5) }
  c.strokeStyle = '#facc15'; c.lineWidth = 1.2
  c.beginPath(); c.roundRect(-32, -24, 64, 36, 4); c.stroke()
  c.restore()
}

/** Leuchten hinter der Figur: schwebende Noten. */
export function drawPianoBack(c: CanvasRenderingContext2D, x: number, y: number, t: number, alpha = 1): void {
  const cx = x + PW / 2, cy = y + PH / 2
  c.save()
  c.globalAlpha = alpha
  const g = c.createRadialGradient(cx, cy, 4, cx, cy, 36)
  g.addColorStop(0, 'rgba(232,121,249,0.35)'); g.addColorStop(1, 'rgba(232,121,249,0)')
  c.fillStyle = g; c.beginPath(); c.arc(cx, cy, 36, 0, Math.PI * 2); c.fill()
  for (let i = 0; i < 4; i++) {
    const a = t * 1.3 + i * (Math.PI / 2)
    note(c, cx + Math.cos(a) * 26, cy + Math.sin(a) * 18 - 4, 11, i, 0.55 + 0.4 * Math.sin(t * 3 + i), i % 2 ? '#a5f3fc' : '#f5d0fe')
  }
  c.restore()
}

/** Körper: schwarz glänzend mit weißer Tastenreihe unten und Notenzeichen. */
export function drawPianoBody(c: CanvasRenderingContext2D, x: number, y: number, face: 1 | -1, t: number, alpha = 1, scale = 1, rot = 0): void {
  const cx = x + PW / 2, cy = y + PH / 2
  c.save()
  c.globalAlpha *= alpha
  c.translate(cx, cy); c.rotate(rot); c.scale(scale, scale); c.translate(-cx, -cy)
  const g = c.createLinearGradient(x, y, x + PW, y + PH)
  g.addColorStop(0, '#4338ca'); g.addColorStop(0.4, '#0b0a14'); g.addColorStop(1, '#312e81')
  c.fillStyle = g
  c.shadowColor = '#e879f9'; c.shadowBlur = 12
  c.beginPath(); c.roundRect(x, y, PW, PH, 7); c.fill()
  c.shadowBlur = 0
  // Tasten
  c.save(); c.beginPath(); c.roundRect(x, y, PW, PH, 7); c.clip()
  c.fillStyle = '#fafafa'; c.fillRect(x, y + PH - 8, PW, 8)
  c.fillStyle = '#111827'
  for (let k = 0; k < 4; k++) c.fillRect(x + 3 + k * 5.2, y + PH - 8, 3, 5)
  c.strokeStyle = '#9ca3af'; c.lineWidth = 0.6
  for (let k = 1; k < 5; k++) { c.beginPath(); c.moveTo(x + k * 4.4, y + PH - 3); c.lineTo(x + k * 4.4, y + PH); c.stroke() }
  c.restore()
  c.strokeStyle = '#facc15'; c.lineWidth = 1.6
  c.beginPath(); c.roundRect(x + 0.8, y + 0.8, PW - 1.6, PH - 1.6, 7); c.stroke()
  // Notenzeichen
  c.fillStyle = `rgba(245,208,254,${0.7 + 0.3 * Math.sin(t * 5)})`
  c.font = '700 11px system-ui, "Segoe UI Symbol", sans-serif'; c.textAlign = 'center'
  c.fillText('♫', cx + (face > 0 ? -3 : 3), y + 22)
  // Augen
  c.fillStyle = '#fff'
  c.fillRect(x + (face > 0 ? 11 : 3), y + 5, 7, 6)
  c.fillStyle = '#0f172a'
  c.fillRect(x + (face > 0 ? 15 : 4), y + 6, 3, 4)
  c.restore()
}

export function drawPianoName(c: CanvasRenderingContext2D, cx: number, y: number, name: string, t: number): void {
  c.save()
  c.textAlign = 'center'
  c.font = '700 12px system-ui, "Segoe UI Symbol", sans-serif'
  c.shadowColor = '#c026d3'; c.shadowBlur = 9
  const text = `♪ ${name} ♪`
  const w = c.measureText(text).width
  const g = c.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0)
  const o = (t * 0.5) % 1
  g.addColorStop(0, '#f5d0fe'); g.addColorStop(Math.max(0.01, Math.min(0.99, o)), '#ffffff'); g.addColorStop(1, '#a5f3fc')
  c.fillStyle = g
  c.fillText(text, cx, y)
  c.restore()
}

interface Piece { w: number; h: number; col: string; vx: number; vy: number; vr: number }
function pieces(): Piece[] {
  const out: Piece[] = []
  const add = (n: number, w: number, h: number, col: string, spread: number) => {
    for (let i = 0; i < n; i++) out.push({ w, h, col, vx: (rnd(out.length * 3.1) - 0.5) * 2 * spread, vy: -110 - rnd(out.length * 5.7) * 200, vr: (rnd(out.length * 7.9) - 0.5) * 14 })
  }
  add(1, 34, 10, '#1e1b4b', 90)   // Deckel
  add(2, 6, 14, '#1e1b2e', 120)   // Beine
  add(1, 24, 12, '#e5e7eb', 70)   // Notenständer
  add(6, 6, 9, '#fafafa', 160)    // weiße Tasten
  add(4, 4, 6, '#111827', 160)    // schwarze Tasten
  add(2, 16, 14, '#312e81', 130)  // Korpusstücke
  add(1, 8, 3, '#fbbf24', 100)    // Pedal
  return out
}
const PIECES = pieces()

/** Position eines Trümmerteils s Sekunden nach dem Einschlag (landet auf dem Boden und bleibt liegen). */
function piecePos(p: Piece, s: number, i: number, x0: number, ground: number): { x: number; y: number; r: number } {
  const g = 760
  let x = x0 + p.vx * s
  let y = ground - 22 + p.vy * s + 0.5 * g * s * s
  const floor = ground - p.h / 2
  let r = p.vr * s
  if (y > floor) { y = floor; x = x0 + p.vx * Math.min(s, 0.55) * (0.9 + (i % 3) * 0.05); r = p.vr * Math.min(s, 0.55) }
  return { x, y, r }
}

export function drawPianoAnim(c: CanvasRenderingContext2D, h: HoleAnim, t: number): void {
  const cx = h.x + PW / 2
  const feet = h.y + PH
  if (h.kind === 'in') {
    const tt = h.t
    if (tt < PIANO_APPEAR) {
      const k = clamp01(tt / PIANO_APPEAR)
      // Schatten
      c.save(); c.globalAlpha = 0.15 + 0.4 * k; c.fillStyle = '#000'
      c.beginPath(); c.ellipse(cx, feet, 14 + 24 * k, 3 + 5 * k, 0, 0, Math.PI * 2); c.fill()
      c.restore()
      const y = -70 + (feet - 24 + 70) * k * k
      drawPiano(c, cx, y, 1, 0.18 * (1 - k))
      // Windstreifen
      c.save(); c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1.2
      for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(cx + i * 12, y - 30); c.lineTo(cx + i * 12, y - 30 - 28 * k); c.stroke() }
      c.restore()
      return
    }
    const s = tt - PIANO_APPEAR
    const q = clamp01(s / (PIANO_IN - PIANO_APPEAR))
    // Druckwelle und Staub
    c.save()
    c.globalAlpha = 0.7 * (1 - q); c.strokeStyle = '#e9d5ff'; c.lineWidth = 3 * (1 - q) + 1
    c.beginPath(); c.ellipse(cx, feet, 16 + 100 * ease(q), 4 + 18 * ease(q), 0, 0, Math.PI * 2); c.stroke()
    for (let i = 0; i < 9; i++) {
      const side = i % 2 ? 1 : -1
      c.globalAlpha = 0.4 * (1 - q)
      c.fillStyle = '#cbd5e1'
      c.beginPath(); c.arc(cx + side * (10 + 60 * ease(q) * (0.4 + rnd(i * 1.9))), feet - 4 - 22 * q * (0.3 + rnd(i * 3.3)), 6 + 12 * q, 0, Math.PI * 2); c.fill()
    }
    c.restore()
    // Trümmer
    PIECES.forEach((p, i) => {
      const pos = piecePos(p, s, i, cx, feet)
      c.save(); c.globalAlpha = q < 0.7 ? 1 : Math.max(0, 1 - (q - 0.7) / 0.3)
      c.translate(pos.x, pos.y); c.rotate(pos.r)
      c.fillStyle = p.col; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 0.8; c.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h)
      c.restore()
    })
    // Noten steigen auf
    for (let i = 0; i < 6; i++) note(c, cx + (rnd(i * 2.7) - 0.5) * 70, feet - 20 - 70 * ease(q) * (0.5 + rnd(i * 1.3)), 13, i, 1 - q * 1.1)
    return
  }
  // out
  const tt = h.t
  const bodyCx = cx, bodyCy = h.y + PH / 2
  const morphStart = 0.4, morphEnd = 0.95
  const flyPos = (tau: number): { x: number; y: number } => {
    const u = clamp01((tau - morphEnd) / (PIANO_OUT - morphEnd))
    return { x: bodyCx + 300 * u * u + Math.sin(u * 10) * 9 * u, y: bodyCy - 26 * u - 330 * Math.pow(u, 1.5) }
  }
  if (tt < morphEnd) {
    const m = clamp01((tt - morphStart) / (morphEnd - morphStart))
    // Figur wackelt, dann wird sie zum Klavier
    const shake = tt < morphStart ? Math.sin(tt * 80) * 1.6 : 0
    drawPianoBack(c, h.x, h.y, t)
    drawPianoBody(c, h.x + shake, h.y, h.face, t, 1 - ease(m), 1 + 0.5 * m, m * 3)
    if (m > 0) drawPiano(c, bodyCx, bodyCy - 8 * m, 0.3 + 0.7 * ease(m), (1 - m) * -0.5, ease(m))
    // Funkenring und Noten beim Verwandeln
    if (m > 0 && m < 1) {
      c.save(); c.strokeStyle = `rgba(245,208,254,${1 - m})`; c.lineWidth = 3
      c.beginPath(); c.arc(bodyCx, bodyCy, 14 + 46 * m, 0, Math.PI * 2); c.stroke()
      c.restore()
    }
    for (let i = 0; i < 5; i++) { const a = t * 3 + i * 1.26; note(c, bodyCx + Math.cos(a) * (24 + 14 * m), bodyCy + Math.sin(a) * (20 + 10 * m) - 6, 12, i, tt < 0.15 ? tt / 0.15 : 1) }
    return
  }
  // fliegt davon
  const u = clamp01((tt - morphEnd) / (PIANO_OUT - morphEnd))
  const p = flyPos(tt)
  const flap = Math.sin(t * 20)
  // Notenspur
  for (let i = 1; i <= 9; i++) {
    const q = flyPos(tt - i * 0.06)
    note(c, q.x + (rnd(i * 4.4) - 0.5) * 8, q.y + 6, 12 - i * 0.6, i, (1 - i / 10) * (1 - u * 0.5))
  }
  // Flügel
  c.save(); c.translate(p.x, p.y - 4); c.globalAlpha = 1 - u * 0.6
  for (const side of [-1, 1]) {
    c.save(); c.scale(side, 1); c.rotate(-0.35 - 0.5 * flap)
    c.fillStyle = '#f8fafc'; c.strokeStyle = '#cbd5e1'; c.lineWidth = 1
    c.beginPath(); c.moveTo(26, -4); c.quadraticCurveTo(52, -34, 66, -10); c.quadraticCurveTo(52, -14, 46, -2); c.quadraticCurveTo(38, -10, 26, 2); c.closePath(); c.fill(); c.stroke()
    c.restore()
  }
  c.restore()
  drawPiano(c, p.x, p.y, 1 - 0.35 * u, Math.sin(u * 9) * 0.14 + u * 0.5, 1 - Math.max(0, u - 0.8) * 5)
}
