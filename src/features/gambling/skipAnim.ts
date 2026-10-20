import { useSyncExternalStore } from 'react'

const KEY = 'vt-gamble-skip-anim'
const listeners = new Set<() => void>()
let value = false
try { value = localStorage.getItem(KEY) === '1' } catch { /* Speicher nicht verfügbar */ }

/** "Animation überspringen" beim Gambling (wird im Browser gemerkt). */
export function setSkipAnim(v: boolean): void {
  value = v
  try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* egal */ }
  listeners.forEach((l) => l())
}
export function getSkipAnim(): boolean { return value }
export function useSkipAnim(): boolean {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => value, () => false)
}
