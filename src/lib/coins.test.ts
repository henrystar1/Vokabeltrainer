import { describe, expect, it } from 'vitest'
import { parseCoins, shortCoins } from './coins'

describe('parseCoins', () => {
  it('liest Zahlen und Kurzschreibweisen', () => {
    expect(parseCoins('1000')).toBe(1000)
    expect(parseCoins('1.000.000')).toBe(1_000_000)
    expect(parseCoins('1k')).toBe(1000)
    expect(parseCoins('2,5m')).toBe(2_500_000)
    expect(parseCoins('1mrd')).toBe(1_000_000_000)
    expect(parseCoins('1b')).toBe(1_000_000_000_000)
    expect(parseCoins('1bio')).toBe(1_000_000_000_000)
    expect(parseCoins('-3k')).toBe(-3000)
    expect(parseCoins('1 000')).toBe(1000)
  })
  it('lehnt Unsinn ab', () => {
    expect(parseCoins('abc')).toBeNaN()
    expect(parseCoins('1x')).toBeNaN()
    expect(parseCoins('')).toBeNaN()
  })
})

describe('shortCoins', () => {
  it('kürzt große Beträge', () => {
    expect(shortCoins(999)).toBe('999')
    expect(shortCoins(1_500_000_000)).toContain('Mrd.')
    expect(shortCoins(2_000_000_000_000)).toBe('2 Bio.')
  })
})
