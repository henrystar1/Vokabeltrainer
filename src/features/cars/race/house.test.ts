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
    for (const b of homes.slice(0, 40)) {
      const g = garageDoor(b)
      expect(Math.abs(g.x - b.x)).toBeLessThanOrEqual(b.w / 2 + 0.01)
      expect(Math.abs(g.z - b.z)).toBeLessThanOrEqual(b.d / 2 + 0.01)
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
  })
})
