import { describe, expect, it } from 'vitest'
import { AVATAR_BG_PRESETS, shade } from './avatarBg'

describe('Avatar-Hintergrund', () => {
  it('shade mischt mit Schwarz und Weiß', () => {
    expect(shade('#ff8000', -0.5)).toBe('rgb(128 64 0)')
    expect(shade('#000000', 1)).toBe('rgb(255 255 255)')
    expect(shade('#123456', 0)).toBe('rgb(18 52 86)')
  })
  it('alle Vorgaben sind gültige Hex-Farben', () => {
    for (const c of AVATAR_BG_PRESETS) expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })
})
