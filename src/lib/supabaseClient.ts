import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

if (!url || !key) {
  throw new Error(
    'Supabase ist nicht konfiguriert: VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY in .env setzen (siehe .env.example).',
  )
}

/**
 * Einziger Supabase-Client der App. Verwendet ausschließlich den öffentlichen
 * Publishable Key – der Schutz der Daten liegt in den Row-Level-Security-Regeln.
 * Niemals einen Secret-/service_role-Key im Frontend verwenden.
 */
export const supabase = createClient(url, key)
