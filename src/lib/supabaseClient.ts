import { createClient } from '@supabase/supabase-js'
import { resolveBackend } from './backendConfig'

// Projekt-Zugang: Browser-Einstellung > public/backend.json > Build-Variablen > fester Rückfall (siehe backendConfig.ts).
// Der Publishable Key ist für den Browser bestimmt; die Daten schützen die Row-Level-Security-Regeln.
const DEFAULT_URL = 'https://xdvaivcwxugluoctrvnj.supabase.co'
const DEFAULT_KEY = 'sb_publishable_vLaQQWmGWSx7D3qwe6iAYQ_ftZxh_5Z'

const backend = resolveBackend()
const url = backend.url || DEFAULT_URL
const key = backend.key || DEFAULT_KEY

export const backendSource = backend.source
export const isSupabaseConfigured = Boolean(url && key)

/**
 * Einziger Supabase-Client der App. Verwendet ausschließlich den öffentlichen
 * Publishable Key. Niemals einen Secret-/service_role-Key im Frontend verwenden.
 */
export const supabase = createClient(url, key)
