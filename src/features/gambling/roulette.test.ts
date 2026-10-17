import { describe, expect, it } from 'vitest'
import { WHEEL_ORDER, addChip, betFactor, betWins, colorOf, totalOf } from './roulette'

describe('Roulette', () => {
  it('Rad hat alle 37 Felder genau einmal', () => {
    expect(WHEEL_ORDER).toHaveLength(37)
    expect(new Set(WHEEL_ORDER).size).toBe(37)
  })
  it('Farben', () => {
    expect(colorOf(0)).toBe('green')
    expect(colorOf(1)).toBe('red')
    expect(colorOf(2)).toBe('black')
    expect(colorOf(36)).toBe('red')
    let red = 0
    for (let n = 1; n <= 36; n++) if (colorOf(n) === 'red') red++
    expect(red).toBe(18)
  })
  it('Wetten gewinnen richtig; die Null verliert außer bei Plein', () => {
    expect(betWins({ t: 'red' }, 0)).toBe(false)
    expect(betWins({ t: 'straight', v: 0 }, 0)).toBe(true)
    expect(betWins({ t: 'dozen', v: 2 }, 13)).toBe(true)
    expect(betWins({ t: 'dozen', v: 2 }, 24)).toBe(true)
    expect(betWins({ t: 'dozen', v: 2 }, 25)).toBe(false)
    expect(betWins({ t: 'column', v: 1 }, 34)).toBe(true)
    expect(betWins({ t: 'column', v: 3 }, 36)).toBe(true)
    expect(betWins({ t: 'low' }, 18)).toBe(true)
    expect(betWins({ t: 'high' }, 18)).toBe(false)
    expect(betFactor('straight')).toBe(36)
  })
  it('Erwartung je Wette ist 36/37 (Rückzahlung 97,3 %)', () => {
    for (const bet of [{ t: 'red' as const }, { t: 'even' as const }, { t: 'dozen' as const, v: 1 }, { t: 'column' as const, v: 2 }, { t: 'straight' as const, v: 17 }]) {
      let pay = 0
      for (let n = 0; n <= 36; n++) if (betWins(bet, n)) pay += betFactor(bet.t)
      expect(pay / 37).toBeCloseTo(36 / 37, 5)
    }
  })
  it('Chips addieren sich und sind begrenzt', () => {
    let b = addChip([], { t: 'red' }, 10, 25)
    b = addChip(b, { t: 'red' }, 10, 25)
    b = addChip(b, { t: 'red' }, 10, 25)
    expect(b).toEqual([{ t: 'red', a: 25 }])
    b = addChip(b, { t: 'straight', v: 7 }, 5, 25)
    expect(totalOf(b)).toBe(30)
    for (let i = 0; i < 20; i++) b = addChip(b, { t: 'straight', v: i }, 1, 25)
    expect(b.length).toBe(10)
  })
})
