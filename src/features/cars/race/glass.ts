/** Kaputte Scheiben der Bank: durch diese Lücken kommt man zu Fuß hindurch (Erdgeschoss y < 8, Obergeschoss darüber). */
interface Hole { x: number; z: number; row: 0 | 1; hw: number; alongX: boolean }
const holes: Hole[] = []
export const addGlassHole = (x: number, z: number, y: number, hw: number, alongX: boolean): void => { holes.push({ x, z, row: y < 8 ? 0 : 1, hw, alongX }) }
export const clearGlassHoles = (): void => { holes.length = 0 }
/** Steht der Punkt (Füße auf Höhe y) in einer kaputten Scheibe? */
export function inGlassHole(x: number, z: number, y: number): boolean {
  const row = y < 8.1 ? 0 : 1
  for (const h of holes) {
    if (h.row !== row) continue
    if (h.alongX ? Math.abs(x - h.x) < h.hw && Math.abs(z - h.z) < 1.6 : Math.abs(z - h.z) < h.hw && Math.abs(x - h.x) < 1.6) return true
  }
  return false
}
