import type { Bld } from './city'
import { layoutOf } from './interior'
import { garageDoor, houseEligible } from './house'

/** Echte Fenster: gleiche Positionen außen (Instanzen) und innen (Wandöffnungen). */
export interface WinSlot { x: number; z: number; nx: number; nz: number; rot: number }
/** Rahmen 2,5×2,0, Glas 2,0×1,5, Mitte 1,9 m über dem Geschossboden */
export const WIN = { fw: 2.5, fh: 2.0, gw: 2.0, gh: 1.5, mid: 1.9, floorCap: 8 }

export const windowsWanted = (b: Bld): boolean => !(b.lo !== undefined || b.hid || (b.col !== undefined && !b.kind) || b.kind === 'army')
export const windowFloors = (b: Bld): number => Math.max(1, Math.min(layoutOf(b).floors, WIN.floorCap, Math.floor(b.h / layoutOf(b).fh) || 1))
export const winY = (b: Bld, k: number): number => k * layoutOf(b).fh + WIN.mid

/** Fensterplätze einer Reihe (Wandebene); im Erdgeschoss bleiben Haustür und Garagentor frei */
export function windowSlots(b: Bld, ground: boolean): WinSlot[] {
  const d = layoutOf(b).door
  const gd = ground && houseEligible(b) ? garageDoor(b) : null
  const sides = [
    { nx: 0, nz: 1, len: b.w, cx: b.x, cz: b.z + b.d / 2 }, { nx: 0, nz: -1, len: b.w, cx: b.x, cz: b.z - b.d / 2 },
    { nx: 1, nz: 0, len: b.d, cx: b.x + b.w / 2, cz: b.z }, { nx: -1, nz: 0, len: b.d, cx: b.x - b.w / 2, cz: b.z },
  ]
  const out: WinSlot[] = []
  for (const sd of sides) {
    const n = Math.floor((sd.len - 3) / 5.5)
    if (n < 1) continue
    const tx = sd.nz !== 0 ? 1 : 0, tz = sd.nx !== 0 ? 1 : 0, rot = Math.atan2(sd.nx, sd.nz)
    for (let i = 0; i < n; i++) {
      const u = -sd.len / 2 + (sd.len * (i + 0.5)) / n
      const x = sd.cx + tx * u, z = sd.cz + tz * u
      if (ground && d.nx === sd.nx && d.nz === sd.nz && Math.hypot(x - d.x, z - d.z) < 3.8) continue
      if (gd && gd.nx === sd.nx && gd.nz === sd.nz && Math.hypot(x - gd.x, z - gd.z) < 4.6) continue
      out.push({ x, z, nx: sd.nx, nz: sd.nz, rot })
    }
  }
  return out
}
