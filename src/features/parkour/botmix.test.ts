import { describe, expect, it } from 'vitest'
import { decodeMix, encodeMix, mixTotal, skillList, type Mix } from './botmix'

describe('Bot-Mischung', () => {
  it('rechnet hin und zurück', () => {
    for (const m of [[0, 0, 0, 0, 0], [8, 0, 0, 0, 0], [1, 2, 3, 2, 0], [0, 0, 0, 0, 8], [2, 1, 2, 2, 1], [1, 1, 1, 1, 1]] as Mix[]) expect(decodeMix(encodeMix(m), 8)).toEqual(m)
  })
  it('passt in die Datenbankspalte (smallint, Prüfregel bis 7000)', () => {
    expect(encodeMix([0, 0, 0, 0, 8])).toBeLessThan(7000)
    expect(encodeMix([0, 0, 0, 0, 8])).toBeGreaterThanOrEqual(10)
  })
  it('alte Werte 1 bis 5 gelten für alle Bots', () => {
    expect(skillList(3, 4)).toEqual([3, 3, 3, 3])
    expect(skillList(5, 2)).toEqual([5, 5])
    expect(skillList(null, 2)).toEqual([2, 2])
  })
  it('liefert die Liste nach Stärke sortiert (Effizient zwischen Profi und Meister)', () => {
    expect(skillList(encodeMix([1, 0, 1, 1, 1]), 4)).toEqual([1, 3, 5, 4])
    expect(skillList(encodeMix([1, 0, 0, 0, 0]), 3)).toEqual([1, 1, 1])
  })
  it('zählt zusammen', () => {
    expect(mixTotal([1, 2, 3, 0, 2])).toBe(8)
  })
})
