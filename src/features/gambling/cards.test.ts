import { describe, expect, it } from 'vitest'
import { cardIsRed, cardRank, cardSuit, handTotal } from './cards'

describe('cards', () => {
  it('benennt Karten', () => {
    expect(cardRank(0)).toBe('A')
    expect(cardRank(12)).toBe('K')
    expect(cardRank(13)).toBe('A')
    expect(cardSuit(0)).toBe('♠')
    expect(cardSuit(51)).toBe('♣')
    expect(cardIsRed(13)).toBe(true)
    expect(cardIsRed(0)).toBe(false)
  })
  it('zählt Hände wie der Server', () => {
    expect(handTotal([0, 12])).toBe(21)
    expect(handTotal([0, 0])).toBe(12)
    expect(handTotal([0, 5, 12])).toBe(17)
    expect(handTotal([9, 10, 11])).toBe(30)
    expect(handTotal([0, 0, 0, 8])).toBe(12)
  })
})
