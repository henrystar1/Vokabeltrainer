import { describe, expect, it } from 'vitest'
import fixture from './fixtures/camden-town-204.json'
import { cleanEnglishForeign } from './layoutEn'
import { estimateSlope, parseWords } from './parse'
import type { OcrWord } from './types'

describe('cleanEnglishForeign', () => {
  it('entfernt Lautschrift, Kürzel und Kästchen', () => {
    expect(cleanEnglishForeign("driver's license (AE = driving licence BE) /ˈdraɪvərz ˌlaɪsəns/")).toEqual(["driver's license"])
    expect(cleanEnglishForeign('medium (pl media) /mi:diəm/')).toEqual(['medium'])
    expect(cleanEnglishForeign('smoking (no pl) /smaokin/')).toEqual(['smoking'])
    expect(cleanEnglishForeign('to be concerned with sth (irr) /.bi: kən/')).toEqual(['to be concerned with sth'])
    expect(cleanEnglishForeign('° therapy /θerəpi/')).toEqual(['therapy'])
  })
  it('lässt Schrägstriche im Stichwort stehen', () => {
    expect(cleanEnglishForeign('to be supposed to do sth/be sth (irr) /bi: sə/')).toEqual(['to be supposed to do sth/be sth'])
  })
})

describe('parseWords (Camden Town, Seite 204)', () => {
  const r = parseWords(fixture as OcrWord[], 'en')
  const find = (en: string) => r.rows.find((x) => x.foreign[0] === en)
  it('liest die Wortliste und lässt Fließtext und Kästen aus', () => {
    expect(r.unit).toBe(1)
    expect(r.rows.length).toBeGreaterThanOrEqual(17)
    expect(r.rows.some((x) => /Wenn|Beispiele|Erfolgreich/.test(x.foreign.join(' ')))).toBe(false)
  })
  it('ordnet Übersetzungen richtig zu', () => {
    expect(find('to benefit')?.german).toEqual(['profitieren', 'Nutzen ziehen'])
    expect(find('to be related to')?.german.join(' ')).toMatch(/verwandt sein/)
    expect(find('colony')?.german).toEqual(['Kolonie'])
  })
  it('liefert Markierungen für das Bild', () => {
    const row = find('to benefit')
    expect(row?.boxes?.foreign.length).toBeGreaterThan(0)
    expect(row?.boxes?.german.length).toBeGreaterThan(0)
  })
})

describe('estimateSlope', () => {
  it('erkennt schräge Zeilen', () => {
    const words: OcrWord[] = []
    for (let row = 0; row < 12; row++)
      for (let col = 0; col < 6; col++) {
        const x = 100 + col * 150
        const y = 100 + row * 40 + 0.03 * x
        words.push({ text: 'wort', x0: x, x1: x + 60, y0: y - 8, y1: y + 8, conf: 90 })
      }
    expect(Math.abs(estimateSlope(words, 16) - 0.03)).toBeLessThan(0.006)
  })
})
