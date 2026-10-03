import { supabase } from '../lib/supabaseClient'
import type { AppSettings, OnlineUser, SentMessage, UserMessage, FeedbackItem, FeedbackKind, FeedbackStatus, KoinCode, LedgerEntry, RedeemResult, ShopItem } from '../types'
import { rpc } from './rpc'

/** Guthaben, Codes, Shop, Feedback. */

export const getWallet = () => rpc<number>('get_wallet')
export const claimDailyBonus = () => rpc<number>('claim_daily_bonus')
export const redeemCode = (code: string) => rpc<RedeemResult>('redeem_code', { p_code: code })

export async function listLedger(limit = 30): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from('koin_ledger')
    .select('id,amount,reason,ref,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as LedgerEntry[]
}

export const getShop = () => rpc<ShopItem[]>('get_shop')
export const buyItem = (id: string) => rpc<number>('buy_item', { p_item_id: id })
export const equipItem = (id: string) => rpc<void>('equip_item', { p_item_id: id })
export const unequipItem = (kind: string) => rpc<void>('unequip_item', { p_kind: kind })

export const submitFeedback = (kind: FeedbackKind, message: string) => rpc<string>('submit_feedback', { p_kind: kind, p_message: message })
export const listFeedback = (status: FeedbackStatus | 'all') => rpc<FeedbackItem[]>('list_feedback', { p_status: status })
export const setFeedbackStatus = (id: string, status: Exclude<FeedbackStatus, 'new'>, note: string, reward: number) =>
  rpc<void>('set_feedback_status', { p_id: id, p_status: status, p_note: note, p_reward: reward })

export async function listMyFeedback(): Promise<FeedbackItem[]> {
  const { data, error } = await supabase
    .from('feedback')
    .select('id,kind,message,status,staff_note,created_at')
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return (data ?? []) as FeedbackItem[]
}

export async function getAppSettings(): Promise<AppSettings> {
  const { data, error } = await supabase.from('app_settings').select('key,value')
  if (error) throw error
  return Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value as number]))
}

export async function getModEditable(): Promise<Record<string, boolean>> {
  const { data, error } = await supabase.from('app_settings').select('key,mod_editable')
  if (error) throw error
  return Object.fromEntries((data ?? []).map((r) => [r.key as string, !!r.mod_editable]))
}

export const staffSetSetting = (key: string, value: number) => rpc<void>('staff_set_setting', { p_key: key, p_value: value })
export const adminSetSetting = (key: string, value: number) => rpc<void>('admin_set_setting', { p_key: key, p_value: value })
export const adminGrantKoins = (userId: string, amount: number, note: string) =>
  rpc<number>('admin_grant_koins', { p_user: userId, p_amount: amount, p_note: note })
export const adminCreateCodes = (amount: number | null, count: number, note: string) =>
  rpc<string[]>('admin_create_codes', { p_amount: amount, p_count: count, p_note: note })
export const adminListCodes = () => rpc<KoinCode[]>('admin_list_codes')
export const adminDeleteCode = (code: string) => rpc<void>('admin_delete_code', { p_code: code })
export const adminSetBookPrice = (bookId: string, price: number) => rpc<void>('admin_set_book_price', { p_book_id: bookId, p_price: price })
export const adminSetItem = (id: string, price: number, active: boolean) =>
  rpc<void>('admin_set_item', { p_item_id: id, p_price: price, p_active: active })

/** Alle Artikel inkl. deaktivierter (nur Admin-Verwaltung). */
export interface AdminShopItem {
  id: string
  kind: string
  name: string
  price: number
  active: boolean
}
export async function adminListItems(): Promise<AdminShopItem[]> {
  const { data, error } = await supabase.from('shop_items').select('id,kind,name,price,active').order('kind').order('sort')
  if (error) throw error
  return (data ?? []) as AdminShopItem[]
}

/* ---------- Online-Anzeige und Nachrichten ---------- */

export const sendHeartbeat = () => rpc<void>('heartbeat')
export const adminListOnline = () => rpc<OnlineUser[]>('admin_list_online')
export const getUnreadMessages = () => rpc<UserMessage[]>('get_unread_messages')
export const markMessagesRead = (ids: string[]) => rpc<void>('mark_messages_read', { p_ids: ids })
/** userId = null → an alle. Gibt die Zahl der Empfänger zurück. */
export const adminSendMessage = (userId: string | null, body: string) => rpc<number>('admin_send_message', { p_user: userId, p_body: body })
export const adminListMessages = () => rpc<SentMessage[]>('admin_list_messages')
