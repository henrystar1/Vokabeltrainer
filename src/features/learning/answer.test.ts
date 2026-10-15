import { describe, expect, it } from 'vitest'
import { isAnswerCorrect, normalizeAnswer } from './answer'

describe('answer', () => {
  it('ignoriert Groß-/Kleinschreibung nur wenn erlaubt', () => {
    expect(isAnswerCorrect('House', ['house'], false)).toBe(true)
    expect(isAnswerCorrect('House', ['house'], true)).toBe(false)
  })
  it('ignoriert überzählige Leerzeichen und typografische Apostrophe', () => {
    expect(isAnswerCorrect('  it’s   fine ', ["it's fine"], false)).toBe(true)
  })
  it('akzeptiert jede der Lösungen, aber keine Tippfehler', () => {
    expect(isAnswerCorrect('flat', ['apartment', 'flat'], false)).toBe(true)
    expect(isAnswerCorrect('aprtment', ['apartment'], false)).toBe(false)
  })
  it('leere Antwort ist falsch', () => {
    expect(isAnswerCorrect('  ', [''], false)).toBe(false)
  })
  it('vereinheitlicht Unicode', () => {
    expect(normalizeAnswer('é', true)).toBe('é')
  })

  it('englisch: „to“ und Bindestriche sind egal', () => {
    expect(isAnswerCorrect('be', ['to be'], false)).toBe(true)
    expect(isAnswerCorrect('to be', ['be'], false)).toBe(true)
    expect(isAnswerCorrect('To Be', ['to be'], false)).toBe(true)
    expect(isAnswerCorrect('well known', ['well-known'], false)).toBe(true)
    expect(isAnswerCorrect('well-known', ['well known'], false)).toBe(true)
    expect(isAnswerCorrect('to', ['to'], false)).toBe(true)
    expect(isAnswerCorrect('bee', ['to be'], false)).toBe(false)
  })
  it('Schrägstrich-Alternativen und Kürzel: qc/qn', () => {
    expect(isAnswerCorrect('avoir qc', ['avoir qc/qn'], false)).toBe(true)
    expect(isAnswerCorrect('avoir qn', ['avoir qc/qn'], false)).toBe(true)
    expect(isAnswerCorrect('avoir qc/qn', ['avoir qc/qn'], false)).toBe(true)
    expect(isAnswerCorrect('avoir', ['avoir qc/qn'], false)).toBe(true)
    expect(isAnswerCorrect('avoir qx', ['avoir qc/qn'], false)).toBe(false)
    expect(isAnswerCorrect('help sb', ['to help sb'], false)).toBe(true)
    expect(isAnswerCorrect('help', ['to help sb'], false)).toBe(true)
    expect(isAnswerCorrect('jdm helfen', ['jdm. helfen'], false)).toBe(true)
  })
  it('Alternativen mit Schrägstrich ohne Kürzel', () => {
    expect(isAnswerCorrect('yes', ['yes/yeah'], false)).toBe(true)
    expect(isAnswerCorrect('yeah', ['yes/yeah'], false)).toBe(true)
    expect(isAnswerCorrect('no', ['yes/yeah'], false)).toBe(false)
    expect(isAnswerCorrect('1/2', ['1/2'], false)).toBe(true)
  })
  it('Klammern sind optional', () => {
    expect(isAnswerCorrect('se lever', ['(se) lever'], false)).toBe(true)
    expect(isAnswerCorrect('lever', ['(se) lever'], false)).toBe(true)
    expect(isAnswerCorrect('lever se', ['(se) lever'], false)).toBe(false)
  })
  it('Tippfehler bleiben falsch', () => {
    expect(isAnswerCorrect('avoir qcc', ['avoir qc/qn'], false)).toBe(false)
    expect(isAnswerCorrect('tobe', ['to be'], false)).toBe(false)
  })
})

describe('Leerzeichen dürfen fehlen', () => {
  it('ohne Leerzeichen ist richtig', () => {
    expect(isAnswerCorrect('icecream', ['ice cream'], false)).toBe(true)
    expect(isAnswerCorrect('ice  cream', ['ice cream'], false)).toBe(true)
    expect(isAnswerCorrect('be', ['to be'], false)).toBe(true)
    expect(isAnswerCorrect('icecrem', ['ice cream'], false)).toBe(false)
  })
})
