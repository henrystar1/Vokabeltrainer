import { GARAGES, city, type Bld } from './city'
import { layoutOf } from './interior'
import { PARK } from './parkhaus'
import { poiOf } from './poi'

/** Häuser kaufen: Preis (Server-Preis in supabase/migrations/0120 muss gleich sein), Hausnummer, Möbelkatalog und Garagentor. */
export const HOUSE_PRICE = 3000
export const MAX_FURN = 80
export const MAX_GARAGE = 6

let ids: Map<Bld, number> | null = null
/** Stabile Hausnummer (Index in der Stadtliste; Stadt wird mit festem Startwert erzeugt) */
export function houseId(b: Bld): number {
  if (!ids) { ids = new Map(); city().buildings.forEach((x, i) => ids!.set(x, i)) }
  return ids.get(b) ?? -1
}
export const houseById = (id: number): Bld | null => city().buildings[id] ?? null

/** Normale Wohn-/Bürohäuser, keine Sonder- oder Garagenhäuser */
export function houseEligible(b: Bld): boolean {
  if (b.kind || b.hid || b.lo !== undefined || b.col !== undefined) return false
  if (b.w < 16 || b.d < 16 || b.h > 70) return false
  if (Math.abs(b.x - PARK.cx) < 60 && Math.abs(b.z - PARK.cz) < 60) return false
  if (GARAGES.some((g) => Math.abs(b.x - g.bx) < 60 && Math.abs(b.z - g.bz) < 60)) return false
  if (poiOf(b)) return false
  return houseId(b) >= 0
}

/** Garagentor an der Außenwand (Breite 5, Höhe 3,2), neben der Haustür auf derselben Wand */
export interface GarageDoor { x: number; z: number; nx: number; nz: number; /** Tangente (entlang der Wand) */ tx: number; tz: number; w: number; h: number }
export function garageDoor(b: Bld): GarageDoor {
  const d = layoutOf(b).door, tx = -d.nz, tz = d.nx
  const len = d.nz !== 0 ? b.w : b.d
  const ct = b.x * tx + b.z * tz, td = d.x * tx + d.z * tz // Tangentenkoordinate: Wandmitte und Haustür
  const lim = len / 2 - 3.4 // das Tor (5 m breit + Rahmen) muss ganz auf die Wand passen
  const pref = b.c % 2 ? 1 : -1
  for (const off of [9 * pref, -9 * pref, 7.5 * pref, -7.5 * pref, 6.5 * pref, -6.5 * pref]) {
    const t = td + off
    if (Math.abs(t - ct) <= lim) return { x: d.x + tx * off, z: d.z + tz * off, nx: d.nx, nz: d.nz, tx, tz, w: 5, h: 3.2 }
  }
  // Wand zu kurz: Tor mittig an der Rückseite
  const back = { nx: -d.nx, nz: -d.nz }
  const px = b.x + back.nx * (b.w / 2), pz = b.z + back.nz * (b.d / 2)
  return { x: d.nx !== 0 ? px : b.x, z: d.nz !== 0 ? pz : b.z, nx: back.nx, nz: back.nz, tx: -back.nz, tz: back.nx, w: 5, h: 3.2 }
}
/** Punkt 4 m vor dem Tor (Wagen rollt hier ein und wieder heraus) */
export const garageOut = (g: GarageDoor, dist = 4): { x: number; z: number } => ({ x: g.x + g.nx * dist, z: g.z + g.nz * dist })

