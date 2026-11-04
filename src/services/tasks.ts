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
export const memoScoreSubmit = (game: MemoGame, score: number) => rpc<number>('memo_score_submit', { p_game: game, p_score: Math.max(0, Math.floor(score)) })
export const memoLeaderboard = (game: MemoGame) => rpc<MemoRow[]>('memo_leaderboard', { p_game: game })
