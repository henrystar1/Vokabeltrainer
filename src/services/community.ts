import type { NextPageResult, PublicBook, ReviewRequest, ReviewStatus } from '../types'
import { rpc } from './rpc'

/** Öffentliche Bücher, Bibliothek und Prüfanfragen. */

export const listPublicBooks = () => rpc<PublicBook[]>('get_public_books')
export const addToLibrary = (bookId: string) => rpc<void>('add_to_library', { p_book_id: bookId })
export const removeFromLibrary = (bookId: string) => rpc<void>('remove_from_library', { p_book_id: bookId })
export const publishBook = (bookId: string) => rpc<void>('publish_book', { p_book_id: bookId })
export const unpublishBook = (bookId: string) => rpc<void>('unpublish_book', { p_book_id: bookId })

export const requestReview = (vocabularyId: string, message: string) =>
  rpc<string>('request_review', { p_vocabulary_id: vocabularyId, p_message: message })
export const listReviewRequests = (status: ReviewStatus | 'all') =>
  rpc<ReviewRequest[]>('list_review_requests', { p_status: status })
export const resolveReviewRequest = (id: string, status: 'done' | 'dismissed', note: string, reward = true) =>
  rpc<void>('resolve_review_request', { p_id: id, p_status: status, p_note: note, p_reward: reward })
/** Aktiviert/deaktiviert Vokabeln eines Buchs (ganz, pro Lektion oder pro Seite). Gibt die Zahl geänderter Zeilen zurück. */
export const setVocabActive = (bookId: string, active: boolean, unitNumber?: number, pageNumber?: number) =>
  rpc<number>('set_vocab_active', {
    p_book_id: bookId,
    p_active: active,
    p_unit_number: unitNumber ?? null,
    p_page_number: pageNumber ?? null,
  })
export const countOpenReviews = () => rpc<number>('count_open_reviews')

/** Schaltet die nächste Seite mit inaktiven Vokabeln frei (null = alles schon aktiv). */
export const activateNextPage = (bookId: string) => rpc<NextPageResult | null>('activate_next_page', { p_book_id: bookId })
/** Aktiviert alles bis einschließlich Unit/Seite. */
export const activateUpTo = (bookId: string, unit: number, page: number) =>
  rpc<number>('activate_up_to', { p_book_id: bookId, p_unit_number: unit, p_page_number: page })
