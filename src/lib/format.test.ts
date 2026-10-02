import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate } from './format'

describe('format', () => {
  it('formatiert Speichergrößen', () => {
    expect(formatBytes(0)).toBe('0 KB')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(1536)).toBe('1,5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB')
  })
  it('behandelt fehlende Daten', () => {
    expect(formatDate(null)).toBe('–')
    expect(formatDate('kaputt')).toBe('–')
  })
})
