import { describe, expect, it } from 'vitest'
import { streetRoute } from './route'

const len = (r: Array<[number, number]>) => r.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) : s), 0)
describe('streetRoute', () => {
  it('geht von Start zu Ziel', () => {
    const r = streetRoute(10, 30, 300, -240)
    expect(r[0]).toEqual([10, 30]); expect(r[r.length - 1]).toEqual([300, -240])
  })
  it('Mittelstücke liegen auf Straßen (achsenparallel, auf Vielfachen von 120)', () => {
    const r = streetRoute(70, 60, -420, 300)
    for (let i = 2; i + 2 < r.length; i++) {
      const [x0, z0] = r[i], [x1, z1] = r[i + 1]
      expect(x0 === x1 || z0 === z1).toBe(true)
      expect(x0 % 120 === 0 || z0 % 120 === 0).toBe(true)
    }
  })
  it('ist nicht viel länger als Manhattan-Abstand', () => {
    const r = streetRoute(120, 0, 600, 480)
    expect(len(r)).toBeLessThan(480 + 480 + 130)
  })
  it('gleiches Straßenstück: direkt', () => {
    const r = streetRoute(120, 10, 120, 100)
    expect(len(r)).toBeLessThan(100)
  })
  it('kein Rückwärtsknick', () => {
    const r = streetRoute(125, 50, 125, -50)
    for (let i = 1; i + 1 < r.length; i++) {
      const d1 = [r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]], d2 = [r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]]
      expect(d1[0] * d2[0] + d1[1] * d2[1]).toBeGreaterThanOrEqual(-1e-6)
    }
  })
})
