/**
 * Parkour-Effekte (Shop): Spuren und Partikel hinter und um die Figur. Rein optisch, jede Person sieht die Effekte
 * der anderen (die Effekt-ID kommt mit der Personenliste). Alles auf einem kleinen Partikelvorrat mit Obergrenze,
 * damit auch fünf Spielende mit Effekt am Handy flüssig bleiben.
 */
import { PH, PW } from './engine'

type Kind = 'dot' | 'glyph' | 'bubble' | 'flame' | 'spiral' | 'orbit' | 'bolt'
interface Particle {
  uid: string
  kind: Kind
  x: number; y: number; vx: number; vy: number
  life: number; max: number
  size: number
  color: string
  glyph?: string
  ang?: number; rad?: number; spin?: number
  pts?: Array<[number, number]>
}
interface TrailPoint { x: number; y: number; t: number }

const MAX_PARTS = 360
const TRAIL_LEN = 26
const TRAIL_STEP = 0.028
const RAINBOW = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#60a5fa', '#c084fc']

export class FxField {
  private parts: Particle[] = []
  private trail = new Map<string, TrailPoint[]>()
  private anchor = new Map<string, { x: number; y: number; face: number; cx: number; foot: number }>()
  private acc = new Map<string, number>()

  /** Pro Bild für jede sichtbare Figur aufrufen (x, y = linke obere Ecke der Figur). */
  update(uid: string, fx: string | null | undefined, x: number, y: number, face: 1 | -1, t: number, dt: number, rate = 1): void {
    const cx = x + PW / 2, cy = y + PH / 2
    this.anchor.set(uid, { x: cx - face * 26, y: cy, face, cx, foot: y + PH + 3 })
    if (!fx) { this.trail.delete(uid); return }
    // Spur: Positionen in festen Zeitabständen merken (für Notenband und Regenbogenstrahl)
    let tr = this.trail.get(uid)
    if (!tr) { tr = []; this.trail.set(uid, tr) }
    const last = tr[tr.length - 1]
    if (!last || t - last.t >= TRAIL_STEP) {
      // Sprung (Neustart, Levelwechsel): Spur abreißen lassen statt quer durchs Bild zu ziehen
      if (last && Math.hypot(cx - last.x, cy - last.y) > 160) tr.length = 0
      tr.push({ x: cx, y: cy, t })
      if (tr.length > TRAIL_LEN) tr.shift()
    }
    // Spawn-Zähler: je Effekt eigene Rate
    const emit = (perSec: number, make: () => Particle) => {
      const key = uid + ':' + perSec
      const acc = (this.acc.get(key) ?? 0) + dt * rate * perSec
      let k = Math.floor(acc)
      this.acc.set(key, acc - k)
      while (k-- > 0 && this.parts.length < MAX_PARTS) this.parts.push(make())
    }
    const R = Math.random
    switch (fx) {
      case 'noten':
        emit(5, () => ({ uid, kind: 'glyph', x: cx - face * 14 + (R() - 0.5) * 6, y: cy + (R() - 0.5) * 18, vx: -face * (10 + R() * 14), vy: -18 - R() * 18, life: 0, max: 1.1 + R() * 0.5, size: 13 + R() * 5, color: '#e0e7ff', glyph: R() < 0.5 ? '♪' : '♫' }))
        break
      case 'funken':
        emit(26, () => ({ uid, kind: 'dot', x: cx + (R() - 0.5) * 18, y: cy + (R() - 0.2) * 20, vx: (R() - 0.5) * 60 - face * 30, vy: (R() - 0.7) * 50, life: 0, max: 0.4 + R() * 0.4, size: 1.5 + R() * 2, color: R() < 0.5 ? '#fde047' : '#fbbf24' }))
        break
      case 'herzen':
        emit(5, () => ({ uid, kind: 'glyph', x: cx + (R() - 0.5) * 22, y: cy - 4 + R() * 10, vx: (R() - 0.5) * 24, vy: -26 - R() * 20, life: 0, max: 1 + R() * 0.7, size: 11 + R() * 6, color: R() < 0.5 ? '#f472b6' : '#fb7185', glyph: '♥' }))
        break
      case 'sterne':
        emit(9, () => ({ uid, kind: 'glyph', x: cx + (R() - 0.5) * 26, y: cy + (R() - 0.5) * 26, vx: (R() - 0.5) * 20 - face * 14, vy: 6 + R() * 18, life: 0, max: 0.9 + R() * 0.6, size: 8 + R() * 6, color: '#fef08a', glyph: '★' }))
        break
      case 'schnee':
        emit(14, () => ({ uid, kind: 'dot', x: cx + (R() - 0.5) * 70, y: cy - 38 - R() * 10, vx: (R() - 0.5) * 24, vy: 28 + R() * 26, life: 0, max: 1.6 + R() * 0.8, size: 1.6 + R() * 2.2, color: '#f8fafc' }))
        break
      case 'blasen':
        emit(5, () => ({ uid, kind: 'bubble', x: cx + (R() - 0.5) * 24, y: cy + 8 + R() * 8, vx: (R() - 0.5) * 14, vy: -22 - R() * 22, life: 0, max: 1.3 + R() * 0.8, size: 3 + R() * 5, color: '#bae6fd' }))
        break
      case 'feuerspur':
        emit(38, () => ({ uid, kind: 'flame', x: cx - face * (6 + R() * 8), y: cy + (R() - 0.3) * 18, vx: -face * (20 + R() * 40), vy: -14 - R() * 34, life: 0, max: 0.35 + R() * 0.35, size: 4 + R() * 6, color: R() < 0.5 ? '#f97316' : R() < 0.5 ? '#facc15' : '#ef4444' }))
        break
      case 'blitz':
        emit(3.2, () => {
          const ang = R() * Math.PI * 2
          const len = 22 + R() * 26
          const pts: Array<[number, number]> = [[cx, cy]]
          for (let k = 1; k <= 4; k++) pts.push([cx + Math.cos(ang) * len * (k / 4) + (R() - 0.5) * 12, cy + Math.sin(ang) * len * (k / 4) + (R() - 0.5) * 12])
          return { uid, kind: 'bolt', x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0.12 + R() * 0.1, size: 2, color: R() < 0.5 ? '#e0f2fe' : '#fde047', pts }
        })
        break
      case 'galaxiewirbel': {
        let have = 0
        for (const p of this.parts) if (p.uid === uid && p.kind === 'orbit') have++
        while (have++ < 9 && this.parts.length < MAX_PARTS) {
          this.parts.push({ uid, kind: 'orbit', x: cx, y: cy, vx: 0, vy: 0, life: 0, max: 9e9, size: 1.5 + R() * 2, color: ['#c4b5fd', '#93c5fd', '#f0abfc', '#fff'][Math.floor(R() * 4)], ang: R() * Math.PI * 2, rad: 22 + R() * 16, spin: (R() < 0.5 ? 1 : -1) * (1.6 + R() * 1.6) })
        }
        break
      }
      case 'schwarzesloch':
        emit(26, () => ({ uid, kind: 'spiral', x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0.9 + R() * 0.5, size: 1.4 + R() * 1.8, color: R() < 0.5 ? '#a78bfa' : R() < 0.5 ? '#e879f9' : '#e2e8f0', ang: R() * Math.PI * 2, rad: 46 + R() * 10, spin: 3.4 + R() * 1.5 }))
        break
      default:
        break
    }
  }

