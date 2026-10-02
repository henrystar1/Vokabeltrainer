import type { PublicBook, ReviewRequest, ReviewStatus } from '../types'
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
export const resolveReviewRequest = (id: string, status: 'done' | 'dismissed', note: string) =>
  rpc<void>('resolve_review_request', { p_id: id, p_status: status, p_note: note })
export const countOpenReviews = () => rpc<number>('count_open_reviews')
