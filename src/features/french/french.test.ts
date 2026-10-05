import { describe, expect, it } from 'vitest'
import { accepted, forms, VERBS, withPronoun } from './verbs'
import { buildGenderQuestions, extractGenderWords } from './gender'
import type { PoolVocab } from '../../types'

const verb = (inf: string) => VERBS.find((x) => x.inf === inf)!

describe('Konjugation', () => {
  it('Imparfait wird aus nous abgeleitet', () => {
    expect(forms(verb('parler'), 'imparfait')).toEqual(['parlais', 'parlais', 'parlait', 'parlions', 'parliez', 'parlaient'])
    expect(forms(verb('finir'), 'imparfait')[3]).toBe('finissions')
    expect(forms(verb('être'), 'imparfait')[0]).toBe('étais')
    expect(forms(verb('faire'), 'imparfait')[4]).toBe('faisiez')
    expect(forms(verb('manger'), 'imparfait')[3]).toBe('mangions')
    expect(forms(verb('connaître'), 'imparfait')[2]).toBe('connaissait')
  })

  it('Futur mit Sonderstämmen', () => {
    expect(forms(verb('aller'), 'futur')).toEqual(['irai', 'iras', 'ira', 'irons', 'irez', 'iront'])
    expect(forms(verb('avoir'), 'futur')[5]).toBe('auront')
    expect(forms(verb('voir'), 'futur')[0]).toBe('verrai')
    expect(forms(verb('boire'), 'futur')[1]).toBe('boiras')
  })

  it('Passé composé mit avoir und être', () => {
    expect(forms(verb('parler'), 'passe')[0]).toBe('ai parlé')
    expect(forms(verb('aller'), 'passe')).toEqual(['suis allé', 'es allé', 'est allé', 'sommes allés', 'êtes allés', 'sont allés'])
  })

  it('être-Verben akzeptieren weibliche Formen', () => {
    expect(accepted(verb('aller'), 'passe', 0)).toContain('je suis allée')
    expect(accepted(verb('sortir'), 'passe', 5)).toContain('elles sont sorties')
  })

  it('Elision bei je', () => {
    expect(withPronoun(0, 'aime')).toBe("j'aime")
    expect(withPronoun(0, 'parle')).toBe('je parle')
    expect(accepted(verb('habiter'), 'present', 0)).toContain("j'habite")
    expect(accepted(verb('être'), 'present', 2)).toEqual(['est', 'il est', 'elle est'])
  })

  it('jedes Verb hat sechs Präsensformen', () => {
    for (const x of VERBS) expect(x.pres).toHaveLength(6)
  })
})

describe('le oder la aus den eigenen Büchern', () => {
  const v = (german: string, translations: string[]) => ({ vocabulary_id: german, german, translations }) as unknown as PoolVocab
  const pool = [v('Buch', ['le livre']), v('Haus', ['la maison']), v('Wasser', ["l'eau"]), v('Bild', ['un tableau']), v('Tür', ['une porte']), v('laufen', ['courir']), v('Buch2', ['le livre'])]
  it('nimmt nur le/la-Wörter, keine l’-Wörter, keine Doppelten', () => {
    const w = extractGenderWords(pool)
    expect(w.map((x) => `${x.g} ${x.fr}`)).toEqual(['le livre', 'la maison', 'le tableau', 'la porte'])
  })
  it('baut Fragen mit richtiger Antwort', () => {
    const q = buildGenderQuestions(extractGenderWords(pool), 10)
    expect(q).toHaveLength(4)
    const livre = q.find((x) => x.prompt.includes('livre'))!
    expect(livre.options[livre.correct]).toBe('le')
  })
})
