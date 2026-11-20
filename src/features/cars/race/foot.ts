import { cityPush } from './city'
import { hillH } from './mountains'
import { treePush } from './forest'
import { parkPush, parkSurfaces } from './parkhaus'
import { buildingAt, interiorPush, interiorSurfaces } from './interior'

/** Zu Fuß in der Stadt: Spielfigur, Kollision mit Häusern/Bäumen und Verletzungen durch Autos. */
export interface Walker {
  x: number; z: number
  /** Blickrichtung (wie beim Auto: 0 = +z) */
  h: number
  y: number; vy: number
  /** Stoßgeschwindigkeit (Rückstoß, Schwung beim Aussteigen) */
  vx: number; vz: number
  hp: number
  /** Betäubt/umgeworfen (s): keine Steuerung */
  stun: number
  /** Unverwundbar nach einem Treffer (s) */
  inv: number
  /** Laufphase für die Animation */
  ph: number
  /** Geschwindigkeit in m/s (für die Animation) */
  sp: number
}
export interface WalkInput { fwd: boolean; back: boolean; left: boolean; right: boolean; run?: boolean }
export const WALK = 4.4
export const RUN = 7.6
export const HP_MAX = 100
export const WALK_R = 0.45

export const newWalker = (x: number, z: number, h: number, y?: number): Walker => ({ x, z, h, y: y ?? hillH(x, z), vy: 0, vx: 0, vz: 0, hp: HP_MAX, stun: 0, inv: 0, ph: 0, sp: 0 })

/** Boden unter der Figur: Gelände oder Parkhaus-Ebene, die höchstens 0,6 m über den Füßen liegt. */
export function groundAt(x: number, z: number, y: number): number {
  const bi = buildingAt(x, z)
  if (bi) {
    const is = interiorSurfaces(bi, x, z)
    let gi = -Infinity
    for (const h of is) if (h <= y + 0.6) gi = Math.max(gi, h)
    return gi === -Infinity ? is[0] : gi
  }
  const ps = parkSurfaces(x, z)
  if (!ps.length) return hillH(x, z)
  let g = -Infinity
  for (const h of ps) if (h <= y + 0.6) g = Math.max(g, h)
  return g === -Infinity ? ps[0] : g
}

/** Stößt die Figur (Kreis) gegen etwas? Gibt die Rückschubrichtung zurück. */
function pushAt(x: number, z: number, px: number, pz: number, y: number) {
  const bi = buildingAt(x, z)
  if (bi) return interiorPush(bi, x, z, y)
  return cityPush(x, z) ?? treePush(x, z) ?? parkPush(x, z, y, px, pz)
}

/** Ein Schritt zu Fuß: Drehen mit links/rechts, vor/zurück, Rückstoß klingt ab, Häuser/Bäume/Parkhauswände sind fest. */
export function stepWalker(w: Walker, inp: WalkInput, dt: number): Walker {
  const stunned = w.stun > 0
  let h = w.h
  if (!stunned) h += ((inp.left ? 1 : 0) - (inp.right ? 1 : 0)) * 2.7 * dt
  const sp = stunned ? 0 : (inp.fwd ? 1 : 0) * (inp.run ? RUN : WALK) - (inp.back ? 1 : 0) * WALK * 0.55
  const dec = Math.exp(-2.2 * dt)
  let vx = w.vx * dec, vz = w.vz * dec
  if (Math.hypot(vx, vz) < 0.05) { vx = 0; vz = 0 }
  let x = w.x + (Math.sin(h) * sp + vx) * dt, z = w.z + (Math.cos(h) * sp + vz) * dt
  // Kollision: vier Punkte um die Figur
  for (let it = 0; it < 2; it++) {
    let bd = 0, bn = 0, bm = 0
    for (const [ox, oz] of [[WALK_R, 0], [-WALK_R, 0], [0, WALK_R], [0, -WALK_R]] as const) {
      const p = pushAt(x + ox, z + oz, w.x + ox, w.z + oz, w.y)
      if (p && p.depth > bd) { bd = p.depth; bn = p.nx; bm = p.nz }
    }
    if (bd <= 0) break
    x += bn * bd; z += bm * bd
    const into = -(vx * bn + vz * bm)
    if (into > 0) { vx += bn * into; vz += bm * into }
  }
  const g = groundAt(x, z, w.y)
  let y = w.y, vy = w.vy
  if (y > g + 0.02 || vy > 0) { vy -= 24 * dt; y += vy * dt; if (y <= g) { y = g; vy = 0 } } else { y = g; vy = 0 }
  const speed = Math.hypot(Math.sin(h) * sp + vx, Math.cos(h) * sp + vz)
  return { ...w, x, z, h, y, vy, vx, vz, stun: Math.max(0, w.stun - dt), inv: Math.max(0, w.inv - dt), ph: w.ph + Math.min(speed, 8) * dt * 1.7, sp: speed }
}

