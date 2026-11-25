/**
 * Offline-Lernen: Lese-Aufrufe (Vokabelpool, Fächer …) werden nach jedem Erfolg zwischengespeichert und bei fehlender Verbindung daraus bedient;
 * Lern-Ergebnisse (`submit_session`) werden ohne Verbindung in eine Warteschlange gelegt und später nachgereicht.
 * Reine Logik mit austauschbarem Speicher, damit sie testbar ist.
 */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** Diese Funktionen dürfen aus dem Zwischenspeicher kommen. */
export const CACHED_READS = new Set(['get_learning_pool', 'get_book_boxes', 'get_card_box'])
/** Diese Schreib-Aufrufe werden ohne Verbindung vorgemerkt (kein Rückgabewert nötig außer einer Kennung). */
export const QUEUED_WRITES = new Set(['submit_session'])
const MAX_QUEUE = 200

export const isNetworkError = (e: unknown): boolean => {
  const m = String((e as { message?: unknown } | null)?.message ?? e ?? '')
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|offline|timeout/i.test(m)
}

export const cacheKey = (fn: string, args?: Record<string, unknown>): string => `vt-oc:${fn}:${JSON.stringify(args ?? {})}`

export function cachePut(kv: KV, fn: string, args: Record<string, unknown> | undefined, data: unknown): void {
  try { kv.setItem(cacheKey(fn, args), JSON.stringify({ t: Date.now(), d: data })) } catch { /* Speicher voll – ignorieren */ }
}
export function cacheGet<T>(kv: KV, fn: string, args?: Record<string, unknown>): { found: boolean; data?: T } {
  try {
    const raw = kv.getItem(cacheKey(fn, args)); if (!raw) return { found: false }
    return { found: true, data: (JSON.parse(raw) as { d: T }).d }
  } catch { return { found: false } }
}

const QK = 'vt-oc-queue'
export interface Queued { fn: string; args: Record<string, unknown>; t: number }
export function queueList(kv: KV): Queued[] {
  try { const v = JSON.parse(kv.getItem(QK) ?? '[]') as Queued[]; return Array.isArray(v) ? v : [] } catch { return [] }
}
export function queuePush(kv: KV, fn: string, args: Record<string, unknown>): number {
  const q = queueList(kv); q.push({ fn, args, t: Date.now() })
  while (q.length > MAX_QUEUE) q.shift()
  try { kv.setItem(QK, JSON.stringify(q)) } catch { /* ignorieren */ }
  return q.length
}
/** Wartende Einträge der Reihe nach senden; bei einem Netzfehler stoppen (Rest bleibt), bei anderen Fehlern den Eintrag verwerfen. Liefert die Zahl gesendeter Einträge. */
export async function queueFlush(kv: KV, send: (fn: string, args: Record<string, unknown>) => Promise<unknown>): Promise<number> {
  const q = queueList(kv); let sent = 0
  while (q.length) {
    try { await send(q[0].fn, q[0].args); q.shift(); sent++ } catch (e) { if (isNetworkError(e)) break; q.shift() }
  }
  try { if (q.length) kv.setItem(QK, JSON.stringify(q)); else kv.removeItem(QK) } catch { /* ignorieren */ }
  return sent
}
