import { describe, expect, it } from 'vitest'
import { downsample, plot } from './chart'

describe('Börsen-Diagramm', () => {
  const pts = Array.from({ length: 1000 }, (_, i) => ({ t: i * 3600, p: 100 + i }))
  it('reduziert Punkte und behält Anfang und Ende', () => {
    const d = downsample(pts, 100)
    expect(d).toHaveLength(100)
    expect(d[0]).toBe(pts[0])
    expect(d[99]).toBe(pts[999])
    expect(downsample(pts.slice(0, 5), 100)).toHaveLength(5)
  })
  it('rechnet in SVG-Koordinaten um', () => {
    const p = plot([{ t: 0, p: 100 }, { t: 10, p: 150 }, { t: 20, p: 200 }], 200, 100, 10)!
    expect(p.min).toBe(100)
    expect(p.max).toBe(200)
    expect(p.changePct).toBeCloseTo(100)
    expect(p.y(200)).toBeLessThan(p.y(100))
    expect(p.path.startsWith('M10.0 90.0')).toBe(true)
  })
  it('braucht mindestens zwei Punkte, flache Linie bricht nicht', () => {
    expect(plot([{ t: 0, p: 5 }], 100, 50)).toBeNull()
    const flat = plot([{ t: 0, p: 5 }, { t: 1, p: 5 }], 100, 50)!
    expect(Number.isFinite(flat.y(5))).toBe(true)
  })
})
