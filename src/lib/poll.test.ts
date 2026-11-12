import { describe, expect, it } from 'vitest'
import { IDLE_SLOW_MS, IDLE_STOP_MS, shouldRun } from './poll'

describe('Hintergrund-Abfrage', () => {
  it('läuft bei aktiver Bedienung jeden Takt, nur bei sichtbarem Tab', () => {
    for (let t = 1; t <= 4; t++) expect(shouldRun(1000, t, true)).toBe(true)
    expect(shouldRun(1000, 1, false)).toBe(false)
  })
  it('läuft im Leerlauf nur jeden 4. Takt', () => {
    const r = [1, 2, 3, 4, 5, 8].map((t) => shouldRun(IDLE_SLOW_MS + 1, t, true))
    expect(r).toEqual([false, false, false, true, false, true])
  })
  it('stoppt nach langem Leerlauf ganz', () => {
    expect(shouldRun(IDLE_STOP_MS + 1, 4, true)).toBe(false)
    expect(shouldRun(IDLE_STOP_MS - 1, 4, true)).toBe(true)
  })
})
