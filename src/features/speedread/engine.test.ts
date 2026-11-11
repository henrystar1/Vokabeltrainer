import { describe, expect, it } from 'vitest'
import { delayMs, groupWords, pivotIndex, textStats, tokenize } from './engine'

describe('Schnelllesen', () => {
  it('zählt Zeichen, Wörter und Sätze', () => {
    const s = textStats('Hallo Welt. Das ist ein Test!')
    expect(s.chars).toBe(29)
    expect(s.charsNoSpaces).toBe(24)
    expect(s.words).toBe(6)
    expect(s.sentences).toBe(2)
    expect(s.minutesAt(300)).toBeCloseTo(0.02)
    expect(textStats('   ').words).toBe(0)
    expect(textStats('😀a').chars).toBe(2)
  })
  it('zerlegt und gruppiert', () => {
    expect(tokenize('  a  b\nc ')).toEqual(['a', 'b', 'c'])
    expect(groupWords(['a', 'b', 'c', 'd', 'e'], 2)).toEqual(['a b', 'c d', 'e'])
    expect(groupWords(['a', 'b'], 9)).toEqual(['a b'])
  })
  it('Fixpunkt liegt im Wort', () => {
    for (const w of ['a', 'Haus', 'Wasser', 'Geschwindigkeit', 'Donaudampfschifffahrt']) expect(pivotIndex(w)).toBeLessThan([...w].length || 1)
  })
  it('feste Geschwindigkeit: 60000/wpm', () => {
    expect(delayMs('Haus', 300, false)).toBe(200)
    expect(delayMs('Haus Tor', 300, false)).toBe(400)
  })
  it('variabel: lange Wörter und Satzende dauern länger, kurze kürzer', () => {
    const short = delayMs('so', 300, true)
    const normal = delayMs('Hauses', 300, true)
    const long = delayMs('Geschwindigkeit', 300, true)
    const end = delayMs('Hauses.', 300, true)
    expect(short).toBeLessThan(normal)
    expect(normal).toBeLessThan(long)
    expect(end).toBeGreaterThan(normal)
    expect(delayMs('x', 10, true)).toBeGreaterThan(0)
  })
})
