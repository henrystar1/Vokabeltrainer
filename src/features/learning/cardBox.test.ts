import { describe, expect, it } from 'vitest'
import { fachColor, groupByFach, hitRate, previewReward } from './cardBox'
import type { CardBoxItem } from '../../services/learning'

const c = (level: number, right = 0, wrong = 0): CardBoxItem => ({ vocabulary_id: String(Math.random()), book_id: 'b', german: 'x', translations: [], level, right, wrong, last_at: null })

describe('Karteikasten', () => {
  it('sortiert nach ganzen Stufen in Fächer', () => {
    const g = groupByFach([c(1), c(1.5), c(2), c(4.5), c(5)])
    expect(g.map((x) => x.length)).toEqual([2, 1, 0, 1, 1])
  })
  it('Trefferquote und Farbe', () => {
    expect(hitRate(c(1))).toBeNull()
    expect(hitRate(c(1, 3, 1))).toBe(0.75)
    expect(fachColor(1)).toContain('hsl(0')
    expect(fachColor(5)).toContain('hsl(130')
  })
  it('Belohnungsvorschau mit Multiplikator', () => {
    const r = previewReward({ points_per_answer: 2, learn_coin_every: 5, learn_coin_cap: 20 }, 20, true, 1.5, 2)
    expect(r.base).toEqual({ points: 40, coins: 4 })
    expect(r.boosted).toEqual({ points: 60, coins: 8 })
    expect(previewReward({ points_per_answer: 2 }, 20, false, 1, 1).base.coins).toBe(0)
  })
})
