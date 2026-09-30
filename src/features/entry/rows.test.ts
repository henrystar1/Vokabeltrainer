import { describe, expect, it } from 'vitest'
import { cleanTranslations, emptyRow, isRowComplete, isRowDirty, nextPosition, rowsFromEntries } from './rows'

describe('rows', () => {
  it('bereinigt Lösungen', () => expect(cleanTranslations([' a ', '', 'A', 'b'])).toEqual(['a', 'b']))
  it('Zeile ist nur mit Deutsch und Lösung vollständig', () => {
    expect(isRowComplete({ german: 'x', translations: [''] })).toBe(false)
    expect(isRowComplete({ german: 'x', translations: ['y'] })).toBe(true)
  })
  it('nextPosition zählt weiter', () => expect(nextPosition([{ position: 3 }, { position: null }])).toBe(4))
  it('erkennt Änderungen gegenüber dem gespeicherten Stand', () => {
    const [row] = rowsFromEntries([{ placement_id: 'p', vocabulary_id: 'v', german: 'Haus', translations: ['house'], position: 1 }])
    expect(isRowDirty(row)).toBe(false)
    expect(isRowDirty({ ...row, translations: ['house', 'home'] })).toBe(true)
    expect(isRowDirty(emptyRow())).toBe(false)
  })
})
