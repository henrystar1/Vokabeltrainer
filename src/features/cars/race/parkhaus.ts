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
}
/** Obere Kante der Außenwand/Brüstung. */
export const PARK_TOP = PARK.floorH * PARK.floors + 1
/** Liegt (x, z) im Parkhaus-Grundriss (m = Rand, der dazugezählt wird)? */
export const inParkXZ = (x: number, z: number, m = 0): boolean => x >= PARK.x0 - m && x <= PARK.x1 + m && z >= PARK.z0 - m && z <= PARK.z1 + m

/**
 * Höhen aller befahrbaren Flächen bei (x, z), von unten nach oben: je Ebene Rampe (Spur im Westen, s = 0…ramp) bzw. Platte.
 * Ebenen: `under` Untergeschosse (−9, −4,5), das Erdgeschoss (0) und `floors` Stockwerke darüber. Die Rampen aller Ebenen liegen mit konstant
 * 4,5 m Abstand übereinander, die Platten ebenso – so ist jede Höhe eindeutig zu unterscheiden. Innerhalb des Grundrisses gibt es keinen
 * eigenen „Boden“: das Erdgeschoss ist die Platte bei 0.
 */
export function parkSurfaces(x: number, z: number): number[] {
  if (x < PARK.x0 || x > PARK.x1 || z < PARK.z0 || z > PARK.z1) return []
  const s = z - PARK.z0, out: number[] = []
  const laneA = x < PARK.x0 + PARK.laneW
  for (let k = -PARK.under; k < PARK.floors; k++) {
    if (laneA && s <= PARK.ramp) out.push(PARK.floorH * k + (PARK.floorH * s) / PARK.ramp)
    if (!laneA || s >= PARK.ramp) out.push(PARK.floorH * k)
  }
  if (!laneA || s >= PARK.ramp) out.push(PARK.floorH * PARK.floors)
  return out
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
