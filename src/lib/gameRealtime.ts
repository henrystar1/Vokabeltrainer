import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

/**
 * Zwei weitere Supabase-Projekte nur für die Parkour-Echtzeit (Positionen, Bots, Zuschauer). Dadurch zählen diese
 * Nachrichten nicht auf das Kontingent der Haupt-Datenbank. Sie brauchen weder Tabellen noch eine Anmeldung, nur
 * Realtime (Broadcast). Die Publishable Keys sind öffentlich. Der Server sagt über `slot` (parkour_usage_add), welche
 * Datenbank gerade gilt: erst die erste, ist deren Monatsbudget voll, die zweite. Per Build-Variable änderbar
 * (VITE_GAME_SUPABASE_URL / _PUBLISHABLE_KEY und VITE_GAME2_...). Ohne Werte läuft alles über die Haupt-Datenbank.
 */
const SLOTS: Array<{ url: string; key: string }> = [
  {
    url: (import.meta.env.VITE_GAME_SUPABASE_URL as string | undefined)?.trim() || 'https://xuqwinmiborgjvgsxscv.supabase.co',
    key: (import.meta.env.VITE_GAME_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || 'sb_publishable_G6CP3tpWXtrN0tsZN9V7KA_RkOnrtYB',
  },
  {
    url: (import.meta.env.VITE_GAME2_SUPABASE_URL as string | undefined)?.trim() || 'https://kvkpjbdkezquvfdrdkjo.supabase.co',
    key: (import.meta.env.VITE_GAME2_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || 'sb_publishable_RFKGqSIUdOHXX68MGN0H3A_fH5V8YT4',
  },
]

const clients: SupabaseClient[] = SLOTS.filter((s) => s.url && s.key).map((s) =>
  createClient(s.url, s.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, realtime: { params: { eventsPerSecond: 40 } } }),
)
if (clients.length === 0) clients.push(supabase)

/** Anzahl der Spiel-Datenbanken. */
export const GAME_SLOTS = clients.length

let current = 0
/** Welche Datenbank gerade gilt (0 oder 1). Wird bei jeder Meldung vom Server gesetzt. */
export function setGameSlot(slot: number): boolean {
  const s = Math.max(0, Math.min(Math.floor(slot) || 0, clients.length - 1))
  const changed = s !== current
  current = s
  return changed
}
export const getGameSlot = () => current
/** Der Client der gerade geltenden Spiel-Datenbank. */
export const gameRealtime = (): SupabaseClient => clients[current]
/** Client einer bestimmten Datenbank (zum sauberen Abbauen eines Kanals). */
export const gameClientFor = (slot: number): SupabaseClient => clients[Math.max(0, Math.min(slot, clients.length - 1))]
