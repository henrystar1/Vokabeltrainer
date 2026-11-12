/** Reine Spiellogik des Online-Shooters (ohne three.js): Arena, Kollision, Treffer. */

export const ARENA = 30 // halbe Kantenlänge
export const EYE = 1.6
export const BODY_H = 1.8
export const BODY_R = 0.5
export const HIT_R = 0.8 // Treffer-Radius etwas großzügiger als der Körper (Netzwerk-Verzögerung)
export const SPEED = 7
export const SHOT_DAMAGE = 25
export const SHOT_COOLDOWN = 0.35
export const RESPAWN_S = 3
export const SPAWNS: Array<[number, number]> = [[-24, -24], [24, -24], [24, 24], [-24, 24]]

export interface Box { x: number; z: number; w: number; d: number; h: number }
export interface Vec3 { x: number; y: number; z: number }

function rng(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000 }
}

/** Gleiche Hindernisse für alle Mitspielenden (aus der Spiel-ID abgeleitet); Startecken bleiben frei. */
export function makeBoxes(seed: string): Box[] {
  const r = rng(seed)
  const out: Box[] = [
    { x: 0, z: 0, w: 6, d: 6, h: 3 }, // Mitte
  ]
  let guard = 0
  while (out.length < 14 && guard++ < 200) {
    const b: Box = { x: (r() * 2 - 1) * 22, z: (r() * 2 - 1) * 22, w: 2 + r() * 4, d: 2 + r() * 4, h: 1.5 + r() * 2.5 }
    const nearSpawn = SPAWNS.some(([sx, sz]) => Math.hypot(b.x - sx, b.z - sz) < 8)
    const overlap = out.some((o) => Math.abs(o.x - b.x) < (o.w + b.w) / 2 + 2 && Math.abs(o.z - b.z) < (o.d + b.d) / 2 + 2)
    if (!nearSpawn && !overlap) out.push(b)
  }
  return out
}

/** Kreis (Spieler) gegen Kisten und Arenarand: gibt die korrigierte Position zurück. */
export function collide(x: number, z: number, r: number, boxes: Box[]): [number, number] {
  let px = Math.min(Math.max(x, -ARENA + r), ARENA - r)
  let pz = Math.min(Math.max(z, -ARENA + r), ARENA - r)
  for (const b of boxes) {
    const hx = b.w / 2 + r
    const hz = b.d / 2 + r
    const dx = px - b.x
    const dz = pz - b.z
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      if (hx - Math.abs(dx) < hz - Math.abs(dz)) px = b.x + Math.sign(dx || 1) * hx
      else pz = b.z + Math.sign(dz || 1) * hz
    }
  }
  return [px, pz]
}

/** Strahl gegen Kiste (Slab-Methode). Gibt die Entfernung oder null zurück. */
export function rayHitBox(o: Vec3, d: Vec3, b: Box): number | null {
  let tmin = 0
  let tmax = Infinity
  const axes: Array<[number, number, number, number]> = [
    [o.x, d.x, b.x - b.w / 2, b.x + b.w / 2],
    [o.y, d.y, 0, b.h],
    [o.z, d.z, b.z - b.d / 2, b.z + b.d / 2],
  ]
  for (const [oo, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return null; continue }
    let t1 = (lo - oo) / dd
    let t2 = (hi - oo) / dd
    if (t1 > t2) [t1, t2] = [t2, t1]
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }
  return tmin
}

/** Strahl gegen einen stehenden Zylinder (Mitspieler). */
export function rayHitPlayer(o: Vec3, d: Vec3, cx: number, cz: number): number | null {
  const ox = o.x - cx
  const oz = o.z - cz
  const a = d.x * d.x + d.z * d.z
  if (a < 1e-9) return null
  const bq = 2 * (ox * d.x + oz * d.z)
  const c = ox * ox + oz * oz - HIT_R * HIT_R
  const disc = bq * bq - 4 * a * c
  if (disc < 0) return null
  const t = (-bq - Math.sqrt(disc)) / (2 * a)
  if (t < 0) return null
  const y = o.y + d.y * t
  return y >= 0 && y <= BODY_H ? t : null
}

/** Wen trifft der Schuss zuerst? Kisten verdecken Spieler. */
export function shoot(o: Vec3, d: Vec3, boxes: Box[], targets: Array<{ id: string; x: number; z: number }>): { id: string; t: number } | null {
  let wall = Infinity
  for (const b of boxes) { const t = rayHitBox(o, d, b); if (t !== null && t < wall) wall = t }
  if (d.y < 0) { const t = -o.y / d.y; if (t < wall) wall = t }
  let best: { id: string; t: number } | null = null
  for (const p of targets) {
    const t = rayHitPlayer(o, d, p.x, p.z)
    if (t !== null && t < wall && (!best || t < best.t)) best = { id: p.id, t }
  }
  return best
}

export function lookDir(yaw: number, pitch: number): Vec3 {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) }
}

/** Verbleibende Sekunden einer Runde. */
export function timeLeft(t0: number, minutes: number, now: number): number {
  return Math.max(0, Math.round((t0 + minutes * 60_000 - now) / 1000))
}

export function winnerSeat(scores: Record<string, number>): number | null {
  const e = Object.entries(scores).sort((a, b) => b[1] - a[1])
  if (e.length === 0) return null
  if (e.length > 1 && e[0][1] === e[1][1]) return null
  return Number(e[0][0])
}
