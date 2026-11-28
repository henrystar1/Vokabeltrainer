import { describe, expect, it } from 'vitest'
import { city } from './city'
import { windowFloors, windowSlots, windowsWanted } from './windows'

describe('Fenster', () => {
  it('Anzahl bleibt für die Grafik tragbar und liegt auf den Wänden', () => {
    let total = 0
    for (const b of city().buildings) {
      if (!windowsWanted(b)) continue
      const g = windowSlots(b, true), u = windowSlots(b, false)
      total += g.length + u.length * (windowFloors(b) - 1)
      for (const s of g.slice(0, 3)) expect(Math.max(Math.abs(s.x - b.x) - b.w / 2, Math.abs(s.z - b.z) - b.d / 2)).toBeCloseTo(0, 5)
    }
    console.log('Fenster gesamt', total)
    expect(total).toBeGreaterThan(1000)
    expect(total).toBeLessThan(120000)
  })
})
