import { describe, expect, it } from 'vitest'
import { decodeMix, encodeMix, skillList } from './botmix'

describe('Bot-Mischung', () => {
  it('rechnet hin und zurück', () => {
    for (const m of [[0, 0, 0, 0], [8, 0, 0, 0], [1, 2, 3, 2], [0, 0, 0, 8], [2, 2, 2, 2]] as const) expect(decodeMix(encodeMix([...m]), 8)).toEqual([...m])
    expect(encodeMix([8, 8, 8, 8])).toBeLessThan(32000)
  })
  it('alte Werte 1 bis 4 gelten für alle Bots', () => {
    expect(skillList(3, 4)).toEqual([3, 3, 3, 3])
    expect(skillList(null, 2)).toEqual([2, 2])
  })
  it('liefert die Liste nach Können sortiert', () => {
    expect(skillList(encodeMix([1, 0, 2, 1]), 4)).toEqual([1, 3, 3, 4])
    expect(skillList(encodeMix([1, 0, 0, 0]), 3)).toEqual([1, 1, 1])
  })
})
