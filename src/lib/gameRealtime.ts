import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import { rpc } from '../services/rpc'

/**
 * Spiel-Datenbanken für die Parkour-Echtzeit (Positionen, Bots, Zuschauer): fremde Supabase-Projekte, die nur Realtime
 * (Broadcast) brauchen. Dadurch zählen diese Nachrichten nicht auf das Kontingent der Haupt-Datenbank.
 * Die Liste pflegt der Admin in Verwaltung → Spiel-Datenbanken (Tabelle game_dbs, nur öffentliche Publishable Keys).
 * Der Server sagt über `slot` (parkour_usage_add), welche Datenbank gerade gilt: erst die erste, ist deren Monatsbudget
 * voll, die zweite usw. Fehlt die Liste (Migration noch nicht gelaufen), gelten die eingebauten Werte unten.
 */
export interface GameDb { url: string; key: string }

const FALLBACK: GameDb[] = [
  { url: 'https://xuqwinmiborgjvgsxscv.supabase.co', key: 'sb_publishable_G6CP3tpWXtrN0tsZN9V7KA_RkOnrtYB' },
  { url: 'https://kvkpjbdkezquvfdrdkjo.supabase.co', key: 'sb_publishable_RFKGqSIUdOHXX68MGN0H3A_fH5V8YT4' },
]

function envList(): GameDb[] | null {
  const u1 = (import.meta.env.VITE_GAME_SUPABASE_URL as string | undefined)?.trim()
  const k1 = (import.meta.env.VITE_GAME_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim()
  const u2 = (import.meta.env.VITE_GAME2_SUPABASE_URL as string | undefined)?.trim()
  const k2 = (import.meta.env.VITE_GAME2_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim()
  const out: GameDb[] = []
  if (u1 && k1) out.push({ url: u1, key: k1 })
  if (u2 && k2) out.push({ url: u2, key: k2 })
  return out.length ? out : null
}

const made = new Map<string, SupabaseClient>()
function clientFor(d: GameDb): SupabaseClient {
  const id = `${d.url}|${d.key}`
  let c = made.get(id)
  if (!c) {
    c = createClient(d.url, d.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, realtime: { params: { eventsPerSecond: 40 } } })
    made.set(id, c)
  }
  return c
}

let list: GameDb[] = envList() ?? FALLBACK

let current = 0
/** Welche Datenbank gerade gilt (0, 1, …). Wird bei jeder Meldung vom Server gesetzt. */
export function setGameSlot(slot: number): boolean {
  const s = Math.max(0, Math.min(Math.floor(slot) || 0, list.length - 1))
  const changed = s !== current
  current = s
  return changed
}
export const getGameSlot = () => current
/**
 * Feste Datenbank für ein Spiel (aus der Spiel-ID): alle Mitspielenden landen sicher auf demselben Projekt, auch wenn ihre
 * „aktuelle“ Datenbank (Monatsbudget) gerade verschieden ist. Sonst sehen sie sich gegenseitig nicht.
 */
export function slotForKey(key: string): number {
  if (list.length <= 1) return 0
  let h = 2166136261
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) % list.length
}
/** Der Client der gerade geltenden Spiel-Datenbank. */
export const gameRealtime = (): SupabaseClient => (list.length ? clientFor(list[Math.min(current, list.length - 1)]) : supabase)
/** Client einer bestimmten Datenbank (zum sauberen Abbauen eines Kanals). */
export const gameClientFor = (slot: number): SupabaseClient => (list.length ? clientFor(list[Math.max(0, Math.min(slot, list.length - 1))]) : supabase)

let loadedAt = 0
let loading: Promise<void> | null = null
/** Liste vom Server holen (höchstens alle 5 Minuten neu). Bei Fehlern bleibt die bisherige Liste. */
export function whenGameDbsReady(): Promise<void> {
  if (Date.now() - loadedAt < 300_000) return Promise.resolve()
  if (!loading) {
    loading = rpc<GameDb[]>('parkour_game_dbs')
      .then((r) => { if (Array.isArray(r) && r.length > 0) { list = r.filter((x) => x?.url && x?.key); current = Math.min(current, list.length - 1) } loadedAt = Date.now() })
      .catch(() => { loadedAt = Date.now() - 240_000 /* in einer Minute nochmal versuchen */ })
      .finally(() => { loading = null })
  }
  return loading
}
