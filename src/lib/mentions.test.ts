import { describe, expect, it } from 'vitest'
import { mentionsName } from './mentions'

describe('mentionsName', () => {
  it('erkennt @Name, egal ob groß oder klein', () => {
    expect(mentionsName('hi @anna wie gehts', 'Anna')).toBe(true)
    expect(mentionsName('@ANNA!', 'anna')).toBe(true)
    expect(mentionsName('Servus @Anna, du', 'Anna')).toBe(true)
  })
  it('beachtet Wortgrenzen', () => {
    expect(mentionsName('wer ist @annabelle?', 'Anna')).toBe(false)
    expect(mentionsName('mail@anna.de', 'Anna')).toBe(false)
    expect(mentionsName('anna ohne at', 'Anna')).toBe(false)
  })
  it('geht mit Leerzeichen, Umlauten und Sonderzeichen im Namen', () => {
    expect(mentionsName('hallo @Max Müller heute', 'Max Müller')).toBe(true)
    expect(mentionsName('@a.b(c)', 'a.b(c)')).toBe(true)
  })
  it('ohne Namen nie', () => {
    expect(mentionsName('@', '')).toBe(false)
    expect(mentionsName('@x', null)).toBe(false)
  })
})
