import { describe, expect, it } from 'vitest'
import { nightness } from './daynight'

describe('Tag-Nacht', () => {
  it('wechselt alle 5 Minuten, stetig', () => {
    expect(nightness(60)).toBe(0)
    expect(nightness(400)).toBe(1)
    expect(nightness(300)).toBeCloseTo(0.5, 5)
    expect(nightness(600)).toBeCloseTo(0.5, 5)
    expect(nightness(1200 + 60)).toBe(0)
    for (let t = 0; t < 1200; t += 0.5) expect(Math.abs(nightness(t + 0.5) - nightness(t))).toBeLessThan(0.08)
  })
})
