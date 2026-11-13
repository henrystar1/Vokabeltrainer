import { describe, expect, it } from 'vitest'
import { fitDrawing, loopLength, resampleClosed, selfIntersects, type Pt } from './trackDraw'

const circle = (n: number, r = 100): Pt[] => Array.from({ length: n }, (_, i) => [200 + r * Math.cos((i / n) * 6.28), 150 + r * Math.sin((i / n) * 6.28)])

describe('trackDraw', () => {
  it('Kreis wird zur Strecke mit der Wunschlänge', () => {
    const f = fitDrawing(circle(60), 3000, 16)
    expect(f.error).toBeNull()
    expect(f.pts.length).toBe(56)
    expect(f.length).toBeGreaterThan(2700)
    expect(f.length).toBeLessThan(3300)
  })
  it('Acht kreuzt sich', () => {
    const eight: Pt[] = Array.from({ length: 80 }, (_, i) => { const a = (i / 80) * 6.28; return [200 + 100 * Math.sin(a), 150 + 70 * Math.sin(2 * a + 0.4)] })
    const f = fitDrawing(eight, 3000, 16)
    expect(f.error).toMatch(/kreuzt|zu eng/)
  })
  it('zu kurze oder offene Linien werden abgelehnt', () => {
    expect(fitDrawing(circle(5), 3000, 16).error).not.toBeNull()
    const line: Pt[] = Array.from({ length: 40 }, (_, i) => [i * 5, 0])
    expect(fitDrawing(line, 3000, 16).error).toMatch(/weit auseinander/)
  })
  it('Hilfsfunktionen', () => {
    expect(loopLength([[0, 0], [10, 0], [10, 10], [0, 10]])).toBeCloseTo(40)
    expect(resampleClosed([[0, 0], [10, 0], [10, 10], [0, 10]], 8).length).toBe(8)
    expect(selfIntersects([[0, 0], [10, 10], [10, 0], [0, 10]])).toBe(true)
    expect(selfIntersects([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(false)
  })
})
