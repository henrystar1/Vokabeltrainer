import type { PoolVocab } from '../types'
import type { AnswerRecord } from '../features/learning/session'
import { rpc } from './rpc'

export const getLearningPool = (language: string | null, bookId: string | null) =>
  rpc<PoolVocab[]>('get_learning_pool', { p_language: language, p_book_id: bookId })

export interface SubmitInput {
  bookId: string | null
  mode: 'learn' | 'test'
  affectsLevel: boolean
  startedAt: Date
  answers: AnswerRecord[]
  levelUpdates: Record<string, number>
}

export const submitSession = (i: SubmitInput) =>
  rpc<string>('submit_session', {
    p_book_id: i.bookId,
    p_mode: i.mode,
    p_affects_level: i.affectsLevel,
    p_started_at: i.startedAt.toISOString(),
    p_answers: i.answers,
    p_level_updates: Object.entries(i.levelUpdates).map(([vocabulary_id, level]) => ({ vocabulary_id, level })),
  })

export const addRepeatAnswers = (sessionId: string, answers: AnswerRecord[]) =>
  rpc<number>('add_repeat_answers', { p_session_id: sessionId, p_answers: answers })

export type BookBox = { book_id: string; fach: number[] }
/** Fächer-Verteilung je Buch (Migration 0082). */
export const getBookBoxes = () => rpc<BookBox[]>('get_book_boxes')

export interface CardBoxItem {
  vocabulary_id: string
  book_id: string
  german: string
  translations: string[]
  level: number
  right: number
  wrong: number
  last_at: string | null
}
/** Karteikasten (Migration 0082): alle aktiven Karten mit Fach und Trefferquote. */
export const getCardBox = (language: string | null, bookId: string | null) =>
  rpc<CardBoxItem[]>('get_card_box', { p_language: language, p_book_id: bookId })
