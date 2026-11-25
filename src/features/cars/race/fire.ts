import { city, type Bld } from './city'

/** Brände: alle 4 Minuten brennt ein Haus. Der Plan hängt nur von der Uhrzeit ab – alle Spieler sehen dasselbe Feuer, ohne Nachrichten. */
export const FIRE_SLOT_MS = 240_000
/** Ein Feuer, das niemand löscht, brennt nach dieser Zeit aus (nur noch Rauch). */
export const FIRE_BURN_MS = 150_000
export interface FireInfo { slot: number; b: Bld; startMs: number; endMs: number }

const hash = (n: number, k = 0) => { const s = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s) }

let eligibleCache: Bld[] | null = null
/** Gewöhnliche Wohn-/Bürohäuser (keine Sonderhäuser, Garagen, Zäune). */
export function burnable(): Bld[] {
  if (eligibleCache) return eligibleCache
  eligibleCache = city().buildings.filter((b) => !b.kind && !b.hid && b.lo === undefined && b.h >= 8 && b.w >= 14 && b.d >= 14 && Math.abs(b.x) < 600 && Math.abs(b.z) < 600)
  return eligibleCache
}

/** Der Brand dieses Zeitfensters (Haus und Startzeit sind für alle gleich). */
export function fireOfSlot(slot: number, list: Bld[] = burnable()): FireInfo | null {
  if (!list.length) return null
  const startMs = slot * FIRE_SLOT_MS + Math.floor(20_000 + hash(slot, 1) * 60_000)
  return { slot, b: list[Math.floor(hash(slot, 2) * list.length) % list.length], startMs, endMs: startMs + FIRE_BURN_MS }
}

/** Brennt gerade etwas (Zeitfenster der aktuellen Uhrzeit)? */
export function currentFire(nowMs: number, list?: Bld[]): FireInfo | null {
  const f = fireOfSlot(Math.floor(nowMs / FIRE_SLOT_MS), list)
  return f && nowMs >= f.startMs && nowMs < f.endMs ? f : null
}

/** Flammenstärke 0…1: wächst in den ersten 30 s, sinkt mit der Löschung (hp 0…100) und beim Ausbrennen. */
export function flameLevel(f: FireInfo, nowMs: number, hp: number): number {
  const grow = Math.min(1, (nowMs - f.startMs) / 30_000)
  const burnOut = Math.max(0, Math.min(1, (f.endMs - nowMs) / 25_000))
  return Math.max(0, Math.min(1, hp / 100)) * grow * burnOut
}

/** Wasser auf ein Feuer: Entfernung zum Hauszentrum, Wirkung nimmt mit dem Abstand ab. Liefert den neuen hp-Wert. */
export function douse(hp: number, dist: number, reach: number, power: number): number {
  if (dist > reach) return hp
  return Math.max(0, hp - power * (1 - 0.5 * dist / reach))
}

/** Stelle vor dem Haus (auf der Straße), wo der Löschzug halten soll: 18 m von der nächsten Hauswand, in Richtung Straßenmitte. */
export function parkSpot(b: Bld, fromX: number, fromZ: number): { x: number; z: number } {
  const dx = fromX - b.x, dz = fromZ - b.z
  const ax = Math.abs(dx) / (b.w / 2 + 18), az = Math.abs(dz) / (b.d / 2 + 18)
  return ax > az ? { x: b.x + Math.sign(dx || 1) * (b.w / 2 + 18), z: b.z + Math.max(-b.d / 2, Math.min(b.d / 2, dz)) } : { x: b.x + Math.max(-b.w / 2, Math.min(b.w / 2, dx)), z: b.z + Math.sign(dz || 1) * (b.d / 2 + 18) }
}
