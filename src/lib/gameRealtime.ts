import { createClient } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

/**
 * Zweites Supabase-Projekt nur für die Parkour-Echtzeit (Positionen, Bots, Zuschauer). Dadurch zählen diese
 * Nachrichten nicht auf das Kontingent der Haupt-Datenbank. Es braucht dort weder Tabellen noch eine Anmeldung,
 * nur Realtime (Broadcast). Der Publishable Key ist öffentlich; per Build-Variable änderbar
 * (VITE_GAME_SUPABASE_URL / VITE_GAME_SUPABASE_PUBLISHABLE_KEY). Ohne Werte läuft alles über die Haupt-Datenbank.
 */
const GAME_URL = 'https://xuqwinmiborgjvgsxscv.supabase.co'
const GAME_KEY = 'sb_publishable_G6CP3tpWXtrN0tsZN9V7KA_RkOnrtYB'

const url = (import.meta.env.VITE_GAME_SUPABASE_URL as string | undefined)?.trim() || GAME_URL
const key = (import.meta.env.VITE_GAME_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || GAME_KEY

export const gameRealtime = url && key
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, realtime: { params: { eventsPerSecond: 40 } } })
  : supabase
