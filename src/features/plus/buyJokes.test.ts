import { describe, expect, it } from 'vitest'
import { ago, buyJoke } from './buyJokes'

describe('buyJoke', () => {
  it('nennt den Namen und bleibt pro Kauf gleich', () => {
    const b = { id: 7, name: 'ghg', pro: true, days: 30 }
    expect(buyJoke(b)).toContain('ghg')
    expect(buyJoke(b)).toBe(buyJoke(b))
  })
  it('erkennt „für immer“', () => {
    expect(buyJoke({ id: 1, name: 'x', pro: false, days: 36500 })).toMatch(/Plus/)
  })
})

describe('ago', () => {
  it('formuliert die Zeit', () => {
    const now = Date.parse('2026-01-01T12:00:00Z')
    expect(ago('2026-01-01T11:59:30Z', now)).toBe('gerade eben')
    expect(ago('2026-01-01T11:30:00Z', now)).toBe('vor 30 Min.')
    expect(ago('2025-12-30T12:00:00Z', now)).toBe('vor 2 Tagen')
  })
})
