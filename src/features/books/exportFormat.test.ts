import { describe, expect, it } from 'vitest'
import { exportFileName, validateBookExport } from './exportFormat'

const good = {
  format: 'vokabeltrainer-book', version: 1,
  book: { name: 'Green Line 3', language: 'en', description: null },
  units: [{ number: 1, pages: [{ number: 10, vocabulary: [{ german: 'Haus', translations: ['house', 'House'] }] }] }],
}

describe('validateBookExport', () => {
  it('akzeptiert eine gültige Datei und fasst zusammen', () => {
    const r = validateBookExport(good, ['en', 'fr'])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.summary).toMatchObject({ unitCount: 1, pageCount: 1, entryCount: 1, distinctVocabCount: 1 })
  })
  it('lehnt fremde Dateien ab', () => expect(validateBookExport({ foo: 1 }, ['en']).ok).toBe(false))
  it('meldet unbekannte Sprache, doppelte Seiten und fehlende Übersetzungen', () => {
    const bad = {
      ...good, book: { name: 'X', language: 'xx' },
      units: [{ number: 1, pages: [{ number: 1, vocabulary: [{ german: 'a', translations: [] }] }] }, { number: 2, pages: [{ number: 1, vocabulary: [] }] }],
    }
    const r = validateBookExport(bad, ['en'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(3)
  })
})
describe('exportFileName', () => {
  it('bildet einen sauberen Dateinamen', () => expect(exportFileName('Grüne Linie 3!')).toBe('grune-linie-3.vokabeltrainer.json'))
  it('hat einen Ersatz für leere Namen', () => expect(exportFileName('???')).toBe('buch.vokabeltrainer.json'))
})
