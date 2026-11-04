import { describe, expect, it } from 'vitest'
import { Builder } from './levels'
import { reachable } from './reach'

describe('Pad-Turm', () => {
  for (const [n, w, gap, pit] of [[1, 3, 3, false], [3, 2, 3, true], [4, 1, 5, true]] as const) {
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

describe('Pad-Turm: jedes Pad ist nötig', () => {
  it('ohne das Pad der zweiten Etappe (über dem Bildrand) kommt man nicht hoch genug', () => {
    const g = new Builder(60).ground(0, 59).cp2(4).padTower(12, 2, 2, 3, false)
    g.exit(g.towerEnd + 5)
    const lv = g.build('t', '')
    // nur die Pads über Zeile 0 entfernen: Pad 1 (Zeile 2) und das Bodenpad bleiben
    const noUp = { ...lv, up: lv.up.map((x) => x.replace(/J/g, '.')) }
    expect(lv.up.some((r) => r.includes('J'))).toBe(true)
    expect(reachable(lv).ok).toBe(true)
    expect(reachable(noUp).ok).toBe(false)
  }, 300000)
})

describe('Pad-Turm: 3 bis 9 Etagen', () => {
  for (let floors = 3; floors <= 9; floors++) {
    it(`${floors} Etagen: Aufbau stimmt`, () => {
      const g = new Builder(120).ground(0, 119).cp2(4).padTower(30, 2, 2, 3, true, floors)
      g.exit(g.towerEnd + 5)
      const lv = g.build('t', '')
      const all = [...lv.up, ...lv.rows]
      // Pads: eins am Boden und je eines am Ende jeder Etage außer der letzten
      const pads = all.join('').split('J').length - 1
      expect(pads).toBe(floors)
      expect(lv.up.length).toBeGreaterThanOrEqual(3 * (floors - 1) + 3)
      expect(lv.skips).toHaveLength(1)
      const sk = lv.skips[0]
      // Weg der Bots endet hinter der Mauer rechts vom Start
      expect(sk.to).toBeGreaterThan(sk.from)
      expect(sk.path.length).toBeGreaterThan(floors * 2)
      // die Plattformen der obersten Etage liegen in der richtigen Zeile
      const top = lv.up[lv.up.length - 1]
      expect(top.includes('#')).toBe(true)
      // nach dem Turm geht der Boden weiter und der Ausgang steht
      expect(lv.rows[10][g.towerEnd + 2]).toBe('#')
    })
  }
  for (const floors of [4, 5]) {
    it(`${floors} Etagen sind machbar und ohne Pads nicht`, () => {
      const g = new Builder(110).ground(0, 109).cp2(4).padTower(26, 1, 3, 3, true, floors)
      g.exit(g.towerEnd + 5)
      const lv = g.build('t', '')
      expect(reachable(lv).ok).toBe(true)
      const nopad = { ...lv, rows: lv.rows.map((x) => x.replace(/J/g, '.')), up: lv.up.map((x) => x.replace(/J/g, '.')) }
      expect(reachable(nopad).ok).toBe(false)
    }, 600000)
  }
})
