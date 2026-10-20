import type { AdminLeague, Flair, ChatMessage, Duel, DuelDetail, DuelSubmitResult, League, PlayerHit, PoolVocab, Quest, QuestId, SprintRow, Streak } from '../types'
import { rpc } from './rpc'

export const getMistakePool = (bookId: string | null) => rpc<PoolVocab[]>('get_mistake_pool', { p_book_id: bookId })

export const submitSprint = (score: number, total: number) => rpc<{ best: number; earned: number }>('submit_sprint', { p_score: score, p_total: total })
export const buySprintTime = (seconds: number) => rpc<{ balance: number; bonus: number; cost: number }>('buy_sprint_time', { p_seconds: seconds })
export const getSprintBonus = () => rpc<number>('get_sprint_bonus')
export const getSprintBoard = () => rpc<SprintRow[]>('get_sprint_board')

export const getStreak = () => rpc<Streak>('get_streak')
export const getQuests = () => rpc<Quest[]>('get_quests')
export const claimQuest = (id: QuestId) => rpc<number>('claim_quest', { p_id: id })

export const getLeague = () => rpc<League>('get_league')
/** Nur Admins: jede Liga ansehen, auch fremde. */
export async function adminGetLeague(tier: number): Promise<AdminLeague> {
  const r = await rpc<Omit<AdminLeague, 'participants' | 'relegation_active' | 'last'>>('admin_get_league', { p_tier: tier })
  const active = r.counts.find((c) => c.tier === tier)?.active ?? 0
  return { ...r, participants: active, relegation_active: active >= 8, last: null }
}
/** Mathe-Ergebnis melden: Punkte und Coins. */
export const submitMath = (correct: number, total: number, seconds: number) =>
  rpc<{ points: number; coins: number }>('submit_math', { p_correct: correct, p_total: total, p_seconds: seconds })

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

export type GameId = 'snake' | 'tetris' | 'blast' | 'crossy' | 'flappy' | 'wave' | 'g2048' | 'memory' | 'bricks' | 'mole' | 'jump' | 'coreball'
export interface GameStart { id: string; record: number; fee: number; balance: number }
export interface GameResult { score: number; record: boolean; prev_record: number; reward: number; balance: number }
export interface GameBoardRow extends Flair { rank: number; display_name: string; score: number; is_me: boolean }
export const getGameBoard = (game: GameId) => rpc<GameBoardRow[]>('get_game_board', { p_game: game })

export const getChatUnread = () => rpc<number>('chat_unread_count')
export const markChatRead = (id: number) => rpc<void>('chat_mark_read', { p_id: id })
export const timeoutChatUser = (messageId: number, minutes: number) =>
  rpc<void>('staff_timeout_message', { p_message_id: messageId, p_minutes: minutes })
export interface RouletteBet { t: 'straight' | 'red' | 'black' | 'even' | 'odd' | 'low' | 'high' | 'dozen' | 'column'; v?: number; a: number }
export interface RouletteResult { number: number; color: 'green' | 'red' | 'black'; bets: Array<RouletteBet & { win: boolean; pay: number }>; bet: number; payout: number; balance: number }
export const gamblingRoulette = (bets: RouletteBet[]) => rpc<RouletteResult>('gambling_roulette', { p_bets: bets })
export const gamblingDice = (bet: number, over: boolean, target: number) =>
  rpc<{ roll: number; chance: number; win: boolean; bet: number; payout: number; balance: number }>('gambling_dice', { p_bet: bet, p_over: over, p_target: target })
export const gamblingWheel = (bet: number) =>
  rpc<{ index: number; tenths: number; segments: number[]; bet: number; payout: number; balance: number }>('gambling_wheel', { p_bet: bet })
export interface BlackjackState {
  done: boolean
  result: 'blackjack' | 'win' | 'push' | 'lose' | 'bust' | null
  bet: number
  payout: number
  balance: number
  player: number[]
  player_total: number
  dealer: number[]
  dealer_total: number
  can_double: boolean
}
export const blackjackStart = (bet: number) => rpc<BlackjackState>('blackjack_start', { p_bet: bet })
export const blackjackAction = (action: 'hit' | 'stand' | 'double') => rpc<BlackjackState>('blackjack_action', { p_action: action })
export const blackjackCurrent = () => rpc<BlackjackState | null>('blackjack_current', {})
export const gamblingPlay = (bet: number) =>
  rpc<{ reels: number[]; mult: number; payout: number; bet: number; balance: number }>('gambling_play', { p_bet: bet })
export const submitChoice = (correct: number, total: number) =>
  rpc<{ points: number; coins: number }>('submit_choice', { p_correct: correct, p_total: total })

export const startGame = (game: GameId) => rpc<GameStart>('start_game', { p_game: game })
export const finishGame = (id: string, score: number) => rpc<GameResult>('finish_game', { p_id: id, p_score: score })
