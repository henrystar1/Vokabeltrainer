import { describe, expect, it } from 'vitest'
import { detectOvertakes, type Snapshot } from './overtakes'

const row = (n: string, points: number, rank: number, me = false) => ({ display_name: n, points, rank, is_me: me })
const snap = (rows: ReturnType<typeof row>[]): Snapshot => {
  const m = rows.find((r) => r.is_me)
  return { rank: m?.rank ?? null, points: m?.points ?? null, rows }
}

describe('detectOvertakes', () => {
  it('erkennt überholte Personen', () => {
    const prev = snap([row('Anna', 50, 1), row('Ben', 40, 2), row('Ich', 30, 3, true)])
    const cur = snap([row('Ich', 45, 2, true), row('Anna', 50, 1), row('Ben', 40, 3)])
    expect(detectOvertakes(prev, cur).map((r) => r.display_name)).toEqual(['Ben'])
  })
  it('meldet nichts ohne früheren Stand oder ohne Überholen', () => {
    const cur = snap([row('Anna', 50, 1), row('Ich', 30, 2, true)])
    expect(detectOvertakes(null, cur)).toEqual([])
    expect(detectOvertakes(cur, cur)).toEqual([])
  })
  it('wer schon vorher hinter dir war, zählt nicht', () => {
    const prev = snap([row('Ich', 30, 1, true), row('Ben', 20, 2)])
    const cur = snap([row('Ich', 40, 1, true), row('Ben', 25, 2)])
    expect(detectOvertakes(prev, cur)).toEqual([])
  })
})
