import { supabase } from '../lib/supabaseClient'
import type { PrintStatus } from '../lib/printShop'
import { rpc } from './rpc'

/** 3D-Druck-Shop: Katalog, Bestellungen, Verwaltung und Dateien (Supabase Storage). */

export const PRINT_BUCKET = 'print-files'

export interface PrintColor { id: string; name: string; hex: string; extra_cents: number }

export interface PrintProduct {
  id: string
  name: string
  description: string
  price_cents: number
  text_prompt: string | null
  image_path: string | null
  model_path: string | null
  colors: PrintColor[]
}

export interface PrintInfo {
  open: boolean
  rush_cents: number
  discount_coins: number
  discount_percent: number
  max_qty: number
  max_volume_cm3: number
  max_open_requests: number
  open_requests: number
  banned: boolean
  ban_reason: string | null
  ban_until: string | null
  colors: PrintColor[]
}

export interface QuoteLine { label: string; cents: number }
export interface PrintQuote {
  lines: QuoteLine[]
  item_cents: number | null
  minutes: number | null
  grams: number
  rush_cents: number
  discount_percent: number
  discount_cents: number | null
  final_cents: number | null
}

export interface PrintOrder {
  id: string
  user_id: string
  kind: 'shop' | 'custom'
  product_id: string | null
  title: string
  description: string
  color_id: string | null
  color_name: string | null
  color_hex: string | null
  qty: number
  custom_text: string | null
  upload_path: string | null
  photo_paths: string[]
  volume_cm3: number | null
  dims_mm: { x: number; y: number; z: number } | null
  estimate_cents: number | null
  offer_cents: number | null
  price_cents: number | null
  rush_cents: number
  discount_percent: number
  coins_spent: number
  status: PrintStatus
  admin_note: string
  print_minutes: number | null
  print_started_at: string | null
  progress_override: number | null
  breakdown: QuoteLine[] | null
  created_at: string
  updated_at: string
  delivered_at: string | null
  final_cents: number | null
  server_now: string
}

export interface AdminPrintOrder extends PrintOrder { user_name: string; user_banned: boolean }

export interface PrintCounts { angefragt: number; preis_vorgeschlagen: number; in_bearbeitung: number; druckt: number; lieferbereit: number; todo: number }

export interface AdminProduct {
  id: string
  name: string
  description: string
  price_cents: number
  print_minutes: number
  text_prompt: string | null
  color_ids: string[] | null
  image_path: string | null
  model_path: string | null
  active: boolean
  sort: number
}

export interface AdminColor { id: string; name: string; hex: string; extra_cents: number; active: boolean; sort: number }
export interface PrintSetting { key: string; value: number; label: string; unit: string; hint: string; min_value: number; max_value: number; sort: number }
export interface PrintBan { user_id: string; user_name: string; reason: string; until: string | null; active: boolean; created_at: string }

/* ---------- Kunden ---------- */

export const getPrintProducts = () => rpc<PrintProduct[]>('print_get_products')
export const getPrintInfo = () => rpc<PrintInfo>('print_get_info')
export const getMyPrintOrders = () => rpc<PrintOrder[]>('print_my_orders')

export interface QuoteArgs {
  kind: 'shop' | 'custom'
  product: string | null
  volume: number | null
  color: string | null
  qty: number
  rush: boolean
  discount: boolean
}
export const getPrintQuote = (a: QuoteArgs) =>
  rpc<PrintQuote>('print_quote', { p_kind: a.kind, p_product: a.product, p_volume: a.volume, p_color: a.color, p_qty: a.qty, p_rush: a.rush, p_discount: a.discount })

export interface CreateOrderArgs extends QuoteArgs {
  customText: string | null
  title: string | null
  description: string | null
  uploadPath: string | null
  photoPaths: string[]
  dims: { x: number; y: number; z: number } | null
  offerCents: number | null
}
export const createPrintOrder = (a: CreateOrderArgs) =>
  rpc<string>('print_create_order', {
    p_kind: a.kind, p_product: a.product, p_color: a.color, p_qty: a.qty, p_custom_text: a.customText, p_title: a.title,
    p_description: a.description, p_upload_path: a.uploadPath, p_photo_paths: a.photoPaths, p_volume: a.volume, p_dims: a.dims,
    p_offer_cents: a.offerCents, p_rush: a.rush, p_discount: a.discount,
  })

export const respondPrintOrder = (id: string, action: 'accept' | 'counter' | 'decline', offerCents?: number) =>
  rpc<void>('print_respond', { p_id: id, p_action: action, p_offer_cents: offerCents ?? null })
export const cancelPrintOrder = (id: string) => rpc<void>('print_cancel', { p_id: id })

