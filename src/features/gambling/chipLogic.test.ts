import { describe, expect, it } from 'vitest'
import { isPurseError, lockSeconds, maxBuyable, nextLossRun } from './chipLogic'

describe('chipLogic', () => {
  it('erkennt die Portemonnaie-Sperre', () => {
    expect(isPurseError(new Error('Dein Portemonnaie ist leer geschüttelt. Warte einen Moment.'))).toBe(true)
    expect(isPurseError(new Error('Nicht genug Chips.'))).toBe(false)
    expect(isPurseError(undefined)).toBe(false)
  })
  it('zählt Verluste in Folge', () => {
    expect(nextLossRun(0, 100, 95)).toBe(1)
    expect(nextLossRun(2, 100, 100)).toBe(0)
    expect(nextLossRun(2, 100, 120)).toBe(0)
  })
  it('begrenzt den Kauf durch Coins und Tageslimit', () => {
    expect(maxBuyable(5000, 10, 1000)).toBe(500)
    expect(maxBuyable(50000, 10, 300)).toBe(300)
    expect(maxBuyable(5, 10, 300)).toBe(0)
    expect(maxBuyable(100, 0, 300)).toBe(0)
  })
  it('rundet die Sperre auf', () => {
    expect(lockSeconds(10_500, 0)).toBe(11)
    expect(lockSeconds(1000, 5000)).toBe(0)
  })
})
