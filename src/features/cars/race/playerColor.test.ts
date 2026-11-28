import { describe, expect, it } from 'vitest'
import { ADMIN_COLOR, playerColor } from './playerColor'

describe('playerColor', () => {
  it('Admin immer grün, andere nie grün und stabil', () => {
    expect(playerColor('x', true)).toBe(ADMIN_COLOR)
    for (const id of ['a', 'bot-1', 'u-123', 'zzz']) { expect(playerColor(id)).not.toBe(ADMIN_COLOR); expect(playerColor(id)).toBe(playerColor(id)) }
  })
  it('verschiedene Ids streuen über mehrere Farben', () => {
    const s = new Set(Array.from({ length: 40 }, (_, i) => playerColor(`id-${i}`)))
    expect(s.size).toBeGreaterThan(5)
  })
})
