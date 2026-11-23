import { bridgeH, cityPush, onDeck, roofH, tunnelAt, tunnelClamp, tunnelD } from './city'
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
  /** Ebene: 0 Straße/Gelände, −1 Tunnel, 1 Brücke */
  lvl?: number
}
export interface WalkInput { fwd: boolean; back: boolean; left: boolean; right: boolean; run?: boolean; jump?: boolean; turn?: number }
export const WALK = 4.4
export const RUN = 7.6
/** Lauf- und Sprinttempo (vom Admin im Showroom einstellbar) */
export const footConfig = { walk: WALK, run: RUN, /** Shop: Tempo- und Sprung-Faktor */ speed: 1, jump: 1 }
export const setFootSpeeds = (walk?: number | null, run?: number | null): void => {
  footConfig.walk = walk && walk >= 1 && walk <= 40 ? walk : WALK
  footConfig.run = run && run >= 1 && run <= 40 ? run : RUN
}
export const JUMP_V = 7.4
export const HP_MAX = 100
/** Maximale Leben der eigenen Figur (Fitnessstudio erhöht sie bis 200) */
export const hpCfg = { max: HP_MAX, /** Schadensfaktor (Schutzweste aus dem Shop: 0,5) */ armor: 1 }
export const WALK_R = 0.45

export const newWalker = (x: number, z: number, h: number, y?: number): Walker => ({ x, z, h, y: y ?? hillH(x, z), vy: 0, vx: 0, vz: 0, hp: hpCfg.max, stun: 0, inv: 0, ph: 0, sp: 0 })

/** Boden unter der Figur: Gelände oder Parkhaus-Ebene, die höchstens 0,6 m über den Füßen liegt. */
export function groundAt(x: number, z: number, y: number, lvl = 0): number {
  if (lvl === -1) return -tunnelD(x, z)
  if (lvl === 1) return bridgeH(x, z)
  const bi = buildingAt(x, z)
  if (bi) {
    const is = interiorSurfaces(bi, x, z)
    let gi = -Infinity
    for (const h of is) if (h <= y + 0.6) gi = Math.max(gi, h)
    // Hausdach: oben angekommen (z. B. aus dem Auto/Heli gestiegen) läuft man auf dem Dach, statt durchzufallen
    if (bi.h > 3 && bi.h <= y + 0.6) gi = Math.max(gi, bi.h)
    return gi === -Infinity ? is[0] : gi
  }
  const ps = parkSurfaces(x, z)
  // Hausdach: wer oben steht (Füße höchstens 0,6 m unter der Kante), läuft auf dem Dach statt durchzufallen
  const roof = y > 3 ? roofH(x, z) : 0
  const onRoof = roof > 0 && roof <= y + 0.6
  if (!ps.length) return onRoof ? Math.max(roof, hillH(x, z)) : hillH(x, z)
  let g = -Infinity
  for (const h of ps) if (h <= y + 0.6) g = Math.max(g, h)
  if (onRoof) g = Math.max(g, roof)
  return g === -Infinity ? ps[0] : g
}

/** Stößt die Figur (Kreis) gegen etwas? Gibt die Rückschubrichtung zurück. */
function pushAt(x: number, z: number, px: number, pz: number, y: number) {
  const bi = buildingAt(x, z)
  if (bi) return interiorPush(bi, x, z, y)
  return cityPush(x, z) ?? treePush(x, z) ?? parkPush(x, z, y, px, pz)
}

/** Ein Schritt zu Fuß (in Teilschritten ≤ 0,2 m, damit man auch bei Rucklern nicht durch Wände läuft). */
export function stepWalker(w: Walker, inp: WalkInput, dt: number): Walker {
  const fast = Math.hypot(w.vx, w.vz) + (inp.fwd ? footConfig.run * 1.3 : 0) + 8
  const n = Math.max(1, Math.min(40, Math.ceil((fast * dt) / 0.2)))
  let cur = w
  for (let i = 0; i < n; i++) cur = stepOnce(cur, i === 0 ? inp : { ...inp, jump: false }, dt / n)
  return cur
}

