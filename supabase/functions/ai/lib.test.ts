import { describe, expect, it } from 'vitest'
import {
  classifyOpenAiError, cleanGapItem, cleanVocabList, parseGrammarRequest, parseGrammarResponse, parseSentencesResponse,
  sanitizeTopic, topicKey, vocabKey, buildGrammarPrompt, RequestError,
} from './lib'

const good = { text: 'Yesterday she {{1}} to school.', answers: [['went']], hints: ['go'], explanation: 'Simple Past von go ist went.' }

describe('Thema', () => {
  it('säubert Sonderzeichen und kürzt', () => {
    expect(sanitizeTopic('  Past <b>perfect</b>\n\n!! ')).toBe('Past b perfect /b')
    expect(sanitizeTopic('x'.repeat(100)).length).toBe(60)
  })
  it('bildet Schlüssel', () => {
    expect(topicKey('Participe passé')).toBe('participe_passe')
    expect(topicKey('If-Sätze (Typ 2)')).toBe('if_satze_typ_2')
  })
})

describe('parseGrammarRequest', () => {
  const base = { language: 'en', grade: 7, topic: 'Past perfect', level: 'mittel', count: 10 }
  it('akzeptiert gültige Anfragen und begrenzt die Anzahl', () => {
    expect(parseGrammarRequest({ ...base, count: 99 }, 15).count).toBe(15)
    expect(parseGrammarRequest(base, 15).topicKey).toBe('past_perfect')
  })
  it('lehnt Ungültiges ab', () => {
    expect(() => parseGrammarRequest({ ...base, language: 'de' }, 15)).toThrow(RequestError)
    expect(() => parseGrammarRequest({ ...base, grade: 2 }, 15)).toThrow(RequestError)
    expect(() => parseGrammarRequest({ ...base, level: 'x' }, 15)).toThrow(RequestError)
    expect(() => parseGrammarRequest({ ...base, topic: '!' }, 15)).toThrow(RequestError)
  })
  it('Prompt nennt Thema, Klasse und Regel', () => {
    const p = buildGrammarPrompt(parseGrammarRequest({ ...base, level: 'schwer' }, 15))
    expect(p.user).toContain('Past perfect')
    expect(p.user).toContain('Klasse 7')
    expect(p.user).toContain('SCHWER')
  })
})

describe('cleanGapItem', () => {
  it('nimmt gute Aufgaben', () => expect(cleanGapItem(good)?.answers).toEqual([['went']]))
  it('verwirft falsche Lückenzahl, Nummerierung und leere Antworten', () => {
    expect(cleanGapItem({ ...good, text: 'No gap here at all.' })).toBeNull()
    expect(cleanGapItem({ ...good, text: 'She {{2}} to school yesterday.' })).toBeNull()
    expect(cleanGapItem({ ...good, answers: [] })).toBeNull()
    expect(cleanGapItem({ ...good, answers: [['']] })).toBeNull()
    expect(cleanGapItem({ ...good, text: '{{1}} {{2}} {{3}} {{4}} wörter hier' })).toBeNull()
  })
  it('füllt fehlende Hinweise auf', () => expect(cleanGapItem({ ...good, hints: [] })?.hints).toEqual(['']))
})

describe('parseGrammarResponse', () => {
  const mk = (n: number) => JSON.stringify({ title: 'Past', items: Array.from({ length: n }, (_, i) => ({ ...good, text: `Yesterday ${i} she {{1}} to school.` })) })
  it('liest gültige Antworten und entfernt Doppelte', () => {
    expect(parseGrammarResponse(mk(5), 5).items).toHaveLength(5)
    const dup = JSON.stringify({ title: '', items: [good, good, good, good, good] })
    expect(() => parseGrammarResponse(dup, 5)).toThrow()
  })
  it('wirft bei kaputtem JSON oder zu wenig Aufgaben', () => {
    expect(() => parseGrammarResponse('nope', 5)).toThrow()
    expect(() => parseGrammarResponse(mk(2), 10)).toThrow()
  })
})

describe('Sätze zu Vokabeln', () => {
  it('Liste säubern', () => {
    const l = cleanVocabList([{ foreign: 'go', german: 'gehen' }, { foreign: 'GO', german: 'gehen' }, { foreign: '', german: 'x' }], 5)
    expect(l).toHaveLength(1)
    expect(() => cleanVocabList('x', 5)).toThrow(RequestError)
    expect(() => cleanVocabList([], 5)).toThrow(RequestError)
  })
  it('Schlüssel unterscheidet Stufe', () => {
    const v = { foreign: 'Go', german: 'gehen' }
    expect(vocabKey('en', 'einfach', v)).not.toBe(vocabKey('en', 'schwer', v))
  })
  it('parst nur gültige Sätze', () => {
    const c = JSON.stringify({ items: [
      { index: 0, text: 'I like to {{1}} home.', answers: ['go'], hint: 'gehen' },
      { index: 1, text: 'Kein Marker hier drin.', answers: ['x'], hint: '' },
      { index: 9, text: 'I like to {{1}} home.', answers: ['go'], hint: '' },
    ] })
    const m = parseSentencesResponse(c, 2)
    expect([...m.keys()]).toEqual([0])
  })
})

describe('classifyOpenAiError', () => {
  it('ordnet Fehler ein', () => {
    expect(classifyOpenAiError(401, { error: { code: 'invalid_api_key' } }).code).toBe('no_key')
    expect(classifyOpenAiError(429, { error: { code: 'insufficient_quota' } }).code).toBe('empty')
    expect(classifyOpenAiError(429, { error: { code: 'rate_limit_exceeded' } }).code).toBe('rate')
    expect(classifyOpenAiError(500, {}).code).toBe('error')
  })
})
