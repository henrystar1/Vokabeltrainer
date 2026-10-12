import { describe, expect, it } from 'vitest'
import { gradeFromPercent, gradeFromScore, percentOf } from './grade'

describe('Note', () => {
  it('Grenzen', () => {
    expect(gradeFromPercent(100)).toBe(1)
    expect(gradeFromPercent(92)).toBe(1)
    expect(gradeFromPercent(91.9)).toBe(2)
    expect(gradeFromPercent(81)).toBe(2)
    expect(gradeFromPercent(67)).toBe(3)
    expect(gradeFromPercent(50)).toBe(4)
    expect(gradeFromPercent(30)).toBe(5)
    expect(gradeFromPercent(29)).toBe(6)
    expect(gradeFromPercent(Number.NaN)).toBe(6)
  })
  it('aus Punkten', () => {
    expect(gradeFromScore(9, 10)).toBe(2)
    expect(gradeFromScore(0, 0)).toBe(6)
    expect(percentOf(1, 3)).toBe(33)
  })
})
