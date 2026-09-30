import { describe, expect, it } from 'vitest'
import type { BookEntry } from '../../types'
import { distinctVocabulary, selectRange } from './range'

const e = (order: number, unit: number, page: number, vid = `v${order}`): BookEntry => ({
  placement_id: `p${order}`, vocabulary_id: vid, german: `de${order}`, translations: ['x'],
  unit_number: unit, page_number: page, position: order, order,
})
const entries = [e(1, 1, 10), e(2, 1, 10), e(3, 1, 11), e(4, 2, 12), e(5, 2, 13, 'v1')]

describe('selectRange', () => {
  it('nach Vokabelnummer', () => expect(selectRange(entries, { mode: 'vocab', from: 2, to: 3 }).map((x) => x.order)).toEqual([2, 3]))
  it('nach Seite', () => expect(selectRange(entries, { mode: 'page', from: 11, to: 12 }).map((x) => x.order)).toEqual([3, 4]))
  it('nach Unit, Grenzen vertauscht', () => expect(selectRange(entries, { mode: 'unit', from: 2, to: 1 })).toHaveLength(5))
})
describe('distinctVocabulary', () => {
  it('fasst doppelte Vokabeln zusammen', () => expect(distinctVocabulary(entries).map((v) => v.vocabulary_id)).toEqual(['v1', 'v2', 'v3', 'v4']))
})
