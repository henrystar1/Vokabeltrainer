import { supabase } from '../lib/supabaseClient'
import type { Profile, Role, UserSettings } from '../types'

export const DEFAULT_SETTINGS: UserSettings = {
  learn_language: 'en',
  direction_to_foreign: true,
  direction_to_german: true,
  words_per_round: 20,
  case_sensitive: false,
  repeat_until_correct: false,
  notify_mentions: true,
  notify_chat: false,
  notify_print: true,
  notify_online: 'off',
  notify_dm: 'window',
}

const BASE_COLS = 'learn_language,direction_to_foreign,direction_to_german,words_per_round,case_sensitive,repeat_until_correct,notify_mentions,notify_chat,notify_print,notify_online,notify_dm'
/** Gibt es die Spalte language_defaults (Migration 0081)? Wird beim ersten Fehler ausgeschaltet, damit alte Datenbanken weiter laufen. */
let hasLanguageCol = true

export async function loadSettings(userId: string): Promise<UserSettings> {
  const run = (cols: string) => supabase.from('user_settings').select(cols).eq('user_id', userId).maybeSingle()
  let res = await run(hasLanguageCol ? `${BASE_COLS},language_defaults` : BASE_COLS)
  if (res.error && hasLanguageCol) {
    hasLanguageCol = false
    res = await run(BASE_COLS)
  }
  if (res.error) throw res.error
  return (res.data as unknown as UserSettings | null) ?? DEFAULT_SETTINGS
}

export async function saveSettings(userId: string, s: UserSettings): Promise<void> {
  const { language_defaults, ...base } = s
  let { error } = await supabase.from('user_settings').upsert(hasLanguageCol ? { user_id: userId, ...base, language_defaults: language_defaults ?? {} } : { user_id: userId, ...base })
  if (error && hasLanguageCol) {
    hasLanguageCol = false
    ;({ error } = await supabase.from('user_settings').upsert({ user_id: userId, ...base }))
  }
  if (error) throw error
}

export async function updateDisplayName(userId: string, name: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ display_name: name.trim() }).eq('id', userId)
  if (error) throw error
}

export async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    display_name: data.display_name as string,
    role: (data.role as Role) ?? 'user',
    blocked: Boolean(data.blocked),
    approved: data.approved !== false,
    avatar_id: (data.avatar_id as string | null) ?? null,
    color_id: (data.color_id as string | null) ?? null,
    effect_id: (data.effect_id as string | null) ?? null,
    theme_id: (data.theme_id as string | null) ?? null,
    tag_id: (data.tag_id as string | null) ?? null,
    tags_hidden: Boolean(data.tags_hidden),
    hide_presence: Boolean(data.hide_presence),
  }
}
