import { describe, expect, it } from 'vitest'

/** Spiele-Ordner dürfen den Vokabel-Teil nur über `features/vocabApi.ts` erreichen (siehe SPIELE_SCHNITTSTELLE.md). */
const GAME_DIRS = ['features/cars', 'features/parkour', 'features/games', 'features/gambling', 'features/stocks', 'features/duel', 'features/math', 'features/panic', 'features/advent']
const VOCAB = ['features/learning', 'features/cram', 'features/entry', 'features/french', 'features/irregular', 'features/books', 'features/memorize', 'features/speedread', 'features/test', 'features/ocr', 'features/progress', 'services/learning', 'services/entry', 'services/books']
const ALL = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Pfad auflösen (./ und ../) ohne Node-Module. */
function resolvePath(fromFile: string, rel: string): string {
  const parts = fromFile.split('/').slice(0, -1)
  for (const seg of rel.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg) }
  return parts.join('/')
}

describe('Spiele-Grenze', () => {
  it('kein Spiel importiert den Vokabel-Teil direkt', () => {
    const bad: string[] = []
    expect(Object.keys(ALL).filter((f) => f.startsWith('/src/features/cars/')).length).toBeGreaterThan(10) // Glob hat wirklich Dateien geladen
    for (const [file, src] of Object.entries(ALL)) {
      if (!GAME_DIRS.some((g) => file.startsWith(`/src/${g}/`))) continue
      for (const m of src.matchAll(/from '(\.[^']*)'/g)) {
        const rel = resolvePath(file, m[1]).slice('/src/'.length)
        if (VOCAB.some((v) => rel === v || rel.startsWith(`${v}/`))) bad.push(`${file} → ${m[1]}`)
      }
    }
    expect(bad).toEqual([])
  })
})
