import { describe, expect, it } from 'vitest'
import { LEVELS, TILE } from './levels'
import { generateLevel } from './generator'
import { reachable } from './reach'

describe('Erreichbarkeit (Geometrie)', () => {
  LEVELS.forEach((lv, i) => {
    it(`Level ${i + 1} ist allein mit offenen Türen erreichbar`, () => {
      const r = reachable(lv)
      if (!r.ok) console.log(`Level ${i + 1} bleibt bei Spalte`, Math.floor(r.maxX / TILE))
      expect(r.ok).toBe(true)
    }, 120000)
  })
})

describe('Türen und Platten', () => {
  it('Platte vor und hinter jeder Tür liegen so nah beieinander, dass die Leine reicht', () => {
    const all = [...LEVELS, ...[8, 9, 10, 12, 15, 20, 30, 40].map((n) => generateLevel('abc', n)), ...[8, 11, 14, 25].map((n) => generateLevel('xyz', n))]
    all.forEach((lv, i) => {
      lv.rows.forEach((row, y) => {
        for (let x = 0; x < lv.cols; x++) {
          const ch = row[x]
          if (ch < 'A' || ch > 'C' || y !== 0) continue
          const c = ch.toLowerCase()
          const xs = lv.plates.filter((p) => p.ch === c).map((p) => p.x)
          const left = Math.max(...xs.filter((v) => v < x)), right = Math.min(...xs.filter((v) => v > x))
          if (Number.isFinite(left) && Number.isFinite(right)) expect(right - left, `Level ${i + 1}, Tür bei Spalte ${x}`).toBeLessThanOrEqual(16)
          expect(Number.isFinite(left), `Level ${i + 1}, Tür bei Spalte ${x}: Platte davor`).toBe(true)
          expect(Number.isFinite(right), `Level ${i + 1}, Tür bei Spalte ${x}: Platte dahinter`).toBe(true)
        }
      })
    })
  })
})
