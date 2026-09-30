import type { SearchResult } from '../types'
import { rpc } from './rpc'

export interface SearchFilters {
  query: string
  bookId?: string
  language?: string
  unit?: number
  page?: number
}

export const searchVocabulary = (f: SearchFilters) =>
  rpc<SearchResult[]>('search_vocabulary', {
    p_query: f.query,
    p_book_id: f.bookId ?? null,
    p_language: f.language ?? null,
    p_unit_number: f.unit ?? null,
    p_page_number: f.page ?? null,
    p_limit: 100,
  })
