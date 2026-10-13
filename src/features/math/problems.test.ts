import { describe, expect, it } from 'vitest'
import { generateProblems, parseAnswer, type Level, type Op } from './problems'

const OPS: Op[] = ['+', '-', '*', '/']
const LEVELS: Level[] = [1, 2, 3, 4, 5]

function check(text: string, op: Op, answer: number) {
  const [a, , b] = text.split(' ').map((x) => x.replace(/\./g, ''))
  const x = Number(a)
  const y = Number(b)
  const expected = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : x / y
  expect(answer).toBe(expected)
  expect(Number.isInteger(answer)).toBe(true)
}

describe('generateProblems', () => {
  it('rechnet in allen Stufen und Rechenarten richtig, Division ohne Rest', () => {
    for (const op of OPS) for (const level of LEVELS) {
      const list = generateProblems([op], level, 40)
      expect(list.length).toBeGreaterThanOrEqual(25)
      for (const p of list) { expect(p.op).toBe(op); check(p.text, op, p.answer) }
    }
  })
  it('Minus bleibt unterhalb von Stufe 5 nicht negativ, Division nie durch 0', () => {
    for (const level of [1, 2, 3, 4] as Level[]) for (const p of generateProblems(['-'], level, 60)) expect(p.answer).toBeGreaterThanOrEqual(0)
    for (const level of LEVELS) for (const p of generateProblems(['/'], level, 60)) expect(p.text).not.toMatch(/÷ 0$/)
  })
  it('Aufgaben sind verschieden und die Anzahl stimmt', () => {
    const list = generateProblems(OPS, 3, 20)
    expect(list.length).toBe(20)
    expect(new Set(list.map((p) => p.text)).size).toBe(20)
  })
  it('mischt gewählte Rechenarten und liefert bei leerer Auswahl nichts', () => {
    const ops = new Set(generateProblems(['+', '*'], 2, 30).map((p) => p.op))
    expect(ops).toEqual(new Set(['+', '*']))
    expect(generateProblems([], 2, 10)).toEqual([])
  })
  it('Zahlenbereiche passen zur Stufe', () => {
    for (const p of generateProblems(['+'], 1, 40)) expect(p.answer).toBeLessThanOrEqual(40)
    for (const p of generateProblems(['*'], 2, 40)) expect(p.answer).toBeLessThanOrEqual(100)
  })
})

describe('parseAnswer', () => {
  it('liest Zahlen tolerant', () => {
    expect(parseAnswer(' 42 ')).toBe(42)
    expect(parseAnswer('-7')).toBe(-7)
    expect(parseAnswer('−7')).toBe(-7)
    expect(parseAnswer('1.250')).toBe(1250)
    expect(parseAnswer('')).toBeNull()
    expect(parseAnswer('abc')).toBeNull()
    expect(parseAnswer('3,5')).toBeNull()
  })
})
