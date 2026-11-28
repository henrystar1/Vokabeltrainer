import { describe, expect, it } from 'vitest'
import { city } from './city'
import { garageDoor, houseEligible, houseId, parseHouses, sanitizeFurn, FURNITURE } from './house'

describe('Häuser', () => {
  const homes = city().buildings.filter(houseEligible)
  it('es gibt kaufbare Häuser mit stabiler Nummer', () => {
    expect(homes.length).toBeGreaterThan(20)
    expect(houseId(homes[0])).toBeGreaterThanOrEqual(0)
  })
  it('Garagentor liegt auf der Außenwand und bleibt im Haus', () => {
    for (const b of homes) {
      const g = garageDoor(b)
      // Tor (5 m breit) liegt ganz auf einer Außenwand
      const along = g.tx !== 0 ? [g.x - b.x, b.w] : [g.z - b.z, b.d]
      expect(Math.abs(along[0]) + 2.5).toBeLessThanOrEqual(along[1] / 2 + 0.01)
      const across = g.nx !== 0 ? [g.x - b.x, b.w] : [g.z - b.z, b.d]
      expect(Math.abs(Math.abs(across[0]) - across[1] / 2)).toBeLessThan(0.6)
    }
  })
  it('Möbel werden bereinigt', () => {
    const b = homes[0]
    const f = sanitizeFurn([{ k: 'bed', x: 999, z: -999, r: 1 }, { k: 'ufo', x: 0, z: 0 }, { k: FURNITURE[1].id, x: 1, z: 1, r: 0 }], b)
    expect(f).toHaveLength(2)
    expect(f[0].x).toBeLessThan(b.w / 2)
    expect(parseHouses([{ bld: houseId(b), furniture: [], garage: [{ kind: 'sport', color: '#112233' }, { kind: 1, color: 'x' }] }])[0].garage).toHaveLength(1)
  })
})

describe('Wandkameras', () => {
  it('gibt es an vielen Häusern, außerhalb der Wand', async () => {
    const { wallCams } = await import('./house')
    const cams = wallCams()
    expect(cams.length).toBeGreaterThan(50)
    expect(cams.every((c) => Number.isFinite(c.x + c.y + c.z + c.yaw))).toBe(true)
    // jede Kamera hängt direkt an der Wand ihres Hauses, nicht in der Luft
    for (const c of cams) { const b = city().buildings[c.id]; const dx = Math.abs(c.x - b.x) - b.w / 2, dz = Math.abs(c.z - b.z) - b.d / 2; expect(Math.max(dx, dz)).toBeLessThan(0.9); expect(Math.max(dx, dz)).toBeGreaterThan(-0.1); expect(Math.min(dx, dz)).toBeLessThan(0) }
  })
})

import { furnRects as _furnRects } from './house'
describe('furnRects', () => {
  it('Teppich ohne Kollision, Rest mit passenden Maßen', () => {
    const r = _furnRects({ x: 100, z: 50 }, [{ k: 'rug', x: 0, z: 0, r: 0 }, { k: 'bed', x: 2, z: 1, r: 1 }])
    expect(r).toHaveLength(1)
    expect(r[0].x1 - r[0].x0).toBeCloseTo(1.5); expect(r[0].z1 - r[0].z0).toBeCloseTo(2)
  })
})
