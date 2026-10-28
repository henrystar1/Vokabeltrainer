import { PH, PW } from './engine'
import type { HoleAnim } from './lookTypes'

/** Admin-Look im Parkour: eine Figur wie ein kleines Schwarzes Loch (Ereignishorizont, Akkretionsscheibe, Sternenschweif). */

export const BH_IN = 3.8 // länger als der Einschlag, damit der Rauch nachwirkt
export const BH_APPEAR = 1.35
export const BH_OUT = 2.3

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

const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }

/** Rakete, Spitze nach oben; (0,0) = Mitte. */
function rocket(c: CanvasRenderingContext2D, t: number, flame: number): void {
  // Flamme
  const fl = 14 + 10 * flame + 4 * Math.sin(t * 60)
  const fg = c.createLinearGradient(0, 12, 0, 12 + fl)
  fg.addColorStop(0, '#fff7ae'); fg.addColorStop(0.4, '#fb923c'); fg.addColorStop(1, 'rgba(239,68,68,0)')
  c.fillStyle = fg
  c.beginPath(); c.moveTo(-5, 12); c.lineTo(0, 12 + fl); c.lineTo(5, 12); c.closePath(); c.fill()
  // Flossen
  c.fillStyle = '#dc2626'
  c.beginPath(); c.moveTo(-5, 4); c.lineTo(-11, 15); c.lineTo(-5, 12); c.closePath(); c.fill()
  c.beginPath(); c.moveTo(5, 4); c.lineTo(11, 15); c.lineTo(5, 12); c.closePath(); c.fill()
  // Rumpf
  const g = c.createLinearGradient(-6, 0, 6, 0)
  g.addColorStop(0, '#cbd5e1'); g.addColorStop(0.5, '#fff'); g.addColorStop(1, '#94a3b8')
  c.fillStyle = g
  c.beginPath(); c.roundRect(-6, -10, 12, 24, 3); c.fill()
  // Spitze
  c.fillStyle = '#ef4444'
  c.beginPath(); c.moveTo(-6, -9); c.quadraticCurveTo(0, -30, 6, -9); c.closePath(); c.fill()
  // Fenster
  c.fillStyle = '#38bdf8'; c.beginPath(); c.arc(0, -1, 3, 0, Math.PI * 2); c.fill()
  c.strokeStyle = '#1e293b'; c.lineWidth = 1; c.stroke()
}

function flashRect(c: CanvasRenderingContext2D, cx: number, k: number, strength: number, color = '#f5f3ff', top = 36): void {
  if (k <= 0 || k >= 1) return
  c.save(); c.globalAlpha = strength * (1 - k)
  c.fillStyle = color; c.fillRect(cx - 700, top - 236, 1400, 800)
  c.restore()
}

/**
 * Rauch nach dem Einschlag: viele aufquellende graue Wolken (je mehrere überlappende Kugeln mit weichem Rand), erst dunkel und heiß mit orangem Kern,
 * dann hell und durchsichtig; sie steigen auf, werden größer und driften leicht. s = Sekunden seit dem Einschlag.
 */
