import { useSyncExternalStore } from 'react'
import type { LockKey } from '../../services/koins'

/** Diese Bereiche verschwinden im Panik-Modus (Sprint und Duelle bleiben). Gilt nur auf diesem Gerät. */
export const PANIC_KEYS: readonly LockKey[] = ['games', 'gambling', 'chat', 'shop', 'parkour']
const STORAGE_KEY = 'vt_panic'

const listeners = new Set<() => void>()
let state = read()

function read(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

export function setPanic(on: boolean) {
  state = on
  try { if (on) localStorage.setItem(STORAGE_KEY, '1'); else localStorage.removeItem(STORAGE_KEY) } catch { /* ohne Speicher gilt es nur für diese Sitzung */ }
  listeners.forEach((l) => l())
}

export function usePanic(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => state,
    () => false,
  )
}

/** Seiten, auf denen der rote Knopf sichtbar ist. */
export const PANIC_PATHS = [/^\/spiele/, /^\/gambling/, /^\/parkour/, /^\/deathrun/, /^\/team\//]
/** Dort ist Esc nicht Panik (im Spiel wird Esc oft aus Versehen gedrückt), nur der rote Knopf. */
export const PANIC_NO_ESC = [/^\/parkour/, /^\/deathrun/, /^\/team\//]
