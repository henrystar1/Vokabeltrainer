import type { Bld } from './city'

/** Fassadendetails für die Stadthäuser (ein gemeinsames Mesh): Dachrand, Gesims, Sockel, Dachaufbauten (Klimageräte, Treppenhaus, Wassertank, Antenne), Vordach über der Tür. */
export interface Door { x: number; z: number; nx: number; nz: number }
export interface Geo { pos: number[]; nor: number[]; col: number[]; idx: number[] }

const hash = (b: Bld, k: number) => { const s = Math.sin(b.x * 12.9898 + b.z * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s) }
const AWNING = [0xdc2626, 0x15803d, 0x1d4ed8, 0xd97706, 0x7c3aed]

export function addBox(g: Geo, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number, k = 1): void {
  const r = ((color >> 16) & 255) / 255 * k, gg = ((color >> 8) & 255) / 255 * k, bb = (color & 255) / 255 * k
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2
  const faces: Array<[number[][], number[]]> = [
    [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]], [[[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]],
    [[[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]], [[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]],
    [[[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]],
  ]
  for (const [pts, n] of faces) {
    const o = g.pos.length / 3
    for (const p of pts) { g.pos.push(...p); g.nor.push(...n); g.col.push(r, gg, bb) }
    g.idx.push(o, o + 1, o + 2, o, o + 2, o + 3)
  }
}

export function facadeFor(b: Bld, door: Door | null, g: Geo, k = 1): void {
  const { x, z, w, d, h } = b
  const roof = h
  // Sockel (dunkles Band am Boden) und Gesims unter dem Dach, Dachrand
  const bandCol = b.kind === 'police' ? 0x93c5fd : b.kind === 'hospital' ? 0xfca5a5 : b.kind === 'fire' ? 0xfde68a : 0xe5e7eb, plinthCol = 0x57534e, parapet = 0xd6d3d1
  for (const sz of [-1, 1]) {
    addBox(g, x, 0.6, z + sz * (d / 2 + 0.08), w + 0.3, 1.2, 0.25, plinthCol, k)
    addBox(g, x, roof - 0.5, z + sz * (d / 2 + 0.12), w + 0.5, 0.7, 0.35, bandCol, k)
    addBox(g, x, roof + 0.45, z + sz * (d / 2 - 0.15), w + 0.1, 0.9, 0.3, parapet, k)
  }
  for (const sx of [-1, 1]) {
    addBox(g, x + sx * (w / 2 + 0.08), 0.6, z, 0.25, 1.2, d + 0.3, plinthCol, k)
    addBox(g, x + sx * (w / 2 + 0.12), roof - 0.5, z, 0.35, 0.7, d + 0.5, bandCol, k)
    addBox(g, x + sx * (w / 2 - 0.15), roof + 0.45, z, 0.3, 0.9, d - 0.1, parapet, k)
  }
  // Dachaufbauten (nach Hash verteilt)
  const ux = (i: number) => x + (hash(b, i) - 0.5) * (w - 8), uz = (i: number) => z + (hash(b, i + 50) - 0.5) * (d - 8)
  addBox(g, ux(1), roof + 1.2, uz(1), 3.4, 2.0, 3.0, 0x9ca3af, k)               // Klimagerät
  addBox(g, ux(2), roof + 1.8, uz(2), 4.2, 3.2, 4.2, 0xa8a29e, k)               // Treppenhaus
  addBox(g, ux(2), roof + 3.5, uz(2), 4.6, 0.3, 4.6, 0x78716c, k)
  if (hash(b, 3) > 0.45) { addBox(g, ux(3), roof + 2.3, uz(3), 2.2, 3.4, 2.2, 0x92400e, k); addBox(g, ux(3), roof + 4.2, uz(3), 2.6, 0.4, 2.6, 0x57534e, k) } // Wassertank
  if (hash(b, 4) > 0.5) addBox(g, ux(4), roof + 3.2, uz(4), 0.18, 5.4, 0.18, 0x374151, k) // Antenne
  // Vordach über der Tür
  if (door) {
    const c = AWNING[Math.floor(hash(b, 5) * AWNING.length)]
    const px = door.x + door.nx * 0.9, pz = door.z + door.nz * 0.9
    const alongX = door.nz !== 0
    addBox(g, px, 3.55, pz, alongX ? 4.4 : 1.8, 0.35, alongX ? 1.8 : 4.4, c, k)
    addBox(g, px, 3.2, pz, alongX ? 4.4 : 0.12, 0.5, alongX ? 0.12 : 4.4, c, k * 0.8)
  }
}

/** Geeignete Häuser: keine Zäune/Garagen/versteckten Sondermodelle und keine Bank/Kaserne (haben eigenen Schmuck). */
export const wantsFacade = (b: Bld): boolean => !b.hid && b.lo === undefined && !(b.col !== undefined && !b.kind) && b.kind !== 'army' && b.kind !== 'bank'
