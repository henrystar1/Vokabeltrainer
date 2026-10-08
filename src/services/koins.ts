import { supabase } from '../lib/supabaseClient'
import type { AppSettings, OnlineUser, SentMessage, UserMessage, FeedbackItem, FeedbackKind, FeedbackStatus, KoinCode, LedgerEntry, RedeemResult, ShopItem, ShopKind } from '../types'
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

export const deleteMyMessages = (ids: string[]) => rpc<void>('delete_my_messages', { p_ids: ids })

/* ---------- Mod-Rechte, Artikel verschenken, Tags ---------- */

export interface MyPermissions {
  staff: boolean
  alphamod: boolean
  admin: boolean
  /** Darf mindestens eine Zahl ändern. */
  settings: boolean
  /** Darf alle Zahlen ändern. */
  settings_all: boolean
  /** Zahlen, die ich ändern darf. */
  setting_keys: string[]
  shop: boolean
  books_all: boolean
  timeout_max: number
}
export const getMyPermissions = () => rpc<MyPermissions>('get_my_permissions')

export interface ModBook { id: string; name: string; language: string; owner_name: string; vocab_count: number; mod_access: boolean }
export const adminListPublicBooks = () => rpc<ModBook[]>('admin_list_public_books')
export const adminSetModBook = (bookId: string, allowed: boolean) => rpc<void>('admin_set_mod_book', { p_book: bookId, p_allowed: allowed })
export const adminSetModEditable = (key: string, value: boolean) => rpc<void>('admin_set_mod_editable', { p_key: key, p_value: value })
export const adminGrantItem = (userId: string, itemId: string, equip: boolean) =>
  rpc<void>('admin_grant_item', { p_user: userId, p_item_id: itemId, p_equip: equip })
export const setTagsHidden = (hidden: boolean) => rpc<void>('set_tags_hidden', { p_hidden: hidden })

/* ---------- Rechte je Mod/Alphamod ---------- */

export type RightMode = 'none' | 'selected' | 'all'
export interface StaffRow { user_id: string; display_name: string; role: 'mod' | 'alphamod'; books_mode: RightMode | null; set_mode: RightMode | null; shop: boolean | null; timeout_max: number | null; book_count: number; setting_count: number }
export interface StaffRights { books_mode: RightMode | null; set_mode: RightMode | null; shop: boolean | null; timeout_max: number | null; book_ids: string[]; setting_keys: string[] }
export const adminListStaff = () => rpc<StaffRow[]>('admin_list_staff')
export const adminGetStaffRights = (userId: string) => rpc<StaffRights>('admin_get_staff_rights', { p_user: userId })
export const adminSetStaffRights = (userId: string, r: Pick<StaffRights, 'books_mode' | 'set_mode' | 'shop' | 'timeout_max'>) =>
  rpc<void>('admin_set_staff_rights', { p_user: userId, p_books_mode: r.books_mode, p_set_mode: r.set_mode, p_shop: r.shop, p_timeout: r.timeout_max })
export const adminSetStaffBook = (userId: string, bookId: string, allowed: boolean) => rpc<void>('admin_set_staff_book', { p_user: userId, p_book: bookId, p_allowed: allowed })
export const adminSetStaffSetting = (userId: string, key: string, allowed: boolean) => rpc<void>('admin_set_staff_setting', { p_user: userId, p_key: key, p_allowed: allowed })
export const adminResetStaffRights = (userId: string) => rpc<void>('admin_reset_staff_rights', { p_user: userId })

/* ---------- Eigene Shop-Artikel ---------- */

export const getCustomItems = () => rpc<import('../types').CustomItem[]>('get_custom_items')
export interface SaveItemInput {
  id: string | null
  kind: ShopKind
  name: string
  price: number
  requiredRole: 'mod' | 'admin' | null
  style: Record<string, unknown> | null
  svg: string | null
  active: boolean
}
export const adminSaveItem = (i: SaveItemInput) =>
  rpc<string>('admin_save_item', { p_id: i.id, p_kind: i.kind, p_name: i.name, p_price: i.price, p_required_role: i.requiredRole, p_style: i.style, p_svg: i.svg, p_active: i.active })
export const adminDeleteItem = (id: string) => rpc<void>('admin_delete_item', { p_id: id })
export interface UserItem { item_id: string; kind: ShopKind; name: string; equipped: boolean }
export const adminListUserItems = (userId: string) => rpc<UserItem[]>('admin_list_user_items', { p_user: userId })
export const adminRevokeItem = (userId: string, itemId: string) => rpc<void>('admin_revoke_item', { p_user: userId, p_item_id: itemId })
export const setHidePresence = (hidden: boolean) => rpc<void>('set_hide_presence', { p_hidden: hidden })

// --- Funktionen sperren (Admin) ---
export type LockKey = 'games' | 'gambling' | 'sprint' | 'duels' | 'chat' | 'shop' | 'quests'
export interface LockRule { days: number[]; from: string; to: string }
export interface FeatureLock { key: LockKey; off_until: string | null; rules: LockRule[]; note: string; locked_now: boolean }
export const getLockedFeatures = () => rpc<LockKey[]>('get_locked_features')
export const adminGetFeatureLocks = () => rpc<FeatureLock[]>('admin_get_feature_locks')
export const adminSetFeatureLock = (key: LockKey, offUntil: string | null, rules: LockRule[], note: string) =>
  rpc<void>('admin_set_feature_lock', { p_key: key, p_off_until: offUntil, p_rules: rules, p_note: note })