function stepOnce(w: Walker, inp: WalkInput, dt: number): Walker {
  const stunned = w.stun > 0
  let h = w.h
  const lvl0 = w.lvl ?? 0
  if (!stunned) h += ((inp.left ? 1 : 0) - (inp.right ? 1 : 0) - (inp.turn ?? 0)) * 2.7 * dt
  const g0 = groundAt(w.x, w.z, w.y, lvl0)
  const grounded = w.y <= g0 + 0.05 && w.vy <= 0
  const air = !grounded
  const base = (inp.run ? footConfig.run : footConfig.walk) * footConfig.speed * (air ? 1.3 : 1)
  const sp = stunned ? 0 : (inp.fwd ? 1 : 0) * base - (inp.back ? 1 : 0) * footConfig.walk * 0.55
  const dec = Math.exp(-2.2 * dt)
  let vx = w.vx * dec, vz = w.vz * dec
  if (Math.hypot(vx, vz) < 0.05) { vx = 0; vz = 0 }
  let x = w.x + (Math.sin(h) * sp + vx) * dt, z = w.z + (Math.cos(h) * sp + vz) * dt
  let lvl = lvl0
  // Ebenenwechsel: Tunnelrampe hinunter, Brücke hinauf, wieder heraus
  if (lvl === 0) {
    const d = tunnelD(x, z)
    if (d > 0.05 && d < 1.4 && w.y <= 0.3 && tunnelAt(x, z)) lvl = -1
    else if (onDeck(x, z) && bridgeH(x, z) > 0.05 && w.y >= bridgeH(x, z) - 0.6 && w.y <= bridgeH(x, z) + 1) lvl = 1
  } else if (lvl === -1) { if (!tunnelAt(x, z)) lvl = 0 } else if (lvl === 1 && !onDeck(x, z)) lvl = 0
  if (lvl === -1 && tunnelD(x, z) > 1.5) { const c = tunnelClamp(x, z); if (c) { x = c.x; z = c.z } }
  // Kollision: vier Punkte um die Figur
  if (lvl === 0) for (let it = 0; it < 2; it++) {
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
  const g = groundAt(x, z, w.y, lvl)
  let y = w.y, vy = w.vy
  if (inp.jump && grounded && !stunned) { vy = JUMP_V * footConfig.jump; y = w.y + 0.02 }
  if (y > g + 0.02 || vy > 0) { vy -= 24 * dt; y += vy * dt; if (y <= g) { y = g; vy = 0 } } else { y = g; vy = 0 }
  const speed = Math.hypot(Math.sin(h) * sp + vx, Math.cos(h) * sp + vz)
  return { ...w, x, z, h, y, vy, vx, vz, lvl, stun: Math.max(0, w.stun - dt), inv: Math.max(0, w.inv - dt), ph: w.ph + Math.min(speed, 8) * dt * 1.7, sp: speed }
}

/** Auto-Daten für die Treffer-Prüfung (Hitbox: Länge/Breite, Tempo in m/s). */
export interface HitCar { x: number; z: number; h: number; v: number; len: number; wid: number; y?: number; fly?: number }
export const HIT_MIN_V = 3
/** Schaden eines Aufpralls bei Tempo v (m/s). */
export const hitDamage = (v: number) => Math.min(HP_MAX, Math.round(Math.round((Math.abs(v) - 2) * 3.4) * hpCfg.armor))

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

/** Aussteigen während der Fahrt: Schwung des Autos geht auf die Figur über, bei hohem Tempo gibt es Schaden. Der Ausstiegsort muss auf der Höhe des Autos liegen (Parkhaus!). */
export function exitFromCar(c: { x: number; z: number; h: number; v: number; wid: number; y?: number; lvl?: number }, side = 1, hp = hpCfg.max): Walker {
  const lvl = c.lvl ?? 0
  const cy = lvl === -1 ? -tunnelD(c.x, c.z) : lvl === 1 ? bridgeH(c.x, c.z) : (c.y ?? 0)
  const rx = Math.cos(c.h), rz = -Math.sin(c.h)
  const off = c.wid / 2 + 0.9
  let x = c.x, z = c.z
  let found = false
  for (const [sd, k] of [[side, 1], [-side, 1], [side, 1.7], [-side, 1.7], [side, 2.6], [-side, 2.6]] as const) {
    const tx = c.x + rx * sd * off * k, tz = c.z + rz * sd * off * k
    const ok = lvl === 0 ? !pushAt(tx, tz, c.x, c.z, cy) && groundAt(tx, tz, cy) >= cy - 0.7 : lvl === -1 ? tunnelAt(tx, tz) !== null : onDeck(tx, tz)
    if (ok) { x = tx; z = tz; found = true; break }
  }
  const w = newWalker(x, z, c.h, cy)
  const sp = Math.abs(c.v)
  const fall = sp > 11 ? Math.round((sp - 11) * 2.6) : 0
  const sd = found && (x - c.x) * rx + (z - c.z) * rz < 0 ? -1 : 1
  return { ...w, lvl, y: cy, vx: Math.sin(c.h) * c.v * 0.55 + rx * sd * Math.min(3, sp * 0.1), vz: Math.cos(c.h) * c.v * 0.55 + rz * sd * Math.min(3, sp * 0.1), hp: Math.max(1, hp - Math.min(90, fall)), stun: sp > 15 ? 0.9 : 0, inv: 1.2 }
}

/** Nächstes Auto in Reichweite zum Einsteigen (Abstand zur Mitte ≤ r). */
export function nearestCar<T extends { x: number; z: number }>(w: { x: number; z: number }, cars: ReadonlyArray<T>, r = 5): T | null {
  let best: T | null = null, bd = r
  for (const c of cars) { const d = Math.hypot(c.x - w.x, c.z - w.z); if (d < bd) { bd = d; best = c } }
  return best
}
