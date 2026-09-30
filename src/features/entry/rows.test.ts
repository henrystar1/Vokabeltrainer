import { describe, expect, it } from 'vitest'
import { cleanList, emptyRow, isRowComplete, isRowDirty, nextPosition, rowsFromEntries, toSavePayload } from './rows'

describe('rows', () => {
  it('bereinigt Lösungen', () => expect(cleanList([' a ', '', 'A', 'b  c'])).toEqual(['a', 'b c']))
  it('Zeile braucht beide Seiten', () => {
    expect(isRowComplete({ foreign: ['x'], german: [''] })).toBe(false)
    expect(isRowComplete({ foreign: [''], german: ['y'] })).toBe(false)
    expect(isRowComplete({ foreign: ['x'], german: ['y'] })).toBe(true)
  })
  it('nextPosition zählt weiter', () => expect(nextPosition([{ position: 3 }, { position: null }])).toBe(4))
  it('erstes Deutsch ist Hauptwort, der Rest Zusatzlösungen', () => {
    expect(toSavePayload({ foreign: ['la main'], german: ['die Hand', '', 'die Pfote', 'DIE HAND'] })).toEqual({
      german: 'die Hand',
      germanAlts: ['die Pfote'],
      translations: ['la main'],
    })
  })
  it('erkennt Änderungen gegenüber dem gespeicherten Stand', () => {
    const [row] = rowsFromEntries([
      { placement_id: 'p', vocabulary_id: 'v', german: 'die Zeit', german_alts: ['der Fahrplan'], translations: ['l’heure'], position: 1 },
    ])
    expect(row.german).toEqual(['die Zeit', 'der Fahrplan'])
    expect(isRowDirty(row)).toBe(false)
    expect(isRowDirty({ ...row, german: ['die Zeit'] })).toBe(true)
    expect(isRowDirty(emptyRow())).toBe(false)
  })
})
