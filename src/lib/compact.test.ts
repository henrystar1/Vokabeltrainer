import { describe, expect, it } from 'vitest'
import { fmtCompact } from './compact'

describe('fmtCompact', () => {
  it('kürzt große Zahlen', () => {
    expect(fmtCompact(999)).toBe('999')
    expect(fmtCompact(1000)).toBe('1k')
    expect(fmtCompact(1500)).toBe('1,5k')
    expect(fmtCompact(25_000)).toBe('25k')
    expect(fmtCompact(2_000_000)).toBe('2M')
    expect(fmtCompact(3e9)).toBe('3Mrd')
    expect(fmtCompact(1e12)).toBe('1Bio')
    expect(fmtCompact(9e15)).toBe('9Brd')
  })
})
