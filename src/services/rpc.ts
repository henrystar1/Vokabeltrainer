import { supabase } from '../lib/supabaseClient'
import { CACHED_READS, QUEUED_WRITES, cacheGet, cachePut, isNetworkError, queueFlush, queuePush, type KV } from '../lib/offlineCache'

const store = (): KV | null => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }

/** Entlastet den Server: höchstens 6 Aufrufe gleichzeitig, gleiche Lese-Aufrufe teilen sich eine Anfrage. */
const MAX_PARALLEL = 6
let running = 0
const waiting: Array<() => void> = []
const inflight = new Map<string, Promise<unknown>>()
async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((ok) => waiting.push(ok))
  running++
  try { return await run() } finally { running--; waiting.shift()?.() }
}
function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const go = () => slot(async () => {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) throw error
    return data as T
  })
  if (!CACHED_READS.has(fn)) return go()
  const key = `${fn}:${JSON.stringify(args ?? {})}`
  const hit = inflight.get(key) as Promise<T> | undefined
  if (hit) return hit
  const p = go().finally(() => { inflight.delete(key) })
  inflight.set(key, p)
  return p
}

/**
 * Ruft eine Datenbankfunktion auf und wirft bei Fehlern das Fehlerobjekt (mit message/hint).
 * Offline: Lese-Aufrufe kommen aus dem Zwischenspeicher, `submit_session` wird vorgemerkt und beim nächsten Mal mit Verbindung nachgesendet.
 */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const kv = store()
  try {
    const data = await call<T>(fn, args)
    if (kv && CACHED_READS.has(fn)) cachePut(kv, fn, args, data)
    return data
  } catch (e) {
    if (kv && isNetworkError(e)) {
      if (CACHED_READS.has(fn)) { const c = cacheGet<T>(kv, fn, args); if (c.found) return c.data as T }
      if (QUEUED_WRITES.has(fn)) { queuePush(kv, fn, args ?? {}); return `offline-${Date.now()}` as unknown as T }
    }
    throw e
  }
}

/** Vorgemerkte Lern-Ergebnisse senden (bei Start und sobald die Verbindung zurück ist). */
export async function flushOfflineQueue(): Promise<number> {
  const kv = store(); if (!kv) return 0
  return queueFlush(kv, (fn, args) => call(fn, args))
}
