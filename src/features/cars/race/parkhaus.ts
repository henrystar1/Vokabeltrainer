/** Parkhaus aus Metall: Ebenen nach oben, Rampenspur im Westen (Zick-Zack), Einfahrt von der Südstraße. Liegt in einem eigenen Block der Stadt. */
export const PARK = {
  /** Block (Mitte) */
  cx: -180, cz: -180,
  /** Grundfläche */
  x0: -220, x1: -140, z0: -224, z1: -136,
  /** Breite der Rampenspur (Westseite) und Länge der Rampen; Höhe je Ebene */
  laneW: 26, ramp: 36, floorH: 4.5, floors: 4,
}
/** Obere Kante der Außenwand/Brüstung. */
export const PARK_TOP = PARK.floorH * PARK.floors + 1
/** Liegt (x, z) im Parkhaus-Grundriss (m = Rand, der dazugezählt wird)? */
export const inParkXZ = (x: number, z: number, m = 0): boolean => x >= PARK.x0 - m && x <= PARK.x1 + m && z >= PARK.z0 - m && z <= PARK.z1 + m

/**
 * Höhen aller befahrbaren Flächen bei (x, z), von unten nach oben: Boden, dann je Ebene Rampe (Spur im Westen, s = 0…ramp) bzw. Platte.
 * Die Rampen aller Ebenen liegen mit konstant 4,5 m Abstand übereinander, die Platten ebenso – so ist jede Höhe eindeutig zu unterscheiden.
 */
export function parkSurfaces(x: number, z: number): number[] {
  if (x < PARK.x0 || x > PARK.x1 || z < PARK.z0 || z > PARK.z1) return []
  const s = z - PARK.z0, out: number[] = []
  const laneA = x < PARK.x0 + PARK.laneW
  for (let k = 0; k < PARK.floors; k++) {
    if (laneA && s <= PARK.ramp) out.push(PARK.floorH * k + (PARK.floorH * s) / PARK.ramp)
    if (k >= 1 && (!laneA || s >= PARK.ramp)) out.push(PARK.floorH * k)
  }
  if (!laneA || s >= PARK.ramp) out.push(PARK.floorH * PARK.floors)
  // oberste Platte (Ebene 4) auch auf der Rampenspur ab s = ramp ist oben schon enthalten; Rampe 3 endet auf Ebene 4
  return out
}

/** Wände/Brüstung des Parkhauses (dünne Streifen). Die Südseite ist unten offen (Einfahrt), oben Brüstung. */
export function parkPush(x: number, z: number, y: number): { nx: number; nz: number; depth: number } | null {
  if (y > PARK_TOP + 1) return null
  const t = 0.9
  const inX = x >= PARK.x0 - t && x <= PARK.x1 + t, inZ = z >= PARK.z0 - t && z <= PARK.z1 + t
  if (!inX || !inZ) return null
  if (Math.abs(x - PARK.x0) < t && z <= PARK.z1 + t) return { nx: x >= PARK.x0 ? 1 : -1, nz: 0, depth: t - Math.abs(x - PARK.x0) }
  if (Math.abs(x - PARK.x1) < t) return { nx: x >= PARK.x1 ? 1 : -1, nz: 0, depth: t - Math.abs(x - PARK.x1) }
  if (Math.abs(z - PARK.z1) < t) return { nx: 0, nz: z >= PARK.z1 ? 1 : -1, depth: t - Math.abs(z - PARK.z1) }
  if (Math.abs(z - PARK.z0) < t && y > 2.6) return { nx: 0, nz: z >= PARK.z0 ? 1 : -1, depth: t - Math.abs(z - PARK.z0) }
  return null
}
