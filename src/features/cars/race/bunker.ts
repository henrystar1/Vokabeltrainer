/** KSK-Bunker: riesige unterirdische Halle vor dem mittleren Berg. Eingang = Luke im Boden, die per Tastenfeld aufgeht; Fahrstuhl führt hinunter.
 *  Die Halle liegt bei y = BUNKER.y unter dem Gelände (Ebene lvl −2); sie hat Arbeitsplätze, ein Quad-Podest, den Iron-Man-Bauarm und die Drohnen-Computer. */
export const BUNKER = {
  /** Mittelpunkt des Fahrstuhlschachts an der Oberfläche */
  ex: 90, ez: 1392,
  /** Tastenfeld an der Oberfläche */
  kx: 76, kz: 1380,
  /** Boden und Deckenhöhe der Halle */
  y: -40, ceil: 10,
  /** Halle (Weltkoordinaten) */
  x0: 50, x1: 130, z0: 1388, z1: 1468,
  /** Schachtgröße (Quadrat, halbe Kante) */
  shaft: 4,
} as const

export interface Rect { x0: number; x1: number; z0: number; z1: number }
const rc = (cx: number, cz: number, w: number, d: number): Rect => ({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 })

/** Stellplätze (Weltkoordinaten) */
export const BK = {
  /** Quad-Podest (Drehteller) */
  pad: { x: 62, z: 1420, r: 6.5 },
  /** Anpassungs-Terminal fürs Quad */
  tune: { x: 62, z: 1431 },
  /** Iron-Man-Werkstatt: Podest mit Anzug und Bauarm */
  forge: { x: 118, z: 1422 },
  /** Drohnen-Computer an der Nordwand */
  drone: { x: 90, z: 1459 },
  /** Fahrstuhl in der Halle (Boden unter dem Schacht) */
  lift: { x: BUNKER.ex, z: BUNKER.z0 + 4.5 },
  /** Strategietisch (Hologramm) in der Mitte */
  table: { x: 90, z: 1432 },
  /** Flugzeug-Terminal (Fallschirm-Einsatz) an der Nordwand rechts */
  plane: { x: 114, z: 1457 },
}

/** Feste Möbel und Geräte (Rechtecke), die man nicht durchläuft */
export const BUNKER_OBSTACLES: ReadonlyArray<Rect> = [
  rc(BK.pad.x, BK.pad.z, 13, 13),
  rc(BK.tune.x, BK.tune.z + 1.4, 4.4, 1.6),
  rc(BK.forge.x, BK.forge.z, 8, 8),
  rc(BK.table.x, BK.table.z, 9, 5),
  rc(BK.drone.x, BK.drone.z + 1.6, 22, 3.4),
  rc(BK.plane.x, BK.plane.z + 1.4, 4.4, 1.6),
  // Werkbänke und Regale an den Seitenwänden
  rc(BUNKER.x0 + 2, 1448, 2.4, 14), rc(BUNKER.x1 - 2, 1448, 2.4, 14),
  rc(BUNKER.x0 + 2, 1400, 2.4, 10), rc(BUNKER.x1 - 2, 1400, 2.4, 10),
  // Schachtwände (Fahrstuhlkäfig): nur die Rückseite, vorn ist offen
  rc(BUNKER.ex, BUNKER.z0 + 0.4, 9, 0.8),
]

const R = 0.45
/** Innerhalb der Halle halten und Möbel umlaufen (Kreis gegen Rechtecke). */
export function bunkerClamp(x: number, z: number): { x: number; z: number } {
  x = Math.max(BUNKER.x0 + R + 0.3, Math.min(BUNKER.x1 - R - 0.3, x))
  z = Math.max(BUNKER.z0 + R + 0.3, Math.min(BUNKER.z1 - R - 0.3, z))
  for (const o of BUNKER_OBSTACLES) {
    const nx = Math.max(o.x0, Math.min(o.x1, x)), nz = Math.max(o.z0, Math.min(o.z1, z))
    const dx = x - nx, dz = z - nz, d = Math.hypot(dx, dz)
    if (d < R) {
      if (d > 1e-6) { x = nx + (dx / d) * R; z = nz + (dz / d) * R } else {
        // Mittelpunkt im Rechteck: zur nächsten Kante hinaus
        const l = x - o.x0, r = o.x1 - x, t = z - o.z0, b = o.z1 - z, m = Math.min(l, r, t, b)
        if (m === l) x = o.x0 - R; else if (m === r) x = o.x1 + R; else if (m === t) z = o.z0 - R; else z = o.z1 + R
      }
    }
  }
  return { x, z }
}

export const inBunkerHall = (x: number, z: number): boolean => x >= BUNKER.x0 && x <= BUNKER.x1 && z >= BUNKER.z0 && z <= BUNKER.z1
const near = (x: number, z: number, p: { x: number; z: number }, r: number): boolean => Math.hypot(x - p.x, z - p.z) < r

