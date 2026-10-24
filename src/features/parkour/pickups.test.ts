import { describe, expect, it } from 'vitest'
import { levelFor } from './generator'
import { PH, newBody, stepBody } from './engine'
import { pickupsFor } from './pickups'
import { TILE } from './levels'

describe('Boden-Upgrades', () => {
  it('liegen in jedem Level auf freiem Boden, sind für alle gleich und nicht zu dicht', () => {
    for (let n = 0; n < 14; n++) {
      const lv = levelFor('seed', n)
      const a = pickupsFor(lv, 'run-1')
      const b = pickupsFor(lv, 'run-1')
      expect(a, `Level ${n + 1}`).toEqual(b)
      expect(a.length, `Level ${n + 1} hat Upgrades`).toBeGreaterThan(0)
      for (const p of a) {
        expect(lv.rows[10][p.col]).toBe('#')
        for (let y = 5; y <= 9; y++) expect(lv.rows[y][p.col]).toBe('.')
      }
      for (let i = 1; i < a.length; i++) expect(a[i].col - a[i - 1].col).toBeGreaterThanOrEqual(20)
    }
  })
  it('Jetpack trägt höher als der Doppelsprung, 3er-Sprung springt höher als ein Doppelsprung', () => {
    const lv = levelFor('seed', 0)
    const rise = (airJumps: number, jet: boolean) => {
      const b = newBody(3 * TILE, 10 * TILE - PH - 0.5)
      for (let k = 0; k < 12; k++) stepBody(b, { move: 0, jump: false, airJumps }, lv, {}, null, 1 / 60)
      const base = b.y
      let minY = b.y
      for (let k = 0; k < 240; k++) {
        const press = jet ? true : (k < 16) || (k >= 18 && k < 33) || (k >= 35 && k < 51)
        stepBody(b, { move: 0, jump: press, airJumps, jet: jet && !b.ground }, lv, {}, null, 1 / 60)
        if (b.y < minY) minY = b.y
      }
      return base - minY
    }
    const dbl = rise(1, false), tri = rise(2, false), jet = rise(1, true)
    expect(tri).toBeGreaterThan(dbl)
    expect(jet).toBeGreaterThan(dbl)
  })
})
