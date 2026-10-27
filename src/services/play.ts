import type { AdminLeague, Flair, ChatMessage, Duel, DuelDetail, DuelQuestion, DuelSubmitResult, League, PlayerHit, PoolVocab, Quest, QuestId, SprintRow, Streak } from '../types'
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

// ---- Live-Duell (Migration 0042) ----
export interface LivePlayer {
  user_id: string
  name: string
  state: 'joined' | 'invited' | 'left' | 'declined'
  answered: number
  correct: number
  finished: boolean
  millis: number | null
  place: number | null
  avatar_id: string | null
  color_id: string | null
  effect_id: string | null
  tag_id: string | null
  theme_id: string | null
  role: 'user' | 'mod' | 'alphamod' | 'admin'
}
export interface LiveState {
  id: string
  status: 'lobby' | 'running' | 'finished' | 'cancelled'
  is_host: boolean
  host_id: string
  me: string
  q_count: number
  max_players: number
  code: string | null
  is_class: boolean
  book_name: string | null
  /** Serverzeit, um den Countdown unabhängig von der Uhr des Geräts zu halten. */
  now: string
  starts_at: string | null
  players: LivePlayer[]
  questions: DuelQuestion[] | null
  /** Siegprämien: Live-Duell [Platz 1], Klassen-Battle [Platz 1, 2, 3]. */
  rewards: number[]
}
export interface LiveInvite { duel_id: string; host_name: string; host_avatar_id: string | null; host_color_id: string | null; players: number; created_at: string }
export const liveCreate = (invitees: string[], count = 10, bookId: string | null = null) => rpc<string>('live_create', { p_invitees: invitees, p_count: count, p_book: bookId })
export const liveJoinCode = (code: string) => rpc<string>('live_join_code', { p_code: code })
export const liveMyInvites = () => rpc<LiveInvite[]>('live_my_invites')
export const liveRespond = (id: string, accept: boolean) => rpc<void>('live_respond', { p_id: id, p_accept: accept })
export const liveLeave = (id: string) => rpc<void>('live_leave', { p_id: id })
export const liveStart = (id: string) => rpc<void>('live_start', { p_id: id })
export const liveGet = (id: string) => rpc<LiveState>('live_get', { p_id: id })
export const liveProgress = (id: string, answered: number, correct: number) => rpc<void>('live_progress', { p_id: id, p_answered: answered, p_correct: correct })
export const liveFinish = (id: string, correct: number, millis: number) => rpc<void>('live_finish', { p_id: id, p_correct: correct, p_millis: millis })

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

// ---- Offene Klassen-Battles und Team-Parcours (Migration 0044) ----
export interface OpenClass { duel_id: string; host_name: string; host_avatar_id: string | null; host_color_id: string | null; book_name: string | null; players: number; max_players: number; created_at: string }
export const liveOpenClasses = () => rpc<OpenClass[]>('live_open_classes')
export const liveJoinOpen = (id: string) => rpc<string>('live_join_open', { p_id: id })

export interface TeamPerson {
  user_id: string
  name: string
  avatar_id: string | null
  color_id: string | null
  effect_id: string | null
  tag_id: string | null
  theme_id: string | null
  role: 'user' | 'mod' | 'alphamod' | 'admin'
  is_host: boolean
  /** Parkour-Shop: gekaufte Extra-Herzen, ausgerüstete Farbe und Hut (nur Parkour). */
  pk_hearts?: number
  pk_color?: string | null
  pk_hat?: string | null
  pk_fx?: string | null
  /** Auftritt: 'blackhole' (Admin) oder 'hammer' (Mod) */
  pk_look?: 'blackhole' | 'hammer' | 'piano' | null
  /** Parkour mit mehreren: host | invited | joined (declined/left werden nicht geliefert). */
  state?: 'host' | 'invited' | 'joined' | 'declined' | 'left'
}
export interface TeamQuestion extends DuelQuestion { idx: number }
export interface TeamState {
  id: string
  kind: 'quiz' | 'parkour' | 'deathrun'
  millis: number | null
  deaths: number | null
  /** Parkour: geschaffte Level und erreichte Checkpoints; Coins je Level / Checkpoint / Bonus für alle Level. */
  levels: number | null
  cps: number | null
  coins: [number, number, number]
  status: 'lobby' | 'running' | 'won' | 'lost' | 'cancelled'
  is_host: boolean
  me: string
  now: string
  starts_at: string | null
  obstacles: number
  lives: number
  lives_left: number
  step: number
  host_ok: boolean
  partner_ok: boolean
  partner_state: 'invited' | 'joined' | 'declined' | 'left'
  host_right: number
  host_wrong: number
  partner_right: number
  partner_wrong: number
  reward: number
  paid: number
  /** Deathrun: Ergebnis jeder Person, die fertig ist. */
  results?: DeathrunResult[] | null
  my_question: TeamQuestion | null
  people: TeamPerson[]
  /** Offene Deathrun-Lobby, Bots, Zuschauer-Modus (Admin), Wiedereinstieg (Migration 0050). */
  is_open?: boolean
  bots?: number
  bot_skill?: number
  spectator?: boolean
  can_rejoin?: boolean
  member?: boolean
  staff_present?: boolean
  can_manage?: boolean
  can_start?: boolean
  /** Team-Parkour: 0 normal, 1 Team gegen Bots, 2 Team gegen Team (Migration 0052). team_map: Person → Team (0 rot, 1 blau). */
  versus?: 0 | 1 | 2
  team_map?: Record<string, number>
  team_results?: Record<string, { levels: number; cps: number; millis: number; deaths: number }>
}
export interface DeathrunResult { user_id: string; name: string; levels: number; cps: number; millis: number; deaths: number; paid: number }
export interface TeamInvite { run_id: string; host_name: string; host_avatar_id: string | null; host_color_id: string | null; created_at: string; kind: 'quiz' | 'parkour' | 'deathrun' }
export const teamCreate = (partner: string, obstacles = 10, kind: 'quiz' | 'parkour' | 'deathrun' = 'parkour', extra: string[] = []) =>
  rpc<string>('team_create', { p_partner: partner, p_obstacles: obstacles, p_kind: kind, p_extra: extra })
