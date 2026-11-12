import { createClient } from '@supabase/supabase-js'
import { resolveBackend } from './backendConfig'

// Projekt-Zugang: Browser-Einstellung > public/backend.json > Build-Variablen (siehe backendConfig.ts).
// Der Publishable Key ist für den Browser bestimmt; die Daten schützen die Row-Level-Security-Regeln.
const backend = resolveBackend()
const url = backend.url
const key = backend.key

export const backendSource = backend.source
export const isSupabaseConfigured = Boolean(url && key)

/**
 * Einziger Supabase-Client der App. Verwendet ausschließlich den öffentlichen
 * Publishable Key. Niemals einen Secret-/service_role-Key im Frontend verwenden.
 */
export const supabase = createClient(url, key)
