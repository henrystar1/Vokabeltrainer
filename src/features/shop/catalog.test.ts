import { describe, expect, it } from 'vitest'
import { AVATARS, EFFECT_CLASSES, NAME_COLORS, THEMES, hexToTriplet } from './catalog'

// Die Artikel-IDs stehen in der Migration; der Katalog muss jede davon kennen.
const files = import.meta.glob('../../../supabase/migrations/0005_koins_shop.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const sql = Object.values(files)[0] ?? ''
const seeded = [...sql.matchAll(/\('((?:avatar|color|effect|theme)_[a-z]+)', '(avatar|color|effect|theme)'/g)].map((m) => [m[1], m[2]])

describe('Shop-Katalog', () => {
  it('kennt alle in der Datenbank angelegten Artikel', () => {
    expect(seeded.length).toBe(48)
    for (const [id, kind] of seeded) {
      const known = kind === 'avatar' ? AVATARS : kind === 'color' ? NAME_COLORS : kind === 'effect' ? EFFECT_CLASSES : THEMES
      expect(known[id], id).toBeDefined()
    }
  })

  it('wandelt Hex in RGB-Triplets um', () => {
    expect(hexToTriplet('#22d3ee')).toBe('34 211 238')
    expect(hexToTriplet('#000000')).toBe('0 0 0')
  })
})
