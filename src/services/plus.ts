import { rpc } from './rpc'

/** Vokabeltrainer + : Status, Anfrage, Tageskauf (Nutzer) und Verwaltung (Admin). */

export type AiState = 'no_key' | 'ok' | 'empty' | 'error'

export interface PlusStatus {
  active: boolean
  until: string | null
  is_admin: boolean
  trial_available: boolean
  requested: boolean
  price_cents: number
  days: number
  coin_price: number
  coin_days: number
  ai_enabled: boolean
  ai_state: AiState
  ai_message: string
  max_items: number
  test_sentences: number
}

export const getPlusStatus = () => rpc<PlusStatus>('plus_status')
export const plusRequest = () => rpc<void>('plus_request')
export const plusCancelRequest = () => rpc<void>('plus_cancel_request')
export const plusBuyDay = () => rpc<PlusStatus>('plus_buy_day')

export interface PlusRequestRow { user_id: string; name: string; created_at: string; plus_until: string | null }
export interface PlusActiveRow { user_id: string; name: string; until: string }
export interface PlusSale { id: number; user_id: string | null; name: string; kind: 'paid' | 'gift' | 'coins'; cents: number; days: number; note: string; created_at: string }
export interface PlusOverview {
  requests: PlusRequestRow[]
  active: PlusActiveRow[]
  sales: PlusSale[]
  ai: {
    state: AiState
    message: string
    updated_at: string
    month_cost_cents: number
    month_generations: number
    month_tokens: number
    sets: number
    sentences: number
  }
}
export interface PlusSettingRow { key: string; value: number; label: string; hint: string; unit: string; sort: number; min_value: number; max_value: number }
export interface GoalEntry { id: number; cents: number; note: string; created_at: string }
export interface GoalBreakdown {
  print_cents: number
  plus_cents: number
  manual_cents: number
  ai_cost_cents: number
  offset_cents: number
  total_cents: number
  goal_cents: number
  entries: GoalEntry[]
}

export const adminPlusOverview = () => rpc<PlusOverview>('admin_plus_overview')
export const adminPlusCounts = () => rpc<{ requests: number; ai_problem: boolean }>('admin_plus_counts')
export const adminPlusGrant = (user: string, days: number, paidCents: number, note: string) =>
  rpc<string>('admin_plus_grant', { p_user: user, p_days: days, p_paid_cents: paidCents, p_note: note })
export const adminPlusReject = (user: string, note: string) => rpc<void>('admin_plus_reject', { p_user: user, p_note: note })
export const adminPlusRevoke = (user: string) => rpc<void>('admin_plus_revoke', { p_user: user })
export const adminPlusUndoSale = (id: number) => rpc<void>('admin_plus_undo_sale', { p_id: id })
export const adminPlusGetSettings = () => rpc<PlusSettingRow[]>('admin_plus_get_settings')
export const adminPlusSetSetting = (key: string, value: number) => rpc<void>('admin_plus_set_setting', { p_key: key, p_value: value })
export const adminGoalBreakdown = () => rpc<GoalBreakdown>('admin_goal_breakdown')
export const adminGoalAdd = (cents: number, note: string) => rpc<void>('admin_goal_add', { p_cents: cents, p_note: note })
export const adminGoalDelete = (id: number) => rpc<void>('admin_goal_delete', { p_id: id })

/** Cent → „3,00 €“. */
export function euro(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`
}
