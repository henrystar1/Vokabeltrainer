import { describe, expect, it } from 'vitest'
import { AVATARS, EFFECT_CLASSES, NAME_COLORS, TAGS, THEMES, hexToTriplet } from './catalog'
import { ANIMATED_AVATARS } from './AnimatedAvatar'

// Die Artikel-IDs stehen in den Migrationen; der Katalog muss jede davon kennen.
const files = import.meta.glob('../../../supabase/migrations/00{05,06,09,10,11,14}_*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const sql = Object.values(files).join('\n')
const seeded = [...sql.matchAll(/\('((?:avatar|color|effect|theme|tag)_[a-z_]+)',\s*'(avatar|color|effect|theme|tag)'/g)].map((m) => [m[1], m[2]])

describe('Shop-Katalog', () => {
  it('kennt alle in der Datenbank angelegten Artikel', () => {
    expect(seeded.length).toBe(48 + 17 + 6 + 2 + 4 + 16)
    for (const [id, kind] of seeded) {
      const known =
        kind === 'avatar' ? { ...AVATARS, ...Object.fromEntries(ANIMATED_AVATARS.map((a) => [a, true])) }
        : kind === 'color' ? NAME_COLORS
        : kind === 'effect' ? EFFECT_CLASSES
        : kind === 'tag' ? TAGS
        : THEMES
      expect(known[id as keyof typeof known], id).toBeDefined()
    }
  })

  it('wandelt Hex in RGB-Triplets um', () => {
    expect(hexToTriplet('#22d3ee')).toBe('34 211 238')
    expect(hexToTriplet('#000000')).toBe('0 0 0')
  })
})
