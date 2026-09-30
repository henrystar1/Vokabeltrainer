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
