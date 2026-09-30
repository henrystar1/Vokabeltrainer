import { describe, expect, it } from 'vitest'
import fixture from './fixtures/liste-des-mots-164.json'
import fixtureB from './fixtures/liste-des-mots-164-b.json'
import { cleanForeignText, cleanGermanText } from './clean'
import { detectColumns, parsePage } from './layout'
import type { OcrWord } from './types'

const words = fixture as OcrWord[]

describe('cleanForeignText', () => {
  it('entfernt Lautschrift und Grammatik', () => {
    expect(cleanForeignText('autonome [stonom] m./f adj')).toEqual(['autonome'])
    expect(cleanForeignText('la main [lam£]')).toEqual(['la main'])
    expect(cleanForeignText('les fesses [lefes] f pl.')).toEqual(['les fesses'])
  })
  it('teilt männliche/weibliche Form in zwei Lösungen', () => {
    expect(cleanForeignText('professionnel/professionnelle [profesjonel] adj')).toEqual(['professionnel', 'professionnelle'])
    expect(cleanForeignText('être assis/assise [etrasi/asiz]')).toEqual(['être assis', 'être assise'])
  })
  it('lässt Kürzel wie qn/qc zusammen und entfernt Aufzählzeichen', () => {
    expect(cleanForeignText("@s'occuper de qn/qc [sokypeda]")).toEqual(["s'occuper de qn/qc"])
  })
  it('behält Klammern im Stichwort', () => {
    expect(cleanForeignText('réfléchir (à qc) [reflefir(a)]')).toEqual(['réfléchir (à qc)'])
  })
})

describe('cleanGermanText', () => {
  it('teilt an Kommas, nicht in Klammern', () => {
    expect(cleanGermanText('Berufs-, beruflich, professionell')).toEqual(['Berufs-', 'beruflich', 'professionell'])
    expect(cleanGermanText('sich um jdn/etw. kümmern, sich (mit jdm/etw.) beschäftigen, auch: jdn/etw. betreuen')).toEqual([
      'sich um jdn/etw. kümmern',
      'sich (mit jdm/etw.) beschäftigen',
      'jdn/etw. betreuen',
    ])
  })
  it('entfernt Verweise und Hinweise', () => {
    expect(cleanGermanText('über etw. nachdenken wird wie finir konjugiert » Verbes, p.139')).toEqual(['über etw. nachdenken'])
    expect(cleanGermanText('sich organisieren » Verbes, p.143')).toEqual(['sich organisieren'])
  })
  it('macht aus "auch:" eine weitere Lösung', () => {
    expect(cleanGermanText('die Zeit, auch: der Fahrplan')).toEqual(['die Zeit', 'der Fahrplan'])
    expect(cleanGermanText('die Zeit, auch; der Fahrplan')).toEqual(['die Zeit', 'der Fahrplan'])
  })
})

describe('parsePage (Seite 164, Unité 1)', () => {
  const result = parsePage(words)
  const find = (fr: string) => result.rows.find((r) => r.foreign[0] === fr)

  it('erkennt Spalten, Unit und Seitenzahl', () => {
    const cols = detectColumns(words)
    expect(cols).not.toBeNull()
    expect(Math.abs(cols!.c1 - 1388)).toBeLessThan(15)
    expect(Math.abs(cols!.c2 - 1874)).toBeLessThan(15)
    expect(result.unit).toBe(1)
    expect(result.page).toBe(164)
  })

  it('liest alle 14 Vokabelzeilen und lässt den blauen Kasten aus', () => {
    expect(result.rows.map((r) => r.foreign[0])).toEqual([
      'réfléchir (à qc)',
      'professionnel',
      'autonome',
      'être assis',
      'la main',
      "s'organiser",
      'la formation',
      'une entreprise',
      'utile',
      'un horaire',
      'flexible',
      "s'occuper de qn/qc",
      'la responsabilité',
      'dangereux',
    ])
    expect(result.rows.some((r) => r.foreign[0] === 'le dos' || r.foreign[0] === 'la tête')).toBe(false)
  })

  it('ordnet Deutsch richtig zu, auch bei mehreren Zeilen und mehreren Lösungen', () => {
    expect(find('réfléchir (à qc)')?.german).toEqual(['über etw. nachdenken'])
    expect(find('professionnel')?.foreign).toEqual(['professionnel', 'professionnelle'])
    expect(find('professionnel')?.german).toEqual(['Berufs-', 'beruflich', 'professionell'])
    expect(find('être assis')?.foreign).toEqual(['être assis', 'être assise'])
    expect(find('être assis')?.german).toEqual(['sitzen'])
    expect(find('la main')?.german).toEqual(['die Hand'])
    expect(find("s'organiser")?.german).toEqual(['sich organisieren'])
    expect(find('un horaire')?.german).toEqual(['die Zeit', 'der Fahrplan'])
    expect(find("s'occuper de qn/qc")?.german).toEqual([
      'sich um jdn/etw. kümmern',
      'sich (mit jdm/etw.) beschäftigen',
      'jdn/etw. betreuen',
    ])
    expect(find('dangereux')?.foreign).toEqual(['dangereux', 'dangereuse'])
    expect(find('dangereux')?.german).toEqual(['gefährlich'])
  })

  it('meldet unbrauchbare Seiten statt zu raten', () => {
    const r = parsePage([{ text: 'Hallo', x0: 10, y0: 10, x1: 50, y1: 30, conf: 90 }])
    expect(r.rows).toEqual([])
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})

describe('parsePage mit der im Browser aufbereiteten Variante desselben Fotos', () => {
  const result = parsePage(fixtureB as OcrWord[])
  it('liest ebenfalls alle 14 Zeilen samt Unit und Seite', () => {
    expect(result.unit).toBe(1)
    expect(result.page).toBe(164)
    expect(result.rows).toHaveLength(14)
    expect(result.rows.find((r) => r.foreign[0] === 'autonome')?.german).toEqual(['selbstständig'])
  })
})