  /** Alle Teilchen um dt voranbringen (einmal pro Bild). */
  step(dt: number): void {
    const keep: Particle[] = []
    for (const p of this.parts) {
      p.life += dt
      if (p.life >= p.max) continue
      if (p.kind === 'orbit') {
        const an = this.anchor.get(p.uid)
        if (!this.trail.has(p.uid) || !an) continue // Effekt abgelegt oder Person weg
        p.ang = (p.ang ?? 0) + (p.spin ?? 1) * dt
        const cx = an.x + an.face * 26, cy = an.y
        p.x = cx + Math.cos(p.ang) * (p.rad ?? 24)
        p.y = cy + Math.sin(p.ang) * (p.rad ?? 24) * 0.7
      } else if (p.kind === 'spiral') {
        const an = this.anchor.get(p.uid)
        if (!an) continue
        const k = 1 - p.life / p.max
        const rad = Math.max(2, (p.rad ?? 40) * k * k)
        p.ang = (p.ang ?? 0) + (p.spin ?? 3) * dt * (1 + (1 - k) * 2)
        p.x = an.cx + Math.cos(p.ang) * rad
        p.y = an.foot + Math.sin(p.ang) * rad * 0.28 // flach: Loch liegt unter den Füßen
      } else if (p.kind !== 'bolt') {
        p.x += p.vx * dt
        p.y += p.vy * dt
        if (p.kind === 'flame') p.vy -= 20 * dt
      }
      keep.push(p)
    }
    this.parts = keep
  }

