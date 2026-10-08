import type { BoardPost, CoinRow, GamblingRow, GamblingWin, PresenceRow } from '../types'
import { rpc } from './rpc'

/** Wer ist da, Coin-Rangliste, Gambling-Gewinne, Schwarzes Brett. */
export const getPresence = () => rpc<PresenceRow[]>('get_presence')
export const getCoinLeaderboard = () => rpc<CoinRow[]>('get_coin_leaderboard')
export const getMyCoinRank = () => rpc<number>('get_my_coin_rank')
export const getGamblingBoard = () => rpc<GamblingRow[]>('get_gambling_board')
export const getGamblingFeed = () => rpc<GamblingWin[]>('get_gambling_feed')

export const getBoard = () => rpc<BoardPost[]>('get_board')
export const saveBoardPost = (id: string | null, title: string, body: string, status: BoardPost['status']) =>
  rpc<string>('admin_save_board_post', { p_id: id, p_title: title, p_body: body, p_status: status })
export const deleteBoardPost = (id: string) => rpc<void>('admin_delete_board_post', { p_id: id })
