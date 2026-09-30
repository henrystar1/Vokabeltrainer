import { createClient } from '@supabase/supabase-js'

// Öffentliche Projektwerte als Rückfall, falls beim Build keine Variablen gesetzt sind
// (leere Werte zählen wie "nicht gesetzt"). Der Publishable Key ist für den Browser bestimmt;
// die Daten schützen die Row-Level-Security-Regeln.
const DEFAULT_URL = 'https://xdvaivcwxugluoctrvnj.supabase.co'
const DEFAULT_KEY = 'sb_publishable_vLaQQWmGWSx7D3qwe6iAYQ_ftZxh_5Z'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || DEFAULT_URL
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || DEFAULT_KEY

export const isSupabaseConfigured = Boolean(url && key)

/**
 * Einziger Supabase-Client der App. Verwendet ausschließlich den öffentlichen
 * Publishable Key. Niemals einen Secret-/service_role-Key im Frontend verwenden.
 */
export const supabase = createClient(url, key)
