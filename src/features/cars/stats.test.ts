import { describe, expect, it } from 'vitest'
import { CAR_KINDS } from './CarArt'
import { KIND_STATS, carKmh, kindStats } from './stats'

describe('Auto-Werte', () => {
  it('jede Art hat Werte', () => { for (const k of CAR_KINDS) expect(KIND_STATS[k], k).toBeDefined() })
  it('Rennwagen am schnellsten (außer dem Admin-Supercar), Oldtimer am langsamsten', () => {
    const s = CAR_KINDS.filter((k) => k !== 'supercar').map((k) => kindStats(k).kmh)
    expect(kindStats('rennwagen').kmh).toBe(Math.max(...s))
    expect(kindStats('oldtimer').kmh).toBe(Math.min(...s))
  })
  it('carKmh nimmt den eigenen Wert, sonst den der Art', () => {
    expect(carKmh('suv', 199)).toBe(199)
    expect(carKmh('suv', null)).toBe(170)
    expect(carKmh('unbekannt')).toBe(150)
  })
})
