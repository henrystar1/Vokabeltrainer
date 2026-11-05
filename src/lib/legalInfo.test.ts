import { describe, expect, it } from 'vitest'
import { missingImpressum, parseLegal } from './legalInfo'

describe('rechtliches.txt', () => {
  it('liest Schlüssel=Wert, ignoriert Kommentare und Unbekanntes', () => {
    const i = parseLegal('# Kommentar\nNAME = Max Muster\nEMAIL=a@b.de\nUNBEKANNT=x\n\nTELEFON=\r\nSTRASSE=Weg 1 = Haus')
    expect(i.NAME).toBe('Max Muster')
    expect(i.EMAIL).toBe('a@b.de')
    expect(i.STRASSE).toBe('Weg 1 = Haus')
    expect(i.TELEFON).toBe('')
  })
  it('meldet fehlende Pflichtfelder', () => {
    expect(missingImpressum(parseLegal('NAME=A\nEMAIL=b'))).toEqual(['STRASSE', 'PLZ_ORT', 'TELEFON'])
  })
})