/** Auto-Daten für die Treffer-Prüfung (Hitbox: Länge/Breite, Tempo in m/s). */
export interface HitCar { x: number; z: number; h: number; v: number; len: number; wid: number; y?: number; fly?: number }
export const HIT_MIN_V = 3
/** Schaden eines Aufpralls bei Tempo v (m/s). */
export const hitDamage = (v: number) => Math.min(HP_MAX, Math.round((Math.abs(v) - 2) * 3.4))

/** Überfährt das Auto die Figur? Dann Schaden und Rückstoß (die Figur fliegt ein Stück vom Auto weg und nach oben). */
export function carHit(w: Walker, c: HitCar): Walker | null {
  if (w.inv > 0 || Math.abs(c.v) < HIT_MIN_V) return null
  if (Math.abs((c.y ?? 0) - w.y) > 2.2) return null
  // Figur im Auto-Koordinatensystem: vorwärts f, seitlich s
  const fx = Math.sin(c.h), fz = Math.cos(c.h)
  const dx = w.x - c.x, dz = w.z - c.z
  const f = dx * fx + dz * fz, s = dx * fz - dz * fx
  const m = WALK_R + 0.25
  if (Math.abs(f) > c.len / 2 + m || Math.abs(s) > c.wid / 2 + m) return null
  const dir = Math.sign(c.v)
  // nur die „vordere“ Seite trifft (bei Rückwärtsfahrt das Heck)
  if (f * dir < -c.len * 0.15) return null
  const sp = Math.abs(c.v)
  const k = sp * 0.7 + 4
  const dmg = hitDamage(sp)
  const sd = Math.abs(s) < 0.2 ? 0 : Math.sign(s) * Math.min(1, Math.abs(s) / (c.wid / 2)) * 0.45
  const ax = fx * dir + fz * sd, az = fz * dir - fx * sd, al = Math.hypot(ax, az) || 1
  return { ...w, hp: Math.max(0, w.hp - dmg), vx: (ax / al) * k, vz: (az / al) * k, vy: 5 + sp * 0.18, y: w.y + 0.05, stun: 1.6 + Math.min(1.5, sp * 0.04), inv: 0.9 }
}

/** Aussteigen während der Fahrt: Schwung des Autos geht auf die Figur über, bei hohem Tempo gibt es Schaden. */
export function exitFromCar(c: { x: number; z: number; h: number; v: number; wid: number; y?: number }, side = 1): Walker {
  const rx = Math.cos(c.h) * side, rz = -Math.sin(c.h) * side
  const off = c.wid / 2 + 0.9
  let x = c.x + rx * off, z = c.z + rz * off
  const p = cityPush(x, z)
  if (p) { x -= rx * off * 2; z -= rz * off * 2 }
  const w = newWalker(x, z, c.h, c.y ?? 0)
  const sp = Math.abs(c.v)
  const fall = sp > 11 ? Math.round((sp - 11) * 2.6) : 0
  return { ...w, y: Math.max(w.y, c.y ?? 0), vx: Math.sin(c.h) * c.v * 0.55 + rx * Math.min(3, sp * 0.1), vz: Math.cos(c.h) * c.v * 0.55 + rz * Math.min(3, sp * 0.1), hp: HP_MAX - Math.min(90, fall), stun: sp > 15 ? 0.9 : 0, inv: 1.2 }
}

/** Nächstes Auto in Reichweite zum Einsteigen (Abstand zur Mitte ≤ r). */
export function nearestCar<T extends { x: number; z: number }>(w: { x: number; z: number }, cars: ReadonlyArray<T>, r = 5): T | null {
  let best: T | null = null, bd = r
  for (const c of cars) { const d = Math.hypot(c.x - w.x, c.z - w.z); if (d < bd) { bd = d; best = c } }
  return best
}
