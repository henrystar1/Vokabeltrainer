import { describe, expect, it } from 'vitest'
import { SAMPLE_SPEC, carPrompt, getSpec, parseCarSpec, registerCustom } from './customCar'
import { canFly, isBike, kindDims, kindStats } from './stats'

describe('eigene Autos (Bauplan)', () => {
  it('Beispiel ist gültig, auch mit Code-Zaun', () => {
    expect(parseCarSpec(SAMPLE_SPEC).ok).toBe(true)
    expect(parseCarSpec('```json\n' + SAMPLE_SPEC + '\n```').ok).toBe(true)
  })
  it('lehnt Müll, falsche Formen, unbekannte Farben und zu viele Teile ab', () => {
    expect(parseCarSpec('kein json').ok).toBe(false)
    const j = JSON.parse(SAMPLE_SPEC)
    expect(parseCarSpec(JSON.stringify({ ...j, parts: [{ t: 'torus', p: [0, 0, 0], s: [1, 1, 1] }] })).ok).toBe(false)
    expect(parseCarSpec(JSON.stringify({ ...j, parts: [{ t: 'box', p: [0, 0, 0], s: [1, 1, 1], c: 'javascript:1' }] })).ok).toBe(false)
    expect(parseCarSpec(JSON.stringify({ ...j, parts: Array.from({ length: 161 }, () => j.parts[0]) })).ok).toBe(false)
    expect(parseCarSpec(JSON.stringify({ ...j, wheels: [j.wheels[0]] })).ok).toBe(false)
    expect(parseCarSpec(JSON.stringify({ ...j, len: 99 })).ok).toBe(false)
  })
  it('Registrieren setzt Fahrwerte, Maße, Motorrad und Flug', () => {
    const p = parseCarSpec(JSON.stringify({ ...JSON.parse(SAMPLE_SPEC), fly: true, bike: true, acc: 28 }))
    if (!p.ok) throw new Error(p.error)
    registerCustom('c_test', p.spec, 333)
    expect(kindStats('c_test').kmh).toBe(333)
    expect(kindStats('c_test').acc).toBe(28)
    expect(kindDims('c_test').len).toBe(4.5)
    expect(isBike('c_test')).toBe(true)
    expect(canFly('c_test')).toBe(true)
    expect(getSpec('c_test')).toBeTruthy()
    registerCustom('c_test', { ...p.spec, fly: false, bike: false }, 200)
    expect(isBike('c_test')).toBe(false)
    expect(canFly('c_test')).toBe(false)
  })
  it('Prompt enthält den Wunsch', () => { expect(carPrompt('gelber Bus')).toContain('gelber Bus') })
})
