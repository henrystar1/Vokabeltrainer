import { describe, expect, it } from 'vitest'
import { duo } from './duoSim'

describe('zwei Bots auf einem Level', () => {
  it('Doppelbrücke (Level 6): beide kommen durch, ohne sich in die Brücke zu stürzen', () => {
    for (const sk of [[3, 3], [4, 4], [2, 3], [5, 5]]) {
      const r = duo(5, sk, 100)
      expect({ sk, ok: r.ok, deaths: Math.min(r.deaths, 4) }).toEqual({ sk, ok: true, deaths: Math.min(r.deaths, 4) })
      expect(r.deaths).toBeLessThanOrEqual(4)
    }
  }, 300000)
  it('Level 1 bis 14 mit zwei Profi-Bots: fast alle Level werden gemeinsam geschafft', () => {
    let ok = 0
    const bad: number[] = []
    for (let n = 0; n < 14; n++) { if (duo(n, [3, 3], 150).ok) ok++; else bad.push(n + 1) }
    console.log('duo ok', ok, 'nicht:', bad.join(','))
    expect(ok).toBeGreaterThanOrEqual(11)
  }, 600000)
})