function explosionSmoke(c: CanvasRenderingContext2D, cx: number, feet: number, s: number): void {
  const LIFE = 1.9
  c.save()
  for (let i = 0; i < 34; i++) {
    const birth = rnd(i * 5.3) * 0.5
    const u = clamp01((s - birth) / LIFE)
    if (u <= 0 || u >= 1) continue
    const side = (rnd(i * 1.9) - 0.5) * 2
    const rise = 40 + rnd(i * 3.7) * 95
    const px = cx + side * (14 + 52 * Math.sqrt(u)) + Math.sin(u * 3 + i) * 5 + 14 * u
    const py = feet - 12 - rise * ease(Math.sqrt(u)) - 10 * u
    const base = 9 + rnd(i * 7.7) * 9
    const r = base * (0.5 + 1.8 * Math.sqrt(u))
    const alpha = Math.min(1, u * 8) * Math.pow(1 - u, 1.4) * 0.6
    // Farbverlauf: schwarz-braun heiß -> mittelgrau -> hellgrau
    const shade = Math.round(36 + 150 * Math.pow(u, 0.7))
    const warm = Math.round(40 * Math.max(0, 1 - u * 3))
    for (let b = 0; b < 3; b++) {
      const bx = px + (rnd(i * 2.1 + b * 4.4) - 0.5) * r * 0.9
      const by = py + (rnd(i * 6.6 + b * 1.3) - 0.5) * r * 0.7
      const br = r * (0.7 + 0.35 * rnd(i * 9.1 + b))
      const g = c.createRadialGradient(bx, by, br * 0.1, bx, by, br)
      g.addColorStop(0, `rgba(${shade + warm},${shade + Math.round(warm * 0.5)},${shade},${alpha})`)
      g.addColorStop(0.65, `rgba(${shade},${shade},${shade + 4},${alpha * 0.7})`)
      g.addColorStop(1, `rgba(${shade},${shade},${shade + 6},0)`)
      c.fillStyle = g
      c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.fill()
    }
  }
  // glimmende Glut unten, solange es noch heiß ist
  if (s < 0.9) {
    for (let i = 0; i < 10; i++) {
      c.globalAlpha = Math.max(0, 0.8 - s / 0.9) * (0.5 + 0.5 * Math.sin(s * 30 + i))
      c.fillStyle = '#fb923c'
      c.beginPath(); c.arc(cx + (rnd(i * 8.1) - 0.5) * 50, feet - 4 - rnd(i * 2.2) * 8, 1.6, 0, Math.PI * 2); c.fill()
    }
  }
  c.restore()
}