export interface FurnDef { id: string; name: string; icon: string; w: number; d: number; h: number; color: number }
export const FURNITURE: ReadonlyArray<FurnDef> = [
  { id: 'bed', name: 'Bett', icon: '🛏️', w: 2, d: 1.5, h: 0.6, color: 0x93c5fd },
  { id: 'sofa', name: 'Sofa', icon: '🛋️', w: 2.2, d: 0.9, h: 0.8, color: 0xb45309 },
  { id: 'table', name: 'Tisch', icon: '🍽️', w: 1.6, d: 0.9, h: 0.75, color: 0x92400e },
  { id: 'chair', name: 'Stuhl', icon: '🪑', w: 0.5, d: 0.5, h: 0.9, color: 0x78350f },
  { id: 'shelf', name: 'Regal', icon: '📚', w: 1.6, d: 0.4, h: 2, color: 0x7c2d12 },
  { id: 'tv', name: 'Fernseher', icon: '📺', w: 1.2, d: 0.35, h: 0.8, color: 0x111827 },
  { id: 'fridge', name: 'Kühlschrank', icon: '🧊', w: 0.7, d: 0.7, h: 1.8, color: 0xe5e7eb },
  { id: 'plant', name: 'Pflanze', icon: '🪴', w: 0.5, d: 0.5, h: 1.1, color: 0x15803d },
  { id: 'rug', name: 'Teppich', icon: '🟥', w: 2.4, d: 1.6, h: 0.04, color: 0xb91c1c },
  { id: 'lamp', name: 'Stehlampe', icon: '💡', w: 0.4, d: 0.4, h: 1.7, color: 0xfde68a },
]
export interface Furn { k: string; /** Abstand zur Hausmitte (m) */ x: number; z: number; /** gedreht um 90° */ r: 0 | 1 }
export const furnDef = (id: string): FurnDef | undefined => FURNITURE.find((f) => f.id === id)
export function sanitizeFurn(j: unknown, b: Bld): Furn[] {
  if (!Array.isArray(j)) return []
  const out: Furn[] = []
  for (const o of j as Array<Record<string, unknown>>) {
    if (!o || typeof o.k !== 'string' || !furnDef(o.k) || typeof o.x !== 'number' || typeof o.z !== 'number') continue
    out.push({ k: o.k, x: Math.max(-b.w / 2 + 0.5, Math.min(b.w / 2 - 0.5, o.x)), z: Math.max(-b.d / 2 + 0.5, Math.min(b.d / 2 - 0.5, o.z)), r: o.r === 1 ? 1 : 0 })
    if (out.length >= MAX_FURN) break
  }
  return out
}
export interface StoredCar { kind: string; color: string }
export function sanitizeGarage(j: unknown): StoredCar[] {
  if (!Array.isArray(j)) return []
  return (j as Array<Record<string, unknown>>).filter((o) => o && typeof o.kind === 'string' && typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color)).slice(0, MAX_GARAGE).map((o) => ({ kind: o.kind as string, color: o.color as string }))
}
/** Wandfarben (Außen und Innen); null = Original mit Fenstertextur */
export const WALL_COLORS: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#f1ead8', name: 'Creme' }, { hex: '#ffffff', name: 'Weiß' }, { hex: '#e5c07b', name: 'Sand' }, { hex: '#c2410c', name: 'Ziegelrot' },
  { hex: '#93c5fd', name: 'Himmelblau' }, { hex: '#86efac', name: 'Mintgrün' }, { hex: '#fca5a5', name: 'Rosé' }, { hex: '#a8a29e', name: 'Betongrau' },
  { hex: '#1f2937', name: 'Anthrazit' }, { hex: '#fde047', name: 'Gelb' },
]
export const sanitizeWall = (j: unknown): string | null => (typeof j === 'string' && /^#[0-9a-fA-F]{6}$/.test(j) ? j : null)
/** Wandfarben der gekauften Häuser (Hausnummer → Farbe), vom Spiel gepflegt und vom Innenraum gelesen */
export const wallColors = new Map<number, string>()
export interface HouseData { bld: number; furn: Furn[]; garage: StoredCar[]; wall: string | null }
export function parseHouses(j: unknown): HouseData[] {
  if (!Array.isArray(j)) return []
  const out: HouseData[] = []
  for (const o of j as Array<Record<string, unknown>>) {
    const bld = Number(o?.bld), b = Number.isInteger(bld) ? houseById(bld) : null
    if (b) out.push({ bld, furn: sanitizeFurn(o.furniture, b), garage: sanitizeGarage(o.garage), wall: sanitizeWall(o.wall) })
  }
  return out
}

/** Überwachungskamera an einer Hauswand (Position, Blickrichtung nach außen) */
export interface WallCam { id: number; x: number; y: number; z: number; /** Blickrichtung (Gierwinkel) */ yaw: number }
let cams: WallCam[] | null = null
/** An (fast) jedem Haus hängt eine Kamera an der Eingangswand, in der Ecke */
export function wallCams(): WallCam[] {
  if (cams) return cams
  cams = []
  city().buildings.forEach((b, i) => {
    if (b.hid || b.lo !== undefined || b.w < 12 || b.d < 12) return
    const d = layoutOf(b).door, tx = -d.nz, tz = d.nx
    const len = d.nz !== 0 ? b.w : b.d
    const ct = b.x * tx + b.z * tz, td = d.x * tx + d.z * tz
    // Ecke der Eingangswand (Abstand von der Wandmitte), weit genug von der Tür; immer auf der Wand
    let t = ct + (len / 2 - 1.2) * (i % 2 ? 1 : -1)
    if (Math.abs(t - td) < 2.8) t = ct - (len / 2 - 1.2) * (i % 2 ? 1 : -1)
    t = Math.max(ct - len / 2 + 1, Math.min(ct + len / 2 - 1, t))
    const off = t - td
    cams!.push({ id: i, x: d.x + tx * off + d.nx * 0.5, y: Math.min(b.h - 1, 4.6), z: d.z + tz * off + d.nz * 0.5, yaw: Math.atan2(d.nx, d.nz) })
  })
  return cams
}
