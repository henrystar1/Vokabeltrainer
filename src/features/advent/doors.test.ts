import { describe, expect, it } from 'vitest'
import { doorOrder, rewardEmoji } from './doors'

describe('Adventskalender', () => {
  it('mischt alle 24 Türchen, pro Jahr gleich', () => {
    const a = doorOrder(2026)
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1))
    expect(doorOrder(2026)).toEqual(a)
    expect(doorOrder(2027)).not.toEqual(a)
    expect(a).not.toEqual([...a].sort((x, y) => x - y))
  })
  it('Emojis je Belohnung', () => {
    expect(rewardEmoji([{ type: 'coins', amount: 5 }, { type: 'plus', days: 2 }])).toBe('💵💎')
  })
})