export const teamParkourFinish = (id: string, millis: number, deaths: number, levels: number, cps: number) =>
  rpc<void>('team_parkour_finish', { p_id: id, p_millis: millis, p_deaths: deaths, p_levels: levels, p_cps: cps })
export const teamDeathrunFinish = (id: string, millis: number, deaths: number, levels: number, cps: number) =>
  rpc<void>('team_deathrun_finish', { p_id: id, p_millis: millis, p_deaths: deaths, p_levels: levels, p_cps: cps })
export interface DeathrunScore { name: string; avatar_id: string | null; color_id: string | null; levels: number; cps: number; millis: number; deaths: number; group_size: number; finished_at: string }
export const deathrunBoard = () => rpc<DeathrunScore[]>('deathrun_board')
export interface ParkourScore {
  host_name: string; host_avatar_id: string | null; host_color_id: string | null
  partner_name: string; partner_avatar_id: string | null; partner_color_id: string | null
  levels: number; cps: number; millis: number; deaths: number; finished_at: string
  group_size?: number
}
export const teamParkourBoard = () => rpc<ParkourScore[]>('team_parkour_board')

export interface ParkourShop {
  hearts: number
  heart_max: number
  /** Preis des nächsten Herzens, null = Maximum erreicht. */
  heart_price: number | null
  color: string | null
  hat: string | null
  owned: string[]
  fx?: string | null
  color_price: number
  hat_price: number
  fx_price?: number
}
/** Wer hat die Parkour-Lernfragen aus? (Migration 0053) */
export const parkourLearnOffList = (ids: string[]) => rpc<string[]>('parkour_learn_off_list', { p_ids: ids })
/** Admin: Lernfragen im Parkour für eine Person aus- (off) oder einschalten */
export const parkourLearnSet = (user: string, off: boolean) => rpc<void>('parkour_learn_set', { p_user: user, p_off: off })
export const parkourShopGet = () => rpc<ParkourShop>('parkour_shop_get')
export const parkourShopBuy = (item: string) => rpc<ParkourShop>('parkour_shop_buy', { p_item: item })
export const parkourEquip = (color: string | null, hat: string | null, fx?: string | null) =>
  rpc<ParkourShop>('parkour_equip', fx === undefined ? { p_color: color ?? '', p_hat: hat ?? '' } : { p_color: color ?? '', p_hat: hat ?? '', p_fx: fx ?? '' })
export const teamMyInvites = () => rpc<TeamInvite[]>('team_my_invites')
export const teamRespond = (id: string, accept: boolean) => rpc<void>('team_respond', { p_id: id, p_accept: accept })
export const teamLeave = (id: string) => rpc<void>('team_leave', { p_id: id })
export const teamStart = (id: string) => rpc<void>('team_start', { p_id: id })
export const teamGet = (id: string) => rpc<TeamState>('team_get', { p_id: id })
export const teamReport = (id: string, step: number, correct: boolean) => rpc<void>('team_report', { p_id: id, p_step: step, p_correct: correct })

// ---- Offene Deathrun-Lobby, Bots, Wiedereinstieg, Admin-Zuschauer (Migration 0050) ----
export const deathrunOpenJoin = () => rpc<string>('deathrun_open_join')
export const teamSetBots = (id: string, bots: number, skill: number, map?: Record<string, number>) => rpc<void>('team_set_bots', { p_id: id, p_bots: bots, p_skill: skill, p_map: map ?? null })
export const teamRejoin = (id: string) => rpc<void>('team_rejoin', { p_id: id })
export const teamSpectate = (id: string) => rpc<TeamState>('team_spectate', { p_id: id })
export interface AdminRun { id: string; kind: 'parkour' | 'deathrun'; status: 'lobby' | 'running'; is_open: boolean; bots: number; created_at: string; starts_at: string | null; players: string[] }
/** Darf ich Läufe ansehen, und mit welchem Auftritt komme ich ins Spiel? (Migration 0054) */
export type EntranceLook = 'blackhole' | 'hammer' | 'piano'
export interface RunPerks { spectate: boolean; look: EntranceLook | null; allowed: EntranceLook[]; entrance: string | null }
export const myRunPerks = () => rpc<RunPerks>('my_run_perks')
/** Auftritt wählen: 'blackhole' | 'hammer' | 'piano' | 'none' */
export const parkourSetEntrance = (look: EntranceLook | 'none') => rpc<RunPerks>('parkour_set_entrance', { p_look: look })
export const submitIrregular = (correct: number, total: number) => rpc<{ earned: number; cap_left: number }>('submit_irregular', { p_correct: correct, p_total: total })
export const adminOpenRuns = () => rpc<AdminRun[]>('admin_open_runs')
export const teamSetVersus = (id: string, mode: number, map: Record<string, number> = {}) => rpc<void>('team_set_versus', { p_id: id, p_mode: mode, p_map: map })
