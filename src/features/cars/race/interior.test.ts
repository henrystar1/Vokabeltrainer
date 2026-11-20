import { describe, it, expect } from 'vitest'
import { city } from './city'
import { buildingAt, layoutOf, interiorPush, interiorSurfaces, FLOOR_H } from './interior'

describe('Innenräume', () => {
  const bs = city().buildings.filter((b) => b.lo === undefined && b.w > 20 && b.d > 20 && b.h > 8).slice(0, 40)
  it('Tür ist von außen frei, Treppenläufe steigen stetig', () => {
    expect(bs.length).toBeGreaterThan(5)
    for (const b of bs) {
      const L = layoutOf(b)
      const d = L.door
      // 1 m vor und 1 m hinter der Tür frei
      expect(interiorPush(b, d.x - d.nx * 1.5, d.z - d.nz * 1.5, 0.1)).toBeNull()
      expect(interiorPush(b, d.x + d.nx * 0.01 - d.nx * 0.4, d.z - d.nz * 0.4, 0.1)).toBeNull()
      expect(buildingAt(d.x - d.nx * 1.5, d.z - d.nz * 1.5)).toBe(b)
      for (const f of L.flights) {
        const cx = (f.lane.x0 + f.lane.x1) / 2, cz = (f.lane.z0 + f.lane.z1) / 2
        const axisX = f.lane.x1 - f.lane.x0 > f.lane.z1 - f.lane.z0
        const at = (t: number) => { const p = f.lo + (f.dir === 1 ? t : 1 - t) * (f.hi - f.lo); return axisX ? [p, cz] : [cx, p] }
        let prev = -1
        for (let i = 0; i <= 10; i++) {
          const [x, z] = at(i / 10)
          const h = f.k * FLOOR_H + (i / 10) * FLOOR_H
          expect(interiorSurfaces(b, x, z).some((s) => Math.abs(s - h) < 0.01)).toBe(true)
          expect(interiorPush(b, x, z, h + 0.1)).toBeNull()
          expect(h).toBeGreaterThanOrEqual(prev); prev = h
        }
        // Kopffreiheit: oben Loch in der Platte
        const [x, z] = at(0.8)
        expect(interiorSurfaces(b, x, z).some((s) => Math.abs(s - (f.k + 1) * FLOOR_H) < 0.01)).toBe(false)
      }
    }
  })
})

import { newWalker, stepWalker } from './foot'
describe('Zu Fuß durchs Haus', () => {
  it('von der Straße durch die Tür ins Obergeschoss', () => {
    const b = city().buildings.find((q) => q.lo === undefined && q.w > 30 && q.d > 30 && q.h > 12)!
    const L = layoutOf(b)
    const d = L.door
    // Start 6 m vor der Tür, Blick ins Haus
    let w = newWalker(d.x + d.nx * 6, d.z + d.nz * 6, Math.atan2(-d.nx, -d.nz))
    const inp = { fwd: true, back: false, left: false, right: false, run: false }
    for (let i = 0; i < 60 * 3; i++) w = stepWalker(w, inp, 1 / 60)
    expect(buildingAt(w.x, w.z)).toBe(b)
    // Zielpunkt-Navigation über Wegpunkte: Lauf A hoch, Podest, Lauf B hoch
    const goto = (tx: number, tz: number, max = 60 * 12) => {
      for (let i = 0; i < max; i++) {
        const dx = tx - w.x, dz = tz - w.z
        if (Math.hypot(dx, dz) < 0.5) return true
        let da = Math.atan2(dx, dz) - w.h; da = Math.atan2(Math.sin(da), Math.cos(da))
        w = stepWalker(w, { fwd: Math.abs(da) < 0.6, back: false, left: da > 0.05, right: da < -0.05, run: false }, 1 / 60)
      }
      return false
    }
    for (const f of L.flights.slice(0, 2)) {
      const axisX = f.lane.x1 - f.lane.x0 > f.lane.z1 - f.lane.z0
      const cx = (f.lane.x0 + f.lane.x1) / 2, cz = (f.lane.z0 + f.lane.z1) / 2
      const at = (t: number) => { const p = f.lo + (f.dir === 1 ? t : 1 - t) * (f.hi - f.lo); return axisX ? [p, cz] : [cx, p] }
      const [sx, sz] = at(-0.15), [ex, ez] = at(1.12)
      expect(goto(sx, sz)).toBe(true)
      expect(goto(ex, ez)).toBe(true)
      expect(w.y).toBeGreaterThan((f.k + 1) * FLOOR_H - 0.3)
    }
  })
})

import { walkNav } from './interior'
describe('Wegfindung ins Haus', () => {
  it('Figur findet von der Straße über die Treppe in jedes Geschoss und wieder hinaus', () => {
    const b = city().buildings.find((q) => q.lo === undefined && q.w > 30 && q.d > 30 && q.h > 14)!
    const L = layoutOf(b)
    const top = (L.floors - 1) * FLOOR_H
    const d = L.door
    let w = newWalker(d.x + d.nx * 12, d.z + d.nz * 12, 0)
    const run = (tx: number, tz: number, ty: number, max: number) => {
      for (let i = 0; i < max; i++) {
        const n = walkNav(w, { x: tx, z: tz, y: ty })
        let da = Math.atan2(n.x - w.x, n.z - w.z) - w.h; da = Math.atan2(Math.sin(da), Math.cos(da))
        w = stepWalker(w, { fwd: Math.abs(da) < 1.3, back: false, left: da > 0.1, right: da < -0.1, run: true }, 1 / 60)
        if (Math.hypot(tx - w.x, tz - w.z) < 1.2 && Math.abs(w.y - ty) < 1) return true
      }
      return false
    }
    expect(run(b.x + 3, b.z + 3, top, 60 * 90)).toBe(true)
    expect(run(d.x + d.nx * 8, d.z + d.nz * 8, 0, 60 * 90)).toBe(true)
  })
})
