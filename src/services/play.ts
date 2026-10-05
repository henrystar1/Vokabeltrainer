import type { Flair, ChatMessage, Duel, DuelDetail, DuelSubmitResult, League, PlayerHit, PoolVocab, Quest, QuestId, SprintRow, Streak } from '../types'
import { rpc } from './rpc'

export const getMistakePool = (bookId: string | null) => rpc<PoolVocab[]>('get_mistake_pool', { p_book_id: bookId })

export const submitSprint = (score: number, total: number) => rpc<{ best: number; earned: number }>('submit_sprint', { p_score: score, p_total: total })
export const getSprintBoard = () => rpc<SprintRow[]>('get_sprint_board')

export const getStreak = () => rpc<Streak>('get_streak')
export const getQuests = () => rpc<Quest[]>('get_quests')
export const claimQuest = (id: QuestId) => rpc<number>('claim_quest', { p_id: id })

export const getLeague = () => rpc<League>('get_league')

export const searchPlayers = (query: string) => rpc<PlayerHit[]>('search_players', { p_query: query })
export const createDuel = (opponent: string, count = 10) => rpc<string>('create_duel', { p_opponent: opponent, p_count: count })
export const listDuels = () => rpc<Duel[]>('list_duels')
export const getDuel = (id: string) => rpc<DuelDetail>('get_duel', { p_id: id })
export const submitDuel = (id: string, correct: number, total: number, millis: number) =>
  rpc<DuelSubmitResult>('submit_duel', { p_id: id, p_correct: correct, p_total: total, p_millis: millis })
export const cancelDuel = (id: string) => rpc<void>('cancel_duel', { p_id: id })

export const getChat = (limit = 100) => rpc<ChatMessage[]>('get_chat', { p_limit: limit })
export const postChat = (body: string) => rpc<number>('post_chat', { p_body: body })
export const deleteChatMessage = (id: number) => rpc<void>('delete_chat_message', { p_id: id })

export type GameId = 'snake' | 'tetris' | 'blast' | 'crossy' | 'flappy'
export interface GameStart { id: string; record: number; fee: number; balance: number }
export interface GameResult { score: number; record: boolean; prev_record: number; reward: number; balance: number }
export interface GameBoardRow extends Flair { rank: number; display_name: string; score: number; is_me: boolean }
export const getGameBoard = (game: GameId) => rpc<GameBoardRow[]>('get_game_board', { p_game: game })

export const getChatUnread = () => rpc<number>('chat_unread_count')
export const markChatRead = (id: number) => rpc<void>('chat_mark_read', { p_id: id })
export const timeoutChatUser = (messageId: number, minutes: number) =>
  rpc<void>('staff_timeout_message', { p_message_id: messageId, p_minutes: minutes })
export const gamblingPlay = (bet: number) =>
  rpc<{ reels: number[]; mult: number; payout: number; bet: number; balance: number }>('gambling_play', { p_bet: bet })
export const submitChoice = (correct: number, total: number) =>
  rpc<{ points: number; coins: number }>('submit_choice', { p_correct: correct, p_total: total })

export const startGame = (game: GameId) => rpc<GameStart>('start_game', { p_game: game })
export const finishGame = (id: string, score: number) => rpc<GameResult>('finish_game', { p_id: id, p_score: score })
