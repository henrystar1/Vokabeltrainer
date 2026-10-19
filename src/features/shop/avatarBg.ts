import { useSyncExternalStore } from 'react'
import { rpc } from '../../services/rpc'

/**
 * Hintergrundfarben der Emoji-Profilbilder. Alle Nutzer laden die Liste (Anzeigename → Farbe) einmal; der Avatar
 * schlägt dort über den Anzeigenamen nach. Ohne die Migration 0037 bleibt die Liste leer.
 */
let bgs = new Map<string, string>()
let version = 0
const listeners = new Set<() => void>()
const emit = () => {
  version++
  for (const l of listeners) l()
}

export async function refreshAvatarBgs(): Promise<void> {
  try {
    const rows = await rpc<Array<{ display_name: string; avatar_bg: string }>>('get_avatar_bgs')
    bgs = new Map(rows.map((r) => [r.display_name.toLowerCase(), r.avatar_bg]))
    emit()
  } catch {
    // Migration fehlt noch: Standardfarben
  }
}

export function clearAvatarBgs() {
  bgs = new Map()
  emit()
}

export const getAvatarBg = (name: string): string | undefined => {
  const c = bgs.get(name.toLowerCase())
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : undefined
}

export function useAvatarBgVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version,
  )
}

export const setAvatarBg = async (color: string | null): Promise<void> => {
  await rpc<void>('set_avatar_bg', { p_color: color })
  await refreshAvatarBgs()
}

/** Mischt eine Farbe (#rrggbb) mit Schwarz (amount < 0) oder Weiß (amount > 0). */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount))
  return `rgb(${ch[0]} ${ch[1]} ${ch[2]})`
}

export const AVATAR_BG_PRESETS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#64748b', '#1e293b', '#f8fafc']