/* ---------- Admin ---------- */

export const adminPrintOrders = (scope: 'open' | 'done') => rpc<AdminPrintOrder[]>('admin_print_orders', { p_scope: scope })
export const adminPrintCounts = () => rpc<PrintCounts>('admin_print_counts')

export type PrintAction = 'accept' | 'counter' | 'reject' | 'start' | 'progress' | 'ready' | 'delivered' | 'back' | 'note'
export const adminPrintAction = (id: string, action: PrintAction, o: { priceCents?: number | null; minutes?: number | null; note?: string | null; progress?: number | null } = {}) =>
  rpc<PrintOrder>('admin_print_action', { p_id: id, p_action: action, p_price_cents: o.priceCents ?? null, p_minutes: o.minutes ?? null, p_note: o.note ?? null, p_progress: o.progress ?? null })

export const adminPrintDeleteOrder = (id: string) => rpc<string[]>('admin_print_delete_order', { p_id: id })

export const adminPrintListProducts = () => rpc<AdminProduct[]>('admin_print_list_products')
export const adminPrintSaveProduct = (p: Omit<AdminProduct, 'id'> & { id: string | null }) =>
  rpc<string>('admin_print_save_product', {
    p_id: p.id, p_name: p.name, p_description: p.description, p_price_cents: p.price_cents, p_print_minutes: p.print_minutes,
    p_text_prompt: p.text_prompt, p_color_ids: p.color_ids, p_image_path: p.image_path, p_model_path: p.model_path, p_active: p.active, p_sort: p.sort,
  })
export const adminPrintDeleteProduct = (id: string) => rpc<string[]>('admin_print_delete_product', { p_id: id })

export const adminPrintListColors = () => rpc<AdminColor[]>('admin_print_list_colors')
export const adminPrintSaveColor = (c: Omit<AdminColor, 'id'> & { id: string | null }) =>
  rpc<string>('admin_print_save_color', { p_id: c.id, p_name: c.name, p_hex: c.hex, p_extra_cents: c.extra_cents, p_active: c.active, p_sort: c.sort })
export const adminPrintDeleteColor = (id: string) => rpc<void>('admin_print_delete_color', { p_id: id })

export const adminPrintGetSettings = () => rpc<PrintSetting[]>('admin_print_get_settings')
export const adminPrintSetSetting = (key: string, value: number) => rpc<void>('admin_print_set_setting', { p_key: key, p_value: value })

export const adminPrintBan = (userId: string, reason: string, days: number | null, rejectOpen = true) =>
  rpc<void>('admin_print_ban', { p_user: userId, p_reason: reason, p_days: days, p_reject_open: rejectOpen })
export const adminPrintUnban = (userId: string) => rpc<void>('admin_print_unban', { p_user: userId })
export const adminPrintListBans = () => rpc<PrintBan[]>('admin_print_list_bans')

/* ---------- Dateien ---------- */

export const newFilePath = (folder: string, ext: string) => `${folder}/${crypto.randomUUID()}.${ext}`

export async function uploadPrintFile(path: string, file: Blob): Promise<void> {
  const { error } = await supabase.storage.from(PRINT_BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
  if (error) throw error
}

export async function downloadPrintFile(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(PRINT_BUCKET).download(path)
  if (error) throw error
  return data
}

export async function removePrintFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const { error } = await supabase.storage.from(PRINT_BUCKET).remove(paths)
  if (error) throw error
}

const urlCache = new Map<string, { url: string; until: number }>()

/** Zeitlich begrenzte Bildadresse; wird zwischengespeichert, damit Karten nicht ständig neu laden. */
export async function signedPrintUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now()
  const out: Record<string, string> = {}
  const missing: string[] = []
  for (const p of paths) {
    const c = urlCache.get(p)
    if (c && c.until > now) out[p] = c.url
    else missing.push(p)
  }
  if (missing.length > 0) {
    const { data, error } = await supabase.storage.from(PRINT_BUCKET).createSignedUrls(missing, 3600)
    if (error) throw error
    for (const row of data ?? []) {
      if (row.path && row.signedUrl) {
        urlCache.set(row.path, { url: row.signedUrl, until: now + 50 * 60_000 })
        out[row.path] = row.signedUrl
      }
    }
  }
  return out
}

/* ---------- Verdienst-Anzeige ---------- */

export type PrintGoal = { visible: false } | { visible: true; goal_cents: number; earned_cents: number; percent: number }
export const getPrintGoal = () => rpc<PrintGoal>('print_get_goal')
export const adminPrintGoalReset = () => rpc<void>('admin_print_goal_reset')