  /** Spuren und Schwarzes Loch (hinter der Figur) zeichnen. */
  drawBehind(ctx: CanvasRenderingContext2D, uid: string, fx: string | null | undefined, t: number): void {
    if (!fx) return
    const tr = this.trail.get(uid)
    if (fx === 'noten' && tr && tr.length > 2) {
      ctx.save()
      ctx.lineWidth = 1.1
      ctx.lineCap = 'round'
      for (let line = -2; line <= 2; line++) {
        for (let i = 1; i < tr.length; i++) {
          const a = i / tr.length
          ctx.strokeStyle = `rgba(224,231,255,${(0.6 * a).toFixed(3)})`
          ctx.beginPath()
          ctx.moveTo(tr[i - 1].x, tr[i - 1].y + line * 4 + 2)
          ctx.lineTo(tr[i].x, tr[i].y + line * 4 + 2)
          ctx.stroke()
        }
      }
      ctx.restore()
    } else if (fx === 'regenbogenstrahl' && tr && tr.length > 2) {
      ctx.save()
      ctx.lineWidth = 3.2
      ctx.lineCap = 'round'
      for (let band = 0; band < RAINBOW.length; band++) {
        for (let i = 1; i < tr.length; i++) {
          const a = i / tr.length
          ctx.strokeStyle = RAINBOW[band]
          ctx.globalAlpha = 0.85 * a
          ctx.beginPath()
          ctx.moveTo(tr[i - 1].x, tr[i - 1].y + (band - 2.5) * 3)
          ctx.lineTo(tr[i].x, tr[i].y + (band - 2.5) * 3)
          ctx.stroke()
        }
      }
      ctx.restore()
    } else if (fx === 'schwarzesloch') {
      const an = this.anchor.get(uid)
      if (!an) return
      ctx.save()
      // Loch unter dem Spieler: flache Scheibe am Boden, Figur steht darüber
      ctx.translate(an.cx, an.foot)
      ctx.scale(1, 0.32)
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 40)
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,0.95)'); g.addColorStop(0.75, 'rgba(124,58,237,0.55)'); g.addColorStop(1, 'rgba(124,58,237,0)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = 'rgba(232,121,249,0.8)'
      ctx.lineWidth = 3
      ctx.beginPath(); ctx.ellipse(0, 0, 28, 20, t * 2.2, 0, Math.PI * 2); ctx.stroke()
      ctx.strokeStyle = 'rgba(167,139,250,0.7)'
      ctx.beginPath(); ctx.ellipse(0, 0, 20, 14, -t * 3, 0, Math.PI * 2); ctx.stroke()
      ctx.fillStyle = '#000'
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
  }

  /** Alle Teilchen zeichnen (nach den Spuren, vor oder nach den Figuren). */
  drawParticles(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    ctx.textAlign = 'center'
    for (const p of this.parts) {
      const k = 1 - p.life / p.max
      const alpha = p.kind === 'orbit' ? 0.9 : p.kind === 'bolt' ? 1 : Math.max(0, Math.min(1, k * 1.4))
      ctx.globalAlpha = alpha
      switch (p.kind) {
        case 'dot':
        case 'orbit':
        case 'spiral':
          ctx.fillStyle = p.color
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill()
          break
        case 'flame':
          ctx.fillStyle = p.color
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * k + 0.5, 0, Math.PI * 2); ctx.fill()
          break
        case 'bubble':
          ctx.strokeStyle = p.color; ctx.lineWidth = 1.2
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.stroke()
          ctx.fillStyle = 'rgba(255,255,255,0.35)'
          ctx.beginPath(); ctx.arc(p.x - p.size * 0.35, p.y - p.size * 0.35, p.size * 0.25, 0, Math.PI * 2); ctx.fill()
          break
        case 'glyph':
          ctx.fillStyle = p.color
          ctx.font = `${Math.round(p.size)}px system-ui, "Segoe UI Symbol", sans-serif`
          ctx.fillText(p.glyph ?? '•', p.x, p.y)
          break
        case 'bolt':
          if (p.pts) {
            ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.shadowColor = '#7dd3fc'; ctx.shadowBlur = 8
            ctx.beginPath(); ctx.moveTo(p.pts[0][0], p.pts[0][1])
            for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1])
            ctx.stroke(); ctx.shadowBlur = 0
          }
          break
      }
    }
    ctx.restore()
  }

  /** Spuren und Anker von Personen entfernen, die nicht mehr da sind. */
  forget(uid: string): void {
    this.trail.delete(uid)
    this.anchor.delete(uid)
  }

  clear(): void { this.parts = []; this.trail.clear() }
  get count(): number { return this.parts.length }
}
