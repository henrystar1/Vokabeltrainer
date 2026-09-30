import { supabase } from '../lib/supabaseClient'
import type { CommunityAverages, LeaderboardPeriod, LeaderboardRow, MyStats, RecentSession } from '../types'
import { rpc } from './rpc'

export const getMyStats = (bookId: string | null = null) => rpc<MyStats>('get_my_stats', { p_book_id: bookId })
export const getLeaderboard = (period: LeaderboardPeriod) => rpc<LeaderboardRow[]>('get_leaderboard', { p_period: period })

export async function getCommunity(): Promise<CommunityAverages | null> {
  const rows = await rpc<CommunityAverages[]>('get_community_averages')
  return rows[0] ?? null
}

export async function getRecentSessions(limit = 5): Promise<RecentSession[]> {
  const { data, error } = await supabase
    .from('learning_sessions')
    .select('id,mode,started_at,answers_total,answers_correct,book_id')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as RecentSession[]
}