export type BunkerSpotKind = 'keypad' | 'lift_down' | 'lift_up' | 'tune' | 'drone' | 'forge' | 'table' | 'plane'
export interface BunkerSpot { kind: BunkerSpotKind; label: string }
/** Welche Bedienstelle ist in Reichweite? `lvl` = Ebene der Figur (−2 = in der Halle), `open` = Luke offen. */
export function bunkerSpotNear(x: number, z: number, lvl: number, open: boolean): BunkerSpot | null {
  if (lvl === -2) {
    if (near(x, z, BK.lift, 3.6)) return { kind: 'lift_up', label: 'Fahrstuhl nach oben' }
    if (near(x, z, BK.tune, 3.4)) return { kind: 'tune', label: 'Quad anpassen' }
    if (near(x, z, BK.drone, 6)) return { kind: 'drone', label: 'Drohnen-Computer: Spieler live beobachten' }
    if (near(x, z, BK.forge, 7)) return { kind: 'forge', label: 'Iron-Man-Werkstatt' }
    if (near(x, z, BK.plane, 3.6)) return { kind: 'plane', label: 'Flugzeug: Fallschirm-Einsatz' }
    if (near(x, z, BK.table, 4.5)) return { kind: 'table', label: 'Strategietisch: KSK-Aufträge' }
    return null
  }
  if (lvl !== 0) return null
  if (near(x, z, { x: BUNKER.ex, z: BUNKER.ez }, 3.2) && open) return { kind: 'lift_down', label: 'Fahrstuhl nach unten' }
  if (near(x, z, { x: BUNKER.kx, z: BUNKER.kz }, 3)) return { kind: 'keypad', label: open ? 'Bunker-Luke schließen' : 'Bunker-Luke öffnen' }
  return null
}

/** Zeitablauf (ms) der Animationen */
export const HATCH_MS = 3200
export const LIFT_MS = 6500
/** Öffnungsgrad der Luke 0…1 (sanft) aus Fortschritt */
export const hatchK = (p: number): number => { const t = Math.max(0, Math.min(1, p)); return t * t * (3 - 2 * t) }
/** Höhe der Kabine (Weltkoordinate y) für Fortschritt 0 (oben) … 1 (unten) */
export const liftY = (p: number): number => { const t = Math.max(0, Math.min(1, p)); return BUNKER.y * (t * t * (3 - 2 * t)) }

/** Quad-Ausstattung (Server-Preise müssen zu supabase/migrations/0119 passen) */
export type KskItem = 'w_rocket' | 'turbo' | 'armor' | 'rate'
export const KSK_ITEMS: ReadonlyArray<{ id: KskItem; name: string; icon: string; price: number; desc: string }> = [
  { id: 'w_rocket', name: 'Raketenwerfer (Heck)', icon: '🚀', price: 1500, desc: 'Statt der Minigun: Lenkraketen mit großem Explosionsradius.' },
  { id: 'turbo', name: 'Quad-Turbo', icon: '⚡', price: 900, desc: 'Das Quad wird um etwa ein Viertel schneller.' },
  { id: 'armor', name: 'Spezialpanzerung', icon: '🛡️', price: 1000, desc: 'Deine KSK-Ausrüstung hält noch mehr aus.' },
  { id: 'rate', name: 'Schnellfeuer-Kit', icon: '🔥', price: 800, desc: 'Die Minigun schießt deutlich schneller.' },
]
export type QuadWeapon = 'minigun' | 'rocket'
export const QUAD_COLORS: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#3d4a32', name: 'Oliv' }, { hex: '#1f2937', name: 'Schwarz' }, { hex: '#8a7a52', name: 'Wüste' }, { hex: '#475569', name: 'Grau' },
  { hex: '#1d4ed8', name: 'Blau' }, { hex: '#b91c1c', name: 'Rot' }, { hex: '#d97706', name: 'Orange' }, { hex: '#f8fafc', name: 'Weiß' },
]
export interface KskLoadout { color: string; weapon: QuadWeapon; items: KskItem[] }
export const DEFAULT_LOADOUT: KskLoadout = { color: '#3d4a32', weapon: 'minigun', items: [] }
export const parseLoadout = (j: unknown): KskLoadout => {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>
  const items = Array.isArray(o.items) ? (o.items as unknown[]).filter((i): i is KskItem => KSK_ITEMS.some((k) => k.id === i)) : []
  const color = typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : DEFAULT_LOADOUT.color
  const weapon: QuadWeapon = o.weapon === 'rocket' && items.includes('w_rocket') ? 'rocket' : 'minigun'
  return { color, weapon, items }
}
