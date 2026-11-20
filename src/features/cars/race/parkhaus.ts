/** Parkhaus aus Metall: Ebenen nach oben, Rampenspur im Westen (Zick-Zack), Einfahrt von der Südstraße. Liegt in einem eigenen Block der Stadt. */
export const PARK = {
  /** Block (Mitte) */
  cx: -180, cz: -180,
  /** Grundfläche */
  x0: -220, x1: -140, z0: -224, z1: -136,
  /** Breite der Rampenspur (Westseite) und Länge der Rampen; Höhe je Ebene */
  laneW: 26, ramp: 36, floorH: 4.5, floors: 4,
  /** Untergeschosse */
  under: 2,
  /** Spurbreiten: Rampe nach oben (Westen), Abfahrt nach unten (daneben) und Abfahrt zum 2. Untergeschoss (Osten) */
  up: 13, dn: 13, east: 13,
}
/** Mitten der Spuren (x): Rampe hinauf, Abfahrt ins 1. Untergeschoss, Abfahrt ins 2. Untergeschoss, Mittelspur. */
export const PARK_LANES = {
  up: PARK.x0 + PARK.up / 2,
  dn: PARK.x0 + PARK.up + PARK.dn / 2,
  east: PARK.x1 - PARK.east / 2,
  mid: (PARK.x0 + PARK.up + PARK.dn + PARK.x1 - PARK.east) / 2,
}
/** Tunnel-Anschluss auf Ebene −1 (Ostwand): Mitte (z) und Höhe der Ebene. */
export const PARK_TUNNEL = { z: -180, y: -PARK.floorH }
/** Offener Schacht (Rampen ohne Decke) in der Westspur: dort kann man auch fliegen. */
export const parkShaft = (x: number, z: number, m = 0): boolean => x >= PARK.x0 - m && x <= PARK.x0 + PARK.up + PARK.dn + m && z >= PARK.z0 - m && z <= PARK.z0 + PARK.ramp + 4
/** Obere Kante der Außenwand/Brüstung. */
export const PARK_TOP = PARK.floorH * PARK.floors + 1
/** Liegt (x, z) im Parkhaus-Grundriss (m = Rand, der dazugezählt wird)? */
export const inParkXZ = (x: number, z: number, m = 0): boolean => x >= PARK.x0 - m && x <= PARK.x1 + m && z >= PARK.z0 - m && z <= PARK.z1 + m

/**
 * Höhen aller befahrbaren Flächen bei (x, z), von unten nach oben.
 * Westspur (s = Abstand von der Südkante, 0…ramp): Rampe HINAUF (links, Ebenen 0…floors−1 steigen nach Norden), daneben die ABFAHRT ins
 * 1. Untergeschoss (0 → −4,5 nach Norden). Ostspur: Abfahrt ins 2. Untergeschoss (−4,5 → −9 steigt nach Norden). Sonst Platten je Ebene
 * (−9, −4,5, 0 … Dach); die Schächte der Rampen sind ohne Platte, so ist jede Höhe eindeutig.
 */
export function parkSurfaces(x: number, z: number): number[] {
  if (x < PARK.x0 || x > PARK.x1 || z < PARK.z0 || z > PARK.z1) return []
  const s = z - PARK.z0, out: number[] = []
  const up = x < PARK.x0 + PARK.up, dn = !up && x < PARK.x0 + PARK.up + PARK.dn, east = x >= PARK.x1 - PARK.east
  const onRamp = s <= PARK.ramp
  if (up && onRamp) for (let k = 0; k < PARK.floors; k++) out.push(PARK.floorH * k + (PARK.floorH * s) / PARK.ramp)
  if (dn && onRamp) out.push((-PARK.floorH * s) / PARK.ramp)
  if (east && onRamp) out.push(-2 * PARK.floorH + (PARK.floorH * s) / PARK.ramp)
  const shaft = (up || dn) && s < PARK.ramp
  for (let k = -PARK.under; k <= PARK.floors; k++) {
    if (shaft) { if (k === -PARK.under) out.push(PARK.floorH * k); continue }          // Schacht: nur der Boden ganz unten
    if (east && s < PARK.ramp && k === -1) continue                                  // Loch über der Abfahrt ins 2. Untergeschoss
    out.push(PARK.floorH * k)
  }
  return out.sort((a, b) => a - b)
}

/**
 * Wände/Brüstung des Parkhauses (0,9 m dick). Die Seite, auf der das Auto vorher war (`px`, `pz`), bleibt seine Seite – auch bei hohem Tempo
 * kommt es nicht durch die Wand und bleibt nicht darin stecken. Die Südseite ist im Erdgeschoss offen (Einfahrt), darüber und darunter Wand.
 */
export function parkPush(x: number, z: number, y: number, px = x, pz = z): { nx: number; nz: number; depth: number } | null {
  if (y > PARK_TOP + 1 || y < -PARK.floorH * PARK.under - 2) return null
  const h = 0.45
  let best: { nx: number; nz: number; depth: number } | null = null
  const take = (nx: number, nz: number, depth: number) => { if (depth > 0 && (!best || depth > best.depth)) best = { nx, nz, depth } }
  const zIn = z >= PARK.z0 - h && z <= PARK.z1 + h, xIn = x >= PARK.x0 - h && x <= PARK.x1 + h
  const wallX = (w: number) => {
    if (!zIn) return
    const side = px >= w ? 1 : -1
    take(side, 0, side > 0 ? w + h - x : x - (w - h))
  }
  const wallZ = (w: number) => {
    if (!xIn) return
    const side = pz >= w ? 1 : -1
    take(0, side, side > 0 ? w + h - z : z - (w - h))
  }
  wallX(PARK.x0); wallX(PARK.x1); wallZ(PARK.z1)
  if (y > 2.6 || y < -1) wallZ(PARK.z0)
  return best
}