/** Schwarzes Loch (Auftritt): oben im Bild öffnet es sich, eine Rakete rast daraus zum Boden und explodiert, dann steht der Admin da. Verlassen: das Loch öffnet sich über ihm, saugt ihn gestreckt in einer Spirale hinein und kollabiert in einer Sternen-Explosion. */
export function drawBlackholeAnim(c: CanvasRenderingContext2D, h: HoleAnim, t: number): void {
  const cx = h.x + PW / 2
  const feet = h.y + PH
  if (h.kind === 'in') {
    const top = h.top ?? 36 // Oberkante des Bildes: in hohen Ebenen liegt sie weit über dem Boden, das Loch hängt dann entsprechend hoch
    const hy = Math.max(top, h.y - 170)
    const tt = h.t
    const open = tt < 0.45 ? ease(tt / 0.45) : tt < BH_APPEAR ? 1 : tt < BH_APPEAR + 0.5 ? 1 - ease((tt - BH_APPEAR) / 0.5) : 0
    // Zielkreis am Boden
    if (tt > 0.3 && tt < BH_APPEAR) {
      const k = (tt - 0.3) / (BH_APPEAR - 0.3)
      c.save(); c.strokeStyle = `rgba(248,113,113,${0.4 + 0.5 * Math.abs(Math.sin(tt * 14))})`; c.lineWidth = 2
      c.beginPath(); c.ellipse(cx, feet, 40 * (1 - k * 0.6), 9 * (1 - k * 0.6), 0, 0, Math.PI * 2); c.stroke()
      c.beginPath(); c.moveTo(cx - 12, feet); c.lineTo(cx + 12, feet); c.moveTo(cx, feet - 4); c.lineTo(cx, feet + 4); c.stroke()
      c.restore()
    }
    drawHoleDisc(c, cx, hy, 40 * open, t, 0.8)
    // Sog-Streifen
    if (open > 0.05) {
      c.save(); c.globalAlpha = 0.6 * open; c.strokeStyle = '#c4b5fd'; c.lineWidth = 1.4
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + t * 2
        const r0 = 22 + 28 * ((tt * 1.6 + i * 0.13) % 1)
        c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, hy + Math.sin(a) * r0 * 0.8); c.lineTo(cx + Math.cos(a) * (r0 + 6), hy + Math.sin(a) * (r0 + 6) * 0.8); c.stroke()
      }
      c.restore()
    }
    // Rakete
    if (tt >= 0.5 && tt < BH_APPEAR) {
      const k = (tt - 0.5) / (BH_APPEAR - 0.5)
      const ry = hy + (feet - 16 - hy) * k * k
      // Rauchspur: dichte, aufquellende Wolken hinter der Rakete
      c.save()
      for (let i = 1; i <= 16; i++) {
        const kk = Math.max(0, k - i * 0.025)
        const py = hy + (feet - 16 - hy) * kk * kk
        const age = i / 17
        const rr = 4 + age * 11
        const px = cx + (rnd(i * 3.3 + Math.floor(tt * 14)) - 0.5) * (5 + age * 10)
        const sh = Math.round(90 + 110 * age)
        const g = c.createRadialGradient(px, py - 8, 1, px, py - 8, rr)
        g.addColorStop(0, i < 4 ? `rgba(253,186,116,${0.8 - age})` : `rgba(${sh},${sh},${sh + 6},${0.7 * (1 - age)})`)
        g.addColorStop(1, `rgba(${sh},${sh},${sh + 6},0)`)
        c.fillStyle = g
        c.beginPath(); c.arc(px, py - 8, rr, 0, Math.PI * 2); c.fill()
      }
      c.restore()
      c.save(); c.translate(cx, ry); c.rotate(Math.PI); rocket(c, t, k); c.restore()
    }
    // Explosion (Feuer und Funken rasch, der Rauch bleibt länger)
    if (tt >= BH_APPEAR) {
      const qa = (tt - BH_APPEAR) / 0.65
      const q = clamp01(qa)
      flashRect(c, cx, qa / 0.22, 0.85, '#fff7ed', top)
      if (qa < 1) {
        const fr = 10 + 54 * ease(clamp01(q / 0.5))
        c.save()
        c.globalAlpha = Math.max(0, 1 - q * 1.15)
        const fg = c.createRadialGradient(cx, feet - 14, 2, cx, feet - 14, fr)
        fg.addColorStop(0, '#ffffff'); fg.addColorStop(0.25, '#fde047'); fg.addColorStop(0.6, '#f97316'); fg.addColorStop(1, 'rgba(127,29,29,0)')
        c.fillStyle = fg; c.beginPath(); c.arc(cx, feet - 14, fr, 0, Math.PI * 2); c.fill()
        c.strokeStyle = '#fed7aa'; c.lineWidth = 4 * (1 - q) + 1
        c.beginPath(); c.ellipse(cx, feet, 20 + 120 * ease(q), 5 + 26 * ease(q), 0, 0, Math.PI * 2); c.stroke()
        c.restore()
        // Funken und Trümmer
        c.save()
        for (let i = 0; i < 26; i++) {
          const a = rnd(i * 4.7) * Math.PI
          const sp = 90 + rnd(i * 2.2) * 150
          const px = cx + Math.cos(a) * sp * q * (i % 2 ? 1 : -1) * 0.6
          const py = feet - 10 - Math.sin(a) * sp * q * 0.9 + 260 * q * q
          c.globalAlpha = Math.max(0, 1 - q * 1.1)
          c.fillStyle = i % 3 === 0 ? '#fde047' : i % 3 === 1 ? '#fb923c' : '#64748b'
          c.fillRect(px, py, 3, 3)
        }
        c.restore()
      }
      explosionSmoke(c, cx, feet, tt - BH_APPEAR)
    }
    return
  }
  // out
  const tt = h.t
  const hy = Math.max(h.top ?? 36, h.y - 120)
  const bodyY = h.y + PH / 2
  const open = tt < 0.5 ? ease(tt / 0.5) : tt < 1.5 ? 1 : tt < 1.95 ? 1 + 0.35 * Math.sin((tt - 1.5) * 28) : Math.max(0, 1 - ease((tt - 1.95) / 0.2))
  const r = 40 * open * (tt > 1.45 && tt < 1.95 ? 1.25 : 1)
  // Zugstrahl vom Loch zum Boden
  if (tt > 0.15 && tt < 1.5) {
    const g = c.createLinearGradient(0, hy, 0, feet)
    g.addColorStop(0, 'rgba(196,181,253,0.55)'); g.addColorStop(1, 'rgba(196,181,253,0)')
    c.save(); c.globalAlpha = Math.min(1, (tt - 0.15) * 3) * (tt > 1.3 ? (1.5 - tt) / 0.2 : 1)
    c.fillStyle = g
    c.beginPath(); c.moveTo(cx - 12, hy + 6); c.lineTo(cx + 12, hy + 6); c.lineTo(cx + 46, feet + 4); c.lineTo(cx - 46, feet + 4); c.closePath(); c.fill()
    c.restore()
  }
  drawHoleDisc(c, cx, hy, r, t, 0.8)
  // Sterne strömen in die Spirale
  if (tt > 0.3 && tt < 1.95) {
    c.save(); c.fillStyle = '#e9d5ff'
    for (let i = 0; i < 18; i++) {
      const k = ((tt * 0.9 + i * 0.057) % 1)
      const a = i * 0.9 + k * 5
      const rr = (1 - k) * 80 + 6
      c.globalAlpha = Math.min(1, k * 3) * (1 - k * 0.3)
      c.beginPath(); c.arc(cx + Math.cos(a) * rr, hy + Math.sin(a) * rr * 0.7, 1.7, 0, Math.PI * 2); c.fill()
    }
    c.restore()
  }
  // Figur: wackelt, wird hochgezogen, gestreckt und in der Spirale hineingedreht
  if (tt < 1.5) {
    const k = clamp01((tt - 0.35) / 1.1)
    const e = k * k * (1.4 - 0.4 * k)
    const jitter = tt < 0.35 ? Math.sin(tt * 90) * 1.5 : 0
    const px = cx + Math.sin(k * 16) * (1 - k) * 9 + jitter
    const py = bodyY + (hy - bodyY) * Math.min(1, e)
    c.save()
    c.translate(px, py); c.rotate(k * 9); c.scale(1 - 0.85 * k, 1 + 1.3 * k)
    drawAdminBody(c, -PW / 2, -PH / 2, h.face, t, 1 - 0.7 * k)
    c.restore()
  }
  // Kollaps: Blitz, Druckwellen, Sterne
  if (tt >= 1.95) {
    const q = (tt - 1.95) / (BH_OUT - 1.95)
    flashRect(c, cx, q / 0.4, 0.9, '#f5f3ff', h.top ?? 36)
    c.save()
    for (let ring = 0; ring < 3; ring++) {
      const k = clamp01(q * 1.1 - ring * 0.12)
      c.globalAlpha = 0.9 * (1 - k)
      c.strokeStyle = ring % 2 ? '#e879f9' : '#22d3ee'; c.lineWidth = 4 * (1 - k) + 1
      c.beginPath(); c.ellipse(cx, hy, 10 + 130 * ease(k), (10 + 130 * ease(k)) * 0.8, 0, 0, Math.PI * 2); c.stroke()
    }
    c.fillStyle = '#fff'
    for (let i = 0; i < 30; i++) {
      const a = rnd(i * 3.9) * Math.PI * 2
      const rr = 10 + (60 + rnd(i * 5.1) * 90) * ease(q)
      c.globalAlpha = Math.max(0, 1 - q * 1.05)
      c.beginPath(); c.arc(cx + Math.cos(a) * rr, hy + Math.sin(a) * rr * 0.8, 1.6 + (i % 3) * 0.5, 0, Math.PI * 2); c.fill()
    }
    c.restore()
  }
}
