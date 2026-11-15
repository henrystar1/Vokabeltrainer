/** Stunt-Park: Looping (Wendel, Auffahrt ab 100 km/h), Rampen, Hügel und Sprünge auf einer offenen Asphaltfläche. */
export interface Ramp { x: number; z: number; /** Richtung (rad, 0 = +z) */ h: number; len: number; wid: number; h0: number; h1: number }

export const G = 9.8
export const STUNT = {
  half: 300,
  /** Looping: Radius, seitlicher Versatz auf einem Umlauf, kleinste Einfahrgeschwindigkeit (m/s) */
  R: 12, lat: 6, vmin: 28,
  loop: { x: -150, z: -100, h: 0 },
}

const hill = (x: number, z: number, h: number): Ramp[] => [
  { x, z, h: 0, len: 20, wid: 10, h0: 0, h1: h },
  { x, z: z + 20, h: 0, len: 20, wid: 10, h0: h, h1: 0 },
]
export const RAMPS: Ramp[] = [
  // Sprung über eine Lücke
  { x: -40, z: -220, h: 0, len: 30, wid: 10, h0: 0, h1: 6 },
  { x: -40, z: -120, h: 0, len: 40, wid: 12, h0: 6, h1: 0 },
  // drei Hügel
  ...hill(60, -200, 3), ...hill(60, -100, 4.5), ...hill(60, 0, 6),
  // große Schanze mit weiter Landerampe
  { x: 150, z: -200, h: 0, len: 40, wid: 12, h0: 0, h1: 9 },
  { x: 150, z: -30, h: 0, len: 60, wid: 14, h0: 9, h1: 0 },
]

/** Höhe des Bodens (Rampen) bei (x,z); 0 auf der Fläche. */
export function groundH(x: number, z: number): number {
  let best = 0
  for (const r of RAMPS) {
    const dx = x - r.x, dz = z - r.z
    const u = dx * Math.sin(r.h) + dz * Math.cos(r.h), w = dx * Math.cos(r.h) - dz * Math.sin(r.h)
    if (u >= 0 && u <= r.len && Math.abs(w) <= r.wid / 2) best = Math.max(best, r.h0 + ((r.h1 - r.h0) * u) / r.len)
  }
  return best
}

/** Punkt der Looping-Wendel bei Winkel th (0…2π): Ort, Höhe. lat0 = seitliche Lage des Autos beim Einfahren. */
export function loopPoint(L: { x: number; z: number; h: number }, th: number, lat0 = 0): { x: number; z: number; y: number } {
  const s = STUNT.R * Math.sin(th), y = STUNT.R * (1 - Math.cos(th)), lat = lat0 + (STUNT.lat * th) / (Math.PI * 2)
  return { x: L.x + Math.sin(L.h) * s + Math.cos(L.h) * lat, z: L.z + Math.cos(L.h) * s - Math.sin(L.h) * lat, y }
}

/** Außerhalb der Fläche? Gibt die Richtung nach innen und die Tiefe zurück. */
export function arenaPush(x: number, z: number): { nx: number; nz: number; depth: number } | null {
  const H = STUNT.half
  if (Math.abs(x) <= H && Math.abs(z) <= H) return null
  if (Math.abs(x) - H > Math.abs(z) - H) return { nx: -Math.sign(x), nz: 0, depth: Math.abs(x) - H }
  return { nx: 0, nz: -Math.sign(z), depth: Math.abs(z) - H }
}
