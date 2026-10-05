import { describe, expect, it } from 'vitest'
import { formatGap } from '../../components/charts/LevelBars'

describe('Wartezeit-Anzeige', () => {
  it('formatiert Minuten, Stunden und Tage', () => {
    expect(formatGap(0)).toBe('sofort wieder')
    expect(formatGap(30)).toBe('nach 30 Min.')
    expect(formatGap(90)).toBe('nach 1,5 Std.')
    expect(formatGap(1440)).toBe('nach 1 Tag')
    expect(formatGap(4320)).toBe('nach 3 Tagen')
  })
})
