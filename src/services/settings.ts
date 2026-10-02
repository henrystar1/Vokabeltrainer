import { supabase } from '../lib/supabaseClient'
import type { Profile, Role, UserSettings } from '../types'

export const DEFAULT_SETTINGS: UserSettings = {
  learn_language: 'en',
  direction_to_foreign: true,
  direction_to_german: true,
  words_per_round: 20,
  case_sensitive: false,
}

export async function loadSettings(userId: string): Promise<UserSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('learn_language,direction_to_foreign,direction_to_german,words_per_round,case_sensitive')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return (data as UserSettings | null) ?? DEFAULT_SETTINGS
}

export async function saveSettings(userId: string, s: UserSettings): Promise<void> {
  const { error } = await supabase.from('user_settings').upsert({ user_id: userId, ...s })
  if (error) throw error
}

export async function updateDisplayName(userId: string, name: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ display_name: name.trim() }).eq('id', userId)
  if (error) throw error
}

export async function loadDisplayName(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle()
  if (error) throw error
  return (data?.display_name as string | undefined) ?? null
}

export async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('display_name,role,blocked').eq('id', userId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return { display_name: data.display_name as string, role: (data.role as Role) ?? 'user', blocked: Boolean(data.blocked) }
}
