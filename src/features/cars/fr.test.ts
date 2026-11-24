import { describe, expect, it } from 'vitest'
import { translate, FR, PATTERNS } from './fr'

describe('fr', () => {
  it('Wörterbuch und Muster', () => {
    expect(translate('Kaufen')).toBe('Acheter')
    expect(translate(' Panzer 3 ')).toBe(' Char 3 ')
    expect(translate('Höhe 12 m')).toBe('Altitude 12 m')
    expect(translate('Unbekannt xyz')).toBeNull()
    expect(Object.keys(FR).length).toBeGreaterThan(100)
    expect(PATTERNS.length).toBeGreaterThan(20)
  })
})
