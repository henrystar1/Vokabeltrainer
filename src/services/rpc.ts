import { supabase } from '../lib/supabaseClient'

/** Ruft eine Datenbankfunktion auf und wirft bei Fehlern das Fehlerobjekt (mit message/hint). */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}
