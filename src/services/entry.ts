import type { PageData, SaveEntryResult } from '../types'
import { rpc } from './rpc'

export const getPage = (bookId: string, page: number) =>
  rpc<PageData>('get_page_entries', { p_book_id: bookId, p_page_number: page })

export interface SaveEntryInput {
  bookId: string
  unit: number
  page: number
  placementId: string | null
  german: string
  translations: string[]
  position: number | null
}

export const saveEntry = (i: SaveEntryInput) =>
  rpc<SaveEntryResult>('save_vocab_entry', {
    p_book_id: i.bookId,
    p_unit_number: i.unit,
    p_page_number: i.page,
    p_placement_id: i.placementId,
    p_german: i.german.trim(),
    p_translations: i.translations,
    p_position: i.position,
  })

export const deleteEntry = (placementId: string) => rpc<void>('delete_vocab_entry', { p_placement_id: placementId })
