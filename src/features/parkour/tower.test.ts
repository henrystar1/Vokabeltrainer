import { describe, expect, it } from 'vitest'
import { Builder } from './levels'
import { reachable } from './reach.test'

describe('Pad-Turm', () => {
  for (const [n, w, gap, pit] of [[1, 3, 3, false], [2, 2, 3, true], [3, 2, 3, true], [3, 1, 4, true], [4, 1, 5, true]] as const) {
    it(`n=${n} w=${w} Lücke=${gap} ist machbar`, () => {
      const g = new Builder(90).ground(0, 89).cp2(4).padTower(12, n, w, gap, pit)
      g.exit(g.towerEnd + 5)
      const lv = g.build('t', '')
      expect(lv.up.length).toBeGreaterThanOrEqual(7)
      const r = reachable(lv)
      if (!r.ok) console.log('Turm', n, w, gap, 'bleibt bei Spalte', Math.floor(r.maxX / 32))
      expect(r.ok).toBe(true)
      // ohne Pads kommt niemand hinüber: der Turm ist Pflicht
      const nopad = { ...lv, rows: lv.rows.map((x) => x.replace(/J/g, '.')), up: lv.up.map((x) => x.replace(/J/g, '.')) }
      expect(reachable(nopad).ok).toBe(false)
    }, 300000)
  }
})
