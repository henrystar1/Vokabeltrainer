import { rpc } from './rpc'

/** Hausaufgaben (Mods tragen ein, alle haken für sich ab) und Website-Links (Admins). Migration 0060. */
export interface Homework {
  id: string
  title: string
  body: string
  subject: string
  due_date: string | null
  created_at: string
  created_by_name: string | null
  done: boolean
  done_count: number
}
export interface SiteLink { id: string; title: string; url: string; description: string; image_url: string; sort: number }

export const homeworkList = () => rpc<Homework[]>('homework_list')
export const homeworkSave = (id: string | null, title: string, body: string, subject: string, due: string | null) =>
  rpc<string>('homework_save', { p_id: id, p_title: title, p_body: body, p_subject: subject, p_due: due })
export const homeworkDelete = (id: string) => rpc<void>('homework_delete', { p_id: id })
export const homeworkSetDone = (id: string, done: boolean) => rpc<void>('homework_set_done', { p_id: id, p_done: done })

export const siteLinksList = () => rpc<SiteLink[]>('site_links_list')
export const siteLinkSave = (id: string | null, title: string, url: string, description: string, image: string, sort: number) =>
  rpc<string>('site_link_save', { p_id: id, p_title: title, p_url: url, p_description: description, p_image: image, p_sort: sort })
export const siteLinkDelete = (id: string) => rpc<void>('site_link_delete', { p_id: id })

/** Ranglisten für Pi und Flaggen (Migration 0062) */
export type MemoGame = 'pi' | 'flags'
export interface MemoRow { rank: number; user_id: string; display_name: string; best: number; is_me: boolean }
export interface MemoReward { best: number; coins: number; points: number; rejected?: boolean }
export const memoScoreSubmit = (game: MemoGame, score: number) => rpc<MemoReward>('memo_score_submit', { p_game: game, p_score: Math.max(0, Math.floor(score)) })
/** Pi-Versuch auf dem Server starten (Zeitprüfung gegen Schummeln, Migration 0072). */
export const memoPiStart = () => rpc<void>('memo_pi_start')
/** Nur Admin: Rekord einer Person (oder aller) löschen. */
export const adminMemoDelete = (game: MemoGame, user: string | null) => rpc<number>('admin_memo_delete', { p_game: game, p_user: user })
export const memoLeaderboard = (game: MemoGame) => rpc<MemoRow[]>('memo_leaderboard', { p_game: game })

/** Adventskalender (Migration 0065) */
export type AdventReward =
  | { type: 'coins'; amount: number; dup?: string }
  | { type: 'points'; amount: number }
  | { type: 'plus'; days: number }
  | { type: 'item'; id: string; kind: 'avatar' | 'color' | 'effect' | 'theme' | 'tag'; name: string; price: number }
export interface AdventStatus { state: 'before' | 'active' | 'over'; today: number; year: number; opened: Array<{ day: number; rewards: AdventReward[] }> }
export const adminAdventReset = (all: boolean) => rpc<number>('admin_advent_reset', { p_all: all })

/** Loot Drop (Migration 0074) */
export interface LootStatus {
  day: string
  personal: { opened: boolean; rewards: AdventReward[] }
  global: { opened: boolean; mine: boolean; by: string | null; rewards: AdventReward[] }
  gifts: Array<{ id: string; amount: number }>
}
export const lootStatus = () => rpc<LootStatus>('loot_status')
export const lootOpen = (kind: 'global' | 'personal') => rpc<{ kind: string; rewards: AdventReward[] }>('loot_open', { p_kind: kind })
export const lootGiftsSeen = () => rpc<void>('loot_gifts_seen')
export const adminLootGift = (count: number, amount: number) => rpc<string[]>('admin_loot_gift', { p_count: count, p_amount: amount })
export const adminLootReset = (all: boolean) => rpc<number>('admin_loot_reset', { p_all: all })
export const adventStatus = () => rpc<AdventStatus>('advent_status')
export const adventOpen = (day: number) => rpc<{ day: number; rewards: AdventReward[] }>('advent_open', { p_day: day })
